# Unity CLI addon — optional vendor integration

This manifest starts the Unity CLI's `unity mcp` server behind Fecimus, producing namespaced `unity__...` tools. It does not bundle Unity, install a license or modify a project. **Manifest/gateway behavior is tested; a live Unity Editor connection is not validated.**

1. Install a compatible Unity Editor and the [official Unity CLI](https://docs.unity.com/en-us/unity-cli). Follow Unity's instructions to set up its Pipeline package in a disposable project and verify the CLI can see that Editor. The CLI is experimental; consult your installed `unity --help` and `unity mcp --help` before use.
2. Edit `fecimus-addon.json` if `unity` is not on Fecimus's PATH: set `server.command` to the absolute executable path. The default targets a Linux CLI/Editor. In WSL2 a Linux CLI does not automatically reach a Windows Editor's localhost service. A user-configured Windows CLI executable launched through WSL interop is an **unvalidated alternative**, not the default.
3. Use Fecimus setup's **Install addon…** picker to select this folder, review and install, then restart Fecimus. Discover `unity__` tools with `fecimus_tools` and inspect their actual schemas. Start with a read-only connection/status query and verify the project before changing it.

Unity replaced the old in-Editor assistant MCP server with the CLI's MCP mode; see [Unity's migration guide](https://docs.unity.com/en-us/unity-cli/replace-mcp-server-unity-cli). The current CLI/Pipeline route requires a suitable Editor and project setup. Fecimus's private Linux HOME may differ from the profile where you configured the CLI: configure only the necessary app-specific settings in Fecimus's profile, not your entire personal home. Vendor graphics/OS/license requirements still apply.

For efficient non-MCP workflows, Fecimus's job tools can call an installed Unity CLI directly. Discover its current commands with `unity --help`; use explicit project paths and verify logs/artifacts. Do not open the same project simultaneously in a separate batch Editor and a personal Editor.

Disable ID `unity`, restart Fecimus, then remove it using the addon tool/CLI to uninstall the addon. This does not uninstall Unity or its project packages. The generic addon manager cannot certify every exposed tool or Editor version.
