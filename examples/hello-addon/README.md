# Hello Fecimus addon

A dependency-free MCP server that adds `hello__greet` to Fecimus. It needs Node 22 or newer, supplied by your Fecimus installation. It uses no network or native cursor input.

From the Fecimus installation directory, in Linux or the Windows WSL Ubuntu terminal:

```sh
node scripts/addons.mjs inspect examples/hello-addon
node scripts/addons.mjs install examples/hello-addon --trust
```

Restart the Fecimus connection in your MCP client. Ask your model to find `hello__greet` with `fecimus_tools`, then call it through `fecimus_call` using `{"tool":"hello__greet","arguments":{"name":"Fecimus"}}`. In full tool mode, the tool also appears directly.

`--trust` acknowledges that the addon is local code with your user account's permissions. Installation only copies files and records enablement; Fecimus starts enabled addon servers on the next restart. The addon receives Fecimus's private desktop environment, but that is not a security sandbox.

To customize, copy this folder to your own local directory, change its manifest id/name/version and the server's tool schema/handler, inspect it, then install the copy. Use a distinct lowercase id; Fecimus prefixes each tool with `id__`; the combined name must be at most 64 characters. Local installed code lives under `FECIMUS_DATA_DIR/addons/installed/hello` (by default `~/.local/share/fecimus/addons/installed/hello`). You may edit that private copy and restart Fecimus. Your edits are not uploaded to GitHub.

Disable or remove:

```sh
node scripts/addons.mjs disable hello
node scripts/addons.mjs remove hello
```

Both take effect on restart. Removal moves the copy to private trash and prints its recovery path. See [the addon guide](../../docs/ADDONS.md) for the manifest contract, limits, dependencies, sharing, and recovery. This example implements the core MCP methods needed by Fecimus; use an official MCP SDK for richer production servers.

[MIT licensed](LICENSE). Keep this license with copies of the example.
