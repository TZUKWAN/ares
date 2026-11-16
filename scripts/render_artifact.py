"""Bounded, read-only artifact rendering. Input/output JSON over stdio; no network."""
import base64
import io
import json
import sys


def main():
    request = json.load(sys.stdin)
    data = base64.b64decode(request["bytes"], validate=True)
    if len(data) > 64 * 1024 * 1024:
        raise ValueError("文档超过64MiB预览限制")
    operation = request["operation"]
    if operation in ("pdf-info", "pdf-page"):
        import fitz
        with fitz.open(stream=data, filetype="pdf") as document:
            if document.is_encrypted:
                raise ValueError("加密PDF需要先解密后再预览")
            if not 0 < document.page_count <= 600:
                raise ValueError("预览支持1至600页PDF")
            if operation == "pdf-info":
                return {"pageCount": document.page_count, "pages": [
                    {"width": round(page.rect.width, 2), "height": round(page.rect.height, 2)}
                    for page in document]}
            number = request.get("page", 1)
            if type(number) is not int or not 1 <= number <= document.page_count:
                raise ValueError("页码超出文档范围")
            page = document[number - 1]
            scale = request.get("scale", 1.5)
            if type(scale) not in (int, float) or not 0.5 <= scale <= 2:
                raise ValueError("缩放比例无效")
            # Bound page raster dimensions even for unusually large PDF pages.
            scale = min(scale, 2400 / max(page.rect.width, page.rect.height))
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            return {"png": base64.b64encode(pixmap.tobytes("png")).decode("ascii"),
                    "width": pixmap.width, "height": pixmap.height,
                    "text": page.get_text()[:30000]}
    extension = request.get("extension", "")
    if extension == "xlsx":
        import openpyxl
        workbook = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=False)
        try:
            sheets = []
            for sheet in workbook.worksheets[:12]:
                rows = []
                for row in sheet.iter_rows(min_row=1, max_row=min(sheet.max_row or 1, 250),
                                           max_col=min(sheet.max_column or 1, 40)):
                    rows.append([str(cell.value)[:4000] if cell.value is not None else "" for cell in row])
                sheets.append({"name": sheet.title, "rows": rows,
                               "rowCount": sheet.max_row, "columnCount": sheet.max_column,
                               "truncated": (sheet.max_row or 0) > 250 or (sheet.max_column or 0) > 40})
            return {"sheets": sheets, "truncated": len(workbook.worksheets) > 12}
        finally:
            workbook.close()
    if extension == "docx":
        from docx import Document
        document = Document(io.BytesIO(data))
        paragraphs = [paragraph.text for paragraph in document.paragraphs]
        tables = ["\n".join("\t".join(cell.text for cell in row.cells) for row in table.rows)
                  for table in document.tables]
        return {"text": "\n\n".join(paragraphs + tables)[:400000], "layout": False}
    if extension == "pptx":
        from pptx import Presentation
        presentation = Presentation(io.BytesIO(data))
        return {"text": "\n\n".join(
            f"第 {index + 1} 页\n" + "\n".join(shape.text for shape in slide.shapes if shape.has_text_frame)
            for index, slide in enumerate(presentation.slides))[:400000], "layout": False}
    raise ValueError("不支持此预览格式")


if __name__ == "__main__":
    try:
        result = main()
        sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))
    except Exception as error:
        sys.stdout.buffer.write(json.dumps({"error": str(error)}, ensure_ascii=False).encode("utf-8"))
        sys.exit(1)
