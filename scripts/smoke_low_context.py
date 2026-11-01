# -*- coding: utf-8 -*-
"""Exercise the deterministic Ares handoff protocol with a short context.

This does not simulate a model or fabricate deliverables. It only proves that
the state file, catalogue matcher, environment report and optional existing
project profile can be chained with bounded outputs.
"""
import argparse
import io
import json
import os
import shutil
import subprocess
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _run(script, args, cwd=ROOT):
    p = subprocess.run([sys.executable, script] + list(args), cwd=cwd,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.returncode, p.stdout + p.stderr


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--request", required=True)
    ap.add_argument("--project-dir", default=None, help="可选：已有 project.json 的目录")
    ap.add_argument("--out", required=True, help="工作区内的临时 smoke 输出目录")
    args = ap.parse_args(argv)
    out = os.path.abspath(args.out)
    if os.path.exists(out):
        shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out, exist_ok=True)
    report = {"schema_version": "1.0", "request": args.request, "steps": [], "passed": False}

    def step(name, rc, output, evidence=None):
        item = {"name": name, "returncode": rc, "passed": rc == 0,
                "evidence": evidence or "", "tail": output[-500:]}
        report["steps"].append(item)
        return rc == 0

    state_dir = os.path.join(out, "state")
    rc, output = _run("scripts/run_state.py", ["init", "--project-dir", state_dir, "--request", args.request])
    ok = step("state.init", rc, output, os.path.join(state_dir, "ares-run.json"))
    rc, output = _run("scripts/match_competition.py", ["--request", args.request, "--markdown", os.path.join(out, "赛事匹配.md")])
    ok = step("match", rc, output, os.path.join(out, "赛事匹配.md")) and ok
    if ok:
        rc, output = _run("scripts/run_state.py", ["advance", "--project-dir", state_dir, "--stage", "match", "--status", "done", "--evidence", os.path.join(out, "赛事匹配.md")])
        ok = step("state.advance.match", rc, output, os.path.join(state_dir, "ares-run.json")) and ok
    doctor_path = os.path.join(out, "ares-runtime.json")
    rc, output = _run("scripts/doctor.py", ["--out", doctor_path])
    ok = step("doctor", rc, output, doctor_path) and ok

    project_dir = os.path.abspath(args.project_dir) if args.project_dir else ""
    profile_path = os.path.join(project_dir, "project.json") if project_dir else ""
    if profile_path and os.path.isfile(profile_path):
        rc, output = _run("scripts/validate_profile.py", [profile_path])
        ok = step("profile.validate", rc, output, profile_path) and ok
        rc, output = _run("scripts/validate_evidence.py", [profile_path])
        ok = step("evidence.validate", rc, output, profile_path) and ok
        score_dir = os.path.join(out, "scorecard")
        rc, output = _run("scripts/build_scorecard.py", ["--profile", profile_path, "--output-dir", score_dir])
        ok = step("scorecard.build", rc, output, os.path.join(score_dir, "评分覆盖矩阵.json")) and ok
    else:
        report["steps"].append({"name": "profile.validate", "passed": True, "skipped": True,
                                "reason": "未提供 project.json；低上下文协议只验证入口与断点"})
    status_path = os.path.join(state_dir, "ares-run.json")
    if os.path.isfile(status_path):
        with io.open(status_path, encoding="utf-8") as f:
            report["final_stage"] = json.load(f).get("current_stage")
    report["passed"] = bool(ok)
    report_path = os.path.join(out, "smoke-report.json")
    with io.open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("低上下文协议 smoke：%s；报告=%s" % ("PASS" if report["passed"] else "FAIL", report_path))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
