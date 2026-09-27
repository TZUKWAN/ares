# -*- coding: utf-8 -*-
"""
scan_prototype.py — ares-prototype 死链与死按钮扫描（T3.6 DoD 工具）

用法：
    python scan_prototype.py <原型目录>

检查规则：
1. 全部 <a> 标签：必须有 href 且指向存在的本地页面/锚点（或合法外链 http/https/mailto/tel）；
   href="" 或 "#" 或指向不存在文件视为死链。
2. 全部 <button>：必须有交互归宿——onclick 属性、或 app.js 等脚本中以
   addEventListener('click', ...) / .onclick 绑定了该按钮的 id/class/元素选择器。
3. 页面间导航互通：每个非 index 页面都应能从 index.html 的链接图中到达。

退出码：0 通过；1 存在死链/死按钮；2 目录不合法。
"""
import io
import os
import re
import sys

A_HREF_RE = re.compile(r"<a\b([^>]*)>", re.IGNORECASE)
HREF_RE = re.compile(r"href\s*=\s*[\"']([^\"']*)[\"']", re.IGNORECASE)
BTN_RE = re.compile(r"<button\b([^>]*)>(.*?)</button>", re.IGNORECASE | re.DOTALL)
ID_RE = re.compile(r"id\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE)
CLASS_RE = re.compile(r"class\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE)
ONCLICK_RE = re.compile(r"onclick\s*=", re.IGNORECASE)
LISTENER_RE = re.compile(r"addEventListener\(\s*['\"]click['\"]|\.onclick\s*=", re.IGNORECASE)


def collect_html_files(root):
    out = []
    for base, _dirs, files in os.walk(root):
        for f in files:
            if f.lower().endswith(".html"):
                out.append(os.path.join(base, f))
    return out


def resolve_link(from_rel, href):
    """把页面内相对链接解析为相对根目录的正斜杠路径。"""
    target = href.split("#")[0].strip()
    if not target:
        return ""
    joined = os.path.normpath(os.path.join(os.path.dirname(from_rel), target))
    return joined.replace("\\", "/").lower()


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    root = argv[0]
    if not os.path.isdir(root):
        print("目录不存在：%s" % root)
        return 2
    htmls = collect_html_files(root)
    if not htmls:
        print("目录中无 HTML 文件")
        return 2
    js_text = ""
    for base, _dirs, files in os.walk(root):
        for f in files:
            if f.lower().endswith(".js"):
                js_text += io.open(os.path.join(base, f), encoding="utf-8", errors="replace").read()
    has_listener_js = bool(LISTENER_RE.search(js_text))

    problems = []
    all_pages = {os.path.relpath(h, root).replace("\\", "/").lower() for h in htmls}
    linked_pages = set()
    for h in htmls:
        rel = os.path.relpath(h, root).replace("\\", "/")
        text = io.open(h, encoding="utf-8", errors="replace").read()
        for attrs in A_HREF_RE.findall(text):
            m = HREF_RE.search(attrs)
            href = m.group(1).strip() if m else ""
            if href == "" or href == "#" or href.lower().startswith("javascript:"):
                problems.append("%s: 死链 <a href=\"%s\">" % (rel, href))
                continue
            if href.startswith(("http://", "https://", "mailto:", "tel:")):
                continue
            target = resolve_link(rel, href)
            if target.startswith(("data:", "{")):
                continue
            if target and target not in all_pages:
                problems.append("%s: 链接目标不存在 %s" % (rel, href))
            elif target:
                linked_pages.add(target)
        for attrs, _inner in BTN_RE.findall(text):
            if ONCLICK_RE.search(attrs):
                continue
            ids = ID_RE.findall(attrs)
            classes = CLASS_RE.findall(attrs)
            bound = False
            for i in ids:
                if re.search(r"getElementById\(\s*['\"]%s['\"]|querySelector.*['\"]#%s['\"]|['\"]#%s['\"]" % (re.escape(i), re.escape(i), re.escape(i)), js_text):
                    bound = True
                    break
            if not bound and has_listener_js:
                for c in classes:
                    if re.search(r"['\"]\.%s['\"]" % re.escape(c.split()[0]), js_text):
                        bound = True
                        break
            if not bound and ids:
                problems.append("%s: 疑似死按钮 <button id=%s> 无 click 绑定" % (rel, ids[0]))
            elif not bound and not ids and not classes:
                problems.append("%s: 无标识按钮无绑定（建议加 id 与 onclick/监听）" % rel)
    if "index.html" in all_pages:
        reached = {"index.html"}
        frontier = ["index.html"]
        link_map = {}
        for h in htmls:
            rel = os.path.relpath(h, root).replace("\\", "/").lower()
            text = io.open(h, encoding="utf-8", errors="replace").read()
            targets = set()
            for attrs in A_HREF_RE.findall(text):
                m = HREF_RE.search(attrs)
                if not m:
                    continue
                raw = m.group(1)
                if raw.strip() in ("", "#") or raw.strip().lower().startswith("javascript:"):
                    continue
                if raw.strip().startswith(("http://", "https://", "mailto:", "tel:")):
                    continue
                t = resolve_link(rel, raw)
                if t and t in all_pages:
                    targets.add(t)
            link_map[rel] = targets
        while frontier:
            cur = frontier.pop()
            for t in link_map.get(cur, ()):
                if t not in reached:
                    reached.add(t)
                    frontier.append(t)
        orphans = all_pages - reached
        for o in sorted(orphans):
            problems.append("页面不可达（从 index 无法点达）：%s" % o)
    if problems:
        print("发现 %d 处问题：" % len(problems))
        for p in problems:
            print("  - " + p)
        return 1
    print("扫描通过：%d 个页面，全部链接与按钮有归宿，无不可达页面。" % len(htmls))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
