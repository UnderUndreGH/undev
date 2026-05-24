import { logger } from "../lib/logger.js";
import type { ScannerViolation } from "../lib/script-types.js";

const REGEX_DENYLIST: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /rm\s+-rf\s+\/\s*/g, description: "Recursive force delete of root filesystem" },
  { pattern: /rm\s+-rf\s+\/\*/g, description: "Recursive force delete of root filesystem (glob)" },
  { pattern: /rm\s+-rf\s+~/g, description: "Recursive force delete of home directory" },
  { pattern: /curl\s+.*\|\s*(ba)?sh/g, description: "Remote code execution via curl pipe" },
  { pattern: /wget\s+.*\|\s*(ba)?sh/g, description: "Remote code execution via wget pipe" },
  { pattern: /eval\s+["'$]/g, description: "eval with variable argument" },
  { pattern: /exec\s+["'$]/g, description: "exec with variable argument" },
  { pattern: /:\(\)\{\s*:\|:&\s*\};\s*:/g, description: "Fork bomb" },
  { pattern: /echo\s+[A-Za-z0-9+/=]+\s*\|\s*(ba)?sh/g, description: "Base64 decode execution" },
  { pattern: /base64\s+.*\|\s*(ba)?sh/g, description: "Base64 decode pipe to shell" },
  { pattern: /curl\s+.*-d\s/g, description: "Network exfiltration via curl data payload" },
  { pattern: /wget\s+.*--post-data/g, description: "Network exfiltration via wget POST" },
  { pattern: /nc\s+.*-e/g, description: "Network exfiltration via netcat exec" },
];

const INDIRECTION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\$\{[a-zA-Z_]\w*\}\s/g, description: "Variable expansion in command position" },
  { pattern: /printf\s+.*\$\(/g, description: "printf constructing commands" },
  { pattern: /declare\s+-[fF]/g, description: "declare with function names" },
  { pattern: /typeset\s+-[fF]/g, description: "typeset with function names" },
];

function unescape(content: string): string {
  let result = content;

  result = result.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );

  result = result.replace(/\$'((?:[^'\\]|\\[^])*)'/g, (_match, inner: string) => {
    return inner.replace(
      /\\x([0-9a-fA-F]{2})|\\([0-7]{1,3})|\\u([0-9a-fA-F]{4})/g,
      (_m: string, hex: string | undefined, oct: string | undefined, uni: string | undefined) => {
        if (hex) return String.fromCharCode(parseInt(hex, 16));
        if (oct) return String.fromCharCode(parseInt(oct, 8));
        if (uni) return String.fromCharCode(parseInt(uni, 16));
        return _m;
      },
    );
  });

  return result;
}

export interface ScanResult {
  violations: ScannerViolation[];
  normalizedContent: string;
}

export function scanScript(content: string): ScanResult {
  const violations: ScannerViolation[] = [];
  const normalized = unescape(content);
  const lines = normalized.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    for (const { pattern, description } of REGEX_DENYLIST) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        violations.push({
          pattern: pattern.source,
          line: lineNum,
          description,
          layer: "regex",
        });
      }
    }

    for (const { pattern, description } of INDIRECTION_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        violations.push({
          pattern: pattern.source,
          line: lineNum,
          description,
          layer: "indirection",
        });
      }
    }
  }

  const unescapedDiffers = normalized !== content;
  if (unescapedDiffers) {
    const unescapeLines = normalized.split("\n");
    for (let i = 0; i < unescapeLines.length; i++) {
      const line = unescapeLines[i]!;
      if (i < lines.length && line === lines[i]) continue;
      const lineNum = i + 1;

      for (const { pattern, description } of REGEX_DENYLIST) {
        pattern.lastIndex = 0;
        if (pattern.test(line)) {
          const already = violations.some(
            (v) => v.line === lineNum && v.pattern === pattern.source,
          );
          if (!already) {
            violations.push({
              pattern: pattern.source,
              line: lineNum,
              description: `unescape layer: ${description}`,
              layer: "unescape",
            });
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    logger.warn(
      { ctx: "script-scanner", violationCount: violations.length },
      "Script scanner detected advisory violations",
    );
  }

  return { violations, normalizedContent: normalized };
}
