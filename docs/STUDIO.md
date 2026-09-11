# Studio projects: code, Blender, Unity and local workers

Fecimus can edit project files, inspect its own application windows, and supervise long commands while you use your desktop. Its private display separates AI input from your desktop. In default compact mode, retrieve the schemas below with `fecimus_tools`, then invoke them through `fecimus_call`; full mode exposes the same tools directly. Application compatibility, graphics drivers, licenses, CPU/GPU contention, and project locking still determine what a particular workflow can do.

## Choose the interaction that fits the work

| Work | Fecimus approach | What must already exist |
| --- | --- | --- |
| Source edits, assets, configuration | Project search/read/hash-checked edit, Git review, then a build/test job | Project inside a configured file root |
| Blender scene generation or export | Blender background Python script in a job | Compatible Linux Blender installation and a reviewed script |
| Blender frame/animation render | Background render job; inspect output files and logs | Scene, output directory, suitable render device |
| Unity scripts, imports, tests, builds | Edit files; run a version-matched Linux Editor in batch mode when supported | Editor, modules, license, and a project copy not open elsewhere |
| GUI-only workflow | Launch the Linux app in Fecimus; observe, act, verify | App that works on the private X11 display |
| Native Windows Unity/Blender editor | Edit project files from WSL; use the native editor yourself | Host installation and a deliberate file handoff |

## Project locations and file roots

Linux filesystem tools include your real home directory by default. `FECIMUS_FILE_ROOTS` adds up to 16 absolute existing directories; the existing file guard checks real filesystem locations. The new project read/edit tools additionally refuse every symlink component. This is a file-tool boundary, not a restriction on everything a launched process can access.

For example, add this environment value to Fecimus's MCP launch entry after creating the directory:

```json
"FECIMUS_FILE_ROOTS": "[\"/mnt/projects/MyGame\"]"
```

Restart the Fecimus integration after changing its launch environment. This setting authorizes a path; it does not mount a disk or grant operating-system permissions. Mount a drive normally first, then use its actual mount path. Keep workspaces on storage that supports the application's required locking, filename case, permissions, and performance.

On Windows, the installer supplies the Linux home and your translated Windows user profile in the generated `wsl.exe` argument list. Add another Linux root by editing that existing `FECIMUS_FILE_ROOTS=[...]` argument while retaining the profile root if needed. With default WSL drive mounts, `C:\Projects\MyGame` corresponds to `/mnt/c/Projects/MyGame`; custom mounts require their real Linux path. Fecimus does not mount new drives. Microsoft's [WSL filesystem guidance](https://learn.microsoft.com/en-us/windows/wsl/filesystems) recommends the Linux filesystem for Linux command-line workloads; a separate clone there often avoids cross-filesystem build overhead.

Use separate working copies or Git worktrees when you and Fecimus edit the same project concurrently. Agree on an output directory and review the resulting diff/assets before importing them. Two independent cursors do not prevent competing saves to the same file. Keep Unity `Library`, `Temp`, and editor lock state separate between editor instances; do not open one project simultaneously in your editor and an Fecimus batch job.

## Inspect, edit and verify a project

Read project instructions and current repository state before modifying files. `fecimus_project_search` finds relevant text; `fecimus_project_read` returns a line range and the SHA-256 of the **complete original file bytes**. Pass that returned hash to `fecimus_project_edit` with one unique literal `old_text` and its replacement `new_text`. The replacement is not a regular expression: `$`, backslashes and parentheses remain literal text.

| Tool | Useful arguments and limits |
| --- | --- |
| `fecimus_project_search` | Required `root` and `query`; optional `regex`, `glob`, `max_results`, `max_chars`. Default literal search, 100 matches and 12,000 output characters; maximum 500 matches and 40,000 characters. Glob supports `*`, `**` and `?`. |
| `fecimus_project_read` | Required `path`; optional `start_line`, `line_count`, `max_chars`. Defaults to 200 lines/20,000 characters; maximum 1,000 lines/40,000 characters. Returns the full-file hash even when the selected view is clipped. |
| `fecimus_project_edit` | Required `path`, `expected_sha256`, `new_text`; existing files also require one unique `old_text`. Use `expected_sha256:"absent"` and omit `old_text` to create a missing file. Parent directory must already exist. |
| `fecimus_git_status` | Required `root`; `diff:true` adds staged and unstaged diffs. Combined default output limit is 16,000 characters, maximum 40,000. Does not stage, commit or reset. |

