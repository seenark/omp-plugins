# @codesook/omp-headroom

Headroom context-compression producer for [oh-my-pi](https://github.com/can1357/oh-my-pi).

The extension:

- compresses large `toolResult` messages before provider requests;
- preserves message roles, tool-call metadata, images, and original context when compression is unsafe;
- starts and health-checks a persistent local Headroom proxy;
- publishes one complete Headroom display sequence through `@codesook/omp-shared-display`;
- never mounts a widget, installs a timer, or captures another producer's `setStatus` output.

Quota and subscription usage are not included.

## Requirements

- Bun 1.4.0 or newer for local development;
- OMP 18.1.16 or newer;
- `@oh-my-pi/pi-coding-agent`, `@oh-my-pi/pi-tui`, and `@oh-my-pi/pi-ai` `>=18.1.16`;
- the `headroom` executable when proxy auto-start is enabled.

Install the proxy when needed:

```sh
python3 -m pip install "headroom-ai[proxy]"
```

## Install

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
/headroom
/headroom config
/headroom status
/headroom on
/headroom off
/headroom health
/headroom stats
/headroom init
/headroom init config
/headroom init glyphs
/headroom init all
```

Bare `/headroom` and `/headroom config` open the staged Settings dialog. Changes remain in a draft until `Apply`; `Cancel` and `Reload` do not change persisted or live settings. Apply validates and atomically replaces the destination JSON.

`/headroom on` and `/headroom off` change compression for the current session. They do not rewrite the persisted default. `/headroom health` checks the proxy and attempts auto-start when configured. `/headroom stats` displays the proxy `/stats` response. Initialization creates the unified config and seven state glyph files, asking before overwriting an existing file.

## Configuration

Headroom owns one normalized destination:

```text
~/.config/codesook-omp/headroom/config.json
```

Example:

```json
{
  "enabled": true,
  "baseUrl": "http://127.0.0.1:8788",
  "allowRemote": false,
  "autoStart": true,
  "command": "headroom",
  "minContextTokens": 20000,
  "minMessageChars": 2000,
  "timeoutMs": 30000,
  "display": {
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
}
```

`display.visible` controls Headroom's Shared Display publication only. Glyph files are named after the display state (`idle.txt`, `online.txt`, `compressed.txt`, and so on). A file can contain whitespace-separated one-row frames or blank-line-separated multiline frames; an optional first `fps=<positive-number>` line supplies animation metadata. Headroom publishes every rendered frame. Shared Display owns frame selection and the one host timer.

Native OMP status is not used as a second Headroom widget. Load Shared Display to render the source below the editor; without it, Headroom compression still works and the producer becomes a no-op.

## Migration

Migration is destination-gated:

- an existing `headroom/config.json` wins, including an invalid file; invalid values use runtime defaults and do not import legacy data;
- when the destination is absent, valid legacy operational settings and legacy display settings are normalized independently into one file;
- legacy files and asset bytes are not modified;
- later loads use the destination only.

Legacy operational candidates are checked in order:

```text
~/.config/codesook-omp/headroom/settings.json
~/.pi/agent/headroom/settings.json
```

The old split display location is accepted only as a migration source:

```text
~/.config/codesook-omp/headroom/display-config.json
```

Environment values are applied after persisted values, field by field. `PI_HEADROOM_*` wins over `HEADROOM_*`; invalid or empty values fall through to the persisted value/default:

| Setting | Environment variables | Default |
| --- | --- | --- |
| `enabled` | `PI_HEADROOM_ENABLED`, `HEADROOM_ENABLED` | `true` |
| `baseUrl` | `PI_HEADROOM_URL`, `HEADROOM_URL`, `HEADROOM_BASE_URL` | `http://127.0.0.1:8788` |
| `allowRemote` | `PI_HEADROOM_ALLOW_REMOTE`, `HEADROOM_ALLOW_REMOTE` | `false` |
| `autoStart` | `PI_HEADROOM_AUTO_START`, `HEADROOM_AUTO_START` | `true` |
| `command` | `PI_HEADROOM_COMMAND`, `HEADROOM_COMMAND` | `headroom` |
| `minContextTokens` | `PI_HEADROOM_MIN_CONTEXT_TOKENS`, `HEADROOM_MIN_CONTEXT_TOKENS` | `20000` |
| `minMessageChars` | `PI_HEADROOM_MIN_MESSAGE_CHARS`, `HEADROOM_MIN_MESSAGE_CHARS` | `2000` |
| `timeoutMs` | `PI_HEADROOM_TIMEOUT_MS`, `HEADROOM_TIMEOUT_MS` | `30000` |

Remote proxy URLs are blocked unless `allowRemote` is explicitly enabled. Conversation context is sent to the proxy; use the remote override only for a trusted endpoint.

## Compression flow

1. Skip compression while context is below `minContextTokens`.
2. Convert messages to the Headroom OpenAI-shaped payload.
3. Submit only eligible large `toolResult` messages.
4. Apply a response only when message alignment, roles, tool-call IDs, and non-candidate content remain safe.
5. On timeout, proxy failure, or unsafe output, retain the original context.

## Shared Display contract

Headroom connects to the versioned `codesook/shared-display/v1` channel with source `headroom`. It publishes a complete `FrameSequence` containing rendered `BlockFrame` rows. It publishes `null` when disabled and on session shutdown, then disposes its publisher. Session start, switch, and branch reset the producer and recover no private display state.

The only widget owner is `@codesook/omp-shared-display`; Ponytail and Caveman are separate producers. Headroom never captures, hides, or rewrites their native status keys.

## Development

```sh
bun install
bun run typecheck
bun run test
bun run check
bun run pack:check
bun run verify
```
