# Graphical setup and addon installation

Download the archive matching your platform from [Releases](https://github.com/NermalYT/fecimus/releases). Extract **all** files first. The launchers open a local native window; no setup web service or public account is required.

| Platform | Open | Requirements |
| --- | --- | --- |
| Ubuntu LTS / Mint XFCE | `INSTALL_FECIMUS.sh` → Run, or `bash INSTALL_FECIMUS.sh` | Ordinary desktop user; Python 3, curl, xz-utils, `python3-gi`, `gir1.2-gtk-3.0`, `x-terminal-emulator` |
| Windows 11 Pro / Pro N | Double-click `INSTALL_FECIMUS.cmd` | Windows PowerShell 5.1; initialized Ubuntu LTS WSL2 distribution and ordinary Linux user |

Click **Install / upgrade Fecimus**. A terminal opens for dependency progress and any sudo password. The window reports success/failure. On Windows, select the exact installed WSL distribution name first. Restart LM Studio after success, load a tool-capable model and enable **mcp/fecimus**. No model or commercial studio app is bundled.

This is a **one-launch graphical installer**, not an unattended operating-system installer. Initial WSL installation, reboot/account setup, OS security prompts, archive extraction and dependency authentication can require user action. Windows configuration and your old source copy are preserved for rollback. Linux setup retains the final 30,000 characters of terminal output in the window; Windows failures retain their console.

If Linux GTK bindings are missing, the launcher falls back to the terminal installer. To install the GUI requirements:

```bash
sudo apt-get update
sudo apt-get install python3 curl xz-utils python3-gi gir1.2-gtk-3.0 x-terminal-emulator
```

For terminal automation use `bash INSTALL_FECIMUS.sh --no-gui` on Linux. Set `FECIMUS_NO_GUI=1` on Windows or pass explicit installer arguments. `FECIMUS_NO_PAUSE=1` suppresses the terminal launcher's final pause. A custom LM Studio config path requires the CLI; the Windows addon window reads the default `%USERPROFILE%\.lmstudio\mcp.json`.

## Install an addon

1. Download an addon from a source you trust and extract its ZIP if applicable. Review its source and access requirements. The picker accepts an **extracted folder**, not a ZIP or remote URL.
2. Reopen the same Fecimus launcher. Choose **Install addon…**, select the folder directly containing `fecimus-addon.json`, and review the inspection result.
3. Click **OK** to install that trusted addon. This copies it into your private Fecimus data directory. Restart Fecimus (toggle its MCP connection off/on or restart LM Studio) to load it.

Use **My addons** to view installed entries. A matching ID is never silently overwritten. Use the documented addon CLI or `fecimus_addons` tool to disable, remove or replace an addon. Addon installation does not install third-party dependencies automatically; an author must declare preparation steps. Folder picking plus explicit trust confirmation is intentional: addons can execute code as your account. Nothing is uploaded by these buttons.

To try the bundled example, choose `examples/hello-addon`, install it, restart Fecimus, and discover `hello__greet`. See [making and submitting addons](ADDONS.md) and the [community section](../addons/README.md).

The GUI is a setup utility; the separate `fecimus_control_panel` tool opens the live desktop/activity panel while Fecimus is running.
