# -*- coding: utf-8 -*-
"""Capture local prototype pages into PPT-ready screenshot assets.

Usage:
    python capture_prototype.py <prototype_dir> [--out screenshots]
    python capture_prototype.py <prototype_dir> --pages index.html alerts.html result.html

The tool is offline: it only opens local file:// pages. A local Chrome/Edge
binary is required; missing browsers fail loudly instead of producing fake
placeholder images.
"""
import argparse
import os
import shutil
import subprocess
import tempfile
import time

try:
    from PIL import Image
except ImportError:
    Image = None


def _browser():
    candidates = [
        shutil.which("chrome"), shutil.which("msedge"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    return next((p for p in candidates if p and os.path.isfile(p)), None)


def capture(prototype_dir, out_dir, pages):
    browser = _browser()
    if not browser:
        raise RuntimeError("未找到 Chrome/Edge，无法捕获原型截图")
    if Image is None:
        raise RuntimeError("捕获原型截图需要 Pillow")
    os.makedirs(out_dir, exist_ok=True)
    profile_dir = tempfile.mkdtemp(prefix="ares-capture-")
    try:
        outputs = []
        for index, page in enumerate(pages, 1):
            source = os.path.join(prototype_dir, page)
            if not os.path.isfile(source):
                raise FileNotFoundError("原型页面不存在：%s" % source)
            target = os.path.join(out_dir, "%02d-%s.png" % (index, os.path.splitext(os.path.basename(page))[0]))
            cmd = [browser, "--headless=new", "--disable-gpu", "--no-sandbox",
                   "--allow-file-access-from-files", "--hide-scrollbars",
                   "--window-size=1440,900", "--virtual-time-budget=1200",
                   "--user-data-dir=" + profile_dir, "--screenshot=" + target,
                   "file:///" + os.path.abspath(source).replace("\\", "/")]
            completed = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if completed.returncode != 0 or not os.path.isfile(target):
                raise RuntimeError("截图失败 %s：%s" % (page, completed.stderr[-500:]))
            with Image.open(target) as image:
                image.save(target, dpi=(300, 300))
            outputs.append(target)
        return outputs
    finally:
        shutil.rmtree(profile_dir, ignore_errors=True)


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("prototype_dir")
    ap.add_argument("--out", default=None)
    ap.add_argument("--pages", nargs="+", default=["index.html", "alerts.html", "result.html"])
    args = ap.parse_args(argv[1:])
    prototype_dir = os.path.abspath(args.prototype_dir)
    out_dir = os.path.abspath(args.out or os.path.join(prototype_dir, "screenshots"))
    outputs = capture(prototype_dir, out_dir, args.pages)
    print("已捕获 %d 张原型截图：" % len(outputs))
    for output in outputs:
        print("  " + output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(__import__("sys").argv))