Project reads/edits accept regular UTF-8 files up to 2 MiB; replacement inputs are limited to 262,144 characters each. Original line endings and unchanged text are retained. Binary `.blend` files and generated build outputs should be manipulated through the appropriate application, not text replacement.

If another editor changes the file, an old hash fails. Fecimus rechecks both content and file metadata immediately before an atomic replacement, and exclusive creation refuses an existing destination. This catches ordinary competing saves, including simultaneous calls in the same server. It **cannot perform operating-system atomic compare-and-swap against an external writer** during the final check-to-rename gap. Use separate working copies for concurrent development; a rejected edit requires a fresh read and a new reviewed change, never a blind retry.

Search skips hidden paths, `.env` files and common private/generated directories such as `private`, `node_modules`, `Library`, `Temp`, `build` and `dist`. Individual files are limited to 2 MiB. Ripgrep searches have a five-second deadline. If `rg` is absent, a bounded Node literal fallback is used; it explicitly reports that it does not interpret `.gitignore`. Regex search requires installing optional ripgrep in Linux/WSL (`sudo apt-get install ripgrep`). Partial searches and clipped line excerpts are flagged in results.

Review `fecimus_git_status` with `diff:true`, then run the project's actual tests/build using a job. Check expected artifacts and visual output where appropriate before reporting completion.

## Save a checkpoint for the next session

`fecimus_workspace_notes` supports `list`, `read`, `write` and `delete` for an existing project directory. Create a new key without `revision`; read/list first and include the current revision to update or delete it. A stale revision fails without overwriting the stored note.

Example arguments for a new checkpoint:

```json
{
  "action": "write",
  "project": "/home/yourname/Projects/Game",
  "key": "next-session",
  "kind": "checkpoint",
  "title": "Movement controller progress",
  "content": "Adjusted walk speed. Unit tests passed. Next: inspect diagonal movement in the editor."
}
```

On the next start, explicitly list/read that project's checkpoint before continuing. Notes live under Fecimus's private data directory in `workspace-notes`, independently of chat history and source versions. Each project allows 256 notes/checkpoints with at most 64 KiB UTF-8 content each. They are reference data, not automatic instructions; they do not restore a running process, agent context or application session. Save only information the user intends to retain.

## Discover installed applications

Call `fecimus_app_probe` with `apps:["blender","unity","godot","git","node","python"]`, or give an absolute `executable` path. It checks PATH locations and bounded version queries for known applications. An explicit executable is inspected without execution unless you also supply its `app` kind. Unity is always inspected without launching it, accepting a license or opening a project. Finding an executable does not establish its project, license or GPU compatibility.

## Long-running jobs

All three tools remain behind the single Fecimus integration:

| Tool | Arguments and behavior |
| --- | --- |
| `fecimus_job_start` | Required `command` and existing `cwd`; optional `args` array, `label`, and `timeout_ms` from 1,000 to 86,400,000 (default 900,000). Returns a job ID without waiting for completion. |
| `fecimus_job_status` | Supply `job_id` for state and bounded logs. Use `cursor` and `max_chars` (1–20,000, default 8,000) for subsequent output. Omit `job_id` to list recent jobs. |
| `fecimus_job_cancel` | Supply `job_id` to stop that job's process group. Check status afterward. |

Start arguments are passed directly to the executable. They are not shell command text: `&&`, pipes, wildcards, `$HOME`, and `~` inside arguments are not expanded. Use absolute paths or paths relative to `cwd`. A supplied shell script can intentionally perform more complex work, with all the permissions of your account.

Jobs have no interactive terminal and their standard input is closed. Complete application account/license setup beforehand, and use the application's appropriate noninteractive options for batch commands.

The supervisor defaults to two running jobs, retains 32 jobs in memory, and bounds each retained log to 131,072 JavaScript characters. Truncated output is reported; save full application logs to a project file when needed. The default timeout is 15 minutes. Jobs are tied to the active Fecimus server and are stopped on its shutdown; they are not durable scheduled tasks. Cancellation does not undo files already written. Deliberately detached processes can escape a process group; the supervisor is not a security sandbox.

