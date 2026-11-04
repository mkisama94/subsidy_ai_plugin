1: import assert from "node:assert/strict";
2: import { createRequire } from "node:module";
3: import { mkdirSync, writeFileSync } from "node:fs";
4: import { resolve } from "node:path";
5: import { buildComparison } from "../src/comparison/data";
6: import { comparisonHtml } from "../src/ui/comparison";
7: import { comparisonFixture } from "../test/fixtures/comparison";
8: 
9: const fixture = comparisonFixture();
10: // Exercise hostile text with the same rendering code used by the real UI.
11: fixture.rows[0].details.push('<img src=x onerror="window.injected=true">');
12: const data = buildComparison(comparisonFixture()).data;
13: const hostileData = buildComparison(fixture).data;
14: const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
15: const preview = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>補助金比較UI 検証用プレビュー</title><style>body{margin:0;font-family:system-ui;background:#f4f5f7}header{padding:16px;color:#444;font-size:13px}iframe{border:0;width:100%;height:850px;background:white}</style><header>ローカル検証用：ChatGPTホストを模擬したデモです。制度・数値は架空です。</header><iframe id="widget" title="補助金比較"></iframe><script>
16: const frame=document.getElementById('widget');const data=${json(data)};
17: function deliver(value){frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:value}},'*')}
18: window.addEventListener('message',e=>{if(e.source!==frame.contentWindow)return;const m=e.data;if(m?.method==='ui/initialize')frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'local-qa',version:'1'},hostCapabilities:{}}},'*');if(m?.method==='ui/notifications/initialized')deliver(data)});
19: frame.srcdoc=${json(comparisonHtml)};
20: </script></html>`;
21: const dir = resolve(process.env.COMPARISON_QA_DIR ?? ".wrangler/comparison-qa"); mkdirSync(dir, { recursive: true });
22: writeFileSync(resolve(dir, "demo-preview.html"), preview);
23: if (process.argv.includes("--preview-only")) {
24:   console.log(`Preview: ${resolve(dir, "demo-preview.html")}`);
25: } else {
26:   const require = createRequire(import.meta.url);
27:   const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH ?? "playwright");
28:   const browser = await chromium.launch({ headless: true, ...(process.env.COMPARISON_BROWSER_CHANNEL ? { channel: process.env.COMPARISON_BROWSER_CHANNEL } : {}) });
29:   try {
30:     const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
31:     const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
32:     await page.setContent(preview);
33:     const frame = page.frameLocator("#widget");
34:     await frame.locator("#rows > tr:not(.detail)").first().waitFor();
35:     assert.equal(await frame.locator("#rows > tr:not(.detail)").count(), 3);
36:     assert.match(await frame.locator("body").innerText(), /実績未登録/);
37:     assert.match(await frame.locator("body").innerText(), /取得失敗/);
38:     const names = async () => frame.locator("#rows > tr:not(.detail) td:first-child strong").allTextContents();
39:     for (const sort of ["rate", "amount", "deadline"]) {
40:       await frame.locator("#sort").selectOption(sort);
41:       assert.deepEqual(await names(), ["省力化支援（架空）", "設備更新支援（架空）", "地域実証支援（架空）"]);
42:     }
43:     await frame.locator("#sort").selectOption("original");
44:     assert.equal((await names())[0], "設備更新支援（架空）");
45:     await page.evaluate(value => { (window as any).deliver(value); }, hostileData);
46:     await frame.locator("#toggle-0").click();
47:     assert.equal(await frame.locator("#toggle-0").getAttribute("aria-expanded"), "true");
48:     assert.match(await frame.locator("#detail-0").innerText(), /申請 1000件・採択 400件/);
49:     assert.equal(await frame.locator("#detail-0 img").count(), 0);
50:     assert.equal(await frame.locator("#detail-0 a").first().getAttribute("rel"), "noopener noreferrer");
51:     await page.evaluate(value => { (window as any).deliver(value); }, data);
52:     assert.equal(await frame.locator("#toggle-0").getAttribute("aria-expanded"), "false");
53:     await page.screenshot({ path: resolve(dir, "desktop.png"), clip: { x: 0, y: 0, width: 1280, height: 520 } });
54:     await frame.locator("#toggle-0").click();
55:     await page.screenshot({ path: resolve(dir, "details.png"), fullPage: true });
56:     await frame.locator("#toggle-0").click();
57:     await page.setViewportSize({ width: 390, height: 844 });
58:     assert.equal(await frame.locator(".scroll").evaluate(el => el.scrollWidth > el.clientWidth), true);
59:     assert.equal(await frame.locator("body").evaluate(el => el.scrollWidth <= el.clientWidth), true);
60:     await page.screenshot({ path: resolve(dir, "mobile.png"), fullPage: true });
61:     await page.emulateMedia({ colorScheme: "dark" });
62:     await page.setViewportSize({ width: 1280, height: 900 });
63:     await page.screenshot({ path: resolve(dir, "dark.png"), clip: { x: 0, y: 0, width: 1280, height: 520 } });
64:     // Updates replace prior data and close details; unsupported data shows a fallback.
65:     await page.evaluate(() => { (window as any).deliver({ schemaVersion: "wrong", rows: [] }); });
66:     assert.match(await frame.locator("#status").innerText(), /表示できません/);
67:     assert.equal(await frame.locator("#table-wrap").isHidden(), true);
68:     assert.deepEqual(errors, []);
69:     console.log("PASS: bridge, 3 rows, 3 sorts, nulls last, detail expansion, safe text/links, mobile overflow, invalid data fallback; desktop/mobile/dark screenshots saved.");
70:   } finally { await browser.close(); }
71: }