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
from datetime import datetime, timezone


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


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
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--docx")
    ap.add_argument("--pptx")
    ap.add_argument("--prototype-dir")
    ap.add_argument("--pipeline", default="L1")
    ap.add_argument("--report", default=None)
    ap.add_argument("--no-visual", action="store_true", help="仅适用于没有 Word/PPT/Demo 的竞赛线")
    args = ap.parse_args(argv)
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
        "schema_version": "1.0",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "profile": os.path.abspath(args.profile),
        "output_dir": output_dir,
        "formal_ready": all(step.get("passed") for step in steps),
        "steps": steps,
    }
    report_path = os.path.abspath(args.report or os.path.join(output_dir, "最终门禁报告.json"))
    os.makedirs(os.path.dirname(report_path) or ".", exist_ok=True)
    with io.open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("最终门禁报告：%s" % report_path)
    print("正式就绪=%s；通过=%d/%d" % (report["formal_ready"], sum(bool(x.get("passed")) for x in steps), len(steps)))
    return 0 if report["formal_ready"] else 1


if __name__ == "__main__":
    sys.exit(main())
