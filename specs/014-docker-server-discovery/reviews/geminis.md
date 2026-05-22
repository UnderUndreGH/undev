🔎 Scrutiny: DevOps Dashboard Local Transport Plan (specs/014-\idea_and_plan.md)

    Untested Assumptions
    - [ ] [assumption] bash and docker CLI are available in the container environment. — disproved by: Default node:20-alpine images do not include bash or docker clients. Running /bin/bash or docker version via child_process will fail with "command not found" unless specifically installed via apk add.
    - [ ] [assumption] Node's ChildProcess streams fully match ssh2's ClientChannel semantics. — disproved by: ssh2 streams have proprietary event lifecycles, signal propagation (kill()), and backpressure behaviors. Dropping in child_process.spawn without a strict behavior-mapping layer will break stream consumers like ssh-executor.ts (e.g. NDJSON parser). 
    
    Failure Modes
    - [ ] [scenario] Buffer overflow on exec — what happens now: Node's child_process.exec has a default maxBuffer of 1MB. Commands returning large NDJSON logs/manifests will crash the transport natively with ERR_CHILD_PROCESS_STDIO_MAXBUFFER; what should happen: localTransport.exec must explicitly set maxBuffer to match or exceed expected SSH payload sizes (e.g. 100MB), or force standard spawn buffering.
    - [ ] [scenario] Dashboard Self-Sabotage — what happens now: A deployment script (like cleanup.sh or docker stop) executed against the local host might unintentionally kill the dashboard container itself, destroying the active DB connection and dropping all WebSockets; what should happen: The local transport needs a safety layer protecting the orchestrator's own container runtime and network (ai-twins-network).
    - [ ] [scenario] Dropped /var/run/docker.sock — what happens now: Auto-seed assumes localhost implies fully capable orchestration, but if the container starts without volumes mounted, all Docker commands crash; what should happen: The auto-seed logic verifies socket presence before marking the local server as "ready".
    
    Edge Cases
    - [ ] Empty/null/zero: If connectionType defaults to ssh for legacy rows but host contains localhost / 127.0.0.1, does it transparently route to LocalTransport or try to SSH into the container itself?
    - [ ] Boundary: AI feature access logic. If aiWriteAccess is implicitly extended to the Local server, the AI Copilot could read process.env secrets or alter dashboard source code, escaping normal sandbox restrictions since it shares the active Node.js filesystem boundaries.
    - [ ] Concurrent: spawn processes consume the physical resources of the Node.js container itself. Running heavy batch pipelines concurrently will steal CPU from the Express event loop and risk an OOM-kill of the application. SSH distributed this overhead to the OS/SSHD resource bounds.
    - [ ] Stale: A stale container image deployed via docker-compose.yml during self-update might leave active local processes zombieized or orphaned when the parent Node.js exits.
    - [ ] Malicious: Shell injection vulnerability blast radius fundamentally widens. While SSH isolated RCE securely into a secondary non-root bash process or constrained OS user, execFile running on local transport grants the attacker root access directly inside the manager container.
    - [ ] Platform (Windows, timezone, locale, unicode): Dev environments (Windows/macOS) do not natively bind /var/run/docker.sock identically, causing the local transport to behave differently in production (Linux) vs npm run dev.
    
    Rejected Alternatives
    - [ ] [approach X] SSH over Localhost (Coolify approach) — rejected because: It was labelled a "crutch/absurd". However: it avoids rewriting 22+ files with a custom DI transport layer, maintains sshPool as the pure single source of truth, avoids container OOM issues via SSHD process boundaries, and natively supports development environments. Was the ROI of building Transport Interface evaluated fairly against the simplicity of dropping an SSH key into authorized_keys for the local host's gateway?
    
    Recommended Actions
    - Priority 1 (blocking): 
      - Update Dockerfile to apk add --no-cache bash docker-cli in the final production stage.
      - Implement a maxBuffer override (e.g. 50 * 1024 * 1024) on the local-executor.exec function to prevent chunk truncation.
      - Test/wrap child_process.spawn so that its stream lifecycle and kill() semantics flawlessly match ssh2.ClientChannel.
    - Priority 2 (before ship): 
      - Explicitly hardcode aiWriteAccess: "disabled" for the "Local" server during auto-seed to prevent sandbox escape.
      - Add explicit bounds/resource limits to localTransport executions so that deploying 10 nested apps does not freeze the dashboard UI event loop.
    - Priority 3 (tech debt): 
      - Centralize getTransport() at the route layer or via a DI context, rather than finding/replacing 22 instances of sshPool across scattered service modules.

