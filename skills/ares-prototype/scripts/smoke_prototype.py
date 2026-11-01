# -*- coding: utf-8 -*-
"""Run a lightweight browser smoke test for a local Ares prototype.

This is an optional runtime layer on top of scan_prototype.py. It uses the
official Playwright Python API when installed, reuses an existing Chrome/Edge
binary when Playwright-managed browsers are unavailable, records console/page
errors, and captures a small evidence manifest. It never contacts remote URLs
unless a prototype explicitly requests them.

Usage:
    python smoke_prototype.py <prototype_dir> --out smoke
"""
import argparse
import io
import json
import os
import shutil
import sys
from urllib.parse import urljoin

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


def _browser_executable():
    candidates = [
        shutil.which("chrome"), shutil.which("msedge"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    return next((p for p in candidates if p and os.path.isfile(p)), None)


def _pages(root):
    return sorted(
        os.path.relpath(os.path.join(base, name), root).replace("\\", "/")
        for base, _dirs, names in os.walk(root)
        for name in names if name.lower().endswith(".html")
    )


def smoke(root, out_dir):
    if sync_playwright is None:
        raise RuntimeError("运行时冒烟需要可选依赖 playwright；先运行 pip install playwright")
    root = os.path.abspath(root)
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    pages = _pages(root)
    if not pages:
        raise RuntimeError("原型目录没有 HTML 页面")
    results = []
    with sync_playwright() as p:
        browser = None
        launch_error = None
        try:
            # Use a workspace-owned profile. The managed Codex runtime may
            # deny writes to the OS temp directory used by Playwright's
            # default launch path.
            browser = p.chromium.launch_persistent_context(
                user_data_dir=out_dir, headless=True,
                viewport={"width": 1440, "height": 900})
        except Exception as exc:
            launch_error = exc
            executable = _browser_executable()
            if executable:
                browser = p.chromium.launch_persistent_context(
                    user_data_dir=out_dir, headless=True, executable_path=executable,
                    viewport={"width": 1440, "height": 900})
            else:
                raise RuntimeError("Playwright 浏览器不可用：%s" % exc)
        try:
            for rel in pages:
                errors = []
                console_errors = []
                page = browser.new_page()
                page.on("pageerror", lambda exc: errors.append(str(exc)))
                page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
                target = "file:///" + os.path.abspath(os.path.join(root, rel)).replace("\\", "/")
                response = page.goto(target, wait_until="load", timeout=15000)
                page.wait_for_timeout(250)
                title = page.title()
                body_text = page.locator("body").inner_text(timeout=5000).strip()
                screenshot = os.path.join(out_dir, rel.replace("/", "_") + ".png")
                page.screenshot(path=screenshot, full_page=True)
                results.append({
                    "page": rel,
                    "title": title,
                    "body_chars": len(body_text),
                    "http_status": response.status if response else None,
                    "page_errors": errors,
                    "console_errors": console_errors,
                    "screenshot": os.path.relpath(screenshot, out_dir).replace("\\", "/"),
                    "status": "pass" if body_text and not errors and not console_errors else "fail",
                })
                page.close()
        finally:
            browser.close()
    manifest = {
        "schema_version": "1.0",
        "root": root,
        "browser": "playwright",
        "browser_fallback": bool(launch_error),
        "pages": results,
        "passed": all(item["status"] == "pass" for item in results),
    }
    path = os.path.join(out_dir, "smoke-manifest.json")
    with io.open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return manifest


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("prototype_dir")
    ap.add_argument("--out", default=None)
    args = ap.parse_args(argv)
    root = os.path.abspath(args.prototype_dir)
    out = os.path.abspath(args.out or os.path.join(root, "smoke"))
    try:
        manifest = smoke(root, out)
    except PermissionError as exc:
        print("原型运行时冒烟环境受限：%s" % exc)
        return 2
    except (OSError, RuntimeError) as exc:
        print("原型运行时冒烟失败：%s" % exc)
        return 1
    print("原型运行时冒烟：%d 个页面，结果=%s" % (len(manifest["pages"]), "PASS" if manifest["passed"] else "FAIL"))
    print("清单：%s" % os.path.join(out, "smoke-manifest.json"))
    return 0 if manifest["passed"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
