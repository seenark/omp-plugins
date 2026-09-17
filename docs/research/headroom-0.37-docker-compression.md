# Headroom v0.37.0 Docker compression

## Scope and release

This note covers the `v0.37.0` source tag, resolved to commit [`32d7ca4577d599b8a5f811ada74cf31504302c9d`](https://github.com/headroomlabs-ai/headroom/releases/tag/v0.37.0). The target image is `ghcr.io/headroomlabs-ai/headroom:0.37.0`.

The official Dockerfile starts the image with `headroom proxy`, listens on `0.0.0.0:8787`, and uses `/readyz` for its container healthcheck ([Dockerfile, lines 188-205](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/Dockerfile#L188-L205)). The image does register `POST /v1/compress`; it is not a route supplied by an optional upstream provider ([server.py, lines 5358-5383](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/proxy/server.py#L5358-L5383)).

## Root cause of `404` through a tunnel

`POST /v1/compress` is loopback-only by default. The route adds `require_loopback` unless `HEADROOM_COMPRESS_ALLOW_REMOTE` is truthy. The guard deliberately returns `404`, not `403`, for a non-loopback caller ([server.py, lines 5358-5374](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/proxy/server.py#L5358-L5374); [loopback_guard.py, lines 173-216](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/proxy/loopback_guard.py#L173-L216)). Official proxy documentation states the same behavior: set `HEADROOM_COMPRESS_ALLOW_REMOTE=1` for a gateway or sidecar; without it, remote callers receive `404` ([proxy docs, lines 293-299](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L293-L299), [lines 413-426](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L413-L426)).

A Cloudflare Tunnel request is not guaranteed to look loopback to the ASGI app. Therefore, a tunnel can make `/health` work while `/v1/compress` returns the intentional loopback `404`. This is a route exposure failure, not proof that the image lacks the route.

Headroom has no Cloudflare-specific path rewrite configuration. The tunnel must deliver the same `POST /v1/compress` path to the Headroom origin. A public path prefix, path strip, wrong origin, or `GET` request is outside Headroom and can produce a separate `404` or `405`. Test the origin and tunnel with the identical path and body.

## Why health can be healthy while Kompress is unavailable

Kompress is an optional, non-gating component. The health code marks an enabled-but-not-ready optional component as `status: "degraded"`, with `ready: false` ([server.py, lines 2996-3022](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/proxy/server.py#L2996-L3022)). It reports Kompress readiness from the loaded warmup state and exposes the loaded backend, if any ([server.py, lines 3024-3135](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/proxy/server.py#L3024-L3135)).

Top-level readiness intentionally excludes `kompress` from its `all(...)` check. Thus `/health` can return HTTP 200 with `status: "healthy"`, `ready: true`, while `checks.kompress` reports `ready: false`, `status: "degraded"`, and `backend: null` ([server.py, lines 3240-3253](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/proxy/server.py#L3240-L3253)). `/readyz` uses this same top-level readiness decision ([server.py, lines 3652-3667](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/proxy/server.py#L3652-L3667)).

`backend: null` means no backend is currently loaded into the Kompress cache. The proxy deliberately loads model artifacts in the background. Until the model is cached, requests route around Kompress and remain uncompressed; the source logs this condition and points operators to Hugging Face connectivity or first-run warmup ([content_router.py, lines 3809-3827](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/content_router.py#L3809-L3827)). A healthy container therefore does not prove that ML compression is warm.

## Backend and dependency requirements

The Dockerfile build argument defaults to `HEADROOM_EXTRAS=proxy,code,bedrock` ([Dockerfile, lines 50-58](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/Dockerfile#L50-L58)). The official `proxy` extra includes `onnxruntime` and `transformers` ([pyproject.toml, lines 71-95](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/pyproject.toml#L71-L95)). That is sufficient for the lightweight ONNX Kompress path: the availability check requires ONNX Runtime plus Transformers ([kompress_compressor.py, lines 474-499](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L474-L499)).

The separate `[ml]` extra adds PyTorch, Transformers, and an explicit `huggingface-hub` dependency ([pyproject.toml, lines 114-127](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/pyproject.toml#L114-L127)). Add `[ml]` only when using the PyTorch fallback or when a custom build needs the full ML dependency set. Do not set `HEADROOM_EXTRAS` as a runtime environment variable; it is a Docker build argument.

The supported backend variable is `HEADROOM_KOMPRESS_BACKEND`. It defaults to `auto`; `auto` tries ONNX CPU first and then PyTorch. Supported explicit values include `onnx`, `onnx_cpu`, `onnx_coreml`, `pytorch`, and `pytorch_mps` ([kompress_compressor.py, lines 232-257](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L232-L257), [lines 937-1007](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L937-L1007)). For a Linux Docker deployment, `onnx_cpu` is the simplest deterministic local choice; leaving the variable unset preserves the source default `auto` behavior.

The default model is `chopratejas/kompress-v2-base`. The loader tries the pinned ONNX artifacts in source order and downloads them on first use when they are not cached ([kompress_compressor.py, lines 38-94](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py#L38-L94)). The container therefore needs Hugging Face egress during first-run prefetch, or a pre-populated model cache. Do not enable `HEADROOM_OFFLINE` until the required model artifacts are already cached; the official proxy docs define offline mode as disabling model downloads ([proxy docs, lines 293-302](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L293-L302)).

## Recommended Compose changes

Merge these settings into the existing proxy service. Keep the service name and existing volume/port choices used by the deployment:

```yaml
services:
  headroom-proxy:
    image: ghcr.io/headroomlabs-ai/headroom:0.37.0
    command: ["--host", "0.0.0.0", "--port", "8787"]
    environment:
      - HEADROOM_HOST=0.0.0.0
      - HEADROOM_PROXY_TOKEN=${HEADROOM_PROXY_TOKEN:?set HEADROOM_PROXY_TOKEN}
      - HEADROOM_COMPRESS_ALLOW_REMOTE=1
      # Optional. Omit to use source default: auto (ONNX CPU first, then PyTorch).
      - HEADROOM_KOMPRESS_BACKEND=onnx_cpu
    ports:
      - "127.0.0.1:8787:8787"
```

`HEADROOM_COMPRESS_ALLOW_REMOTE=1` is the required change for a tunnel or other non-loopback caller. `HEADROOM_PROXY_TOKEN` remains required for a protected deployment; it is shown only as Compose interpolation and must never be replaced with a committed secret.

If the deployment builds from the official Dockerfile instead of pulling the published image, the default build already includes the ONNX dependencies:

```yaml
    build:
      context: .
      args:
        HEADROOM_BUILD_VERSION: ${HEADROOM_BUILD_VERSION:-source-build}
        # Add ml only for PyTorch/fallback requirements.
        HEADROOM_EXTRAS: proxy,code,bedrock,ml
```

Do not add that build argument merely to fix the tunnel `404`; route exposure and model loading are separate concerns. If the published image is used, runtime `HEADROOM_COMPRESS_ALLOW_REMOTE` is enough to expose the existing route. If a custom image was built without `proxy`, rebuild it with at least `proxy`; use `proxy,code,bedrock,ml` when PyTorch support is required.

## `HEADROOM_PROXY_TOKEN` and tunnel behavior

`HEADROOM_PROXY_TOKEN` does not register, remove, or rewrite `/v1/compress`. It enables the outer security gate. With a token configured, non-loopback requests to non-health paths must supply the token; missing or incorrect credentials return HTTP 401 ([server.py, lines 3545-3561](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/proxy/server.py#L3545-L3561), [lines 3578-3601](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/proxy/server.py#L3578-L3601)). `/health`, `/healthz`, `/livez`, and `/readyz` are auth-exempt ([server.py, lines 3549-3552](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/proxy/server.py#L3549-L3552)).

The two settings have different jobs:

- `HEADROOM_COMPRESS_ALLOW_REMOTE=1`: remove only `/v1/compress`'s loopback dependency.
- `HEADROOM_PROXY_TOKEN`: authenticate non-loopback data-plane requests.

Keep both settings when exposing the endpoint through a tunnel. A remote request without the first setting gets the intentional 404. A remote request with the first setting but without a valid configured token gets 401. Official documentation lists both outcomes ([proxy docs, lines 423-426](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L423-L426), [lines 505-514](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L505-L514)).

## Verification commands and expected responses

Run these against the origin first. Do not print the token value.

1. Confirm image startup and the route's origin port:

```bash
docker image inspect ghcr.io/headroomlabs-ai/headroom:0.37.0 \
  --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}}'
docker compose up -d
docker compose ps
```

Expected image command contains `headroom`, `proxy`, and port `8787`; the service reaches `running`/healthy after startup. The official image healthcheck only proves `/readyz` responds.

2. Inspect health and Kompress independently:

```bash
curl -sS -i http://127.0.0.1:8787/health
curl -sS http://127.0.0.1:8787/health \
  | jq '{status, ready, kompress: .checks.kompress}'
```

Expected cold-cache shape is HTTP 200 with top-level `status: "healthy"`, `ready: true`, and a possible component value like:

```json
{
  "status": "healthy",
  "ready": true,
  "kompress": {
    "enabled": true,
    "ready": false,
    "status": "degraded",
    "optional": true,
    "backend": null
  }
}
```

The exact component set can vary with enabled features. When the model has loaded successfully, expect `kompress.ready: true`, `kompress.status: "healthy"`, and a backend such as `"onnx"`.

3. Prove the endpoint exists locally with a valid request:

```bash
curl -sS -i -X POST http://127.0.0.1:8787/v1/compress \
  -H 'Content-Type: application/json' \
  --data '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"short test message"}]}'
```

Expected response is HTTP 200 JSON containing `messages`, `tokens_before`, `tokens_after`, `tokens_saved`, `compression_ratio`, `transforms_applied`, `transforms_summary`, and `ccr_hashes`. A tiny message can legitimately have zero savings. For a route/validation check independent of savings, omit `model`:

```bash
curl -sS -i -X POST http://127.0.0.1:8787/v1/compress \
  -H 'Content-Type: application/json' \
  --data '{"messages":[]}'
```

Expected response is HTTP 400 with `error.type: "invalid_request"`, because both `messages` and `model` are required ([proxy docs, lines 440-447](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L440-L447), [lines 475-514](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L475-L514)).

4. Verify the public tunnel preserves method, path, body, and token:

```bash
curl -sS -i -X POST 'https://YOUR_PUBLIC_HOST/v1/compress' \
  -H "X-Headroom-Proxy-Token: ${HEADROOM_PROXY_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"short tunnel test"}]}'
```

Expected response is the same HTTP 200 shape as the origin. HTTP 401 means the token is absent or wrong. HTTP 404 after setting `HEADROOM_COMPRESS_ALLOW_REMOTE=1` means the request likely reaches a different container/path, the tunnel rewrites the path, or the new environment was not applied; compare the origin request and container logs. A public `/health` response without a `config` block is normal because Headroom exposes detailed config only to loopback callers ([server.py, lines 3658-3667](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/proxy/server.py#L3658-L3667)).

5. Confirm model warmup separately from route reachability:

```bash
docker compose logs --since=10m --no-log-prefix headroom-proxy \
  | grep -E 'Kompress|model not ready|backend='
curl -sS http://127.0.0.1:8787/health \
  | jq '.checks.kompress'
```

On a cold cache, logs can report model prefetching and `Kompress model not ready; requests will not be compressed`. After artifacts download and an eligible request loads the model, expect an ONNX load message and `ready: true` with a non-null backend. Always inspect `compression_skipped`; the endpoint intentionally fails open with HTTP 200 and `compression_skipped: true` on a compression timeout ([proxy docs, lines 505-514](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx#L505-L514)).

## Rollback

- Remove `HEADROOM_COMPRESS_ALLOW_REMOTE` or set it to `0` to restore loopback-only compression. Remote callers will again receive the intentional `404`.
- Remove the explicit `HEADROOM_KOMPRESS_BACKEND` setting to return to source default `auto` behavior.
- If a custom build was used, restore the prior `HEADROOM_EXTRAS` value and image tag, then run `docker compose up -d --build`.
- Keep `HEADROOM_PROXY_TOKEN` configured while the tunnel remains reachable. Never put its value in this note, Compose source, or command output.
- Preserve the named workspace volume during rollback. Do not use `docker compose down -v` unless deleting persisted Headroom state is intentional; the official Compose file mounts `headroom_workspace` at `/home/nonroot/.headroom` ([docker-compose.yml, lines 35-72](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docker-compose.yml#L35-L72)).

## Primary sources

- [Release v0.37.0](https://github.com/headroomlabs-ai/headroom/releases/tag/v0.37.0)
- [Dockerfile](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/Dockerfile)
- [Official Compose file](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docker-compose.yml)
- [Dependency extras](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/pyproject.toml)
- [Proxy API and networking docs](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/docs/content/docs/proxy.mdx)
- [Proxy route registration and health](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/proxy/server.py)
- [Kompress loader](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/kompress_compressor.py)
- [ContentRouter lazy-loading behavior](https://github.com/headroomlabs-ai/headroom/blob/32d7ca4577d599b8a5f811ada74cf31504302c9d/headroom/transforms/content_router.py)
