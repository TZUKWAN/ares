# -*- coding: utf-8 -*-
"""Render DOCX through Microsoft Word on Windows for independent QA.

Exports a PDF with Word's own layout engine and verifies that a non-empty PDF
was produced. LibreOffice-based renderers remain useful on other platforms,
but this gives Windows users a real Word import/render gate.
"""
import argparse
import os
import sys


def render(input_path, pdf_path):
    if os.name != "nt":
        raise RuntimeError("render_docx.py 需要 Windows Word")
    try:
        import win32com.client
    except ImportError as exc:
        raise RuntimeError("缺少 pywin32，无法启动 Word 独立渲染") from exc
    input_path = os.path.abspath(input_path)
    pdf_path = os.path.abspath(pdf_path)
    if not os.path.isfile(input_path):
        raise FileNotFoundError(input_path)
    os.makedirs(os.path.dirname(pdf_path) or ".", exist_ok=True)
    app = win32com.client.DispatchEx("Word.Application")
    doc = None
    try:
        try:
            app.Visible = False
            app.DisplayAlerts = 0
        except Exception:
            pass
        doc = app.Documents.Open(input_path, ReadOnly=True, AddToRecentFiles=False)
        # wdExportFormatPDF = 17
        doc.ExportAsFixedFormat(pdf_path, 17, False, 0, 0, 0, 0, 0, True, True, 1, True, True, False)
    finally:
        if doc is not None:
            try:
                doc.Close(False)
            except Exception:
                pass
        try:
            app.Quit()
        except Exception:
            # Word can already have torn down its COM server after export;
            # the PDF existence check below remains the authoritative gate.
            pass
    if not os.path.isfile(pdf_path) or os.path.getsize(pdf_path) == 0:
        raise RuntimeError("Word 未生成有效 PDF：%s" % pdf_path)
    return pdf_path


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("pdf")
    args = ap.parse_args(argv[1:])
    print("Word 独立渲染通过：%s" % render(args.input, args.pdf))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
