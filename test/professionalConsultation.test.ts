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
