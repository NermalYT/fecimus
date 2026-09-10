# Platform support and installation

Fecimus supports **Ubuntu LTS-based Linux** directly and **Windows 11 Pro through WSL2 Ubuntu LTS**. The AI receives a private Linux desktop with its own pointer, keyboard focus, clipboard, application profiles, and headless Chromium browser. Your physical pointer and fullscreen applications remain independent.

## Choose your release archive

| Download | Start after extracting the whole archive | Installation location |
| --- | --- | --- |
| `Fecimus-3.0.0-Linux-Ubuntu-LTS.tar.gz` | Read `START_HERE.md`; run `bash INSTALL_FECIMUS.sh` in a terminal | A fresh source copy under the Linux user's `~/.local/share/fecimus/sources/` |
| `Fecimus-3.0.0-Windows-11-Pro-WSL2.zip` | Read `START_HERE.md`; run `INSTALL_FECIMUS.cmd` | A fresh source copy inside the selected WSL2 distribution |

Both archives contain the same public Fecimus source and complete 99-tool catalog (84 retained tools plus 15 additions), with a platform-specific starter document and launcher at the top level. `README.md` remains the full project overview. Dependencies, model weights, browser profiles, application accounts, Blender, Unity, and GPU drivers are not bundled. Initial dependency installation needs internet access. The launcher remains open to show errors; it does not restart Windows or initialize your WSL user for you.

Release checksums are supplied in `SHA256SUMS`. Each archive includes a `RELEASE_MANIFEST.json` listing file hashes, sizes, and modes; the packager verifies both the archive and a fresh extraction. To rebuild or check an archive without installing:

```bash
python3 scripts/package-release.py --output-dir dist
python3 scripts/package-release.py --verify dist/Fecimus-3.0.0-Linux-Ubuntu-LTS.tar.gz
```

The first command requires reviewed public source to be staged and included in the installer allowlist. The verification command accepts the Windows `.zip` too. These checks establish archive integrity relative to its manifest, not publisher identity. [Linux starter](../platform/Linux/README.md) and [Windows starter](../platform/Windows/README.md) also describe prerequisites and rollback.

## Supported systems

| Host | Runtime | Status |
| --- | --- | --- |
| Ubuntu 22.04, 24.04, 26.04 LTS, x86-64 or ARM64 | Native Linux | Supported target |
| Ubuntu LTS derivatives, including Linux Mint XFCE | Native Linux | Supported when `/etc/os-release` declares Ubuntu ancestry and a supported Ubuntu base |
| Windows 11 Pro / Pro N, build 22000+, x86-64 or ARM64 | WSL2 with one of the supported Ubuntu LTS releases | Supported installation architecture; Windows hardware validation is pending |
| Windows Home, Enterprise, Education, Pro Education, Pro for Workstations; Windows 10 | — | Outside this release's support policy |
| Debian-based LMDE, non-Ubuntu Linux, macOS, WSL1, 32-bit systems | — | Unsupported |

Pro N is included because it is the Pro edition variant without bundled media features; Fecimus's desktop and browser run in Linux. Other Windows editions are deliberately excluded to match this project's scope. The restriction is an Fecimus support choice, not a claim that WSL requires Windows Pro.

