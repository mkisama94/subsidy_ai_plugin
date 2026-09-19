# ツール注釈の理由（0.11.0）

本番の全15ツールに対応。Platformの各理由欄へ転記するための説明です。任意のidempotentHintも明示しています。

## search_companies

- readOnlyHint: true
- destructiveHint: false
- openWorldHint: true
- idempotentHint: true

**read_only_justification**

Searches the public gBizINFO API by company name and optional location to return company candidates. The handler does not write to D1, enqueue jobs or change business records.

**destructive_justification**

Only retrieves public data; no records are deleted or overwritten and no applications, messages or transactions are submitted.

**open_world_justification**

Searches the public gBizINFO API by company name and optional location to return company candidates. This accesses public internet services, not a bounded private account or workspace, even though access is read-only.

**idempotent_justification**

Repeated calls have no additional business-state effects. Upstream public data may change, so identical response content is not promised.


## get_company_profile

- readOnlyHint: true
- destructiveHint: false
- openWorldHint: true
- idempotentHint: true

**read_only_justification**

Retrieves a public company profile from the gBizINFO API for the supplied corporate number. The handler does not write to D1, enqueue jobs or change business records.

**destructive_justification**

Only retrieves public data; no records are deleted or overwritten and no applications, messages or transactions are submitted.

**open_world_justification**

Retrieves a public company profile from the gBizINFO API for the supplied corporate number. This accesses public internet services, not a bounded private account or workspace, even though access is read-only.

**idempotent_justification**

Repeated calls have no additional business-state effects. Upstream public data may change, so identical response content is not promised.


## get_company_activities

- readOnlyHint: true
- destructiveHint: false
- openWorldHint: true
- idempotentHint: true

**read_only_justification**

Retrieves the requested categories of public corporate activity records from the gBizINFO API. The handler does not write to D1, enqueue jobs or change business records.

**destructive_justification**

Only retrieves public data; no records are deleted or overwritten and no applications, messages or transactions are submitted.

**open_world_justification**

Retrieves the requested categories of public corporate activity records from the gBizINFO API. This accesses public internet services, not a bounded private account or workspace, even though access is read-only.

**idempotent_justification**

Repeated calls have no additional business-state effects. Upstream public data may change, so identical response content is not promised.


## verify_corporate_relationship

- readOnlyHint: false
- destructiveHint: true
- openWorldHint: true
- idempotentHint: false

**read_only_justification**

Retrieves EDINET public filings and, only after a relationship is confirmed and D1 is configured, upserts companies, edinet_documents and company_relations. Unconfirmed relationships are not persisted; persistence failures are reported separately.

**destructive_justification**

Existing company and document fields and a relationship identified by source document, normalized parent/child names and relation type can be overwritten. The tool has no built-in undo/version restore. Scope is limited to verified public evidence; it does not modify EDINET or submit an application.

**open_world_justification**

Accesses EDINET public internet APIs and public filing documents for the user-supplied parent candidate, even though all writes are to the application database.

**idempotent_justification**

Repeated calls may retrieve changed evidence and update stored fields and timestamps; upsert is not a guarantee of no additional effects.


## prepare_professional_consultation

- readOnlyHint: true
- destructiveHint: false
- openWorldHint: false
- idempotentHint: true

**read_only_justification**

Builds a consultation brief in memory from the supplied facts and issues. It does not save the brief, contact professionals or send messages. URLs in the input are returned as references and are not fetched.

**destructive_justification**

No persistent records are created, overwritten or deleted, and no messages, applications or transactions are sent.

**open_world_justification**

Builds a consultation brief in memory from the supplied facts and issues. It does not save the brief, contact professionals or send messages. URLs in the input are returned as references and are not fetched. Execution is restricted to supplied inputs or the application database, not public internet retrieval.

**idempotent_justification**

Repeated calls do not mutate persistent business state. For database reads, stored source records may independently change between calls.


## assess_deemed_large_enterprise_eligibility

- readOnlyHint: true
- destructiveHint: false
- openWorldHint: false
- idempotentHint: true

**read_only_justification**

Computes an assessment in memory from supplied rules and affiliation facts. It neither fetches source URLs nor stores inputs or results.

