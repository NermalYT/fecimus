# Fecimus model compatibility and selection

Verified against publisher and LM Studio documentation on **September 9, 2026**. The catalog contains **38 exact model variants: 35 with documented LM Studio GGUF/tool support and 3 newer candidates**. **None is labeled as tested with Fecimus.** Read the status definitions before interpreting this as a compatibility guarantee.

Fecimus is model-independent: an MCP-capable host connects the model to Fecimus, supplies tool definitions, parses calls, runs tools, and returns their results. A model is usable when that whole loop works. Installing Fecimus does not add tool training, image understanding, or a missing chat-template parser to a model. There is no model allowlist; a model absent from this guide can qualify using the evaluation below.

## Pick a starting point

These are practical evaluation priorities, not measured Fecimus rankings. Hardware bands assume an appropriate quantization, a modest context, and additional system RAM. They are starting points for measurement, **not minimum VRAM promises**.

| Your situation | Evaluate first | Also consider |
| --- | --- | --- |
| About 6 GB VRAM; want images and tools | [Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B), starting with a supported 4-bit GGUF | [Ministral 3 3B Instruct](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512); [Gemma 4 E2B](https://huggingface.co/google/gemma-4-E2B-it) if it fits with image/context overhead |
| About 6 GB VRAM; mostly scraping and text | [Granite 4.1 3B](https://huggingface.co/ibm-granite/granite-4.1-3b) or [Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) | Use text snapshots/extraction; request screenshots only with a vision-capable model |
| About 8–16 GB VRAM | [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B) | [Ministral 3 8B/14B](https://lmstudio.ai/models/ministral), [Gemma 4 12B](https://huggingface.co/google/gemma-4-12B-it); [gpt-oss-20b](https://developers.openai.com/api/docs/models/gpt-oss-20b) for text tools when memory permits |
| About 24–32 GB VRAM or a capable offload setup | [Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B) | [Qwen3.6-35B-A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B), [Gemma 4 26B A4B/31B](https://lmstudio.ai/models/gemma-4) |
| Coding with substantial memory | [Qwen3-Coder-Next](https://huggingface.co/Qwen/Qwen3-Coder-Next) | [Qwen3-Coder-30B-A3B-Instruct](https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct) for a smaller package; neither reads screenshots |
| Large workstation | [gpt-oss-120b](https://developers.openai.com/api/docs/models/gpt-oss-120b) or [Nemotron 3 Super](https://lmstudio.ai/models/nemotron-3-super) for text workflows | Large weights and context need substantially more memory than active-parameter labels suggest |

The priorities combine publisher-documented capabilities with model scale and LM Studio availability. They do not establish that one family beats another on your browser, languages, or task. Qwen3.8 is a current larger general-purpose candidate; the smaller Qwen3.5 variants remain useful where memory is the constraint. [Qwen3.8 model card](https://huggingface.co/Qwen/Qwen3.8-27B), [LM Studio Qwen3.5 catalog](https://lmstudio.ai/models/qwen3.5).

## What “compatible” means

| Status | Evidence | What still needs checking |
| --- | --- | --- |
| **Documented** | Publisher/runtime documents tool use; LM Studio lists a GGUF version | Exact downloaded revision, quantization, chat template, parser, model settings, and Fecimus workflow |
| **Candidate** | Publisher documents tool use | Exact LM Studio GGUF package/parser, then the complete Fecimus workflow |
| **Fecimus tested** | A reproducible local report for an exact configuration | This release contains no such model reports yet |

LM Studio distinguishes native tool formats from its default fallback. A native tool badge is a useful signal; successful plain chat is insufficient. A fallback can expose tools to additional models, but does not establish reliable execution. [LM Studio tool-use documentation](https://lmstudio.ai/docs/developer/openai-compat/tools).

For these operating systems choose **GGUF with a supported llama.cpp runtime**. MLX packages are for Apple Silicon and are outside this project's platform scope. A Hugging Face publisher card often contains Safetensors/BF16/FP8 weights; the linked LM Studio catalog is the route to its runnable GGUF conversion. Do not assume a filename ending in GGUF proves that the installed runtime supports its architecture. [LM Studio runtime overview](https://lmstudio.ai/docs/app), [model downloads](https://lmstudio.ai/docs/app/basics/download-model).

**Background browsing does not require a vision model.** DOM snapshots and extracted page text are text; text-only tool models can use them. Screenshot interpretation needs both a vision-capable model and image support in the host/runtime. Video/audio in a publisher card does not imply those modalities work through Fecimus or that LM Studio exposes them in the same way. Browser isolation and background execution are tool capabilities; changing the model cannot create a second system mouse.

## Catalog: documented tools and image input

Every row has documented tool and image capabilities plus a LM Studio GGUF listing. All remain **untested with Fecimus**. Model names link to the publisher; “Runtime” links to LM Studio. Small/medium/large/workstation are relative selection tiers, not RAM requirements.

| Exact model | Scale tier | Suggested evaluation use | LM Studio evidence |
| --- | --- | --- | --- |
| [Qwen3.5-2B](https://huggingface.co/Qwen/Qwen3.5-2B) | small | Prototyping; restricted simple tasks | [Runtime](https://lmstudio.ai/models/qwen3.5) |
| [Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B) | small | First small multimodal model to evaluate | [Runtime](https://lmstudio.ai/models/qwen3.5) |
| [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B) | medium | Everyday browser and document tasks | [Runtime](https://lmstudio.ai/models/qwen3.5) |
| [Qwen3.5-27B](https://huggingface.co/Qwen/Qwen3.5-27B) | large | Earlier dense alternative | [Runtime](https://lmstudio.ai/models/qwen3.5) |
| [Qwen3.5-35B-A3B](https://huggingface.co/Qwen/Qwen3.5-35B-A3B) | large | Earlier sparse alternative | [Runtime](https://lmstudio.ai/models/qwen3.5) |
| [Qwen3.6-27B](https://huggingface.co/Qwen/Qwen3.6-27B) | large | Dense alternative to Qwen3.8 | [Runtime](https://lmstudio.ai/models/qwen3.6) |
| [Qwen3.6-35B-A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B) | large | Sparse model for repeated tool workflows | [Runtime](https://lmstudio.ai/models/qwen3.6) |
| [Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B) | large | First larger general-purpose model to evaluate | [Runtime](https://lmstudio.ai/models/qwen3.8) |
| [gemma-4-E2B-it](https://huggingface.co/google/gemma-4-E2B-it) | small | Small multimodal alternative; effective parameter label | [Runtime](https://lmstudio.ai/models/gemma-4) |
| [gemma-4-E4B-it](https://huggingface.co/google/gemma-4-E4B-it) | medium | Larger small multimodal alternative; effective parameter label | [Runtime](https://lmstudio.ai/models/gemma-4) |
| [gemma-4-12B-it](https://huggingface.co/google/gemma-4-12B-it) | medium | Unified multimodal model | [Runtime](https://lmstudio.ai/models/gemma-4) |
| [gemma-4-26B-A4B-it](https://huggingface.co/google/gemma-4-26B-A4B-it) | large | Sparse multimodal alternative | [Runtime](https://lmstudio.ai/models/gemma-4) |
| [gemma-4-31B-it](https://huggingface.co/google/gemma-4-31B-it) | large | Dense multimodal alternative | [Runtime](https://lmstudio.ai/models/gemma-4) |
| [Ministral-3-3B-Instruct-2512](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512) | small | Direct responses | [Runtime](https://lmstudio.ai/models/ministral) |
| [Ministral-3-3B-Reasoning-2512](https://huggingface.co/mistralai/Ministral-3-3B-Reasoning-2512) | small | Reasoning-heavy visual tasks | [Runtime](https://lmstudio.ai/models/ministral) |
| [Ministral-3-8B-Instruct-2512](https://huggingface.co/mistralai/Ministral-3-8B-Instruct-2512) | medium | Direct responses | [Runtime](https://lmstudio.ai/models/ministral) |
| [Ministral-3-8B-Reasoning-2512](https://huggingface.co/mistralai/Ministral-3-8B-Reasoning-2512) | medium | Reasoning-heavy visual tasks | [Runtime](https://lmstudio.ai/models/ministral) |
| [Ministral-3-14B-Instruct-2512](https://huggingface.co/mistralai/Ministral-3-14B-Instruct-2512) | medium | Direct responses | [Runtime](https://lmstudio.ai/models/ministral) |
| [Ministral-3-14B-Reasoning-2512](https://huggingface.co/mistralai/Ministral-3-14B-Reasoning-2512) | medium | Reasoning-heavy visual tasks | [Runtime](https://lmstudio.ai/models/ministral) |
| [GLM-4.6V-Flash](https://huggingface.co/zai-org/GLM-4.6V-Flash) | medium | 9B visual tool-use alternative | [Runtime](https://lmstudio.ai/models/glm-4.6v-flash) |
| [Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16](https://huggingface.co/nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16) | large | Multimodal documents and browser workflows | [Runtime](https://lmstudio.ai/models/nemotron-3-omni) |

## Catalog: documented text tools

These models can work with browser text, accessibility/DOM snapshots, files, and tool results. They **cannot directly interpret screenshot pixels**. All remain **untested with Fecimus**.

| Exact model | Scale tier | Suggested evaluation use | LM Studio evidence |
| --- | --- | --- | --- |
| [granite-4.1-3b](https://huggingface.co/ibm-granite/granite-4.1-3b) | small | Text extraction and structured tool workflows | [Runtime](https://lmstudio.ai/models/granite-4.1) |
| [granite-4.1-8b](https://huggingface.co/ibm-granite/granite-4.1-8b) | medium | Text extraction and structured tool workflows | [Runtime](https://lmstudio.ai/models/granite-4.1) |
| [granite-4.1-30b](https://huggingface.co/ibm-granite/granite-4.1-30b) | large | Text extraction and structured tool workflows | [Runtime](https://lmstudio.ai/models/granite-4.1) |
| [gpt-oss-20b](https://developers.openai.com/api/docs/models/gpt-oss-20b) | medium | Text tools and reasoning; Harmony template | [Runtime](https://lmstudio.ai/models/gpt-oss) |
| [gpt-oss-120b](https://developers.openai.com/api/docs/models/gpt-oss-120b) | workstation | Text tools and reasoning; Harmony template | [Runtime](https://lmstudio.ai/models/gpt-oss) |
| [Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) | small | Direct text tool workflows | [Runtime](https://lmstudio.ai/models/qwen3) |
| [Qwen3-4B-Thinking-2507](https://huggingface.co/Qwen/Qwen3-4B-Thinking-2507) | small | Reasoning-heavy text tasks | [Runtime](https://lmstudio.ai/models/qwen3) |
| [Qwen3-30B-A3B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507) | large | Direct text tool workflows | [Runtime](https://lmstudio.ai/models/qwen3) |
| [Qwen3-30B-A3B-Thinking-2507](https://huggingface.co/Qwen/Qwen3-30B-A3B-Thinking-2507) | large | Reasoning-heavy text tasks | [Runtime](https://lmstudio.ai/models/qwen3) |
| [Qwen3-Coder-30B-A3B-Instruct](https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct) | large | Coding and browser tools through text | [Runtime](https://lmstudio.ai/models/qwen3-coder) |
| [Qwen3-Coder-Next](https://huggingface.co/Qwen/Qwen3-Coder-Next) | workstation | 80B total / 3B active coding model | [Runtime](https://lmstudio.ai/models/qwen3-coder-next) |
| [GLM-4.7-Flash](https://huggingface.co/zai-org/GLM-4.7-Flash) | large | 30B-class sparse coding alternative | [Runtime](https://lmstudio.ai/models/glm-4.7) |
| [NVIDIA-Nemotron-3-Nano-30B-A3B-BF16](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16) | large | 30B-class sparse text reasoning | [Runtime](https://lmstudio.ai/models/nemotron-3) |
| [NVIDIA-Nemotron-3-Super-120B-A12B-BF16](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16) | workstation | 120B total / 12B active text reasoning | [Runtime](https://lmstudio.ai/models/nemotron-3-super) |

## Recent candidates: runtime verification required

Granite 4.2 has publisher-documented reasoning and tool use. An exact LM Studio GGUF/parser combination was not established in this review. These entries are a watchlist, not confirmed LM Studio compatibility.

| Exact model | Scale tier | Suggested evaluation use | LM Studio evidence |
| --- | --- | --- | --- |
| [granite-4.2-3b](https://huggingface.co/ibm-granite/granite-4.2-3b) | small | Recent reasoning/tool release; verify runtime parser | Unverified |
| [granite-4.2-8b](https://huggingface.co/ibm-granite/granite-4.2-8b) | medium | Recent reasoning/tool release; verify runtime parser | Unverified |
| [granite-4.2-30b](https://huggingface.co/ibm-granite/granite-4.2-30b) | large | Recent reasoning/tool release; verify runtime parser | Unverified |

## Names, variants, and exclusions

- **Gemma 4 E2B/E4B use effective parameter names.** Their full weights include larger embedding tables; E2B is not an ordinary two-billion-parameter memory estimate. Gemma 4 has five size classes, including 12B Unified. Choose the instruction-tuned `-it` variant. [Google model card](https://ai.google.dev/gemma/docs/core/model_card_4).
- **MoE active parameters describe computation, not total weight storage.** A 35B-A3B or 80B/3B model still needs storage and memory arrangements for its much larger total weights. Use the package size and runtime memory estimate. [Qwen3-Coder-Next architecture](https://huggingface.co/Qwen/Qwen3-Coder-Next).
- **gpt-oss is text-only.** Its native tool use depends on a correct Harmony-aware host/runtime, which LM Studio documents. [OpenAI gpt-oss-20b](https://developers.openai.com/api/docs/models/gpt-oss-20b), [LM Studio gpt-oss](https://lmstudio.ai/models/gpt-oss).
- **Qwen3.5-2B is a prototyping option.** Its publisher scopes the small model toward research, development, and specialization. Use the 4B or larger variant as the initial general-purpose candidate when it fits. [Publisher card](https://huggingface.co/Qwen/Qwen3.5-2B).
- **`qwen3.5-4b-uncensored-hauhaucs-aggressive` is not the canonical Qwen release.** Its local display name does not identify the exact repository revision, quantization, or preserved tool template. Treat it as an independent candidate. A malformed JSON result is evidence of that failed call, not proof that every original Qwen3.5-4B configuration fails. Compare it against the original under identical settings; keep the derivative only if its measured results justify it.
- **Base/pretraining models, embeddings, OCR-only models, and safety classifiers are excluded as primary agents.** Specialized function models also need the intended fine-tuning and host integration. A family name or ability to print JSON is insufficient evidence of general tool competence.
- **Older Qwen2.5 and Llama instruct variants may still work.** LM Studio documents examples, but they are omitted from the current shortlist to avoid padding it with every historical size. [Native-tool examples](https://lmstudio.ai/docs/developer/openai-compat/tools).

Fecimus's license does not license the model weights. Consult each linked publisher card for its own terms. Models and conversions are not redistributed by this guide.

## Faster operation without hiding failures

1. **Establish one known-good model/template pair.** Update to a runtime that supports the downloaded architecture; prefer the host's native tool integration. Preserve its role and tool delimiters.
2. **Choose a quantization that leaves headroom.** A supported 4-bit package is a reasonable starting point; move to higher precision if memory permits and evaluation improves. Model weights, KV cache, image processing, the browser, and the OS all need memory. A download size is not peak VRAM. [LM Studio quantization guidance](https://lmstudio.ai/docs/app/basics/download-model).
3. **Keep the first workload short.** An isolated synthetic tool-call check can start at 8K context. The full 79-tool Fecimus catalog needs substantially more room: start with 16K–32K if memory permits, measure actual prompt size, and reduce the enabled tools in the host when using smaller contexts. This is an Fecimus evaluation setting, not the publisher's advertised context or a claim to reproduce its benchmarks. Larger reasoning workloads may need much more context. Watch actual RAM/VRAM and time to first useful tool call.
4. **Prefer direct extraction for text tasks.** Request the relevant fields/section instead of complete HTML and repeated full-page screenshots. A large visible tool list and large results both consume context; use the smallest useful tool surface offered by the host/Fecimus configuration. Mistral specifically recommends limiting tools to those needed. [Ministral deployment recommendations](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512).
5. **Use the publisher's sampling defaults first.** There is no universal best temperature. Ministral Instruct recommends approximately 0.1; its Reasoning variant recommends 0.7; Qwen3.5 and Gemma 4 use different settings. Do not force temperature zero, an unrelated system template, or a generic JSON-output grammar over every model's native tool format. [Ministral Instruct](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512), [Ministral Reasoning](https://huggingface.co/mistralai/Ministral-3-3B-Reasoning-2512), [Qwen3.5 settings](https://huggingface.co/Qwen/Qwen3.5-4B), [Gemma 4 settings](https://huggingface.co/google/gemma-4-E2B-it).
6. **Control reasoning through supported model settings.** Use non-thinking or lower effort for routine extraction when the model supports it; compare quality before adopting it. Qwen3.5 does not officially use Qwen3's `/think` and `/nothink` soft switches. Let the host handle the model's actual template settings. [Qwen3.5 mode controls](https://huggingface.co/Qwen/Qwen3.5-4B).
7. **Measure useful completion time.** Tokens per second alone omits tool selection, invalid calls, retries, page loading, and verification. Do not replay a potentially successful write just because the response was interrupted.

## Reproducible model qualification

A passing test applies to an exact configuration, not every derivative bearing the same family name. Record:

```json
{
  "model_repository": "publisher/exact-model",
  "model_revision": "commit-or-download-revision",
  "quantization": "exact-file-and-quantization",
  "host_version": "LM Studio version",
  "runtime_version": "engine and build",
  "fecimus_version": "release or commit",
  "os": "exact release and architecture",
  "hardware": "CPU, GPU, VRAM, RAM",
  "context_tokens": 8192,
  "sampling": {},
  "thinking_setting": "actual host setting",
  "trials_per_case": 5,
  "results": []
}
```

Use a local test page and temporary files so success can be checked objectively. The following is a suggested release-qualification rubric, not a claim that these model tests have already run:

| Case | Observable pass condition |
| --- | --- |
| Single tool | Chooses a real tool and supplies schema-valid arguments |
| JSON escaping | Handles a title containing quotes, a backslash, and a newline without corrupting arguments |
| Dependent workflow | Opens a fixture page, reads its current content, then uses a control observed on that page |
| Background workflow | Completes the same fixture task while another app has focus; user pointer/focus remains usable |
| Structured extraction | Returns the fixture's actual rows/fields, including an intentionally missing value |
| Error recovery | Receives a controlled missing-element error, refreshes its observation, and selects a valid target |
| Tool-result grounding | Reports the supplied result and does not invent an action or source |
| Tool-selection discipline | Answers a static question without unnecessary tools and uses tools for requested fresh evidence |
| Vision, when supported | Reads a unique label available only in an image and correctly distinguishes it from DOM text |
| Multi-turn continuity | Reuses the intended session/tab and respects the user's later correction |

Repeat each applicable case at least five times. For this project's proposed qualification bar, require **all trials to have parseable calls, schema-valid arguments, and no fabricated execution claims**, plus at least **90% task success** across applicable cases. Report denominators and each failure; this bar is a project quality target, not an industry benchmark. Mark vision `not_applicable` for text-only models. Record median task time, invalid-call rate, retries, peak memory, and tool count. A model that does not meet the bar may remain an experimental option; do not label it Fecimus tested/pass.

## Diagnose the correct layer

| Symptom | Layer to inspect | Useful evidence/action |
| --- | --- | --- |
| `Unterminated string in JSON` before a call reaches Fecimus | Model output, host parser, template, or truncated generation | Capture the visible attempted call and parser error; compare the original model and native template |
| Valid JSON but wrong argument type/name | Schema following | Record tool name and arguments; inspect the current schema and model choice |
| Unknown tool | Tool discovery/history | Refresh tools and remove stale tool names from the active conversation |
| Tool receives the request and reports a timeout | Tool/backend/site | Record elapsed time, tool error, and whether the action may already have completed |
| Snapshot works but screenshot understanding fails | Modality/package/runtime | Check actual vision support and required model assets; use text extraction for text-only models |
| Success claimed without a successful tool result | Model grounding | Treat the task as failed; verify observable state before continuing |
| Browser operation grabs the user's mouse | Execution backend | Check isolation/background mode; a more powerful model cannot fix shared OS input |

For diagnosis, retain user prompts, visible model output, tool names, arguments, timing, errors, and observable results. Redact secrets and personal page content before filing an issue. A model's retrospective narrative is not an execution log. The supplied failed-call transcript, for example, visibly includes attempted browser tools, so its later claim that no tools were issued cannot be accepted as an accurate trace.

The machine-readable catalog is [models.json](models.json). Keep its verification date, primary-source links, and test status synchronized when updating this guide.