The job guardian attempts to raise the niceness value by 5 so jobs have lower CPU scheduling priority; the actual `cpu_nice` value is reported. Memory, disk, and GPU limits are not enforced. Reduce application thread counts, render samples, or concurrent jobs when they compete with your work or model inference.

To change the concurrency limit, set `studio.max_concurrent_jobs` to an integer from 1 to 16 in Fecimus's settings file (normally `~/.local/share/fecimus/settings.json`, or the path selected by `FECIMUS_SETTINGS`), then restart Fecimus. For example:

```json
{"studio":{"max_concurrent_jobs":1}}
```

Merge that field into existing settings rather than replacing unrelated desktop/browser settings.

Job processes use Fecimus's private display and application home/profile. Use `cwd` for the project; do not assume a job's `HOME` is your personal home or that its Git/SSH credentials and application preferences are inherited. Apps that store licenses/preferences per home may need configuration in Fecimus's own profile. Avoid copying an entire personal home into it.

After `fecimus_job_start`, poll `fecimus_job_status` at a sensible interval and inspect the exit status, logs, and expected output files. A zero exit status does not establish that an image is correct or a game build works. Never automatically repeat an action whose result is uncertain.

## Optional local model workers

`fecimus_agent_start` is a model/tool loop, distinct from a process job. It is optional: normal MCP use keeps your host in charge and does not require a separate API server. To start a local worker, run the LM Studio API with the chosen model available and reachable from Fecimus at a loopback `/v1` endpoint. Default: `http://127.0.0.1:1234/v1`. The runner attaches no API key, so an endpoint requiring authentication is not supported. It rejects remote hosts, embedded credentials and redirects. Windows/WSL has an [additional localhost networking requirement](PLATFORMS.md#optional-local-model-api-on-windows).

Discover the schemas of the tools you want to allow. Then call `fecimus_agent_start`, for example with these arguments for a read-only inspection:

```json
{
  "model": "YOUR_EXACT_LOADED_MODEL_ID",
  "objective": "Inspect /home/yourname/Projects/Game and report its current Git changes. Do not edit files.",
  "allowed_tools": ["fecimus_git_status", "fecimus_project_read", "fecimus_project_search"],
  "max_turns": 6,
  "timeout_ms": 180000,
  "vision": false
}
```

Use `fecimus_agent_status` with the returned `agent_id`; omit it to list recent workers. `fecimus_agent_cancel` requests cancellation. Workers share Fecimus's desktop and files, so use separate project copies and avoid simultaneous GUI actions. Tool whitelists control the tools offered to the worker; authorizing a general shell or job tool also authorizes that tool's broad capability. Starting the worker delegates that whitelist for the run: its internal tool calls do not request a fresh approval from your MCP host on every dispatch. The whitelist is not a sandbox.

| Limit | Default and maximum |
| --- | --- |
| Concurrent workers | 2; setting `agents.max_concurrent` permits 1 or 2 |
| Model turns | 8 by default; 1–30 |
| Output tokens per turn | 1,024 by default; 128–8,192 |
| Overall runtime | 15 minutes by default; maximum 15 minutes |
| Each model request | 120 seconds by default; maximum 120 seconds |
| Serialized context | 256 KiB by default; maximum 2 MiB; byte limit is not a model token-window guarantee |
| Tool whitelist | 1–32 explicit tool names; no recursive agent/control/discovery dispatch |
| Retained progress | 32 runs and 32,768 log characters per run, in memory |

The runner validates a complete model tool-call response before dispatch, executes approved calls sequentially, and stops on invalid calls, tool errors, context overflow or exhausted budgets. It does not silently drop history or retry uncertain actions. `vision:true` requires a model/runtime that accepts image observations; the default is text-only. A final model report is not independent proof that its claims are correct.

Cancellation aborts the model request and the current tool signal, but an already dispatched action may finish. Check `in_flight_tool` and actual project state. Workers end with Fecimus and cannot resume after restart; saving a note is a separate explicit step. This feature is not a durable scheduler. Simulated local-server tests validate the loop's protocol and limits, not a real model's task performance.

## Observe and stop work

Call `fecimus_control_panel` and open its private local link. Its optional two-second screenshot viewer is read-only and stops polling while hidden. Pause blocks new controlled calls; already running jobs/model requests may continue. Stop additionally requests cancellation of active calls, jobs and workers. It does not roll back files or enforce a security/resource boundary. Keep the session link private and inspect actual state before restarting interrupted work.

Desktop observation currently uses screenshots, window metadata and grounded coordinates. A native AT-SPI/accessibility-semantic bridge is **not implemented**. Browser DOM snapshots are a separate capability. Custom editor canvases and unpainted/minimized native windows still need application-specific handling.

## Blender example

Install a Linux Blender build that supports your architecture and scene version. Use `fecimus_app_probe` to inspect the installation/version, then verify a small scene before committing substantial render time. Blender supports background rendering without an X server, and command argument order matters: output options precede the render action. [Blender command-line rendering](https://docs.blender.org/manual/en/4.5/advanced/command_line/render.html).

Example `fecimus_job_start` arguments, using a project and output directory that already exist:

```json
{
  "command": "blender",
  "args": ["--background", "scene.blend", "--render-output", "//renders/frame_#####", "--render-format", "PNG", "--render-frame", "1"],
  "cwd": "/home/yourname/Projects/Scene",
  "timeout_ms": 3600000,
  "label": "Render scene frame 1"
}
```

For a reviewed automation script, use `args: ["--background", "scene.blend", "--python", "scripts/build_scene.py"]`. Keep generated `.blend` files, renders, and export files in the project output directory. This is a template, not evidence that Blender was installed or benchmarked on your computer.

Cycles GPU rendering depends on Blender's build, selected device, driver, and hardware. CUDA/OptiX, HIP, and oneAPI have different support requirements. Configure the device for the job's own profile or explicitly in the script, and check Blender's logs for the device actually used. Rendering on the same GPU as the model or display can reduce responsiveness and exhaust memory. [Blender GPU rendering](https://docs.blender.org/manual/en/4.5/render/cycles/gpu_rendering.html).

## Unity example and boundaries

Unity 6.0 documents Ubuntu 22.04/24.04 on x86-64, supported Nvidia/AMD graphics, and GNOME with X11 or Wayland. Its Editor requirements exclude emulation, containers, and compatibility layers. These requirements do not certify Fecimus's XFCE/Xvfb display, ARM64 Linux, or WSL2. Fecimus working on a Linux Mint host does not establish official Unity Editor support there. Consult the exact Editor version's [system requirements](https://docs.unity3d.com/6000.0/Documentation/Manual/system-requirements.html).

Fecimus does not install Unity Hub, Editor versions, modules, or licenses. Supply the path of a separately installed Linux Editor and a project copy that matches it. A batch job may use:

```json
{
  "command": "/absolute/path/to/Unity/Editor/Unity",
  "args": ["-batchmode", "-nographics", "-quit", "-projectPath", "/home/yourname/Projects/Game-Fecimus", "-executeMethod", "BuildAutomation.Build", "-logFile", "/home/yourname/Projects/Game-Fecimus/build.log"],
  "cwd": "/home/yourname/Projects/Game-Fecimus",
  "timeout_ms": 3600000,
  "label": "Run project build method"
}
```

`BuildAutomation.Build` is a placeholder for an existing public static Editor method in that project. `-nographics` avoids graphics-device initialization; it cannot validate rendered scenes or GPU-dependent baking. Unity also prevents simultaneous Editor instances from opening the same project. [Unity command-line arguments](https://docs.unity3d.com/6000.0/Documentation/Manual/EditorCommandLineArguments.html).

A practical Windows workflow is for Fecimus to prepare code/assets in a separate project copy and for you to import or build them in the supported native Windows Editor. Calling a Windows executable through WSL does not create an independent Windows desktop and is outside Fecimus's isolated GUI guarantee.

## Graphics and validation

Xvfb renders into a virtual framebuffer and can run without physical display hardware or input devices. It is not a GPU passthrough or 3D acceleration layer. A particular application might expose software OpenGL, fail to initialize graphics, or require another environment. Background compute that can reach a compatible GPU is a separate capability and must be verified on the actual machine. [X.Org Xvfb manual](https://www.x.org/archive/X11R7.5/doc/man/man1/Xvfb.1.html).

For the **Fecimus 2.1.0 release**, on 2026-09-09, Blender **4.5.13 LTS** was downloaded from Blender's official release server, checked against its published SHA-256, and exercised through Fecimus on **Linux Mint 22.3 x64 / Ubuntu 24.04 base**:

- A supervised background job used Cycles on the **CPU** to render a disposable factory cube scene at **64×64**, producing a PNG and saved `.blend` file with exit code 0.
- Blender opened that scene on Fecimus's isolated display. A fully painted screenshot showed the viewport, menus, outliner, and properties; observing the initial window alone was insufficient to establish that the interface had finished painting.
- Normal application window closure and background GUI-job cancellation were exercised, with no Blender processes left afterward.

This historical fixture is evidence of a basic CPU-render and GUI workflow on that machine; it is not a fresh 3.0 application benchmark. Graphics acceleration was not measured. It does not certify GPU rendering, larger scenes, Unity licensing/build modules, commercial assets, or a native Windows/WSL graphics pipeline. The private profile used for this fixture also does not establish that a user's licensed application setup transfers automatically. See [performance and validation](PERFORMANCE.md) for the measured scope.

Repository tests separately cover job supervision, argument handling, bounded logs, cancellation, and private-display behavior with fixtures. Check a small job with your actual application version and project before describing that workflow as validated.

## Studio compatibility matrix

A generic process launcher is not a dedicated integration with every editor. These are the actual routes available in 3.0.0; install the application's supported version separately and verify a disposable project before production work.

| Studio / work | Available route | Validation / gap |
| --- | --- | --- |
| Blender | Linux background Python/render jobs; private desktop GUI | Earlier 4.5.13 CPU render/scene checks; GPU and every Blender version are not certified |
| Unity | C# / asset / config edits; Linux Editor batch jobs; optional Unity CLI MCP addon | No live Unity build certification; vendor OS, graphics and license requirements apply |
| Godot | Project/GDScript/C# edits; Linux headless jobs and editor launch | Example below; no live Godot validation in this release |
| Unreal Engine | Source/config edits; user-supplied Linux build/cook commands | SDK, Linux Editor, GPU and project setup required; no Unreal automation plugin or live validation bundled |
| Roblox Studio | Luau/text edits; optional official Studio MCP launcher addon | Experimental Windows/WSL2 bridge template; no live Studio validation |
| Code editors / build systems | File tools, Git inspection and jobs for installed compilers/test runners | Run each project's real tests; no blanket language/toolchain certification |
| Audio, video, CAD and other studio apps | Installed Linux CLI/scripting interface or compatible private X11 window | App-by-app verification required; native Windows/macOS-only GUIs need a separate bridge |

[Roblox Studio's official setup guide](https://create.roblox.com/docs/studio/setup) specifies Windows and macOS. Installing Fecimus under WSL2 does not make Roblox Studio a Linux application. The optional [Roblox Studio addon](../examples/roblox-studio-addon/README.md) supplies a launcher for Roblox's built-in MCP interface on Windows through WSL2. Its live interoperability remains unvalidated; it does not control native windows through Fecimus's private cursor. Do not use text replacement on binary `.rbxl` assets. Export scripts/text through the application's supported workflow and let the user import/review changes. Publishing requires a separate explicit user action.

[Godot's command-line interface](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html) provides headless execution. For an installed matching editor and an existing project, a bounded import job can use `command:"godot"`, `args:["--headless","--path","/absolute/project","--editor","--quit"]`, and that project as `cwd`. Match flags to the installed version; exit code and logs must be checked. This is an invocation template, not a completed compatibility test.

To integrate another studio, write a [local addon](ADDONS.md) around its supported SDK/CLI, declare dependencies and tested versions, validate arguments, and include a small create/read/change/export verification project. Addons can add tool interfaces; they cannot supply vendor licenses, unsupported operating-system support, model reasoning quality or a security sandbox.

## Optional vendor studio addons

The release includes [Roblox Studio](../examples/roblox-studio-addon/README.md) and [Unity CLI](../examples/unity-cli-addon/README.md) launcher manifests. Configure the vendor application first, then install the chosen folder through **Install addon…**. Both remain behind `mcp/fecimus`; vendor software, credentials and licenses are separate. Read each addon's prerequisites and unverified platform boundaries before use. These templates are not evidence that every studio is connected.
