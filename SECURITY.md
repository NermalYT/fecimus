# Security policy

Fecimus runs local tools with the permissions of the account that launches it. Its private desktop separates pointer, keyboard, display, and application sessions for simultaneous work. It is **not a security sandbox**: shell commands and filesystem tools can access or change data available to that account, and browser sessions can perform actions in accounts signed into Fecimus.

The project is maintained on a best-effort basis. Use the latest release or maintained default branch and review its dependency changes. No response-time commitment or independent security certification is implied.

## Reporting a vulnerability

Use this repository's **Security → Report a vulnerability** option when private vulnerability reporting is enabled. Include the affected revision, platform, minimal reproduction using synthetic data, impact, and any proposed fix. Do not attach actual session cookies, credentials, personal documents, or browsing profiles.

If private reporting is unavailable, open an issue asking maintainers to enable a private reporting channel without describing the vulnerability or sharing exploit details. Maintainers will coordinate a fix and disclosure before a public advisory where practical.

## Operating boundaries

- Run Fecimus as an ordinary user. Its stdio integration is intended for a trusted local MCP host; do not expose it as an unauthenticated network service.
- Only load backend commands and configuration you trust. Backend configuration can execute local programs.
- Preserve the private display configuration. Disabling isolation or overriding display variables can invalidate the cursor separation guarantee.
- Treat pages, documents, tool results, and model output as untrusted input. Tool schemas and separate displays do not prevent prompt injection.
- Review consequential actions in the MCP host when practical. Fecimus does not provide an independent approval system.
- Browser profiles can retain cookies and authentication. Keep profiles, app homes, logs, screenshots, browser outputs, and private configuration out of Git and public issue reports.
- A timeout can leave an action completed or partially completed. Inspect actual state before repeating it.

Windows use is through a Linux environment under WSL2; the isolation described here applies to Fecimus's Linux desktop. It does not grant control of native Windows application windows or isolation from all host files accessible to WSL.
