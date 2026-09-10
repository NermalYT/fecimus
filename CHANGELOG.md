# Changelog

## 2.1.0 — 2026-09-09

Desktop workflow helpers, supervised studio jobs, and separate platform release packages.

- Preserve all 79 previous tools and add `fecimus_desktop_state`, `fecimus_desktop_actions`, `fecimus_job_start`, `fecimus_job_status`, and `fecimus_job_cancel`: **84 tools behind one Fecimus integration**.
- Observe window/input state with an optional screenshot; validate and run up to 12 desktop actions under one queue, stopping on the first failure without replay.
- Supervise long commands with explicit argument arrays, project-root checks, bounded logs, status, cancellation, timeouts, and process cleanup. Default to two concurrent jobs and attempt lower CPU scheduling priority.
- Provide [Linux](https://github.com/NermalYT/fecimus/releases/download/v2.1.0/Fecimus-2.1.0-Linux-Ubuntu-LTS.tar.gz) and [Windows 11 Pro through WSL2](https://github.com/NermalYT/fecimus/releases/download/v2.1.0/Fecimus-2.1.0-Windows-11-Pro-WSL2.zip) archives with platform-specific `START_HERE.md` and launchers, fresh source staging, configuration backups, checksums, and verified extraction manifests.
- Document project files/mounts, application profiles, Blender and Unity workflows, graphics limits, and [performance validation](docs/PERFORMANCE.md).

Validated Blender 4.5.13 LTS on Linux Mint 22.3 / Ubuntu 24.04 base with a disposable 64×64 Cycles CPU render, saved scene, fully painted private-desktop GUI, and verified cleanup. This was not a production render benchmark. GPU acceleration, Unity, native Windows GUI control, and Windows/WSL hardware execution remain untested. Private application HOME does not automatically inherit host licenses or preferences.

## 2.0.0 — 2026-09-09

First standalone public release of Fecimus's unified MCP gateway.

- One LM Studio integration exposing all 79 browser, desktop, application, terminal, file and diagnostic tools.
- Independent X11 desktop, application profiles and input, plus headless Chromium with leased persistent profiles.
- Background tab extraction, bounded concurrent scraping, full-page screenshots and inline accessibility snapshots.
- Validated arguments and defaults, serialized conflicting input, recovery without replaying dispatched actions, and parent-exit cleanup.
- Ubuntu LTS installation and Windows 11 Pro installation through WSL2; configuration backups and preservation of unrelated MCP integrations.
- A sourced catalog of 38 model variants and a harmless local function-calling compatibility probe.
- Regression coverage for browser/input isolation, backend faults, cancellation, large files, filesystem boundaries, application discovery and installers.

Validated on Linux Mint 22.3 / Ubuntu 24.04 base. Windows installer mocks pass; actual Windows and ARM64 hardware validation is pending. Model entries describe documented capabilities, not Fecimus benchmark results.
