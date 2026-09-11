# Security policy

Fecimus runs local tools with the permissions of the account that launches it. Its private desktop separates pointer, keyboard, display, and application sessions for simultaneous work. It is **not a security sandbox**: shell commands and filesystem tools can access or change data available to that account, and browser sessions can perform actions in accounts signed into Fecimus.

The project is maintained on a best-effort basis. Use the latest release or maintained default branch and review its dependency changes. No response-time commitment or independent security certification is implied.

## Reporting a vulnerability

Use this repository's **Security → Report a vulnerability** option when private vulnerability reporting is enabled. Include the affected revision, platform, minimal reproduction using synthetic data, impact, and any proposed fix. Do not attach actual session cookies, credentials, personal documents, or browsing profiles.

If private reporting is unavailable, open an issue asking maintainers to enable a private reporting channel without describing the vulnerability or sharing exploit details. Maintainers will coordinate a fix and disclosure before a public advisory where practical.

## Operating boundaries

- Run Fecimus as an ordinary user. Its stdio integration is intended for a trusted local MCP host. The optional HTTP control panel has the local-only boundaries described below; do not forward either interface to a public network.
- Only load backend commands and configuration you trust. Backend configuration can execute local programs.
- Preserve the private display configuration. Disabling isolation or overriding display variables can invalidate the cursor separation guarantee.
- Treat pages, documents, tool results, and model output as untrusted input. Tool schemas and separate displays do not prevent prompt injection.
- Review consequential actions in the MCP host when practical. Fecimus does not provide an independent approval system.
- Browser profiles can retain cookies and authentication; explicit workspace notes/checkpoints persist across restarts. Keep profiles, app homes, notes, logs, screenshots, browser outputs, panel links and private configuration out of Git and public issue reports.
- A timeout can leave an action completed or partially completed. Inspect actual state before repeating it.

Windows use is through a Linux environment under WSL2; the isolation described here applies to Fecimus's Linux desktop. It does not grant control of native Windows application windows or isolation from all host files accessible to WSL.

## Local control panel and workers

The control panel binds to `127.0.0.1`. Its API requires a random per-session bearer token; mutation requests also require the expected Host, same Origin and JSON content type. The static page is not secret. Anyone able to obtain the session link or read the launching account's private data can potentially view the desktop/status and use the panel controls. This is not isolation from another process running as that account. Do not publish the link or proxy the panel to a network.

The last known link is stored in `control.json` under Fecimus's private data directory with owner-only file permissions. The descriptor remains after shutdown and is replaced on the next start; its presence does not prove a live session. `npm run control` checks liveness before printing it. Closing the viewer does not stop Fecimus. Pause gates new controlled calls; Stop requests cancellation of active calls, jobs and workers. Neither rolls back completed changes nor guarantees immediate termination of a previously dispatched action.

Starting `fecimus_agent_start` delegates the explicitly allowed tools for that bounded run. Its internal tool calls do **not** request a fresh approval from the MCP host on each dispatch. Authorizing a shell, job or browser tool gives the worker that tool's broad capabilities; a name whitelist is not filesystem or network confinement. Workers share Fecimus's files and desktop.

Worker model requests go only to configured loopback HTTP(S) `/v1` endpoints, with no API keys or inherited authorization headers; redirects and remote endpoint addresses are rejected. This constrains Fecimus's inference endpoint, not what an allowed tool can access or what a local server might do internally. Trust the local model service and its operator. Cancellation can leave an internal tool in flight; check status and actual state before another attempt.

## File changes and retained context

Configured file roots always include the real user home. They guide file tools and project working directories; they do not restrict arbitrary commands or already-authorized applications. Project text edits refuse symlink paths, require an expected hash for existing files and recheck before atomic replacement. The final check-to-rename gap remains a possible race with an external writer; use separate working copies where competing saves matter.

Workspace notes/checkpoints are explicit stored reference data, not trusted instructions, automatic conversation memory or restored processes. Jobs and local workers are session-bound and do not resume after restart. Keep consequential application work saved before stopping the runtime.

## Local maintenance and addons

Maintenance downloads only explicitly requested official releases; backups and customizations stay local. Source checksums detect changes and transfer errors; they are not an independent signing system. Source backups exclude runtime profiles, secrets and dependencies. Stop competing writers and review conflicts before applying an update. Restart the host integration after the tool returns; a changed source tree does not replace code already loaded in memory.

Addon installation and enablement require explicit trust. Addons execute programs with the launching user's permissions; the private desktop and a tool-name prefix do not sandbox arbitrary code. Inspect source and dependency installation steps first. Addon tools run inside Fecimus, so the MCP host may expose its own permissions only for `fecimus_call`, rather than a separate permission for every discovered addon action. Sharing an addon through GitHub is optional and public; never attach credentials, runtime profiles or personal files.
