/**
 * C# → WDL Expression Translator
 *
 * Translates simple C# XLANG/s expressions from BizTalk orchestrations into
 * Logic Apps Workflow Definition Language (WDL) @{...} expressions.
 *
 * Handles common patterns: string ops, DateTime, type conversions, literals.
 * Returns null for complex or multi-statement expressions — callers should
 * route those to InvokeFunction (Local Code Function) stubs instead.
 *
 * Exported API:
 *   translateCSharpToWdl(expr)      — translate C# to WDL or null
 *   isComplexCSharpCall(expr)       — true for custom helper class method calls
 *   extractMethodCallInfo(expr)     — parse class/method/args from a method call
 */

// ─── Known BCL class names (not custom helper classes) ─────────────────────
const KNOWN_BCL_CLASSES = new Set([
  'string', 'String', 'int', 'Int32', 'long', 'Int64', 'short', 'Int16',
  'double', 'Double', 'float', 'Single', 'decimal', 'Decimal',
  'bool', 'Boolean', 'byte', 'Byte', 'char', 'Char', 'object', 'Object',
  'Convert', 'System', 'Math', 'Array', 'List', 'Dictionary',
  'Encoding', 'Regex', 'StringBuilder', 'Guid', 'Enum', 'DateTime',
  'TimeSpan', 'Uri', 'Path', 'File', 'Directory', 'Console', 'Environment',
]);

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Translates a C# expression (possibly an assignment) to a WDL value string.
 *
 * For literals, returns the plain value (e.g., `"hello"`, `"42"`, `""`).
 * For expressions, returns a WDL @{...} string.
 * Returns null if the expression cannot be translated.
 *
 * @example
 *   translateCSharpToWdl('x = str.ToUpper()')   → '@{toUpper(variables(\'str\'))}'
 *   translateCSharpToWdl('x = "hello"')          → 'hello'
 *   translateCSharpToWdl('x = DateTime.Now')     → '@{utcNow()}'
 *   translateCSharpToWdl('MCH.SZ.Method()')      → null  (complex helper call)
 */
export function translateCSharpToWdl(expr: string): string | null {
  const stripped = expr.trim().replace(/;\s*$/, '').trim();

  // Multi-statement blocks (semicolons within the expression) → untranslatable
  if (stripped.includes(';')) return null;

  // Multi-line expressions → untranslatable
  if (/[\r\n]/.test(stripped)) return null;

  // Extract the RHS from an assignment (e.g., "myVar = rhs" or "Type myVar = rhs")
  const rhs = extractRhs(stripped) ?? stripped;

  return translateRhs(rhs.trim());
}

/**
 * Returns true if the expression is a custom helper class method call
 * that cannot be translated to WDL inline.
 *
 * Distinguishes helper calls (MCH.SZ.Method(), Helper.Process()) from
 * standard BCL calls (string.IsNullOrEmpty(), str.ToUpper()) that CAN be translated.
 *
 * @example
 *   isComplexCSharpCall('MCH.SZ.checkIfPrimary()')   → true
 *   isComplexCSharpCall('Helper.Process(msg)')        → true
 *   isComplexCSharpCall('str.ToUpper()')              → false
 *   isComplexCSharpCall('string.IsNullOrEmpty(s)')    → false
 */
