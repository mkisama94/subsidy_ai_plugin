1: import { resolve4, resolve6 } from "node:dns/promises";
2: import { isIP } from "node:net";
3: import { DocumentError, type FetchPolicy } from "./types";
4: 
5: const SECRET_KEY = /(?:token|signature|credential|password|session|authorization|api[-_]?key|x-amz-|x-goog-)/i;
6: export function permittedUrl(raw: string, policy: FetchPolicy, kind: "pages" | "files"): URL {
7:   let url: URL;
8:   try { url = new URL(raw); } catch { throw new DocumentError("unsafe_url"); }
9:   if (url.href.length > 4096 || url.protocol !== "https:" || url.port || url.username || url.password ||
10:       isIP(url.hostname.replace(/^\[|\]$/g, "")) || !url.hostname.includes(".") ||
11:       /(?:\.|^)(?:localhost|local|internal|lan|home|invalid)$/.test(url.hostname)) throw new DocumentError("unsafe_url");
12:   if (/%(?:2f|5c|00)/i.test(url.pathname) || /\\/.test(url.pathname)) throw new DocumentError("unsafe_url");
13:   const matches = policy[kind].filter(rule => rule.hostname === url.hostname &&
14:     (url.pathname === rule.pathPrefix || (rule.pathPrefix.endsWith("/") && url.pathname.startsWith(rule.pathPrefix))));
15:   const queryKeys: string[] = [];
16:   url.searchParams.forEach((_value,key) => queryKeys.push(key));
17:   if (!matches.some(rule => queryKeys.every(key => !SECRET_KEY.test(key) && (rule.queryKeys.includes(key) ||
18:       rule.allowEmptyHexCacheBust && /^[0-9a-f]{8}$/i.test(key) && url.searchParams.getAll(key).every(value=>value===""))))) {
19:     throw new DocumentError("unsafe_url");
20:   }
21:   if (url.hash && SECRET_KEY.test(url.hash)) throw new DocumentError("unsafe_url");
22:   return url;
23: }
24: export function isPublicAddress(address: string): boolean {
25:   if (isIP(address) === 4) {
26:     const [a,b,c] = address.split(".").map(Number);
27:     return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 ||
28:       a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 ||
29:       a === 192 && b === 0 || a === 192 && b === 88 && c === 99 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
30:       a === 203 && b === 0 && c === 113);
31:   }
32:   // Fail closed for special-use, mapped IPv4, transition and local IPv6 ranges.
33:   return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^200[12]:/i.test(address);
34: }
35: export async function resolvePublicHost(host: string): Promise<string[]> {
36:   const results = await Promise.allSettled([resolve4(host), resolve6(host)]);
37:   return results.flatMap(r => r.status === "fulfilled" ? r.value : []);
38: }
39: export type Network = {
40:   fetch: typeof fetch; resolveHost: (host: string) => Promise<string[]>;
41:   requests: number; maxRequests: number; deadline: number;
42: };
43: export function createNetwork(options: Partial<Network> = {}): Network {
44:   return { fetch: (input, init) => fetch(input, init), resolveHost: resolvePublicHost, requests: 0, maxRequests: 350, deadline: Date.now() + 180_000, ...options };
45: }
46: export type Resource = { status: number; url: string; headers: Headers; body: string; truncated: boolean };
47: export async function fetchResource(raw: string, policy: FetchPolicy, kind: "pages" | "files", network: Network,
48:   options: { method?: "HEAD" | "GET"; headers?: Record<string,string>; maxBytes: number; allowTruncate?: boolean }): Promise<Resource> {
49:   const controller = new AbortController();
50:   const remaining = Math.min(15_000, network.deadline - Date.now());
51:   if (remaining <= 0) throw new DocumentError("processing_limit");
52:   const timer = setTimeout(() => controller.abort(), remaining);
53:   try {
54:     let rawUrl = raw;
55:     for (let hop = 0; hop <= 3; hop++) {
56:       const url = permittedUrl(rawUrl, policy, kind);
57:       if (++network.requests > network.maxRequests) throw new DocumentError("processing_limit");
58:       const addresses = await Promise.race([
59:         network.resolveHost(url.hostname),
60:         new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new DocumentError("timeout")), { once: true })),
61:       ]);
62:       if (!addresses.length || addresses.some(x => !isPublicAddress(x))) throw new DocumentError("unsafe_dns");
63:       const response = await network.fetch(url, { method: options.method ?? "GET", redirect: "manual", credentials: "omit",
64:         headers: { "User-Agent": "SubsidyAI-Documents/1.0", ...options.headers }, signal: controller.signal });
65:       if ([301,302,303,307,308].includes(response.status)) {
66:         await response.body?.cancel();
67:         const location = response.headers.get("location");
68:         if (!location || hop === 3) throw new DocumentError("redirect_limit");
69:         rawUrl = new URL(location, url).href;
70:         continue;
71:       }
72:       if (options.method === "HEAD" || response.status === 304 || !response.ok) {
73:         await response.body?.cancel();
74:         return { status: response.status, headers: response.headers, url: url.href, body: "", truncated: false };
75:       }
76:       let bytes = 0, body = "", truncated = false;
77:       const reader = response.body?.getReader();
78:       const decoder = new TextDecoder();
79:       try {
80:         if (reader) while (true) {
81:           const chunk = await reader.read();
82:           if (chunk.done) break;
83:           const allowed = Math.max(0, options.maxBytes - bytes);
84:           bytes += chunk.value.length;
85:           body += decoder.decode(chunk.value.subarray(0, allowed), { stream: true });
86:           if (bytes > options.maxBytes) {
87:             truncated = true;
88:             if (!options.allowTruncate) throw new DocumentError("body_limit");
89:             break;
90:           }
91:         }
92:         body += decoder.decode();
93:       } finally { await reader?.cancel().catch(() => {}); }
94:       return { status: response.status, headers: response.headers, url: url.href, body, truncated };
95:     }
96:     throw new DocumentError("redirect_limit");
97:   } catch (error) {
98:     if (error instanceof DocumentError) throw error;
99:     throw new DocumentError(controller.signal.aborted ? "timeout" : "upstream_error");
100:   } finally { clearTimeout(timer); }
101: }