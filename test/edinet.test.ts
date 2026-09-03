import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  EdinetApiError,
  parseCsv,
  verifyCorporateRelationship,
} from "../src/edinet";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function archive(fileName: string, text: string): Uint8Array {
  return zipSync({ [fileName]: strToU8(text) });
}

function codeList(...records: string[]): Uint8Array {
  return archive(
    "EdinetcodeDlInfo.csv",
    [
      "metadata",
      "code,type,listing,consolidated,capital,fiscal,name,name_en,kana,location,industry,securities,corporate_number",
      ...records,
    ].join("\n"),
  );
}

function binaryResponse(bytes: Uint8Array): Response {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: { "content-type": "application/zip" },
  });
}

test("引用符と改行を含むCSVを解析する", () => {
  assert.deepEqual(parseCsv('a,"b,b","c\n続き"\r\nd,e,f'), [
    ["a", "b,b", "c\n続き"],
    ["d", "e", "f"],
  ]);
});

test("親会社候補をEDINET提出書類で確認し根拠を返す", async () => {
  const requestedUrls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url.toString());
    if (url.hostname === "disclosure2dl.edinet-fsa.go.jp") {
      return binaryResponse(
        codeList(
          '"E00001","company","listed","yes","","","Parent Holdings","","","Tokyo","","12340","1234567890123"',
        ),
      );
    }
    if (url.pathname.endsWith("/documents.json")) {
      assert.equal(url.searchParams.get("date"), "2026-06-26");
      assert.equal(url.searchParams.get("Subscription-Key"), "edinet-secret");
      return Response.json({
        results: [
          {
            docID: "S100TEST",
            edinetCode: "E00001",
            filerName: "Parent Holdings",
            docDescription: "有価証券報告書",
            docTypeCode: "120",
            submitDateTime: "2026-06-26 10:00",
            periodStart: "2025-04-01",
            periodEnd: "2026-03-31",
            csvFlag: "1",
            legalStatus: "1",
          },
        ],
      });
    }
    if (url.pathname.endsWith("/documents/S100TEST")) {
      assert.equal(url.searchParams.get("type"), "5");
      assert.equal(url.searchParams.get("Subscription-Key"), "edinet-secret");
      return binaryResponse(
        archive(
          "XBRL_TO_CSV/report.csv",
          'element,関係会社の状況,text,"連結子会社 株式会社トレファクテクノロジーズ 議決権所有割合100%"',
        ),
      );
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const result = await verifyCorporateRelationship(
    {
      targetCompanyName: "株式会社トレファクテクノロジーズ",
      targetCorporateNumber: "7010001224615",
      parentCompanyName: "Parent Holdings",
      parentCorporateNumber: "1234567890123",
      filingDate: "2026-06-26",
    },
    "edinet-secret",
  );

  assert.equal(result.assessment.status, "confirmed");
  assert.equal(result.filing?.documentId, "S100TEST");
  assert.deepEqual(result.assessment.percentages, ["100%"]);
  assert.equal(result.assessment.evidence.length, 1);
  assert.equal(result.largeEnterpriseAffiliation?.requiresGuidelineReview, true);
  assert.equal(JSON.stringify(result).includes("edinet-secret"), false);
  assert.equal(requestedUrls.length, 3);
});

test("確認書類に対象会社がない場合も資本関係なしと断定しない", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "disclosure2dl.edinet-fsa.go.jp") {
      return binaryResponse(
        codeList(
          '"E00001","company","listed","yes","","","Parent Holdings","","","Tokyo","","12340","1234567890123"',
        ),
      );
    }
    if (url.pathname.endsWith("/documents.json")) {
      return Response.json({
        results: [
          {
            docID: "S100TEST",
            edinetCode: "E00001",
            filerName: "Parent Holdings",
            docDescription: "有価証券報告書",
            docTypeCode: "120",
            csvFlag: "1",
            legalStatus: "1",
          },
        ],
      });
    }
    return binaryResponse(
      archive("XBRL_TO_CSV/report.csv", "element,item,value,該当記載なし"),
    );
  };

  const result = await verifyCorporateRelationship(
    {
      targetCompanyName: "Target Company",
      parentCompanyName: "Parent Holdings",
      filingDate: "2026-06-26",
    },
    "edinet-secret",
  );

  assert.equal(result.assessment.status, "not_found_in_checked_filing");
  assert.match(result.assessment.reason, /意味するものではありません/u);
});

test("同名の親会社候補を推測で一社に決めない", async () => {
  globalThis.fetch = async () =>
    binaryResponse(
      codeList(
        '"E00001","company","listed","yes","","","Parent Holdings","","","Tokyo","","12340","1234567890123"',
        '"E00002","company","listed","yes","","","Parent Holdings","","","Osaka","","56780","9876543210987"',
      ),
    );

  const result = await verifyCorporateRelationship(
    {
      targetCompanyName: "Target Company",
      parentCompanyName: "Parent Holdings",
    },
    "edinet-secret",
  );

  assert.equal(result.assessment.status, "unknown");
  assert.equal(result.assessment.parentCandidates.length, 2);
  assert.match(result.assessment.reason, /複数/u);
});

test("APIキー未設定では外部APIを呼ばない", async () => {
  globalThis.fetch = async () => {
    throw new Error("fetch must not be called");
  };

  await assert.rejects(
    () =>
      verifyCorporateRelationship({
        targetCompanyName: "Target Company",
        parentCompanyName: "Parent Holdings",
      }),
    (error: unknown) =>
      error instanceof EdinetApiError &&
      error.code === "configuration_error",
  );
});
