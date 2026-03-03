/**
 * Unit tests for C# → WDL Expression Translator
 * Tests translateCSharpToWdl, isComplexCSharpCall, and extractMethodCallInfo.
 */

import {
  translateCSharpToWdl,
  isComplexCSharpCall,
  extractMethodCallInfo,
} from '../../src/stage3-build/csharp-translator.js';

// ─── translateCSharpToWdl ─────────────────────────────────────────────────────

describe('translateCSharpToWdl — literals', () => {
  it('translates a string literal assignment', () => {
    expect(translateCSharpToWdl('x = "hello"')).toBe('hello');
  });

  it('translates empty string', () => {
    expect(translateCSharpToWdl('x = ""')).toBe('');
  });

  it('translates string.Empty', () => {
    expect(translateCSharpToWdl('x = string.Empty')).toBe('');
  });

  it('translates String.Empty', () => {
    expect(translateCSharpToWdl('x = String.Empty')).toBe('');
  });

  it('translates numeric literal', () => {
    expect(translateCSharpToWdl('x = 42')).toBe('42');
  });

  it('translates decimal literal', () => {
    expect(translateCSharpToWdl('x = 3.14')).toBe('3.14');
  });

  it('translates boolean true', () => {
    expect(translateCSharpToWdl('x = true')).toBe('true');
  });

  it('translates boolean false', () => {
    expect(translateCSharpToWdl('x = false')).toBe('false');
  });

  it('translates null to empty string', () => {
    expect(translateCSharpToWdl('x = null')).toBe('');
  });

  it('strips trailing semicolon', () => {
    expect(translateCSharpToWdl('x = "hello";')).toBe('hello');
  });
});

describe('translateCSharpToWdl — bare identifier (variable reference)', () => {
  it('translates bare identifier to variables() reference', () => {
    expect(translateCSharpToWdl('x = otherVar')).toBe("@{variables('otherVar')}");
  });

  it('translates bare identifier without assignment', () => {
    expect(translateCSharpToWdl('someVar')).toBe("@{variables('someVar')}");
  });
});

describe('translateCSharpToWdl — string instance methods', () => {
  it('translates str.ToUpper()', () => {
    expect(translateCSharpToWdl('x = str.ToUpper()')).toBe("@{toUpper(variables('str'))}");
  });

  it('translates str.ToLower()', () => {
    expect(translateCSharpToWdl('x = str.ToLower()')).toBe("@{toLower(variables('str'))}");
  });

  it('translates str.Trim()', () => {
    expect(translateCSharpToWdl('x = str.Trim()')).toBe("@{trim(variables('str'))}");
  });

  it('translates str.Length', () => {
    expect(translateCSharpToWdl('x = str.Length')).toBe("@{length(variables('str'))}");
  });

  it('translates str.Contains(v)', () => {
    expect(translateCSharpToWdl('x = str.Contains(needle)')).toBe(
      "@{contains(variables('str'), variables('needle'))}"
    );
  });

  it('translates str.Contains("literal")', () => {
    expect(translateCSharpToWdl('x = str.Contains("hello")')).toBe(
      '@{contains(variables(\'str\'), "hello")}'
    );
  });

  it('translates str.StartsWith(prefix)', () => {
    expect(translateCSharpToWdl('x = str.StartsWith("pre")')).toBe(
      '@{startsWith(variables(\'str\'), "pre")}'
    );
  });

  it('translates str.EndsWith(suffix)', () => {
    expect(translateCSharpToWdl('x = str.EndsWith("end")')).toBe(
      '@{endsWith(variables(\'str\'), "end")}'
    );
  });

  it('translates str.Replace(old, new)', () => {
    expect(translateCSharpToWdl('x = str.Replace("a", "b")')).toBe(
      '@{replace(variables(\'str\'), "a", "b")}'
    );
  });

  it('translates str.Substring(start, len)', () => {
    expect(translateCSharpToWdl('x = str.Substring(0, 5)')).toBe(
      "@{substring(variables('str'), 0, 5)}"
    );
  });

  it('translates str.Substring(start) without length', () => {
    expect(translateCSharpToWdl('x = str.Substring(2)')).toBe(
      "@{substring(variables('str'), 2)}"
    );
  });
});

describe('translateCSharpToWdl — static string methods', () => {
  it('translates string.Concat(a, b)', () => {
    expect(translateCSharpToWdl('x = string.Concat(first, last)')).toBe(
      "@{concat(variables('first'), variables('last'))}"
    );
  });

  it('translates String.Concat with literals', () => {
    expect(translateCSharpToWdl('x = String.Concat("hello", " ", "world")')).toBe(
      '@{concat("hello", " ", "world")}'
    );
  });

  it('translates string.IsNullOrEmpty(s)', () => {
    expect(translateCSharpToWdl('x = string.IsNullOrEmpty(val)')).toBe(
      "@{empty(variables('val'))}"
    );
  });
});

