/**
 * Feature 013: Regex-based secret masking and prompt-injection defense for free-text LLM context.
 */

// Patterns to mask in context documents (logs, audit details, etc.)
const SECRET_PATTERNS = [
  { name: "Anthropic API Key", regex: /sk-ant-api03-[a-zA-Z0-9\-_]{93,}/g },
  { name: "OpenAI API Key", regex: /sk-[a-zA-Z0-9]{48,}/g },
  { name: "GitHub PAT", regex: /ghp_[a-zA-Z0-9]{36,}/g },
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "Private Key", regex: /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+ PRIVATE KEY-----/g },
  { name: "Password Assignment", regex: /password\s*=\s*[^\s;]{4,}/gi },
  { name: "GitLab PAT", regex: /glpat-[a-zA-Z0-9\-_]{20,}/g },
  { name: "Slack Token", regex: /xox[bps]-[a-zA-Z0-9\-_]{10,}/g },
  { name: "JWT", regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
];

/**
 * Scrubs known secret patterns and sanitizes XML-like injection tags from unstructured text.
 * Wraps the source in delimiters that the system prompt treats as untrusted.
 */
export function maskContextDocument(
  content: string,
  sourceType: string,
  isTrusted: boolean = false,
): string {
  let masked = content;

  // 1. Mask secrets
  for (const { regex } of SECRET_PATTERNS) {
    masked = masked.replace(regex, (match) => {
      // Keep a small hint for context if useful, but here we go full mask
      return `***[REDACTED]***`;
    });
  }

  // 2. Sanitize prompt-injection delimiters
  // Strip any closing context-source tags that might be used to break out of the wrapper
  masked = masked.replace(/<\/context-source>/gi, "[EXFILTRATION_ATTEMPT_STRIPPED]");
  masked = masked.replace(/<context-source/gi, "[INJECTION_ATTEMPT_STRIPPED]");

  // 3. Wrap in delimiters
  return `<context-source type="${sourceType}" trusted="${isTrusted}">\n${masked}\n</context-source>`;
}

/**
 * Validates if the document contains high-confidence secret patterns that should BLOCK the send.
 */
export function containsHighConfidenceSecrets(content: string): boolean {
  // For now, any match is a warning, but we could split SECRET_PATTERNS into tiers.
  // Principle: blocking thresholds are for patterns with ~0 false positives.
  const blockingRegex = /sk-ant-api03-|ghp_|AKIA[0-9A-Z]{16}|-----BEGIN/g;
  return blockingRegex.test(content);
}
