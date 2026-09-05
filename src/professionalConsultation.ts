export type ConsultationTopic =
  | "location"
  | "industry"
  | "employee_count"
  | "capital_yen"
  | "business_plans"
  | "official_guidelines"
  | "acceptance_period"
  | "corporate_relationship"
  | "officer_overlap"
  | "indirect_control"
  | "high_income_rule"
  | "conditional_requirement"
  | "program_rule"
  | "research_and_development_costs"
  | "partnership_structure";

type ConsultationIssue = {
  topic: ConsultationTopic;
  summary: string;
};

export type ProfessionalConsultationBriefInput = {
  companyName?: string;
  publicBusinessSummary?: string;
  subsidyName?: string;
  sourceUrl?: string;
  confirmedFacts?: string[];
  issues: ConsultationIssue[];
  applicationDeadline?: string | null;
  consultBy?: string | null;
};

const TOPIC_GUIDANCE: Record<
  ConsultationTopic,
  { question: string; documents: string[]; specialists: string[] }
> = {
  location: {
    question: "本店所在地または事業実施場所は、この制度の対象地域に含まれますか。",
    documents: ["登記事項証明書または所在地を確認できる資料", "事業実施場所の資料"],
    specialists: ["実施機関の相談窓口"],
  },
  industry: {
    question: "当社の主たる事業と今回の事業は、制度上の対象業種に該当しますか。",
    documents: ["会社案内または事業概要", "今回実施する事業の概要"],
    specialists: ["中小企業診断士など補助金支援の専門家", "実施機関の相談窓口"],
  },
  employee_count: {
    question: "この制度で使用する従業員数の定義と基準日は、当社の集計方法で正しいですか。",
    documents: ["従業員数の集計表", "必要に応じて労働者名簿・賃金台帳"],
    specialists: ["社会保険労務士", "実施機関の相談窓口"],
  },
  capital_yen: {
    question: "資本金と資本関係を踏まえ、この制度の企業規模要件を満たしますか。",
    documents: ["直近の決算書", "株主名簿または法人税申告書別表二"],
    specialists: ["税理士または公認会計士", "実施機関の相談窓口"],
  },
  business_plans: {
    question: "計画している事業・支出は、制度上の対象事業および対象経費に含まれますか。",
    documents: ["事業計画の概要", "見積書・費用内訳", "実施スケジュール"],
    specialists: ["中小企業診断士など補助金支援の専門家", "実施機関の相談窓口"],
  },
  official_guidelines: {
    question: "最新の公募要領・交付要綱・FAQを前提に、ほかに満たすべき申請条件はありますか。",
    documents: ["最新の公募要領・交付要綱・FAQ"],
    specialists: ["実施機関の相談窓口"],
  },
  acceptance_period: {
    question: "申請期限と、専門家への相談・社内決裁・必要書類取得の期限をどう設定すべきですか。",
    documents: ["公募日程", "社内決裁と書類準備の予定表"],
    specialists: ["中小企業診断士など補助金支援の専門家", "実施機関の相談窓口"],
  },
  corporate_relationship: {
    question: "現在の株主構成と関係会社の状況は、みなし大企業または持分法適用会社の除外要件に該当しますか。",
    documents: ["最新の株主名簿", "法人税申告書別表二", "資本関係図"],
    specialists: ["税理士または公認会計士", "実施機関の相談窓口"],
  },
  officer_overlap: {
    question: "大企業の役員・職員との兼務状況は、制度上のみなし大企業要件に該当しますか。",
    documents: ["役員名簿", "兼務状況を確認できる社内資料"],
    specialists: ["社会保険労務士など顧問専門家", "実施機関の相談窓口"],
  },
  indirect_control: {
    question: "直接保有だけでなく間接保有を含めた場合、大企業による支配要件に該当しますか。",
    documents: ["株主名簿", "グループ全体の資本関係図"],
    specialists: ["税理士または公認会計士", "実施機関の相談窓口"],
  },
  high_income_rule: {
    question: "直近年度の課税所得等は、この制度固有の除外基準に該当しますか。",
    documents: ["直近の法人税申告書と決算書"],
    specialists: ["税理士または公認会計士", "実施機関の相談窓口"],
  },
  conditional_requirement: {
    question: "条件付きで申請できる場合の追加要件を、当社は満たしていますか。",
    documents: ["追加要件への対応状況が分かる資料"],
    specialists: ["中小企業診断士など補助金支援の専門家", "実施機関の相談窓口"],
  },
  program_rule: {
    question: "この制度では、みなし大企業や大企業の関係会社をどのように扱いますか。",
    documents: ["最新の公募要領・交付要綱・FAQ"],
    specialists: ["実施機関の相談窓口"],
  },
  research_and_development_costs: {
    question: "人件費、外注費、試作費、ソフトウェア開発費などのうち、制度上の研究開発費へ算入できる費用はどれですか。また、対象期間と売上高の計算方法は正しいですか。",
    documents: [
      "直近の決算書",
      "研究開発に関係する費用の内訳",
      "開発担当者と開発期間が分かる資料",
      "外注契約書・請求書・試作や実証の支出資料",
    ],
    specialists: ["税理士または公認会計士", "実施機関の相談窓口"],
  },
  partnership_structure: {
    question: "制度上必須となる連携先の役割、代表申請者、契約・合意書の要件を現在の協力体制で満たせますか。特定の候補企業以外でも代替できますか。",
    documents: ["連携体制図", "役割分担案", "基本合意書・共同研究契約などの案"],
    specialists: ["中小企業診断士など補助金支援の専門家", "実施機関の相談窓口"],
  },
};

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function createProfessionalConsultationBrief(
  input: ProfessionalConsultationBriefInput,
) {
  const guidance = input.issues.map((issue) => TOPIC_GUIDANCE[issue.topic]);
  const specialists = input.issues.length
    ? unique([
        "社会保険労務士など、継続的に相談している専門家（一次相談窓口）",
        ...guidance.flatMap((item) => item.specialists),
      ])
    : [];
  const questions = unique(guidance.map((item) => item.question));
  const documents = unique(guidance.flatMap((item) => item.documents));
  const facts = unique(input.confirmedFacts ?? []);
  const readyToSendMessage = input.issues.length ? {
    subject: `${input.subsidyName ?? "補助金候補"}の初期相談について`,
    body: [
      "お世話になっております。",
      `${input.companyName ? `${input.companyName}について、` : ""}${input.subsidyName ? `「${input.subsidyName}」を` : "補助金の活用を"}候補として検討しています。申請資格や採択が確定した段階ではなく、まず初期相談をお願いしたいと考えています。`,
      input.publicBusinessSummary ? `事業の概要：${input.publicBusinessSummary}` : null,
      input.sourceUrl ? `参照資料：${input.sourceUrl}` : null,
      facts.length ? `調査で確認できた事項：\n${facts.map((fact) => `・${fact}`).join("\n")}` : null,
      `確認したい事項：\n${input.issues.map((issue) => `・${issue.summary}\n  ${TOPIC_GUIDANCE[issue.topic].question}`).join("\n")}`,
      input.applicationDeadline ? `把握している申請締切：${input.applicationDeadline}（対象の公募回と最新日程もご確認ください）` : "申請締切は未確認です。現在の受付状況と準備が間に合うかも確認したいです。",
      input.consultBy ? `相談希望期限：${input.consultBy}` : null,
      `準備資料の候補：\n${documents.map((document) => `・${document}`).join("\n")}\n必要な資料と共有方法をご指定ください。非公開資料は、共有先・方法を確認したうえで別途お渡しします。`,
      "ご対応可能でしょうか。ご専門外の論点は、対応できる専門家や実施機関の窓口をご紹介いただけると助かります。初期相談の費用と進め方もお知らせください。",
    ].filter(Boolean).join("\n\n"),
  } : null;
  return {
    recommended: input.issues.length > 0,
    statusLabel: input.issues.length
      ? "専門家へ相談する論点を整理しました"
      : "現時点で個別の相談論点はありません",
    purpose:
      "AIの調査結果をもとに、人間の専門家が申請資格と対応方針を判断するための引き継ぎメモです。",
    subsidyName: input.subsidyName ?? null,
    sourceUrl: input.sourceUrl ?? null,
    confirmedFacts: facts,
    consultationPoints: input.issues.map((issue) => issue.summary),
    recommendedProfessionals: specialists,
    questions,
    documentsToPrepare: documents,
    readyToSendMessage,
    nextAction: readyToSendMessage
      ? "以下の相談文を確認し、顧問社労士など普段の相談先へコピーして送ってください。"
      : null,
    presentationGuidance: readyToSendMessage
      ? "利用者が候補の検討・専門家への相談に進む場合は、nextActionとreadyToSendMessageをコピーできる相談文として提示してください。『専門家へ相談してください』だけに要約せず、制度名・参照URL・確認事項を引き継いでください。候補探索中は長い相談文を毎回表示する必要はありません。自動送信はしません。"
      : null,
    applicationDeadline: input.applicationDeadline ?? null,
    consultBy: input.consultBy ?? null,
    schedulingGuidance:
      input.consultBy
        ? "表示された相談期限までに、確認事項と準備資料を専門家へ共有してください。"
        : "専門家への相談期限は未設定です。申請締切、社内決裁、資料取得に必要な期間から逆算して決めてください。",
    decisionBoundary:
      "このメモは検討材料です。申請可否、費用区分、提出内容の最終判断と責任は、申請者と担当する人間の専門家が負います。",
    dataHandling:
      "株主名簿、決算書、賃金台帳などの非公開資料は、このMCPやD1へ保存せず、利用者から専門家へ直接共有してください。",
  };
}
