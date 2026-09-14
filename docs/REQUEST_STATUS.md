# Request coverage and remaining limitations

This records the requested scope without equating a generic tool or launcher with universal compatibility.

| Request | Implementation / evidence | Remaining requirement or limit |
| --- | --- | --- |
| One Fecimus MCP switch | Six original components behind one host entry; 99 core tools, five advertised entry tools by default | Host permission prompts remain host settings |
| Faster agent workflow | Compact discovery, bounded browser batches, project tools, supervised jobs, optional local model workers | Reduced schema size is measured; model reasoning speed/quality is not guaranteed |
| Independent AI cursor | Separate Linux desktop, focus, clipboard and app profiles | Not a second cursor in the user's existing native app window |
| Background browsing while human works fullscreen | Headless Chromium with its own tabs, loaded-page extraction and full-page capture | Personal tabs/cookies and unrendered or protected content are not automatically available |
| Blender / coding / general studio workflows | File/Git tools, application launch, scripting and supervised commands; earlier Blender CPU/GUI check and v3 Godot 4.7.2 headless import/run/edit check | Apps, SDKs, licenses and GPU support are separate; production scenes and every app version are not certified |
| Roblox and Unity connections | Optional vendor MCP launcher addons in `examples`; manifest/gateway tests and setup guides | Live Studio/Editor connections and Windows interop remain unverified; vendor setup is required |
| Every studio app connected | Generic local stdio addon interface plus Linux process/GUI tools | No universal connector exists here; applications without a compatible interface need their own bridge and testing |
| All capabilities of this Codex/GPT agent | Practical local browser, desktop, files, commands, notes, workers, control panel and extensibility | Cannot transfer GPT weights/reasoning, Codex host internals, signed-in app permissions, hosted media services, automatic context compaction or durable scheduling |
| Windows 11 Pro and Ubuntu LTS/Mint | Separate named ZIP/tar archives, platform guards, readmes and launchers | Windows 11 physical/WSL install validation, ARM64 and every derivative remain unverified |
| Fresh one-click installer GUI | Native Linux GTK and Windows WPF setup windows; one launch opens guided install/upgrade | Extract first; OS prompts, sudo, initial WSL/user setup and model selection require user action |
| Easy addon installation | GUI folder picker, inspection and explicit trust/install; CLI/tool enable/disable/remove | Extract addon ZIP first; third-party dependencies are not installed automatically; restart to activate |
| Private conversational customization/upgrades | Source backup/check/restore; verified official-release prepare/apply; conflict checks and rollback | Model must follow the upgrade guide and restart service; dependency changes require separate review/setup |
| No public upload of private user modifications | Source updates and addons stay in the local data/source directories | A cloud model host may process files included in its conversation; public sharing is a separate choice |
| Formal GitHub and addon submission area | Public repository, source/docs/license/CI, community directory and submission form | Submitted addons are not automatically certified or executed |
| Compatible-model megalist | 38-candidate guide and catalog; synthetic tool-call checker | No real chat model is installed in the development environment; candidates are not Fecimus-certified |
| Windows 10 and other distros after 3.0 | Kept outside this release's support policy | Deferred as requested; requires separate implementation/validation |

Read [capability evidence](V3_CAPABILITY_AUDIT.md), [studio compatibility](STUDIO.md#studio-compatibility-matrix), [setup](SETUP.md), [models](MODELS.md), [private upgrades](UPGRADING.md) and [addons](ADDONS.md). A completed source release does not make the unverified or unavailable items above complete.