---

🔎 Scrutiny: Proxy Pattern (sshPool) for Local Transport (specs/014-\idea_and_plan.md)

    Untested Assumptions
    - [ ] [assumption] Extracting isLocalServer(serverId) inside sshPool is virtually free and transparent — disproved by: sshPool's existing signatures only accept serverId. If it queries the PostgreSQL database on every single exec to check connectionType, it will hammer the DB and increase latency.
    - [ ] [assumption] A concurrency limit (max 5 parallel spawns) will silently protect the orchestrator — disproved by: If the blue/green orchestrator natively schedules 6 tasks at once, a naïve semaphore in the proxy will either deadlock dependent operations or throw queuing timeouts, breaking deployment workflows that worked under SSHD.
    - [ ] [assumption] Container blacklisting by ID stops self-termination — disproved by: Bash scripts like scripts/docker/cleanup.sh often prune resources by matching images, dangling networks, or labels. A simple Container ID blacklist won't stop docker network prune from destroying ai-twins-network or docker compose down inside a sibling directory.
    
    Failure Modes
    - [ ] [scenario] Spurious Local Routing (Man-in-the-Middle DB Hijack) — what happens now: If an attacker or a bug changes an existing remote server's connectionType to "local" in the DB, sshPool blindly starts executing external commands locally as root; what should happen: sshPool must strictly map the auto-seeded local id against an immutable environment variable (LOCAL_SERVER_ID), ignoring DB state for routing security.
    - [ ] [scenario] Stream Event Mismatch in Proxy — what happens now: child_process.spawn uses .on('exit') and .on('close'), while ssh2.ClientChannel has nuances around EOF, close, and .kill() signal propagation. scriptsRunner hangs indefinitely if the proxy doesn't emit identically mapped events; what should happen: A strict Adapter class must wrap ChildProcess to implement the exact ClientChannel interface expectations before returning to the caller.
    
    Edge Cases
    - [ ] Empty/null/zero: What if the local server is historically deleted by an admin UI? Does index.ts auto-seed it with a new ID on restart, leaving orphaned UI relations?
    - [ ] Boundary: Naming. A class named SSHPool running local child processes violates the Principle of Least Astonishment. Developers will trace bugs incorrectly assuming SSH transport. 
    - [ ] Concurrent: Interrupted deploy scanner waking up and executing 50 simultaneous probes across "local" sub-apps will hit the new semaphore limit, stalling health checks for real SSH servers sharing the same event loop.
    - [ ] Stale: In dev mode (npm run dev), running outside Docker (e.g., bare metal Windows), the proxy will attempt execFile('bash') and panic without a clean fallback or developer-friendly warning.
    - [ ] Malicious: AI Copilot issues drizzle-kit drop via local terminal wrapper. Because the proxy hides the transport, the AI might bypass SSH-level connection heuristics.
    - [ ] Platform (Windows, timezone, locale, unicode): Dev environments lacking /var/run/docker.sock will fail immediately upon auto-seed health checks.
    
    Rejected Alternatives
    - [ ] [approach X] Dependency Injection (getTransport refactor) — rejected because: Stated to be high risk/diff (touches 22 files). However, refactoring to DI explicitly types the transports, makes unit testing vastly easier (currently mocking sshPool requires mock-routing), and forces callers to handle transport constraints properly. Wrapping child_process inside SSHPool creates a God Object carrying two entirely different failure domains.
    
    Recommended Actions
    - Priority 1 (blocking): 
      - Ensure the routing condition (isLocalServer) relies on an in-memory cached ID (e.g., LOCAL_HOST_ID env var or single initial boot fetch), do not run queries to servers table on every exec/execStream.
      - Create a precise ClientChannelAdapter for the local stream so ssh-executor does not need to know whether it's talking to ssh2 or child_process.
    - Priority 2 (before ship): 
      - Lock down connectionType in the API routes. Remote servers cannot be toggled to local, and the local server cannot be deleted or have its transport modified.
      - Implement a graceful fallback for local development (Windows/macOS) where docker-cli / bash might not exist unless manually configured by the developer.
    - Priority 3 (tech debt): 
      - Rename SSHPool to TransportPool or ServerConnections (and sshPool to transportPool) to reflect that it now multiplexes local and remote capabilities. This reduces the "God Object" cognitive dissonance.
