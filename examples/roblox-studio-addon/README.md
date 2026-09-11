# Roblox Studio addon — experimental WSL2 launcher

This addon routes the **official built-in Roblox Studio MCP server** through Fecimus's single connection. It contains only a launcher manifest and documentation, not Roblox software. **Manifest/gateway behavior is tested; live Windows/WSL/Studio interoperability is not validated.** Do not treat it as a certified Roblox integration.

1. On Windows 11 Pro, install/update Roblox Studio from Roblox and open a disposable local place. In Studio's Assistant, open **Manage MCP Servers** and enable Studio's MCP server. Follow [Roblox's current instructions](https://create.roblox.com/docs/studio/mcp).
2. Install Fecimus in WSL2. This template expects the standard `/mnt/c/Windows/System32/cmd.exe` mount. If Windows is installed/mounted elsewhere, edit `server.command` to the actual WSL path to `cmd.exe`. WSL Windows executable interoperability must be enabled. The launcher uses the Windows account's `%LOCALAPPDATA%\Roblox\mcp.bat`; it must exist and run successfully under that account.
3. In Fecimus's graphical setup, choose **Install addon…**, select this extracted folder and approve it after review. Restart Fecimus. No separate Roblox entry in LM Studio is needed.
4. Discover `roblox__list_roblox_studios` with `fecimus_tools`. Query available instances, explicitly select the intended `studio_id`, and request a read-only state/tree observation first. Verify Studio's connected-client indicator before editing. Tools depend on the installed Studio version.

If it cannot connect, check `fecimus_status`, verify the official launcher in Windows, and disable this addon with `fecimus_addons` (`action:"disable", id:"roblox"`). A working native Windows MCP launcher does not establish successful WSL transport. Paths containing spaces and the vendor-generated batch file may require troubleshooting using Roblox's instructions. Linux-only installations cannot run this addon.

This bridge addresses the live Studio session through vendor APIs. It does not create an isolated second Roblox place, duplicate your project, or guarantee background/minimized screen capture. Avoid concurrent edits to the same place. Use a separate Studio instance/place for AI work and explicitly target its ID. Vendor tools can modify scripts/assets, execute Luau and affect play mode; treat publishing, purchases and external uploads as separate user-authorized actions. The native bridge operates outside Fecimus's private Linux desktop/input isolation.

Removal: disable first, restart Fecimus, then remove ID `roblox` with `fecimus_addons` or the addon CLI. The vendor installation is retained. Local changes remain private unless you explicitly submit them to GitHub.
