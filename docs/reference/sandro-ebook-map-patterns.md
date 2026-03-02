# BizTalk Mapping Patterns — Migration Reference

> **Source**: Sandro Pereira, "BizTalk Mapping Patterns and Best Practices" (2014, 365 pages)
> **Purpose**: Authoritative reference for map-level migration decisions. Covers every
> pattern chapter of the ebook — functoid translation, XSLT engine constraints, looping,
> grouping, sorting, conditional, NVP, CDM, hidden map properties, and performance.
> Sibling document `sandro-biztalk-patterns.md` covers orchestration and adapter patterns;
> this document is map-only.

---

## Table of Contents

1. [Functoid Migration Guide](#1-functoid-migration-guide)
2. [The Mapper Patterns — Logic Apps Equivalents](#2-the-mapper-patterns--logic-apps-equivalents)
3. [XSLT Engine Compatibility](#3-xslt-engine-compatibility)
4. [Dynamic Values in Maps — Migration Paths](#4-dynamic-values-in-maps--migration-paths)
5. [Orchestration Variables into Maps](#5-orchestration-variables-into-maps)
6. [Map Properties That Affect Migration](#6-map-properties-that-affect-migration)
7. [Hidden Compiler Behaviour](#7-hidden-compiler-behaviour)
8. [Functoid → XSLT Quick-Reference Table](#8-functoid--xslt-quick-reference-table)
9. [userCSharp: Replacement Table](#9-usercsharp-replacement-table)
10. [Known Gaps Summary](#10-known-gaps-summary)

---

## 1. Functoid Migration Guide

### 1.1 Built-in Functoids → XSLT Equivalents

BizTalk's built-in functoids compile to XSLT 1.0 patterns using `userCSharp:` extension function
calls. Every `userCSharp:` call in a BizTalk-compiled XSLT refers back into the C# map assembly
and will fail in Logic Apps XSLT processors. They must be replaced with native XPath / XSLT
equivalents at migration time.

**Logical / comparison functoids → pure XPath predicates**

| BizTalk Compiled Pattern | Logic Apps XSLT Replacement |
|---|---|
| `userCSharp:LogicalEq(string(a), "b")` → `$var = 'true'` | XPath: `a = 'b'` directly in `<xsl:if test="...">` |
| `userCSharp:LogicalNe(a, b)` | `a != b` |
| `userCSharp:LogicalGt(a, b)` | `a > b` |
| `userCSharp:LogicalGe(a, b)` | `a >= b` |
| `userCSharp:LogicalLt(a, b)` | `a < b` |
| `userCSharp:LogicalLe(a, b)` | `a <= b` |
| `userCSharp:LogicalIsString(string(field/text()))` | `string-length(field/text()) > 0` |
| `userCSharp:LogicalIsNumeric(x)` | `number(x) = number(x)` (NaN test — NaN is not equal to itself) |
| `userCSharp:LogicalIsDate(x)` | No XSLT 1.0 equivalent — Azure Function or Local Code Function |
| `userCSharp:LogicalNot(b)` | `not(b)` |
| `userCSharp:LogicalAnd(a, b)` | `a and b` |
| `userCSharp:LogicalOr(a, b)` | `a or b` |

**String functoids → XPath string functions**

| BizTalk Compiled Pattern | Logic Apps XSLT Replacement |
|---|---|
| `userCSharp:StringConcat(a, b, ...)` | `concat(a, b, ...)` — supports unlimited args in XPath 1.0 |
| `userCSharp:StringLength(s)` | `string-length(s)` |
| `userCSharp:StringUpperCase(s)` | `translate(s, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')` (XSLT 1.0); `upper-case(s)` in XSLT 3.0 (Data Mapper) |
| `userCSharp:StringLowerCase(s)` | `translate(s, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')` |
| `userCSharp:StringLeft(s, n)` | `substring(s, 1, n)` |
| `userCSharp:StringRight(s, n)` | `substring(s, string-length(s) - n + 1)` |
| `userCSharp:StringTrimLeft(s)` | `normalize-space(s)` — trims both ends and collapses internal spaces |
| `userCSharp:EmptyOrNull(s)` | `string-length(s) > 0` |

**Math functoids → XPath arithmetic**

| BizTalk Compiled Pattern | Logic Apps XSLT Replacement |
|---|---|
| `userCSharp:MathAdd(a, b)` | `$a + $b` (as XPath parameter variables) |
| `userCSharp:MathSubtract(a, b)` | `$a - $b` |
| `userCSharp:MathMultiply(a, b)` | `$a * $b` |
| `userCSharp:MathDivide(a, b)` | `$a div $b` (note: not `/`) |
| `userCSharp:MathModulo(a, b)` | `$a mod $b` |
| `userCSharp:MathRound(a)` | `round($a)` |
| `userCSharp:MathFloor(a)` | `floor($a)` |
| `userCSharp:MathCeil(a)` | `ceiling($a)` |
| `userCSharp:MathAbs(a)` | No XSLT 1.0 equivalent — Azure Function or Local Code Function |

**Cumulative functoids** (Sum, Min, Max, Avg, Count) compile to complex variable accumulation
patterns using `xsl:for-each` with running variables. These are valid XSLT 1.0 and translate
directly. Preserve verbatim. Note: do not attempt to simplify them — the patterns are correct.

**Direct links**

- Mandatory source → mandatory destination: `<xsl:value-of select="field/text()"/>`
- Optional source → optional destination: compiler wraps in `<xsl:if test="string(field/text())">`

Both patterns are XSLT 1.0 and translate directly to the Transform action.

**Structural functoids (Mass Copy, Looping, Table Looping, Iteration)**: See Section 2 per pattern.

---

### 1.2 Scripting Functoid (C# Inline) → Local Code Function

**BizTalk**: Inline C# is compiled into the map assembly. In the compiled XSLT it appears as
`userCSharp:FunctionName(args)` — an XPath extension function call that invokes .NET code.

**Logic Apps**: The `userCSharp:` namespace is not loaded by any Logic Apps XSLT processor.
Any XSLT containing `userCSharp:` calls will fail at runtime with a namespace resolution error.

**Migration path**:
1. Extract the C# function body from the Scripting Functoid's inline code panel
2. Create a Logic Apps Local Code Function (`.cs` stub in `lib/custom/` folder) with
   `[WorkflowActionTrigger]` attribute — this runs in-process with no HTTP latency
3. Call the function as a `LocalCodeFunction` action before the Transform action
4. Pass the result as a parameter to the Transform action (via Compose or SetVariable)

**When to use Azure Function instead**: Only if the C# code requires external NuGet packages,
must be shared across multiple Logic App projects, or needs independent scaling.

**Critical constraint**: The Integration Account XSLT mapper runs on **.NET 2.0**. Any Inline C#
code using post-2.0 syntax (`var`, LINQ, lambdas, `async/await`) will fail to compile even if
`msxsl:script` were supported. Rewrite to .NET 2.0-compatible C#, or use a Local Code Function
where .NET 8 isolated worker syntax is available.

---

### 1.3 Scripting Functoid (XSLT Inline) → Keep As-Is

**BizTalk**: An Inline XSLT Scripting Functoid embeds a raw XSLT template fragment directly into
the compiled stylesheet. No `userCSharp:` calls are generated — the XSLT is verbatim.

**Logic Apps**: The fragment is pure XSLT 1.0 and transfers directly to the Integration Account
Transform action stylesheet. No conversion is needed.

**Action required**: Copy the XSLT fragment verbatim into the target stylesheet. Ensure any
namespace declarations the fragment depends on are declared in the `<xsl:stylesheet>` root element
(see Section 1.5 on the `xsi` namespace issue).

---

### 1.4 Scripting Functoid (XSLT Call Template) → Include as Named Template

**BizTalk**: An "Inline XSLT Call Template" Scripting Functoid contains an `<xsl:template name="...">`
block placed at the stylesheet level. It is invoked via `<xsl:call-template name="...">` from within
the map body.

**Logic Apps**: Named templates and `xsl:call-template` are XSLT 1.0 — translate directly.

**Critical limitation**: The Integration Account XSLT engine does **not** support `xsl:include`
or `xsl:import`. All named templates from all "Call Template" functoids must be merged into a
single self-contained XSLT file. When assembling the final stylesheet from multiple grid pages,
consolidate all named templates into the single output file.

---

### 1.5 Scripting Functoid (XPath) → xpath() Expression

Scripting Functoids that contain a raw XPath expression rather than C# or XSLT compile to an
`<xsl:value-of select="..."/>` or `<xsl:for-each select="..."/>` using the XPath directly.
These are XSLT 1.0 and translate verbatim.

**Logic Apps XSLT**: Preserve the XPath expression.

**Logic Apps WDL** (when the XPath is used in an orchestration expression context rather than
a map): Translate using `xpath(xml(body('...')), '/path')`. Note that `xpath()` in WDL always
returns an **array** — use `first(xpath(...))` for scalar access.

---

### 1.6 External XSLT File → Direct Migration Path

**BizTalk**: A map can reference an external `.xslt` file instead of being built from the
visual Functoid grid. The XSLT file is embedded in the map assembly at compile time.

**Logic Apps (Integration Account)**: Upload the `.xslt` file directly to the Logic Apps
workspace or Integration Account maps gallery. Reference in the Transform action.

**Logic Apps (Data Mapper)**: If the XSLT uses XSLT 1.0 features only (no `xsl:for-each-group`,
no `xsl:sequence`), it can be used directly in a custom XSLT block within the Data Mapper file.
If it uses XSLT 3.0 features, it can be used with the Data Mapper's XSLT 3.0 engine (Saxon).

**Migration path**: No conversion needed for Integration Account. Verify no `xsl:include` or
`xsl:import` in the file (these are not supported). Verify no `msxsl:script` blocks.

---

### 1.7 Custom Functoids → Azure Function or Local Code Function

**BizTalk**: Custom Functoids are .NET assemblies that implement `BaseFunctoid`. They are
referenced by the BTM file and called at map compile time to generate XSLT, or at runtime
via extension functions.

**Logic Apps**: No equivalent registration mechanism. Two migration paths:

1. **Local Code Function** (preferred): If the custom functoid contains self-contained business
   logic with no external dependencies, extract the C# logic into a `[WorkflowActionTrigger]`
   stub. Call it before the Transform action and pass the result as a variable.

2. **Azure Function**: If the custom functoid requires external service calls, NuGet packages,
   or shared usage across multiple Logic App projects.

**Detection signal**: Custom functoids appear in .btm files with `functoidId` values outside
the standard BizTalk range (10001–10027 are standard; custom functoids use higher IDs or GUIDs)
or reference a custom DLL in the `<Script>` element's assembly path.

---

### 1.8 Mass Copy Functoid → xsl:copy-of

**BizTalk**: The Mass Copy Functoid copies an entire subtree (element + all descendants +
attributes) from source to destination using `<xsl:copy-of select="SourceNode"/>`.

**Logic Apps (Integration Account XSLT 1.0)**: `<xsl:copy-of>` is XSLT 1.0. Direct translation,
no conversion needed. Preserve the select expression verbatim.

**Logic Apps (Data Mapper XSLT 3.0)**: `<xsl:copy-of>` is also supported in XSLT 3.0. However,
Data Mapper's visual interface does not expose a "copy subtree" concept — use custom XSLT within
the Data Mapper file for this pattern.

---

## 2. The Mapper Patterns — Logic Apps Equivalents

### 2.1 Direct Translation Pattern

**BizTalk approach**: One source field linked directly to one destination field. Compiler
generates `<xsl:value-of select="SourceField/text()"/>`. Optional fields generate an `xsl:if`
existence check automatically.

**Logic Apps equivalent**: Identical XSLT. No conversion needed.

**Migration notes**: The compiler-generated existence check for optional fields
(`<xsl:if test="string(field/text())">`) is correct XSLT 1.0 and translates directly.

**XSLT compatibility**: Full, both IA and Data Mapper.

---

### 2.2 Data Translation Pattern (Lookup / Value Mapping)

**BizTalk approach**: A source value is mapped to a different destination value using one of:
- **Equal Functoid + Value Mapping Functoid**: generates `userCSharp:LogicalEq` + `xsl:if`
- **xsl:choose/xsl:when/xsl:otherwise** (Inline XSLT): cleanest approach
- **Muenchian key lookup**: best performance for large messages

**Logic Apps equivalent**:
- Replace `userCSharp:LogicalEq` with native XPath equality (`=`) in `xsl:if`
- `xsl:choose/xsl:when/xsl:otherwise` is XSLT 1.0 — preserve verbatim
- Muenchian key lookup via `xsl:key` + `generate-id()` is XSLT 1.0 — preserve verbatim

**Migration notes**: Detect `userCSharp:LogicalEq` in generated XSLT and replace with XPath `=`.
For switch-like multi-branch patterns (multiple Equal Functoid chains), prefer consolidation into
a single `xsl:choose` block for readability and performance.

**XSLT compatibility**: Full, both IA and Data Mapper. Data Mapper additionally supports
`xsl:for-each-group` for more readable grouping scenarios (see Section 2.8).

---

### 2.3 Content Enricher Pattern

**BizTalk approach**: Multiple source schemas or a lookup (via Database Functoid or custom
Scripting Functoid that makes a DB call-out) enrich the output message with additional fields
not present in the primary source.

**Logic Apps equivalent**: The Transform action takes a **single XML input document**. Multi-source
enrichment requires pre-merging data before the Transform:
1. Fetch enrichment data with an SQL connector query, HTTP action, or Local Code Function call
2. Compose a merged XML document using a Compose action that inlines both data sources
3. Pass the merged document as the single input to the Transform action

**Migration notes**: A .btm file referencing more than one source schema root (`<SrcTree>` with
multiple entries) is a Content Enricher. Flag as a HIGH gap requiring a pre-merge step in the
workflow. The XSLT itself may be valid — the problem is data availability, not the transform logic.

**XSLT compatibility**: N/A — the gap is at the workflow level, not within the XSLT file.

---

### 2.4 Content Filter Pattern

**BizTalk approach**: Removes unwanted elements from a message. In map form, simply not linking
a source element to any destination node causes the compiler to omit that element entirely.
The XSLT only outputs what is explicitly linked.

**Logic Apps equivalent**: Identical behaviour. The Transform action XSLT only generates output
elements explicitly constructed by the stylesheet. Un-linked source fields are silently dropped.

**Migration notes**: No action required. This is default XSLT behaviour.

**XSLT compatibility**: Full.

---

### 2.5 Splitter Pattern

**BizTalk approach**: One source document split into multiple output documents. In BizTalk this
lives in the **pipeline** (FlatFileDisassembler, XmlDisassembler) or in the orchestration via
a loop + multiple sends. The BizTalk map itself always produces a single output document.

**Logic Apps equivalent**:
- Envelope debatching → ForEach action iterating over child records
- Each iteration processes one split document independently
- Set `concurrency: 1` on the ForEach for sequential behaviour matching BizTalk debatching order
- Use the `splitOn` property on the trigger to auto-split arrays from the incoming payload

**Migration notes**: Splitter detection is in the orchestration shape analysis (LoopShape over
a collection), not in the map analyzer. In pure map context there is no Splitter — a BizTalk
map always produces one output document.

**XSLT compatibility**: N/A — pattern is workflow-level, not map-level.

---

### 2.6 Aggregator Pattern

**BizTalk approach**: Multiple messages combined into one output. In a map context, this is done
with Looping Functoids drawing from multiple source paths, or by having multiple `xsl:for-each`
blocks writing to the same destination container element.

**Logic Apps equivalent**:
- In-XSLT aggregation (multiple `xsl:for-each` blocks writing to same destination container):
  translates directly to Integration Account XSLT — preserve verbatim
- Cross-message aggregation: requires a stateful workflow, a Foreach loop collecting messages
  into an array variable, then a final Transform action on the aggregated XML

**Migration notes**: Multi-source map roots (multiple `<SrcTree>` entries in .btm) indicate
cross-message aggregation needs. These require workflow-level pre-merge before the single
Transform action can run.

**XSLT compatibility**: In-XSLT aggregation — full. Cross-message — workflow design question.

---

### 2.7 Grouping Pattern (Muenchian Method)

**BizTalk approach**: BizTalk Mapper has no native Group-By Functoid. Grouping requires a
Scripting Functoid with Inline XSLT using the Muenchian Method: `xsl:key` + `generate-id()`.

Single-key example:
```xslt
<xsl:key name="cities-key" match="Record" use="City"/>
<xsl:for-each select="Record[generate-id(.)=generate-id(key('cities-key', City)[1])]">
  <Group><City><xsl:value-of select="City"/></City></Group>
</xsl:for-each>
```

Multi-key (compound key with separator character):
```xslt
<xsl:key name="groups" match="Record" use="concat(City, '|', AccountType)"/>
```

Sorting within groups:
```xslt
<xsl:for-each select="key('groups', City)">
  <xsl:sort select="Amount" data-type="number" order="descending"/>
</xsl:for-each>
```

**Logic Apps (Integration Account XSLT 1.0)**: `xsl:key` and `generate-id()` are XSLT 1.0 —
identical XSLT works directly. Preserve verbatim.

**Logic Apps (Data Mapper XSLT 3.0)**: XSLT 3.0 offers `xsl:for-each-group` which is simpler:
```xslt
<xsl:for-each-group select="Record" group-by="City">
  <Group><City><xsl:value-of select="current-grouping-key()"/></City></Group>
</xsl:for-each-group>
```
However, Data Mapper's visual interface does not expose Muenchian grouping — use a custom XSLT
block within the LML file for this pattern.

**Migration notes**: The `xsl:key` declaration MUST be at the top level of the stylesheet
(child of `<xsl:stylesheet>`), not inside a template body. BizTalk achieves this by putting the
`xsl:key` in a separate "Inline XSLT Call Template" functoid. When assembling the final XSLT,
ensure all `xsl:key` declarations are promoted to the stylesheet root level.

**XSLT compatibility**: Integration Account (full, XSLT 1.0). Data Mapper: use `xsl:for-each-group`
instead of Muenchian for new maps; preserve Muenchian verbatim for migrated maps.

---

### 2.8 Sorting Pattern

**BizTalk approach**: No native Sort Functoid. Implemented via Scripting Functoid with Inline XSLT
using `xsl:sort` inside `xsl:for-each`.

```xslt
<!-- Text sort (lexicographic) -->
<xsl:for-each select="Record">
  <xsl:sort select="Name" order="ascending"/>
  <!-- output -->
</xsl:for-each>

<!-- Numeric sort — MUST use data-type="number" -->
<xsl:for-each select="Record">
  <xsl:sort select="@Id" data-type="number" order="ascending"/>
</xsl:for-each>

<!-- Multi-field sort: primary, secondary -->
<xsl:for-each select="Record">
  <xsl:sort select="@OrderId" data-type="number" order="ascending"/>
  <xsl:sort select="ProductId" data-type="number" order="ascending"/>
</xsl:for-each>
```

**CRITICAL gotcha**: Without `data-type="number"`, numeric fields sort lexicographically:
`10 < 2` in text sort. Any field name containing Id, Amount, Count, Total, Price, or Quantity
is likely numeric and needs `data-type="number"`.

**Logic Apps equivalent**: `xsl:sort` is XSLT 1.0 — identical in Integration Account and Data
Mapper. Preserve verbatim.

**Migration notes**: Scan extracted XSLT for `xsl:sort` elements that lack `data-type="number"`
on fields with numeric-sounding names. Flag as a potential sort-correctness issue.

**XSLT compatibility**: Full.

---

### 2.9 Conditional Pattern

**If-Then (single branch)**:
- BizTalk: Equal Functoid + Value Mapping Functoid → generates `userCSharp:LogicalEq` + `xsl:if`
- Logic Apps: Replace `userCSharp:LogicalEq` with XPath `=` directly in `xsl:if test="..."`
- Direct optional link: `<xsl:if test="string(SourceField/text())">` — preserve verbatim

**If-Then-Else (two branches)**:
- BizTalk: Two Value Mapping Functoids (one with negated condition) → verbose; OR Inline XSLT
  with `xsl:choose` → cleaner
- Logic Apps: `xsl:choose/xsl:when/xsl:otherwise` — XSLT 1.0, preserve verbatim

**Switch (multi-branch)**:
- BizTalk: Chained Equal Functoids (poor performance for large messages) OR Inline XSLT with
  `xsl:choose` (recommended) OR Muenchian key lookup (best performance for large messages)
- Logic Apps: Preserve `xsl:choose` verbatim. Replace chained-Functoid patterns with
  `xsl:choose` for readability and performance.

**Existence check before mapping**:
- String: `<xsl:if test="string(SourceField/text())">` or `string-length() > 0`
- Numeric: `number(field) = number(field)` (NaN test)
- Date: No XSLT 1.0 equivalent — Azure Function or Local Code Function required

**Nillable elements**: The `xsi` namespace declaration is only added by the BizTalk compiler
when an IsNil or Nil Value Functoid is present. For maps involving nillable schemas, always
declare `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` explicitly in the
`<xsl:stylesheet>` element — do not rely on compiler auto-injection.

**XSLT compatibility**: Full for all conditional patterns that use native XPath/XSLT.
Azure Function required only for date validation.

---

### 2.10 Looping Pattern

**One-to-One Looping**: Single source repeating record → single destination repeating record.
```xslt
<xsl:for-each select="SourceRecord">
  <DestRecord><xsl:value-of select="Field/text()"/></DestRecord>
</xsl:for-each>
```
Direct translation, preserve verbatim.

**One-to-Many Looping**: One source record generates multiple destination record types.
Separate `xsl:for-each` blocks over the same source element — preserve verbatim.

**Many-to-One Looping (CRITICAL rule)**: Multiple source types all map to one destination type.
Must use a **single** Looping Functoid with ALL source records connected to it — compiler
generates a union select:
```xslt
<xsl:for-each select="TypeA | TypeB">
  <DestRecord>...</DestRecord>
</xsl:for-each>
```
Using two separate Looping Functoids generates incorrect output (all TypeA first, then all TypeB,
not interleaved). The XPath `|` union preserves document order. Preserve verbatim.

**Many-to-Many Looping**: Combine One-to-Many and Many-to-One. Multiple `xsl:for-each` with
union selects. Preserve verbatim.

**Conditional Looping**: Loop with a filter condition. BizTalk generates `xsl:for-each` + inner
`xsl:if`. For performance on large messages, prefer the XPath predicate form:
```xslt
<!-- Slow: -->
<xsl:for-each select="Record">
  <xsl:if test="string(State/text()) = 'FL'">...</xsl:if>
</xsl:for-each>

<!-- Fast (preferred): -->
<xsl:for-each select="Record[State = 'FL']">...</xsl:for-each>
```
The predicate form is a performance optimization — apply during migration where the BizTalk
`userCSharp:` conditional pattern is being replaced.

**Nested-to-Nested Looping**: Nested `xsl:for-each` blocks. Preserve verbatim.

**Iteration Functoid** (sequential counter):
```xslt
<LineNumber><xsl:value-of select="position()"/></LineNumber>
```
`position()` is XSLT 1.0 — preserve verbatim in Transform action XSLT.
In Logic Apps WDL (workflow level): use `iterationIndexes('ForEachActionName')` function.

**XSLT compatibility**: Full. Union selects (`|`), `xsl:sort`, `position()` all supported in
both Integration Account and Data Mapper engines.

---

### 2.11 Record Count Functoid — Global Scope Bug

**CRITICAL**: The Record Count Functoid generates an **absolute** XPath:
```xslt
<xsl:value-of select="count(/s0:Root/Record)"/>
```
This counts ALL records in the entire message, not records in the current loop context.
When used inside a nested `xsl:for-each`, it returns the global total for every parent —
not the count of children for that specific parent.

**Correct approach** — use a relative path:
```xslt
<xsl:for-each select="Parent">
  <TotalOfChildren>
    <xsl:value-of select="count(Child)"/>  <!-- relative: scoped to current Parent -->
  </TotalOfChildren>
</xsl:for-each>
```

**Migration action**: Detect `count(/absolute/xpath)` patterns inside `xsl:for-each` blocks.
Flag as a potential bug. Suggest rewriting to `count(relative/path)`.

---

### 2.12 Flat Structure to Repeating Structure (Table Looping / EAV)

**Table Looping Functoid**: Solves flat-to-repeating and Name/Value Pair scenarios. Generates
static-row XSLT where the row count is fixed at design time:
```xslt
<xsl:for-each select="Line">
  <xsl:variable name="var:v1" select="PropertyName1"/>
  <xsl:variable name="var:v2" select="PropertyValue1"/>
  <Line Item="{Item/text()}">
    <Properties>
      <Name><xsl:value-of select="$var:v1"/></Name>
      <Value><xsl:value-of select="$var:v2"/></Value>
    </Properties>
  </Line>
</xsl:for-each>
```

The variable-based pattern is valid XSLT 1.0 — preserve verbatim. Document the row count as
a design-time constant (cannot be changed dynamically at runtime).

**Flat-to-repeating with empty-record guard**: When source elements are mandatory, the compiler
may generate empty destination records. Add existence checks:
```xslt
<xsl:if test="string-length(Address1) > 0">
  <Address><xsl:value-of select="Address1"/></Address>
</xsl:if>
```

**Value Mapping vs Value Mapping (Flattening) Functoid distinction**:
- Value Mapping: condition false → empty destination node `<node/>` still exists in output
- Value Mapping (Flattening): condition false → node is completely absent
This distinction matters for downstream processing that tests node existence vs content.

Do NOT use Looping Functoid together with Value Mapping (Flattening) Functoid — the compiler
treats this combination incorrectly and produces wrong output.

---

### 2.13 Name-Value Pair Transformation Pattern

**Hierarchical → NVP (forward)**:

Solution 3 (Inline XSLT, dynamic, Sandro's recommendation) using `local-name()`:
```xslt
<Properties>
  <xsl:for-each select="/Request/Body/*[string-length(.) > 0 and local-name() != 'ServiceName']">
    <Property>
      <Name><xsl:value-of select="local-name()"/></Name>
      <Value><xsl:value-of select="."/></Value>
    </Property>
  </xsl:for-each>
</Properties>
```
Replace `userCSharp:EmptyOrNull` with `string-length(.) > 0` XPath predicate.

**NVP → Hierarchical (reverse)**: XPath predicate lookup (Solution 3, recommended):
```xslt
<Type>
  <xsl:value-of select="//Properties/Property[Name='Type']/Value/text()"/>
</Type>
```
This eliminates the N×M iteration problem of Solution 1 (one `xsl:for-each` per destination
field scanning all Property records). Apply this optimization during migration.

**Migration notes**: Detect multiple `xsl:for-each` over Property records with
`userCSharp:LogicalEq` testing the Name field — this is the Solution 1 anti-pattern. Replace
with the XPath predicate form.

**XSLT compatibility**: Full — `local-name()`, `//` navigation, and predicate selectors are
all XSLT 1.0.

---

### 2.14 Canonical Data Model Pattern

**BizTalk approach**: CDM is implemented at the **port level** — Receive Port Inbound Maps and
Send Port Outbound Maps. Maps are applied automatically by the runtime without explicit shape in
the orchestration. The orchestration works only with canonical messages.

**Logic Apps equivalent**: Logic Apps has no port-level map application. Maps are explicit
Transform actions inside workflows:
1. A normalization workflow receives a source-format message and applies a Transform action
   to produce canonical XML
2. The normalized message is placed on a Service Bus topic for downstream consumption
3. Downstream workflows pick up canonical messages and apply Transform actions to target formats

Each source system becomes a separate receiver workflow. The CDM boundary is the Service Bus
topic subscription filter.

**Migration notes**: The binding file analyzer should detect multiple maps configured on the
same receive or send port. Each port-level map → one explicit Transform action in the migrated
workflow. When multiple source systems feed the same orchestration with different schemas,
recommend CDM pattern in the architecture recommendation output.

**CDM best practices** (applicable to Logic Apps design):
- Canonical schemas: one per message type (Invoice, Order, Payment — not one for all)
- Normalization transform: apply at the trigger workflow boundary, before any routing
- Use `xsd:any` extensions in canonical schema for future-proofing
- Apply versioning and namespaces to canonical schemas

---

### 2.15 EDI Sibling Interleaving Pattern

Complex EDI scenarios (e.g., X12 834 with Subscriber + Dependent records per Enrollment) require
interleaved output maintaining per-parent order. The only reliable solution for recursive sibling
records is custom Inline XSLT:

```xslt
<xsl:for-each select="s0:EnrollmentsBySubscriber">
  <xsl:for-each select="s0:Enrollment">
    <xsl:if test="s0:Subscriber/s0:MemberId/text()!=''">
      <TS834_2000_Loop><INS_MemberLevelDetail><INS02>Y</INS02></INS_MemberLevelDetail></TS834_2000_Loop>
    </xsl:if>
    <xsl:for-each select="s0:Dependents/s0:Dependent">
      <xsl:if test="s0:MemberId/text()!=''">
        <TS834_2000_Loop><INS_MemberLevelDetail><INS02>N</INS02></INS_MemberLevelDetail></TS834_2000_Loop>
      </xsl:if>
    </xsl:for-each>
  </xsl:for-each>
</xsl:for-each>
```

**Logic Apps**: This is pure XSLT 1.0. Translate directly to Integration Account Transform.
Do not attempt to simplify or restructure — the nested for-each pattern is the only correct
form for recursive sibling interleaving.

**Migration notes**: When the extracted XSLT contains complex nested for-each patterns over
sibling records (common in EDI maps), preserve verbatim. Flag as "EDI Sibling Interleaving —
manual verification required" in the migration report.

---

## 3. XSLT Engine Compatibility

### 3.1 BizTalk Integration Account: .NET 2.0 / XSLT 1.0 Only

The Logic Apps Integration Account Transform action uses exactly the same XSLT engine as
BizTalk Server's map runtime: **.NET 2.0 XslTransform** with XSLT 1.0.

**Directly compatible** (no changes needed):
- All pure XSLT 1.0 constructs: `xsl:template`, `xsl:for-each`, `xsl:if`, `xsl:choose`,
  `xsl:sort`, `xsl:key`, `xsl:call-template`, `xsl:apply-templates`, `xsl:copy-of`
- XPath 1.0 functions: `string()`, `number()`, `position()`, `last()`, `count()`,
  `concat()`, `substring()`, `translate()`, `normalize-space()`, `generate-id()`
- Namespace-aware XPath with declared prefixes

**Incompatible** (requires replacement):
- `userCSharp:*` extension function calls — see Section 1.1 / Section 9 for replacements
- `msxsl:script` blocks — C# code must be extracted to Local Code Function
- `xsl:include` and `xsl:import` — not supported; all templates must be in one file
- External URI resolution — not supported for security reasons

**C# in msxsl:script**: If any C# code in a `msxsl:script` block uses post-.NET 2.0 syntax
(`var`, LINQ, lambdas, generics beyond simple), it will fail. Rewrite to .NET 2.0-compatible
C# or move to a Local Code Function.

---

### 3.2 Logic Apps Data Mapper: XSLT 3.0

The Logic Apps Data Mapper (built-in Standard feature, `.yml` + `.xslt` pair files) uses an
**XSLT 3.0** engine (Saxon-derived). This is a superset of XSLT 1.0.

**Advantages over Integration Account**:
- `xsl:for-each-group` — replaces Muenchian grouping
- `xsl:sequence`, `xsl:iterate`, `xsl:merge`
- XPath 3.1 functions: `string-join()`, `distinct-values()`, `tokenize()`, `matches()`, `replace()`
- `upper-case()`, `lower-case()` (no need for `translate()` workaround)
- Maps compile to `.yml` (LML) + custom `.xslt` file — different toolchain than `.btm`

**Limitations relative to Integration Account**:
- Muenchian grouping not supported in the Data Mapper visual designer (use custom XSLT block)
- `xsl` namespace in custom XSLT blocks must be declared on the wrapper element (not auto-injected)
- The `xmlns:xsl` prefix is NOT automatically available in custom script sections

```xml
<!-- CORRECT: declare namespace on wrapper -->
<xsl:choose xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:when test="1 eq 1"><Name>Value</Name></xsl:when>
</xsl:choose>
```

---

### 3.3 Constructs That Must Be Rewritten for Integration Account

| BizTalk / Inline C# Pattern | Required Change for Integration Account |
|---|---|
| `userCSharp:*` extension calls | Replace with native XPath — see Section 9 |
| `msxsl:script` blocks with C# | Extract to Local Code Function |
| `xsl:include` / `xsl:import` | Inline all imported content into single file |
| Post-.NET 2.0 C# syntax in scripts | Rewrite to .NET 2.0 or use Local Code Function |
| `userCSharp:LogicalIsDate` | Azure Function or Local Code Function |
| `userCSharp:MathAbs` | Azure Function or Local Code Function |
| Regex in inline C# | Azure Function (no XSLT 1.0 regex) |
| LINQ in inline C# | Azure Function (.NET 2.0 constraint) |
| `count(/absolute/path)` in nested loop | Rewrite to `count(relative/path)` |
| Multi-part map (multiple source schemas) | Workflow-level pre-merge before Transform action |

---

### 3.4 Constructs That Can Be Simplified When Targeting Data Mapper

| Integration Account XSLT 1.0 Pattern | Simplified Data Mapper XSLT 3.0 Equivalent |
|---|---|
| Muenchian grouping (`xsl:key` + `generate-id()`) | `xsl:for-each-group group-by="..."` |
| `translate(s,'abc...z','ABC...Z')` (uppercase) | `upper-case(s)` |
| `translate(s,'ABC...Z','abc...z')` (lowercase) | `lower-case(s)` |
| `substring-before` + `substring-after` chain | `tokenize(s, pattern)[position]` |
| Nested for-each for distinct values | `distinct-values()` XPath 3.1 function |
| Complex `count()` + position tracking | `xsl:iterate` with `xsl:param` |

---

## 4. Dynamic Values in Maps — Migration Paths

BizTalk maps sometimes access external dynamic values at transform time. These patterns have
no direct equivalent in Logic Apps Transform actions.

### 4.1 Configuration Files → App Settings

**BizTalk pattern**: Scripting Functoid reads a config file (`.config` or custom XML) at runtime
to get a conversion rate, lookup value, or threshold.

**Logic Apps**: Pass the config value into the workflow via `@appsetting('KVS_...')` and use a
Compose or SetVariable action before the Transform action to make the value available.
The XSLT itself cannot read app settings — values must be passed as XSLT parameters.

**Migration pattern**:
1. `Initialize_Variable` → initialize variable with `@appsetting('Config_Value')`
2. `Compose_Params` → compose XML snippet: `<Params><Rate>@{variables('Rate')}</Rate></Params>`
3. `Merge_Input_With_Params` → compose XML merging original message with Params
4. `Transform_Message` → use merged XML as input to Transform action
   (XSLT reads params from `//Params/Rate`)

---

### 4.2 Registry Values → Eliminated

**BizTalk pattern**: Very old maps (pre-2006) sometimes read from Windows Registry in Scripting
Functoid C# code.

**Logic Apps**: No Azure equivalent for Windows Registry. Must migrate to App Settings or Key
Vault. Extract the registry key's purpose and replace with `@appsetting('...')`.

---

### 4.3 SSO Affiliate Applications → Key Vault

**BizTalk pattern**: Scripting Functoids may call BizTalk SSO to retrieve affiliate application
credentials (usernames, passwords, API keys) at runtime. SSO provides a centralized credential
store without hardcoding secrets in maps.

**Logic Apps equivalent**: Azure Key Vault + Managed Identity. Reference Key Vault secrets
via `@appsetting('KVS_...')` in the workflow, pass as a variable to the Transform action.
Never embed credentials in XSLT.

---

### 4.4 BRE Policies → Azure Rules Engine or Inline Conditions

**BizTalk pattern**: Scripting Functoid calls a BizTalk BRE policy (Policy.Execute) to evaluate
business rules that determine how the transformation should proceed.

**Logic Apps equivalent**: Two paths:
- Simple rules (fewer than 15 conditions): inline `xsl:choose` directly in the XSLT or
  Logic Apps If/Switch actions in the workflow before the Transform
- Complex or frequently-changing rules: Azure Logic Apps Rules Engine (uses same BRE runtime,
  lowest rework), or Azure Functions with rule library

---

### 4.5 Custom DB Lookups in Functoids → SQL Connector

**BizTalk pattern**: Database Functoid (DB Lookup, Value Extractor) executes a SQL query during
map transformation to enrich output with reference data.

**Logic Apps equivalent**: The Transform action cannot make database calls during execution.
Decouple enrichment from transformation:
1. Before the Transform action: SQL ServiceProvider connector query to fetch reference data
2. Store result in a Logic Apps variable
3. Compose the variable into the input XML before the Transform action

---

## 5. Orchestration Variables into Maps

BizTalk orchestrations can pass values to maps in three ways:

### 5.1 Direct Message Construction (Most Common)

The orchestration constructs a new message (Message Assignment shape) that includes the extra
fields, then passes the enriched message to the map via a Transform shape.

**Logic Apps equivalent**: SetVariable or Compose action before the Transform action.
The Compose result is passed as the Transform input. The XSLT reads the extra fields from the
composed input XML.

---

### 5.2 XSLT Parameters via Custom Pipeline

BizTalk allows calling an XslTransform with custom XsltArgumentList parameters, but this is
only available via custom pipeline components or custom code — not via the standard Transform
shape.

**Logic Apps equivalent**: No direct equivalent for XSLT parameter injection through the
standard Transform action. Use the pre-merge pattern (Section 4.1) to embed parameter values
in the input XML.

---

### 5.3 Correlation-Derived Values

Orchestration correlation set values (instance IDs, tracking IDs) are sometimes passed into
a map for audit/tracking fields in the output message.

**Logic Apps equivalent**: Use `@{workflowRunId()}` or `@{guid()}` WDL expressions.
Set in a variable before the Transform action and embed in the input XML.

---

## 6. Map Properties That Affect Migration

These are XML attributes on the `<mapsource>` element in the .btm file. The BTM parser should
extract and document them. Several affect XSLT generation in ways that must be replicated.

### 6.1 IgnoreNamespacesForLinks

- **True** (default): XPath in compiled XSLT does not include namespace prefixes. Links survive
  namespace changes.
- **False**: XPath includes namespace prefixes. Required when same element name appears at same
  level with different namespaces. Renaming a schema namespace breaks all map links.

**Migration impact**: When `False`, the extracted XSLT contains namespace-prefixed XPath that
references specific namespace URIs. These namespace declarations must be preserved verbatim in
the `<xsl:stylesheet>` header. When `True`, XPath is portable and requires no special handling.

---

### 6.2 OmitXmlDeclaration

- Controls whether `<?xml version="1.0" encoding="...">` appears in output.
- **At BizTalk runtime: this property has NO effect** — the BizTalk pipeline overrides it.
  Sandro concludes this property is effectively obsolete.

**Migration impact**: Do not emit `<xsl:output omit-xml-declaration="yes/no">` in generated
XSLT unless the downstream system explicitly requires or prohibits the declaration. Default
Integration Account behaviour (no declaration) is acceptable for most cases.

---

### 6.3 Method (Output Serialization)

- **xml** (default): Output is well-formed XML — standard Transform action usage
- **text**: Output is plain text — all XML tags stripped, values concatenated. Requires
  `<xsl:output method="text"/>` in the stylesheet.
- **html**: Same as xml in practice for BizTalk — no special handling needed

**Migration impact**: When `method="text"`, the Transform action output is a raw string, not
XML. Downstream actions must handle it as text content, not attempt to parse it as XML.
Document in the workflow generation output when a map has `Method=text`.

---

### 6.4 CopyProcessingInstructions (CopyPIs)

- **False** (default): Processing instructions (e.g., InfoPath `<?mso-infoPathSolution ...?>`)
  are dropped from the output.
- **True**: Processing instructions are copied using:
  ```xslt
  <xsl:for-each select="processing-instruction()">
    <xsl:processing-instruction name="{name()}"><xsl:value-of select="."/></xsl:processing-instruction>
  </xsl:for-each>
  ```

**Migration impact**: Detect `CopyPIs=Yes` in .btm source attributes. If present, add the
processing instruction copy template to generated XSLT. For most BizTalk-to-Logic Apps
migrations, InfoPath processing instructions are irrelevant and can be dropped.

---

### 6.5 GenerateDefaultFixedNodes

- **Yes** (default): Compiler respects `default=` and `fixed=` attributes in the destination
  schema XSD. Elements with schema defaults appear in output even if not explicitly mapped.
- **No**: Only explicitly mapped elements are included. Schema default values are ignored.
- **RequiredDefaults**: Only required elements with defaults are included.

**Critical migration impact**: The Integration Account XSLT engine does **not** automatically
apply XSD default values — it only outputs what the XSLT explicitly generates. This matches
`GenerateDefaultFixedNodes=No` behaviour.

When the BizTalk map relied on `GenerateDefaultFixedNodes=Yes`, the migrated Transform action
will silently drop those default-value elements. To fix, add explicit `<xsl:otherwise>` with
the default value:
```xslt
<Type>
  <xsl:choose>
    <xsl:when test="string-length(SourceType) > 0"><xsl:value-of select="SourceType"/></xsl:when>
    <xsl:otherwise>Person</xsl:otherwise>  <!-- default value from XSD -->
  </xsl:choose>
</Type>
```

**Detection**: Scan the destination XSD for elements with `default=` or `fixed=` attributes.
If the XSLT does not explicitly emit those elements, flag as a potential silent-drop gap.

---

### 6.6 PreserveSequenceOrder

- **No** (default): When mapping XSD sequence groups (`FootballPlayers | HockeyPlayers`),
  all instances of one type are output first, then all of the other — order is NOT preserved.
  Compiler generates two separate `xsl:for-each` blocks.
- **Yes**: Players appear in their original interleaved document order. Compiler generates a
  union XPath: `<xsl:for-each select="FootballPlayers | HockeyPlayers">`.

**XPath `|` union operator**: In XPath 1.0, the union preserves document order by default.
Two separate `xsl:for-each` blocks do not interleave — they process all of one type, then all
of the other.

**Migration impact**: When `PreserveSequenceOrder=Yes`, the extracted XSLT should use a union
select. If `No` and the two-`xsl:for-each` pattern is present, document that interleaving is
lost — only flag as a gap if the destination system requires ordered output.

---

### 6.7 TreatElementsAsRecords

- **No** (default): `xsl:for-each` is placed at the parent record when child has `maxOccurs=1`.
- **Yes**: `xsl:for-each` is placed at the child field regardless of `maxOccurs`. Required for
  correct behaviour when an optional parent has a repeating child.

With `Yes`, the compiler generates a single-path `xsl:for-each`:
```xslt
<xsl:for-each select="OptionalParent/Child">...</xsl:for-each>
```
instead of two nested loops. More efficient, but requires a Looping Functoid to ensure correct
behaviour when the child is mandatory within a repeating parent.

**Migration impact**: Parse this attribute from `<mapsource>`. When `Yes`, expect single-path
for-each forms. When `No` with complex optional/repeating patterns, note potential double-for-each
inefficiency as an optimization opportunity.

---

### 6.8 OptimizeValueMapping

- **Yes** (default): Value Mapping Functoid invocations are placed inside the `xsl:if` body —
  computation only happens when the condition is true.
- **No**: Functoid is invoked unconditionally before the `xsl:if`, wasting CPU.

**Migration impact**: When generating XSLT, always place computed values inside the condition
body. Avoid computing values outside conditionals when they are only used inside them. This
matches the `Yes` (default) BizTalk behaviour and is the recommended Logic Apps best practice.

---

## 7. Hidden Compiler Behaviour

### 7.1 Automatic Loop Inference

The BizTalk Mapper compiler automatically infers looping from source schema structure. When a
source record has `maxOccurs > 1` or `unbounded`, the compiler generates `xsl:for-each`
automatically for direct links. A Looping Functoid is not required for simple one-to-one looping
— it is used for readability and complex multi-source scenarios.

**Impact**: The compiled XSLT already contains explicit `xsl:for-each` statements — loop
inference has already been resolved. No special handling needed when migrating the compiled XSLT.

---

### 7.2 Compiler-Generated Variables

For complex Functoid chains, the BizTalk compiler introduces intermediate `xsl:variable`
declarations (named `var:v1`, `var:v2`, etc.) to hold partial results. These are valid XSLT 1.0
and translate directly.

**Important**: Variable names in XSLT 1.0 are scoped to the template body. Variables declared
in one template are not accessible in another. The BizTalk compiler respects this — all
intermediate variables are in the same template scope. Preserve this structure in migrated XSLT.

---

### 7.3 Map Grid Pages → Single Stylesheet

A .btm map can have multiple grid pages. All pages compile into a single XSLT stylesheet.
Page boundaries are not preserved in the XSLT output — pages are purely a visual organization
tool in the BizTalk Mapper designer.

**Impact**: The extracted XSLT is already a merged single-file stylesheet. When assembling XSLT
from a .btm that has multiple pages, ensure all `xsl:key` declarations (from Muenchian grouping
on any page) are promoted to the stylesheet root level. Named templates from Call Template
functoids on any page must all appear at the top level of the output stylesheet.

---

### 7.4 Namespace Declarations

The BizTalk Mapper compiler conditionally adds certain namespace declarations to the
`<xsl:stylesheet>` element:
- `xmlns:xsi` (XMLSchema-instance): only when IsNil or Nil Value Functoid is used
- `xmlns:userCSharp` (extension namespace): only when Inline C# Scripting Functoids are present
- Source schema namespace (`xmlns:s0`, `xmlns:s1`): always added when namespace-aware links are used

**Impact**: When generating Logic Apps XSLT:
- Remove `xmlns:userCSharp` — this namespace has no meaning outside BizTalk
- Retain `xmlns:xsi` only if the XSLT explicitly uses `xsi:nil` — add it manually when
  nillable schema fields are mapped
- Retain source schema namespaces as needed by XPath selectors
- Always declare all namespaces used in XPath expressions in the `<xsl:stylesheet>` header

---

### 7.5 Scripting Functoid Script Language

Scripting Functoids support four script types: Inline C#, Inline VB.NET, Inline JScript.NET,
and Inline XSLT. All but Inline XSLT generate `userCSharp:` extension function calls in the
compiled XSLT — the runtime calls the appropriate .NET language compiler. VB.NET and JScript.NET
inline scripts have the same .NET 2.0 constraint as Inline C#.

**Detection**: All three language variants appear identically as `userCSharp:` calls in the
compiled XSLT output — you cannot distinguish C# from VB.NET from JScript.NET in the XSLT.
Look at the `.btm` source XML `<Script Language="...">` attribute for the original language.

**Migration impact**: VB.NET and JScript.NET inline scripts must also be migrated to Local Code
Functions (using C# or the target language). Budget the same per-script effort.

---

## 8. Functoid → XSLT Quick-Reference Table

| BizTalk Functoid | Compiled XSLT Pattern | Logic Apps Equivalent |
|---|---|---|
| Direct link (mandatory) | `<xsl:value-of select="field/text()"/>` | Same in XSLT |
| Direct link (optional) | `<xsl:if test="string(field/text())"><elem>...</elem></xsl:if>` | Same in XSLT |
| Mass Copy Functoid | `<xsl:copy-of select="node"/>` | Same in XSLT |
| Equal Functoid | `userCSharp:LogicalEq(string(a), "b")` → `$var = 'true'` | Replace with XPath `a = 'b'` |
| Logical String Functoid | `userCSharp:LogicalIsString(string(field/text()))` | Replace with `string-length(field/text()) > 0` |
| Logical Numeric Functoid | `userCSharp:LogicalIsNumeric(...)` | Replace with `number(x) = number(x)` (NaN test) |
| Logical Date Functoid | `userCSharp:LogicalIsDate(...)` | Azure Function or Local Code Function |
| Value Mapping Functoid | `<xsl:if test="$bool='true'"><Field>value</Field></xsl:if>` | Same in XSLT; note: false → empty node present |
| Value Mapping (Flattening) | Nested `xsl:for-each` with inner `xsl:if` | Same in XSLT; false → node absent |
| Looping Functoid | `<xsl:for-each select="Record">` | Same in XSLT |
| Looping (Many-to-One) | `<xsl:for-each select="TypeA \| TypeB">` | Same in XSLT — preserves document order |
| Table Looping + Table Extractor | `<xsl:variable name="var:v1" select="field1"/>`... | Same in XSLT; row count is design-time constant |
| Record Count Functoid | `count(/absolute/path/Record)` | Change to `count(relative/path)` for scoped count |
| Iteration Functoid | `<xsl:value-of select="position()"/>` | Same in XSLT; or `iterationIndexes('loopName')` in WDL |
| String Constant Functoid | `<DestField>CONSTANT_VALUE</DestField>` | Same in XSLT or Compose action in workflow |
| String Concatenate Functoid | `userCSharp:StringConcat(a, b, ...)` | Replace with `concat(a, b, ...)` |
| String Uppercase Functoid | `userCSharp:StringUpperCase(s)` | `translate(s, 'abc...z', 'ABC...Z')` (XSLT 1.0); `upper-case(s)` (XSLT 3.0) |
| String Length Functoid | `string-length(s)` | Same in XSLT |
| Math Add Functoid | `userCSharp:MathAdd(a, b)` | `$a + $b` in XPath |
| Math Divide Functoid | `userCSharp:MathDivide(a, b)` | `$a div $b` (not `/`) |
| Math Modulo Functoid | `userCSharp:MathModulo(a, b)` | `$a mod $b` |
| Math Abs Functoid | `userCSharp:MathAbs(a)` | No XSLT 1.0 equivalent — Azure Function |
| Cumulative Sum/Min/Max | Complex variable accumulation | Preserve verbatim |
| Inline C# Scripting Functoid | `userCSharp:CustomFunction(args)` | Azure Function or Local Code Function |
| Inline XSLT Scripting Functoid | Raw XSLT fragment | Embed directly in Transform action stylesheet |
| Inline XSLT Call Template | `<xsl:template name="...">` | Promote to stylesheet root level in merged file |
| External Assembly Scripting Functoid | `userCSharp:AssemblyMethod(args)` | Azure Function wrapping original DLL |
| Muenchian key (`xsl:key`) | Inline XSLT with `xsl:key` declaration | Preserve verbatim (XSLT 1.0 fully supported) |
| IsNil Functoid | Generates `xsi:nil` namespace + nil check | Add `xmlns:xsi` explicitly; use `@xsi:nil` in XPath |
| Nil Value Functoid | Sets `xsi:nil="true"` on output element | `<xsl:attribute name="xsi:nil">true</xsl:attribute>` |
| Date Functoid | `userCSharp:DateCurrentDate()` | Azure Function for XSLT 1.0; `substring(string(current-dateTime()),1,10)` in XSLT 3.0 |
| Custom Functoid | Custom `functoidId` / DLL reference | Azure Function or Local Code Function |

---

## 9. userCSharp: Replacement Table

All `userCSharp:` extension function calls in BizTalk-compiled XSLT must be replaced before
uploading to Logic Apps Integration Account. Preserve the surrounding `xsl:variable` pattern
where needed, but replace the extension call with the native XPath equivalent.

| userCSharp: Function | Logic Apps XSLT Replacement |
|---|---|
| `userCSharp:LogicalEq(a, b)` | XPath: `a = b` |
| `userCSharp:LogicalNe(a, b)` | XPath: `a != b` |
| `userCSharp:LogicalGt(a, b)` | XPath: `a > b` |
| `userCSharp:LogicalGe(a, b)` | XPath: `a >= b` |
| `userCSharp:LogicalLt(a, b)` | XPath: `a < b` |
| `userCSharp:LogicalLe(a, b)` | XPath: `a <= b` |
| `userCSharp:LogicalIsString(string(x))` | XPath: `string-length(x) > 0` |
| `userCSharp:LogicalIsNumeric(x)` | XPath: `number(x) = number(x)` |
| `userCSharp:LogicalNot(b)` | XPath: `not(b)` |
| `userCSharp:LogicalAnd(a, b)` | XPath: `a and b` |
| `userCSharp:LogicalOr(a, b)` | XPath: `a or b` |
| `userCSharp:LogicalIsDate(x)` | Azure Function or Local Code Function — no XSLT 1.0 equivalent |
| `userCSharp:StringConcat(a, b)` | XPath: `concat(a, b)` |
| `userCSharp:StringLength(s)` | XPath: `string-length(s)` |
| `userCSharp:StringUpperCase(s)` | XSLT 1.0: `translate(s, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')` |
| `userCSharp:StringLowerCase(s)` | XSLT 1.0: `translate(s, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')` |
| `userCSharp:StringLeft(s, n)` | XPath: `substring(s, 1, n)` |
| `userCSharp:StringRight(s, n)` | XPath: `substring(s, string-length(s) - n + 1)` |
| `userCSharp:StringTrimLeft(s)` | XPath: `normalize-space(s)` (trims both ends, collapses internal spaces) |
| `userCSharp:EmptyOrNull(s)` | XPath: `string-length(s) > 0` |
| `userCSharp:MathAdd(a, b)` | XPath: `$a + $b` |
| `userCSharp:MathSubtract(a, b)` | XPath: `$a - $b` |
| `userCSharp:MathMultiply(a, b)` | XPath: `$a * $b` |
| `userCSharp:MathDivide(a, b)` | XPath: `$a div $b` |
| `userCSharp:MathModulo(a, b)` | XPath: `$a mod $b` |
| `userCSharp:MathRound(a)` | XPath: `round($a)` |
| `userCSharp:MathFloor(a)` | XPath: `floor($a)` |
| `userCSharp:MathCeil(a)` | XPath: `ceiling($a)` |
| `userCSharp:MathAbs(a)` | No XSLT 1.0 equivalent — Azure Function |
| `userCSharp:DateCurrentDate()` | Azure Function or Local Code Function |
| Any other `userCSharp:*` | Azure Function or Local Code Function |

---

## 10. Known Gaps Summary

| Gap | Severity | Notes |
|---|---|---|
| Inline C# Scripting Functoids (`userCSharp:*`) | HIGH | Azure Function or Local Code Function per unique C# function |
| External Assembly Scripting Functoids | HIGH | Azure Function wrapping original DLL |
| `msxsl:script` blocks with C# | HIGH | Same as Inline C# — Local Code Function preferred |
| `xsl:include` / `xsl:import` | HIGH | IA engine prohibits external URIs; merge into single file |
| Multi-part maps (multiple source schemas) | HIGH | Transform action takes single XML input; pre-merge required |
| Date validation (`LogicalIsDate`) | HIGH | No XSLT 1.0 equivalent — Azure Function |
| Regex in inline C# | HIGH | No XSLT 1.0 regex — Azure Function required |
| Complex LINQ in inline C# | HIGH | .NET 2.0 constraint — Azure Function |
| `GenerateDefaultFixedNodes=Yes` relied upon | MEDIUM | IA engine does not auto-apply schema defaults; must make explicit |
| Record Count Functoid (absolute path in nested loop) | MEDIUM | Silent wrong-count bug; rewrite to relative `count()` |
| XSD date validation in Logical Functoid | MEDIUM | `userCSharp:LogicalIsDate` — Azure Function |
| `PreserveSequenceOrder=No` when order matters | LOW | Two separate for-each blocks lose interleaved order |
| Table Looping grid row count is static | LOW | Design-time constant only; document but no workaround needed |
| Cumulative functoids (Sum, Min, Max, etc.) | LOW | Complex XSLT 1.0 patterns; preserve verbatim |
| `MathAbs` in Scripting Functoid | LOW | No XSLT 1.0 `abs()` — use Local Code Function |
| Map grid page organization | INFO | Pages are visual only; no functional impact after merge |