The Ubuntu base gate accepts `jammy` (22.04), `noble` (24.04), and `resolute` (26.04). For derivatives, `ID_LIKE` must include `ubuntu` and `UBUNTU_CODENAME` must identify that base. Merely using XFCE does not establish compatibility. Ubuntu release dates and LTS names are documented in [Ubuntu's release list](https://ubuntu.com/project/docs/release-team/list-of-releases/). Playwright documents its [Linux, WSL, and architecture requirements](https://playwright.dev/docs/intro#system-requirements).

## Linux setup

Install Git, Python 3, curl, and xz utilities using your distribution's package manager if missing, then:

```bash
git clone https://github.com/NermalYT/fecimus.git
cd fecimus
bash scripts/install.sh --system-deps --replace-legacy
```

Run as your ordinary user. The installer invokes `sudo` for Ubuntu packages and browser libraries. It keeps an existing Node.js 22+ runtime; if needed, it installs an official Node 22 build privately under `${XDG_DATA_HOME:-~/.local/share}/fecimus/node`, validates its SHA-256 against Node's HTTPS checksum list, and leaves shell profiles unchanged. Download and checksum transport depend on HTTPS trust. [Node's official downloads](https://nodejs.org/en/download) describe the available runtimes.

The installer uses the committed npm lockfile, installs Chromium, checks an actual headless page, then starts Fecimus over MCP and verifies all six backends and the independent desktop before changing LM Studio's configuration. It registers the absolute checkout path, so **keep the checkout in place**.

If system dependencies are already installed, omit `--system-deps`. To register an already installed checkout without repeating npm/browser downloads:

```bash
node scripts/install.mjs --skip-deps --replace-legacy
```

The startup check still runs. A private Xvfb at `FECIMUS_XVFB` or `~/.local/share/fecimus/runtime/usr/bin/Xvfb` also satisfies the dependency check.

## Windows 11 Pro setup

Install WSL2 and initialize an ordinary Linux user first. In an Administrator PowerShell terminal:

```powershell
wsl --install -d Ubuntu-24.04
```

Restart Windows if requested. Open Ubuntu and complete its first-run username/password setup. The Fecimus script cannot automate a mandatory Windows restart or your Linux account password. Microsoft documents [WSL installation](https://learn.microsoft.com/en-us/windows/wsl/install) and [distribution/version commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands).

Check the distribution name and ensure the version column is `2`:

```powershell
wsl --list --verbose
```

If necessary, convert an existing distribution:

```powershell
wsl --set-version Ubuntu-24.04 2
```

Download/extract the Fecimus repository or clone it using Git for Windows. From the checkout, run in ordinary PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Distribution Ubuntu-24.04 -InstallSystemDeps -ReplaceLegacy
```

`-ExecutionPolicy Bypass` applies to this invocation. The script does not change the machine's execution policy. Review local installation scripts before running them.

The script validates Windows edition/build and WSL2 registration, copies the checkout to a fresh directory inside the selected Linux filesystem, installs dependencies there, performs Linux browser/MCP checks, and finally writes **one `fecimus` entry** to Windows LM Studio. No Windows Node installation is needed. A Linux `sudo` password may be requested for packages. Existing WSL installations can use any registered name with `-Distribution`; Fecimus checks its actual Ubuntu base instead of trusting the name.

The generated entry launches `wsl.exe --distribution <name> --exec /usr/bin/env ... <absolute-linux-node> <fecimus-server>`. Linux paths and environment values remain distinct arguments. The host's Windows `PATH` is not replaced with a Linux value.

**The AI desktop contains Linux applications running in WSL2. This release does not provide an independent cursor inside your existing native Windows applications.** It does not move your Windows cursor or promise simultaneous automation of the same host application window. The installer sets `FECIMUS_FILE_ROOTS` to a JSON array containing your Linux home and your Windows user profile translated to its WSL path, so filesystem tools can use your Windows Documents/Downloads directly. Other parts of the Windows drive are not automatically added. This file-tool restriction does not confine authorized terminal commands.

## Compact mode and the control panel

Version 3 defaults to five advertised entry tools: `fecimus_status`, `fecimus_tools`, `fecimus_call`, `fecimus_control_panel` and `fecimus_help`. Use `fecimus_tools` to retrieve exact schemas and `fecimus_call` to invoke the underlying capability. All 99 tools remain available. To advertise them directly, set `FECIMUS_TOOL_MODE=full` in the Linux launch environment or merge `"tool_mode":"full"` into Fecimus's settings, then restart the integration.

The control panel starts on Linux loopback at an automatically chosen port. Ask the model to call `fecimus_control_panel` and open the returned private session link. From an Fecimus source directory with Node/npm available, `npm run control` prints the active link without invoking a model. Run that command in Linux or the selected WSL distribution; the saved descriptor resides with Fecimus's Linux data. Windows browsers can normally reach a WSL-hosted local service through localhost forwarding. Custom networking/firewalls can affect that connection. [Microsoft WSL networking](https://learn.microsoft.com/en-us/windows/wsl/networking).

The panel shows runtime health, activity and supervised jobs/local workers. Its desktop image is read-only: capture once or opt into a two-second refresh while the page is visible. Hiding the page stops viewer polling without stopping Fecimus. Pause blocks new controlled calls; Stop also requests cancellation of active calls, jobs and local workers. Completed actions remain in effect, and cancellation of an already dispatched operation is cooperative. The panel is not a security sandbox.

The link contains a per-session access token. Keep it private; obtain a fresh link after restarting Fecimus. Disable the panel with `FECIMUS_CONTROL=0` or `"control":{"enabled":false}` in settings. `control.port` can choose a fixed local port; default `0` selects a free one. Do not publish or forward this control surface to a network.

## Optional local model API on Windows

Ordinary Windows LM Studio → WSL Fecimus communication uses stdio and needs no HTTP model API. The optional `fecimus_agent_start` worker instead requires a model API reachable **from Fecimus on loopback**, normally `http://127.0.0.1:1234/v1`. The runner deliberately rejects LAN/remote endpoint addresses and attaches no API key.

Default WSL NAT does not make a Windows-hosted API available to Linux through `127.0.0.1`. An API running inside the same Linux environment works; Windows 11 22H2+ also supports mirrored networking for Linux-to-Windows localhost access. Follow [Microsoft's mirrored networking instructions](https://learn.microsoft.com/en-us/windows/wsl/networking#mirrored-mode-networking) if choosing that option. Save work and stop Fecimus before any WSL shutdown required to apply networking changes. This optional setup has not been validated on Windows hardware for this release.

Before starting a worker, test reachability from the WSL terminal:

```bash
curl --fail --max-time 3 http://127.0.0.1:1234/v1/models
```

Choose an actual available model ID and an explicit tool whitelist. A successful models listing checks connectivity, not model tool-calling or vision quality. See [worker arguments and limits](STUDIO.md#optional-local-model-workers).

## Native applications, studio jobs, and graphics

Use `fecimus_desktop_state` to observe Fecimus's private window/input state and optionally its screenshot. `fecimus_desktop_actions` batches up to 12 known mouse, keyboard, and window actions under one desktop queue, validates them before the first action, and stops at the first failure without replaying the batch. Existing individual desktop tools remain available. Screenshots describe Fecimus's display, not your physical desktop.

Use `fecimus_app_probe` to inspect supported editor/runtime locations. Long commands use `fecimus_job_start`, `fecimus_job_status`, and `fecimus_job_cancel`. Jobs run with Fecimus's private application profile and display; project files are selected through an explicit working directory in the configured file roots. Browser sessions and native app profiles remain separate. Use a separate project copy when concurrent editing or application locks would cause conflicts. See [studio workflows](STUDIO.md) for argument examples, mounts, licenses, job lifetimes, and output checks.

A native desktop accessibility/AT-SPI semantic bridge is not implemented; native UI work uses window metadata and screenshots. The private Xvfb display is not a GPU-accelerated desktop guarantee. Blender background rendering can be useful without a GUI; GPU compute still depends on the actual hardware, driver, build, and selected device. Unity's documented Linux Editor requirements do not certify XFCE/Xvfb, WSL2, or Linux ARM64 merely because Fecimus runs there. The [studio guide](STUDIO.md#graphics-and-validation) links the vendor requirements and distinguishes tested runtime behavior from untested application workflows.

## Background browser behavior

- Fecimus controls its own Chromium profile and tabs, independent of your visible browser and screen focus.
- DOM, text, links, and full-page screenshots can be read while you use another fullscreen program. Your desktop can remain unchanged throughout the task.
- Content need not be inside the viewport, but it must have been loaded by the website. Lazy loading, login requirements, closed shadow roots, canvas content, CAPTCHAs, and site access restrictions still affect extraction.
- Your already-open personal tabs and login cookies are not automatically imported. Authenticate in Fecimus's own browser when a task requires an account.
- Hidden and minimized windows are not the same as a sleeping or stopped computer. Suspending the host, stopping WSL, or closing LM Studio interrupts the runtime.

This is an independent workspace, **not a security sandbox**. Authorized tools run with the Linux user's filesystem and network permissions. Keep that distinction when choosing a model and approving tasks.

## Configuration, upgrades, and rollback

The default configuration is `~/.lmstudio/mcp.json` on Linux and `%USERPROFILE%\.lmstudio\mcp.json` on Windows. If LM Studio uses another location, pass `--config /path/mcp.json` or `-ConfigPath C:\path\mcp.json`. LM Studio describes its [MCP integration](https://lmstudio.ai/blog/lmstudio-v0.3.17).

`--replace-legacy` / `-ReplaceLegacy` removes only these original registrations: `playwright`, `desktop-mouse`, `desktop-vision`, `desktop-keyboard`, `desktop-apps`, and `terminal-files`. Existing unrelated integrations are preserved. Omitting this flag keeps every other entry. Backend software is retained internally so one Fecimus toggle exposes all capabilities.

Before an existing configuration changes, the installer keeps an exact adjacent `mcp.json.backup-<timestamp>-<id>`. A failure before registration leaves the configuration unchanged. To roll back, close LM Studio, restore your chosen backup as `mcp.json`, then reopen LM Studio.

For release archives, rerun the matching launcher to install into a fresh source directory; old source directories remain available for configuration rollback. For a direct Linux source checkout, updating that same checkout also changes the source referenced by old configurations, so retain a separate source copy if you need to roll back code. Remove obsolete source copies manually only after you no longer need their backups. Browser profiles and explicit project notes/checkpoints reside under `~/.local/share/fecimus` independently of the source version. Back up that directory to preserve them. Notes require an explicit read in the next session; jobs and local model workers do not resume after restart.

After installation, restart LM Studio and enable **mcp/fecimus** for a compatible tool-calling model. Ask it to call `fecimus_status` to verify the live connection.

## Diagnostics and validation limits

```bash
node scripts/install.mjs --check
npm test
npm run test:integration
```

On Windows, `-CheckOnly` verifies the host/WSL gates and Linux command prerequisites without changing LM Studio configuration. It requires an existing Node 22+ installation; run setup normally to bootstrap Node when absent.

Automated checks cover supported/rejected OS records, WSL1 rejection, the Pro edition gate, configuration preservation, rollback backups, and malformed JSON protection. The existing Linux reference installation is Linux Mint 22.3 / Ubuntu 24.04 base. Consult the release validation report for the exact version and checks exercised; do not infer a new 3.0 hardware run from earlier releases. The Windows installer passed the PowerShell 7 parser and a mocked installation workflow covering rollback, spaces, file-root JSON, and failure handling on Linux. Windows-specific launch/registry behavior and ARM64 hardware require validation on those actual machines; Linux checks cannot certify those environments.

The 3.0 suite adds compact/full catalog checks, project conflict handling, explicit note persistence, panel controls and simulated local-model protocol tests. A simulated server verifies orchestration only. Real inference quality, resource/prompt UI behavior in a specific host, and application-level results require separate recorded evidence. No pending CI or hardware check is represented here as passed.
