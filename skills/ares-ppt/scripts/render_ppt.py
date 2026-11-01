# -*- coding: utf-8 -*-
"""Render a PPTX with the installed PowerPoint application on Windows.

This is the independent visual gate for Ares PPT output. It deliberately uses
PowerPoint's own importer rather than python-pptx, then exports every slide to
PNG and checks that the slide count is preserved.
"""
import argparse
import os
import sys


def render(input_path, output_dir):
    if os.name != "nt":
        raise RuntimeError("render_ppt.py 需要 Windows PowerPoint")
    try:
        import win32com.client
    except ImportError as exc:
        raise RuntimeError("缺少 pywin32，无法启动 PowerPoint 独立渲染") from exc
    input_path = os.path.abspath(input_path)
    output_dir = os.path.abspath(output_dir)
    if not os.path.isfile(input_path):
        raise FileNotFoundError(input_path)
    os.makedirs(output_dir, exist_ok=True)
    app = win32com.client.DispatchEx("PowerPoint.Application")
    presentation = None
    try:
        try:
            app.DisplayAlerts = 0
        except Exception:
            pass
        presentation = app.Presentations.Open(input_path, ReadOnly=True, WithWindow=False)
        slide_count = int(presentation.Slides.Count)
        presentation.Export(output_dir, "PNG")
        pngs = [name for name in os.listdir(output_dir) if name.lower().endswith(".png")]
        if len(pngs) != slide_count:
            raise RuntimeError("PowerPoint 导出页数不一致：期望 %d，实际 %d" % (slide_count, len(pngs)))
        return slide_count, sorted(os.path.join(output_dir, name) for name in pngs)
    finally:
        if presentation is not None:
            presentation.Close()
        app.Quit()


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output_dir")
    args = ap.parse_args(argv[1:])
    count, paths = render(args.input, args.output_dir)
    print("PowerPoint 独立渲染通过：%d 页" % count)
    print("输出目录：%s" % os.path.abspath(args.output_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
