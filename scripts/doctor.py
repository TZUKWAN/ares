# -*- coding: utf-8 -*-
"""Ares runtime capability check for low-context model handoff.

The command reports what is actually available on this machine. Optional
features remain explicit so a weaker model can choose a stable fallback.

Usage:
    python doctor.py
    python doctor.py --out ares-runtime.json
    python doctor.py --strict
"""
import argparse
import importlib.util
import io
import json
import os
import platform
import shutil
import sys
from datetime import datetime, timezone


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _module(name):
    return {"name": name, "available": importlib.util.find_spec(name) is not None}


def _which(names):
    for name in names:
        path = shutil.which(name)
        if path:
            return path
    return ""


def _file(rel):
    path = os.path.join(ROOT, rel)
    return {"path": rel.replace("\\", "/"), "exists": os.path.isfile(path)}


def _com_available(progid):
    if platform.system() != "Windows" or importlib.util.find_spec("win32com") is None:
        return False
    try:
        import win32com.client
        app = win32com.client.DispatchEx(progid)
        try:
            app.Visible = False
        except Exception:
            pass
        try:
            app.Quit()
        except Exception:
            pass
        return True
    except Exception:
        return False


def collect():
    required_modules = [_module(x) for x in ("docx", "pptx", "openpyxl")]
    optional_modules = [_module(x) for x in ("playwright", "markitdown", "win32com")]
    com = {"word": _com_available("Word.Application"),
           "powerpoint": _com_available("PowerPoint.Application")}
    executables = {
        "python": sys.executable,
        "word": _which(("WINWORD.EXE", "winword")),
        "powerpoint": _which(("POWERPNT.EXE", "powerpnt")),
        "libreoffice": _which(("soffice.exe", "soffice")),
        "chrome": _which(("chrome.exe", "chrome")),
        "edge": _which(("msedge.exe", "msedge")),
    }
    required_files = [_file(x) for x in (
        "plugin.json", "commands/ares.md", "scripts/run_state.py",
        "scripts/build_scorecard.py", "scripts/validate_profile.py",
        "scripts/validate_evidence.py",
    )]
    return {
        "schema_version": "1.0",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "platform": {"system": platform.system(), "release": platform.release(), "python": platform.python_version()},
        "required_modules": required_modules,
        "optional_modules": optional_modules,
        "executables": executables,
        "com_probes": com,
        "required_files": required_files,
        "capabilities": {
            "docx_generation": all(x["available"] for x in required_modules[:1]),
            "pptx_generation": all(x["available"] for x in required_modules[1:2]),
            "xlsx_generation": all(x["available"] for x in required_modules[2:3]),
            "prototype_runtime_smoke": next(x["available"] for x in optional_modules if x["name"] == "playwright"),
            "markitdown_ingest": next(x["available"] for x in optional_modules if x["name"] == "markitdown"),
            "word_com_render": com["word"],
            "powerpoint_com_render": com["powerpoint"],
            "libreoffice_render": bool(executables["libreoffice"]),
        },
    }


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="")
    parser.add_argument("--strict", action="store_true", help="required modules/files must be available")
    args = parser.parse_args(argv)
    result = collect()
    if args.out:
        out = os.path.abspath(args.out)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with io.open(out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("已生成：%s" % out)
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    required_ok = all(x["available"] for x in result["required_modules"]) and all(x["exists"] for x in result["required_files"])
    if args.strict and not required_ok:
        print("Ares 必需能力不完整。")
        return 1
    print("Ares 环境自检完成：必需能力=%s；可选能力=%s" % (
        "可用" if required_ok else "缺失",
        ", ".join("%s=%s" % (k, "可用" if v else "不可用") for k, v in result["capabilities"].items()),
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
