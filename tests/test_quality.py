"""Targeted generator / legacy-adapter regression tests. All data are test fixtures."""
import json,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from build_financials import forecast,write_xlsx
from validate_profile import validate
from workflow_contracts import check_deliverable
from audit_visuals import audit
from inspect_artifact import inspect
from build_scorecard import build

class QualityContracts(unittest.TestCase):
    def setUp(self):
        import os
        folder=os.environ.get('ARES_TEST_ROOT')
        self.temp=tempfile.TemporaryDirectory(prefix='ares-quality-',dir=folder);self.path=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def assumptions(self):
        f=dict(years=2,revenue_start_wan=100,growth_rates=[.1],gross_margin_ratio=.4,opex_ratio=.2,tax_rate=.25,depreciation_rate=.1,receivable_ratio=.1,inventory_ratio=.1,payable_ratio=.1,interest_rate=0,capex_ratios=[.1,.1],funding_by_year=[0,0],opening_balance=dict(cash=50,receivables=0,inventory=0,fixed_assets=0,payables=0,debt=0,equity=50))
        f['assumption_sources']={k:'TEST FIXTURE explicit scenario, not real business data' for k in f}
        return f
    def test_finance_refuses_missing_and_unsourced_assumptions(self):
        with self.assertRaisesRegex(ValueError,'years'):forecast({})
        f=self.assumptions();del f['gross_margin_ratio']
        with self.assertRaisesRegex(ValueError,'缺少参数'):forecast(f)
        f=self.assumptions();f['assumption_sources']={}
        with self.assertRaisesRegex(ValueError,'来源'):forecast(f)
    def test_finance_profit_comes_from_costs_no_target_fitting(self):
        result=forecast(self.assumptions());y=result['years'][0]
        self.assertAlmostEqual(y['net_profit'],15);self.assertAlmostEqual(y['cash'],45)
        self.assertTrue(all(abs(r['balance_difference'])<1e-6 for r in result['years']))
        f=self.assumptions();f['opex_ratio']=.8;r=forecast(f)
        self.assertLess(r['years'][0]['net_profit'],0);self.assertEqual(r['years'][0]['tax'],0)
    def test_cash_gap_is_reported_not_filled_with_invented_funding(self):
        f=self.assumptions();f['opening_balance']['cash']=0;f['opening_balance']['equity']=0;f['opex_ratio']=.9
        result=forecast(f);self.assertTrue(result['warnings']);self.assertEqual(result['years'][0]['financing_cash'],0)
    def test_real_workbook_contains_live_balance_formulas(self):
        from openpyxl import load_workbook
        path=self.path/'test-fixture.xlsx';write_xlsx(path,forecast(self.assumptions()));wb=load_workbook(path,data_only=False)
        self.assertEqual(len(wb.sheetnames),5);self.assertTrue(wb['勾稽校验']['B2'].value.startswith('='));self.assertIn('F3',wb['勾稽校验']['B2'].value);wb.close()
    def test_modeling_and_survey_do_not_require_venture_fields(self):
        comps=json.loads((ROOT/'data/competitions.json').read_text(encoding='utf-8'));tracks=json.loads((ROOT/'data/tracks.json').read_text(encoding='utf-8'))['entries']
        for pipeline in ['L2','L4','L3','E1']:
            t=next(t for t in tracks if t['pipeline']==pipeline);c=next(c for c in comps if c['id']==t['competition_id'])
            p={'project_name':'软件测试夹具','competition':{'id':c['id'],'name':c['name'],'level':c['level'],'track':t['track']}}
            missing,_=validate(p,str(ROOT/'data'),str(self.path));self.assertEqual(missing,[],(pipeline,missing))
    def test_optional_and_embedded_items_use_real_parent_document(self):
        from docx import Document
        d=Document();d.add_heading('软件测试夹具',0);d.add_heading('灵敏度分析',1);d.add_paragraph('测试内容，不是实际科研结果。');d.save(self.path/'01-论文.docx')
        r=check_deliverable(str(self.path),'05-灵敏度分析章节(含于论文)','01-论文.docx');self.assertTrue(r['exists']);self.assertEqual(r['kind'],'section')
        r=check_deliverable(str(self.path),'09-视频脚本.docx(可选)');self.assertFalse(r['required']);self.assertFalse(r['exists'])
    def test_text_document_without_pictures_is_not_arbitrarily_blocked(self):
        from docx import Document
        d=Document();d.add_paragraph('软件测试夹具：演讲稿可以没有图片和表格。');p=self.path/'speech.docx';d.save(p)
        r=audit(docx_path=str(p),pipeline='E1',strict=True);self.assertTrue(r['structure_ready']);self.assertFalse(r['formal_ready']);self.assertEqual(r['visual_review_status'],'not-rendered-or-reviewed-by-this-check')
    def test_blank_powerpoint_is_not_valid_content(self):
        from pptx import Presentation
        doc=Presentation();doc.slides.add_slide(doc.slide_layouts[0]);p=self.path/'blank.pptx';doc.save(p)
        self.assertFalse(inspect(str(p),'pptx')['valid']);self.assertFalse(audit(pptx_path=str(p),strict=True)['structure_ready'])
    def test_recommendations_do_not_become_mandatory_points(self):
        # Minimal, explicitly synthetic rubric tests policy classification only.
        data=self.path/'data';(data/'rubrics').mkdir(parents=True)
        (data/'rubrics'/'005.json').write_text(json.dumps({'judging_dimensions':[{'dimension':'TEST FIXTURE','weight':'定性','scoring_points':['可改进的质量建议']}]}),encoding='utf-8')
        (data/'tracks.json').write_text(json.dumps({'entries':[]}),encoding='utf-8')
        p=self.path/'profile.json';p.write_text(json.dumps({'competition':{'id':5}}),encoding='utf-8')
        r=build(str(p),root=str(self.path));self.assertEqual(r['mandatory_gaps'],[]);self.assertEqual(len(r['uncovered_points']),1);self.assertTrue(r['coverage_ready']);self.assertFalse(r['formal_ready'])

if __name__=='__main__':unittest.main(verbosity=2)
