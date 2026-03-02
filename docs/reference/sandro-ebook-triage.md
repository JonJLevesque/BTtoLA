# Sandro Ebook — Code Triage

**Date**: 2026-03-02
**Source**: Sandro Pereira, "BizTalk Mapping Patterns and Best Practices" (2014, 365 pages)
**New reference doc**: `sandro-ebook-map-patterns.md`
**Cross-checked against**: `map-converter.ts`, `gap-analyzer.ts`, `sandro-blog-triage.md`,
  `sandro-biztalk-patterns.md` (Section 3 — Map and Transform Patterns)

## Summary

- Code fixes: 6 (EMAP-01 through EMAP-06)
- Gap analysis additions: 5 (EGAP-01 through EGAP-05)
- Reference doc updates: 3 (EREF-01 through EREF-03)
- No action (knowledge only): 12

Items already covered by the existing triage (`sandro-blog-triage.md`) are noted as duplicates
and excluded. Specifically: xsl:include/import (GAP-08), xslt .NET 2.0 constraint (FIX-07),
Muenchian grouping gap (GAP-06), Table Looping gap (GAP-05), Data Mapper xsl namespace issue
(existing `sandro-biztalk-patterns.md` §3.5), GenerateDefaultFixedNodes (new — below).

---

## Code Fixes Needed

---

**[EMAP-01]** `map-converter.ts` generates XSLT with `userCSharp:` namespace reference still present
- **Priority**: P1 (deployment-breaking — XSLT with `userCSharp:` calls fails silently or throws
  at Logic Apps Transform action runtime; the transform produces no output or throws a namespace
  resolution error)
- **File**: `src/stage3-build/map-converter.ts` — `generateXslt()` and `buildXsltRootMappings()`
- **Problem**: `generateXslt()` emits XSLT that is structurally valid but does not strip
  `userCSharp:` extension function calls from the link-derived XPath in `buildXsltRootMappings()`.
  The `xpathFromRef()` utility converts link paths to XPath using `*[local-name()='field']` which
  is correct. However, when a `BtmFunctoid` is of type `logical` or `string`, `buildLogicalFunctoidTemplate()`
  and `buildStringFunctoidTemplate()` assume the pattern is a custom template call and emit a
  `<xsl:call-template>` — they do not check whether the original compiled XSLT for this functoid
  contains a `userCSharp:` call that must be replaced.
  Additionally, `generateXslt()` unconditionally declares `xmlns:xs="http://www.w3.org/2001/XMLSchema"`
  in the stylesheet header. The `xs:` namespace is not used by any generated template content —
  this is a dead namespace declaration that pollutes the output.
- **Change**:
  1. In `functoidToXsltTemplate()`, before delegating to `buildStringFunctoidTemplate()` or
     `buildLogicalFunctoidTemplate()`, check `f.scriptCode` for `userCSharp:` patterns. If found,
     treat as a scripting functoid requiring replacement (produce a TODO comment, not a stub
     `xsl:call-template` that silently fails).
  2. In `generateXslt()`, remove the `xmlns:xs` declaration from the `<xsl:stylesheet>` element
     unless the generated content actually uses the `xs:` prefix.
  3. Add a warning to `warnings[]` for any functoid that is not a scripting type but whose
     compiled behaviour maps to a `userCSharp:` call (category `'logical'`, `'date-time'`) noting
     that the generated template is a scaffold and must be completed with the XPath equivalent
     from `sandro-ebook-map-patterns.md` Section 9.

---

**[EMAP-02]** `map-converter.ts` function stub uses legacy Azure Functions v1 SDK, not Local Code Function format
- **Priority**: P2 (stubs reference retired Azure Functions v1 API; incompatible with Logic Apps
  Standard Local Code Function pattern)
- **File**: `src/stage3-build/map-converter.ts` — `generateFunctionStub()`
- **Problem**: `generateFunctionStub()` generates a C# class using:
  - `Microsoft.Azure.WebJobs` (Azure Functions v1/v2 SDK — retired)
  - `[FunctionName("...")]` + `[HttpTrigger(...)]` attributes
  - `IActionResult` return type
  This is the Azure Functions HTTP trigger pattern, NOT the Logic Apps Local Code Function pattern.
  Local Code Functions use `[WorkflowActionTrigger]` attribute (from `Microsoft.Azure.Workflows.WebJobs`)
  and run in-process with the Logic Apps runtime. The generated stubs will not compile in a
  Logic Apps Standard project.
  Additionally, the `using Microsoft.Azure.WebJobs.Extensions.Http` import is specific to Azure
  Functions and is not available in the Logic Apps Standard project template.
