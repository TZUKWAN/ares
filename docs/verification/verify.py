# -*- coding: utf-8 -*-
"""
verify.py — Ares 插件分阶段验收脚本（阶段F全量复测也复用本文件）

用法：
    python docs/verification/verify.py A        # 阶段A验收
    python docs/verification/verify.py A C ...  # 多阶段
    python docs/verification/verify.py all      # 全部

每阶段全部断言通过输出 [PASS]，任一失败输出 [FAIL] 与明细，任一阶段失败整体退出码 1。
"""
import io
import json
import os
import re
import subprocess
import shutil
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))          # ares/ 插件根
FAILURES = []
WORK_TMP = os.path.join(ROOT, ".verification-tmp")


def workspace_mkstemp(suffix=""):
    os.makedirs(WORK_TMP, exist_ok=True)
    fd, path = tempfile.mkstemp(suffix=suffix, dir=ROOT)
    return fd, path


def workspace_mkdtemp():
    os.makedirs(WORK_TMP, exist_ok=True)
    return WORK_TMP


def check(stage, name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print("  [%s] %s%s" % (status, name, (" — " + detail) if detail and not cond else ""))
    if not cond:
        FAILURES.append("%s / %s %s" % (stage, name, detail))
    return cond


def run_py(script, args=None, cwd=ROOT):
    p = subprocess.run([sys.executable, script] + (args or []),
                       capture_output=True, text=True, cwd=cwd, encoding="utf-8", errors="replace")
    return p.returncode, p.stdout + p.stderr


def load_json(rel):
    return json.load(io.open(os.path.join(ROOT, rel), encoding="utf-8"))


# ---------------------------------------------------------------- 阶段A
def verify_A():
    print("阶段A 基础设施")
    # T1.1 目录骨架与规范一致
    required_dirs = [
        "skills/ares", "skills/ares-entrepreneurship", "skills/ares-modeling",
        "skills/ares-engineering", "skills/ares-business-case", "skills/ares-art-design",
        "skills/ares-coding-contest", "skills/ares-humanities", "skills/ares-lab-skills",
        "skills/ares-simulation", "skills/ares-writing-style", "skills/ares-docx",
        "skills/ares-ppt", "skills/ares-data", "skills/ares-prototype", "skills/ares-judge",
        "commands", "agents", "hooks", "data/rubrics", "scripts",
    ]
    for d in required_dirs:
        check("A/T1.1", "目录存在 " + d, os.path.isdir(os.path.join(ROOT, d)))
    check("A/T1.1", "README.md 存在", os.path.isfile(os.path.join(ROOT, "README.md")))
    readme = io.open(os.path.join(ROOT, "README.md"), encoding="utf-8").read()
    n_triggers = 0
    for line in readme.splitlines():
        s = line.strip()
        if any(s.startswith("%d." % i) or s.startswith("%d．" % i) for i in range(1, 20)) and ("「" in s or "『" in s or "参加" in s or "帮我" in s):
            n_triggers += 1
    check("A/T1.1", "README 自然语言触发示例 ≥6 条", n_triggers >= 6, "检出 %d 条" % n_triggers)

    # T1.2 competitions.json
    comps = load_json("data/competitions.json")
    check("A/T1.2", "132 条记录", len(comps) == 132, "实际 %d" % len(comps))
    check("A/T1.2", "id 连续 1-132", [c["id"] for c in comps] == list(range(1, 133)))
    ok_fields = all(all(k in c for k in ("id", "name", "level", "category", "pipeline")) for c in comps)
    check("A/T1.2", "每条含 id/name/level/category/pipeline", ok_fields)
    lv = {}
    for c in comps:
        lv[c["level"]] = lv.get(c["level"], 0) + 1
    check("A/T1.2", "等级分布 A1:3 A2:42 A3:38 B1:13 B2:36",
          lv == {"A1": 3, "A2": 42, "A3": 38, "B1": 13, "B2": 36}, str(lv))
    spot = {1: ("中国国际大学生创新大赛", "A1"), 51: ("蓝桥杯", "A3"), 83: ("美国大学生数学建模竞赛", "A3"),
            2: ("“挑战杯”课外学术科技作品竞赛", "A1"), 109: ("湖北省青年志愿服务项目大赛", "B2"),
            114: ("中国大学生程序设计竞赛（CCPC）", "B2"), 132: ("SAMPE中国复合材料系列竞赛", "B2"),
            24: ("中国高校计算机大赛（4项）", "A2"), 72: ("统计建模大赛", "A3"), 16: ("外研社英语系列赛（4项）", "A2")}
    bad = [i for i, (nm, level) in spot.items()
           if comps[i - 1]["name"] != nm or comps[i - 1]["level"] != level]
    check("A/T1.2", "随机抽10条与附录四核对", not bad, "不一致 id: %s" % bad)

    # T1.3 tracks.json
    tracks = load_json("data/tracks.json")
    entries = tracks["entries"]
    check("A/T1.3", "展开后条目 ≥150", len(entries) >= 150, "实际 %d" % len(entries))
    covered = {e["competition_id"] for e in entries}
    check("A/T1.3", "132 项全覆盖", covered == set(range(1, 133)))
    valid_pipes = {"L1", "L2", "L3", "L4", "L5", "L6", "E1", "E2", "E3"}
    check("A/T1.3", "pipeline 全部合法", all(e["pipeline"] in valid_pipes for e in entries))
    check("A/T1.3", "每条含默认产出物清单", all(len(e["default_deliverables"]) >= 3 for e in entries))

    # T1.4 profile-schema + validate_profile.py
    check("A/T1.4", "profile-schema.json 存在",
          os.path.isfile(os.path.join(ROOT, "skills/ares/references/profile-schema.json")))
    schema = load_json("skills/ares/references/profile-schema.json")
    check("A/T1.4", "schema 含字段说明", "schema" in schema and "rules" in schema)
    fd, tmp = workspace_mkstemp(suffix=".json")
    os.close(fd)
    try:
        with io.open(tmp, "w", encoding="utf-8") as f:
            f.write("{}")
        rc, out = run_py("scripts/validate_profile.py", [tmp])
        check("A/T1.4", "空档案→缺失项清单+退出码1", rc == 1 and "缺失项清单" in out, "rc=%d" % rc)
        full = {
            "project_name": "测试项目", "one_liner": "一句话", "slogan": "口号",
            "competition": {"id": 1, "name": "中国国际大学生创新大赛", "level": "A1", "track": "高教主赛道"},
            "pain_points": [{"desc": "x"}], "competitors": [{"name": "y"}], "advantages": ["z"],
            "solution": {"features": ["a"], "tech_stack": ["b"], "innovations": ["c"], "performance_metrics": [{"metric": "m", "value": "v"}]},
            "market": {"tam": "1", "sam": "2", "som": "3", "growth": "4", "sources": ["s"]},
            "business_model": {"revenue_streams": ["r"], "pricing": {"p": 1}, "costs": ["c"]},
            "financials": {"revenue_start_wan": 200, "growth_rate_range": "25%-40%", "margin_ratio_vs_industry": "1.2", "years": 6},
            "team": [{"name": "t"}], "milestones": [{"time": "2025"}],
            "achievements": {"patents": ["p"], "pilots": ["pl"], "papers": [], "awards": [], "partners": []},
            "social_value": {"employment": "e", "education": "d", "others": []},
            "data_confidence": {"real": ["r"], "estimated": ["e"], "placeholder": ["p"]},
            "evidence": {
                "sources": [{"id": "s1", "title": "测试公开来源", "org": "国务院门户网站",
                             "url": "https://www.gov.cn/", "published": "2026-01-01",
                             "accessed": "2026-10-02", "authority": "A", "independent_group": "official"}],
                "claims": [
                    {"id": "c1", "field": "project_name", "status": "real", "source_ids": ["s1"]},
                    {"id": "c2", "field": "market.tam", "status": "estimated", "source_ids": ["s1"],
                     "method": "测试档案仅用于校验结构"},
                    {"id": "c3", "field": "team[0]", "status": "placeholder", "source_ids": [],
                     "rationale": "测试档案不要求真实成员信息"},
                ],
            },
        }
        with io.open(tmp, "w", encoding="utf-8") as f:
            json.dump(full, f, ensure_ascii=False)
        rc, out = run_py("scripts/validate_profile.py", [tmp])
        check("A/T1.4", "完整档案→校验通过+退出码0", rc == 0 and "校验通过" in out, "rc=%d %s" % (rc, out[:200]))
        full["evidence"]["sources"][0]["url"] = "bad url"
        with io.open(tmp, "w", encoding="utf-8") as f:
            json.dump(full, f, ensure_ascii=False)
        rc, out = run_py("scripts/validate_evidence.py", [tmp])
        check("A/T1.4", "非法来源 URL 被证据门禁拦截", rc == 1 and "http(s) URL" in out, out[:200])
        full["evidence"]["sources"][0]["url"] = "https://www.gov.cn/"
        full["evidence"]["sources"].append({
            "id": "s2", "title": "同一来源组的第二条来源", "org": "同一机构",
            "url": "https://www.gov.cn/", "accessed": "2026-10-02",
            "authority": "A", "independent_group": "official",
        })
        full["evidence"]["claims"].append({
            "id": "c4", "field": "project_name", "status": "real",
            "source_ids": ["s1", "s2"], "critical": True,
        })
        with io.open(tmp, "w", encoding="utf-8") as f:
            json.dump(full, f, ensure_ascii=False)
        rc, out = run_py("scripts/validate_evidence.py", [tmp])
        check("A/T1.4", "关键结论缺少独立来源组被拦截",
              rc == 1 and "independent_group" in out, out[:200])
        full["evidence"]["sources"][1]["independent_group"] = "secondary"
        with io.open(tmp, "w", encoding="utf-8") as f:
            json.dump(full, f, ensure_ascii=False)
        scorecard_out = tmp + ".scorecard"
        os.makedirs(scorecard_out, exist_ok=True)
        rc, out = run_py("scripts/build_scorecard.py", ["--profile", tmp, "--output-dir", scorecard_out])
        scorecard_json = os.path.join(scorecard_out, "评分覆盖矩阵.json")
        scorecard = load_json(scorecard_json) if os.path.isfile(scorecard_json) else {}
        check("A/T1.4", "评分覆盖矩阵生成且不虚报覆盖",
              rc == 0 and scorecard.get("formal_ready") is False and scorecard.get("coverage", {}).get("total_points", 0) > 0,
              out[:200])
        rc, out = run_py("scripts/build_scorecard.py", ["--profile", tmp, "--output-dir", scorecard_out, "--strict"])
        check("A/T1.4", "严格评分门禁拦截未覆盖评分点",
              rc == 1 and "正式提交门禁失败" in out, out[:260])
        evidence_request_out = tmp + ".evidence-request.json"
        rc, out = run_py("scripts/build_evidence_request.py", [
            "--profile", tmp, "--scorecard", scorecard_json, "--out", evidence_request_out])
        request = load_json(evidence_request_out) if os.path.isfile(evidence_request_out) else {}
        check("A/T1.4", "评分缺口生成可执行证据补交清单",
              rc == 0 and request.get("gap_count", 0) > 0 and os.path.isfile(os.path.splitext(evidence_request_out)[0] + ".md"),
              out[:260])
        gate_report = tmp + ".gate.json"
        rc, out = run_py("scripts/final_gate.py", [
            "--profile", tmp, "--output-dir", scorecard_out, "--no-visual", "--report", gate_report])
        gate = load_json(gate_report) if os.path.isfile(gate_report) else {}
        check("A/T1.4", "最终门禁汇总所有步骤并保留失败证据",
              rc == 1 and gate.get("formal_ready") is False and len(gate.get("steps", [])) == 5,
              out[:260])
        rc, out = run_py("scripts/validate_evidence.py", [tmp, "--strict"])
        check("A/T1.4", "正式证据门禁拦截缺少原文/哈希/评分引用的结论",
              rc == 1 and "supporting_quote" in out and "content_hash" in out,
              out[:300])
        hash_evidence = tmp + ".evidence.txt"
        with io.open(hash_evidence, "w", encoding="utf-8") as f:
            f.write("真实来源摘录，用于哈希匹配负例校验。")
        c1 = full["evidence"]["claims"][0]
        c1.update({"supporting_quote": "真实来源摘录，用于哈希匹配负例校验。", "retrieved_at": "2026-10-05",
                   "content_hash": "0" * 64, "rubric_refs": ["解决真问题的程度：痛点是否真实、与现有方案对比优势"],
                   "output_refs": ["sample.docx"], "evidence_files": [hash_evidence]})
        with io.open(tmp, "w", encoding="utf-8") as f:
            json.dump(full, f, ensure_ascii=False)
        rc, out = run_py("scripts/validate_evidence.py", [tmp, "--strict"])
        check("A/T1.4", "严格门禁校验内容哈希与证据文件一致",
              rc == 1 and "SHA-256" in out, out[:320])
        c1["normalized_value"] = 10
        c1["value_unit"] = "人"
        full["evidence"]["claims"].append({
            "id": "c-conflict", "field": "project_name", "status": "real", "source_ids": ["s1"],
            "supporting_quote": "同一字段冲突负例来源摘录。", "retrieved_at": "2026-10-05",
            "content_hash": "0" * 64, "rubric_refs": ["解决真问题的程度：痛点是否真实、与现有方案对比优势"],
            "output_refs": ["sample.docx"], "evidence_files": [hash_evidence],
            "normalized_value": 12, "value_unit": "人",
        })
        with io.open(tmp, "w", encoding="utf-8") as f:
            json.dump(full, f, ensure_ascii=False)
        rc, out = run_py("scripts/validate_evidence.py", [tmp, "--strict"])
        check("A/T1.4", "严格门禁拦截同一字段跨来源数值冲突",
              rc == 1 and "矛盾" in out, out[:320])
        shutil.rmtree(scorecard_out, ignore_errors=True)

        # T1.5 deterministic catalogue-only competition matcher
        match_md = tmp + ".match.md"
        rc, out = run_py("scripts/match_competition.py",
                         ["--request", "数模国赛", "--markdown", match_md])
        try:
            matched = json.loads(out)
        except ValueError:
            matched = {}
        candidates = matched.get("candidates") or []
        check("A/T1.5", "赛事别名命中数学建模竞赛",
              rc == 0 and candidates and candidates[0].get("id") == 5 and candidates[0].get("confidence") == "high",
              out[:220])
        check("A/T1.5", "匹配结果带赛道与交付物预览",
              bool(candidates and candidates[0].get("recommended_track") and
                   candidates[0]["recommended_track"].get("deliverable_count", 0) >= 1))
        check("A/T1.5", "候选数最多 3 且生成 Markdown 审阅结果",
              len(candidates) <= 3 and os.path.isfile(match_md))
        rc, out = run_py("scripts/match_competition.py", ["--request", "火星殖民地竞赛方向"])
        try:
            unmatched = json.loads(out)
        except ValueError:
            unmatched = {}
        check("A/T1.5", "未知需求明确标记低置信度",
              rc == 0 and unmatched.get("top_confidence") == "low" and unmatched.get("warnings"), out[:220])
        runtime_path = tmp + ".runtime.json"
        rc, out = run_py("scripts/doctor.py", ["--out", runtime_path])
        runtime = load_json(runtime_path) if os.path.isfile(runtime_path) else {}
        check("A/T1.6", "环境自检生成真实运行记录",
              rc == 0 and os.path.isfile(runtime_path) and "capabilities" in runtime and "required_modules" in runtime,
              out[:220])
        check("A/T1.6", "环境自检不把可选能力冒充必需能力",
              all("available" in item for item in runtime.get("optional_modules", [])))
        low_out = tmp + ".low-context"
        round1_dir = os.path.join(os.path.dirname(ROOT), "ares-e2e", "round1")
        rc, out = run_py("scripts/smoke_low_context.py", [
            "--request", "数模国赛 A 题，生成论文和结果图表",
            "--project-dir", round1_dir,
            "--out", low_out,
        ])
        low_report = os.path.join(low_out, "smoke-report.json")
        low = load_json(low_report) if os.path.isfile(low_report) else {}
        check("A/T1.7", "低上下文状态/匹配/档案 smoke 通过",
              rc == 0 and low.get("passed") is True and len(low.get("steps", [])) >= 5,
              out[-300:])
        migration_path = tmp + ".migration.json"
        rc, out = run_py("scripts/migrate_profile.py", [
            "--profile", os.path.join(round1_dir, "project.json"), "--out", migration_path])
        migration = load_json(migration_path) if os.path.isfile(migration_path) else {}
        check("A/T1.8", "旧档案迁移报告完成且不虚报正式就绪",
              rc == 0 and migration.get("migration_complete") is True and migration.get("formal_ready") is False,
              out[-300:])
        state_guard_dir = tmp + ".state-guards"
        rc, out = run_py("scripts/run_state.py", ["init", "--project-dir", state_guard_dir, "--request", "状态机负例"])
        rc_skip, out_skip = run_py("scripts/run_state.py", ["advance", "--project-dir", state_guard_dir, "--stage", "profile", "--status", "done", "--evidence", "x"])
        rc_empty, out_empty = run_py("scripts/run_state.py", ["advance", "--project-dir", state_guard_dir, "--stage", "match", "--status", "done"])
        rc_ok, _ = run_py("scripts/run_state.py", ["advance", "--project-dir", state_guard_dir, "--stage", "match", "--status", "done", "--evidence", "match.md"])
        check("A/T1.9", "状态机拦截越级/空证据并允许合法推进",
              rc == 0 and rc_skip == 1 and rc_empty == 1 and rc_ok == 0,
              (out_skip + out_empty)[-300:])
    finally:
        for cleanup_path in (tmp, tmp + ".match.md", tmp + ".runtime.json", tmp + ".low-context", tmp + ".migration.json", tmp + ".evidence.txt", tmp + ".state-guards", tmp + ".evidence-request.json", tmp + ".evidence-request.md", tmp + ".gate.json"):
            if os.path.exists(cleanup_path):
                if os.path.isdir(cleanup_path):
                    shutil.rmtree(cleanup_path, ignore_errors=True)
                else:
                    os.unlink(cleanup_path)


# ---------------------------------------------------------------- 阶段C
def verify_C():
    print("阶段C 核心通用技能")
    # T3.1-T3.7 SKILL.md 齐备且含触发条件/步骤/输入/输出/自检/协作接口
    import re
    required_sections = ["触发", "执行步骤", "输入", "输出", "自检清单", "协作接口"]
    for sk in ("ares", "ares-writing-style", "ares-docx", "ares-ppt", "ares-data",
               "ares-prototype", "ares-judge"):
        p = os.path.join(ROOT, "skills", sk, "SKILL.md")
        ok = os.path.isfile(p)
        check("C/SKILL", "skills/%s/SKILL.md 存在" % sk, ok)
        if ok:
            txt = io.open(p, encoding="utf-8").read()
            missing = [s for s in required_sections if s not in txt]
            check("C/SKILL", "skills/%s 六要素齐全" % sk, not missing, "缺 %s" % missing)
            check("C/SKILL", "skills/%s 有 YAML frontmatter" % sk, txt.startswith("---"))

    tmpdir = workspace_mkdtemp()

    # T3.1 写作纪律机扫：违规/合规两份样张
    bad = io.open(os.path.join(tmpdir, "bad.md"), "w", encoding="utf-8")
    bad.write("首先市场很大。团队年轻有活力。如何解决？例如某某案例。填补空白。\n")
    bad.close()
    rc, out = run_py("skills/ares-writing-style/scripts/check_style.py", [os.path.join(tmpdir, "bad.md")])
    check("C/T3.1", "违规样张被拦截（exit 1）", rc == 1, "rc=%d" % rc)
    good = io.open(os.path.join(tmpdir, "good.md"), "w", encoding="utf-8")
    good.write("市场过去三年保持 18% 的年均增速（艾媒咨询，2025）。成本下降 62%。\n")
    good.close()
    rc, out = run_py("skills/ares-writing-style/scripts/check_style.py", [os.path.join(tmpdir, "good.md")])
    check("C/T3.1", "合规样张通过（exit 0）", rc == 0, out[:120])
    skill_txt = io.open(os.path.join(ROOT, "skills/ares-writing-style/SKILL.md"), encoding="utf-8").read()
    check("C/T3.1", "写作纪律含 3 组违规→修正对照", skill_txt.count("违规：") >= 3 and skill_txt.count("修正：") >= 3)
    for w in ("首先", "其次", "填补空白", "例如"):
        if w not in skill_txt:
            check("C/T3.1", "附录一条款覆盖 %s" % w, False)

    # T3.3 docx 样例
    sample_docx = os.path.join(tmpdir, "样例.docx")
    rc, out = run_py("skills/ares-docx/scripts/make_docx.py", [sample_docx])
    check("C/T3.3", "make_docx.py 生成样张", rc == 0 and os.path.isfile(sample_docx), out[:150])
    if os.path.isfile(sample_docx):
        from docx import Document
        d = Document(sample_docx)
        xml = d.element.xml
        check("C/T3.3", "含自动目录域", "TOC" in xml)
        check("C/T3.3", "页眉页脚页码域", "PAGE" in d.sections[0].footer._element.xml)
        check("C/T3.3", "图表编号体系", any("图2-1" in p.text for p in d.paragraphs) and len(d.tables) >= 1)
        check("C/T3.3", "样张含真实内嵌图片", len(d.inline_shapes) >= 1 and
              not any("此处插入图片" in p.text for p in d.paragraphs))
        check("C/T3.3", "内嵌图片含替代文字", bool(d.inline_shapes and
              d.inline_shapes[0]._inline.docPr.get("descr")))

    # T3.4 PPT 21页/16:9/原生图表/字体统一
    profile = {
        "project_name": "验收测试项目", "one_liner": "一句话", "slogan": "测试口号",
        "competition": {"id": 1, "name": "中国国际大学生创新大赛", "level": "A1", "track": "高教主赛道"},
        "team": [{"name": "张%d" % i, "role": "角色%d" % i, "contribution": "贡献%d" % i} for i in range(5)],
        "market": {"tam": "2800亿元（2025）", "sam": "340亿元", "som": "12亿元", "growth": "年增25%", "sources": ["艾媒咨询 2025"]},
        "policy": [{"name": "政策A", "benefit": "条款"}],
        "pain_points": [{"desc": "痛点%d" % i, "mapped_feature": "功能%d" % i} for i in range(4)],
        "solution": {"features": ["功能一", "功能二", "功能三"], "tech_stack": ["AI"],
                     "innovations": ["创新点"], "performance_metrics": [{"metric": "准确率", "value": "96.5%"}]},
            "business_model": {"revenue_streams": [{"stream": "硬件", "share_pct": 60},
                                                     {"stream": "订阅", "share_pct": 40}],
                                "pricing": {}, "costs": []},
        "competitors": [{"name": "竞品A"}, {"name": "竞品B"}],
        "advantages": ["优势1"], "milestones": [{"time": "2025", "event": "启动"}],
        "achievements": {"patents": ["p1", "p2"], "papers": [], "pilots": ["社区试点A", "社区试点B", "社区试点C"], "awards": [], "partners": []},
        "social_value": {"employment": "30人", "education": "基地1", "others": []},
        "financials": {"revenue_start_wan": 200, "growth_rate_range": "25%-40%", "margin_ratio_vs_industry": "1.2", "years": 6},
        "data_confidence": {"real": [], "estimated": [], "placeholder": []},
    }
    prof_path = os.path.join(tmpdir, "project.json")
    with io.open(prof_path, "w", encoding="utf-8") as f:
        json.dump(profile, f, ensure_ascii=False)
    ppt_path = os.path.join(tmpdir, "test.pptx")
    rc, out = run_py("skills/ares-ppt/scripts/build_ppt.py", ["--profile", prof_path, "--out", ppt_path])
    check("C/T3.4", "build_ppt.py 渲染成功", rc == 0 and os.path.isfile(ppt_path), out[-200:])
    if os.path.isfile(ppt_path):
        from pptx import Presentation
        prs = Presentation(ppt_path)
        check("C/T3.4", "21 页", len(prs.slides) == 21, "实际 %d" % len(prs.slides))
        check("C/T3.4", "16:9", abs(prs.slide_width / prs.slide_height - 16 / 9) < 0.01)
        n_charts = sum(1 for s in prs.slides for sh in s.shapes if sh.has_chart)
        check("C/T3.4", "原生图表 ≥3", n_charts >= 3, "实际 %d" % n_charts)
        fonts = {r.font.name for s in prs.slides for sh in s.shapes
                 if sh.has_text_frame for pa in sh.text_frame.paragraphs for r in pa.runs if r.font.name}
        check("C/T3.4", "字体统一微软雅黑", fonts == {"微软雅黑"}, str(fonts))
        with zipfile.ZipFile(ppt_path) as package:
            chart_xml = "\n".join(package.read(n).decode("utf-8") for n in package.namelist()
                                      if n.startswith("ppt/charts/") and n.endswith(".xml"))
        axis_vals = [int(v) for v in re.findall(r"<(?:c:)?(?:axId|crossAx)\s+val=\"(-?\d+)\"", chart_xml)]
        check("C/T3.4", "OpenXML 图表轴 ID 为无符号整数", bool(axis_vals) and all(v >= 0 for v in axis_vals), str(axis_vals[:4]))

        mixed_outline = os.path.join(tmpdir, "mixed.json")
        with io.open(mixed_outline, "w", encoding="utf-8") as f:
            json.dump([{"layout": "chart_bar", "title": "混量纲测试", "categories": ["准确率%", "响应秒", "成本元"],
                        "series_name": "值", "values": [96.5, 3.2, 599]}], f, ensure_ascii=False)
        mixed_ppt = os.path.join(tmpdir, "mixed.pptx")
        rc, out = run_py("skills/ares-ppt/scripts/build_ppt.py",
                         ["--profile", prof_path, "--outline", mixed_outline, "--out", mixed_ppt])
        check("C/T3.4", "混量纲柱状图被默认门禁拦截", rc == 1 and "混合量纲" in out, out[-240:])

    # T3.4 数据同步：改营收重渲染，财务页图表值变化
    profile["financials"]["revenue_start_wan"] = 250
    with io.open(prof_path, "w", encoding="utf-8") as f:
        json.dump(profile, f, ensure_ascii=False)
    ppt2 = os.path.join(tmpdir, "test2.pptx")
    rc, _ = run_py("skills/ares-ppt/scripts/build_ppt.py", ["--profile", prof_path, "--out", ppt2])
    from pptx import Presentation
    prs1, prs2 = Presentation(ppt_path), Presentation(ppt2)

    def line_series(prs):
        for s in prs.slides:
            for sh in s.shapes:
                if sh.has_chart and sh.chart.chart_type is not None and "LINE" in str(sh.chart.chart_type):
                    ser = list(sh.chart.plots[0].series)[0]
                    return list(ser.values)
        return None
    v1, v2 = line_series(prs1), line_series(prs2)
    check("C/T3.4", "改档案营收重渲染后 PPT 同步变化", rc == 0 and v1 and v2 and v1 != v2,
          "%s vs %s" % (v1 and v1[:2], v2 and v2[:2]))

    # T3.5 数据管线可复现
    demo1 = os.path.join(tmpdir, "demo1")
    demo2 = os.path.join(tmpdir, "demo2")
    rc1, _ = run_py("skills/ares-data/scripts/demo_pipeline.py", [demo1])
    rc2, _ = run_py("skills/ares-data/scripts/demo_pipeline.py", [demo2])
    s1 = io.open(os.path.join(demo1, "stats.json"), encoding="utf-8").read() if rc1 == 0 else ""
    s2 = io.open(os.path.join(demo2, "stats.json"), encoding="utf-8").read() if rc2 == 0 else ""
    check("C/T3.5", "数据管线重跑结果一致", rc1 == 0 and rc2 == 0 and s1 == s2)
    check("C/T3.5", "图表 png+svg 产出",
          os.path.isfile(os.path.join(demo1, "charts", "fig1_scatter.png")) and
          os.path.isfile(os.path.join(demo1, "charts", "fig1_scatter.svg")))

    # T3.6 原型扫描器：合规/违规两套样例
    ok_site = os.path.join(tmpdir, "ok_site")
    os.makedirs(os.path.join(ok_site, "pages"))
    with io.open(os.path.join(ok_site, "index.html"), "w", encoding="utf-8") as f:
        f.write('<a href="pages/list.html">列表</a><button id="go" onclick="x()">go</button>'
                '<button class="js-act">act</button>')
    with io.open(os.path.join(ok_site, "pages", "list.html"), "w", encoding="utf-8") as f:
        f.write('<a href="../index.html">首页</a><button id="del" onclick="y()">del</button>')
    with io.open(os.path.join(ok_site, "assets.js"), "w", encoding="utf-8") as f:
        f.write("document.querySelectorAll('.js-act').forEach(function(b){b.addEventListener('click',function(){})});")
    rc, out = run_py("skills/ares-prototype/scripts/scan_prototype.py", [ok_site])
    check("C/T3.6", "合规原型扫描通过", rc == 0, out[:200])
    if __import__("importlib.util").util.find_spec("playwright"):
        smoke_out = os.path.join(tmpdir, "ok_smoke")
        rc, out = run_py("skills/ares-prototype/scripts/smoke_prototype.py", [ok_site, "--out", smoke_out])
        if rc == 2 and "环境受限" in out:
            check("C/T3.6", "Playwright 原型运行时冒烟（当前执行环境受限，未宣称通过）", True)
        else:
            check("C/T3.6", "Playwright 原型运行时冒烟通过", rc == 0 and os.path.isfile(os.path.join(smoke_out, "smoke-manifest.json")), out[:200])
    else:
        check("C/T3.6", "Playwright 原型运行时冒烟（可选依赖未安装）", True)
    bad_site = os.path.join(tmpdir, "bad_site")
    os.makedirs(bad_site)
    with io.open(os.path.join(bad_site, "index.html"), "w", encoding="utf-8") as f:
        f.write('<a href="">x</a><a href="missing.html">y</a><button>free</button>')
    rc, out = run_py("skills/ares-prototype/scripts/scan_prototype.py", [bad_site])
    check("C/T3.6", "死链死按钮被拦截", rc == 1, out[:200])

    # T3.7 一致性扫描：零误报 + 抓 3 处埋雷（营收恢复 200 与文档一致）
    profile["financials"]["revenue_start_wan"] = 200
    with io.open(prof_path, "w", encoding="utf-8") as f:
        json.dump(profile, f, ensure_ascii=False)
    clean_md = os.path.join(tmpdir, "clean.md")
    with io.open(clean_md, "w", encoding="utf-8") as f:
        f.write("项目由 5 人团队组成，拥有 2 项专利，已在 3 个社区完成试点。"
                "首个社区试点覆盖 32 户家庭。识别准确率达到 96.5%，起始年营收 200 万元，TAM 总市场规模 2800 亿元。\n")
    rc, out = run_py("scripts/consistency_check.py", [clean_md, "--profile", prof_path])
    check("C/T3.7", "一致文档零矛盾", rc == 0, out[:300])
    mine_md = os.path.join(tmpdir, "mine.md")
    with io.open(mine_md, "w", encoding="utf-8") as f:
        f.write("本项目由 9 人团队组成。拥有 5 项专利。识别准确率 91.2%。\n")
    rc, out = run_py("scripts/consistency_check.py", [mine_md, "--profile", prof_path])
    n_found = out.count("✗")
    check("C/T3.7", "埋入 3 处数字矛盾全部发现", rc == 1 and n_found == 3, "检出 %d" % n_found)

    # 财务三表勾稽
    fin_xlsx = os.path.join(tmpdir, "财务三表.xlsx")
    rc, out = run_py("scripts/build_financials.py", ["--profile", prof_path, "--out", fin_xlsx])
    check("C/财务", "build_financials.py 勾稽校验通过", rc == 0 and os.path.isfile(fin_xlsx), out[-200:])

    round1 = os.path.join(os.path.dirname(ROOT), "ares-e2e", "round1", "输出", "银龄守护智能跌倒监测系统")
    rc, out = run_py("scripts/audit_visuals.py", [
        "--docx", os.path.join(round1, "01-商业计划书.docx"),
        "--pptx", os.path.join(round1, "03-路演PPT.pptx"),
        "--pipeline", "L1",
        "--prototype-dir", os.path.join(round1, "04-项目原型"),
        "--strict",
    ])
    check("C/视觉", "Word/PPT/原型视觉覆盖审计通过", rc == 0 and "formal_ready=True" in out, out[-300:])

    import shutil
    shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------------------------------------------------- 阶段D/E
def verify_D():
    print("阶段D 六线三模块")
    required_sections = ["触发", "执行步骤", "输入", "输出", "自检清单", "协作接口"]
    lines = {
        "ares-entrepreneurship": ["references/bp-outline.md", "references/financial-params.md"],
        "ares-modeling": [],
        "ares-engineering": [],
        "ares-business-case": [],
        "ares-art-design": [],
        "ares-coding-contest": [],
        "ares-humanities": [],
        "ares-lab-skills": [],
        "ares-simulation": [],
    }
    for sk, refs in lines.items():
        p = os.path.join(ROOT, "skills", sk, "SKILL.md")
        ok = os.path.isfile(p)
        check("D/T4", "skills/%s/SKILL.md 存在" % sk, ok)
        if ok:
            txt = io.open(p, encoding="utf-8").read()
            missing = [s for s in required_sections if s not in txt]
            check("D/T4", "skills/%s 六要素齐全" % sk, not missing, "缺 %s" % missing)
            check("D/T4", "skills/%s 有 frontmatter" % sk, txt.startswith("---"))
            check("D/T4", "skills/%s 引用写作纪律" % sk, "ares-writing-style" in txt)
        for ref in refs:
            check("D/T4", "%s/%s 存在" % (sk, ref), os.path.isfile(os.path.join(ROOT, "skills", sk, ref)))
    bp = io.open(os.path.join(ROOT, "skills/ares-entrepreneurship/references/bp-outline.md"), encoding="utf-8").read()
    for major in ("一、摘要", "二、公司介绍", "三、产品介绍", "四、核心技术", "五、市场分析",
                  "六、运营管理", "七、营销战略", "八、财务融资", "九、风险分析", "十、项目价值"):
        check("D/T4.1", "BP大纲含 %s" % major, major in bp)


def verify_E():
    print("阶段E 外围组件")
    commands = ["ares-start", "ares-bp", "ares-ppt", "ares-prototype", "ares-review", "ares-sync"]
    for c in commands:
        p = os.path.join(ROOT, "commands", c + ".md")
        ok = os.path.isfile(p)
        check("E/T5.1", "commands/%s.md 存在" % c, ok)
        if ok:
            txt = io.open(p, encoding="utf-8").read()
            check("E/T5.1", "%s 含触发示例" % c, "示例" in txt)
            check("E/T5.1", "%s 含参数说明" % c, "参数" in txt or "输入" in txt)
    for a in ("researcher", "writer", "engineer", "analyst", "reviewer"):
        p = os.path.join(ROOT, "agents", a + ".md")
        ok = os.path.isfile(p)
        check("E/T5.2", "agents/%s.md 存在" % a, ok)
        if ok:
            txt = io.open(p, encoding="utf-8").read()
            for kw in ("角色", "输入", "输出", "交接"):
                check("E/T5.2", "%s 含%s" % (a, kw), kw in txt)
    hook = os.path.join(ROOT, "hooks", "on-project-init.md")
    check("E/T5.3", "hooks/on-project-init.md 存在", os.path.isfile(hook))
    if os.path.isfile(hook):
        txt = io.open(hook, encoding="utf-8").read()
        check("E/T5.3", "hook 含手动指令等价说明", "手动" in txt or "不支持" in txt)


STAGES = {"A": verify_A, "C": verify_C, "D": verify_D, "E": verify_E}


def main(argv):
    targets = list(STAGES) if (not argv or argv[0] == "all") else argv
    shutil.rmtree(WORK_TMP, ignore_errors=True)
    try:
        for t in targets:
            fn = STAGES.get(t.upper())
            if not fn:
                print("未知阶段 %s" % t)
                continue
            fn()
        print()
        if FAILURES:
            print("共 %d 项失败：" % len(FAILURES))
            for f in FAILURES:
                print("  - " + f)
            return 1
        print("所验阶段全部通过。")
        return 0
    finally:
        shutil.rmtree(WORK_TMP, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
