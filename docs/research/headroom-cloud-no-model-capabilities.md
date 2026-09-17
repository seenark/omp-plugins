# Headroom v0.37.0 cloud, no-model operation, and capabilities

## Scope

This note answers three deployment questions against the official Headroom `v0.37.0` source at commit [`32d7ca4577d599b8a5f811ada74cf31504302c9d`](https://github.com/headroomlabs-ai/headroom/releases/tag/v0.37.0), plus the OMP adapter in this repository. “No model” means no local Kompress model; it does not remove the upstream LLM that answers the user.

## 1. Cloud options

### Self-hosted cloud

Headroom OSS is local-first. The official project publishes versioned Docker images such as [`ghcr.io/headroomlabs-ai/headroom:0.37.0`](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/README.md#L416-L427), so an operator can run the same proxy on a cloud VM or container host. That is user-operated hosting, not a Headroom-hosted SaaS guarantee. Keep the state and Hugging Face cache on persistent storage.

The official README describes enterprise deployment as either self-hosted with support or fully managed, and directs teams to `hello@headroomlabs.ai` ([Headroom for teams](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/README.md#L400-L425)). Public v0.37 documentation does not provide a self-service managed URL, API endpoint, or public price list. The official trust page instead emphasizes the on-premises model, so confirm data handling, tenancy, and SLA terms before treating “managed” as a public SaaS product ([Trust & Security](https://www.headroomlabs.ai/trust)).

### Remote Kompress endpoint

Headroom can keep the proxy in one environment and offload only Kompress inference to another service:

- `HEADROOM_KOMPRESS_ENDPOINT` points to a remote `/compress` endpoint.
- `HEADROOM_KOMPRESS_ENDPOINT_TOKEN` supplies optional bearer authentication.
- The endpoint can be an operator-owned FastAPI, Modal, SageMaker, KServe, or similar deployment; the setting is a protocol hook, not a Headroom Labs-hosted endpoint.
- The remote service receives only the inference payload. CCR originals, markers, and retrieval state remain in the proxy's local store ([proxy docs](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L417-L426), [`kompress_remote.py`](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_remote.py)).
- Network failure, non-2xx response, timeout, or malformed response fails open to the original content ([`kompress_remote.py`](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_remote.py#L60-L80)).

Cloudflare Tunnel is only external exposure and routing. It is not a Headroom cloud service. A tunnel must preserve `POST /v1/compress`, request body, and authentication; Headroom's inbound route still needs `HEADROOM_COMPRESS_ALLOW_REMOTE=1` and a valid `HEADROOM_PROXY_TOKEN` when configured ([proxy docs](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L367-L426)).

## 2. Operation without the Kompress model

### Two different meanings

- `HEADROOM_DISABLE_KOMPRESS=1` disables only ML Kompress and keeps structural compressors ([proxy configuration](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L220-L233)).
- `--no-optimize` disables the optimization pipeline and makes the proxy a passthrough ([proxy CLI](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L20-L55)). It is not equivalent to disabling Kompress.
- A remote Kompress endpoint is a third option: the local proxy has no model artifacts, but compression still uses a model elsewhere.

### What still works

With Kompress disabled or unavailable, recognized structural paths still work: JSON arrays via SmartCrusher; search results; build/test logs; diffs; HTML; tabular data; structured configuration; and optional AST-aware code compression when its extra and safety gates are enabled. Plain or unstructured text normally relies on Kompress as the ML fallback, so it often passes through unchanged without that model ([how compression works](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/how-compression-works.mdx), [text and logs](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/text-and-logs.mdx)).

The proxy is designed to fail open. Missing optional dependencies, cold cache, slow inference, model-load failure, timeout, or repeated inference failure preserve the original content or unprocessed tail instead of breaking the upstream request ([Kompress source](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L1450-L1515), [proxy endpoint contract](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L505-L514)).

### Advantages

- No ModernBERT/ONNX download or model cache.
- Lower RAM, disk, and CPU use.
- More predictable latency; no ML inference timeout.
- Structural compressors remain deterministic and format-aware.
- CCR can remain enabled; disabling Kompress does not disable CCR.
- No local ML model is needed when using a remote endpoint.

### Disadvantages

- Plain prose and other content routed only to Kompress lose most of their compression.
- More tokens reach the upstream LLM, increasing context cost and prompt-processing time.
- Large unstructured tool output can hit provider context limits sooner.
- Remote inference adds network latency and another service dependency.
- `--no-optimize` removes all Headroom token savings, not only ML savings.

## 3. What Headroom can do

### Main pipeline

Headroom sits between an application and an LLM provider. It supports a FastAPI proxy, Python/TypeScript SDK calls, and framework integrations. The proxy detects each content block and selects a compressor; the provider response returns unchanged ([architecture](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/architecture.mdx), [compression routing](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/how-compression-works.mdx)).

| Capability | Function | Status / boundary |
|---|---|---|
| JSON compression | Remove redundant array items and values while preserving structure | Structural; SmartCrusher |
| Search and logs | Keep relevant matches, errors, stack traces, and summaries | Structural |
| Diffs, HTML, tables, config | Keep changed, meaningful, or structural content | Structural |
| Plain text | Select important text/tokens | Kompress ML fallback; workload-dependent |
| Code compression | AST-aware reduction with safety gates | Optional; recent/analysis code is protected by default |
| Cache mode | Compress newest delta and keep prior prefix byte-stable | Default proxy posture |
| Token mode | Maximize visible token removal, possibly rewriting older turns | Explicit opt-in |
| CCR | Store originals locally and retrieve them by hash when needed | On by default in proxy flow; configurable TTL |
| Semantic cache | Reuse semantically equivalent results | Configurable; SDK default is off |
| Memory | Store and retrieve hierarchical user/session/agent/turn facts | Optional `--memory` / `--learn` |
| MCP | Expose `headroom_compress`, `headroom_retrieve`, and `headroom_stats` | Optional; works without proxy |
| Routing | Proxy Anthropic, OpenAI, Gemini, Bedrock, OpenRouter/LiteLLM/compatible targets | Provider transport, not model hosting |
| Observability | `/health`, `/stats`, `/stats-history`, `/metrics`, local dashboard, optional exports | Local telemetry off by default |
| Model routing | Rewrite selected upstream models based on rules | Opt-in; off by default |

Headroom does not replace the upstream LLM, does not guarantee a context-window increase, and does not delete or reorder messages in the current pipeline. Compression is content-block reduction, not a new reasoning model ([architecture](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/architecture.mdx#L20-L75)).

### CCR boundary

CCR stores compressed originals locally and adds retrieval behavior so the model can request full data later. `--no-ccr` removes retrieval markers/tool behavior; `--lossless` selects marker-free format-native compaction. CCR is separate from Kompress, so structural-only deployments can still use it ([CCR docs](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/ccr.mdx)).

### OMP adapter boundary

This repository's `packages/headroom` adapter is narrower than the full Headroom product:

- It submits only eligible, large `toolResult` messages to `/v1/compress`.
- It accepts output only when message alignment, roles, tool IDs, and untouched content remain safe.
- On proxy failure, timeout, unsafe output, or no savings, it keeps the original context.
- It calls only `/health`, `/stats`, and `/v1/compress`; it does not start Docker, Cloudflare, the Headroom proxy, native MCP, memory, CCR retrieval, or provider routing ([adapter README](local://packages/headroom/README.md), [`client.ts`](local://packages/headroom/client.ts), [`bridge.ts`](local://packages/headroom/bridge.ts)).

## Recommendation for this deployment

For one interactive user on the M1 Max, local Headroom is the simplest low-latency option. Keep the cloud/Ubuntu proxy when 24/7 availability or multi-machine access matters. If the Ubuntu host remains CPU-limited, move only Kompress to a stronger endpoint or upgrade the host; disabling Kompress avoids latency but also removes prose compression.

## Primary sources

- [Headroom v0.37.0 release](https://github.com/headroomlabs-ai/headroom/releases/tag/v0.37.0)
- [Headroom README and enterprise deployment](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/README.md)
- [Proxy documentation](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx)
- [Architecture](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/architecture.mdx)
- [How compression works](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/how-compression-works.mdx)
- [Text and log compression](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/text-and-logs.mdx)
- [CCR](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/ccr.mdx)
- [Cache optimization](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/cache-optimization.mdx)
- [MCP](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/mcp.mdx)
- [Memory](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/memory.mdx)
- [Kompress runtime](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py)
- [Remote Kompress adapter](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_remote.py)
- [ONNX Runtime threading](https://onnxruntime.ai/docs/performance/tune-performance/threading.html)
- [Headroom Labs trust page](https://www.headroomlabs.ai/trust)
