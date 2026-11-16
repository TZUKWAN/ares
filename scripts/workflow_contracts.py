"""Typed legacy deliverable adapter. Display annotations are never filesystem paths."""
import os,re
from inspect_artifact import inspect

def deliverable_spec(item):
    if isinstance(item,dict):return dict(item)
    raw=str(item);clean=re.sub(r'（.*?）|\(.*?\)','',raw).strip()
    section=bool(re.search(r'[（(](?:含于|见正文|含在)',raw)) or ('章节' in clean and not os.path.splitext(clean)[1])
    return {'title':clean,'path':'' if section else clean.rstrip('/'),'kind':'section' if section else 'directory' if clean.endswith('/') else 'file','required':not bool(re.search(r'[（(](?:可选|选做)[）)]',raw)),'heading':re.sub(r'^\d+[-－]','',clean).replace('章节','') if section else '', 'format':os.path.splitext(clean)[1][1:]}

def check_deliverable(output_dir,item,parent_path=None):
    spec=deliverable_spec(item);result={'item':item,'required':spec.get('required',spec.get('requirement')!='optional'),'path':spec['path'],'kind':spec['kind'],'exists':False}
    if spec['kind']=='section':
        if parent_path:
            value=inspect(os.path.join(output_dir,parent_path))
            result['exists']=value['valid'] and spec['heading'] in value['text'];result['path']=parent_path
        result['status']='section-found' if result['exists'] else 'section-missing'
    else:
        full=os.path.abspath(os.path.join(output_dir,spec['path']));base=os.path.abspath(output_dir)
        if os.path.commonpath([base,full])!=base:result['status']='invalid-path';return result
        if spec['kind']=='directory':result['exists']=os.path.isdir(full) and any(os.path.getsize(os.path.join(b,n))>0 for b,_,names in os.walk(full) for n in names)
        else:result['exists']=inspect(full,spec.get('format'))['valid']
        result['status']='structure-checked' if result['exists'] else 'missing-or-invalid'
    return result
