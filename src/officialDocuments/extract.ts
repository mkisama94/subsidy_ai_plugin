import { parseHTML } from "linkedom";
import { DocumentError, hash, type Candidate, type ExtractorConfig, type FetchPolicy, type Source } from "./types";
import { permittedUrl } from "./sourcePolicy";
import { extractJgrantsDocumentMetadata } from "../jgrants";

const clean = (s: string | null) => (s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
// Structural DOM surface keeps the Worker build independent of browser globals.
type ParsedElement = {
  textContent: string | null; parentElement: ParsedElement | null; documentElement?: ParsedElement;
  querySelectorAll(selector: string): ParsedElement[]; querySelector(selector: string): ParsedElement | null;
  getAttribute(name: string): string | null; closest(selector: string): ParsedElement | null;
  contains(element: ParsedElement): boolean; remove(): void;
};
export function inferFileType(url: string): string {
  return new URL(url).pathname.match(/\.(pdf|docx?|xlsx?|zip|pptx?|csv)$/i)?.[1]?.toLowerCase() ?? "unknown";
}
function association(context: string, config: ExtractorConfig): Candidate["associationStatus"] {
  if (config.excludedContextText.some(t => context.includes(clean(t)))) return "mismatch";
  if (config.associationBasis === "unresolved") return "needs_review";
  if (config.associationBasis === "operator_reviewed" || config.confirmedContextText.some(t => context.includes(clean(t)))) return "confirmed";
  return "needs_review";
}
export async function extractHtml(html: string, source: Source, config: ExtractorConfig, policy: FetchPolicy, baseUrl = source.source_page_url) {
  const document = parseHTML(html).document as unknown as ParsedElement;
  document.querySelectorAll("script, style, noscript, template").forEach(x => x.remove());
  const allText = clean(document.documentElement?.textContent ?? document.textContent);
  if (!config.requiredPageText.every(t => allText.includes(clean(t)))) throw new DocumentError("page_identity_changed");
  let regions: ParsedElement[];
  try { regions = document.querySelectorAll(config.selector); } catch { throw new DocumentError("invalid_extractor"); }
  if (!regions.length) throw new DocumentError("selector_missing");
  let base = baseUrl;
  const baseHref = document.querySelector("base[href]")?.getAttribute("href");
  if (baseHref) base = permittedUrl(new URL(baseHref, baseUrl).href, policy, "pages").href;
  const candidates: Candidate[] = [], seen = new Set<string>();
  let ignoredCount = 0;
  for (const [regionIndex, region] of Array.from(regions).entries()) {
    const anchors = Array.from(region.querySelectorAll(config.linkSelector));
    if (anchors.length + candidates.length > 100) throw new DocumentError("candidate_limit");
    const heading = clean(region.querySelector("h1,h2,h3,h4,h5,h6")?.textContent ?? "");
    for (const anchor of anchors) {
      const title = clean(anchor.textContent || anchor.getAttribute("title"));
      if (!title) { ignoredCount++; continue; }
      const raw = anchor.getAttribute("href");
      if (!raw || raw.startsWith("#")) continue;
      let url: URL, resourceKind: Candidate["resourceKind"] = "file_link";
      try {
        const absolute = new URL(raw, base).href;
        try { url = permittedUrl(absolute, policy, "files"); }
        catch { url = permittedUrl(absolute, policy, "pages"); resourceKind = "web_page"; }
      } catch { ignoredCount++; continue; }
      const fileType = resourceKind === "web_page" ? "html" : inferFileType(url.href);
      const nearby = anchor.closest(config.contextSelector);
      const context = clean(heading + " " + (nearby && region.contains(nearby) ? nearby.textContent : anchor.parentElement?.textContent)).slice(0,500);
      const sectionLocator = `${config.selector}[${regionIndex}] ${heading}`.slice(0,500);
      const documentKey = await hash([source.id, url.href, sectionLocator]);
      if (seen.has(documentKey)) continue;
      seen.add(documentKey);
      candidates.push({ documentKey, resourceKind, fileUrl: resourceKind === "file_link" ? url.href : null,
        sourcePageUrl: baseUrl, webPageUrl: resourceKind === "web_page" ? url.href : null, originalTitle: title.slice(0,300),
        fileName: fileType === "unknown" || fileType === "html" ? null : decodeURIComponent(url.pathname.split("/").pop()!).slice(0,300),
        fileType, fileTypeBasis: resourceKind === "web_page" ? "page_link" : "url_extension",
        contextExcerpt: context, sectionLocator, associationStatus: association(context, config),
        associationBasis: config.associationBasis, typeHint: null });
    }
  }
  return { candidates, ignoredCount, explicitEmpty: Boolean(config.allowEmptyText && allText.includes(clean(config.allowEmptyText))) };
}
export async function extractApi(payload: unknown, source: Source, config: ExtractorConfig, policy: FetchPolicy, subsidyId: string) {
  const metadata = extractJgrantsDocumentMetadata(payload);
  if (metadata.id !== subsidyId || source.jgrants_workflow_id && !metadata.workflowIds.includes(source.jgrants_workflow_id)) throw new DocumentError("round_binding_changed");
  const result = await extractHtml(`<main>${metadata.detailHtml}</main>`, source, { ...config, selector: "main" }, policy);
  const ambiguous = metadata.workflowIds.length > 1 && !source.jgrants_workflow_id;
  for (const [i, item] of metadata.attachments.entries()) {
    const title = item.name.slice(0,300);
    result.candidates.push({ documentKey: await hash([source.id,item.type,title,i]), resourceKind: "api_attachment", fileUrl: null,
      sourcePageUrl: source.source_page_url, webPageUrl: null, originalTitle: title, fileName: title,
      fileType: title.match(/\.(pdf|docx?|xlsx?|zip)$/i)?.[1]?.toLowerCase() ?? "unknown", fileTypeBasis: "api_name",
      contextExcerpt: title, sectionLocator: item.type, associationStatus: ambiguous ? "needs_review" : association(title, config),
      associationBasis: config.associationBasis, typeHint: item.type === "application_guidelines" ? "guideline" : item.type === "outline_of_grant" ? "grant_rules" : "application_form" });
  }
  if (ambiguous) result.candidates.forEach(c => { c.associationStatus = "needs_review"; });
  if (result.candidates.length > 100) throw new DocumentError("candidate_limit");
  return { ...result, metadata };
}
