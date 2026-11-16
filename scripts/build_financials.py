# -*- coding: utf-8 -*-
"""Forecast three financial statements from explicit assumptions; never target-fit profit.

python build_financials.py --profile project.json --out financials.xlsx
Reads facts.financials (v2) or financials (legacy). All monetary units are 万元.
Required: years, revenue_start_wan, growth_rates (n-1 ratios), gross_margin_ratio,
opex_ratio, tax_rate, depreciation_rate, receivable_ratio, inventory_ratio,
payable_ratio, capex_ratios (n), funding_by_year (n), interest_rate,
opening_balance {cash, receivables, inventory, fixed_assets, payables, debt, equity},
assumption_sources {parameter: documented source or explicitly labelled scenario}.
The model holds debt principal constant; equity injections are funding_by_year.
No hidden subsidies, profit targets, automatic loans, or generic startup values.
"""
import argparse, json, math, os

RATIOS=('gross_margin_ratio','opex_ratio','tax_rate','depreciation_rate','receivable_ratio','inventory_ratio','payable_ratio','interest_rate')
OPENING=('cash','receivables','inventory','fixed_assets','payables','debt','equity')

def number(value,label,lo=None,hi=None):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value): raise ValueError(label+'须为有限数字')
    if lo is not None and value<lo or hi is not None and value>hi: raise ValueError(label+'超出有效范围')
    return float(value)

def forecast(fin):
    if not isinstance(fin,dict): raise ValueError('缺少明确 financials 参数')
    years=fin.get('years')
    if isinstance(years,bool) or not isinstance(years,int) or not 1<=years<=20: raise ValueError('years须明确提供1–20的整数')
    required=['revenue_start_wan',*RATIOS,'opening_balance','growth_rates','capex_ratios','funding_by_year']
    missing=[key for key in required if key not in fin]
    if missing: raise ValueError('缺少参数，拒绝自动填充：'+', '.join(missing))
    sources=fin.get('assumption_sources')
    if not isinstance(sources,dict) or any(not str(sources.get(key,'')).strip() for key in ['years',*required]): raise ValueError('每个模型参数都需要 assumption_sources 说明来源或明确场景假设')
    ratios={key:number(fin[key],key,0,1) for key in RATIOS}
    values={}
    for key,count in [('growth_rates',years-1),('capex_ratios',years),('funding_by_year',years)]:
        if not isinstance(fin[key],list) or len(fin[key])!=count: raise ValueError(f'{key}需要{count}项显式参数')
        values[key]=[number(v,key,-1 if key=='growth_rates' else 0) for v in fin[key]]
    opening=fin['opening_balance']
    if not isinstance(opening,dict) or any(k not in opening for k in OPENING): raise ValueError('opening_balance须完整提供期初资产负债')
    b={k:number(opening[k],k,0) for k in OPENING}
    if abs(b['cash']+b['receivables']+b['inventory']+b['fixed_assets']-b['payables']-b['debt']-b['equity'])>1e-6: raise ValueError('期初资产负债不平衡')
    revenue=number(fin['revenue_start_wan'],'revenue_start_wan',0)
    rows=[];warnings=[]
    for i in range(years):
        if i: revenue*=1+values['growth_rates'][i-1]
        cogs=revenue*(1-ratios['gross_margin_ratio']);opex=revenue*ratios['opex_ratio']
        capex=revenue*values['capex_ratios'][i]
        depreciation=min(b['fixed_assets'],b['fixed_assets']*ratios['depreciation_rate'])
        interest=b['debt']*ratios['interest_rate'];pretax=revenue-cogs-opex-depreciation-interest
        tax=max(pretax,0)*ratios['tax_rate'];profit=pretax-tax
        ar=revenue*ratios['receivable_ratio'];inv=cogs*ratios['inventory_ratio'];ap=cogs*ratios['payable_ratio']
        working_capital=(ar-b['receivables'])+(inv-b['inventory'])-(ap-b['payables'])
        operating_cash=profit+depreciation-working_capital;funding=values['funding_by_year'][i]
        cash=b['cash']+operating_cash-capex+funding;fixed=b['fixed_assets']+capex-depreciation;equity=b['equity']+profit+funding
        assets=cash+ar+inv+fixed;liabilities=ap+b['debt'];difference=assets-liabilities-equity
        if abs(difference)>1e-6: raise ValueError('模型勾稽失败：第%d年'% (i+1))
        if cash<0: warnings.append('第%d年期末现金为负，存在融资/经营缺口；模型未自动补融资'%(i+1))
        rows.append(dict(year=i+1,revenue=revenue,cogs=cogs,gross_profit=revenue-cogs,opex=opex,depreciation=depreciation,interest=interest,pretax_profit=pretax,tax=tax,net_profit=profit,operating_cash=operating_cash,investment_cash=-capex,financing_cash=funding,opening_cash=b['cash'],cash=cash,receivables=ar,inventory=inv,fixed_assets=fixed,assets=assets,payables=ap,debt=b['debt'],equity=equity,balance_difference=difference))
        b.update(cash=cash,receivables=ar,inventory=inv,fixed_assets=fixed,payables=ap,equity=equity)
    return {'status':'forecast-not-actual-performance','units':'万元','assumptions':fin,'model_boundaries':['债务本金维持期初余额','当年资本支出下年起折旧','不自动确认补贴、其他收入或追加融资','未计算亏损结转和递延所得税'],'years':rows,'warnings':warnings}

