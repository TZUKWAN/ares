param([Parameter(Mandatory=$true)][string]$PlanFile)
$ErrorActionPreference = 'Stop'
$plan = Get-Content -LiteralPath $PlanFile -Raw -Encoding UTF8 | ConvertFrom-Json
$receipt = [ordered]@{ schema_version=1; planKey=$plan.key; attemptId=$plan.attemptId; ready=$false; runtime=$plan.runtime; checks=@(); packages=@(); commands=@(); sourceHashes=@(); exitCode=1 }
$aresPreviousTemp=$env:TEMP
$aresPreviousTmp=$env:TMP
$aresPreviousTmpDir=$env:TMPDIR
try {
    New-Item -ItemType Directory -Path $plan.root -Force | Out-Null
    $aresRuntimeTemp=Join-Path $plan.root '.tmp'
    New-Item -ItemType Directory -Path $aresRuntimeTemp -Force | Out-Null
    $env:TEMP=$aresRuntimeTemp
    $env:TMP=$aresRuntimeTemp
    $env:TMPDIR=$aresRuntimeTemp
    New-Item -ItemType Directory -Path $plan.sourceDirectory -Force | Out-Null
    foreach ($file in $plan.files) {
        $original = Join-Path $plan.sourceRoot $file.path
        $destination = Join-Path $plan.sourceDirectory $file.path
        if ((Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw "Pinned source changed: $($file.path)" }
        if (Test-Path -LiteralPath $destination) {
            if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw "Managed environment source changed: $($file.path)" }
        } else {
            New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
            Copy-Item -LiteralPath $original -Destination $destination
        }
        if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw "Copied source hash differs: $($file.path)" }
        $receipt.sourceHashes += @{path=$file.path;sha256=$file.sha256}
    }
    if ($plan.runtime -eq 'python') {
        $python = Join-Path $plan.root 'venv/Scripts/python.exe'
        $uv = Get-Command uv.exe,uv -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        $basePython = Get-Command python.exe,python,python3 -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $basePython) { throw 'No Python interpreter is available to this DSH process' }
        if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
            if ($uv) {
                & $uv.Source venv --python $basePython.Source --no-python-downloads --cache-dir (Join-Path $plan.root '.uv-cache') (Join-Path $plan.root 'venv')
            } else { & $basePython.Source -m venv --without-pip (Join-Path $plan.root 'venv') }
            if ($LASTEXITCODE -ne 0) { throw "Python venv failed: exit $LASTEXITCODE" }
        }
        if ($plan.packages.Count) {
            if ($uv) {
                $uvOptions=@('pip','install','--python',$python,'--cache-dir',(Join-Path $plan.root '.uv-cache'),'--only-binary',':all:')
                if (@($plan.packages | Where-Object { $_ -notmatch '^pip==' }).Count -eq 0) {
                    $bundle = & $basePython.Source -c 'import ensurepip,pathlib;print(pathlib.Path(ensurepip.__file__).parent/"_bundled")'
                    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the actual bundled pip wheels' }
                    $uvOptions+=@('--no-index','--find-links',([string]($bundle | Select-Object -Last 1)))
                }
                & $uv.Source @uvOptions @($plan.packages)
                $receipt.installer='uv'
            } else {
                & $python -m pip --version | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    & $python -m ensurepip --upgrade --default-pip
                    if ($LASTEXITCODE -ne 0) { throw "Python pip bootstrap failed: exit $LASTEXITCODE" }
                }
                & $python -m pip install --disable-pip-version-check --no-input --no-cache-dir --require-virtualenv --only-binary=:all: @($plan.packages)
                $receipt.installer='pip'
            }
            if ($LASTEXITCODE -ne 0) { throw "Pinned Python dependency installation failed: exit $LASTEXITCODE" }
        }
        $probe = @'
import sys,json,importlib,importlib.metadata
plan=json.load(open(sys.argv[1],encoding='utf-8-sig'))
checks=[]
for name in plan['modules']:
    importlib.import_module(name)
    checks.append({'module':name,'imported':True})
packages=[]
for spec in plan['packages']:
    name,expected=spec.split('==',1)
    name=name.split('[',1)[0]
    actual=importlib.metadata.version(name)
    if actual!=expected: raise RuntimeError('Package version mismatch: '+name+' '+actual+' != '+expected)
    packages.append({'name':name,'version':actual})
