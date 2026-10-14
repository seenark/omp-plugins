# Headroom v0.40.0 pitfalls for the OMP `/v1/compress` sidecar

## Scope, evidence, and how to read this

Target: Headroom `v0.40.0` (tag commit [`855390d`](https://github.com/headroomlabs-ai/headroom/commit/855390d6110e0bbb199d9b97025baac16c2f5cf3), released 2026-10-06), run as a sidecar behind `POST /v1/compress`, Kompress disabled, `HEADROOM_SAVINGS_PROFILE=coding`. Caller: `packages/headroom` (`bridge.ts`, `client.ts`, `index.ts`), which sends the whole conversation on every OMP `context` event and writes back only tool-result text.

Source links below are pinned to that commit (`…/blob/855390d…/<path>#L<a>-L<b>`; written as `file:Lx-Ly`). Every finding carries one evidence tag:

- **[source]** read in the v0.40.0 tree.
- **[issue]** reported upstream; link given. Upstream status is stated against v0.40.0, not against `main`.
- **[harness]** reproduced by me against the PyPI wheel `headroom-ai[code]==0.40.0` (Python 3.12, macOS arm64). The harness builds `ContentRouter` the way `server.py:1042-1058` does, sets `ccr_inject_marker=False` and `enable_kompress=False`, passes the `coding` profile kwargs from `agent_savings.py:288-346`, and exports `HEADROOM_PROTECT_READS=1 HEADROOM_DEDUPE=1 HEADROOM_LOSSLESS_THEN_LOSSY=1` (what the `coding` profile seeds). Fixtures are synthetic except the source files. The wheel logged `Native content detection requires ONNX Runtime 1.24+; using pure-Python detection`, so detection in your Docker image may differ at the margin. **No finding was confirmed against your live container.**
- **[inference]** reasoned from code, not observed.

Applicability uses: **applies**, **not applicable**, **unclear**.

Facts you already have (TS syntax breaker #3387, stateless cache bust, `// [N lines omitted]`, `DEFAULT_EXCLUDE_TOOLS` for Read/Glob, SmartCrusher field drop #3648, TPM limiter #3806) are not re-researched. Two of your assumptions are corrected below: `protect_recent_code=4` does **not** protect code under the `coding` profile (P10), and `compress_user_messages` is **on** under that profile despite the doc default of `false` (P1).

## Summary

| # | Pitfall | Applies | Severity | Where to guard |
|---|---|---|---|---|
| P1 | Plugin discards the entire result when the server changes a message the plugin did not mark as candidate (user messages; tool results < 2000 chars) | applies | high | plugin + server env |
| P2 | `pi_tool_result` alias strips Read/Grep exclusion; OMP hashline anchors destroyed | applies (until planned rename ships) | high | plugin |
| P3 | Plugin sends no real tool arguments, so bash `cat`/`sed` read protection and bash-search detection are blind | applies | high | plugin |
| P4 | Any `HeadroomHttpError` disables compression for the session; raw fail-open busts the provider cache in session mode | applies | high | plugin |
| P5 | Savings counter sums per-call cumulative savings | applies | medium | plugin |
| P6 | Cross-turn dedup replaces a re-read with `[↑NL same as msg M]` pointers; breaks hashline edits | applies | high | server env or plugin alias |
| P7 | Build/test/log folding drops failing tests and compiler errors; `error_output` protection is narrow | applies | high | plugin + server |
| P8 | Search output silently truncated, no marker (marker-free mode) | applies | high | server env + plugin |
| P9 | JSON re-encoded as columnar text; field-drop history | partly | low–medium | none needed; monitor |
| P10 | Code-aware elision; profile overrides `protect_recent_code`; `analysis_context` semantics | applies | medium | request config |
| P11 | CCR markers / `headroom_retrieve` | not applicable | — | keep `mode` unset |
| P12 | Non-excluded OMP tools that are exactness-sensitive (`find`, `ast_grep`, `ast_edit`, `lsp`, `github`, `task`) | applies | medium | server env |
| P13 | Kompress-off residuals (fallback strategy, dense-line elision, HTML) | mostly not applicable | low | server env |
| P14 | Replay state: 3900 s cache, 600 s tracker, restart wipes, single worker | applies | medium | ops |
| P15 | `/branch`, `/tree`, rewind, compaction: divergence from the frozen prefix | applies, safe by design | low | keep one session id per session file |
| P16 | Parallel tool calls and subagents sharing a session id | applies if id is shared | medium | plugin |
| P17 | Timeout alignment; 503 vs fail-open; quarantine | applies | medium | plugin + server env |
| P18 | Rate limit, token auth, body size | rate limit not applicable | low | none |
| P19 | Images | not applicable | — | plugin already strips |
| P20 | Savings % vs real bill; cache-write cost of any raw/changed prefix | applies | high | plugin accounting |
| P21 | TypeScript / Go / Rust specifics | applies | medium | see P7, P10 |

Recommended bundle: [Recommended configuration](#recommended-configuration). Verification: [Verification checklist](#verification-checklist).

---

## A. Defects in the current plugin that change what the planned work must do

### P1. The whole compression result is thrown away when any non-candidate message changes

- **Symptom.** `guardSkips` rises with `lastSkipReason = non-candidate-changed:user` or `non-candidate-changed:tool`; tokens saved stay near zero; the raw history is forwarded.
- **Root cause.** `applyCompressionResult` returns `{ ok: false }` if a message with `applyTo !== "toolResult"` differs after compression ([bridge.ts:61-79](../../packages/headroom/bridge.ts)). Only tool results ≥ `minMessageChars` (default 2000) are candidates ([bridge.ts:31](../../packages/headroom/bridge.ts), [config.ts:23](../../packages/headroom/config.ts)). The server does not share that floor:
  - `/v1/compress` merges `proxy_pipeline_kwargs(self.config)` into the pipeline kwargs ([openai.py:10891-10894](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L10891-L10894)). The `coding` profile sets `compress_user_messages=True`, `protect_recent=0`, `min_tokens_to_compress=10`, `min_chars_for_block=25` ([agent_savings.py:149-198](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/agent_savings.py#L149-L198), [agent_savings.py:288-346](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/agent_savings.py#L288-L346)). The docs table says `compress_user_messages` defaults to `false` ([proxy.mdx:575](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/docs/content/docs/proxy.mdx#L575)); that describes the request key, not the profile.
  - The request key cannot turn it off: the handler only copies it when truthy (`openai.py:10895-10896`).
- **Evidence.**
  - [harness] A middle user message holding a pasted 120-line log: 7706 → 1065 chars with `compress_user_messages=True`, both with and without `prefix_replay_guaranteed=True` (the first and newest user turns are protected, middle ones are not, per [content_router.py:5920-5927](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/content_router.py#L5920-L5927)). Unchanged with `compress_user_messages=False`.
  - [harness] A 1229-char and a 1859-char JSON array (both below 2000) were crushed to 460 and 680 chars by SmartCrusher.
- **Applicability.** Applies. The coding profile is your configuration.
- **Guard.**
  1. Server: `HEADROOM_COMPRESS_USER_MESSAGES=0`. It is honoured at v0.40.0 as an optional bool that overrides the profile ([cli/proxy.py:1387](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/cli/proxy.py#L1387), [agent_savings.py:339-342](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/agent_savings.py#L339-L342); closed as [#3935](https://github.com/headroomlabs-ai/headroom/issues/3935)). Check it with `curl -s http://127.0.0.1:8787/health | jq .config.compress_user_messages` from loopback ([server.py:3823-3825](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/server.py#L3823-L3825)).
  2. Plugin: treat **every** `tool`-role message as a candidate and apply every change the server returns. `minMessageChars` should only gate "is this call worth making", not "may this message change". In session mode this is not optional: the server records what it returned as the provider's cache contract, so any returned message the plugin does not forward desynchronises replay (see P4, P14).
  3. Do not "fix" user-message changes by ignoring them client-side in session mode; use the server env.

### P2. The `pi_tool_result` alias removes every protection

- **Symptom.** `read` output with hashline anchors is shortened and loses anchors; `edit` then fails or targets wrong lines.
- **Root cause.** `convertToolCall` renames every tool to `pi_tool_result` ([bridge.ts:158-168](../../packages/headroom/bridge.ts)). Headroom keys exclusion on the tool name from the assistant `tool_calls` ([content_router.py:5593-5606](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/content_router.py#L5593-L5606)); `DEFAULT_EXCLUDE_TOOLS` contains `read`, `grep`, `glob`, `edit`, `write`, `web_search` ([config.py:222-265](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/config.py#L222-L265)).
- **Evidence.** [harness] An OMP-shaped `[src/handlers.ts#1A2B]` + `N:line` read of 13 144 chars: tool `read` → unchanged (`router:excluded:tool`); tool `pi_tool_result` → 3 357 chars, `[181 lines omitted: 40 ERROR]`, anchors reduced to 59 lines.
- **Applicability.** Applies today; the planned real-name change fixes it. It is necessary but not sufficient (P3, P6).
- **Guard.** Send `message.toolName` (present on OMP `ToolResultMessage`, `pi-ai/src/types.ts:1182`) as the function name. Do not invent new aliases for tools that are already excluded.

### P3. Arguments are dropped, so Headroom cannot recognise shell reads or searches

- **Symptom.** `bash cat file.ts` / `sed -n` output is code-aware-elided even with real tool names.
- **Root cause.** The plugin sends `arguments = {"originalToolName": …}` instead of the real arguments ([bridge.ts:163-165](../../packages/headroom/bridge.ts)). Read protection (`HEADROOM_PROTECT_READS`) and `_bash_search_fold` look at `command`/`cmd` in the arguments ([content_router.py:555-572](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/content_router.py#L555-L572), [content_router.py:5631-5650](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/content_router.py#L5631-L5650), [content_router.py:6737-6760](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/content_router.py#L6737-L6760)). `read_protection_enabled()` is off unless `HEADROOM_PROTECT_READS` is set ([content_router.py:541-552](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/content_router.py#L541-L552)); the `coding` profile seeds it only through CLI entry-point env defaults ([agent_savings.py:391-410](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/agent_savings.py#L391-L410)).
- **Evidence.** [harness] 30 030-char `index.ts` through tool `bash`: with `{"command":"cat …"}` → `router:read_protected`, unchanged. With `{"originalToolName":"bash"}` → `router:code_aware:0.41`, 12 312 chars, `// [98 lines omitted; calls: applyLiveConfig, createRuntime, …]`.
- **Applicability.** Applies. OMP models do `cat`/`sed -n` through `bash` regularly even though `read` exists.
- **Guard.** Send `JSON.stringify(toolCall.arguments)` as `function.arguments`. Set `HEADROOM_PROTECT_READS=1` explicitly. Arguments must be a string: a non-string `arguments` returned 503 before [#2782](https://github.com/headroomlabs-ai/headroom/issues/2782) was fixed; `JSON.stringify` already satisfies that.

### P4. One error switches compression off; raw fail-open busts the cache

- **Symptom.** After a single 503, compression silently stops for the rest of the OMP session; the next call re-writes the whole prompt cache.
- **Root cause (plugin).** `recordCompressionError` sets `compressionAvailable = false` for every `HeadroomHttpError`, including 429/503 ([index.ts:460-470](../../packages/headroom/index.ts)); it only clears after a successful `/health` ([index.ts:361-373](../../packages/headroom/index.ts)). Also, any "skip" (`tokensSaved <= 0`, `candidateCount === 0`, apply failure) forwards the **raw** history ([index.ts:399-430](../../packages/headroom/index.ts)).
- **Root cause (server).** In session mode "whatever this endpoint previously RETURNED is the provider's cache contract" ([session_engine.py:37-52](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/session_engine.py#L37-L52)). The provider cached the compressed bytes you forwarded; forwarding raw originals changes the prefix at the first compressed message. The docs say so: "Timeouts and busy sessions are a `503`, never fail-open … retry the turn" ([proxy.mdx:694](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/docs/content/docs/proxy.mdx#L694)), and the handler comment explains why handing back originals desyncs ([openai.py:11168-11184](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L11168-L11184)). Cost of getting it wrong: [OpenClaw #3809](https://github.com/headroomlabs-ai/headroom/issues/3809) measured cache reads 98 624 → 0 and cache writes 93 290 after a turn that saved 267 tokens; "the turn cost roughly 4,000× what the compression saved".
- **Applicability.** Applies. This weakens your plan item "fail open on 503/`compression_skipped`": that is correct for a **stateless** call, wrong for session mode unless you replay.
- **Guard.**
  1. Retry 503 `compression_timeout` once or twice with short backoff before giving up; the docs state the retry lands on consistent state.
  2. Keep a plugin-side replay memo `toolCallId → compressed text` filled from every successful response (memory only, drop on `session_start`/compaction). On any failure or skip, still substitute memoised text for known tool results and leave only unseen ones raw. This preserves the forwarded prefix without the server.
  3. Only set `compressionAvailable=false` for 400/401/404 (configuration errors). Treat 429/503/timeouts as transient.
  4. A stateless 200 with `compression_skipped: true` / `skip_reason: "compression_timeout"` ([openai.py:11249-11263](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L11249-L11263)) cannot occur in session mode; in session mode only the 503 exists.

### P5. The plugin's savings counter overcounts

- **Root cause.** `recordAppliedCompression` adds `result.tokensSaved` on every call ([index.ts:452-458](../../packages/headroom/index.ts)). In session mode the server reports savings "against the caller's RAW payload", not the cache-swapped input ([openai.py:11034-11061](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L11034-L11061)); that is a running total over the whole history each turn. Summing it counts one removed token once per remaining turn. Headroom's own docs for the same effect on Responses: "roughly twenty times on a twenty-turn conversation" ([conversation_savings.py:1-45](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/conversation_savings.py#L1-L45)). The `/v1/compress` outcome carries no conversation key, so `/stats` falls back to the per-request number ([outcome.py:612-625](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/outcome.py#L612-L625)) **[inference]**.
- **Guard.** Show last-call `tokens_before → tokens_after`, not a lifetime sum. If a lifetime figure is wanted, add only the positive delta between consecutive calls of the same session. See P20 for dollars.

---

## B. Content fidelity

**Structural cause behind P7, P8, P10: marker-free mode switches off Headroom's own reversibility guard.** The router refuses to replace tool output with a lossy result that carries no CCR retrieve marker ("tool ground truth must stay reversible", #1307), but only when `self.config.ccr_inject_marker` is true ([content_router.py:6439-6457](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/content_router.py#L6439-L6457); strategy set `KOMPRESS, TEXT, CODE_AWARE, HTML` at [content_router.py:2119-2126](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/content_router.py#L2119-L2126)). The default `/v1/compress` pipeline sets `ccr_inject_marker=False` ([openai.py:10547-10551](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L10547-L10551)), so lossy code-aware elision is accepted unmarked. The Log and Search compressors are not in that set at all, so they were never covered. In this mode the only recovery is for the agent to re-run the tool, and it will only do that if it notices output was cut **[inference]**. Switching to `config.mode="ccr"` would restore the guard but emits `Retrieve more: hash=` markers OMP cannot redeem (P11), so it is not an option.

### P6. Cross-turn dedup rewrites a re-read into pointers (high risk for OMP edits)

- **Symptom.** After an edit, the model re-reads a file and gets `[↑50L same as msg 2 +2L: 'export function f...']` instead of the lines. Edits then use anchors from an older snapshot, or the model loops re-reading.
- **Root cause.** `coding` seeds `HEADROOM_DEDUPE=1` ([agent_savings.py:149-198](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/agent_savings.py#L149-L198)); the router then folds a later tool output span that appeared verbatim earlier ([content_router.py:6787-6932](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/content_router.py#L6787-L6932)). Headroom deliberately lets read tools keep dedup: `DEFAULT_BYTE_EXACT_EXCLUDE_TOOLS` only blocks the lossless fold, "dedup is worth ~66% of those tokens" ([config.py:292-350](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/config.py#L292-L350)). Only `view`, `web_search`, `web_fetch` and `headroom_retrieve` are dedup-exempt ([config.py:278-290](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/config.py#L278-L290)). `msg M` is Headroom's index into the **plugin's filtered** OpenAI array; OMP never shows message numbers to the model.
- **Upstream precedent.** [#3190](https://github.com/headroomlabs-ai/headroom/issues/3190): models read the pointer as deleted content, retried reads in a loop (~200 turns), and one run "committed unresolved `<<<<<<<` markers" after a folded listing hid 4 of 5 conflicted files. The fix only disables pointers on the OpenAI-chat **streaming** proxy path (`cross_turn_dedup_recoverable=False`, [openai.py:4247](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L4247)); `/v1/compress` keeps the default `True` ([content_router.py:5578](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/content_router.py#L5578)).
- **Evidence.** [harness] Two OMP-style reads of one file around an edit (`#1A2B` then `#9F3C`, 2 inserted lines): tool `read` → 5 914 → 147 chars (`router:cross_turn_dedup:2`), tool `grep` → same, tool `view` → 5 914 → 5 914. Same effect for a repeated `bash` listing (`[↑40L same as msg 2: …]`).
- **Applicability.** Applies; your live log line `router:cross_turn_dedup` is this transform. OMP edit anchors are `LINE` + file `#TAG` from the latest read/search, so a pointer to an earlier snapshot is the worst shape.
- **Guard (pick one).**
  - Server: `HEADROOM_DEDUPE=0`. Explicit env wins over the profile (`setdefault` semantics, [agent_savings.py:100-104](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/agent_savings.py#L100-L104)). Cost: lose the repeated-read saving.
  - Plugin: send OMP's anchor-bearing tools (`read`, `grep`, `ast_grep`, `find`/`glob` if anchored) under the verbatim name `view`. [harness] confirmed no dedup, no fold. Keeps dedup for plain `bash` output, but pointers there still reference an unnumbered `msg M`; start with `HEADROOM_DEDUPE=0` and A/B later.

### P7. Build, test, and log output: lossy folding drops the failure; error protection is narrow

- **Symptom.** Compiler errors and failing tests silently reduced to a sample; the model reports "only 9 errors" or cannot find which test failed.
- **Root cause.**
  - `router:protected:error_output` applies only to role `tool` content that is ≤ 8000 chars **and** contains ≥ 2 distinct keywords from `error, fail, exception, traceback, fatal, panic, crash` after zero-result phrases like `0 errors` are stripped ([content_router.py:6128-6140](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/content_router.py#L6128-L6140), [error_detection.py:229-283](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/error_detection.py#L229-L283), [keyword_detector.rs:108-116](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/crates/headroom-core/src/signals/keyword_detector.rs#L108-L116)). Above 8000 chars it falls through to `LogCompressor`.
  - A typical `tsc`, `rustc`, or `go test` failure uses **one** distinct keyword (`error`, or `fail`), so it is not protected even when short. `cargo test` panics add `panic` and are protected only if ≤ 8000 chars.
  - `LogCompressor` keeps head, tail and error-scored lines and emits `[N lines omitted: …]`. In the marker-free sidecar mode there is no retrieve hash.
- **Evidence.** [harness], `bash` tool, coding kwargs, Kompress off:

  | fixture | chars in → out | what survived |
  |---|---|---|
  | `tsc`, 60 errors | 6 014 → 1 643 | 16 of 60 file paths; `[44 lines omitted: 60 ERROR]` |
  | `rustc`, 40 E0308 | 8 019 → 469 | 4 of 40 `--> src/modN.rs` locations, no code snippets |
  | `cargo test`, 60 failures | 9 521 → 2 323 | 12 of 60 failing test names, **0** `panicked at file:line` lines |
  | `go test`, 50 failures | 3 458 → 3 364 | all 50 names |

  `strong_error_indicators` was `False` for tsc, rustc and go test, `True` for cargo test (above the size cap).
- **Upstream status.** [#3814](https://github.com/headroomlabs-ai/headroom/issues/3814) (pytest short-summary `FAILED` lines dropped) is fixed in v0.40.0 by #3828, which also names omitted ids; that fix is pytest-specific and does not help cargo/tsc/go. [#4070](https://github.com/headroomlabs-ai/headroom/issues/4070) (marker counts levels over the whole input, e.g. `[394 lines omitted: 1 ERROR, 400 INFO]` while the ERROR line is kept) is **open** in v0.40.0. [harness] reproduced it: `[54 lines omitted: 1 ERROR, 60 INFO]`.
- **Applicability.** Applies, and it is the main hazard for Go/Rust/TS work.
- **Guard.**
  1. Plugin: when `message.isError` or `message.details?.exitCode` is non-zero (`bash.ts:705` sets `details.exitCode`), send that call under a verbatim-set name (`view`) so it is untouched. Passing runs rarely have a failure to lose. Full bash outputs the model may need whole (`cargo test` failures) are the minority of bytes.
  2. Server A/B lever: `HEADROOM_COMPRESSORS=smart_crusher,tabular,config,code_aware` disables the log and search compressors ([server.py:878-888](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/server.py#L878-L888)). [harness] with log/search/html off: tsc, rustc, go test, cargo test, rg, app log all stay at 100 %; only JSON arrays still shrink.
  3. `HEADROOM_LOSSLESS=1` is not a useful substitute here: [harness] it left all seven fixtures at 100 % (the lossless folds need repeated structure; real timestamps/ids defeat them). Keep it as an emergency kill switch only.

### P8. Search output is silently truncated in marker-free mode

- **Symptom.** `rg`/`grep` run through `bash` returns a short list that looks complete.
- **Root cause.** Default `/v1/compress` is marker-free: "no `<<ccr:…>>` retrieval markers and writes nothing to the CCR store" ([proxy.mdx:582](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/docs/content/docs/proxy.mdx#L582), [openai.py:10530-10551](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L10530-L10551)). The lossy `SearchCompressor` then drops matches and leaves no placeholder.
- **Evidence.** [harness] 120 `path:line:text` matches over 12 directories via `bash` + `rg -n …`: 9 069 → 1 127 chars, 15 lines, only `mod0/` and `mod1/` present, **no omission line**. Same text under tool `grep`: unchanged (`router:excluded:tool`). Related fixed upstream: [#3545](https://github.com/headroomlabs-ai/headroom/issues/3545) (fused matches; fixed by #3788, in 0.40.0), [#3580](https://github.com/headroomlabs-ai/headroom/issues/3580) (`grep -A/-B/-C` context lines as prose, #3599 in 0.38.0), [#3736](https://github.com/headroomlabs-ai/headroom/issues/3736) (ISO-timestamp logs as search, #3748 in 0.39.0), [#3220](https://github.com/headroomlabs-ai/headroom/issues/3220) (datetime-prefixed user prompt classified as search and deleted; #3221 in 0.37.0).
- **Applicability.** Applies for `bash`-run searches; native `grep` is excluded by name.
- **Guard.** Same as P7 item 2 (`HEADROOM_COMPRESSORS` without `search`/`log`). Or plugin: send `bash` calls whose command starts with `rg|grep|git grep|find|fd|ls` under `view`. [issue] The "line number is the coordinate the agent acts on" argument is in #3545.

### P9. JSON tool output

- **Symptom / history.** SmartCrusher dropped non-null fields from MCP results ([#3634](https://github.com/headroomlabs-ai/headroom/issues/3634), fixed by #3648 in 0.38.0; you already track it). [#4044](https://github.com/headroomlabs-ai/headroom/pull/4044) ("preserve unchanged JSON bytes") is open.
- **Evidence.** [harness] A homogeneous 60-object array became a lossless columnar form, `[60]{id:int,line:int,path:string,status:string}` followed by `0,0,src/file_0.ts,ok` rows (3 987 → 1 578 chars), all 60 rows present including the one `FAILED` row. No row loss at this size.
- **Applicability.** Partly. The columnar re-encoding is a format change the model must read; it is lossless here. Field-drop risk is closed in 0.40.0. Tool-result JSON under 2000 chars still trips P1.
- **Guard.** None beyond P1. Spot-check any MCP JSON with `/v1/compress` and `transforms_applied` before trusting it for structured edits.

### P10. Code-aware elision, `protect_recent`, and `analysis_context`

- **Symptom.** `// [98 lines omitted; calls: …]` replaces function bodies; the model edits or reasons from a signature-only view.
- **Corrected assumption.** `protect_recent_code=4` is the router default, but the router uses `kwargs.get("protect_recent", self.config.protect_recent_code)` ([content_router.py:5529](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/content_router.py#L5529)) and the `coding` profile passes `protect_recent=0`. [harness] same 30 KB TS file, `protect_recent=0` → `router:code_aware:0.41` (12 312 chars); `protect_recent=4` → `router:protected:recent_code`, unchanged. The per-request `config.protect_recent` is accepted ([openai.py:10776](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L10776), [openai.py:10899-10900](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L10899-L10900)).
- **`router:protected:analysis_context`.** Code-typed tool output is left alone when the **most recent user message** contains any of `analyze, review, audit, inspect, security, bug, issue, problem, explain, understand, how does, what does, debug, fix, error, wrong, broken, refactor, improve, optimize, clean up` as a substring ([content_router.py:7570-7615](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/content_router.py#L7570-L7615), applied at `content_router.py:6162-6169`). It is a protective switch that reads one message, so it flips whole runs on or off by the wording of the opening prompt, not by content. It fires on "fix", "issue" or "error" in nearly every coding prompt, so code-aware savings will be low in practice.
- **Code-aware quality history.** [#1233](https://github.com/headroomlabs-ai/headroom/issues/1233) (AST output failed syntax verification on 28 % of real Python files; the guard returns the original, so it fails safe), [#1318](https://github.com/headroomlabs-ai/headroom/issues/1318) (Rust/Java/C++ method bodies unreachable; fixed), [#1905](https://github.com/headroomlabs-ai/headroom/issues/1905) (TS `export` duplicated, doc comments detached; fixed). Supported languages include TypeScript, Go and Rust ([code_compressor.py:320-336](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/code_compressor.py#L320-L336)). [harness] a 60 KB `log_compressor.rs` and a 60 KB Python file were not compressed at all by this config (`router:noop`); only the TypeScript file was. Do not count on code-aware savings for Rust or Go.
- **Applicability.** Applies.
- **Guard.** Send `config: { protect_recent: 8 }` (the number must cover a whole parallel tool-call batch). In session mode freshly arrived code is then forwarded raw and, once forwarded, stays raw (frozen). This effectively disables code-aware for new reads, which is the safe choice for an editing agent. Keep `read` under its real name so reads never reach the compressor anyway.

### P11. CCR markers and `headroom_retrieve`

- **Not applicable in default mode.** The default pipeline sets `ccr_inject_marker=False, ccr_enabled=False` ([openai.py:10547-10551](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L10547-L10551)), `ccr_hashes` is empty, and OMP has no retrieve tool. Open CCR bugs ([#3544](https://github.com/headroomlabs-ai/headroom/issues/3544), [#3383](https://github.com/headroomlabs-ai/headroom/issues/3383), [#4145](https://github.com/headroomlabs-ai/headroom/issues/4145), [#3563](https://github.com/headroomlabs-ai/headroom/issues/3563)) concern `config.mode="ccr"` only.
- **Guard.** Never send `config.mode`. If a response ever carries `ccr_hashes` or text matching `Retrieve more: hash=`, treat it as a configuration error: the model cannot redeem it. [#3098](https://github.com/headroomlabs-ai/headroom/issues/3098) shows what markers do to agents (a "file is corrupt" conclusion propagated into a child prompt).
- **Residual.** The marker-free `[N lines omitted]` lines are not recoverable either; the only recovery is re-running the command. Hallucination from omitted lines ([#2586](https://github.com/headroomlabs-ai/headroom/issues/2586): "absence of a line reads as evidence of absence") is the generic risk; P7 and P8 guards are the mitigation.

### P12. OMP tools that Headroom does not exclude

OMP built-ins ([builtin-names.ts](../../node_modules/@oh-my-pi/pi-coding-agent/src/tools/builtin-names.ts)): `read bash edit ast_grep ast_edit ask debug ida eval github glob grep find lsp checkpoint rewind context_notes new_context security_scan task wait todo web_search write memory_edit retain recall reflect learn manage_skill`. Default exclusion covers only `read`, `glob`, `grep`, `edit`, `write`, `web_search` among them ([config.py:222-265](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/config.py#L222-L265)). `find`, `ast_grep`, `ast_edit`, `lsp`, `github`, `debug`, `task` outputs are compressible and carry anchors, positions, or exact summaries.

- **Guard.** `HEADROOM_PROTECT_TOOL_RESULTS=find,ast_grep,ast_edit,lsp,github,task` merges into the exclusion set ([server.py:1100-1122](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/server.py#L1100-L1122)). Side effect: it also resets `protect_recent_reads_fraction` to `0.0`, which matters only if someone switches the proxy to token mode (then old Read results become compressible after 30 % of history). Keep `HEADROOM_MODE` at its default `cache` ([server.py:6335-6338](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/server.py#L6335-L6338)); `/v1/compress` does not depend on it.

### P13. Kompress-off residuals

- Disabling Kompress leaves the fallback strategy `KOMPRESS` unless `HEADROOM_DISABLE_KOMPRESS_FALLBACK=1` ([server.py:1082-1087](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/server.py#L1082-L1087)); set it so unmatched content passes through. [harness] with Kompress disabled, unmatched text routed to `router:noop`.
- Word-dropping hazards [#3099](https://github.com/headroomlabs-ai/headroom/issues/3099) (output of two commands fused into one false line) and [#3423](https://github.com/headroomlabs-ai/headroom/issues/3423) (bash `then/fi` dropped) were Kompress behaviours; #3119 (line boundaries) is in 0.40.0. Not applicable with Kompress off.
- Dense-line elision (minified JS, base64 lines ≥ 300 chars, ≥ 2000 dense chars per block) keeps 160 head + 80 tail chars and writes an inline `...[N chars of dense machine-generated content elided]...`; in marker-free mode there is no hash to recover the middle ([dense_line_elider.py:48-75](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/dense_line_elider.py#L48-L75), CCR branch at [content_router.py:4370-4379](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/content_router.py#L4370-L4379)). The HTML extractor drops script/style and keeps prose ([#3775](https://github.com/headroomlabs-ai/headroom/issues/3775): booked as ~99.8 % savings, original unrecoverable). Relevant to OMP `bash curl …` / `cat dist/*.js`; low frequency in TS/Go/Rust work.

---

## C. Session mode

State is per `config.session_id`: key `compress\x00<id>` in the process-wide compression-cache registry and the prefix-tracker store ([openai.py:10922-10939](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L10922-L10939)). Id must be a non-empty string ≤ 256 chars ([openai.py:10824-10838](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L10824-L10838)); `session_id` with a truthy `compress_user_messages` is a 400 ([openai.py:10839-10859](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L10839-L10859)). One turn is one executor job under a per-session lock ([openai.py:10963-11074](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L10963-L11074)).

### P14. Replay-state lifetime

| State | Lifetime at v0.40.0 | Source |
|---|---|---|
| Compression cache (hash → compressed text; byte-replay of tool results) | 3900 s idle; ≥ 600 s floor; 500 sessions; 10 000 entries each | [helpers.py:1436-1483](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/helpers.py#L1436-L1483) |
| Prefix tracker (`prev_original`, `prev_returned`) | 600 s idle | [prefix_tracker.py:69](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/cache/prefix_tracker.py#L69), [proxy.mdx:695](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/docs/content/docs/proxy.mdx#L695) |
| Everything | in-process; lost on container restart; one worker by default | [models.py:575](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/models.py#L575) |

- **What expiry does.** Tool results are swapped from the cache by content hash ([compression_cache.py:332-353](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/cache/compression_cache.py#L332-L353)); this is independent of the tracker. After 600 s the tracker is gone but the swap still protects the prefix until 3900 s; the comment at `helpers.py:1447-1457` says so. After 3900 s idle (or a restart, or LRU eviction), the same tool result is recompressed. Compression depends on the conversation context (relevance), so the new bytes can differ from what the provider still caches; one prefix re-write follows. **[inference]** on the "can differ" part.
- **Upstream.** [#4017](https://github.com/headroomlabs-ai/headroom/issues/4017) (tracker dropped at 600 s though the provider cache lives 1 h) was fixed by PR #4023 merged 2026-10-07 — **after** the 2026-10-06 v0.40.0 release, so it is not in your image. It concerns token-mode lineage; the sidecar impact is limited by the 3900 s cache.
- **Guard.** Do not `docker restart` mid-session; restart only after the provider cache has lapsed (5 min, or 1 h if OMP requests the 1 h tier). Keep `HEADROOM_COMPRESSION_CACHE_TTL_SECONDS` at 3900. Keep one worker; never put replicas behind the tunnel without session-pinning ([proxy.mdx:695](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/docs/content/docs/proxy.mdx#L695)). Plugin memo (P4) covers a server restart.

### P15. `/branch`, `/tree`, rewind, compaction: what the server does with a diverging history

- **Behaviour (all [source]).**
  1. `compute_frozen_count` walks from message 0 and counts messages until the first tool result whose **content hash** is unknown; the last message is always excluded ([compression_cache.py:293-330](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/cache/compression_cache.py#L293-L330)). Position does not matter, content does.
  2. `apply_cached` swaps known compressed bytes anywhere in the list by hash. A tool result that is identical on the other branch gets identical compressed bytes.
  3. `finalize_turn` → `overlay_cached_prefix` replays the previous turn's returned bytes **only for the longest leading run that is canonically equal to the previous originals**, and stops at the first divergence; the rest is this turn's fresh output ([prefix_tracker.py:684-706](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/cache/prefix_tracker.py#L684-L706)). Divergence at message 0 returns the pipeline output as is (`prefix_tracker.py:690-695`); a mismatch between forwarded/original counts or list lengths also returns it unchanged ([prefix_tracker.py:574-600](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/cache/prefix_tracker.py#L574-L600)). The docstring: "accept a possible bust rather than forward wrong content".
  4. `record_returned` then overwrites the tracker snapshot with the new branch ([openai.py:11061-11066](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L11061-L11066)). Navigating back to the old branch diverges early against the new snapshot, but the old branch's tool results are still in the hash cache.
- **Result.** No corruption path found. A branch costs at most the provider re-write the divergence already forces; shared prefix tool results stay byte-identical through the hash cache. After OMP compaction (head replaced by a summary) divergence is at message 0, so only the hash cache applies.
- **Guard.** Use one stable session id per OMP session file (`ctx.sessionManager.getSessionId()`, `extensions/types.ts:1350`); do **not** mint a new id on `session_branch`/`session_tree` (that throws away the hash cache and forces recompression). The plugin currently resets stats on `session_branch` ([index.ts:143](../../packages/headroom/index.ts), `resetSession`); keep the P4 memo across it. [harness] not run; behaviour derived from code only.

### P16. Parallel tool calls and subagents

- Parallel tool calls within one assistant turn are one `context` event and one request, so they do not race. A concurrent second turn for the same id waits up to `_SESSION_TURN_LOCK_TIMEOUT_SECONDS = 10` s, then 503 `compression_timeout` ([openai.py:1735-1741](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L1735-L1741), [openai.py:10986-10992](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L10986-L10992)).
- Two unrelated conversations sharing an id would also overwrite each other's `record_returned` snapshot and, by hash, share compressed bytes. The docs warn about this for the header: "Claude Code subagents do this" ([proxy.mdx:696](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/docs/content/docs/proxy.mdx#L696)). Related upstream tracker-thrash reports: [#2085 fix in changelog "Unreleased"](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/CHANGELOG.md) (proxy path only), [#4156](https://github.com/headroomlabs-ai/headroom/issues/4156) (open; a throwaway side request adopted as the lineage, next turn re-writes the cache). The sidecar analogue: any OMP side call that fires the same `context` handler with a different message list under the same id.
- **Guard.** Derive the id from the **agent loop**, not the process: OMP session id plus subagent/task id if the subagent loads the extension. Never use a constant. Never enable `HEADROOM_COMPRESS_SESSION_FROM_HEADER`. Skip compression (and do not touch the memo) for side calls that are not the main loop. Retry the 10 s lock 503 like P4.

### P17. Timeouts and quarantine

- Server compression deadline is 30 s (`HEADROOM_COMPRESSION_TIMEOUT_SECONDS`, [helpers.py:1403-1408](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/helpers.py#L1403-L1408)). The plugin's client timeout is also 30 s ([config.ts:24](../../packages/headroom/config.ts)). If the client aborts first, the server worker keeps running and may still record "returned" while the plugin forwarded raw: the desync the 503 design avoids.
- Stateless timeout fails open with 200 + `compression_skipped`; session timeout is 503 ([openai.py:11168-11263](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L11168-L11263)). A timed-out worker cannot be cancelled; when ≥ half the pool is stuck, new calls get `CompressionQuarantinedError` (a `TimeoutError`, so 503 in session mode) for up to 60 s ([server.py:1605-1692](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/server.py#L1605-L1692)). One straggler used to quarantine everything ([#3931](https://github.com/headroomlabs-ai/headroom/issues/3931)); #3932 (half the pool) is in 0.40.0. [#3653](https://github.com/headroomlabs-ai/headroom/issues/3653) (thread/fd leak) is open; triage there says the `/health` counter is cumulative, not a gauge.
- [harness] pipeline-only latency for a 1.6 MB, 122-message payload: 0.56 s cold, 0.10 s warm. Real calls add JSON transfer, tokenisation and tunnel time. Large histories grow the body linearly on every LLM call.
- Upstream hang reports are Kompress- or image-driven ([#3711](https://github.com/headroomlabs-ai/headroom/issues/3711), [#4139](https://github.com/headroomlabs-ai/headroom/issues/4139)); neither applies with Kompress off and images stripped.
- **Guard.** Plugin timeout > server timeout so the server's 503 arrives first (for example client 35 s, `HEADROOM_COMPRESSION_TIMEOUT_SECONDS=20`). On retry exhaustion use the P4 memo. Read `compression_executor` in `/health` (loopback) for `timed_out_workers` and `quarantine_active` when diagnosing.

---

## D. Operations

### P18. Rate limits, token auth, body size

- **Rate limit: not applicable.** `TokenBucketRateLimiter` (`--rpm` default 60) is consulted only in the Anthropic, Gemini, OpenAI chat and Responses proxy handlers ([anthropic.py:1320-1326](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/anthropic.py#L1320-L1326), [gemini.py:462-466](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/gemini.py#L462-L466), [openai.py:3852-3855](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L3852-L3855), [openai.py:6262-6265](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L6262-L6265)). `handle_compress` ([openai.py:10581-11273](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L10581-L11273)) contains no limiter call; the whole `headroom/` tree has no other call site. A single tunnel IP therefore cannot hit `--rpm`. The #3860 rule (key by peer unless authenticated) is moot for this route. Guard: none. If you see 429 on `/v1/compress`, it is not Headroom's limiter; check Cloudflare or the tunnel.
- **Auth.** `HEADROOM_PROXY_TOKEN` missing/wrong → 401; remote without `HEADROOM_COMPRESS_ALLOW_REMOTE=1` → 404 ([proxy.mdx:619-627](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/docs/content/docs/proxy.mdx#L619-L627); detail in [headroom-0.37-docker-compression.md](headroom-0.37-docker-compression.md)). 401/404 are configuration errors: surface them to the user (P4 item 3) rather than retry.
- **Body size.** 100 MB ceiling, 413 beyond ([helpers.py:1238-1239](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/helpers.py#L1238-L1239)). Cloudflare Tunnel has its own request limit; not researched.
- **Compression of unknown models.** The plugin falls back to `gpt-4o` when `ctx.model?.id` is empty ([client.ts:126](../../packages/headroom/client.ts)). Model name picks the tokenizer and the cache provider (`claude`/`anthropic` substring → `anthropic`, else `openai`, [openai.py:10931-10935](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L10931-L10935)). A wrong model skews `tokens_*` only.

### P19. Images

Not applicable. The plugin sends only text: image-only user messages become a one-line placeholder and tool-result images are dropped from the payload ([bridge.ts:112-126](../../packages/headroom/bridge.ts), [bridge.ts:147-156](../../packages/headroom/bridge.ts)); images are re-attached on write-back ([bridge.ts:207-216](../../packages/headroom/bridge.ts)). Upstream image problems are server-side image compression ([#4139](https://github.com/headroomlabs-ai/headroom/issues/4139) memory pressure at 20 MB bodies; PR [#4142](https://github.com/headroomlabs-ai/headroom/pull/4142) open). Keep the plugin from ever forwarding image parts; `HEADROOM_COMPRESSORS` without `image` removes the server's image optimizer as defence in depth.

### P20. Cost accounting: "tokens saved" is not "dollars saved"

- Headroom's own correction note: a Claude Code session showed 97 % tokens saved on `/stats`; "'90% of tokens' is nowhere near '90% of the bill' (measured … 604 calls, ~$3.12 saved of ~$23.34, about 13%)" ([PR #3632](https://github.com/headroomlabs-ai/headroom/pull/3632)). Cached prefix tokens bill at the cache-read rate (about a tenth of input).
- A compressed token that is already cached is worth ~0.1 of an uncached one; changing bytes inside the cached prefix converts reads into writes at 1.25× (5 min) or higher (1 h tier). [OpenClaw #3809](https://github.com/headroomlabs-ai/headroom/issues/3809) is the same architecture as your plugin and measured the 4 000× loss; [PR #4177](https://github.com/headroomlabs-ai/headroom/pull/4177) (open) adds "skip compression while the prompt cache is warm" because compressing history the provider already cached "makes it re-write that history … to save tokens that would otherwise be billed at the cache-read rate (roughly 25x cheaper)".
- Another user-visible form: [#1636](https://github.com/headroomlabs-ai/headroom/issues/1636) (usage limit dropped to "half or less" after enabling Headroom; `cacheRead/cacheCreation` ratio fell from 20–60 to single digits).
- Negative savings: the sidecar clamps `tokens_saved = max(0, before − after)` and notes the replay can legitimately return a larger prefix ([openai.py:11094](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L11094), [openai.py:11149-11158](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L11149-L11158)). A displayed 0 can hide a net cost if the plugin forwarded raw.
- **Guard.** Treat the first send of a new tool result as the only point where compression pays at full price; keep every later send byte-identical (session mode + P4 memo). Judge the plugin by the provider's `cache_read`/`cache_creation` counters per OMP turn, not by `tokens_saved`. Optional: relay usage to `POST /v1/usage` for attribution; it is telemetry and never changes replay ([proxy.mdx:698-711](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/docs/content/docs/proxy.mdx#L698-L711)).

### P21. TypeScript, Go, Rust specifics

| Topic | Finding | Guard |
|---|---|---|
| TypeScript source | code-aware elides bodies (P10, #1905 fixed, #3387 already known); generics/JSX/decorators are where tree-sitter output fails syntax verification and the guard returns the original | `protect_recent`, real `read` name |
| `tsc` | one keyword (`error`) per line → not error-protected; 16 of 60 files kept [harness] | P7 item 1/2 |
| Go source | supported language; [harness] 14 KB file via `cat` was not touched | none needed |
| `go test` | `--- FAIL` lines all kept at 3.4 KB; `FAIL` has one indicator so larger runs fall to LogCompressor | P7 |
| Go build/vet | same single-keyword shape as tsc | P7 |
| Rust source | method bodies were unreachable until #1318; [harness] 60 KB file untouched | none needed |
| `rustc`/`cargo build` | 4 of 40 error locations kept [harness]; `-->` lines dropped | P7 |
| `cargo test` | `panicked at file:line` lines dropped, 12 of 60 failing names kept (> 8000 chars) [harness] | P7 |
| Macros / lifetimes | no upstream issue found; AST-only compressors bail to the original on parse failure | none |

---

## Recommended configuration

Server (Docker env; explicit env beats profile defaults):

```text
HEADROOM_COMPRESS_USER_MESSAGES=0         # P1
HEADROOM_DEDUPE=0                         # P6 (or use the `view` alias in the plugin)
HEADROOM_PROTECT_READS=1                  # P3, make it explicit
HEADROOM_DISABLE_KOMPRESS=1               # already set
HEADROOM_DISABLE_KOMPRESS_FALLBACK=1      # P13
HEADROOM_PROTECT_TOOL_RESULTS=find,ast_grep,ast_edit,lsp,github,task   # P12
HEADROOM_COMPRESSION_TIMEOUT_SECONDS=20   # P17; plugin timeout 35 s
# Optional A/B, trades savings for fidelity (P7, P8):
# HEADROOM_COMPRESSORS=smart_crusher,tabular,config,code_aware
# Leave unset: HEADROOM_COMPRESS_SESSION_FROM_HEADER, HEADROOM_LOSSLESS, config.mode
# Keep: one worker, HEADROOM_MODE default (cache), HEADROOM_COMPRESSION_CACHE_TTL_SECONDS=3900
```

Request body (`/v1/compress`): `{ "model": <real id>, "messages": …, "config": { "session_id": "<omp-session-id>[:<subagent-id>]", "protect_recent": 8 } }`. Do not send `compress_user_messages`, `mode`, or `frozen_message_count`.

Plugin changes, in priority order:

1. Real `toolName` and real stringified `arguments` (P2, P3).
2. Apply every tool-role change; gate only the decision to call (P1).
3. `session_id` per OMP session/agent loop; keep across branch/tree (P15, P16).
4. Retry 503/timeout; per-`toolCallId` replay memo; `compressionAvailable=false` only on 400/401/404 (P4).
5. Verbatim alias (`view`) for `isError`/non-zero-exit bash results, and for `read`/`grep`/`ast_grep` if `HEADROOM_DEDUPE` stays on (P6, P7, P8).
6. Report last-call before/after, not a lifetime sum (P5, P20).

## Verification checklist

1. Effective config (loopback): `curl -s http://127.0.0.1:8787/health | jq '.config | {savings_profile, compress_user_messages, protect_recent}'`. Expect `compress_user_messages: false`.
2. P1: POST a conversation with a 100-line log in the middle user message; `transforms_applied` must not contain a `router:log` for that index.
3. P3: tool `bash`, `arguments: {"command":"cat src/x.ts"}`, 30 KB TS output → `router:read_protected`.
4. P6: two `read` results for one file around an edit → no `router:cross_turn_dedup`.
5. P8: 120 `rg` matches via `bash` → compare line count in/out; with `HEADROOM_COMPRESSORS` lacking `search`, expect `router:noop`.
6. Session: call twice with the same `session_id` and an appended message; second response `session.cached_prefix_replayed: true` and the first N messages byte-identical to the first response.
7. After a deliberate 503 (kill the container mid-call), confirm the next OMP call still forwards the same bytes for known tool results (P4 memo), and that provider `cache_read` does not drop to the system+tools head.
8. Watch `/health` `compression_executor.timed_out_workers` during long sessions (P17).

## Primary sources

- [Release v0.40.0](https://github.com/headroomlabs-ai/headroom/releases/tag/v0.40.0) and [CHANGELOG, 0.40.0 section](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/CHANGELOG.md#L287-L481)
- [`handlers/openai.py` `handle_compress`](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/handlers/openai.py#L10581-L11273), [`session_engine.py`](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/proxy/session_engine.py), [`prefix_tracker.py`](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/cache/prefix_tracker.py), [`compression_cache.py`](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/cache/compression_cache.py)
- [`content_router.py`](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/content_router.py), [`config.py` exclusion sets](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/config.py#L207-L350), [`agent_savings.py` `coding` profile](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/agent_savings.py#L149-L198), [`error_detection.py`](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/headroom/transforms/error_detection.py)
- [Proxy docs: `/v1/compress`, session mode](https://github.com/headroomlabs-ai/headroom/blob/855390d6110e0bbb199d9b97025baac16c2f5cf3/docs/content/docs/proxy.mdx#L571-L711)
- Issues: [#2586](https://github.com/headroomlabs-ai/headroom/issues/2586), [#3099](https://github.com/headroomlabs-ai/headroom/issues/3099), [#3190](https://github.com/headroomlabs-ai/headroom/issues/3190), [#3545](https://github.com/headroomlabs-ai/headroom/issues/3545), [#3580](https://github.com/headroomlabs-ai/headroom/issues/3580), [#3652](https://github.com/headroomlabs-ai/headroom/issues/3652), [#3736](https://github.com/headroomlabs-ai/headroom/issues/3736), [#3809](https://github.com/headroomlabs-ai/headroom/issues/3809), [#3814](https://github.com/headroomlabs-ai/headroom/issues/3814), [#3935](https://github.com/headroomlabs-ai/headroom/issues/3935), [#3931](https://github.com/headroomlabs-ai/headroom/issues/3931), [#4017](https://github.com/headroomlabs-ai/headroom/issues/4017), [#4070](https://github.com/headroomlabs-ai/headroom/issues/4070), [#4139](https://github.com/headroomlabs-ai/headroom/issues/4139), [#4156](https://github.com/headroomlabs-ai/headroom/issues/4156), [#1636](https://github.com/headroomlabs-ai/headroom/issues/1636)
- PRs: [#3270](https://github.com/headroomlabs-ai/headroom/pull/3270) (session-aware `/v1/compress`), [#3632](https://github.com/headroomlabs-ai/headroom/pull/3632), [#4023](https://github.com/headroomlabs-ai/headroom/pull/4023), [#4177](https://github.com/headroomlabs-ai/headroom/pull/4177)
- Plugin: [`bridge.ts`](../../packages/headroom/bridge.ts), [`client.ts`](../../packages/headroom/client.ts), [`index.ts`](../../packages/headroom/index.ts), [`config.ts`](../../packages/headroom/config.ts)
- OMP types: `@oh-my-pi/pi-ai` `ToolResultMessage` (`isError`, `toolName`, `details`); `@oh-my-pi/pi-coding-agent` `ctx.sessionManager.getSessionId()`
