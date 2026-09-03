import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { verifyCorporateRelationship } from "../src/edinet";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function zipResponse(fileName: string, text: string): Response {
  const bytes = zipSync({ [fileName]: strToU8(text) });
  return new Response(bytes as unknown as BodyInit);
}

test("指定された書類IDが親会社の提出書類であることを検証する", async () => {
  let archiveDownloaded = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "disclosure2dl.edinet-fsa.go.jp") {
      return zipResponse(
        "EdinetcodeDlInfo.csv",
        [
          "metadata",
          "headers",
          '"E00001","company","listed","yes","","","Parent Holdings","","","Tokyo","","12340","1234567890123"',
        ].join("\n"),
      );
    }
    if (url.pathname.endsWith("/documents.json")) {
      return Response.json({
        results: [
          {
            docID: "S100DIFFERENT",
            edinetCode: "E99999",
            filerName: "Different Filer",
            docDescription: "有価証券報告書",
            docTypeCode: "120",
            csvFlag: "1",
            legalStatus: "1",
          },
        ],
      });
    }
    archiveDownloaded = true;
    return zipResponse("report.csv", "unexpected");
  };

  const result = await verifyCorporateRelationship(
    {
      targetCompanyName: "Target Company",
      parentCompanyName: "Parent Holdings",
      parentCorporateNumber: "1234567890123",
      filingDate: "2026-06-26",
      documentId: "S100DIFFERENT",
    },
    "edinet-secret",
  );

  assert.equal(result.assessment.status, "unknown");
  assert.equal(archiveDownloaded, false);
});
