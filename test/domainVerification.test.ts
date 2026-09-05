import assert from "node:assert/strict";
import test from "node:test";
import { createDomainVerificationResponse } from "../src/index";

test("OpenAIのドメイン検証トークンだけをプレーンテキストで返す", async () => {
  const response = createDomainVerificationResponse("  challenge-token  ");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "challenge-token");
});

test("ドメイン検証トークンが未設定なら公開しない", async () => {
  for (const token of [undefined, "", "   "]) {
    const response = createDomainVerificationResponse(token);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Not found" });
  }
});