export function isComplexCSharpCall(expr: string): boolean {
  const stripped = expr.trim().replace(/;\s*$/, '').trim();
  // Multi-line blocks are complex by definition
  if (stripped.includes(';') || /[\r\n]/.test(stripped)) return true;

  const rhs = (extractRhs(stripped) ?? stripped).trim();

  // Match: ClassPart.AnotherPart.methodName(  — at least one uppercase-starting segment
  // The receiver must start with uppercase (PascalCase class name convention)
  const match = /^([A-Z][a-zA-Z0-9_]*)(?:\.[A-Za-z_][a-zA-Z0-9_]*)*\.[a-zA-Z_]\w*\(/.exec(rhs);
  if (!match) return false;

  // If the root class is a well-known BCL class, it's not a custom helper
  const rootClass = match[1]!;
  if (KNOWN_BCL_CLASSES.has(rootClass)) return false;

  return true;
}

/**
 * Extracts class name, method name, and argument strings from a method call expression.
 * Works on both raw calls and assignment RHS.
 *
 * @example
 *   extractMethodCallInfo('MCH.SZ.checkIfPrimary(msg)')
 *     → { className: 'SZ', methodName: 'checkIfPrimary', args: ['msg'] }
 *
 *   extractMethodCallInfo('x = Helper.Process(a, b)')
 *     → { className: 'Helper', methodName: 'Process', args: ['a', 'b'] }
 */
export function extractMethodCallInfo(
  expr: string
): { className: string; methodName: string; args: string[] } | null {
  const stripped = expr.trim().replace(/;\s*$/, '').trim();
  const rhs = (extractRhs(stripped) ?? stripped).trim();

  // Match: A.B.C.method(args)  where there is at least one dot before the method call
  const match = /^((?:[A-Za-z_][a-zA-Z0-9_]*\.)*[A-Za-z_][a-zA-Z0-9_]*)\.([a-zA-Z_]\w*)\(([^)]*)\)/.exec(rhs);
  if (!match) return null;

  const classPath = match[1]!;
  const methodName = match[2]!;
  const argsStr = (match[3] ?? '').trim();

  // className is the last segment of the class path
  const className = classPath.split('.').pop() ?? classPath;

  // Split args on top-level commas (respecting parens)
  const args = argsStr ? (parseArgList(argsStr) ?? []) : [];

  return { className, methodName, args };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Extracts the RHS from a C# assignment.
 * Handles: `varName = rhs`, `Type varName = rhs`, `var varName = rhs`
 * Returns null if no assignment found.
 */
function extractRhs(expr: string): string | null {
  // Find an `=` that is NOT preceded by <, >, !, = and NOT followed by =
  const match = /^(?:[\w.<>[\]]+\s+)?[a-zA-Z_]\w*\s*=(?!=)(.+)$/.exec(expr);
  if (match) return match[1]?.trim() ?? null;
  return null;
}

/**
 * Translates an RHS expression (after assignment stripping) to WDL.
 */
function translateRhs(t: string): string | null {
  // String literal: "hello" → 'hello'
  if (/^"[^"]*"$/.test(t)) {
    return t.slice(1, -1);
  }

  // Single-quoted string literal: 'hello' → 'hello'
  if (/^'[^']*'$/.test(t)) {
    return t.slice(1, -1);
  }

  // Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(t)) return t;

  // Boolean literals
  if (t === 'true') return 'true';
  if (t === 'false') return 'false';

  // Null / empty
  if (t === 'null') return '';
  if (t === 'string.Empty' || t === 'String.Empty') return '';

  // DateTime.Now
  if (t === 'DateTime.Now') return '@{utcNow()}';

  // DateTime.Now.ToString("fmt")
  const dtToString = /^DateTime\.Now\.ToString\("([^"]*)"\)$/.exec(t);
  if (dtToString) return `@{utcNow('${dtToString[1]}')}`;

  // DateTime.Now.AddDays(n)
  const dtAddDays = /^DateTime\.Now\.AddDays\((-?\d+(?:\.\d+)?)\)$/.exec(t);
  if (dtAddDays) return `@{addDays(utcNow(), ${dtAddDays[1]})}`;

  // DateTime.Now.AddHours(n)
  const dtAddHours = /^DateTime\.Now\.AddHours\((-?\d+(?:\.\d+)?)\)$/.exec(t);
  if (dtAddHours) return `@{addHours(utcNow(), ${dtAddHours[1]})}`;

  // int.Parse(s) / Int32.Parse(s)
  const intParse = /^(?:int|Int32)\.Parse\((.+)\)$/.exec(t);
  if (intParse) {
    const arg = resolveArg(intParse[1]!.trim());
    if (arg === null) return null;
    return `@{int(${arg})}`;
  }

  // double.Parse(s) / float.Parse(s) / decimal.Parse(s)
  const doubleParse = /^(?:double|float|decimal|Double|Float|Decimal|Single)\.Parse\((.+)\)$/.exec(t);
  if (doubleParse) {
    const arg = resolveArg(doubleParse[1]!.trim());
    if (arg === null) return null;
    return `@{float(${arg})}`;
  }

  // Convert.ToBoolean(s) / System.Convert.ToBoolean(s)
  const toBool = /^(?:System\.)?Convert\.ToBoolean\((.+)\)$/.exec(t);
  if (toBool) {
    const arg = resolveArg(toBool[1]!.trim());
    if (arg === null) return null;
    return `@{bool(${arg})}`;
  }

  // Convert.ToString(s) / System.Convert.ToString(s)
  const toStr = /^(?:System\.)?Convert\.ToString\((.+)\)$/.exec(t);
  if (toStr) {
    const arg = resolveArg(toStr[1]!.trim());
    if (arg === null) return null;
    return `@{string(${arg})}`;
  }

  // string.Concat(a, b, ...) / String.Concat(a, b, ...)
  const strConcat = /^(?:string|String)\.Concat\((.+)\)$/.exec(t);
  if (strConcat) {
    const args = parseArgList(strConcat[1]!);
    if (!args) return null;
    const wdlArgs = args.map(a => resolveArg(a.trim()));
    if (wdlArgs.some(a => a === null)) return null;
    return `@{concat(${(wdlArgs as string[]).join(', ')})}`;
  }

  // string.IsNullOrEmpty(s) / String.IsNullOrEmpty(s)
  const isNullOrEmpty = /^(?:string|String)\.IsNullOrEmpty\((.+)\)$/.exec(t);
  if (isNullOrEmpty) {
    const arg = resolveArg(isNullOrEmpty[1]!.trim());
    if (arg === null) return null;
    return `@{empty(${arg})}`;
  }

  // string.Format("{0} {1}", a, b) — basic placeholder substitution
  const strFormat = /^(?:string|String)\.Format\("([^"]*)"(?:,(.+))?\)$/.exec(t);
  if (strFormat) {
    const template = strFormat[1] ?? '';
    const argsStr = strFormat[2] ?? '';
    if (!argsStr && !/{[0-9]+}/.test(template)) {
      return template;
    }
    // Return null for format strings — too complex for reliable translation
    return null;
  }

  // Instance property: str.Length
  const lengthProp = /^([a-zA-Z_]\w*)\.Length$/.exec(t);
  if (lengthProp) {
    return `@{length(variables('${lengthProp[1]}'))}`;
  }

  // Instance no-arg methods: str.ToUpper(), str.ToLower(), str.Trim()
  const noArgMethod = /^([a-zA-Z_]\w*)\.(ToUpper|ToLower|Trim)\(\)$/.exec(t);
  if (noArgMethod) {
    const varName = noArgMethod[1]!;
    const method = noArgMethod[2]!;
    const wdlFn =
      method === 'ToUpper' ? 'toUpper' :
      method === 'ToLower' ? 'toLower' :
      'trim';
    return `@{${wdlFn}(variables('${varName}'))}`;
  }

  // Instance methods with args: str.Contains(v), str.StartsWith(p), str.EndsWith(s)
  const boolMethod = /^([a-zA-Z_]\w*)\.(Contains|StartsWith|EndsWith)\((.+)\)$/.exec(t);
  if (boolMethod) {
    const varName = boolMethod[1]!;
    const method = boolMethod[2]!;
    const arg = resolveArg(boolMethod[3]!.trim());
    if (arg === null) return null;
    const wdlFn =
      method === 'Contains' ? 'contains' :
      method === 'StartsWith' ? 'startsWith' :
      'endsWith';
    return `@{${wdlFn}(variables('${varName}'), ${arg})}`;
  }

  // str.Replace(old, new)
  const replaceMethod = /^([a-zA-Z_]\w*)\.Replace\((.+)\)$/.exec(t);
  if (replaceMethod) {
    const varName = replaceMethod[1]!;
    const args = parseArgList(replaceMethod[2]!);
    if (!args || args.length !== 2) return null;
    const a1 = resolveArg(args[0]!.trim());
    const a2 = resolveArg(args[1]!.trim());
    if (a1 === null || a2 === null) return null;
    return `@{replace(variables('${varName}'), ${a1}, ${a2})}`;
  }

  // str.Substring(start) / str.Substring(start, len)
  const substringMethod = /^([a-zA-Z_]\w*)\.Substring\((.+)\)$/.exec(t);
  if (substringMethod) {
    const varName = substringMethod[1]!;
    const args = parseArgList(substringMethod[2]!);
    if (!args || args.length < 1 || args.length > 2) return null;
    const a1 = resolveArg(args[0]!.trim());
    if (a1 === null) return null;
    if (args.length === 2) {
      const a2 = resolveArg(args[1]!.trim());
      if (a2 === null) return null;
      return `@{substring(variables('${varName}'), ${a1}, ${a2})}`;
    }
    return `@{substring(variables('${varName}'), ${a1})}`;
  }

  // str.TrimStart() / str.TrimEnd()
  const trimSideMethod = /^([a-zA-Z_]\w*)\.(TrimStart|TrimEnd)\(\)$/.exec(t);
  if (trimSideMethod) {
    // No direct WDL equivalent — fall through to null
    return null;
  }

  // Bare identifier: variable reference
  if (/^[a-zA-Z_]\w*$/.test(t)) {
    return `@{variables('${t}')}`;
  }

  return null;
}

