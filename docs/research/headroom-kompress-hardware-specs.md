# Headroom v0.37.0 Kompress ONNX hardware and runtime

## Scope and bottom line

This note audits the official Headroom `v0.37.0` source at commit [`32d7ca4577d599b8a5f811ada74cf31504302c9d`](https://github.com/headroomlabs-ai/headroom/releases/tag/v0.37.0), the pinned Kompress model metadata, and current official ONNX Runtime and Hugging Face documentation. It targets an in-process Kompress ONNX CPU deployment on remote Ubuntu.

**One practical recommendation:** use **8 vCPU, 16 GiB RAM, and at least 20 GiB free persistent disk**, with one proxy worker and `HEADROOM_KOMPRESS_BACKEND=onnx_cpu`. Keep the Hugging Face cache on persistent storage. This is an engineering recommendation, not an official Headroom minimum. It leaves room for the proxy, Python/runtime overhead, model-session allocations, cache metadata, logs, and a possible ONNX fallback artifact.

Headroom publishes no hard CPU, RAM, or disk minimum for Kompress. The reviewed release specifies Python and package constraints plus runtime knobs, but no minimum hardware table ([`pyproject.toml`](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/pyproject.toml#L7-L11), [`proxy.mdx`](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L224-L233)). The tiers below are therefore explicit inference from artifact size, runtime behavior, and expected service headroom.

## What v0.37 documents

### Backend and package selection

- `HEADROOM_KOMPRESS_BACKEND` defaults to `auto`. `auto` tries ONNX CPU first, then PyTorch. Explicit choices include `onnx`, `onnx_cpu`, `onnx_coreml`, `pytorch`, and `pytorch_mps` ([Kompress loader](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L891-L936)). Linux Ubuntu should use `onnx_cpu` for a deterministic CPU-only path; CoreML and MPS are not Linux deployment targets.
- The `[proxy]` extra declares `onnxruntime` and `transformers`; Python 3.11+ receives `onnxruntime>=1.24.0`, while Python 3.10 receives `onnxruntime>=1.16.0,<1.24.0` ([`pyproject.toml`](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/pyproject.toml#L84-L95)). The `[ml]` extra adds PyTorch and `huggingface-hub` for the PyTorch path ([`pyproject.toml`](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/pyproject.toml#L118-L126)); it is not needed for the normal ONNX CPU path.
- The ONNX loader uses `CPUExecutionProvider` and stores the loaded model/tokenizer in a process-local Kompress cache ([loader](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L598-L707)). The source first loads the Kompress artifact and then loads the ModernBERT tokenizer from `answerdotai/ModernBERT-base` ([tokenizer loader](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L709-L730)).
- The source pins `chopratejas/kompress-v2-base` to immutable revision `b1563631b35bfdcee37587ad530147497d820d4c` unless pinning is deliberately disabled ([Headroom ONNX helper](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/onnx_runtime.py#L61-L82)). Keep this pin behavior for reproducible deployment.

### ONNX artifact and cache footprint

The loader tries these files in order: weight-only int8, fp32, then the older dynamic-int8 artifact. The source comments describe the first two as approximately 261 MB and 601 MB and explain that the weight-only int8 graph can fall through when the installed ONNX Runtime cannot execute its `MatMulNBits` operator ([artifact list and fallback rationale](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L77-L91)). The pinned Hugging Face API reports exact byte sizes:

| Artifact | API size | Approximate size | Loader role |
|---|---:|---:|---|
| `onnx/kompress-int8-wo.onnx` | 274,049,435 bytes | 274.0 MB / 261.4 MiB | First choice |
| `onnx/kompress-fp32.onnx` | 600,561,247 bytes | 600.6 MB / 572.7 MiB | Fallback if int8 is unavailable or unusable |
| `tokenizer.json` in `answerdotai/ModernBERT-base` | 2,132,967 bytes | 2.1 MB / 2.0 MiB | Tokenizer input |
| `tokenizer_config.json` in `answerdotai/ModernBERT-base` | 20,810 bytes | 0.02 MB / 0.02 MiB | Tokenizer metadata |

Sources: [Kompress model API metadata](https://huggingface.co/api/models/chopratejas/kompress-v2-base?blobs=true), [ModernBERT tokenizer API metadata](https://huggingface.co/api/models/answerdotai/ModernBERT-base?blobs=true), and the [loader order](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L77-L91). The model card identifies the encoder as ModernBERT-base with 149M parameters ([Kompress model card](https://huggingface.co/chopratejas/kompress-v2-base#model-card)).

If the int8 artifact loads, normal steady-state cache storage is roughly 261 MiB for that graph plus small tokenizer/config files. If int8 fails after download and fp32 succeeds, both artifacts can remain in the Hugging Face cache: together they are about 834 MiB before Python packages, snapshots, logs, and old revisions. Hugging Face documents that cache blobs and snapshots are retained across revisions, with snapshots using links to shared blobs ([cache layout](https://huggingface.co/docs/huggingface_hub/guides/manage-cache#file-based-caching)).

**Storage inference:** reserve **at least 5 GiB free** for a single-purpose minimum deployment and **10 GiB or more** for the recommended deployment. Use 20 GiB or more when retaining multiple model revisions, container layers, logs, or rollback artifacts. Set `HF_HOME` or `HF_HUB_CACHE` to a persistent volume when the container or virtual machine is disposable ([Hugging Face cache configuration](https://huggingface.co/docs/huggingface_hub/guides/manage-cache#file-based-caching)). Do not count the ONNX file size as the required RAM size; ONNX Runtime and the proxy allocate additional working memory.

For predictable footprint, force `onnx_cpu`. Leaving `auto` allows a PyTorch fallback after ONNX failure; that path loads a separate PyTorch architecture and weights ([PyTorch loader and auto fallback](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L826-L950)).

## CPU, threads, and concurrency

### ONNX Runtime defaults

Official ONNX Runtime guidance says the default CPU session uses `intra_op_num_threads=0`, which selects the number of physical CPU cores; intra-op threads parallelize work inside operators. The default execution mode is `ORT_SEQUENTIAL`; inter-op threads matter when graph execution is changed to parallel mode. The default graph optimization level is `ORT_ENABLE_ALL` ([ONNX Runtime thread management](https://onnxruntime.ai/docs/performance/tune-performance/threading.html#set-number-of-intra-op-threads), [default settings](https://onnxruntime.ai/docs/performance/tune-performance/threading.html#thread-management)).

Headroom exposes `HEADROOM_KOMPRESS_ONNX_INTRA_THREADS` and `HEADROOM_KOMPRESS_ONNX_INTER_THREADS`, but leaves them unset unless the operator provides positive integer values ([Kompress session options](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L330-L335)). Start with the ORT default. Tune intra-op threads only after measuring the actual Ubuntu host; cloud “vCPU” counts do not always equal physical-core counts.

Headroom enables all available graph optimizations by default through the normal ONNX Runtime session defaults. ONNX Runtime documents that graph optimizations are semantics-preserving transformations and that online optimization adds session-start cost; offline optimized graphs must match the target execution provider and compatible hardware ([graph optimization levels](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html#graph-optimization-levels), [online/offline mode](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html#onlineoffline-mode)). Do not pre-optimize for another CPU or execution provider without testing the exact production host.

### Headroom's process and execution limits

- `HEADROOM_KOMPRESS_MAX_CONCURRENT` controls the model execution semaphore. The default is **1** for ONNX, because ONNX Runtime already owns intra/inter-op threads and extra simultaneous calls mainly add queueing, memory pressure, and timeout risk ([execution limit](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L338-L363)). Keep it at 1 initially.
- `compress_batch()` uses batched inference on GPU but deliberately falls back to sequential calls on ONNX CPU. The source reports an empirical 0.7–0.9x batched-vs-sequential result and parity with a direct loop on a 16-logical-thread CPU ([batch behavior and measurements](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L1738-L1771)). `HEADROOM_KOMPRESS_BATCH_SIZE` is therefore not a CPU throughput lever for this path.
- The proxy's `--compression-max-workers` / `HEADROOM_COMPRESSION_MAX_WORKERS` defaults to CPU count and bounds the CPU-bound compression threadpool. The official proxy docs recommend lowering it to reduce oversubscription under concurrent sessions ([proxy performance settings](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L304-L309)).
- `--workers` / `HEADROOM_WORKERS` defaults to one Uvicorn worker ([proxy options](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L27-L39)). Because the Kompress cache is process-local, adding workers is an inference that each process may load its own model/session and increase RSS; scale worker count only after measuring memory and latency.

Headroom also changes two ONNX memory/idle-CPU defaults for long-lived Linux processes: it disables the CPU memory arena and memory-pattern cache when the platform default is not Windows, trading peak throughput for lower retained RSS, and disables ORT thread spinning by default. `HEADROOM_ONNX_CPU_ARENA=1` restores the arena; `HEADROOM_ONNX_ALLOW_SPINNING=1` restores spinning for a dedicated throughput-oriented host ([Headroom ONNX runtime helper](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/onnx_runtime.py#L11-L58), [session options](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/onnx_runtime.py#L148-L203)). Benchmark these toggles; do not enable both by assumption.

## Timeouts, budgets, and fail-open behavior

Kompress has defensive bounds because ONNX CPU inference is non-preemptible after a worker starts. Release defaults are:

| Knob | Default | Meaning |
|---|---:|---|
| `HEADROOM_KOMPRESS_EXECUTION_TIMEOUT_MS` | 3,000 ms | Maximum semaphore wait budget used by execution acquisition |
| `HEADROOM_KOMPRESS_ACQUIRE_TIMEOUT_SECONDS` | 5 s | Maximum wait for an execution slot |
| `HEADROOM_KOMPRESS_TIME_BUDGET_SECONDS` | 20 s | Wall-clock budget for one `compress()` / `compress_batch()` call |
| `HEADROOM_COMPRESSION_DEADLINE_MS` | 20,000 ms | Cooperative request deadline checked at chunk boundaries |
| `HEADROOM_KOMPRESS_CANARY_SECONDS` | 5 s | Startup canary threshold; a slower probe disables Kompress for that process |
| `HEADROOM_KOMPRESS_MAX_CONCURRENT` | 1 | Default simultaneous ONNX execution slots |

The values and their fail-open paths are defined in the Kompress source ([constants and parsers](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L93-L118), [timeout helpers](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L257-L296), [deadline handling](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L1450-L1515)). On budget exhaustion, acquisition saturation, model-load failure, or inference failure, the compressor either passes content through or keeps the unprocessed tail verbatim rather than silently dropping it ([passthrough paths](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L1500-L1515), [failure handling](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L1697-L1735)). The proxy API documents timeout responses as HTTP 200 with `compression_skipped: true` and `skip_reason: "compression_timeout"` ([proxy API fail-open behavior](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L499-L514)).

These defaults mean a small CPU can appear healthy while producing little or no compression: the request still succeeds, but Kompress gives up. Treat `compression_skipped`, latency, and RSS as deployment metrics, not only HTTP status.

## Practical hardware tiers

The following tiers are **inference-based operating points**, not vendor requirements. They assume the lightweight ONNX CPU path, one model, ordinary proxy overhead, and no other memory-heavy workloads.

| Tier | CPU | RAM | Free persistent disk | Operating posture and caveat |
|---|---:|---:|---:|---|
| **Minimum usable** | 4 vCPU | 8 GiB | 5 GiB | One worker, `onnx_cpu`, one model execution at a time, low request concurrency. Suitable for occasional compression. A slow host may trip the 5 s canary or 20 s budget and fail open. |
| **Recommended** | **8 vCPU** | **16 GiB** | **20 GiB** | One worker, persistent HF cache, `onnx_cpu`, ORT default thread count first, `HEADROOM_KOMPRESS_MAX_CONCURRENT=1`. Best default for a remote Ubuntu sidecar with moderate traffic. |
| **Comfortable** | 16 vCPU | 32 GiB | 30 GiB or more | Headroom for other proxy work, cache growth, a second process, or measured higher concurrency. Add workers or raise execution concurrency only after observing per-process RSS and tail latency. |

Why these numbers: the first-choice graph is 261.4 MiB on disk, the fp32 fallback is 572.7 MiB, ONNX Runtime allocates execution buffers beyond file size, and the proxy has its own Python/threadpool/process footprint ([artifact metadata](https://huggingface.co/api/models/chopratejas/kompress-v2-base?blobs=true), [Headroom ONNX session setup](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L598-L707)). The RAM and CPU tiers are conservative capacity recommendations derived from those facts and the single-slot CPU execution design; they are not measured universal limits.

## Recommendation for the remote Ubuntu server

1. Provision **8 vCPU / 16 GiB RAM / 20 GiB free persistent disk**. If the server already has 4 vCPU / 8 GiB and low request volume, it can be a minimum-tier trial, not a guaranteed latency target.
2. Use Python 3.11 or newer with `headroom-ai[proxy]`, then set `HEADROOM_KOMPRESS_BACKEND=onnx_cpu`. The release dependency floor selects ONNX Runtime 1.24+ on Python 3.11+ ([dependency declaration](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/pyproject.toml#L84-L95)).
3. Persist the Hugging Face cache via `HF_HOME` or `HF_HUB_CACHE`; allow first-run model downloads, then test cache-only startup before enabling offline mode. Hugging Face documents the cache structure and local-only behavior ([cache guide](https://huggingface.co/docs/huggingface_hub/guides/manage-cache#file-based-caching)).
4. Run one proxy worker initially. Keep ONNX execution concurrency at 1 and leave ORT intra-op thread count unset for the first measurement. Lower `HEADROOM_COMPRESSION_MAX_WORKERS` if unrelated concurrent compression saturates the host.
5. Do not force the fp32 artifact unless the int8 artifact fails the smoke run or quality check. The source already tries the fp32 fallback when necessary ([ONNX artifact loading](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L573-L653)).
6. If the deployment instead sets `HEADROOM_KOMPRESS_ENDPOINT`, Kompress model RAM/CPU requirements move to the remote model server; the sidecar still needs proxy overhead, and sidecar latency includes HTTP/network behavior. Headroom documents this as real egress and a separate remote inference mode ([remote endpoint](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L224-L233), [in-process versus offloaded inference](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L417-L420)).

## One-request benchmark procedure

Measure the actual host with a redacted representative tool-output or prose payload of at least 64 words, ideally close to the deployment's typical request size. Do not use secrets or report a synthetic payload as a universal benchmark.

### Model-only measurement on Ubuntu

Run after installing `headroom-ai[proxy]`. The first `warm_kompress_model()` call downloads/loads the model and is intentionally outside the timed request. The timed call measures one representative compression request with the model already warm:

```bash
HEADROOM_KOMPRESS_BACKEND=onnx_cpu python - <<'PY'
from pathlib import Path
import resource
import time

from headroom.transforms.kompress_compressor import (
    KompressCompressor,
    KompressConfig,
    warm_kompress_model,
)

text = Path("sample.txt").read_text(encoding="utf-8")  # redacted representative payload
if len(text.split()) < 64:
    raise SystemExit("sample.txt must contain at least 64 words")
if not warm_kompress_model(device="cpu", allow_download=True):
    raise SystemExit("Kompress model did not become ready")

compressor = KompressCompressor(KompressConfig(device="cpu"))
start = time.perf_counter()
result = compressor.compress(text, allow_download=False)
elapsed_ms = (time.perf_counter() - start) * 1000
peak_rss_mib = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024  # Linux KiB -> MiB

print({
    "backend": compressor.ready_backend(),
    "request_ms": round(elapsed_ms, 1),
    "peak_rss_mib": round(peak_rss_mib, 1),
    "words_before": result.original_tokens,
    "words_after": result.compressed_tokens,
    "compression_ratio": round(result.compression_ratio, 3),
    "passthrough": result.compression_ratio == 1.0,
})
PY
```

Record CPU model/topology (`lscpu`), available memory, disk free space, ONNX Runtime version, and whether the result passed through. If the request exceeds the canary/budget or reports passthrough, tune threads or choose a larger tier before increasing concurrency.

For service-level measurement, send the same redacted payload once to the actual `/v1/compress` URL after model warmup and record client-observed wall time plus the response's `compression_skipped` field. That number includes network and HTTP overhead when the caller is remote; a local model-only number does not. Headroom's endpoint contract and response metrics are documented in [`proxy.mdx`](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L367-L514).

**Local measured performance and remote measured performance are workload-specific, not universal benchmarks.** The official v0.37 source reports CPU batch behavior on one 16-logical-thread system and GPU batch measurements on an RTX 3080 Ti, not a hardware requirement ([source measurements](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L1750-L1771)). Headroom's public benchmark page separately labels its latency table as Apple M-series CPU measurements from v0.5.18 ([benchmark scope](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/benchmarks.mdx#L6-L12), [latency table](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/benchmarks.mdx#L66-L108)); those numbers must not be presented as v0.37 Ubuntu guarantees.

## Primary sources

- [Headroom v0.37.0 release](https://github.com/headroomlabs-ai/headroom/releases/tag/v0.37.0)
- [Kompress loader and runtime controls](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py)
- [Headroom ONNX Runtime helper](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/onnx_runtime.py)
- [Headroom dependency declarations](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/pyproject.toml)
- [Headroom proxy documentation](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx)
- [Headroom benchmark methodology](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/benchmarks.mdx)
- [Kompress-v2-base model card](https://huggingface.co/chopratejas/kompress-v2-base)
- [Kompress-v2-base file metadata](https://huggingface.co/api/models/chopratejas/kompress-v2-base?blobs=true)
- [ModernBERT-base file metadata](https://huggingface.co/api/models/answerdotai/ModernBERT-base?blobs=true)
- [ONNX Runtime thread management](https://onnxruntime.ai/docs/performance/tune-performance/threading.html)
- [ONNX Runtime graph optimizations](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html)
- [Hugging Face Hub cache management](https://huggingface.co/docs/huggingface_hub/guides/manage-cache)