describe('translateCSharpToWdl — DateTime', () => {
  it('translates DateTime.Now', () => {
    expect(translateCSharpToWdl('x = DateTime.Now')).toBe('@{utcNow()}');
  });

  it('translates DateTime.Now.ToString("fmt")', () => {
    expect(translateCSharpToWdl('x = DateTime.Now.ToString("yyyy-MM-dd")')).toBe(
      "@{utcNow('yyyy-MM-dd')}"
    );
  });

  it('translates DateTime.Now.AddDays(n)', () => {
    expect(translateCSharpToWdl('x = DateTime.Now.AddDays(7)')).toBe(
      '@{addDays(utcNow(), 7)}'
    );
  });
});

describe('translateCSharpToWdl — type conversions', () => {
  it('translates int.Parse(s)', () => {
    expect(translateCSharpToWdl('x = int.Parse(val)')).toBe(
      "@{int(variables('val'))}"
    );
  });

  it('translates Int32.Parse(s)', () => {
    expect(translateCSharpToWdl('x = Int32.Parse(val)')).toBe(
      "@{int(variables('val'))}"
    );
  });

  it('translates double.Parse(s)', () => {
    expect(translateCSharpToWdl('x = double.Parse(val)')).toBe(
      "@{float(variables('val'))}"
    );
  });

  it('translates Convert.ToBoolean(s)', () => {
    expect(translateCSharpToWdl('x = Convert.ToBoolean(val)')).toBe(
      "@{bool(variables('val'))}"
    );
  });

  it('translates System.Convert.ToString(s)', () => {
    expect(translateCSharpToWdl('x = System.Convert.ToString(val)')).toBe(
      "@{string(variables('val'))}"
    );
  });
});

describe('translateCSharpToWdl — untranslatable expressions', () => {
  it('returns null for complex helper class calls', () => {
    expect(translateCSharpToWdl('x = MCH.SZ.checkIfPrimaryCRMMCH(msg)')).toBeNull();
  });

  it('returns null for multi-statement blocks', () => {
    expect(translateCSharpToWdl('x = 1; y = 2;')).toBeNull();
  });

  it('returns null for multi-line expressions', () => {
    expect(translateCSharpToWdl('x = "a"\ny = "b"')).toBeNull();
  });

  it('returns null for Regex.Match()', () => {
    expect(translateCSharpToWdl('x = Regex.Match(str, pattern)')).toBeNull();
  });
});

// ─── isComplexCSharpCall ─────────────────────────────────────────────────────

describe('isComplexCSharpCall', () => {
  it('returns true for custom helper class call', () => {
    expect(isComplexCSharpCall('MCH.SZ.checkIfPrimaryCRMMCH(msg)')).toBe(true);
  });

  it('returns true for two-part helper call', () => {
    expect(isComplexCSharpCall('x = Helper.Process(msg)')).toBe(true);
  });

  it('returns true for multi-line expression', () => {
    expect(isComplexCSharpCall('x = 1;\ny = 2;')).toBe(true);
  });

  it('returns false for standard string method str.ToUpper()', () => {
    // lowercase 'str' does not start with uppercase — not a class
    expect(isComplexCSharpCall('str.ToUpper()')).toBe(false);
  });

  it('returns false for BCL static string.IsNullOrEmpty()', () => {
    expect(isComplexCSharpCall('string.IsNullOrEmpty(val)')).toBe(false);
  });

  it('returns false for BCL DateTime.Now', () => {
    expect(isComplexCSharpCall('x = DateTime.Now')).toBe(false);
  });

  it('returns false for BCL Convert.ToBoolean()', () => {
    expect(isComplexCSharpCall('x = Convert.ToBoolean(val)')).toBe(false);
  });

  it('returns false for plain string literal', () => {
    expect(isComplexCSharpCall('"hello"')).toBe(false);
  });

  it('returns false for bare identifier', () => {
    expect(isComplexCSharpCall('myVar')).toBe(false);
  });
});

// ─── extractMethodCallInfo ────────────────────────────────────────────────────

describe('extractMethodCallInfo', () => {
  it('extracts class, method, and args from helper call', () => {
    const info = extractMethodCallInfo('x = MCH.SZ.checkIfPrimary(msg)');
    expect(info).not.toBeNull();
    expect(info!.className).toBe('SZ');
    expect(info!.methodName).toBe('checkIfPrimary');
    expect(info!.args).toEqual(['msg']);
  });

  it('extracts from two-part call Helper.Process(a, b)', () => {
    const info = extractMethodCallInfo('result = Helper.Process(a, b)');
    expect(info).not.toBeNull();
    expect(info!.className).toBe('Helper');
    expect(info!.methodName).toBe('Process');
    expect(info!.args).toEqual(['a', 'b']);
  });

  it('extracts from no-arg call', () => {
    const info = extractMethodCallInfo('x = Utility.GetValue()');
    expect(info).not.toBeNull();
    expect(info!.className).toBe('Utility');
    expect(info!.methodName).toBe('GetValue');
    expect(info!.args).toEqual([]);
  });

  it('returns null for plain assignment without method call', () => {
    expect(extractMethodCallInfo('x = "hello"')).toBeNull();
  });

  it('returns null for bare variable', () => {
    expect(extractMethodCallInfo('myVar')).toBeNull();
  });

  it('handles method calls with semicolon', () => {
    const info = extractMethodCallInfo('x = Helper.Process(msg);');
    expect(info).not.toBeNull();
    expect(info!.methodName).toBe('Process');
  });
});
