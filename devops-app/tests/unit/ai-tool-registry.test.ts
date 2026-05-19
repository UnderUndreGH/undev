import { describe, it, expect } from "vitest";
import { manifestToAiTools } from "../../server/lib/ai-tool-registry.js";

describe("ai-tool-registry", () => {
  it("converts manifest entries to AI tools", () => {
    const tools = manifestToAiTools();
    
    // Check specific mapped names (deploy/logs -> deploy_logs)
    expect(tools.deploy_logs).toBeDefined();
    expect(tools.db_backup).toBeDefined();
    
    // Check description inclusion of dangerLevel and reversible
    const deployLogs = tools.deploy_logs as any;
    expect(deployLogs.description).toContain("Danger: low");
    expect(deployLogs.description).toContain("Reversible: true");
    
    const dbRestore = tools.db_restore as any;
    expect(dbRestore.description).toContain("Danger: high");
    expect(dbRestore.description).toContain("Reversible: false");
  });

  it("has no execute function (intercepted at app layer)", () => {
    const tools = manifestToAiTools();
    const deployLogs = tools.deploy_logs as any;
    expect(deployLogs.execute).toBeUndefined();
  });
});