print(json.dumps({'runtimeVersion':sys.version,'executable':sys.executable,'checks':checks,'packages':packages}))
'@
        $probeOutput = & $python -c $probe $PlanFile
        if ($LASTEXITCODE -ne 0) { throw "Python module/version checks failed: exit $LASTEXITCODE" }
        $actual = ($probeOutput | Select-Object -Last 1) | ConvertFrom-Json
        $receipt.executable = $actual.executable
        $receipt.runtimeVersion = $actual.runtimeVersion
        $receipt.checks = @($actual.checks)
        $receipt.packages = @($actual.packages)
        $receipt.binPaths = @((Split-Path -Parent $python))
    } elseif ($plan.runtime -eq 'node') {
        $node = Get-Command node.exe,node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $node) { throw 'No Node interpreter is available to this DSH process' }
        $project = Split-Path -Parent $plan.sourceDirectory
        if (-not (Test-Path -LiteralPath (Join-Path $project 'package.json'))) { Set-Content -LiteralPath (Join-Path $project 'package.json') -Value '{"private":true,"type":"commonjs"}' -Encoding UTF8 }
        Push-Location -LiteralPath $project
        try {
            if ($plan.packages.Count) {
                $npm = Get-Command npm.cmd,npm -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
                if (-not $npm) { throw 'npm is unavailable; no dependency installation was claimed' }
                $needsInstall=$false
                foreach ($spec in $plan.packages) {
                    $at=$spec.LastIndexOf('@');$name=$spec.Substring(0,$at);$expected=$spec.Substring($at+1)
                    $metadata=Join-Path $project ('node_modules/'+$name+'/package.json')
                    if (-not (Test-Path -LiteralPath $metadata)) { $needsInstall=$true;break }
                    if ((Get-Content -LiteralPath $metadata -Raw -Encoding UTF8 | ConvertFrom-Json).version -ne $expected) { $needsInstall=$true;break }
                }
                if ($needsInstall) {
                    & $npm.Source install --ignore-scripts --no-audit --no-fund --save-exact --cache (Join-Path $plan.root '.npm-cache') @($plan.packages)
                    if ($LASTEXITCODE -ne 0) { throw "Pinned Node dependency installation failed: exit $LASTEXITCODE" }
                }
            }
            $probe = @'
const fs=require('node:fs'),path=require('node:path');
const plan=JSON.parse(fs.readFileSync(process.argv[1],'utf8').replace(/^\uFEFF/,''));
(async()=>{const checks=[];for(const name of plan.modules){await import(name);checks.push({module:name,imported:true});}
const packages=plan.packages.map(spec=>{const at=spec.lastIndexOf('@'),name=spec.slice(0,at),expected=spec.slice(at+1),data=JSON.parse(fs.readFileSync(path.join(process.cwd(),'node_modules',name,'package.json'),'utf8'));if(data.version!==expected)throw Error('Package version mismatch: '+name);return {name,version:data.version};});
console.log(JSON.stringify({runtimeVersion:process.version,executable:process.execPath,checks,packages}));})().catch(error=>{console.error(error);process.exitCode=1});
'@
            $probeOutput = & $node.Source -e $probe $PlanFile
            if ($LASTEXITCODE -ne 0) { throw "Node module/version checks failed: exit $LASTEXITCODE" }
            $actual = ($probeOutput | Select-Object -Last 1) | ConvertFrom-Json
            $receipt.executable = $actual.executable
            $receipt.runtimeVersion = $actual.runtimeVersion
            $receipt.checks = @($actual.checks)
            $receipt.packages = @($actual.packages)
            $receipt.binPaths = @((Join-Path $project 'node_modules/.bin'),(Split-Path -Parent $actual.executable))
            if (Test-Path -LiteralPath (Join-Path $project 'package-lock.json')) { $receipt.lockHash=(Get-FileHash -LiteralPath (Join-Path $project 'package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant() }
        } finally { Pop-Location }
    } elseif ($plan.runtime -eq 'none') {
        $receipt.binPaths = @()
    } else { throw 'Unsupported runtime' }
    foreach ($name in $plan.commands) {
        $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $command) { throw "Required CLI is missing: $name" }
        $receipt.commands += @{name=$name;path=$command.Source;available=$true}
    }
    $receipt.ready=$true
    $receipt.exitCode=0
} catch { $receipt.error=$_.Exception.Message }
finally { $env:TEMP=$aresPreviousTemp; $env:TMP=$aresPreviousTmp; $env:TMPDIR=$aresPreviousTmpDir }
$receipt.checkedAt=[DateTime]::UtcNow.ToString('o')
$temporary=$plan.receipt+'.'+$plan.attemptId+'.tmp'
Set-Content -LiteralPath $temporary -Value ($receipt | ConvertTo-Json -Depth 20) -Encoding UTF8
Move-Item -LiteralPath $temporary -Destination $plan.receipt -Force
Write-Output ($receipt | ConvertTo-Json -Depth 20 -Compress)
if (-not $receipt.ready) { exit 1 }
