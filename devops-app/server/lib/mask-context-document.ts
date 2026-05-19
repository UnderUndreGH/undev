/**
 * Feature 013: Regex-based secret masking and prompt-injection defense for free-text LLM context.
 */

// Patterns to mask in context documents (logs, audit details, etc.)
const SECRET_PATTERNS = [
  { name: "Anthropic API Key", regex: /sk-ant-[a-zA-Z0-9\-_]{93,}/g },
  { name: "OpenAI API Key", regex: /sk-(?:proj-|svcacct-)?[a-zA-Z0-9_-]{20,}/g },
  { name: "GitHub PAT", regex: /ghp_[a-zA-Z0-9]{36,}/g },
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "Private Key", regex: /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+ PRIVATE KEY-----/g },
  { name: "Password Assignment", regex: /password\s*=\s*[^\s;]{4,}/gi },
  { name: "GitLab PAT", regex: /glpat-[a-zA-Z0-9\-_]{20,}/g },
  { name: "Slack Token", regex: /xox[bps]-[a-zA-Z0-9\-_]{10,}/g },
  { name: "JWT", regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
];

export interface MaskResult {
  masked: string;
  redactions: Record<string, number>;
}

/**
 * Scrubs known secret patterns and sanitizes XML-like injection tags from unstructured text.
 * Wraps the source in delimiters that the system prompt treats as untrusted.
 */
export function maskContextDocument(
  content: string,
  sourceType: string,
  isTrusted: boolean = false,
): MaskResult {
  let masked = content;
  const redactions: Record<string, number> = {};

  // 1. Mask secrets
  for (const { name, regex } of SECRET_PATTERNS) {
    masked = masked.replace(regex, (match) => {
      redactions[name] = (redactions[name] || 0) + 1;
      return `***[REDACTED]***`;
    });
  }

  // 2. Sanitize prompt-injection delimiters
  // Strip any closing context-source tags that might be used to break out of the wrapper
  masked = masked.replace(/<\/context-source>/gi, "[EXFILTRATION_ATTEMPT_STRIPPED]");
  masked = masked.replace(/<context-source/gi, "[INJECTION_ATTEMPT_STRIPPED]");

  // 3. Wrap in delimiters
  const wrapped = `<context-source type="${sourceType}" trusted="${isTrusted}">\n${masked}\n</context-source>`;
  return { masked: wrapped, redactions };
}

/**
 * Validates if the document contains high-confidence secret patterns that should BLOCK the send.
 */
export function containsHighConfidenceSecrets(content: string): boolean {
  // For now, any match is a warning, but we could split SECRET_PATTERNS into tiers.
  // Principle: blocking thresholds are for patterns with ~0 false positives.
  const blockingRegex = /sk-(?:proj-|svcacct-)?|ghp_|AKIA[0-9A-Z]{16}|-----BEGIN/g;
  return blockingRegex.test(content);
}
