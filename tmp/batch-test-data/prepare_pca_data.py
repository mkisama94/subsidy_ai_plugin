from pathlib import Path

work = Path(__file__).resolve().parent
source = (work/'build_data_and_pdf.py').read_text(encoding='utf-8')
source = source.split("pdfmetrics.registerFont", 1)[0]
source = source.replace("CASE = 'TEST-A-CCM-002'", "CASE = 'CC-20261107-01'")
source = source.replace('テスト役員01', '役員01').replace('テスト従業員', '従業員')
source = source.replace("daily, monthly, payroll = [], [], []", """holidays = set('2025-04-29 2025-05-03 2025-05-04 2025-05-05 2025-05-06 2025-07-21 2025-08-11 2025-09-15 2025-09-23 2025-10-13 2025-11-03 2025-11-23 2025-11-24 2026-01-01 2026-01-12 2026-02-11 2026-02-23 2026-03-20'.split())
company_holidays = set('2025-08-13 2025-08-14 2025-08-15 2025-12-29 2025-12-30 2025-12-31 2026-01-02'.split())
daily, monthly, payroll = [], [], []""")
source = source.replace('weekdays=[d for d in days if d.weekday()<5]', 'weekdays=[d for d in days if d.weekday()<5 and d.isoformat() not in holidays | company_holidays]')
source = source.replace('leave=weekdays[5+ix]', 'leave=weekdays[(3+ix+month)%len(weekdays)]')
source = source.replace("day.weekday()>=5 else", "day.weekday()>=5 or day.isoformat() in holidays | company_holidays else")
source = source.replace("active and day==weekdays[0]", "active and day==next(d for d in weekdays if d!=leave)")
source = source.replace("(WORK/'data.json')", "data['calendar'] = dict(holidays=sorted(holidays), companyHolidays=sorted(company_holidays))\n(WORK/'data.json')")
exec(compile(source, str(work/'build_data_and_pdf.py'), 'exec'), {'__file__':str(work/'build_data_and_pdf.py')})
