# Fecimus community addons

Use this area to find or share optional extensions to your local Fecimus. Addons are ordinary local code, loaded only after you install and enable them. They use the same Fecimus integration in your MCP host.

- [Browse community submissions](https://github.com/NermalYT/fecimus/issues?q=is%3Aissue%20%22%5BAddon%5D%22%20in%3Atitle), including closed submissions and their discussion.
- [Submit an addon](https://github.com/NermalYT/fecimus/issues/new?template=addon.yml) with source or a source ZIP, installation steps, license, and tested compatibility.
- [Create and install an addon](../docs/ADDONS.md).
- [Try the included hello addon](../examples/hello-addon).
- Optional vendor launchers: [Roblox Studio (experimental WSL2)](../examples/roblox-studio-addon) and [Unity CLI](../examples/unity-cli-addon). Read their prerequisites; live studio connections remain unverified.
- [Ask your model for a private customization](../docs/UPGRADING.md).

The issue directory accepts community submissions; a listing is not an audit, certification, or promise of support. Read the source and discussion before installing. An addon can run code with your user account's access. Tool schemas and namespacing do not sandbox that code.

## Share your work

1. Package only the addon source, manifest, README, tests, and license. Exclude secrets, personal settings, model weights, browser data, `node_modules`, and project files you do not intend to publish.
2. Open the submission form above. Give the addon version, exact source commit or release, download SHA-256, dependencies, installation/removal instructions, and the platforms, hosts and models you actually tested.
3. Link to your own source repository and release, or attach a source ZIP in the **Source and download** field. GitHub uploads attachments as soon as they are attached; review the archive before selecting it. See [GitHub's attachment instructions](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files).
4. Keep updates in the same submission, identify each new version, and retain clear compatibility and migration notes. Users choose whether to download and install an update.

Submitting an issue does not modify Fecimus's release source or install an addon for anyone. The project does not automatically fetch or execute submissions. An optional contribution to Fecimus itself follows [CONTRIBUTING.md](../CONTRIBUTING.md).

## Keep it private

You do not need a GitHub account or submission to create, install, or change an addon locally. Local addons, edits and maintenance backups are not automatically uploaded. Public sharing requires a separate, explicit choice to publish. If you use a cloud model, files you ask it to read can still be included in that model host's conversation processing.
