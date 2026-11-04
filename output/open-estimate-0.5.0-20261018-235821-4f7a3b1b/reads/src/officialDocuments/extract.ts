1: import { parseHTML } from "linkedom";
2: import { DocumentError, hash, type Candidate, type ExtractorConfig, type FetchPolicy, type Source } from "./types";
3: import { permittedUrl } from "./sourcePolicy";
4: import { extractJgrantsDocumentMetadata } from "../jgrants";
5: 
6: const clean = (s: string | null) => (s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
7: // Structural DOM surface keeps the Worker build independent of browser globals.
8: type ParsedElement = {
9:   textContent: string | null; parentElement: ParsedElement | null; documentElement?: ParsedElement;
10:   querySelectorAll(selector: string): ParsedElement[]; querySelector(selector: string): ParsedElement | null;
11:   getAttribute(name: string): string | null; closest(selector: string): ParsedElement | null;
12:   contains(element: ParsedElement): boolean; remove(): void;
13: };
14: export function inferFileType(url: string): string {
15:   return new URL(url).pathname.match(/\.(pdf|docx?|xlsx?|zip|pptx?|csv)$/i)?.[1]?.toLowerCase() ?? "unknown";
16: }
17: function association(context: string, config: ExtractorConfig): Candidate["associationStatus"] {
18:   if (config.excludedContextText.some(t => context.includes(clean(t)))) return "mismatch";
19:   if (config.associationBasis === "unresolved") return "needs_review";
20:   if (config.associationBasis === "operator_reviewed" || config.confirmedContextText.some(t => context.includes(clean(t)))) return "confirmed";
21:   return "needs_review";
22: }
23: export async function extractHtml(html: string, source: Source, config: ExtractorConfig, policy: FetchPolicy, baseUrl = source.source_page_url) {
24:   const document = parseHTML(html).document as unknown as ParsedElement;
25:   document.querySelectorAll("script, style, noscript, template").forEach(x => x.remove());
26:   const allText = clean(document.documentElement?.textContent ?? document.textContent);
27:   if (!config.requiredPageText.every(t => allText.includes(clean(t)))) throw new DocumentError("page_identity_changed");
28:   let regions: ParsedElement[];
29:   try { regions = document.querySelectorAll(config.selector); } catch { throw new DocumentError("invalid_extractor"); }
30:   if (!regions.length) throw new DocumentError("selector_missing");
31:   let base = baseUrl;
32:   const baseHref = document.querySelector("base[href]")?.getAttribute("href");
33:   if (baseHref) base = permittedUrl(new URL(baseHref, baseUrl).href, policy, "pages").href;
34:   const candidates: Candidate[] = [], seen = new Set<string>();
35:   let ignoredCount = 0;
36:   for (const [regionIndex, region] of Array.from(regions).entries()) {
37:     const anchors = Array.from(region.querySelectorAll(config.linkSelector));
38:     if (anchors.length + candidates.length > 100) throw new DocumentError("candidate_limit");
39:     const heading = clean(region.querySelector("h1,h2,h3,h4,h5,h6")?.textContent ?? "");
40:     for (const anchor of anchors) {
41:       const title = clean(anchor.textContent || anchor.getAttribute("title"));
42:       if (!title) { ignoredCount++; continue; }
43:       const raw = anchor.getAttribute("href");
44:       if (!raw || raw.startsWith("#")) continue;
45:       let url: URL, resourceKind: Candidate["resourceKind"] = "file_link";
46:       try {
47:         const absolute = new URL(raw, base).href;
48:         try { url = permittedUrl(absolute, policy, "files"); }
49:         catch { url = permittedUrl(absolute, policy, "pages"); resourceKind = "web_page"; }
50:       } catch { ignoredCount++; continue; }
51:       const fileType = resourceKind === "web_page" ? "html" : inferFileType(url.href);
52:       const nearby = anchor.closest(config.contextSelector);
53:       const context = clean(heading + " " + (nearby && region.contains(nearby) ? nearby.textContent : anchor.parentElement?.textContent)).slice(0,500);
54:       const sectionLocator = `${config.selector}[${regionIndex}] ${heading}`.slice(0,500);
55:       const documentKey = await hash([source.id, url.href, sectionLocator]);
56:       if (seen.has(documentKey)) continue;
57:       seen.add(documentKey);
58:       candidates.push({ documentKey, resourceKind, fileUrl: resourceKind === "file_link" ? url.href : null,
59:         sourcePageUrl: baseUrl, webPageUrl: resourceKind === "web_page" ? url.href : null, originalTitle: title.slice(0,300),
60:         fileName: fileType === "unknown" || fileType === "html" ? null : decodeURIComponent(url.pathname.split("/").pop()!).slice(0,300),
61:         fileType, fileTypeBasis: resourceKind === "web_page" ? "page_link" : "url_extension",
62:         contextExcerpt: context, sectionLocator, associationStatus: association(context, config),
63:         associationBasis: config.associationBasis, typeHint: null });
64:     }
65:   }
66:   return { candidates, ignoredCount, explicitEmpty: Boolean(config.allowEmptyText && allText.includes(clean(config.allowEmptyText))) };
67: }
68: export async function extractApi(payload: unknown, source: Source, config: ExtractorConfig, policy: FetchPolicy, subsidyId: string) {
69:   const metadata = extractJgrantsDocumentMetadata(payload);
70:   if (metadata.id !== subsidyId || source.jgrants_workflow_id && !metadata.workflowIds.includes(source.jgrants_workflow_id)) throw new DocumentError("round_binding_changed");
71:   const result = await extractHtml(`<main>${metadata.detailHtml}</main>`, source, { ...config, selector: "main" }, policy);
72:   const ambiguous = metadata.workflowIds.length > 1 && !source.jgrants_workflow_id;
73:   for (const [i, item] of metadata.attachments.entries()) {
74:     const title = item.name.slice(0,300);
75:     result.candidates.push({ documentKey: await hash([source.id,item.type,title,i]), resourceKind: "api_attachment", fileUrl: null,
76:       sourcePageUrl: source.source_page_url, webPageUrl: null, originalTitle: title, fileName: title,
77:       fileType: title.match(/\.(pdf|docx?|xlsx?|zip)$/i)?.[1]?.toLowerCase() ?? "unknown", fileTypeBasis: "api_name",
78:       contextExcerpt: title, sectionLocator: item.type, associationStatus: ambiguous ? "needs_review" : association(title, config),
79:       associationBasis: config.associationBasis, typeHint: item.type === "application_guidelines" ? "guideline" : item.type === "outline_of_grant" ? "grant_rules" : "application_form" });
80:   }
81:   if (ambiguous) result.candidates.forEach(c => { c.associationStatus = "needs_review"; });
82:   if (result.candidates.length > 100) throw new DocumentError("candidate_limit");
83:   return { ...result, metadata };
84: }