# SpecKit Review: 020-ai-custom-provider

**Reviewer**: antigravity
**Reviewed at**: 2026-05-24T08:17:15Z
**Commit**: HEAD
**Artifacts reviewed**: spec.md, plan.md, tasks.md, data-model.md

## Summary

The design for custom AI providers is solid and addresses a clear user need. However, it introduces a severe Server-Side Request Forgery (SSRF) vector and misses key technical requirements for Azure OpenAI integration and empty API key support.

## Findings

| ID | Severity | Area | Finding | Recommendation |
|---|---|---|---|---|
| F1 | CRITICAL | Security | SSRF Vulnerability: Allowing users to input any URL into `endpointUrl` allows them to probe internal network resources (e.g., `http://169.254.169.254` or `http://localhost:6379`) from the server context via the "Test Connectivity" and Chat endpoints. | Implement strict URL validation. Block private IP ranges, localhost, and loopback addresses unless an explicit `ALLOW_LOCAL_AI_ENDPOINTS=true` env var is set by the admin. |
| F2 | HIGH | Logical Consistency | `FR-002` requires allowing empty API keys for local endpoints. However, the `api_key_encrypted` column might currently be `NOT NULL`. The DB migration (T001) doesn't drop the `NOT NULL` constraint, and the Zod schema update (T002) doesn't explicitly mention making the key optional. | Verify if `api_key_encrypted` is nullable. If not, add `ALTER TABLE ai_provider_keys ALTER COLUMN api_key_encrypted DROP NOT NULL;` to the migration, and update Zod. |
| F3 | HIGH | Edge case / Integration | The plan assumes Azure OpenAI works with the standard `@ai-sdk/openai` provider just by changing the URL. Azure uses an `api-key` header, while OpenAI uses `Authorization: Bearer <key>`. Standard `createOpenAI` will fail against Azure endpoints. | Detect Azure URLs and use the `@ai-sdk/azure` package (`createAzure`), or explicitly document that Azure is not supported via the generic "openai-compatible" type. |
| F4 | MEDIUM | Edge case | The test connectivity endpoint (T006) sends `max_tokens=1`. Some proxy services or strict models (e.g., o1 models) do not support `max_tokens` or fail on empty prompts. | Send a standard small prompt (e.g., "ping") and use `max_completion_tokens` or a provider-specific test payload to ensure compatibility. |

## Alternative approaches considered

Instead of a generic `openai-compatible` type trying to handle Azure, add a dedicated `azure-openai` provider type, since its auth and URL structures are distinct enough to cause friction if merged with standard OpenAI-compatible proxies.

## VERDICT

```yaml
verdict: CRITICAL
reviewer: antigravity
reviewed_at: 2026-05-24T08:17:15Z
commit: HEAD
critical_count: 1
high_count: 2
medium_count: 1
low_count: 0
```
