# Start here: Fecimus for Windows 11 Pro

This archive is for **Windows 11 Pro or Pro N**, build 22000+, using **WSL2 Ubuntu LTS**. It contains the same Fecimus tools as the Linux archive. The AI's independent desktop contains Linux applications; this release does not control native Windows application windows with a second cursor. Windows hardware validation remains pending; see [platform status](../../docs/PLATFORMS.md).

## Prepare WSL once

In an Administrator PowerShell terminal:

```powershell
wsl --install -d Ubuntu-24.04
```

Restart Windows if requested. Open Ubuntu, finish creating an ordinary Linux username/password, and verify that `wsl --list --verbose` shows version `2`. Do not use root as the distribution's default user. If necessary, run `wsl --set-version Ubuntu-24.04 2`. The restart and first-run account setup must be completed before Fecimus installation. [Microsoft WSL installation](https://learn.microsoft.com/en-us/windows/wsl/install).

In the Ubuntu terminal, install prerequisites if missing:

```bash
sudo apt-get update
sudo apt-get install python3 curl xz-utils
```

## Install Fecimus

1. Use **Extract All** on `Fecimus-3.0.0-Windows-11-Pro-WSL2.zip`. Keep every extracted source file together.
2. Run `INSTALL_FECIMUS.cmd` from the extracted folder as your ordinary Windows user. The setup window opens. Select your initialized WSL distribution and click **Install / upgrade Fecimus**. A console handles progress and password prompts; errors remain visible. **Install addon…** opens the addon folder picker. See [graphical setup](../../docs/SETUP.md).
3. Enter your Linux `sudo` password if prompted for dependency installation.
4. Restart Windows LM Studio, choose a model with working tool calling, and enable **mcp/fecimus**. Ask the model to call `fecimus_status`, then `fecimus_help`.

The default WSL distribution name is `Ubuntu-24.04`. For another initialized supported distribution, open Command Prompt in the extracted directory and run:

```bat
INSTALL_FECIMUS.cmd -Distribution "YourInstalledDistroName"
```

In a source checkout use `platform\Windows\INSTALL_FECIMUS.cmd`. Set the environment variable `FECIMUS_NO_PAUSE=1` to skip the final pause for scripted use. The `.cmd` launcher invokes Windows PowerShell with an execution-policy override for that invocation only; it does not change machine policy.

Fecimus stages a fresh source copy in the Linux filesystem, installs Node and dependencies there, verifies Linux MCP startup, and backs up `%USERPROFILE%\.lmstudio\mcp.json` before writing one Fecimus entry. It removes the six original Fecimus backend registrations and keeps unrelated integrations. For a nondefault configuration file, append `-ConfigPath "C:\path\mcp.json"`. Internet access is required for dependencies. No Windows Node, model, Blender, Unity, or GPU driver is bundled.

## Start a workflow and open the panel

Fecimus 3 provides all 99 tools through five compact entry tools by default. Ask the model to use `fecimus_tools` to discover exact schemas, then `fecimus_call` to perform the task. Full mode is available through `FECIMUS_TOOL_MODE=full` in the Linux launch environment or `"tool_mode":"full"` in settings; restart Fecimus after changing it.

Call `fecimus_control_panel` and open its private session link to see activity, jobs and local workers. Its optional two-second desktop viewer is read-only and pauses polling when hidden. Pause blocks new controlled calls; Stop additionally requests cancellation of active work. Neither undoes completed actions or creates a security sandbox. With Node/npm available, `npm run control` from an Fecimus source directory in Linux/WSL prints the active link. Keep that link private.

Project tools provide bounded search/read and hash-checked literal edits. `fecimus_workspace_notes` saves explicit project checkpoints across restarts; ask the next session to read them. `fecimus_agent_start` is optional and needs a running loopback model API plus a model/tool whitelist; normal MCP use needs no separate API. See [studio workflows](../../docs/STUDIO.md) for exact arguments and limits.

A Windows-hosted LM Studio API is not automatically reachable on WSL loopback under every network mode. Read the [optional worker networking requirement](../../docs/PLATFORMS.md#optional-local-model-api-on-windows) before enabling local workers.

## Files and simultaneous work

Your Linux home and Windows user profile are configured as file roots. For example, `C:\Users\YourName\Documents\Project` maps to `/mnt/c/Users/YourName/Documents/Project` in WSL with its default drive mounts. Custom WSL mount layouts require the actual Linux path. Additional drives/projects require explicit file-root configuration. See [project workflows](../../docs/STUDIO.md).

The AI's headless browser can inspect its own loaded tabs while you work fullscreen. Your existing personal-browser cookies/tabs are separate. Closing LM Studio, stopping WSL, or suspending Windows interrupts the runtime. Xvfb does not establish GPU-accelerated graphics, and Unity's native Linux Editor requirements do not certify WSL2 or XFCE. Native Windows projects can be edited as files; their Windows UI remains yours.

## Verify or restore

Compare `Get-FileHash .\Fecimus-3.0.0-Windows-11-Pro-WSL2.zip -Algorithm SHA256` with the published `SHA256SUMS`. Each archive has a `RELEASE_MANIFEST.json` validated by the release packager. Hashes detect corruption, not a compromised publisher.

To roll back, close LM Studio, restore a chosen adjacent `mcp.json.backup-*` file as `mcp.json`, and reopen LM Studio. Keep the Linux source directory referenced by the backup; browser data is retained independently.

Read [README.md](../../README.md), [platform details](../../docs/PLATFORMS.md), and [model compatibility](../../docs/MODELS.md) for the complete setup and limitations.
