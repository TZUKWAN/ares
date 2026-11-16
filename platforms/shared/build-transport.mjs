import {build} from 'esbuild';
import {mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const vendor = join(root, 'vendor');
await mkdir(join(vendor, 'licenses'), {recursive: true});
const result = await build({
  absWorkingDir: root, entryPoints: ['sdk-source.mjs'], outfile: 'vendor/mcp-sdk.mjs',
  bundle: true, platform: 'node', target: 'node20', format: 'esm', metafile: true,
  legalComments: 'linked', banner: {js: '// Built from pinned official MCP SDK. See THIRD_PARTY.json and package-lock.json.'},
});
const packages = ['@modelcontextprotocol/server', '@modelcontextprotocol/core', 'zod'];
const dependencies = [];
for (const name of packages) {
  const location = join(root, 'node_modules', name);
  const pkg = JSON.parse(await readFile(join(location, 'package.json'), 'utf8'));
  const license = name === 'zod' ? 'LICENSE' : 'LICENSE';
  const target = name.replaceAll('/', '__').replace('@', '') + '.txt';
  await copyFile(join(location, license), join(vendor, 'licenses', target));
  dependencies.push({name, version: pkg.version, license: pkg.license, repository: pkg.repository, licenseFile: 'licenses/' + target});
}
const bytes = await readFile(join(vendor, 'mcp-sdk.mjs'));
await writeFile(join(vendor, 'THIRD_PARTY.json'), JSON.stringify({
  source: 'https://github.com/modelcontextprotocol/typescript-sdk',
  protocol: 'Official SDK supports legacy initialization and 2026-07-28 discovery.',
  build: 'npm ci --ignore-scripts && npm run build',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  dependencies, inputs: Object.keys(result.metafile.inputs).sort(),
}, null, 2) + '\n');
console.error('ARES MCP transport built: ' + bytes.length + ' bytes');
