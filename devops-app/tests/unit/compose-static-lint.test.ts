import { describe, it, expect } from "vitest";
import { lintCompose } from "../../server/lib/compose-static-lint.js";

describe("compose-static-lint", () => {
  it("warns about latest tag", () => {
    const yaml = `
services:
  web:
    image: nginx:latest
  api:
    image: node
    `;
    const findings = lintCompose(yaml);
    expect(findings.some(f => f.rule === "latest-tag" && f.service === "web")).toBe(true);
    expect(findings.some(f => f.rule === "latest-tag" && f.service === "api")).toBe(true);
  });

  it("warns about reserved ports", () => {
    const yaml = `
services:
  web:
    image: nginx:1.25
    ports:
      - "80:80"
  api:
    image: node:20
    ports:
      - "3000:3000"
    `;
    const findings = lintCompose(yaml);
    expect(findings.some(f => f.rule === "reserved-ports" && f.service === "web")).toBe(true);
    expect(findings.some(f => f.rule === "reserved-ports" && f.service === "api")).toBe(false);
  });

  it("warns about missing healthcheck", () => {
    const yaml = `
services:
  web:
    image: nginx:1.25
    `;
    const findings = lintCompose(yaml);
    expect(findings.some(f => f.rule === "missing-healthcheck")).toBe(true);
  });

  it("errors on plaintext secrets", () => {
    const yaml = `
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: mysecretpassword
      DB_TOKEN: "abc123token"
      APP_URL: "https://example.com"
    `;
    const findings = lintCompose(yaml);
    expect(findings.some(f => f.rule === "plaintext-secrets" && f.message.includes("POSTGRES_PASSWORD"))).toBe(true);
    expect(findings.some(f => f.rule === "plaintext-secrets" && f.message.includes("DB_TOKEN"))).toBe(true);
    expect(findings.some(f => f.rule === "plaintext-secrets" && f.message.includes("APP_URL"))).toBe(false);
  });

  it("errors on privileged mode", () => {
    const yaml = `
services:
  worker:
    image: busybox
    privileged: true
    `;
    const findings = lintCompose(yaml);
    expect(findings.some(f => f.rule === "privileged")).toBe(true);
  });

  it("errors on dangerous mounts", () => {
    const yaml = `
services:
  web:
    image: nginx
    volumes:
      - /etc/shadow:/etc/shadow:ro
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/app/data
    `;
    const findings = lintCompose(yaml);
    expect(findings.some(f => f.rule === "dangerous-mounts" && f.message.includes("/etc/shadow"))).toBe(true);
    expect(findings.some(f => f.rule === "dangerous-mounts" && f.message.includes("/var/run/docker.sock"))).toBe(true);
    expect(findings.some(f => f.rule === "dangerous-mounts" && f.message.includes("./data"))).toBe(false);
  });

  it("warns about missing depends_on for DB links", () => {
    const yaml = `
services:
  db:
    image: postgres
  api:
    image: node
    environment:
      DATABASE_URL: postgres://db:5432/mydb
    `;
    const findings = lintCompose(yaml);
    expect(findings.some(f => f.rule === "missing-depends-on" && f.service === "api")).toBe(true);
  });

  it("handles malformed YAML", () => {
    const yaml = `
services:
  web:
    image: [unclosed list
    `;
    const findings = lintCompose(yaml);
    expect(findings.some(f => f.rule === "yaml-parse")).toBe(true);
  });
});
