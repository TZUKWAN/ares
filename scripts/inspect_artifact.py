"""Read actual artifact structure; stdout is JSON, no Office desktop automation."""
import argparse, csv, hashlib, io, json, os, subprocess, shutil, zipfile

STRUCTURED={'docx','pptx','xlsx','pdf','json','csv','tsv','mp4','mov','webm','mp3','wav','png','jpg','jpeg','webp','tiff','tif'}
ALIASES={'jpeg':'jpg','tif':'tiff','htm':'html'}

def check_office_budget(path):
    with zipfile.ZipFile(path) as package:
        files=package.infolist()
        if len(files)>4000 or sum(item.file_size for item in files)>128*1024*1024 or any(item.file_size>64*1024*1024 for item in files):
            raise ValueError('Office解压内容超过检查预算（4000项、单项64MiB、总计128MiB）')
        if any(item.flag_bits&1 for item in files):raise ValueError('不接受加密Office包作为可检查产物')

def csv_preview(path,delimiter):
    if os.path.getsize(path)>64*1024*1024:raise ValueError('数据表超过64MiB检查预算')
    def lines(stream):
        while True:
            line=stream.readline(4*1024*1024+1)
            if not line:return
            if len(line)>4*1024*1024:raise ValueError('数据表单行超过4MiB检查预算')
            yield line
    previous=csv.field_size_limit(1024*1024)
    try:
        with open(path,encoding='utf-8-sig',newline='') as stream:
            reader=csv.reader(lines(stream),delimiter=delimiter,strict=True)
            header=next(reader,None)
            if not header or not any(value.strip() for value in header) or len(header)>2000:raise ValueError('数据表没有有效表头或超过2000列')
            preview=[header];count=0;has_data=False
            for row in reader:
                if not row:continue
                count+=1
                if count>200000:raise ValueError('数据表超过20万行检查预算')
                if len(row)!=len(header):raise ValueError('数据表第'+str(reader.line_num)+'行列数与表头不符')
                has_data=has_data or any(value.strip() for value in row)
                if len(preview)<100:preview.append(row)
            if not count or not has_data:raise ValueError('数据表缺少数据行')
            return count,len(header),'\n'.join(','.join(row) for row in preview)
    finally:csv.field_size_limit(previous)

def inspect(path, fmt=None):
    extension=os.path.splitext(path)[1][1:].lower()
    fmt=(fmt or extension).lower()
    result={'valid':False,'format':fmt,'text':'','details':{}}
    if not os.path.isfile(path) or not os.path.getsize(path):
        result['error']='文件不存在或为空'; return result
    try:
        if extension in STRUCTURED and ALIASES.get(extension,extension)!=ALIASES.get(fmt,fmt):
            raise ValueError('文件扩展名.'+extension+'与声明格式'+fmt+'不一致，请修正产物契约')
        if os.path.getsize(path)>256*1024*1024:raise ValueError('文件超过256MiB检查预算')
        if fmt in ('docx','pptx','xlsx'):check_office_budget(path)
        if fmt=='docx':
            from docx import Document
            doc=Document(path)
            parts=[p.text for p in doc.paragraphs]+[c.text for t in doc.tables for r in t.rows for c in r.cells]
            result['text']='\n'.join(parts)
            result['details']={'paragraphs':len(doc.paragraphs),'tables':len(doc.tables),'images':len(doc.inline_shapes)}
            if not result['text'].strip() and not doc.inline_shapes: raise ValueError('Word 无正文、表格内容或图像')
        elif fmt=='pptx':
            from pptx import Presentation
            doc=Presentation(path); parts=[s.text for slide in doc.slides for s in slide.shapes if getattr(s,'has_text_frame',False)]
            objects=sum(1 for slide in doc.slides for shape in slide.shapes if (getattr(shape,'text','').strip() or not getattr(shape,'is_placeholder',False)))
            result['text']='\n'.join(parts); result['details']={'slides':len(doc.slides),'objects':objects}
            if not doc.slides or not objects: raise ValueError('PPT 没有有效幻灯片内容')
        elif fmt=='xlsx':
            from openpyxl import load_workbook
            doc=load_workbook(path,read_only=True,data_only=False)
            result['details']={'sheets':doc.sheetnames}
            cells=[];scanned=0;truncated=False
            try:
                for ws in doc:
                    if (ws.max_row or 0)>200000 or (ws.max_column or 0)>2000:raise ValueError('工作表范围超过20万行或2000列检查预算')
                    for row in ws.iter_rows():
                        scanned+=len(row)
                        if scanned>2000000:raise ValueError('工作簿扫描超过200万个单元格检查预算')
                        cells.extend(str(c.value) for c in row if c.value is not None)
                        if len(cells)>50000:truncated=True;break
                    if truncated:break
            finally:doc.close()
            result['text']='\n'.join(cells);result['details']['textTruncated']=truncated
            if not cells: raise ValueError('工作簿没有有效单元格')
        elif fmt=='json':
            with open(path,encoding='utf-8-sig') as f: value=json.load(f)
            if value in ({},[],None,''): raise ValueError('JSON 没有有效内容')
            result['text']=json.dumps(value,ensure_ascii=False)
        elif fmt in ('csv','tsv'):
            rows,columns,preview=csv_preview(path,'\t' if fmt=='tsv' else ',')
            result['details']={'rows':rows,'columns':columns};result['text']=preview
        elif fmt=='pdf':
            from pypdf import PdfReader
            doc=PdfReader(path); result['details']={'pages':len(doc.pages)}
            if not doc.pages: raise ValueError('PDF 没有页面')
            if len(doc.pages)>1000:raise ValueError('PDF超过1000页检查预算')
            parts=[];characters=0
            for page in doc.pages:
                value=page.extract_text() or '';parts.append(value);characters+=len(value)
                if characters>=300000:result['details']['textTruncated']=True;break
            result['text']='\n'.join(parts)
        elif fmt in ('mp4','mov','webm','mp3','wav'):
            probe=shutil.which('ffprobe')
            if not probe: raise ValueError('没有可用 ffprobe，媒体播放/规格尚未验证')
            p=subprocess.run([probe,'-v','error','-show_streams','-show_format','-of','json',path],capture_output=True,text=True,timeout=30)
            if p.returncode: raise ValueError('媒体解析失败：'+p.stderr[-300:])
            media=json.loads(p.stdout)
            if not media.get('streams'): raise ValueError('媒体没有有效流')
            result['details']=media
        elif fmt in ('png','jpg','jpeg','webp','tiff','tif'):
            from PIL import Image
            with Image.open(path) as im:
                if im.width*im.height>100000000:raise ValueError('图像超过1亿像素检查预算')
                result['details']={'width':im.width,'height':im.height};im.verify()
        else:
            with open(path,encoding='utf-8-sig') as f: result['text']=f.read(2*1024*1024)
            if not result['text'].strip(): raise ValueError('文本没有有效内容')
        result['valid']=True
    except Exception as exc: result['error']=str(exc)
    result['text']=result['text'][:300000]
    return result

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('path');ap.add_argument('--format');args=ap.parse_args()
    r=inspect(args.path,args.format)
    print(json.dumps(r,ensure_ascii=False))
    raise SystemExit(0 if r['valid'] else 1)