- **Change**: Rewrite `generateFunctionStub()` to emit a Local Code Function stub:
  ```csharp
  using System;
  using Microsoft.Azure.Workflows.WebJobs.Attributes;
  using Microsoft.Extensions.Logging;

  /// <summary>
  /// Local Code Function replacement for BizTalk map: {map.name}
  /// Source schema:      {map.sourceSchemaRef}
  /// Destination schema: {map.destinationSchemaRef}
  /// Migrated from: {map.filePath}
  /// </summary>
  public class {functionName}
  {
      [WorkflowActionTrigger]
      public static string Run(string inputXml, ILogger log)
      {
          // TODO: Implement transformation logic extracted from scripting functoids below.
          // Scripting functoid logic to port:
          // {methodComments}
          throw new NotImplementedException("Port scripting functoid logic here.");
      }
  }
  ```
  Update the warning text to say "Local Code Function stub" not "Azure Function stub". Update
  the `MapOutputFormat` type and any callers to reflect the new stub format.

---

**[EMAP-03]** `map-converter.ts` `xpathFromRef()` produces incorrect XPath for simple field names
- **Priority**: P2 (incorrect XPath selectors in generated XSLT — Transform action produces
  empty output for simple field names like `OrderID` or `Total`)
- **File**: `src/stage3-build/map-converter.ts` — `xpathFromRef()`
- **Problem**: `xpathFromRef()` splits the reference on `/` and `\` then wraps every segment
  in `*[local-name()='segment']`. For a link from `OrderID` (a simple field name with no path
  separator), this produces `*[local-name()='OrderID']` — which is correct. However for a
  two-segment path like `Order/OrderID`, it produces `*[local-name()='Order']/*[local-name()='OrderID']`
  which is also correct. The problem is that link refs from BTM files often include schema
  namespace prefixes (e.g., `s0:Order/s0:OrderID`) — after splitting, the segment is
  `s0:OrderID` and the `local-name()` predicate becomes `*[local-name()='s0:OrderID']` which
  will NEVER match (local-name does not include namespace prefix). This produces silent empty
  output for any map with `IgnoreNamespacesForLinks=False`.
- **Change**: In `xpathFromRef()`, strip namespace prefix from each path segment before
  wrapping in `local-name()`:
  ```typescript
  function xpathFromRef(ref: string): string {
    const parts = ref.split(/[/\\]/);
    return parts.map(p => {
      const localName = p.includes(':') ? p.split(':')[1] : p;
      return `*[local-name()='${localName}']`;
    }).join('/') || '.';
  }
  ```
  Add a warning to `warnings[]` when namespace prefixes are detected in link refs, noting that
  namespace-prefixed XPath requires the destination schema's namespace URI declared in the
  stylesheet header (see `sandro-ebook-map-patterns.md` Section 6.1).

---

**[EMAP-04]** `map-converter.ts` `recommendedMigrationPath` decision does not account for map properties
- **Priority**: P3 (maps incorrectly routed to `xslt` path when they require `manual` due to
  `GenerateDefaultFixedNodes=Yes` or `PreserveSequenceOrder=Yes` dependencies)
- **File**: `src/stage3-build/map-converter.ts` — `convertMap()` routing logic; and
  `src/stage1-understand/` — wherever `ParsedMap.recommendedMigrationPath` is set
- **Problem**: The current routing in `convertMap()` delegates entirely to
  `map.recommendedMigrationPath` without checking map-level properties
  (`GenerateDefaultFixedNodes`, `PreserveSequenceOrder`, `TreatElementsAsRecords`) that the
  ebook identifies as affecting migrated XSLT correctness. A map with scripting functoids is
  correctly routed to `xslt-rewrite` or `azure-function`. But a map without scripting functoids
  that relies on `GenerateDefaultFixedNodes=Yes` for schema default values will be routed to
  `xslt` (automated translation) and silently produce wrong output.
- **Change**:
  1. Add `mapProperties?: { generateDefaultFixedNodes?: boolean; preserveSequenceOrder?: boolean; treatElementsAsRecords?: boolean; method?: 'xml' | 'text' | 'html'; copyPIs?: boolean }` to `ParsedMap` type (or equivalent in `src/types/biztalk.ts`).
  2. In `convertMap()`, after routing to `xslt`, check `map.mapProperties?.generateDefaultFixedNodes === true`
     and add a warning to `warnings[]`:
     > "Map uses GenerateDefaultFixedNodes=Yes: schema default values were auto-emitted by
     >  BizTalk compiler. Logic Apps Integration Account XSLT engine does not apply schema
     >  defaults automatically. Review destination schema for elements with default= or fixed=
     >  attributes and add explicit xsl:otherwise fallbacks."
  3. Similarly, if `preserveSequenceOrder === false` and the map has union-selector patterns
     (`TypeA | TypeB` in compiled XSLT), add a warning about potential ordering loss.
  4. If `method === 'text'`, add a warning that the Transform action output is a raw string,
     not XML, and downstream actions must handle it as text.

---

**[EMAP-05]** `gap-analyzer.ts` does not detect `userCSharp:` in extracted map XSLT content
- **Priority**: P2 (scripting functoid gap is under-reported — BTM files without the
  `hasScriptingFunctoids` flag set in the parser will miss this detection path, but may still
  contain compiled XSLT with `userCSharp:` calls that will fail at runtime)
- **File**: `src/stage2-document/gap-analyzer.ts` — `mapGaps()`
- **Problem**: `mapGaps()` checks `map.hasScriptingFunctoids` (a boolean set by the BTM parser)
  and `map.hasDatabaseFunctoids`. This relies on the Stage 1 parser correctly identifying all
  scripting functoid types in the .btm visual model. However, BizTalk also allows placing
  `msxsl:script` blocks directly in an external `.xslt` file referenced by the map — these
  bypass the visual Functoid model entirely. Additionally, the BTM parser may miss functoids
  with non-standard `isScripting` detection if the functoid uses an inline XSLT Call Template
  (which is technically scripting but may not be flagged in the current parser because Inline
  XSLT Call Templates do not generate `userCSharp:` calls).
  The ebook clarifies the critical distinction: Inline XSLT does NOT require `azure-function`
  migration — only Inline C#/VB.NET/JScript.NET and External Assembly do.
- **Change**:
  1. In `mapGaps()`, add a secondary check: if `map.xsltContent` (or equivalent field where
     the extracted XSLT text is stored) is non-empty, scan for `userCSharp:` string occurrences.
     If found and `!map.hasScriptingFunctoids`, still add the `scriptingFunctoid` gap with a
     note: "userCSharp: extension calls detected in extracted XSLT — functoid type may not have
     been flagged by parser."
  2. When `map.hasScriptingFunctoids` is true, distinguish between Inline C# (generates
     `userCSharp:` — needs Local Code Function) and Inline XSLT (does not generate `userCSharp:`
     — can be preserved verbatim). Update the gap description to reflect this distinction:
     - If ALL scripting functoids are Inline XSLT type → downgrade severity to `low` (inline
       XSLT is directly portable)
     - If ANY scripting functoids are Inline C#/VB.NET/JScript.NET/External Assembly → severity
       remains `high`

---

**[EMAP-06]** `gap-analyzer.ts` missing detection for multi-part BizTalk maps
- **Priority**: P2 (incorrect output — multi-source maps silently produce incomplete transforms
  when only the primary source schema data is available at runtime)
- **File**: `src/stage2-document/gap-analyzer.ts` — `mapGaps()`; `src/types/biztalk.ts` —
  `ParsedMap` type; `src/stage1-understand/` — BTM parser
- **Problem**: BizTalk maps can reference more than one source schema root. The Logic Apps
  Transform action takes a **single** XML input document. Multi-part maps require a workflow-level
  pre-merge step to combine multiple source XML documents into one before the Transform action
  can run. Currently, `mapGaps()` has no check for multiple source schema roots. The `ParsedMap`
  type has `sourceSchemaRef: string` (singular) — if the parser only captures the first source
  schema, multi-part maps are silently treated as single-source.
- **Change**:
  1. Expand `ParsedMap.sourceSchemaRef` to `sourceSchemaRefs: string[]` (or add an
     `additionalSourceSchemaRefs?: string[]` field) in `src/types/biztalk.ts`. Update the BTM
     parser to populate this from the `<SrcTree>` elements in the .btm XML (BTM files can have
     multiple `<SrcTree>` elements at the root level).
  2. In `mapGaps()`, check `map.sourceSchemaRefs.length > 1` (or `map.additionalSourceSchemaRefs?.length > 0`).
     If true, add a new gap `multiPartMap` with severity `high`:
     - Description: "Map references multiple source schemas. Logic Apps Transform action accepts
       a single XML input document. All source data must be merged into one XML document before
       the Transform action runs."
     - Mitigation: "Add workflow actions before the Transform: (1) fetch each additional source
       document via SQL/HTTP/variable; (2) Compose a merged XML document combining all sources;
       (3) pass the merged document as the single Transform input. The XSLT selects from each
       source's namespace prefix."
     - Severity: `high`
     - `baseEffortDays: 2` per additional source schema

---

## Gap Analysis Additions

---

**[EGAP-01]** Multi-part BizTalk maps (multiple source schemas) — ADD as HIGH gap
- **Key**: `multiPartMap`
- **Severity**: `high`
- **Currently**: Missing from `GAP_DEFS`. Not listed in `sandro-blog-triage.md` gap additions.
- **Description**: BizTalk Mapper supports maps with multiple source schemas (multiple `<SrcTree>`
  entries in the .btm file). The Logic Apps Transform XML action (both Integration Account and
  Data Mapper) accepts a **single** XML input document. Multi-source enrichment maps require
  a pre-merge workflow step to combine all source documents before the Transform action.
- **Mitigation**: Before the Transform action: (1) fetch each additional source document via
  SQL connector, HTTP action, or variable (depending on the source); (2) Compose a merged XML
  document that combines all source data under a single root element; (3) pass the merged
  document as the single Transform input. The XSLT selects from each source using its
  namespace prefix. Budget 1-2 days per additional source schema.
- **Detection**: In `mapGaps()`, check `map.sourceSchemaRefs.length > 1` after BTM parser is
  updated to capture all `<SrcTree>` entries. Or detect by counting distinct source namespace
  declarations in the extracted XSLT (`xmlns:s0`, `xmlns:s1`, etc.).

---

**[EGAP-02]** Record Count Functoid (absolute XPath in scoped loop) — ADD as MEDIUM gap
- **Key**: `recordCountAbsolutePath`
- **Severity**: `medium`
- **Currently**: Missing from `GAP_DEFS` and from `sandro-blog-triage.md`.
- **Description**: The BizTalk Record Count Functoid compiles to an absolute XPath:
  `count(/s0:Root/Record)`. Inside a nested `xsl:for-each`, this returns the global total
  count for every parent — not the count of children for that specific parent. This is a silent
  wrong-count bug in BizTalk maps that use Record Count inside a nested loop. The bug
  replicates to Logic Apps because the XSLT is preserved verbatim.
- **Mitigation**: In the generated XSLT, rewrite `count(/absolute/path)` inside `xsl:for-each`
  blocks to use relative XPath: `count(Child)` instead of `count(/Root/Parent/Child)`.
  If the absolute path cannot be rewritten without schema analysis, flag for manual review.
  Budget 0.5 days per map containing this pattern.
- **Detection**: In `mapGaps()`, if `map.xsltContent` is available, scan for the pattern:
  `count(` followed by `/` as the first character of the XPath argument inside any
  `<xsl:value-of>` element that appears within an `<xsl:for-each>` context. This requires
  basic XSLT structural analysis of the map content.

---

**[EGAP-03]** GenerateDefaultFixedNodes relied upon by map — ADD as MEDIUM gap
- **Key**: `generateDefaultFixedNodes`
- **Severity**: `medium`
- **Currently**: Missing from `GAP_DEFS` and from `sandro-blog-triage.md`. The ebook chapter
  on hidden map properties identifies this as a migration issue.
- **Description**: When a BizTalk map has `GenerateDefaultFixedNodes=Yes` (the default), the
  BizTalk compiler auto-emits XSD schema default values for destination elements not explicitly
  mapped. The Logic Apps Integration Account XSLT engine does NOT apply schema defaults
  automatically — it only outputs what the XSLT explicitly constructs. Maps that relied on
  compiler-injected defaults will silently produce incomplete or schema-invalid output.
- **Mitigation**: Scan the destination schema XSD for elements with `default=` or `fixed=`
  attributes. For each, add an explicit `<xsl:choose><xsl:when>...</xsl:when><xsl:otherwise>
  {default-value}</xsl:otherwise></xsl:choose>` pattern in the XSLT. Budget 0.5-1 day per
  map with schema defaults.
- **Detection**: In `mapGaps()`, check if `map.mapProperties?.generateDefaultFixedNodes === true`
  AND the destination schema has elements with `default=` or `fixed=` XSD attributes. Requires
  the BTM parser to extract the `GenerateDefaultFixedNodes` attribute from `<mapsource>` and
  the schema analyzer to flag `default=`/`fixed=` elements.

---

**[EGAP-04]** Inline XSLT (non-scripting) distinguishable from C# inline — UPDATE scriptingFunctoid gap description
- **Key**: `scriptingFunctoid` (existing — update, not add)
- **Severity**: Remains `high` but description should be clarified
- **Currently**: `GAP_DEFS.scriptingFunctoid` treats all scripting functoids as requiring
  Azure Function or Local Code Function. The ebook clarifies that Inline XSLT scripting
  functoids do NOT require this — they translate directly to Integration Account XSLT with no
  changes.
- **Change**: Update `scriptingFunctoid.description` in `gap-analyzer.ts` to distinguish:
  - Inline C#, VB.NET, JScript.NET, External Assembly: HIGH gap — requires Local Code Function
  - Inline XSLT (template or call-template): LOW gap — embed verbatim in Integration Account XSLT
  Update `scriptingFunctoid.mitigation` to mention this distinction. The severity on the gap
  definition should remain `high` (worst case), but when ALL detected scripting functoids are
  Inline XSLT type only, downgrade the per-map severity to `low` in `mapGaps()`.

---

**[EGAP-05]** xsl:sort missing data-type="number" on numeric fields — ADD as LOW gap
- **Key**: `numericSortMissingDataType`
- **Severity**: `low`
- **Currently**: Missing from `GAP_DEFS` and `sandro-blog-triage.md`.
- **Description**: BizTalk Mapper Sorting patterns use `xsl:sort`. Without `data-type="number"`,
  numeric fields sort lexicographically (10 sorts before 2 as text). This is a silent data
  correctness bug. Maps migrated verbatim to the Integration Account Transform will exhibit
  the same incorrect sort order.
- **Mitigation**: Scan generated XSLT for `<xsl:sort>` elements that lack `data-type="number"`
  on fields with numeric-sounding names (Id, Amount, Count, Total, Price, Quantity, Number,
  Sequence). Add `data-type="number"` where numeric sort is intended.
  Budget 0.25 days per map with sorting.
- **Detection**: In `mapGaps()`, if `map.xsltContent` is available, scan for `<xsl:sort`
  elements that lack `data-type="number"` where the `select` attribute references a field with
  a numeric-sounding name (case-insensitive match against the list above). Generate a warning
  in the map converter output and a LOW gap if any are found.

---

## Reference Doc Updates

---

**[EREF-01]** `sandro-biztalk-patterns.md` Section 3 (Map and Transform Patterns) — add note on Inline XSLT vs Inline C# distinction

The existing §3 treats scripting functoids uniformly. Add a clarifying note after §3.1:
> "Scripting Functoid sub-type distinction: Inline XSLT and Inline XSLT Call Template functoids
> do NOT generate `userCSharp:` calls — they embed pure XSLT verbatim and translate directly to
> Integration Account XSLT with no changes. Only Inline C#, Inline VB.NET, Inline JScript.NET,
> and External Assembly generate `userCSharp:` calls requiring Local Code Function replacement.
> Detect by checking the `<Script Language='...'>` attribute in the .btm XML."

---

**[EREF-02]** `CLAUDE.local.md` Section 2 (Shape to Action) — add map property context note

The current IntegrationIntent construction guide has no mention of map-level properties that
affect migration. Add a brief note after the `TransformShape` entry:
> "TransformShape additional checks: parse BizTalk .btm `<mapsource>` attributes for
> `GenerateDefaultFixedNodes`, `PreserveSequenceOrder`, `Method`, and `TreatElementsAsRecords`.
> Flag `GenerateDefaultFixedNodes=Yes` + destination schema has defaults → EGAP-03 gap.
> Flag `Method=text` → document Transform action output is a string, not XML.
> Flag `PreserveSequenceOrder=No` with sibling types → review union XPath ordering."

---

**[EREF-03]** `MEMORY.md` — add ebook key facts to "Key Platform Facts" section

Add to the memory file after the existing list of platform facts:
- BizTalk Mapper compiles to **XSLT 1.0** — `userCSharp:` extension calls must be replaced before Logic Apps
- Inline XSLT scripting functoids translate directly (no `userCSharp:`); Inline C#/VB.NET/JScript.NET/External Assembly do not
- `GenerateDefaultFixedNodes=Yes` (BizTalk default): IA XSLT engine does NOT auto-apply schema defaults — must be made explicit
- `PreserveSequenceOrder`: union XPath (`A | B`) preserves document order; two separate `xsl:for-each` blocks do not
- Record Count Functoid uses absolute XPath — silent wrong-count when inside nested for-each; must use relative path
- Multi-part maps (multiple `<SrcTree>`): Transform action takes single XML — workflow-level pre-merge required

---

## No Action (Knowledge Only)

The following ebook findings are accurate domain knowledge but require no tool code change
because they describe patterns that either translate verbatim, are already handled, or are
architecture decisions documented elsewhere.

1. **XSLT 1.0 direct compatibility**: All pure XSLT 1.0 constructs (`xsl:for-each`, `xsl:key`,
   `xsl:sort`, `xsl:choose`, `xsl:call-template`, `xsl:copy-of`, `position()`, `count()`,
   `concat()`) translate verbatim to Integration Account — no tool change needed.

2. **Muenchian grouping verbatim preservation**: Already covered by existing `sandro-biztalk-patterns.md`
   §3.8 and GAP-06 in `sandro-blog-triage.md`. `xsl:key` + `generate-id()` is XSLT 1.0 and
   translates directly to Integration Account.

3. **Content Filter pattern**: Default XSLT behaviour — un-linked source fields are silently
   dropped. No special handling needed.

4. **One-to-one, One-to-many, Many-to-many looping**: All compile to `xsl:for-each` which is
   XSLT 1.0 — preserve verbatim.

5. **Looping Functoid with `|` union select**: Document order preserved in XPath 1.0 union.
   Verbatim translation to Integration Account.

6. **Table Looping Functoid XSLT**: Variable-based pattern is valid XSLT 1.0. Already covered
   as GAP-05 in `sandro-blog-triage.md`. No additional code change from ebook.

7. **xsl:sort verbatim preservation**: `xsl:sort` is XSLT 1.0. Translate directly. Gap only
   when `data-type="number"` is missing (covered by EGAP-05 above).

8. **Conditional looping XPath predicate optimization**: Converting `xsl:for-each` + inner
   `xsl:if` to `xsl:for-each select="Record[condition]"` is a performance improvement, not a
   correctness fix. Currently the tool generates XSLT scaffolds only — optimization would be
   a Phase 2 enhancement not a required fix.

9. **Value Mapping vs Value Mapping (Flattening) empty-node distinction**: Already documented
   in `sandro-biztalk-patterns.md` §3.7. No additional code change needed.

10. **NVP reverse pattern (XPath predicate lookup)**: A performance optimization over the
    N×M iteration anti-pattern. Correct to document but not a migration correctness issue —
    the anti-pattern XSLT still produces correct output, just slower.

11. **Map grid pages**: Already single-file XSLT after BizTalk compile. Tool receives the
    compiled XSLT not the raw multi-page .btm — no tool change needed.

12. **CDM pattern architecture guidance**: Architecture recommendation, not code generation.
    Already documented in `sandro-biztalk-patterns.md` §9 (canonical data model) and Section
    2.14 of the new `sandro-ebook-map-patterns.md`. No code change in migration tool.
