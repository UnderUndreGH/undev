import { parse as parseYaml } from "yaml";

/**
 * Feature 013: Static linting for Docker Compose files.
 * Zero-LLM-cost security and best-practice checks.
 */

export interface LintFinding {
  rule: string;
  severity: "error" | "warning";
  message: string;
  service?: string;
}

/**
 * Executes 7 static analysis rules against Docker Compose YAML content.
 */
export function lintCompose(composeYaml: string): LintFinding[] {
  const findings: LintFinding[] = [];

  let doc: any;
  try {
    doc = parseYaml(composeYaml);
  } catch (err) {
    findings.push({
      rule: "yaml-parse",
      severity: "error",
      message: `Failed to parse YAML: ${err instanceof Error ? err.message : String(err)}`,
    });
    return findings;
  }

  const services = doc?.services;
  if (!services || typeof services !== "object") {
    return findings;
  }

  const serviceNames = Object.keys(services);

  for (const [name, service] of Object.entries(services)) {
    const s = service as any;

    // 1. latest-tag: WARN if :latest or no tag
    if (s.image) {
      const image = String(s.image);
      if (image.endsWith(":latest") || !image.includes(":")) {
        findings.push({
          rule: "latest-tag",
          severity: "warning",
          message: `Service "${name}" uses :latest image tag. Pin to a specific version for production stability.`,
          service: name,
        });
      }
    }

    // 2. reserved-ports: WARN if < 1024
    if (Array.isArray(s.ports)) {
      for (const port of s.ports) {
        const portStr = typeof port === "string" ? port : String(port.published || "");
        const hostPort = parseInt(portStr.split(":")[0] || "");
        if (!isNaN(hostPort) && hostPort < 1024) {
          findings.push({
            rule: "reserved-ports",
            severity: "warning",
            message: `Service "${name}" maps to reserved port ${hostPort}. Use ports > 1024 to avoid requiring root privileges.`,
            service: name,
          });
        }
      }
    }

    // 3. missing-healthcheck: WARN if no healthcheck
    if (!s.healthcheck) {
      findings.push({
        rule: "missing-healthcheck",
        severity: "warning",
        message: `Service "${name}" has no healthcheck. Adding one enables automated recovery and safe zero-downtime deploys.`,
        service: name,
      });
    }

    // 4. plaintext-secrets: ERROR if environment has secret-like keys/values
    if (s.environment) {
      const env = s.environment;
      const keys = Array.isArray(env) ? env.map(e => String(e).split('=')[0]) : Object.keys(env);
      const secretKeys = ["password", "secret", "token", "api_key", "key", "credential"];
      
      for (const key of keys) {
        if (key && secretKeys.some(sk => key.toLowerCase().includes(secretKeys.find(s => key.toLowerCase().includes(s)) || ""))) {
           // This is a bit simplified, but follows the spirit
           // Check for high-entropy values or common names
        }
      }
      
      // More robust check:
      const envObj = Array.isArray(env) 
        ? Object.fromEntries(env.map(e => String(e).split('=').slice(0, 2) as [string, string]))
        : env;
      
      for (const [key, value] of Object.entries(envObj)) {
        const v = String(value);
        if (secretKeys.some(sk => key.toLowerCase().includes(sk)) && v && v !== "" && !v.startsWith("${")) {
          findings.push({
            rule: "plaintext-secrets",
            severity: "error",
            message: `Service "${name}" contains potential plaintext secret in environment variable "${key}". Use external secrets or env files.`,
            service: name,
          });
        }
      }
    }

    // 5. privileged: ERROR if true
    if (s.privileged === true) {
      findings.push({
        rule: "privileged",
        severity: "error",
        message: `Service "${name}" is running in privileged mode. This is a severe security risk.`,
        service: name,
      });
    }

    // 6. dangerous-mounts: ERROR if /etc, /root, /var/run/docker.sock, /proc, /sys
    if (Array.isArray(s.volumes)) {
      const dangerousPaths = ["/etc", "/root", "/var/run/docker.sock", "/proc", "/sys"];
      for (const vol of s.volumes) {
        const hostPath = typeof vol === "string" ? vol.split(":")[0] : vol.source;
        if (hostPath && dangerousPaths.some(p => hostPath === p || hostPath.startsWith(p + "/"))) {
          findings.push({
            rule: "dangerous-mounts",
            severity: "error",
            message: `Service "${name}" mounts sensitive host path "${hostPath}". This can lead to host compromise.`,
            service: name,
          });
        }
      }
    }

    // 7. missing-depends-on: WARN if DB-like env ref without depends_on
    if (s.environment && !s.depends_on) {
      const envValues = JSON.stringify(s.environment);
      const dbLikeNames = serviceNames.filter(sn => 
        sn.toLowerCase().includes("db") || 
        sn.toLowerCase().includes("postgres") || 
        sn.toLowerCase().includes("redis") ||
        sn.toLowerCase().includes("mongo")
      );

      for (const dbName of dbLikeNames) {
        if (dbName !== name && envValues.includes(dbName)) {
          findings.push({
            rule: "missing-depends-on",
            severity: "warning",
            message: `Service "${name}" appears to reference database service "${dbName}" but lacks a "depends_on" declaration.`,
            service: name,
          });
          break;
        }
      }
    }
  }

  return findings;
}
