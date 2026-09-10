# Start here: Fecimus for Linux

This archive is for Ubuntu 22.04, 24.04, or 26.04 LTS and derivatives that declare one of those Ubuntu bases, such as Linux Mint XFCE. It targets x86-64 and ARM64. See [platform validation status](../../docs/PLATFORMS.md); a supported target is not a claim of testing every machine.

## Install

1. Extract the entire `Fecimus-<version>-Linux-Ubuntu-LTS.tar.gz` archive.
2. Install Python 3, curl, and xz utilities if missing:

   ```bash
   sudo apt-get update
   sudo apt-get install python3 curl xz-utils
   ```

3. Open a terminal in the extracted directory and run as your ordinary user:

   ```bash
   bash INSTALL_FECIMUS.sh
   ```

   In a source checkout the equivalent launcher is `bash platform/Linux/INSTALL_FECIMUS.sh`.

4. Restart LM Studio, choose a model with working tool calling, and enable **mcp/fecimus**. Ask the model to call `fecimus_status`.

The launcher stages a fresh installed copy under `~/.local/share/fecimus/sources/`, installs missing Node 22 privately when needed, installs Linux/browser dependencies using `sudo`, and verifies MCP startup before registration. Internet access is needed for dependencies; no model, Blender, Unity, or GPU driver is bundled. The terminal retains errors and waits for Enter when interactive. Set `FECIMUS_NO_PAUSE=1` for scripted use.

The installer backs up existing `~/.lmstudio/mcp.json`, replaces the Fecimus entry, removes the six original Fecimus backend registrations, and preserves unrelated MCP entries. Old installed source copies and browser data remain. To use a different host configuration file, append `--config /absolute/path/mcp.json`. For a customized installation, use `scripts/install.sh` options directly; see [installation and rollback](../../docs/PLATFORMS.md).

## What runs independently

Fecimus uses its own Linux display, cursor, keyboard focus, clipboard, application profiles, and hidden Chromium browser. It can read its loaded tabs while you work fullscreen. It does not import your personal browser tabs, reveal content a site has not loaded, or create a second cursor inside the same personal application window.

Xvfb is a virtual display, not a promise of hardware-accelerated 3D. Use [studio jobs and project workflows](../../docs/STUDIO.md) for Blender scripts, renders, and build commands. Files remain subject to the launching user's permissions; the private desktop is not a security sandbox.

## Verify or restore

Compare the archive's SHA-256 with `SHA256SUMS` from the release before extracting. Each package contains `RELEASE_MANIFEST.json`; the maintainer's packaging command validates archive contents and a fresh extraction against it. Hashes detect corruption and do not replace trusting the release source.

To roll back, close LM Studio and restore a chosen adjacent `mcp.json.backup-*` file as `mcp.json`, then restart LM Studio. Keep the source copy referenced by that backup. Browser sessions are retained under `~/.local/share/fecimus`; source rollback does not roll back those sessions.

The full project overview remains in [README.md](../../README.md). Model selection and a basic compatibility check are described in [MODELS.md](../../docs/MODELS.md).
