1: export type PublicApiCacheEntry<T> = {
2:   value: T;
3:   fetchedAt: number;
4:   expiresAt: number;
5:   staleUntil: number;
6: };
7: 
8: export interface PublicApiCache {
9:   get<T>(key: string): Promise<PublicApiCacheEntry<T> | null>;
10:   put<T>(
11:     key: string,
12:     source: string,
13:     resourceType: string,
14:     entry: PublicApiCacheEntry<T>,
15:   ): Promise<void>;
16: }
17: 
18: type CacheRow = {
19:   payload_json: string;
20:   fetched_at: number;
21:   expires_at: number;
22:   stale_until: number;
23: };
24: 
25: function bytesToHex(bytes: Uint8Array): string {
26:   return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
27: }
28: 
29: async function sha256(value: string): Promise<string> {
30:   const digest = await crypto.subtle.digest(
31:     "SHA-256",
32:     new TextEncoder().encode(value),
33:   );
34:   return bytesToHex(new Uint8Array(digest));
35: }
36: 
37: export async function createPrivateCacheKey(
38:   namespace: string,
39:   value: unknown,
40:   secret: string,
41: ): Promise<string> {
42:   const key = await crypto.subtle.importKey(
43:     "raw",
44:     new TextEncoder().encode(secret),
45:     { name: "HMAC", hash: "SHA-256" },
46:     false,
47:     ["sign"],
48:   );
49:   const signature = await crypto.subtle.sign(
50:     "HMAC",
51:     key,
52:     new TextEncoder().encode(JSON.stringify(value)),
53:   );
54:   return `${namespace}:${bytesToHex(new Uint8Array(signature))}`;
55: }
56: 
57: export class D1PublicApiCache implements PublicApiCache {
58:   constructor(private readonly database: D1Database) {}
59: 
60:   async get<T>(key: string): Promise<PublicApiCacheEntry<T> | null> {
61:     const row = await this.database
62:       .prepare(
63:         `SELECT payload_json, fetched_at, expires_at, stale_until
64:          FROM public_api_cache
65:          WHERE cache_key = ?1`,
66:       )
67:       .bind(key)
68:       .first<CacheRow>();
69:     if (!row) return null;
70: 
71:     try {
72:       return {
73:         value: JSON.parse(row.payload_json) as T,
74:         fetchedAt: row.fetched_at,
75:         expiresAt: row.expires_at,
76:         staleUntil: row.stale_until,
77:       };
78:     } catch {
79:       return null;
80:     }
81:   }
82: 
83:   async put<T>(
84:     key: string,
85:     source: string,
86:     resourceType: string,
87:     entry: PublicApiCacheEntry<T>,
88:   ): Promise<void> {
89:     const payloadJson = JSON.stringify(entry.value);
90:     const contentHash = await sha256(payloadJson);
91:     await this.database
92:       .prepare(
93:         `INSERT INTO public_api_cache (
94:            cache_key, source, resource_type, payload_json, content_hash,
95:            fetched_at, expires_at, stale_until
96:          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
97:          ON CONFLICT(cache_key) DO UPDATE SET
98:            source = excluded.source,
99:            resource_type = excluded.resource_type,
100:            payload_json = excluded.payload_json,
101:            content_hash = excluded.content_hash,
102:            fetched_at = excluded.fetched_at,
103:            expires_at = excluded.expires_at,
104:            stale_until = excluded.stale_until`,
105:       )
106:       .bind(
107:         key,
108:         source,
109:         resourceType,
110:         payloadJson,
111:         contentHash,
112:         entry.fetchedAt,
113:         entry.expiresAt,
114:         entry.staleUntil,
115:       )
116:       .run();
117: 
118:     try {
119:       await this.database
120:         .prepare(
121:           `DELETE FROM public_api_cache
122:            WHERE cache_key IN (
123:              SELECT cache_key
124:              FROM public_api_cache
125:              WHERE stale_until < ?1
126:              LIMIT 100
127:            )`,
128:         )
129:         .bind(entry.fetchedAt)
130:         .run();
131:     } catch {
132:       // Expired rows can be removed on a later write without affecting this result.
133:     }
134:   }
135: }
136: 
137: export type CacheReadStatus = "hit" | "miss" | "stale" | "bypass";
138: 
139: export type CacheReadResult<T> = {
140:   value: T;
141:   status: CacheReadStatus;
142:   expiresAt: number | null;
143:   isStale: boolean;
144: };
145: 
146: export async function readThroughPublicCache<T>(options: {
147:   cache?: PublicApiCache;
148:   key?: string;
149:   source: string;
150:   resourceType: string;
151:   ttlMs: number;
152:   staleTtlMs: number;
153:   load: () => Promise<T>;
154:   canUseStale?: (error: unknown) => boolean;
155:   now?: () => number;
156: }): Promise<CacheReadResult<T>> {
157:   const now = options.now ?? Date.now;
158:   if (!options.cache || !options.key) {
159:     return {
160:       value: await options.load(),
161:       status: "bypass",
162:       expiresAt: null,
163:       isStale: false,
164:     };
165:   }
166: 
167:   let cached: PublicApiCacheEntry<T> | null = null;
168:   try {
169:     cached = await options.cache.get<T>(options.key);
170:   } catch {
171:     // A cache outage must not turn a public API lookup into an application outage.
172:   }
173: 
174:   const checkedAt = now();
175:   if (cached && cached.expiresAt > checkedAt) {
176:     return {
177:       value: cached.value,
178:       status: "hit",
179:       expiresAt: cached.expiresAt,
180:       isStale: false,
181:     };
182:   }
183: 
184:   try {
185:     const value = await options.load();
186:     const fetchedAt = now();
187:     const entry: PublicApiCacheEntry<T> = {
188:       value,
189:       fetchedAt,
190:       expiresAt: fetchedAt + options.ttlMs,
191:       staleUntil: fetchedAt + options.staleTtlMs,
192:     };
193:     try {
194:       await options.cache.put(
195:         options.key,
196:         options.source,
197:         options.resourceType,
198:         entry,
199:       );
200:     } catch {
201:       // Returning fresh official data is more important than populating the cache.
202:     }
203:     return {
204:       value,
205:       status: "miss",
206:       expiresAt: entry.expiresAt,
207:       isStale: false,
208:     };
209:   } catch (error) {
210:     if (
211:       cached &&
212:       cached.staleUntil > checkedAt &&
213:       (options.canUseStale?.(error) ?? false)
214:     ) {
215:       return {
216:         value: cached.value,
217:         status: "stale",
218:         expiresAt: cached.expiresAt,
219:         isStale: true,
220:       };
221:     }
222:     throw error;
223:   }
224: }