/**
 * Resolves a single argument token to its WDL representation.
 * Returns null if resolution is not possible.
 *
 * - String literal "x"  → '"x"'         (with quotes, for use inside @{...})
 * - Numeric literal 42   → '42'
 * - Boolean true/false   → 'true'/'false'
 * - Identifier myVar     → "variables('myVar')"
 */
function resolveArg(arg: string): string | null {
  // String literal
  if (/^"[^"]*"$/.test(arg)) return arg; // keep quotes for inside @{...}
  // Numeric
  if (/^-?\d+(\.\d+)?$/.test(arg)) return arg;
  // Boolean
  if (arg === 'true' || arg === 'false') return arg;
  // Null
  if (arg === 'null') return 'null';
  // Simple identifier
  if (/^[a-zA-Z_]\w*$/.test(arg)) return `variables('${arg}')`;
  // Cannot resolve safely
  return null;
}

/**
 * Splits a comma-separated argument string respecting nested parentheses and brackets.
 * Returns null if the string is empty.
 *
 * @example
 *   parseArgList('a, b, c')     → ['a', 'b', 'c']
 *   parseArgList('"a,b", c')    → ['"a,b"', 'c']
 */
function parseArgList(argsStr: string): string[] | null {
  const trimmed = argsStr.trim();
  if (!trimmed) return null;

  const args: string[] = [];
  let depth = 0;
  let current = '';
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]!;

    if (inString) {
      current += c;
      if (c === stringChar) inString = false;
      continue;
    }

    if (c === '"' || c === "'") {
      inString = true;
      stringChar = c;
      current += c;
      continue;
    }

    if (c === '(' || c === '[' || c === '{') { depth++; current += c; }
    else if (c === ')' || c === ']' || c === '}') { depth--; current += c; }
    else if (c === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }

  if (current.trim()) args.push(current.trim());
  return args.length > 0 ? args : null;
}
