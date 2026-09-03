import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  inferredFilingDates,
  verifyCorporateRelationship,
} from "../src/edinet";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function zipResponse(fileName: string, text: string): Response {
  const bytes = zipSync({ [fileName]: strToU8(text) });
  return new Response(bytes as unknown as BodyInit);
}

test("対象会社の比率だけを返し、書類発見後は日付検索を打ち切る", async () => {
  const inferredDates = inferredFilingDates("3月31日", new Date());
  const newestDate = inferredDates.at(-1)!;
  const requestedDates: string[] = [];

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "disclosure2dl.edinet-fsa.go.jp") {
      return zipResponse(
        "EdinetcodeDlInfo.csv",
        [
          "metadata",
          "headers",
          '"E00001","company","listed","yes","","3月31日","Parent Holdings","","","Tokyo","","12340","1234567890123"',
        ].join("\n"),
      );
    }
    if (url.pathname.endsWith("/documents.json")) {
      const date = url.searchParams.get("date")!;
      requestedDates.push(date);
      return Response.json({
        results:
          date === newestDate
            ? [
                {
                  docID: "S100EVIDENCE",
                  edinetCode: "E00001",
                  filerName: "Parent Holdings",
                  docDescription: "有価証券報告書",
                  docTypeCode: "120",
                  submitDateTime: `${newestDate} 10:00`,
                  periodStart: "2025-04-01",
                  periodEnd: "2026-03-31",
                  csvFlag: "1",
                  legalStatus: "1",
                },
              ]
            : [],
      });
    }
    if (url.pathname.endsWith("/documents/S100EVIDENCE")) {
      const relationshipBlock = [
        "jpcrp_cor:OverviewOfAffiliatedEntitiesTextBlock",
        "関係会社の状況 [テキストブロック]",
        "FilingDateInstant",
        "提出日時点",
        "(連結子会社)株式会社トレファクテクノロジーズ東京都千代田区10百万円100.0%システム開発事業",
        "(連結子会社)Treasure Factory (Thailand) Co., Ltd.タイ王国43百万円49.9%リユース事業",
      ].join("\t");
      const secondaryBlock = [
        "jpcrp_cor:NumberOfConsolidatedSubsidiariesAndNamesOfMajorConsolidatedSubsidiariesTextBlock",
        "連結子会社の数及び主要な連結子会社の名称 [テキストブロック]",
        "株式会社トレファクテクノロジーズ",
      ].join("\t");
      return zipResponse(
        "XBRL_TO_CSV/report.csv",
        `0,"${relationshipBlock}"\n1,"${secondaryBlock}"`,
      );
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const result = await verifyCorporateRelationship(
    {
      targetCompanyName: "株式会社トレファクテクノロジーズ",
      parentCompanyName: "Parent Holdings",
      parentCorporateNumber: "1234567890123",
    },
    "edinet-secret",
  );

  assert.equal(result.assessment.status, "confirmed");
  assert.deepEqual(result.assessment.percentages, ["100.0%"]);
  assert.equal(result.assessment.evidence.length, 2);
  assert.equal(
    result.assessment.evidence[0]?.itemName,
    "関係会社の状況 [テキストブロック]",
  );
  assert.equal(
    result.assessment.evidence[0]?.snippet.includes("49.9%"),
    false,
  );
  assert.equal(requestedDates.length, 8);
  assert.equal(result.filing?.checkedDateRange?.count, 8);
  assert.equal(result.filing?.checkedDateRange?.to, newestDate);
});
