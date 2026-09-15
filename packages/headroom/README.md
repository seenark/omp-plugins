# @codesook/omp-headroom

Headroom context-compression producer for [oh-my-pi](https://github.com/can1357/oh-my-pi).

- compresses large `toolResult` messages before provider requests;
- preserves message roles, tool-call metadata, images, and original context when compression is unsafe;
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

Published package:

```sh
omp plugin install @codesook/omp-headroom
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
/headroom status
/headroom on
/headroom off
/headroom health
/headroom stats
/headroom init [config|glyphs|all]
```

`/headroom status`, `/headroom health`, and `/headroom stats` open focused read-only overlays. Loading is immediate; Enter/Esc closes. `/headroom on` and `/headroom off` change compression for current session only. `/headroom health` checks external proxy reachability. Initialization creates root config sections and state glyph files, asking before overwriting.

Persisted settings are owned by root `/codesook-omp-plugin`; Headroom has no config dialog.

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
        "offline": "{glyph} Headroom not running",
        "idle": "{glyph} Headroom idle",
        "online": "{glyph} Headroom",
        "compressed": "{glyph} Headroom -{compressionPercent}% ({tokensSaved} saved)"
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
      "minContextTokens": 20000,
      "minMessageChars": 2000,
      "timeoutMs": 30000,
      "proxyTokenFile": "~/.config/codesook-omp/headroom/proxy-token"
    }
  }
}
```

`autoStart` remains normalized to `false` for compatibility. Proxy token file is optional and read only by request path; token contents never enter root JSON.

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

1. Skip compression while context is below `minContextTokens`.
2. Convert messages to the Headroom OpenAI-shaped payload.
3. Submit only eligible large `toolResult` messages.
4. Apply a response only when message alignment, roles, tool-call IDs, and non-candidate content remain safe.
5. On timeout, proxy failure, or unsafe output, retain the original context.


## Development

```sh
bun install
bun run check:types
bun run test
bun run check
bun run pack:check
bun run verify
```