def write_xlsx(path,result):
    from openpyxl import Workbook
    from openpyxl.styles import Font,PatternFill,Alignment
    wb=Workbook();wb.remove(wb.active)
    groups={
      '利润表':[('year','年度'),('revenue','收入'),('cogs','营业成本'),('gross_profit','毛利润'),('opex','运营费用'),('depreciation','折旧'),('interest','利息'),('pretax_profit','税前利润'),('tax','所得税'),('net_profit','净利润')],
      '现金流量表':[('year','年度'),('opening_cash','期初现金'),('operating_cash','经营现金流'),('investment_cash','投资现金流'),('financing_cash','筹资现金流'),('cash','期末现金')],
      '资产负债表':[('year','年度'),('cash','现金'),('receivables','应收账款'),('inventory','存货'),('fixed_assets','固定资产净值'),('assets','资产总计'),('payables','应付账款'),('debt','债务'),('equity','所有者权益'),('balance_difference','资产减负债与权益差额')]}
    for title,columns in groups.items():
        ws=wb.create_sheet(title);ws.append(['财务预测 / 万元；显式假设推演，不代表真实经营业绩']);ws.append([label for _,label in columns])
        for row in result['years']:ws.append([row[key] for key,_ in columns])
        for row in ws.iter_rows(min_row=3):
            for c in row[1:]:c.number_format='#,##0.00;[Red]-#,##0.00'
    ws=wb.create_sheet('参数与边界');ws.append(['参数','值','来源或场景说明'])
    for key,value in result['assumptions'].items():
        if key=='assumption_sources':continue
        ws.append([key,json.dumps(value,ensure_ascii=False),result['assumptions']['assumption_sources'].get(key,'')])
    for note in result['model_boundaries']:ws.append(['模型边界',note,'结构性假设'])
    for warning in result['warnings']:ws.append(['风险',warning,'实际计算结果'])
    ws=wb.create_sheet('勾稽校验');ws.append(['年度','资产减负债与权益','结论'])
    for i,row in enumerate(result['years'],3):
        # Formula references actual balance sheet cells, never a hardcoded PASS.
        ws.append([row['year'],f"='资产负债表'!F{i}-'资产负债表'!G{i}-'资产负债表'!H{i}-'资产负债表'!I{i}",f'=IF(ABS(B{i-1})<0.000001,"平衡","不平衡")'])
    for ws in wb:
        ws.freeze_panes='B3' if ws.title in groups else 'B2'
        for c in ws[1]:c.font=Font(name='Microsoft YaHei',bold=True,color='FFFFFF');c.fill=PatternFill('solid',fgColor='294D3C')
        for col in ws.columns:ws.column_dimensions[col[0].column_letter].width=24 if ws.title!='参数与边界' else 38
        for row in ws:
            for c in row:c.alignment=Alignment(vertical='top',wrap_text=True)
    os.makedirs(os.path.dirname(os.path.abspath(path)),exist_ok=True);wb.save(path)

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--profile',required=True);ap.add_argument('--out',required=True);args=ap.parse_args()
    try:
        with open(args.profile,encoding='utf-8') as f:p=json.load(f)
        result=forecast(p.get('facts',{}).get('financials',p.get('financials')))
        write_xlsx(args.out,result)
        print(json.dumps({'output':os.path.abspath(args.out),'status':result['status'],'years':len(result['years']),'warnings':result['warnings'],'balance_differences':[r['balance_difference'] for r in result['years']]},ensure_ascii=False));return 0
    except (ValueError,OSError,KeyError,TypeError) as exc:print('财务模型失败：'+str(exc));return 1

if __name__=='__main__':raise SystemExit(main())
