# -*- coding: utf-8 -*-
"""Deterministic Ares run-state checkpoint tool for low-context models.

Usage:
    python run_state.py init --project-dir <dir> --request "..."
    python run_state.py status --project-dir <dir>
    python run_state.py advance --project-dir <dir> --stage <stage> --status done --evidence <path>
"""
import argparse
import datetime as dt
import io
import json
import os
import sys
import uuid

STAGES = ("match", "profile", "plan", "research", "produce", "review", "deliver")
NEXT = {
    "match": "确认赛事/赛道候选后创建或更新 project.json",
    "profile": "补齐 evidence 台账并运行 validate_profile.py 与 validate_evidence.py",
    "plan": "运行 build_scorecard.py，检查评分点覆盖和交付缺口",
    "research": "补齐关键 claim 的原文摘录、证据文件和真实性状态",
    "produce": "按生产线生成 Word/PPT/Demo，并登记产物 manifest",
    "review": "运行一致性、写作、原型、独立渲染和评分覆盖门禁",
    "deliver": "生成最终交付清单；若仍有阻断项，退回对应阶段",
}


def _path(project_dir):
    return os.path.join(os.path.abspath(project_dir), "ares-run.json")


def _now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def _load(path):
    try:
        with io.open(path, encoding="utf-8") as f:
            value = json.load(f)
    except (OSError, ValueError) as exc:
        raise RuntimeError("无法读取运行状态：%s" % exc)
    if not isinstance(value, dict) or value.get("schema_version") != "1.0":
        raise RuntimeError("运行状态 schema_version 不支持")
    return value


def _save(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def init(args):
    project_dir = os.path.abspath(args.project_dir)
    path = _path(project_dir)
    if os.path.exists(path) and not args.force:
        raise RuntimeError("已存在 ares-run.json；如需重新开始请加 --force")
    value = {
        "schema_version": "1.0",
        "run_id": "ares-" + uuid.uuid4().hex[:12],
        "project_dir": project_dir,
        "request": args.request or "",
        "competition": None,
        "current_stage": "match",
        "stages": {stage: {"status": "pending", "evidence": []} for stage in STAGES},
        "blocking_items": [],
        "next_action": NEXT["match"],
        "updated_at": _now(),
    }
    value["stages"]["match"]["status"] = "in_progress"
    _save(path, value)
    print("已创建 Ares 运行状态：%s" % path)
    print("当前阶段：match；下一步：%s" % value["next_action"])
    return 0


def status(args):
    value = _load(_path(args.project_dir))
    print(json.dumps({
        "run_id": value["run_id"],
        "current_stage": value["current_stage"],
        "next_action": value["next_action"],
        "blocking_items": value["blocking_items"],
        "stage_status": {k: v.get("status") for k, v in value["stages"].items()},
        "updated_at": value.get("updated_at"),
    }, ensure_ascii=False, indent=2))
    return 0


def advance(args):
    if args.stage not in STAGES:
        raise RuntimeError("未知阶段：%s" % args.stage)
    path = _path(args.project_dir)
    value = _load(path)
    current = value.get("current_stage")
    if args.stage != current:
        raise RuntimeError("只能更新当前阶段：当前=%s，收到=%s；请先完成前置阶段" % (current, args.stage))
    if args.status == "done" and not args.evidence:
        raise RuntimeError("阶段标记 done 必须至少提供一条 evidence 路径或结果摘要")
    stage = value["stages"][args.stage]
    stage["status"] = args.status
    if args.evidence:
        for item in args.evidence:
            if item not in stage["evidence"]:
                stage["evidence"].append(item)
    if args.note:
        stage["note"] = args.note
    if args.blocking is not None:
        value["blocking_items"] = args.blocking
    if args.status == "done":
        idx = STAGES.index(args.stage)
        if idx < len(STAGES) - 1:
            value["current_stage"] = STAGES[idx + 1]
            value["stages"][STAGES[idx + 1]]["status"] = "in_progress"
            value["next_action"] = NEXT[STAGES[idx + 1]]
        else:
            value["current_stage"] = "deliver"
            value["next_action"] = NEXT["deliver"]
    else:
        value["current_stage"] = args.stage
        value["next_action"] = NEXT[args.stage]
    value["updated_at"] = _now()
    _save(path, value)
    print("已更新阶段 %s=%s；当前阶段=%s" % (args.stage, args.status, value["current_stage"]))
    return 0


def main(argv):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="command", required=True)
    p = sub.add_parser("init")
    p.add_argument("--project-dir", required=True)
    p.add_argument("--request", default="")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=init)
    p = sub.add_parser("status")
    p.add_argument("--project-dir", required=True)
    p.set_defaults(func=status)
    p = sub.add_parser("advance")
    p.add_argument("--project-dir", required=True)
    p.add_argument("--stage", required=True, choices=STAGES)
    p.add_argument("--status", required=True, choices=("pending", "in_progress", "blocked", "done"))
    p.add_argument("--evidence", nargs="*", default=[])
    p.add_argument("--blocking", nargs="*", default=None)
    p.add_argument("--note", default="")
    p.set_defaults(func=advance)
    args = ap.parse_args(argv)
    try:
        return args.func(args)
    except RuntimeError as exc:
        print("运行状态失败：%s" % exc)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
