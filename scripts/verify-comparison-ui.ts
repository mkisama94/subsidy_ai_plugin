import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildComparison } from "../src/comparison/data";
import { comparisonHtml } from "../src/ui/comparison";
import { comparisonFixture } from "../test/fixtures/comparison";

const fixture = comparisonFixture();
// Exercise hostile text with the same rendering code used by the real UI.
fixture.rows[0].details.push('<img src=x onerror="window.injected=true">');
const data = buildComparison(comparisonFixture()).data;
const hostileData = buildComparison(fixture).data;
const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
const preview = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>補助金比較UI 検証用プレビュー</title><style>body{margin:0;font-family:system-ui;background:#f4f5f7}header{padding:16px;color:#444;font-size:13px}iframe{border:0;width:100%;height:850px;background:white}</style><header>ローカル検証用：ChatGPTホストを模擬したデモです。制度・数値は架空です。</header><iframe id="widget" title="補助金比較"></iframe><script>
const frame=document.getElementById('widget');const data=${json(data)};
function deliver(value){frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:value}},'*')}
window.addEventListener('message',e=>{if(e.source!==frame.contentWindow)return;const m=e.data;if(m?.method==='ui/initialize')frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'local-qa',version:'1'},hostCapabilities:{}}},'*');if(m?.method==='ui/notifications/initialized')deliver(data)});
frame.srcdoc=${json(comparisonHtml)};
</script></html>`;
const dir = resolve(process.env.COMPARISON_QA_DIR ?? ".wrangler/comparison-qa"); mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "demo-preview.html"), preview);
if (process.argv.includes("--preview-only")) {
  console.log(`Preview: ${resolve(dir, "demo-preview.html")}`);
} else {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH ?? "playwright");
  const browser = await chromium.launch({ headless: true, ...(process.env.COMPARISON_BROWSER_CHANNEL ? { channel: process.env.COMPARISON_BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setContent(preview);
    const frame = page.frameLocator("#widget");
    await frame.locator("#rows > tr:not(.detail)").first().waitFor();
    assert.equal(await frame.locator("#rows > tr:not(.detail)").count(), 3);
    assert.match(await frame.locator("body").innerText(), /実績未登録/);
    assert.match(await frame.locator("body").innerText(), /取得失敗/);
    const names = async () => frame.locator("#rows > tr:not(.detail) td:first-child strong").allTextContents();
    for (const sort of ["rate", "amount", "deadline"]) {
      await frame.locator("#sort").selectOption(sort);
      assert.deepEqual(await names(), ["省力化支援（架空）", "設備更新支援（架空）", "地域実証支援（架空）"]);
    }
    await frame.locator("#sort").selectOption("original");
    assert.equal((await names())[0], "設備更新支援（架空）");
    await page.evaluate(value => { (window as any).deliver(value); }, hostileData);
    await frame.locator("#toggle-0").click();
    assert.equal(await frame.locator("#toggle-0").getAttribute("aria-expanded"), "true");
    assert.match(await frame.locator("#detail-0").innerText(), /申請 1000件・採択 400件/);
    assert.equal(await frame.locator("#detail-0 img").count(), 0);
    assert.equal(await frame.locator("#detail-0 a").first().getAttribute("rel"), "noopener noreferrer");
    await page.evaluate(value => { (window as any).deliver(value); }, data);
    assert.equal(await frame.locator("#toggle-0").getAttribute("aria-expanded"), "false");
    await page.screenshot({ path: resolve(dir, "desktop.png"), clip: { x: 0, y: 0, width: 1280, height: 520 } });
    await frame.locator("#toggle-0").click();
    await page.screenshot({ path: resolve(dir, "details.png"), fullPage: true });
    await frame.locator("#toggle-0").click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await frame.locator(".scroll").evaluate(el => el.scrollWidth > el.clientWidth), true);
    assert.equal(await frame.locator("body").evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: resolve(dir, "mobile.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: resolve(dir, "dark.png"), clip: { x: 0, y: 0, width: 1280, height: 520 } });
    // Updates replace prior data and close details; unsupported data shows a fallback.
    await page.evaluate(() => { (window as any).deliver({ schemaVersion: "wrong", rows: [] }); });
    assert.match(await frame.locator("#status").innerText(), /表示できません/);
    assert.equal(await frame.locator("#table-wrap").isHidden(), true);
    assert.deepEqual(errors, []);
    console.log("PASS: bridge, 3 rows, 3 sorts, nulls last, detail expansion, safe text/links, mobile overflow, invalid data fallback; desktop/mobile/dark screenshots saved.");
  } finally { await browser.close(); }
}
