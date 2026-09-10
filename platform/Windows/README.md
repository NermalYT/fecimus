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

1. Use **Extract All** on `Fecimus-<version>-Windows-11-Pro-WSL2.zip`. Keep every extracted source file together.
2. Run `INSTALL_FECIMUS.cmd` from the extracted folder as your ordinary Windows user. A terminal shows progress/errors and remains open afterward.
3. Enter your Linux `sudo` password if prompted for dependency installation.
4. Restart Windows LM Studio, choose a model with working tool calling, and enable **mcp/fecimus**. Ask the model to call `fecimus_status`.

The default WSL distribution name is `Ubuntu-24.04`. For another initialized supported distribution, open Command Prompt in the extracted directory and run:

```bat
INSTALL_FECIMUS.cmd -Distribution "YourInstalledDistroName"
```

In a source checkout use `platform\Windows\INSTALL_FECIMUS.cmd`. Set the environment variable `FECIMUS_NO_PAUSE=1` to skip the final pause for scripted use. The `.cmd` launcher invokes Windows PowerShell with an execution-policy override for that invocation only; it does not change machine policy.

Fecimus stages a fresh source copy in the Linux filesystem, installs Node and dependencies there, verifies Linux MCP startup, and backs up `%USERPROFILE%\.lmstudio\mcp.json` before writing one Fecimus entry. It removes the six original Fecimus backend registrations and keeps unrelated integrations. For a nondefault configuration file, append `-ConfigPath "C:\path\mcp.json"`. Internet access is required for dependencies. No Windows Node, model, Blender, Unity, or GPU driver is bundled.

## Files and simultaneous work

Your Linux home and Windows user profile are configured as file roots. For example, `C:\Users\YourName\Documents\Project` maps to `/mnt/c/Users/YourName/Documents/Project` in WSL with its default drive mounts. Custom WSL mount layouts require the actual Linux path. Additional drives/projects require explicit file-root configuration. See [project workflows](../../docs/STUDIO.md).

The AI's headless browser can inspect its own loaded tabs while you work fullscreen. Your existing personal-browser cookies/tabs are separate. Closing LM Studio, stopping WSL, or suspending Windows interrupts the runtime. Xvfb does not establish GPU-accelerated graphics, and Unity's native Linux Editor requirements do not certify WSL2 or XFCE. Native Windows projects can be edited as files; their Windows UI remains yours.

## Verify or restore

Compare `Get-FileHash .\Fecimus-<version>-Windows-11-Pro-WSL2.zip -Algorithm SHA256` with the published `SHA256SUMS`. Each archive has a `RELEASE_MANIFEST.json` validated by the release packager. Hashes detect corruption, not a compromised publisher.

To roll back, close LM Studio, restore a chosen adjacent `mcp.json.backup-*` file as `mcp.json`, and reopen LM Studio. Keep the Linux source directory referenced by the backup; browser data is retained independently.

Read [README.md](../../README.md), [platform details](../../docs/PLATFORMS.md), and [model compatibility](../../docs/MODELS.md) for the complete setup and limitations.
