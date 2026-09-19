import {verifyOfficialResearchSource,calculateOfficialSelectionRate} from './public-repo/src/selectionStatistics.ts';
const originalFetch=globalThis.fetch;
try {
  globalThis.fetch=async()=>new Response('<html><body>2026年度 第1回 申請100件 採択40件</body></html>',{headers:{'content-type':'text/html'}});
  const verified=await verifyOfficialResearchSource('https://example.go.jp/result','2026年度 第1回 申請100件 採択40件');
  const calculation=calculateOfficialSelectionRate({applicationsCount:100,selectedCount:90,comparability:'confirmed_same_round_and_scope'},'official_result');
  console.log(JSON.stringify({scope:'Local mocked functions only; no live service or D1 writes',documentCounts:{applications:100,selected:40},submittedCounts:{applications:100,selected:90},sourceCheckPassed:!!verified.contentHash,calculation},null,2));
} finally { globalThis.fetch=originalFetch; }
