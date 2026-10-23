# @codesook/omp-headroom

Headroom context-compression producer for [oh-my-pi](https://github.com/can1357/oh-my-pi).

- compresses large `toolResult` messages before provider requests, in Headroom session mode (`config.session_id` = the OMP session id);
- keeps every result it forwarded compressed byte-identical on later requests, so the provider prompt cache is not broken;
- never offers failed tool results or RTK-processed bash results to Headroom;
- shows Headroom Savings per Agent Session once Headroom has saved tokens;
- uses externally managed Headroom proxy; session start performs health check only and never starts Docker/Cloudflare/proxy processes;
- publishes one complete Headroom display sequence through `@codesook/omp-shared-display`;
- never mounts a widget, installs a timer, or captures another producer's `setStatus` output.

Quota and subscription usage are not included.

## Requirements

- Bun 1.4.0 or newer for local development;
- OMP 18.1.16 or newer;
- `@oh-my-pi/pi-coding-agent`, `@oh-my-pi/pi-tui`, and `@oh-my-pi/pi-ai` `>=18.1.16`;
- externally managed Headroom proxy reachable at configured URL.

Headroom does not install, start, or stop proxy processes. Run Docker/Cloudflare or another external deployment separately. `/headroom health` checks reachability.

Root feature (on by default):

```sh
omp plugin install 'github:seenark/omp-plugins[headroom]'
```

Local checkout:

```sh
omp plugin install "$PWD/packages/headroom"
```

One-off load:

```sh
omp --extension "$PWD/packages/headroom/index.ts"
```

The package manifest exposes `./index.ts` through `omp.extensions`.

## Commands

```text
/headroom
/headroom status
/headroom on
/headroom off
/headroom health
/headroom stats
/headroom token
/headroom init [config|glyphs|all]
```

Bare `/headroom` opens a native action menu with English descriptions: status, session compression on/off, health, statistics, token input, and a file-initialization chooser. Closing the root menu leaves plugin state and files unchanged. Without interactive UI, the bare command prints help instead of running an action.

`/headroom status`, `/headroom health`, and `/headroom stats` open focused read-only overlays. Loading is immediate; Enter/Esc closes. `/headroom on` and `/headroom off` change compression for the current session only. `/headroom token` opens a visible input field; saving replaces the configured token file, reloads the client, and checks proxy health immediately. Cancelling input preserves the existing token. Never pass the token as a command argument. `/headroom health` checks external proxy reachability.

The menu's **Choose files to initialize** action opens a second choice for config, glyphs, or both. Cancelling that choice creates nothing. Explicit `/headroom init` still initializes **all** files; `/headroom init config`, `/headroom init glyphs`, and `/headroom init all` keep their direct behavior. Initialization asks before each existing file is overwritten. Declining one file skips only that file; other writes remain, including when a later file fails. Initialization is not transactional and does not install or start a proxy.

Behavior change: bare `/headroom` now offers actions instead of opening status automatically. Use `/headroom status` for direct status access.

Persisted settings are owned by root `/omp-plugins`; Headroom has no config dialog.

## Configuration

Headroom uses `behavior.headroom` and `display.headroom` in:

```text
~/.config/codesook-omp/config.json
```

Example:

```json
{
  "version": 1,
  "display": {
    "headroom": {
      "visible": true,
      "glyphDirectory": "~/.config/codesook-omp/headroom",
      "template": "{status}",
      "status": {
        "off": "{glyph} Headroom off",
        "remote-blocked": "{glyph} Headroom remote blocked",
        "starting": "{glyph} Headroom starting",
        "loading": "{glyph} Headroom loading",
        "offline": "{glyph} Headroom not running",
        "unavailable": "{glyph} Headroom unavailable ({reason})",
        "idle": "{glyph} Headroom idle",
        "online": "{glyph} Headroom",
        "compressed": "{glyph} Headroom {tokensSaved} saved"
      }
    }
  },
  "behavior": {
    "headroom": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:8788",
      "allowRemote": false,
      "autoStart": false,
      "command": "headroom",
      "minContextTokens": 8000,
      "minMessageChars": 1000,
      "timeoutMs": 35000,
      "proxyTokenFile": "~/.config/codesook-omp/headroom/proxy-token"
    }
  }
}
```

A state template missing from user config falls back to its default. The client timeout (35 s) stays above the server compression deadline (20 s) so the server's `503` arrives before the client aborts.

`autoStart` remains normalized to `false` for compatibility. Proxy token file is optional and read only by request path; token contents never enter root JSON. When the file is absent or blank, requests omit `X-Headroom-Proxy-Token` and use the proxy's unauthenticated access policy. `/headroom token` trims outer whitespace, rejects blank values and embedded newlines, writes atomically with file mode `0600`, and keeps the saved token when the health check cannot reach the proxy.

## Migration

Missing legacy files migrate into missing root sections:

```text
~/.config/codesook-omp/headroom/config.json
~/.config/codesook-omp/headroom/settings.json
~/.pi/agent/headroom/settings.json
~/.config/codesook-omp/headroom/display-config.json
```

Invalid root JSON wins and is never overwritten. Successful root migration removes only valid legacy JSON files; invalid files remain for repair. Glyph assets remain external. Environment values apply after persisted values for `enabled`, `baseUrl`, `allowRemote`, `command`, thresholds, and timeout. `autoStart` environment values are ignored.

Remote proxy URLs are blocked unless `allowRemote` is explicitly enabled. Conversation context is sent to proxy; use remote override only for trusted endpoint.

## Shared Display contract

Headroom connects to versioned `codesook/shared-display/v1` channel with source `headroom`. It publishes complete `FrameSequence` and `null` when disabled or shutdown. Shared Display owns frame selection and host timer. Without Shared Display, compression still works and producer publication is a no-op.

## Compression flow

Each `context` event (one per model request):

1. Build the Headroom OpenAI-shaped payload with real tool names and JSON-stringified arguments.
2. Candidates are `toolResult` messages of at least `minMessageChars` that are not errors (`isError`) and whose bash command does not run `rtk` (`(^|[;&|(]\s*)rtk\s`). Other messages are sent as context only.
3. If a candidate is not yet compressed, context is at least `minContextTokens`, and the proxy is usable, POST `/v1/compress` with `config.session_id` set to `ctx.sessionManager.getSessionId()`. Nothing else is sent in `config`.
4. Take each changed candidate independently when it is aligned (role, `tool_call_id`), non-empty, and shorter. Ignore server changes to everything else.
5. Add newly compressed results to the replay memo (`toolCallId` → forwarded text) and forward every memoised result with its memoised text. This runs on every request, including skipped ones, so bytes forwarded once never change within the Agent Session.

Failures never forward raw text for results already in the memo:

| Failure | Behavior |
| --- | --- |
| `503` | Retry once immediately, then memo only for this request. |
| Client timeout or `compression_skipped` | Memo only for this request. |
| `429` and other `5xx` | Memo only for this request. |
| `400`, `401`, `404` | Compression Unavailable (`{reason}` is the status). No requests until a health check succeeds. |
| Network failure | Offline. No requests until a health check succeeds. |

Recovery is lazy; there are no timers. After Unavailable or offline, the first `context` event past the backoff (30 s, 60 s, 120 s, then 300 s) runs one health check. Success clears the state and compression is tried again; backoff resets after a successful compression. At session start the first request waits for the in-flight health check (at most `timeoutMs`) before deciding to skip.

## Headroom Savings

Headroom Savings is the share of the whole request (system prompt, tools, and messages) that Headroom removed. It is computed locally per Agent Session with one chars/4 estimate. Server `tokens_saved` is never summed.

- saved = estimate(original text of replaced results) − estimate(forwarded text), including memo replays;
- before = the request size without Headroom. The base is OMP's context estimate (`ctx.getContextUsage()`, the same value that gates `minContextTokens`). That estimate is hybrid: up to the last response with provider-reported usage it counts results as the provider saw them (already compressed), and after it it counts original text. So only savings at or before that response are added back; savings on results first compressed in this request are already excluded from the base. Without such a response, or when OMP reports no usage, the base is the original text and no add-back applies. If OMP gives no usage at all, the estimate of the message payload is used instead;
- Headroom Savings = Σ saved / Σ before over every request that reached the model, including requests that removed nothing.

Template placeholders: `{compressionPercent}` and `{tokensSaved}` (session, so existing templates keep working), `{tokensBefore}`, `{tokensAfter}` (session), `{lastPercent}`, `{lastSaved}` (latest request), `{reason}`, `{error}`, `{proxyStatus}`, `{glyph}`, `{state}`, `{label}`. Token counts are compact (950, 1.2k, 3.4M); percentages are integers. With the proxy online and nothing saved in the Agent Session the state is `online` and shows `Headroom` without numbers. Numbers appear only after Headroom has saved tokens in the Agent Session: the state is then `compressed` and the default template shows compact tokens saved. The percent placeholders stay available for custom templates.

Agent Session = one OMP conversation. Stats and memo reset on `session_start` and `session_switch`, not on `session_branch`. `/headroom status` shows session savings, memo size, last error or reason, server session block, and the next health retry.

## Development

```sh
bun install
bun run check:types
bun run test
bun run check
bun run pack:check
bun run verify
```
