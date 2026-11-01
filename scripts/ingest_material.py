# -*- coding: utf-8 -*-
"""Ingest local competition materials into auditable Markdown evidence.

Uses Microsoft MarkItDown when the optional package is installed. Plain text,
Markdown, CSV and JSON use the local deterministic fallback, so the core Ares
workflow remains dependency-light. The script never enables third-party
plugins or calls a model during conversion.

Usage:
    python ingest_material.py <file> --out evidence.md
    python ingest_material.py <file> --out evidence.md --manifest source.json
"""
import argparse
import hashlib
import io
import json
import mimetypes
import os
import sys


TEXT_EXTS = {".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".xml", ".html"}


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _fallback(path):
    ext = os.path.splitext(path)[1].lower()
    if ext not in TEXT_EXTS:
        raise RuntimeError("该文件类型需要可选依赖 markitdown：%s" % ext)
    with io.open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def convert(path):
    try:
        from markitdown import MarkItDown
    except ImportError:
        return _fallback(path), "local-text-fallback"
    md = MarkItDown(enable_plugins=False)
    result = md.convert(path)
    text = getattr(result, "text_content", None)
    if not text:
        raise RuntimeError("MarkItDown 未返回文本内容")
    return text, "microsoft-markitdown"


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--out", required=True)
    ap.add_argument("--manifest", default=None)
    args = ap.parse_args(argv)
    source = os.path.abspath(args.file)
    if not os.path.isfile(source):
        print("资料不存在：%s" % source)
        return 2
    try:
        text, converter = convert(source)
    except (OSError, RuntimeError, ValueError) as exc:
        print("资料导入失败：%s" % exc)
        return 1
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with io.open(out, "w", encoding="utf-8") as f:
        f.write(text.rstrip() + "\n")
    manifest = {
        "schema_version": "1.0",
        "source_path": source,
        "output_path": out,
        "sha256": _sha256(source),
        "mime": mimetypes.guess_type(source)[0] or "application/octet-stream",
        "converter": converter,
        "plugins_enabled": False,
    }
    if args.manifest:
        manifest_path = os.path.abspath(args.manifest)
        os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
        with io.open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
            f.write("\n")
    print("资料导入通过：%s" % out)
    print("转换器：%s；SHA256：%s" % (converter, manifest["sha256"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
