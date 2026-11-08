"""Regenerate scenario A with real public corporate identities and synthetic terms."""
from pathlib import Path
import hashlib
import json
import shutil
from xml.sax.saxutils import escape

from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/vendor-contact-tests'
PDF = OUT / '01-complete-proposal.pdf'
CASE = 'TEST-A-CCM-002'
DATE = '2026-11-07'
SOURCES = [
    ('S01', 'gBizINFO：Co createの法人情報', 'https://info.gbiz.go.jp/hojin/ichiran?hojinBango=3010001205734'),
    ('S02', 'Co create：公式会社概要', 'https://cocurie.com/aboutus'),
    ('S03', 'gBizINFO：ミモザ情報システムの法人情報', 'https://info.gbiz.go.jp/hojin/ichiran?hojinBango=2130001013399'),
    ('S04', 'ミモザ情報システム：公式会社概要', 'https://www.mimosa.co.jp/about/'),
    ('S05', 'ミモザのPCAショップ：会社概要', 'https://www.mimosa.gr.jp/pca/ownerInformation.html'),
    ('S06', 'ミモザ：2026年補助金活用ガイド', 'https://www.mimosa.gr.jp/pca/it-hojo.html'),
]


def generate():
    OUT.mkdir(parents=True, exist_ok=True)
    if PDF.exists() and CASE not in ''.join(p.extract_text() for p in PdfReader(PDF).pages):
        archive = OUT / 'archive/01-complete-proposal-v1-synthetic.pdf'
        archive.parent.mkdir(exist_ok=True)
        if not archive.exists():
            shutil.copy2(PDF, archive)
    pdfmetrics.registerFont(TTFont('JP', 'C:/Windows/Fonts/msgothic.ttc', subfontIndex=0))
    c = canvas.Canvas(str(PDF), pagesize=(595, 842))
    c.setTitle('Co create × ミモザ情報システム | 公開法人情報を使う見積テスト v2')
    c.setAuthor('補助金AIプラグイン検証用・両社発行資料ではありません')
    c.setSubject('実在法人の公開情報と合成取引条件を区別したgBizINFO連携テスト入力')
    y = 0
    page_bottoms = []

    def para(body, size=10, leading=15, color='#243449', gap=8):
        nonlocal y
        style = ParagraphStyle('body', fontName='JP', fontSize=size, leading=leading,
                               textColor=HexColor(color), wordWrap='CJK')
        p = Paragraph(body, style)
        _, h = p.wrap(523, 700)
        assert y-h >= 55, ('overflow', body[:70], y, h)
        p.drawOn(c, 36, y-h)
        y -= h+gap

    def section(title, body):
        para(escape(title), 12, 17, '#007A73', 5)
        para(body)

    def start(n, title):
        nonlocal y
        c.setFillColor(HexColor('#123246'))
        c.rect(0, 738, 595, 104, fill=1, stroke=0)
        c.setFillColor(HexColor('#93E3D0'))
        c.setFont('JP', 10)
        c.drawString(36, 813, 'TEST ONLY / 公開法人情報 ＋ 合成取引条件')
        c.setFillColor(HexColor('#FFFFFF'))
        c.setFont('JP', 20)
        c.drawString(36, 781, title)
        c.setFont('JP', 9)
        c.drawString(36, 757, f'{CASE} | v2 | 作成・公開情報確認：{DATE}')
        c.setFillColor(HexColor('#516273'))
        c.setFont('JP', 7.6)
        c.drawString(36, 31, '開発用テスト資料／両社・PCAの発行・監修資料ではありません／実申請には使用不可')
        c.drawRightString(559, 18, f'{n} / 4')
        y = 715

    def end():
        page_bottoms.append(round(y, 1))
        c.showPage()

    start(1, '見積テスト｜実在法人連携')
    para('申請者役と販売会社役に、ユーザー指定の実在する2社を使用。法人名・法人番号・所在地は公開情報、見積・相談・受付の内容は合成設定です。', 10, 15)
    section('申請者役｜公開情報 [S01・S02]',
            '法人名：株式会社Ｃｏ　ｃｒｅａｔｅ<br/>'
            '公式サイト表記：株式会社Co create<br/>'
            '法人番号：3010001205734<br/>'
            '本店所在地：東京都千代田区神田鍛冶町３丁目７番地２１<br/>'
            '公式サイトの所在地補足：天翔神田駅前ビル808')
    section('販売会社役｜公開情報 [S03・S04・S05]',
            '法人名：株式会社ミモザ情報システム<br/>'
            '法人番号：2130001013399<br/>'
            '本店所在地：京都府京都市山科区大塚森町１２番１９号ステア２１１・２Ｆ')
    section('案件条件｜合成設定',
            '2026年度・通常枠・第7次を想定。契約・発注・支払は未実施というテスト条件。'
            '「TEST会計クラウド 管理プラン v1」、3ライセンス、24か月。実在するPCA製品の正式プラン・価格ではありません。')
    rows = [['費用明細（合成）', '税抜金額'],
            ['クラウド利用料：3ライセンス・24か月分の総額', '720,000円'],
            ['初期設定', '100,000円'], ['データ移行', '80,000円'],
            ['税抜合計', '900,000円'], ['消費税（10％のテスト設定）', '90,000円'],
            ['税込合計', '990,000円']]
    table = Table(rows, colWidths=[391,132], rowHeights=[24]*7)
    table.setStyle(TableStyle([
        ('FONTNAME',(0,0),(-1,-1),'JP'), ('FONTSIZE',(0,0),(-1,-1),9),
        ('BACKGROUND',(0,0),(-1,0),HexColor('#E6F2F0')),
        ('BACKGROUND',(0,-1),(-1,-1),HexColor('#E6F2F0')),
        ('TEXTCOLOR',(0,0),(-1,-1),HexColor('#243449')),
        ('ALIGN',(1,1),(1,-1),'RIGHT'), ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
        ('LINEBELOW',(0,0),(-1,-1),0.4,HexColor('#D6E2E7')),
    ]))
    _, h = table.wrap(523,700)
    assert y-h >= 55
    table.drawOn(c,36,y-h)
    y -= h+10
    para('利用料は期間総額。3名・24か月を再乗算しません。金額から補助対象・補助金額を確定しません。',9,13)
    end()

    start(2, '提案・設定・移行のテスト条件')
    section('導入目的｜合成設定',
            'freee会計を利用中で、上場を見据えた経理体制を整えたい、という相談を想定。'
            'Co createが実際にfreeeを利用していることや、上場計画・本件相談があることを示すものではありません。')
    section('提案済みの構成と対応範囲｜合成設定',
            'TEST-SPEC-01 v1：担当別の入力・承認権限、仕訳承認、変更履歴の出力に対応する想定。'
            '追加製品なし。経理規程の策定、監査対応、上場適合の保証は含みません。'
            '提案が済んでいるケースのテストであり、ミモザやPCAによる実際の回答・機能保証ではありません。')
    section('初期設定・移行範囲｜合成サービス仕様 TEST-SERVICE-01 v1',
            '勘定科目・開始残高・3名分の権限と承認経路を設定。オンライン説明2回。'
            '移行元はfreee会計、対象は2025年4月～2026年3月の仕訳CSV最大10,000行、勘定科目と期末残高。'
            'この期間は移行対象の仮定であり、Co createの決算期を示しません。<br/>'
            'サンプル点検済みというテスト状態。標準取込と残高照合を含み、顧客側作業はCSV出力と最終残高確認。'
            '証憑画像・過年度履歴・独自帳票は対象外。追加費用・未確定作業なしという合成条件です。')
    section('登録照合用の合成データ｜公的登録番号ではありません',
            '年度2026／通常枠／模擬支援事業者ID TEST-VENDOR-01／構成員なし。<br/>'
            'ソフト：TEST-TOOL-01<br/>設定：TEST-SERVICE-SETUP-01<br/>'
            '移行：TEST-SERVICE-MOVE-01<br/>'
            '登録版v1、プランは見積と一致、プロセスは会計・財務・経営、税抜3明細を対象とする合成条件。'
            '法人番号2130001013399は実在法人の照合用であり、これらの模擬ID・当年度ITツール登録を証明しません。')
    section('実情報として残る確認範囲',
            'このテスト見積に対応する実際のITツール登録、個別の役務提供可否、会社資格、財務、給与・労働時間、'
            '事業計画は未確認。資料中の合成条件を実会社の実績・登録・申請資格として扱いません。')
    end()

    start(3, '申請支援の手順と依頼書の模擬項目')
    section('ケースAの進行条件｜合成設定',
            '提案・役務範囲は提示済み、相談受付済みとして申請準備を進めるケースです。'
            'テスト上の受付期限は2026年11月20日17時（日本時間）。実際のミモザの受付承諾・締切ではありません。'
            '申請者の基本資料を確認後、販売会社が申請マイページ招待・製品情報入力、本人が確認・宣誓・提出する流れを模擬します。')
    section('申請支援依頼書｜合成様式 TEST-ASSIST-01 v1',
            f'対象見積：{CASE} v2<br/>'
            '法人名：株式会社Ｃｏ　ｃｒｅａｔｅ<br/>'
            '担当者名：未設定　／　連絡先：未設定<br/>'
            '希望年度・枠：2026年度・通常枠（テスト設定）<br/>'
            '依頼内容：申請準備支援のみ。商品の発注は含まない想定。<br/>'
            '本人確認・同意・署名：未実施。<br/>'
            'これは項目の模擬資料であり、ミモザが発行する申込・同意書の原本ではありません。')
    section('販売会社の公開資料と連絡先の扱い [S05・S06]',
            '公開会社概要とPCA補助金活用ガイドは4ページ目の出典から参照できます。'
            '実際の案件受付・個別期限・正式書式・当年度登録は公開案内だけでは確定しません。<br/>'
            '実送信用メールアドレスは本紙に設定していません。送信試験を行う場合は、ユーザー指定のテスト宛先を別途用います。')
    section('この案件に引き継がない旧設定',
            '旧資料の「株式会社テスト青葉商事」「株式会社テスト業務システム」および会話で作成した卸売業・'
            '資本金1,000万円・従業員20名・3月決算・資本関係・過去受給なし・担当者名は、Co createの情報として使用しません。')
    section('現在の確認状態',
            '実在法人の公開情報：Webで確認。gBizINFOの公開ページ参照と、プラグインのMCP/APIによる取得・取込み試験は別です。'
            '本PDFの更新時点でプラグイン経由の取得・取込みは未実行。外部送信、本人認証、同意、公式提出も未実施です。')
    end()

    start(4, '公開情報の出典と連携確認のポイント')
    para('確認日：2026-11-07。下記はWeb公開情報の参照記録です。確認日は取得日であり、全項目がその日現在の値であることを保証しません。',9,13)
    for sid, title, url in SOURCES:
        para(f'{sid}　{escape(title)}<br/><link href="{escape(url)}" color="#007A73">{escape(url)}</link>',8.5,12, gap=6)
    section('公開値の扱いで検証できる点',
            '・法人照合：両社の13桁の法人番号、名称、本店所在地を照合。全角／半角の名称と公式サイトの建物名・部屋番号を区別。<br/>'
            '・不足補完：Co create公式サイトは代表者「三浦 雅弘」、設立「2019年11月」、事業「分散型ECプラットフォーム開発」を掲載 [S02]。<br/>'
            '・金額の意味：同サイトの121,895,000円は「準備金含む」の表記。資本金単独の値として申請欄へ転記しない [S02]。<br/>'
            '・人数の意味：gBizINFOの基本情報の従業員数は表示なし。事業所欄の被保険者数（Co create 3人、ミモザ10人）は従業員数へ置換しない [S01・S03]。<br/>'
            '・受給情報：Co createには「［第六回］事業再構築補助金（交付申請等）」20,000,000円・確定の掲載あり [S01]。'
            'IT導入補助金の受給有無や本件との費用重複は別途確認する。')
    section('テストで確認する境界',
            '会社名検索 → 候補・法人番号の照合 → 企業プロフィール取得 → 必要な補助金活動情報の取得、という操作を実際に行った記録で確認します。'
            '取得失敗・空欄・掲載なしを、0円・0人・受給なしへ補完しません。模擬見積は公的証明書や決算原本の代替にはなりません。')
    para('基本情報の出典更新日：S01は2026-01-29、S03は2025-12-05（gBizINFO掲載の法人番号公表サイト情報）。'
         'S02・S04・S05の情報基準日は未確認。S06のページ更新日は2026-10-02。'
         '本資料は両社・国税庁・経済産業省による保証、監修、推奨を示すものではありません。',8,11)
    end()
    c.save()

    text = '\n'.join(p.extract_text() for p in PdfReader(PDF).pages)
    assert len(PdfReader(PDF).pages) == 4
    for needle in ['3010001205734', '2130001013399', '990,000', '準備金含む', CASE]:
        assert needle in text, needle
    assert 720000 + 100000 + 80000 == 900000
    assert 900000 + 90000 == 990000
    (OUT / '01-complete-proposal-public-sources.json').write_text(json.dumps({
        'caseId': CASE, 'version': 2, 'checkedOn': DATE,
        'verificationMethod': 'Public web pages; plugin MCP/API not executed',
        'pdfSha256': hashlib.sha256(PDF.read_bytes()).hexdigest(),
        'publicIdentities': [
            {'role': 'applicant', 'corporateNumber': '3010001205734', 'name': '株式会社Ｃｏ　ｃｒｅａｔｅ',
             'registeredAddress': '東京都千代田区神田鍛冶町３丁目７番地２１', 'sources': ['S01','S02']},
            {'role': 'vendor', 'corporateNumber': '2130001013399', 'name': '株式会社ミモザ情報システム',
             'registeredAddress': '京都府京都市山科区大塚森町１２番１９号ステア２１１・２Ｆ', 'sources': ['S03','S04','S05']},
        ],
        'sources': [{'id': s, 'title': t, 'url': u} for s,t,u in SOURCES],
        'syntheticFields': ['quote', 'product', 'purpose', 'migration', 'IT tool IDs', 'acceptance', 'deadline', 'form'],
        'notEstablished': ['eligibility', 'financials', 'wages', 'hours', 'IT subsidy history', 'actual vendor acceptance', 'official submission'],
        'pageBottoms': page_bottoms,
    }, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'pdf': str(PDF), 'pages': 4, 'pageBottoms': page_bottoms}, ensure_ascii=False))


if __name__ == '__main__':
    generate()
