# -*- coding: utf-8 -*-
"""Run the Ares pre-delivery gates as one bounded, auditable command.

The command never downgrades a failed gate. It runs independent checks in
sequence, records each return code and output tail, and returns 1 whenever a
required gate fails or visual evidence was not supplied.
"""
import argparse
import io
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _within(path, parent):
    path = os.path.normcase(os.path.realpath(os.path.abspath(path)))
    parent = os.path.normcase(os.path.realpath(os.path.abspath(parent)))
    try:
        return os.path.commonpath([path, parent]) == parent
    except ValueError:
        return False


def _report_target(path, profile_path, profile, report, project_root=None):
    """A report must not become an overwrite path for checked inputs or works."""
    path = os.path.abspath(path)
    cursor = path
    while True:
        if os.path.islink(cursor) or getattr(os.path, 'isjunction', lambda _: False)(cursor):
            raise ValueError('报告路径或父目录包含链接，未写入')
        parent = os.path.dirname(cursor)
        if parent == cursor:
            break
        cursor = parent
    protected = [os.path.abspath(profile_path)]
    if project_root:
        metadata = os.path.join(project_root, '.ares')
        if _within(path, metadata) and not _within(path, os.path.join(metadata, 'reports')):
            raise ValueError('报告不能覆盖项目状态、快照、版本对象或复核记录')
        output = profile.get('outputDir')
        if output and _within(path, os.path.join(project_root, output)):
            raise ValueError('报告不能写入正在验收的作品目录，请选择独立报告目录')
        baseline = profile.get('competition', {}).get('ruleBaseline') or {}
        if baseline.get('snapshotPath'):
            protected.append(os.path.join(project_root, baseline['snapshotPath']))
        protected.extend(os.path.join(project_root, row['path']) for row in profile.get('facts', {}).get('materials', []) if isinstance(row, dict) and row.get('path'))
    if any(_within(path, item) for item in protected):
        raise ValueError('报告不能覆盖项目原始资料或规则快照')
    if os.path.exists(path):
        try:
            with io.open(path, encoding='utf-8') as stream:
                previous = json.load(stream)
            same = previous.get('kind') == report.get('kind') and (
                previous.get('projectId') == report.get('projectId') if project_root else previous.get('profile') == report.get('profile'))
        except (ValueError, OSError, AttributeError):
            same = False
        if not same:
            raise ValueError('报告目标已有其他文件，未覆盖')
    return path


def _write_report(path, profile_path, profile, report, project_root=None):
    path = _report_target(path, profile_path, profile, report, project_root)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix='.ares-gate-', suffix='.tmp', dir=os.path.dirname(path))
    try:
        with os.fdopen(handle, 'w', encoding='utf-8', newline='\n') as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        _report_target(path, profile_path, profile, report, project_root)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return path


