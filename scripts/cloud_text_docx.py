"""Convert an explicit cloud text candidate to a new editable Word draft.
This preserves text and paragraph breaks, not the original cloud layout/media.
"""
import io,json,sys,base64,zipfile,datetime
from docx import Document
data=json.load(sys.stdin)
document=Document()
document.core_properties.created=datetime.datetime(2000,1,1)
document.core_properties.modified=datetime.datetime(2000,1,1)
for line in data['text'].splitlines():
    if line.startswith('# '):document.add_heading(line[2:],0)
    elif line.startswith('## '):document.add_heading(line[3:],1)
    elif line.startswith('### '):document.add_heading(line[4:],2)
    else:document.add_paragraph(line)
raw=io.BytesIO();document.save(raw);output=io.BytesIO()
with zipfile.ZipFile(io.BytesIO(raw.getvalue())) as source,zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as target:
    for name in sorted(source.namelist()):
        info=zipfile.ZipInfo(name,date_time=(2000,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
        target.writestr(info,source.read(name))
print(json.dumps({'content_base64':base64.b64encode(output.getvalue()).decode('ascii'),'representation':'converted-text-word-draft'},ensure_ascii=False))
