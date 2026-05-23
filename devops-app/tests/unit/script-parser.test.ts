import { describe, it, expect } from "vitest";
import { parseAnnotations } from "../../server/services/script-parser.js";

describe("parseAnnotations", () => {
  // 1. Empty content
  it("returns null description and empty params for empty content", () => {
    const result = parseAnnotations("");
    expect(result.description).toBeNull();
    expect(result.params).toEqual([]);
  });

  // 2. Only @description
  it("captures a single @description line", () => {
    const result = parseAnnotations("# @description Reboot the server\n");
    expect(result.description).toBe("Reboot the server");
    expect(result.params).toEqual([]);
  });

  // 3. Basic string param
  it("parses @param name:string:Description", () => {
    const result = parseAnnotations("# @param hostname:string:Target hostname\n");
    expect(result.description).toBeNull();
    expect(result.params).toHaveLength(1);
    expect(result.params[0]).toEqual({
      name: "hostname",
      type: "string",
      description: "Target hostname",
    });
  });

  // 4. Number param
  it("parses @param count:number:Count", () => {
    const result = parseAnnotations("# @param count:number:Instance count\n");
    expect(result.params).toHaveLength(1);
    expect(result.params[0]).toEqual({
      name: "count",
      type: "number",
      description: "Instance count",
    });
  });

  // 5. Boolean param
  it("parses @param verbose:boolean:Verbose", () => {
    const result = parseAnnotations("# @param verbose:boolean:Enable verbose output\n");
    expect(result.params).toHaveLength(1);
    expect(result.params[0]).toEqual({
      name: "verbose",
      type: "boolean",
      description: "Enable verbose output",
    });
  });

  // 6. Select param with options and default
  it("parses @param mode:select(fast,slow):(fast):Speed mode", () => {
    const result = parseAnnotations(
      "# @param mode:select(fast,slow):(fast):Speed mode\n",
    );
    expect(result.params).toHaveLength(1);
    expect(result.params[0]).toEqual({
      name: "mode",
      type: "select",
      options: ["fast", "slow"],
      defaultValue: "fast",
      description: "Speed mode",
    });
  });

  // 7. Description with colons
  it("handles colons in the description text correctly", () => {
    const result = parseAnnotations(
      "# @param path:string:The file path: use absolute paths\n",
    );
    expect(result.params).toHaveLength(1);
    // The regex captures everything after the second colon as description,
    // including additional colons.
    expect(result.params[0].name).toBe("path");
    expect(result.params[0].type).toBe("string");
    expect(result.params[0].description).toContain("The file path: use absolute paths");
  });

  // 8. Malformed @param (missing type) — should not match
  it("skips malformed @param without a type", () => {
    const result = parseAnnotations("# @param somename\n");
    expect(result.params).toEqual([]);
  });

  // 9. Multiple @description lines — only first captured
  it("captures only the first @description", () => {
    const content = [
      "# @description First description",
      "# @description Second description",
    ].join("\n");
    const result = parseAnnotations(content);
    expect(result.description).toBe("First description");
  });

  // 10. Multiple @param lines — all captured in order
  it("captures all @param annotations in order", () => {
    const content = [
      "# @description Multi-param script",
      "# @param host:string:Hostname",
      "# @param port:number:Port number",
      "# @param verbose:boolean:Verbose",
    ].join("\n");
    const result = parseAnnotations(content);
    expect(result.description).toBe("Multi-param script");
    expect(result.params).toHaveLength(3);
    expect(result.params[0].name).toBe("host");
    expect(result.params[1].name).toBe("port");
    expect(result.params[2].name).toBe("verbose");
    expect(result.params[1].type).toBe("number");
  });
});
