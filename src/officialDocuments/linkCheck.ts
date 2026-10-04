import { fetchResource, type Network } from "./sourcePolicy";
import { DocumentError, iso, type Candidate, type FetchPolicy, type LinkResult } from "./types";

export async function checkLink(candidate: Candidate, policy: FetchPolicy, network: Network, now: number, interval: number): Promise<LinkResult> {
  const result: LinkResult = { linkStatus: "not_direct", linkLastCheckedAt: null, linkLastSuccessAt: null, linkFreshUntil: null,
    linkHttpStatus: null, linkCheckMethod: null, resolvedUrl: null, mimeType: null };
  if (!candidate.fileUrl) return result;
  result.linkLastCheckedAt = iso(now);
  try {
    let response = await fetchResource(candidate.fileUrl, policy, "files", network, { method: "HEAD", maxBytes: 0 });
    result.linkCheckMethod = "HEAD";
    if ([403,405,501].includes(response.status)) {
      response = await fetchResource(candidate.fileUrl, policy, "files", network, { maxBytes: 65_536, allowTruncate: true, headers: { Range: "bytes=0-65535" } });
      result.linkCheckMethod = "bounded_get";
    }
    result.linkHttpStatus = response.status;
    result.mimeType = response.headers.get("content-type")?.split(";")[0].toLowerCase() ?? null;
    if ([404,410].includes(response.status)) result.linkStatus = "broken";
    else if ([401,403].includes(response.status)) result.linkStatus = "blocked";
    else if (response.status >= 200 && response.status < 300) {
      const mime = result.mimeType ?? "";
      const html = /html|json/.test(mime) || /^\s*<(?:!doctype|html|head|body)/i.test(response.body);
      const expected:Record<string,string[]>={pdf:["application/pdf"],doc:["application/msword"],xls:["application/vnd.ms-excel"],
        docx:["application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/zip"],
        xlsx:["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/zip"],zip:["application/zip","application/x-zip-compressed"],csv:["text/csv","text/plain"]};
      const mismatch=expected[candidate.fileType] && mime!=="application/octet-stream" && !expected[candidate.fileType].includes(mime);
      result.linkStatus = html ? "blocked" : !mime || mismatch ? "unverified" : "reachable";
      if (result.linkStatus === "reachable") {
        result.resolvedUrl = response.url; result.linkLastSuccessAt = iso(now); result.linkFreshUntil = iso(now + interval);
      }
    } else result.linkStatus = "unverified";
  } catch (error) {
    if (error instanceof DocumentError && error.code === "processing_limit") throw error;
    result.linkStatus = error instanceof DocumentError && ["unsafe_url","unsafe_dns","redirect_limit"].includes(error.code) ? "unsafe" : "unverified";
  }
  return result;
}
