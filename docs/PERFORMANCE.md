# Performance and validation

## Version 3.0 protocol overhead

On 2026-09-10, the actual MCP server returned 99 core tools in full mode. The serialized tool array was **54,949 UTF-8 bytes**, versus **2,337 bytes** for the five compact-mode entry tools: **95.75% less initial schema data**. This measures JSON bytes, not tokens, latency or model quality. Later discovery calls transfer the selected schemas; full mode remains available for hosts/models that work better with direct tool registration.

Version 3 adds project tools, persistent checkpoints, bounded local workers, and a local control panel. Tests use synthetic loopback model responses to verify tool orchestration, limits and cancellation. No chat model was installed for a real inference comparison; the 38-model guide is a researched candidate catalog, not a set of certified models. Windows CI validates portable code and installer mocks; it is not Windows 11/WSL hardware validation.

## Historical 2.1 measurements

Measured on 2026-09-09 using Node 22.23.2 on Linux Mint 22.3 x64 (Ubuntu 24.04 base). The baseline is Fecimus **v2.0.0**; the revised implementation is **v2.1.0**. These are local tool-call measurements, not a guarantee of model reasoning speed, production application load time, or rendering performance.

## Comparable tool timings

Three sequential disposable integration runs per version, on the same machine, with installed dependencies and local HTTP/X11 fixtures. Values are median successful call durations; some tools run twice per trial. Percentages describe latency change (negative is lower). Raw trials, including unchanged and slower operations, are available in [baseline data](performance-v2.0.json) and [v2.1.0 data](performance-v2.1.json).

| Operation | v2.0.0 | v2.1.0 | Latency change |
| --- | ---: | ---: | ---: |
| MCP startup/discovery | 704 ms | 576 ms | -18.2% |
| Fixture app launch response | 1836 ms | 69 ms | -96.2% |
| Window focus | 161 ms | 9 ms | -94.4% |
| Desktop screenshot | 199 ms | 103 ms | -48.2% |
| Single mouse click | 109 ms | 108 ms | -0.9% |
| Short keyboard input | 14 ms | 16 ms | +14.3% |
| Read background tabs | 160.5 ms | 160 ms | -0.3% |
| Scrape local pages | 220 ms | 220 ms | +0% |

Startup varied substantially: baseline trials were 2850, 704 and 695 ms; revised trials were 2784, 552 and 576 ms. Three trials do not establish statistical significance, and background load/cache state was not controlled. Millisecond-scale differences should not be read as reliable speedups.

The application-launch result measures a small test window. Fecimus now returns when it observes a window instead of always waiting about 1.8 seconds. A window can still be painting: the real Blender test below required a later observation. Focus similarly checks actual focus instead of imposing a fixed delay. Screenshot capture uses one combined image transformation. Gateway discovery reuses compiled argument validators.

## Fewer model round trips

`fecimus_desktop_state` combines window state, active window, screen/cursor metadata and an optional screenshot. `fecimus_desktop_actions` holds the desktop queue for up to 12 actions and a final optional screenshot. All argument schemas are checked first; application state or coordinate bounds can still fail during execution. A sequence stops on its first error and is never replayed automatically.

`fecimus_job_start` returns a job ID while builds, tests, renders and scripts continue. Status calls provide bounded logs and exit state; cancellation and timeout clean up the supervised process group. Default concurrency is two jobs and CPU scheduling priority is lowered where possible. These features reduce waiting between tool calls but do not increase model tokens per second or reserve CPU/GPU/memory for the user.

## Real Blender verification

Blender 4.5.13 LTS was downloaded from its official release server and SHA-256 verified. Through the live 84-tool MCP on the machine above:

- A factory cube scene rendered with Cycles on CPU at 64×64, producing a valid PNG and a saved `.blend`. Job start returned in 18 ms; reported job lifetime was 341 ms, exit 0.
- The GUI opened on Fecimus's private display; the full viewport, menus, outliner and properties were visually verified after about 10 seconds. The initial launch response alone did not establish application readiness.
- Private application HOME, ordinary window closure, background GUI-job cancellation and cleanup were verified. No Blender processes remained.

[Sanitized verification record](blender-verification.json) includes the official download/checksum URLs and output hashes. This small fixture does not benchmark larger scenes, GPU acceleration, Unity, or Windows/WSL graphics. Blender is not bundled or left installed by this check. See [studio instructions](STUDIO.md) for application and licensing requirements.

## Reproduce

Install the [integration-test prerequisites](../README.md#verification-and-contributing), then run on supported Linux or inside supported WSL2:

```bash
npm test
node scripts/benchmark.mjs --trials 3 --output dist/current.json
```

To compare another implementation, pass `--server /absolute/path/to/checkout/src/server.mjs` (that checkout needs its dependencies), save its report, then run the current version with `--baseline dist/baseline.json`. The current fixture uses only the shared v2.0.0 tool surface for comparable measurements. Its benchmark mode excludes the new job/batch checks; `npm test` includes them. `--trials` accepts 1–10. The JSON records samples, ranges and medians; it excludes private profile paths.

The historical v2.1 automated suite covered 14 suites: API/unit tests, actual local browser/desktop integration and process lifecycle. GitHub CI runs Linux/Windows unit tests on Node 22/24, Windows installer mocks, Linux integration, and both package formats. CI checks on Windows do not establish a Windows 11 Pro hardware/WSL end-to-end run. Live model inference, native Windows GUI automation, Unity builds and GPU acceleration have not been validated.
