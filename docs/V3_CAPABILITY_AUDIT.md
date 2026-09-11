# Fecimus 3 capability audit

Reviewed 2026-09-10 against the **Codex/GPT agent used to develop Fecimus**. The baseline is Fecimus 2.1.0 and its 84 tools. The 3.0 implementation adds 15 tools for a complete catalog of 99, with five entry tools advertised by default. This document records implemented interfaces, remaining boundaries and acceptance criteria; it is not a claim that every criterion has already passed. See the release's [README](../README.md), [performance evidence](PERFORMANCE.md), and [platform notes](PLATFORMS.md) for shipped behavior and verified environments.

## What can be delivered by an MCP server?

Fecimus can give a compatible model practical access to applications, files and processes. It cannot transfer GPT's trained abilities, this Codex session, or its account permissions into another model. OpenAI likewise distinguishes models from tools that extend their access to external capabilities. [OpenAI tools documentation](https://developers.openai.com/api/docs/guides/tools)

| Capability in this agent | Fecimus 3.0 implementation | Remaining dependency |
| --- | --- | --- |
| Background web work | Private Chromium tabs, DOM snapshots, scraping and screenshots remain available through compact discovery or full mode. | Website access, authentication, browser compatibility, network and model decisions. This does not expose every tab in the user's existing browser. |
| Independent application control | Private Linux display, cursor, keyboard, clipboard, application home and session bus; a token-protected local panel adds read-only viewing and cooperative controls. | Installed Linux applications; visual understanding needs an image-capable model and host. |
| Project development | Existing file/shell tools plus bounded search, line reads, hash-checked literal edits and read-only Git status/diff. | Model coding quality, project dependencies and meaningful tests. No automatic correctness guarantee. |
| Local customization and addons | Explicit private source maintenance, backups, staged official updates and trusted addon MCP servers with namespaced tools. | User-authorized changes, source review, installed dependencies and a host restart. Public addon sharing is optional; user changes are never automatically uploaded. |
| Persistent context | `fecimus_workspace_notes` stores explicit revisioned notes/checkpoints; built-in guides are available through tools/resources/prompts. | The host decides which context reaches the model. Notes do not copy chat history, model memory or automatic context compaction. |
| Long application jobs | Existing supervised jobs support status, bounded logs and cancellation. | Noninteractive processes only; jobs do not resume after Fecimus restarts. These process jobs are separate from the optional local model-worker loop. |
| Reasoning, vision, voice and generated media | Tool results can supply text/images; external integrations could supply additional services. | Appropriate model, runtime and provider. A text-only model does not gain vision from a screenshot tool; real-time audio needs an audio/session stack. [OpenAI audio architecture](https://developers.openai.com/api/docs/guides/realtime) |
| Account app connectors | Separate integrations are possible. | Service authorization, scopes and APIs. Installing Fecimus does not inherit Codex's signed-in connectors. [OpenAI connector authorization](https://developers.openai.com/api/docs/guides/tools-connectors-mcp) |
| Local model workers | `fecimus_agent_start/status/cancel` implement explicit, bounded loopback model/tool loops with a tool whitelist and no automatic replay. | A running compatible local model API; workers share the desktop/files and have no durable restart/resume. This does not import Codex task history or orchestration. |
| Scheduling and hosted publishing | No durable scheduler or hosting account integration is added. Existing tools can participate in a user-authorized workflow. | A host/scheduler that keeps running, inference availability and hosting credentials/services. Codex scheduled tasks and publishing interfaces belong to their host. [Scheduled tasks](https://learn.chatgpt.com/docs/automations), [host features](https://learn.chatgpt.com/docs/features) |

## Implemented interfaces and review focus

1. **Compact tool discovery without losing functionality.** The complete 99-tool catalog retains the 84 legacy names. `fecimus_tools` retrieves schemas and `fecimus_call` dispatches through the same validation and execution path; compact mode advertises five entry tools, while full mode advertises every tool. Never replay an action because its output was ambiguous. This reduces catalog overhead; it does not make local inference itself faster. LM Studio explicitly warns that large MCP catalogs can exhaust local model context. [LM Studio MCP integration](https://lmstudio.ai/docs/app/mcp)
2. **Direct project work.** Use `fecimus_project_search`, `fecimus_project_read`, `fecimus_project_edit` and `fecimus_git_status`. Use bounded UTF-8 reads, authorized roots, symlink checks and an expected content hash before replacement. Hash checks catch ordinary stale edits; they are not an operating-system atomic compare-and-swap against every external writer. Keep Git inspection separate from commits, resets and staging.
3. **Useful local continuity and supervision.** Explicit revisioned notes and a loopback control panel provide continuity and supervision. The panel has a per-session access token, opt-in two-second viewing, state/job/worker displays and cooperative controls. Browser-exposed controls must validate requests and render untrusted titles/logs as text. This is a local control surface, not an unauthenticated remote command endpoint.
4. **Standard context interfaces with a tool fallback.** Guides/resources and the `fecimus_development` / `fecimus_studio` prompts are implemented. MCP resources are application-controlled; prompts are intended for user selection. Their UI and context inclusion depend on the host. The LM Studio MCP page reviewed here documents server/tool integration but does not establish its resources/prompts UI behavior. Test protocol support separately and keep essential guidance retrievable through a tool. [MCP resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources), [MCP prompts](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts)

5. **Optional local model orchestration.** `fecimus_agent_start` requires an explicit model, objective and allowed tool names. Only loopback `/v1` endpoints are accepted; requests include no API key and reject redirects. Turn/context/network limits are bounded, all proposed calls are validated before dispatch, and errors stop the loop without automatic retries. The runner preserves tool-call/result protocol history and does not silently truncate it. Agent logs/reports live in memory and do not resume after restart. A running LM Studio API and a compatible model are additional requirements, not bundled components. See [worker setup](STUDIO.md#optional-local-model-workers).
6. **Application discovery.** `fecimus_app_probe` inspects Blender, Unity, Godot and development runtimes, with bounded known version flags. Unity is never launched for discovery. Installation detection is not a license, editor-project or GPU certification.

## Platform, cursor and graphics limits

Release targets are **Windows 11 Pro/Pro N through WSL2** and **Ubuntu LTS-based distributions**, including Linux Mint XFCE. Windows 10 and other distributions remain outside this release's support policy. Microsoft supports installing WSL on Windows 11; an initialized Linux distribution and regular Linux user are prerequisites. Fecimus's narrower edition policy is a project choice. [Microsoft WSL installation](https://learn.microsoft.com/en-us/windows/wsl/install)

Fecimus's independent cursor belongs to its Linux desktop, including when Linux runs in WSL2. It does not control native Windows applications with a second independent Windows pointer. Microsoft's `SetCursorPos` operates on a shared cursor/current input desktop; `SendInput` inserts events into the input stream and has integrity restrictions. Those APIs alone do not provide the requested independent human/AI input. [SetCursorPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setcursorpos), [SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)

Xvfb renders a virtual framebuffer without physical display hardware. A minimized viewer does not stop that separate desktop or Fecimus's headless browser, but the application must still render its own content. Occluded, minimized, protected, lazily loaded or inaccessible application content is not universally capturable. WSLg can offer GPU acceleration with suitable drivers; this does **not** establish GPU acceleration on Fecimus's separate Xvfb display. The historical Fecimus 2.1 Blender CPU/GUI smoke test in [studio documentation](STUDIO.md) does not validate GPU rendering, Unity or native Windows GUI control. [Xvfb manual](https://xorg.freedesktop.org/archive/X11R7.5/doc/man/man1/Xvfb.1.html), [Microsoft WSL GUI requirements](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps)

A native AT-SPI accessibility bridge is **not implemented in 3.0**; native UI grounding uses window metadata and screenshots. The baseline explicitly sets `NO_AT_BRIDGE=1`; adding it needs deliberate integration with Fecimus's private session bus. GTK exposes accessibility semantics through participating widgets; custom widgets need application support, so an accessibility tree cannot replace every screenshot or canvas interaction. [GTK accessibility](https://gnome.pages.gitlab.gnome.org/gtk/gtk4/section-accessibility.html)

The private application home also separates licenses, plugins, credentials and settings; host profiles do not automatically transfer. Display/profile separation is not a security sandbox or a CPU, memory or GPU quota.

## Release acceptance matrix

These are review gates. Record actual results in release validation; mark unavailable hardware or host behavior **unverified**, rather than inferring success from fixtures.

| Area | Required evidence |
| --- | --- |
| Legacy coverage | Compare the original 84 tool names against the full catalog and compact dispatcher; no removed capability or weaker validation. |
| Compact mode | Smaller initial schema payload measured against full mode; search → schema → valid call works; unknown tools and malformed arguments return useful errors without executing. |
| Project editing | Search/read bounds, stale hash, absent-file creation, duplicate replacement text, symlink/root rejection and ordinary concurrent-edit checks. Existing user changes survive rejected edits. |
| Notes | Save/read/list after server restart; size/count limits and invalid inputs tested; no secrets or user notes inside release archives. |
| Control panel | Loopback binding, valid/invalid token checks, request/origin validation, escaped log/window text, opt-in viewer behavior, pause/new-call gating and cancellation of real job/worker IDs. Stop is cooperative and must not be described as a sandbox. |
| Local model workers | Test whitelist/schema rejection before dispatch, correct tool-call/result histories, no retries, turn/context/response bounds, timeout/cancellation races and loopback/redirect rejection with simulated local servers. A separate real-model run is needed before claiming inference compatibility. |
| Application discovery | Known version flags bounded; Unity never launched; Windows executables not run through the Linux probe; output distinguishes detection from compatibility. |
| Resources/prompts | Advertised capabilities match list/read/get handlers; invalid identifiers fail; essential guidance remains accessible through tools when a host lacks a picker. |
| Background operation | Browser work and private-desktop actions continue with the viewer hidden; observation confirms the human session's pointer/input is unaffected. |
| Installation | Both archives pass manifest/extraction checks; each claimed OS receives a real install/start/MCP workflow test, or its hardware validation gap is prominently disclosed. |
| Model compatibility | Record exact model/quantization/runtime/context and a real multi-step workflow. Synthetic `check-model` success proves only basic text tool calling, not vision, long tasks or general certification. |

Malformed tool-call JSON is also a model/template/runtime issue. LM Studio may return unparseable calls as ordinary text. Compact schemas and clear errors can help, but cannot guarantee that every model will emit valid actions. [LM Studio tool-use behavior](https://lmstudio.ai/docs/developer/openai-compat/tools)

## Evidence labels

“Implemented” identifies code and exposed interfaces. “Fixture-tested” identifies deterministic protocol/process/file tests. “Application-tested” requires the actual named application and environment; “model-tested” requires the exact model/runtime/quantization and real inference. A release archive or passing CI job cannot substitute for the latter two. Current pending release checks are not marked as passed in this audit.

## Setup window evidence

The Linux GTK setup window was rendered on an isolated Xvfb display and its **My addons** action completed against temporary private data. The actual addon CLI passed inspection/install/list and duplicate-install checks; a fixture installer failure retained its exit code and output for the GUI. The WPF Windows window requires Windows CI syntax checks and real Windows 11 user validation; Linux rendering does not validate Windows appearance or WSL installation. See [setup instructions](SETUP.md) and the [studio compatibility matrix](STUDIO.md#studio-compatibility-matrix).