**destructive_justification**

No persistent records are created, overwritten or deleted, and no messages, applications or transactions are sent.

**open_world_justification**

Computes an assessment in memory from supplied rules and affiliation facts. It neither fetches source URLs nor stores inputs or results. Execution is restricted to supplied inputs or the application database, not public internet retrieval.

**idempotent_justification**

Repeated calls do not mutate persistent business state. For database reads, stored source records may independently change between calls.


## record_official_selection_statistics

- readOnlyHint: false
- destructiveHint: true
- openWorldHint: true
- idempotentHint: false

**read_only_justification**

Fetches and validates the supplied official source, then upserts program, round, research-source and selection-statistics records and links in D1.

**destructive_justification**

Existing program/round/source fields and statistics for the same program round and scope can be overwritten without built-in undo. HTTPS official-domain checks, source-text matching and count validation restrict writes; unsupported PDF sources are rejected. There is no separate dry-run or confirmation parameter.

**open_world_justification**

Fetches official public internet HTML, text or JSON from the supplied source URL. An official-domain allowlist does not make this a bounded private workspace.

**idempotent_justification**

Retries can update values, source links, provenance and timestamps; no guarantee of no additional persistent effects is made.


## get_official_selection_statistics

- readOnlyHint: true
- destructiveHint: false
- openWorldHint: false
- idempotentHint: true

**read_only_justification**

Reads previously stored statistics and provenance from the application D1 database. It does not fetch source URLs or update records.

**destructive_justification**

No persistent records are created, overwritten or deleted, and no messages, applications or transactions are sent.

**open_world_justification**

Reads previously stored statistics and provenance from the application D1 database. It does not fetch source URLs or update records. Execution is restricted to supplied inputs or the application database, not public internet retrieval.

**idempotent_justification**

Repeated calls do not mutate persistent business state. For database reads, stored source records may independently change between calls.


## estimate_program_selection_outlook

- readOnlyHint: false
- destructiveHint: true
- openWorldHint: false
- idempotentHint: false

**read_only_justification**

Reads historical rates from D1 and calculates an outlook. If target_jgrants_subsidy_id identifies an existing round and a valid estimate is produced, it saves the estimate; without a target or when an estimate is withheld it does not save.

**destructive_justification**

For an existing target round, saving can replace the previous estimate, methodology, confidence, estimate basis and dates without built-in undo. Recorded official application/selection counts are preserved. Omitting the target avoids saving; uncertain eligibility withholds estimation.

**open_world_justification**

Reads and writes only the application D1 database and computes from supplied parameters. It does not fetch public URLs, publish the estimate or contact third parties.

**idempotent_justification**

With a target, retries may update the estimate and timestamps as historical data changes. The annotation covers the write-capable mode.


## evaluate_subsidy_fit_for_company

- readOnlyHint: false
- destructiveHint: false
- openWorldHint: true
- idempotentHint: false

**read_only_justification**

Retrieves public gBizINFO company data and J-Grants subsidy details, then computes a non-binding assessment. With D1 configured, cache misses or expiry can insert/replace public_api_cache rows and purge up to 100 expired cache rows. Search caching additionally requires CACHE_KEY_SECRET. The annotation covers these write-capable paths, including indirect calls.

**destructive_justification**

Writes and expiry cleanup affect only disposable public-data cache entries. No user-authored records, applications or evidence tables are deleted or overwritten. Public information can be fetched again; this cache is not an archival history of prior source versions.

**open_world_justification**

Retrieves public gBizINFO company data and J-Grants subsidy details, then computes a non-binding assessment. Public internet access occurs on cache misses, bypasses or refreshes; a cache hit does not make the tool closed-world.

**idempotent_justification**

Retries may refresh source content, fetched-at/expiry timestamps and remove additional expired cache entries. No guarantee of no additional state effects is made.


## search_subsidies

- readOnlyHint: false
- destructiveHint: false
- openWorldHint: true
- idempotentHint: false

**read_only_justification**

Searches the public J-Grants API for subsidy candidates. With D1 configured, cache misses or expiry can insert/replace public_api_cache rows and purge up to 100 expired cache rows. Search caching additionally requires CACHE_KEY_SECRET. The annotation covers these write-capable paths, including indirect calls.

