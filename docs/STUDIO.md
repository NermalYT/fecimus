# Studio projects: code, Blender, and Unity

Fecimus can edit project files, inspect its own application windows, and supervise long commands while you use your desktop. Its private display solves cursor and focus conflicts. Application compatibility, graphics drivers, licenses, CPU/GPU contention, and project locking still determine what a particular workflow can do.

## Choose the interaction that fits the work

| Work | Fecimus approach | What must already exist |
| --- | --- | --- |
| Source edits, assets, configuration | Filesystem tools, then a build/test job | Project inside a configured file root |
| Blender scene generation or export | Blender background Python script in a job | Compatible Linux Blender installation and a reviewed script |
| Blender frame/animation render | Background render job; inspect output files and logs | Scene, output directory, suitable render device |
| Unity scripts, imports, tests, builds | Edit files; run a version-matched Linux Editor in batch mode when supported | Editor, modules, license, and a project copy not open elsewhere |
| GUI-only workflow | Launch the Linux app in Fecimus; observe, act, verify | App that works on the private X11 display |
| Native Windows Unity/Blender editor | Edit project files from WSL; use the native editor yourself | Host installation and a deliberate file handoff |

## Project locations and file roots

Linux filesystem tools include your real home directory by default. `FECIMUS_FILE_ROOTS` adds up to 16 absolute existing directories; paths are resolved against real filesystem locations, including symlinks. This is a file-tool boundary, not a restriction on everything a launched process can access.

For example, add this environment value to Fecimus's MCP launch entry after creating the directory:

```json
"FECIMUS_FILE_ROOTS": "[\"/mnt/projects/MyGame\"]"
```

Restart the Fecimus integration after changing its launch environment. This setting authorizes a path; it does not mount a disk or grant operating-system permissions. Mount a drive normally first, then use its actual mount path. Keep workspaces on storage that supports the application's required locking, filename case, permissions, and performance.

On Windows, the installer supplies the Linux home and your translated Windows user profile in the generated `wsl.exe` argument list. Add another Linux root by editing that existing `FECIMUS_FILE_ROOTS=[...]` argument while retaining the profile root if needed. With default WSL drive mounts, `C:\Projects\MyGame` corresponds to `/mnt/c/Projects/MyGame`; custom mounts require their real Linux path. Fecimus does not mount new drives. Microsoft's [WSL filesystem guidance](https://learn.microsoft.com/en-us/windows/wsl/filesystems) recommends the Linux filesystem for Linux command-line workloads; a separate clone there often avoids cross-filesystem build overhead.

Use separate working copies or Git worktrees when you and Fecimus edit the same project concurrently. Agree on an output directory and review the resulting diff/assets before importing them. Two independent cursors do not prevent competing saves to the same file. Keep Unity `Library`, `Temp`, and editor lock state separate between editor instances; do not open one project simultaneously in your editor and an Fecimus batch job.

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

## Blender example

Install a Linux Blender build that supports your architecture and scene version. First run `blender --version` as a job, then verify a small scene before committing substantial render time. Blender supports background rendering without an X server, and command argument order matters: output options precede the render action. [Blender command-line rendering](https://docs.blender.org/manual/en/4.5/advanced/command_line/render.html).

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

On 2026-09-09, Blender **4.5.13 LTS** was downloaded from Blender's official release server, checked against its published SHA-256, and exercised through Fecimus on **Linux Mint 22.3 x64 / Ubuntu 24.04 base**:

- A supervised background job used Cycles on the **CPU** to render a disposable factory cube scene at **64×64**, producing a PNG and saved `.blend` file with exit code 0.
- Blender opened that scene on Fecimus's isolated display. A fully painted screenshot showed the viewport, menus, outliner, and properties; observing the initial window alone was insufficient to establish that the interface had finished painting.
- Normal application window closure and background GUI-job cancellation were exercised, with no Blender processes left afterward.

This is evidence of a basic CPU-render and GUI workflow on that machine. Graphics acceleration was not measured. It does not certify GPU rendering, larger scenes, Unity licensing/build modules, commercial assets, or a native Windows/WSL graphics pipeline. The private profile used for this fixture also does not establish that a user's licensed application setup transfers automatically. See [performance and validation](PERFORMANCE.md) for the measured scope.

Repository tests separately cover job supervision, argument handling, bounded logs, cancellation, and private-display behavior with fixtures. Check a small job with your actual application version and project before describing that workflow as validated.
