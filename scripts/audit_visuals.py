# -*- coding: utf-8 -*-
"""Audit Word/PPT visual coverage before Ares delivery.

This is a content gate, not an image generator. It reports real embedded
media, tables, charts, captions and demo evidence, then emits a small
pipeline-specific asset plan for the model to fill.

Usage:
    python audit_visuals.py --docx report.docx --pptx deck.pptx --pipeline L1
    python audit_visuals.py ... --prototype-dir 原型 --strict --out visual-audit.json
"""
import argparse
import io
import json
import os
import re
import sys
import zipfile


PLANS = {
    "L1": ["痛点/用户场景图", "产品架构或链路图", "市场/财务图表", "三步产品 Demo"],
    "L2": ["问题与假设流程图", "模型结果图", "敏感性/误差图", "结果对比表"],
    "L3": ["系统/机械结构图", "测试现场或样机图", "性能对比图", "操作演示或仿真"],
    "L4": ["调研流程图", "样本/分群图", "关键指标图表", "分析结论表"],
    "L5": ["设计概念图", "过程/方案对比图", "效果展示图", "作品展板或 Demo"],
    "L6": ["算法流程图", "复杂度/性能图", "代码或运行结果截图", "训练/答题计划表"],
    "E1": ["作品结构图", "关键段落/语言证据表", "展示页或演示图"],
    "E2": ["实验装置图", "操作流程图", "结果图表", "安全/记录表"],
    "E3": ["经营流程图", "决策指标图", "策略对比表", "模拟结果图"],
}


def _docx(path):
    from docx import Document
    doc = Document(path)
    paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    captions = [p for p in paragraphs if re.match(r"^(图|表)\s*[0-9一二三四五六七八九十]", p)]
    placeholders = [p for p in paragraphs if "此处插入图片" in p or "待插入" in p]
    return {
        "path": path,
        "exists": True,
        "images": len(doc.inline_shapes),
        "tables": len(doc.tables),
        "captions": len(captions),
        "placeholders": placeholders,
        "status": "pass" if doc.inline_shapes and doc.tables and not placeholders else "review",
    }


def _pptx(path):
    from pptx import Presentation
    prs = Presentation(path)
    image_count = 0
    chart_count = 0
    texts = []
    for slide in prs.slides:
        for shape in slide.shapes:
            if getattr(shape, "shape_type", None) == 13:  # PICTURE
                image_count += 1
            if getattr(shape, "has_chart", False):
                chart_count += 1
            if hasattr(shape, "text") and shape.text:
                texts.append(shape.text)
    with zipfile.ZipFile(path) as zf:
        media = [n for n in zf.namelist() if n.startswith("ppt/media/")]
    joined = "\n".join(texts)
    demo_markers = [x for x in ("demo", "原型", "演示", "样机", "截图") if x.lower() in joined.lower()]
    return {
        "path": path,
        "exists": True,
        "slides": len(prs.slides),
        "images": image_count,
        "media_files": len(media),
        "charts": chart_count,
        "demo_markers": demo_markers,
        "status": "pass" if image_count and demo_markers else "review",
    }


def audit(docx_path=None, pptx_path=None, pipeline="L1", prototype_dir=None, strict=False):
    result = {"schema_version": "1.0", "pipeline": pipeline, "recommended_visual_slots": PLANS.get(pipeline, PLANS["L1"]), "files": {}, "blocking_items": []}
    if docx_path:
        if not os.path.isfile(docx_path):
            result["blocking_items"].append("Word 文件不存在：%s" % docx_path)
        else:
            result["files"]["docx"] = _docx(docx_path)
            if strict:
                item = result["files"]["docx"]
                if item["images"] < 1:
                    result["blocking_items"].append("Word 没有真实内嵌图片")
                if item["tables"] < 1:
                    result["blocking_items"].append("Word 没有表格")
                if item["placeholders"]:
                    result["blocking_items"].append("Word 存在图片占位段落")
    if pptx_path:
        if not os.path.isfile(pptx_path):
            result["blocking_items"].append("PPT 文件不存在：%s" % pptx_path)
        else:
            result["files"]["pptx"] = _pptx(pptx_path)
            if strict and pipeline in {"L1", "L3", "L4", "L5"}:
                item = result["files"]["pptx"]
                if item["images"] < 3:
                    result["blocking_items"].append("PPT 图片少于 3 张，无法支撑产品/场景/演示叙事")
                if not item["demo_markers"]:
                    result["blocking_items"].append("PPT 没有可识别的产品演示/原型/样机标识")
    if prototype_dir:
        pages = []
        for base, _dirs, names in os.walk(prototype_dir):
            pages.extend(name for name in names if name.lower().endswith(".html"))
        result["prototype"] = {"path": prototype_dir, "html_pages": len(pages), "exists": os.path.isdir(prototype_dir)}
        if strict and (not pages or len(pages) < 3):
            result["blocking_items"].append("原型 Demo 页面少于 3 个")
    result["formal_ready"] = not result["blocking_items"]
    return result


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--docx")
    ap.add_argument("--pptx")
    ap.add_argument("--pipeline", default="L1")
    ap.add_argument("--prototype-dir")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--out")
    args = ap.parse_args(argv)
    if not any((args.docx, args.pptx, args.prototype_dir)):
        ap.error("至少提供 --docx、--pptx 或 --prototype-dir")
    try:
        result = audit(args.docx, args.pptx, args.pipeline, args.prototype_dir, args.strict)
        text = json.dumps(result, ensure_ascii=False, indent=2)
        if args.out:
            out = os.path.abspath(args.out)
            os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
            with io.open(out, "w", encoding="utf-8") as f:
                f.write(text + "\n")
            print("已生成：%s" % out)
        else:
            print(text)
        print("视觉审计：formal_ready=%s；阻断项=%d" % (result["formal_ready"], len(result["blocking_items"])))
        if result["blocking_items"]:
            for item in result["blocking_items"]:
                print("  - " + item)
        return 0 if result["formal_ready"] or not args.strict else 1
    except (OSError, ValueError, ImportError, zipfile.BadZipFile) as exc:
        print("视觉审计失败：%s" % exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
