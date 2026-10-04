import { resolve4, resolve6 } from "node:dns/promises";
import { isIP } from "node:net";
import { DocumentError, type FetchPolicy } from "./types";

const SECRET_KEY = /(?:token|signature|credential|password|session|authorization|api[-_]?key|x-amz-|x-goog-)/i;
export function permittedUrl(raw: string, policy: FetchPolicy, kind: "pages" | "files"): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new DocumentError("unsafe_url"); }
  if (url.href.length > 4096 || url.protocol !== "https:" || url.port || url.username || url.password ||
      isIP(url.hostname.replace(/^\[|\]$/g, "")) || !url.hostname.includes(".") ||
      /(?:\.|^)(?:localhost|local|internal|lan|home|invalid)$/.test(url.hostname)) throw new DocumentError("unsafe_url");
  if (/%(?:2f|5c|00)/i.test(url.pathname) || /\\/.test(url.pathname)) throw new DocumentError("unsafe_url");
  const matches = policy[kind].filter(rule => rule.hostname === url.hostname &&
    (url.pathname === rule.pathPrefix || (rule.pathPrefix.endsWith("/") && url.pathname.startsWith(rule.pathPrefix))));
  const queryKeys: string[] = [];
  url.searchParams.forEach((_value,key) => queryKeys.push(key));
  if (!matches.some(rule => queryKeys.every(key => !SECRET_KEY.test(key) && (rule.queryKeys.includes(key) ||
      rule.allowEmptyHexCacheBust && /^[0-9a-f]{8}$/i.test(key) && url.searchParams.getAll(key).every(value=>value===""))))) {
    throw new DocumentError("unsafe_url");
  }
  if (url.hash && SECRET_KEY.test(url.hash)) throw new DocumentError("unsafe_url");
  return url;
}
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 ||
      a === 192 && b === 0 || a === 192 && b === 88 && c === 99 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
      a === 203 && b === 0 && c === 113);
  }
  // Fail closed for special-use, mapped IPv4, transition and local IPv6 ranges.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^200[12]:/i.test(address);
}
export async function resolvePublicHost(host: string): Promise<string[]> {
  const results = await Promise.allSettled([resolve4(host), resolve6(host)]);
  return results.flatMap(r => r.status === "fulfilled" ? r.value : []);
}
export type Network = {
  fetch: typeof fetch; resolveHost: (host: string) => Promise<string[]>;
  requests: number; maxRequests: number; deadline: number;
};
export function createNetwork(options: Partial<Network> = {}): Network {
  return { fetch: (input, init) => fetch(input, init), resolveHost: resolvePublicHost, requests: 0, maxRequests: 350, deadline: Date.now() + 180_000, ...options };
}
export type Resource = { status: number; url: string; headers: Headers; body: string; truncated: boolean };
export async function fetchResource(raw: string, policy: FetchPolicy, kind: "pages" | "files", network: Network,
  options: { method?: "HEAD" | "GET"; headers?: Record<string,string>; maxBytes: number; allowTruncate?: boolean }): Promise<Resource> {
  const controller = new AbortController();
  const remaining = Math.min(15_000, network.deadline - Date.now());
  if (remaining <= 0) throw new DocumentError("processing_limit");
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    let rawUrl = raw;
    for (let hop = 0; hop <= 3; hop++) {
      const url = permittedUrl(rawUrl, policy, kind);
      if (++network.requests > network.maxRequests) throw new DocumentError("processing_limit");
      const addresses = await Promise.race([
        network.resolveHost(url.hostname),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new DocumentError("timeout")), { once: true })),
      ]);
      if (!addresses.length || addresses.some(x => !isPublicAddress(x))) throw new DocumentError("unsafe_dns");
      const response = await network.fetch(url, { method: options.method ?? "GET", redirect: "manual", credentials: "omit",
        headers: { "User-Agent": "SubsidyAI-Documents/1.0", ...options.headers }, signal: controller.signal });
      if ([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location || hop === 3) throw new DocumentError("redirect_limit");
        rawUrl = new URL(location, url).href;
        continue;
      }
      if (options.method === "HEAD" || response.status === 304 || !response.ok) {
        await response.body?.cancel();
        return { status: response.status, headers: response.headers, url: url.href, body: "", truncated: false };
      }
      let bytes = 0, body = "", truncated = false;
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      try {
        if (reader) while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const allowed = Math.max(0, options.maxBytes - bytes);
          bytes += chunk.value.length;
          body += decoder.decode(chunk.value.subarray(0, allowed), { stream: true });
          if (bytes > options.maxBytes) {
            truncated = true;
            if (!options.allowTruncate) throw new DocumentError("body_limit");
            break;
          }
        }
        body += decoder.decode();
      } finally { await reader?.cancel().catch(() => {}); }
      return { status: response.status, headers: response.headers, url: url.href, body, truncated };
    }
    throw new DocumentError("redirect_limit");
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError(controller.signal.aborted ? "timeout" : "upstream_error");
  } finally { clearTimeout(timer); }
}
