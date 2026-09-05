import assert from "node:assert/strict";
import test from "node:test";
import { createProfessionalConsultationBrief } from "../src/professionalConsultation";

test("研究開発費の可能性を専門家への具体的な質問と準備資料に変換する", () => {
  const result = createProfessionalConsultationBrief({
    subsidyName: "研究開発支援事業",
    sourceUrl: "https://example.go.jp/guideline",
    confirmedFacts: ["公開情報で技術開発実績を確認しました。"],
    issues: [
      {
        topic: "research_and_development_costs",
        summary: "売上高研究開発費割合5%以上を満たすか確認が必要です。",
      },
    ],
    consultBy: "2026-10-01",
  });

  assert.equal(result.recommended, true);
  assert.ok(
    result.recommendedProfessionals.some((professional) =>
      professional.includes("税理士または公認会計士"),
    ),
  );
  assert.ok(
    result.questions.some((question) =>
      question.includes("人件費、外注費、試作費、ソフトウェア開発費"),
    ),
  );
  assert.ok(result.documentsToPrepare.includes("直近の決算書"));
  assert.equal(result.consultBy, "2026-10-01");
  assert.match(result.decisionBoundary, /最終判断と責任/u);
  assert.match(result.dataHandling, /MCPやD1へ保存せず/u);
  assert.ok(result.readyToSendMessage);
  assert.match(result.readyToSendMessage.body, /研究開発支援事業/u);
  assert.match(result.readyToSendMessage.body, /https:\/\/example.go.jp\/guideline/u);
  assert.match(result.readyToSendMessage.body, /売上高研究開発費割合5%以上/u);
  assert.match(result.readyToSendMessage.body, /相談希望期限：2026-10-01/u);
  assert.match(result.readyToSendMessage.body, /初期相談の費用/u);
  assert.match(result.readyToSendMessage.body, /資料と共有方法/u);
});

test("公開企業情報と締切を引き継ぎ、確定した申請として依頼しない", () => {
  const result = createProfessionalConsultationBrief({
    companyName: "テスト株式会社",
    publicBusinessSummary: "電力管理システムの開発",
    subsidyName: "実証支援制度",
    applicationDeadline: "2026-10-30 18:00 JST",
    issues: [{ topic: "corporate_relationship", summary: "株主構成は未確認です。" }],
  });
  const body = result.readyToSendMessage!.body;
  assert.match(body, /テスト株式会社/u);
  assert.match(body, /電力管理システムの開発/u);
  assert.match(body, /2026-10-30 18:00 JST/u);
  assert.match(body, /株主構成は未確認/u);
  assert.match(body, /申請資格や採択が確定した段階ではなく/u);
  assert.doesNotMatch(body, /相談希望期限：/u);
  assert.match(result.presentationGuidance!, /候補探索中/u);
});

test("不足する会社名・制度名・URL・期限を捏造せず送れる文面にする", () => {
  const result = createProfessionalConsultationBrief({
    issues: [{ topic: "business_plans", summary: "対象経費を確認したいです。" }],
  });
  const body = result.readyToSendMessage!.body;
  assert.match(body, /申請締切は未確認/u);
  assert.match(body, /補助金の活用を候補として/u);
  assert.doesNotMatch(body, /undefined|null|参照資料：|相談希望期限：|\[会社名\]/u);
});

test("相談論点がない場合は相談文や送信の案内を生成しない", () => {
  const result = createProfessionalConsultationBrief({ issues: [] });
  assert.equal(result.recommended, false);
  assert.equal(result.readyToSendMessage, null);
  assert.equal(result.nextAction, null);
  assert.equal(result.presentationGuidance, null);
});

test("同じ相談先と資料を重複表示しない", () => {
  const result = createProfessionalConsultationBrief({
    issues: [
      { topic: "capital_yen", summary: "資本金要件の確認が必要です。" },
      {
        topic: "corporate_relationship",
        summary: "株主構成の確認が必要です。",
      },
    ],
  });

  assert.equal(
    result.recommendedProfessionals.length,
    new Set(result.recommendedProfessionals).size,
  );
  assert.equal(
    result.documentsToPrepare.length,
    new Set(result.documentsToPrepare).size,
  );
});
