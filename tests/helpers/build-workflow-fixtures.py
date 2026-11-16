"""Create real format fixtures from current workflow metadata, never contest work.

No real questionnaires, financial forecasts, hardware tests or platform rounds are
claimed. Office/media are deliberately software protocol fixtures, not user-facing
presentations or research deliverables. CSV rows are actual source-file metadata.
"""
from pathlib import Path
import csv, hashlib, json, subprocess, sys

plan=json.load(sys.stdin)
base=Path(plan['outputDir']);base.mkdir(parents=True,exist_ok=True)
workflow=plan['workflow'];all_outputs=[o for s in workflow['steps'] for o in s['outputs']]
step=next(s for s in workflow['steps'] if s['id']==plan['stepId'])
observations=[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(Path(plan['sourceDir']).glob('*.js'))]
result={'purpose':'software-protocol-fixture-not-competition-evidence','observed_source_files':len(observations),'observed_bytes':sum(row['bytes'] for row in observations)}
text=f"# SOFTWARE PROTOCOL FIXTURE: {workflow['id']} / {step['id']}\n\nThis file tests parser/state contracts only. It is not a survey, experiment, financial statement, contest submission or proof of actual team work.\nObserved source files: {result['observed_source_files']}; observed bytes: {result['observed_bytes']}.\n"
created=[]
for output in step['outputs']:
 if output['kind']=='section':continue
 path=base/output['path'];path.parent.mkdir(parents=True,exist_ok=True)
 fmt=output.get('format','txt')
 if output['kind']=='directory':
  path.mkdir(exist_ok=True)
  (path/'source-observations.json').write_text(json.dumps(observations,ensure_ascii=False,indent=2),encoding='utf-8')
  (path/'calculate.py').write_text('from pathlib import Path\nimport json\nrows=json.loads(Path(__file__).with_name("source-observations.json").read_text(encoding="utf-8"))\nprint(json.dumps({"observed_source_files":len(rows),"observed_bytes":sum(row["bytes"] for row in rows)}))\n',encoding='utf-8')
  (path/'__init__.py').write_bytes(b'')
  run=subprocess.run([sys.executable,str(path/'calculate.py')],capture_output=True,text=True,check=True)
  actual=json.loads(run.stdout);assert actual['observed_bytes']==result['observed_bytes']
  (path/'actual-calculation.json').write_text(json.dumps(actual,indent=2),encoding='utf-8')
  (path/'README.md').write_text(text,encoding='utf-8')
  if workflow['id']=='design':
   from PIL import Image,ImageDraw
   image=Image.new('RGB',(480,240),'#f2f4f9');draw=ImageDraw.Draw(image);draw.text((24,35),'ARES SOFTWARE FORMAT TEST',fill='#243459');draw.text((24,80),f"Observed files: {len(observations)}",fill='#243459');image.save(path/'actual-test-image.png')
   (path/'editable-test-source.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" fill="#f2f4f9"/><text x="24" y="70">SOFTWARE FORMAT TEST</text></svg>',encoding='utf-8')
 elif fmt=='docx':
  from docx import Document
  doc=Document();doc.add_heading('Software protocol fixture',0);doc.add_paragraph(text)
  for section in all_outputs:
   if section['kind']=='section' and section['parentId']==output['id']:doc.add_heading(section['heading'],1);doc.add_paragraph('Actual source metadata computation only; not a competition result.')
  doc.save(path)
 elif fmt=='pptx':
  from pptx import Presentation
  # Intentionally one labeled format-test slide, never a user presentation.
  deck=Presentation();slide=deck.slides.add_slide(deck.slide_layouts[1]);slide.shapes.title.text='ARES software format fixture';slide.placeholders[1].text=f"Not competition material\nObserved source files: {len(observations)}";deck.save(path)
 elif fmt=='xlsx':
  from openpyxl import Workbook
  book=Workbook();sheet=book.active;sheet.title='Software fixture';sheet.append(['Actual source metadata','Bytes'])
  for row in observations:sheet.append([row['name'],row['bytes']])
  sheet.append(['Sum',f'=SUM(B2:B{len(observations)+1})']);book.save(path)
 elif fmt=='csv':
  with path.open('w',encoding='utf-8',newline='') as stream:
   writer=csv.DictWriter(stream,fieldnames=['name','bytes','sha256']);writer.writeheader();writer.writerows(observations)
 elif fmt=='json':path.write_text(json.dumps(result,indent=2),encoding='utf-8')
 elif fmt=='mp4':
  command=['ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=192x108:rate=10','-f','lavfi','-i','sine=frequency=440:sample_rate=22050','-t','0.4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',str(path)]
  subprocess.run(command,check=True,capture_output=True,timeout=30)
 else:path.write_text(text,encoding='utf-8')
 created.append(str(path))
print(json.dumps({'created':created,'purpose':'software-protocol-fixture','actual_observations':result},ensure_ascii=False))
