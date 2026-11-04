1: import { fetchResource, type Network } from "./sourcePolicy";
2: import { DocumentError, iso, type Candidate, type FetchPolicy, type LinkResult } from "./types";
3: 
4: export async function checkLink(candidate: Candidate, policy: FetchPolicy, network: Network, now: number, interval: number): Promise<LinkResult> {
5:   const result: LinkResult = { linkStatus: "not_direct", linkLastCheckedAt: null, linkLastSuccessAt: null, linkFreshUntil: null,
6:     linkHttpStatus: null, linkCheckMethod: null, resolvedUrl: null, mimeType: null };
7:   if (!candidate.fileUrl) return result;
8:   result.linkLastCheckedAt = iso(now);
9:   try {
10:     let response = await fetchResource(candidate.fileUrl, policy, "files", network, { method: "HEAD", maxBytes: 0 });
11:     result.linkCheckMethod = "HEAD";
12:     if ([403,405,501].includes(response.status)) {
13:       response = await fetchResource(candidate.fileUrl, policy, "files", network, { maxBytes: 65_536, allowTruncate: true, headers: { Range: "bytes=0-65535" } });
14:       result.linkCheckMethod = "bounded_get";
15:     }
16:     result.linkHttpStatus = response.status;
17:     result.mimeType = response.headers.get("content-type")?.split(";")[0].toLowerCase() ?? null;
18:     if ([404,410].includes(response.status)) result.linkStatus = "broken";
19:     else if ([401,403].includes(response.status)) result.linkStatus = "blocked";
20:     else if (response.status >= 200 && response.status < 300) {
21:       const mime = result.mimeType ?? "";
22:       const html = /html|json/.test(mime) || /^\s*<(?:!doctype|html|head|body)/i.test(response.body);
23:       const expected:Record<string,string[]>={pdf:["application/pdf"],doc:["application/msword"],xls:["application/vnd.ms-excel"],
24:         docx:["application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/zip"],
25:         xlsx:["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/zip"],zip:["application/zip","application/x-zip-compressed"],csv:["text/csv","text/plain"]};
26:       const mismatch=expected[candidate.fileType] && mime!=="application/octet-stream" && !expected[candidate.fileType].includes(mime);
27:       result.linkStatus = html ? "blocked" : !mime || mismatch ? "unverified" : "reachable";
28:       if (result.linkStatus === "reachable") {
29:         result.resolvedUrl = response.url; result.linkLastSuccessAt = iso(now); result.linkFreshUntil = iso(now + interval);
30:       }
31:     } else result.linkStatus = "unverified";
32:   } catch (error) {
33:     if (error instanceof DocumentError && error.code === "processing_limit") throw error;
34:     result.linkStatus = error instanceof DocumentError && ["unsafe_url","unsafe_dns","redirect_limit"].includes(error.code) ? "unsafe" : "unverified";
35:   }
36:   return result;
37: }