def _run(label, script, args):
    command = [sys.executable, os.path.join(ROOT, script)] + [str(x) for x in args]
    p = subprocess.run(command, cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return {
        "name": label,
        "command": command,
        "returncode": p.returncode,
        "passed": p.returncode == 0,
        "output_tail": (p.stdout + p.stderr)[-1200:],
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--output-dir")
    ap.add_argument("--docx")
    ap.add_argument("--pptx")
    ap.add_argument("--prototype-dir")
    ap.add_argument("--pipeline", default="L1")
    ap.add_argument("--report", default=None)
    ap.add_argument("--no-visual", action="store_true", help="仅适用于没有 Word/PPT/Demo 的竞赛线")
    args = ap.parse_args(argv)
    with io.open(args.profile,encoding='utf-8') as f:
        profile=json.load(f)
    if profile.get('schema_version')==2:
        project_root=os.path.dirname(os.path.dirname(os.path.abspath(args.profile)))
        output_dir=os.path.abspath(args.output_dir or os.path.join(project_root,'.ares','reports'))
        report_path=os.path.abspath(args.report or os.path.join(output_dir,'最终门禁报告.json'))
        try:
            p=subprocess.run(['node',os.path.join(ROOT,'scripts','ares.mjs'),'verify','--root',project_root],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180)
            report=json.loads(p.stdout)
            if report.get('kind')!='ares-project-verification' or report.get('projectId')!=profile.get('id'):
                raise ValueError('未取得当前项目的有效验收报告')
            if p.returncode!=0 and report.get('checksPassed') is True:
                report['checksPassed']=False
                report.setdefault('blocking',[]).append({'code':'checker-exit-failed','reason':'项目检查程序返回非零退出码'})
            if args.docx or args.pptx or args.prototype_dir or args.no_visual:
                report['checksPassed']=False
                report['blocking'].append({'code':'legacy-visual-flags','reason':'新版项目按固定流程检查声明作品，旧版视觉参数不适用于新版项目'})
            report.update(profile=os.path.abspath(args.profile),reportPath=report_path,checks_passed=report.get('checksPassed') is True,formal_ready=report.get('checksPassed') is True,internal_gate_only=True)
            if not report['checksPassed']:
                report['submissionReadiness']='blocked'
            _write_report(report_path,args.profile,profile,report,project_root)
            print('最终门禁报告：'+report_path)
            print('内部提交检查通过=%s；阻断项=%d'%(report['checksPassed'],len(report.get('blocking',[]))))
            return 0 if report['checksPassed'] else 1
        except (OSError,ValueError,subprocess.TimeoutExpired) as error:
            print('最终检查未完成，未生成通过报告：'+str(error),file=sys.stderr)
            return 1
    if not args.output_dir:
        ap.error('旧档案需要 --output-dir；新版项目默认写入 .ares/reports')
    output_dir = os.path.abspath(args.output_dir)
    steps = []
    steps.append(_run("profile", "scripts/validate_profile.py", [os.path.abspath(args.profile), "--quiet"]))
    steps.append(_run("evidence_strict", "scripts/validate_evidence.py", [os.path.abspath(args.profile), "--check-url", "--strict"]))
    steps.append(_run("scorecard_strict", "scripts/build_scorecard.py", ["--profile", os.path.abspath(args.profile), "--output-dir", output_dir, "--strict"]))
    steps.append(_run("consistency", "scripts/consistency_check.py", [output_dir, "--profile", os.path.abspath(args.profile)]))
    visual_args = []
    if args.docx:
        visual_args.extend(["--docx", os.path.abspath(args.docx)])
    if args.pptx:
        visual_args.extend(["--pptx", os.path.abspath(args.pptx)])
    if args.prototype_dir:
        visual_args.extend(["--prototype-dir", os.path.abspath(args.prototype_dir)])
    if visual_args:
        steps.append(_run("visuals", "scripts/audit_visuals.py", visual_args + ["--pipeline", args.pipeline, "--strict"]))
    elif args.no_visual:
        steps.append({"name": "visuals", "passed": True, "skipped": True,
                      "note": "用户明确指定无 Word/PPT/Demo 视觉交付"})
    else:
        steps.append({"name": "visuals", "passed": False,
                      "note": "未提供 --docx/--pptx/--prototype-dir；视觉门禁不能被跳过"})
    report = {
        "schema_version": "3.0",
        "kind": "ares-legacy-verification",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "profile": os.path.abspath(args.profile),
        "output_dir": output_dir,
        "checks_passed": all(step.get("passed") for step in steps),
        "formal_ready": False,
        "checksPassed": False,
        "submissionReadiness": "blocked",
        "blocking": [{"code": "legacy-requires-current-owner-review", "reason": "旧档案未包含新版的当届规则、固定作品与逐项负责人验收"}],
        "workflow": {"state": "legacy"},
        "contentReview": {"state": "requires-v2"},
        "rules": {"state": "requires-v2"},
        "cloud": {"state": "not-audited-by-legacy-checks"},
        "files": [],
        "readiness_note": "旧档案检查不包含新版当届规则与逐项内容复核，请通过工作台保留原档案并建立新版项目。",
        "steps": steps,
    }
    report_path = os.path.abspath(args.report or os.path.join(output_dir, "最终门禁报告.json"))
    _write_report(report_path,args.profile,profile,report)
    print("最终门禁报告：%s" % report_path)
    print("正式就绪=%s；通过=%d/%d" % (report["formal_ready"], sum(bool(x.get("passed")) for x in steps), len(steps)))
    return 0 if report["formal_ready"] else 1


if __name__ == "__main__":
    sys.exit(main())
