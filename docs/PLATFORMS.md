# Platform support and installation

Fecimus supports **Ubuntu LTS-based Linux** directly and **Windows 11 Pro through WSL2 Ubuntu LTS**. The AI receives a private Linux desktop with its own pointer, keyboard focus, clipboard, application profiles, and headless Chromium browser. Your physical pointer and fullscreen applications remain independent.

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

On Linux, update your checkout and rerun setup. On Windows, each setup stages a fresh source directory under `~/.local/share/fecimus/sources/` in WSL. Old source directories remain available for configuration rollback; remove obsolete ones manually only after you no longer need those backups. Browser profiles and data reside under `~/.local/share/fecimus` independently of the source version. Back up that directory if you need to preserve browser sessions.

After installation, restart LM Studio and enable **mcp/fecimus** for a compatible tool-calling model. Ask it to call `fecimus_status` to verify the live connection.

## Diagnostics and validation limits

```bash
node scripts/install.mjs --check
npm test
npm run test:integration
```

On Windows, `-CheckOnly` verifies the host/WSL gates and Linux command prerequisites without changing LM Studio configuration. It requires an existing Node 22+ installation; run setup normally to bootstrap Node when absent.

Unit tests cover supported/rejected OS records, WSL1 rejection, the Pro edition gate, configuration preservation, rollback backups, and malformed JSON protection. Linux installation and live MCP startup were exercised on Linux Mint 22.3 / Ubuntu 24.04 base. The Windows installer passed the PowerShell 7 parser and a mocked installation workflow covering rollback, spaces, file-root JSON, and failure handling on Linux. Windows-specific launch/registry behavior and ARM64 hardware require validation on those actual machines; Linux checks cannot certify those environments.