**destructive_justification**

Writes and expiry cleanup affect only disposable public-data cache entries. No user-authored records, applications or evidence tables are deleted or overwritten. Public information can be fetched again; this cache is not an archival history of prior source versions.

**open_world_justification**

Searches the public J-Grants API for subsidy candidates. Public internet access occurs on cache misses, bypasses or refreshes; a cache hit does not make the tool closed-world.

**idempotent_justification**

Retries may refresh source content, fetched-at/expiry timestamps and remove additional expired cache entries. No guarantee of no additional state effects is made.


## get_subsidy_detail

- readOnlyHint: false
- destructiveHint: false
- openWorldHint: true
- idempotentHint: false

**read_only_justification**

Retrieves the specified subsidy from the public J-Grants detail API. With D1 configured, cache misses or expiry can insert/replace public_api_cache rows and purge up to 100 expired cache rows. Search caching additionally requires CACHE_KEY_SECRET. The annotation covers these write-capable paths, including indirect calls.

**destructive_justification**

Writes and expiry cleanup affect only disposable public-data cache entries. No user-authored records, applications or evidence tables are deleted or overwritten. Public information can be fetched again; this cache is not an archival history of prior source versions.

**open_world_justification**

Retrieves the specified subsidy from the public J-Grants detail API. Public internet access occurs on cache misses, bypasses or refreshes; a cache hit does not make the tool closed-world.

**idempotent_justification**

Retries may refresh source content, fetched-at/expiry timestamps and remove additional expired cache entries. No guarantee of no additional state effects is made.


## evaluate_subsidy_fit

- readOnlyHint: false
- destructiveHint: false
- openWorldHint: true
- idempotentHint: false

**read_only_justification**

Retrieves public J-Grants detail data and computes a non-binding assessment against the supplied company facts. With D1 configured, cache misses or expiry can insert/replace public_api_cache rows and purge up to 100 expired cache rows. Search caching additionally requires CACHE_KEY_SECRET. The annotation covers these write-capable paths, including indirect calls.

**destructive_justification**

Writes and expiry cleanup affect only disposable public-data cache entries. No user-authored records, applications or evidence tables are deleted or overwritten. Public information can be fetched again; this cache is not an archival history of prior source versions.

**open_world_justification**

Retrieves public J-Grants detail data and computes a non-binding assessment against the supplied company facts. Public internet access occurs on cache misses, bypasses or refreshes; a cache hit does not make the tool closed-world.

**idempotent_justification**

Retries may refresh source content, fetched-at/expiry timestamps and remove additional expired cache entries. No guarantee of no additional state effects is made.


## search_corporate_identities

- readOnlyHint: true
- destructiveHint: false
- openWorldHint: true
- idempotentHint: true

**read_only_justification**

Searches the National Tax Agency public corporate-number API by company name, optional location code and page; returns candidates without automatically selecting a company. The handler does not write to D1, enqueue jobs or change business records.

**destructive_justification**

Only retrieves public data; no records are deleted or overwritten and no applications, messages or transactions are submitted.

**open_world_justification**

Searches the National Tax Agency public corporate-number API by company name, optional location code and page; returns candidates without automatically selecting a company. This accesses public internet services, not a bounded private account or workspace, even though access is read-only.

**idempotent_justification**

Repeated calls have no additional business-state effects. Upstream public data may change, so identical response content is not promised.


## get_corporate_identity

- readOnlyHint: true
- destructiveHint: false
- openWorldHint: true
- idempotentHint: true

**read_only_justification**

Retrieves the latest public corporate identity from the National Tax Agency API for the explicitly supplied corporate number. The handler does not write to D1, enqueue jobs or change business records.

**destructive_justification**

Only retrieves public data; no records are deleted or overwritten and no applications, messages or transactions are submitted.

**open_world_justification**

Retrieves the latest public corporate identity from the National Tax Agency API for the explicitly supplied corporate number. This accesses public internet services, not a bounded private account or workspace, even though access is read-only.

**idempotent_justification**

Repeated calls have no additional business-state effects. Upstream public data may change, so identical response content is not promised.
