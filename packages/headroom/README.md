# @codesook/omp-headroom

Headroom context-compression extension for [oh-my-pi](https://github.com/can1357/oh-my-pi).

This plugin replaces the existing Pi Headroom extension behavior in OMP:

- Compresses large `toolResult` messages before provider requests.
- Preserves user messages, assistant messages, tool-call metadata, and images.
- Starts and health-checks a persistent local Headroom proxy.
- Keeps the existing `/headroom` and `/headroom-health` commands.
- Shows a custom one-line status widget aligned to the bottom-right below the prompt box.
- Supports per-state status templates and per-state glyph files.

Quota/subscription usage is intentionally not included.

## Requirements

- OMP 16.1.7 or newer with extension/plugin support.
- Headroom proxy installed and available:

```bash
python3 -m pip install "headroom-ai[proxy]"
```

- `@oh-my-pi/pi-coding-agent` `>=16.1.7`.
- `@oh-my-pi/pi-tui` `>=16.1.7`.
- `@oh-my-pi/pi-ai` `>=16.1.7`.

## Install in OMP

The plugin is installed through OMP's plugin manager. It does not patch OMP core.

### Install the published package

Install the published package through OMP's plugin manager:

```bash
omp plugin install @codesook/omp-headroom
```

For a project-scoped installation, use the project scope instead:

```bash
omp plugin install --scope project @codesook/omp-headroom
```

### Install from a local checkout

From the monorepo root, install the package directly:

```bash
omp plugin install "$PWD/packages/headroom"
```

For plugin development, link the package so edits are picked up without copying:

```bash
omp plugin link "$PWD/packages/headroom"
```

### One-off load

Load the entrypoint for a single OMP process without installing it:

```bash
omp --extension "$PWD/packages/headroom/index.ts"
```

### Verify or remove

```bash
omp plugin list
omp plugin doctor
```

The package manifest registers `./index.ts` as an OMP extension:

```json
{
  "omp": {
    "extensions": ["./index.ts"]
  }
}
```

Remove an installed copy with:

```bash
omp plugin uninstall @codesook/omp-headroom
```

## First use

1. Install the Headroom proxy if it is not already available:

   ```bash
   python3 -m pip install "headroom-ai[proxy]"
   ```

   The `headroom` executable must be on the `PATH` used to launch OMP. If it is
   installed elsewhere, set `PI_HEADROOM_COMMAND` to its full path.
2. Start OMP:

   ```bash
   omp
   ```
3. Run these slash commands inside the OMP session:

   ```text
   /headroom health
   /headroom status
   ```

With the default settings, compression is enabled at session start and the
plugin tries to start a persistent local proxy at
`http://127.0.0.1:8788`. `/headroom health` checks the proxy immediately;
`/headroom on` and `/headroom off` change compression for the current session
only. The proxy is intentionally left running when OMP exits.

To create the configuration, display file, and seven glyph files interactively:

```text
/headroom init
```

Initialization asks before overwriting each existing file. Use
`/headroom init config`, `/headroom init display`, or `/headroom init glyphs` to
initialize only one group.


## How compression works

The extension listens to OMP's `context` event before each provider request.

1. It skips compression while the context is below `minContextTokens`.
2. It converts messages to an OpenAI-shaped payload for Headroom.
3. Only sufficiently large `toolResult` messages become compression candidates.
4. It sends the payload to `POST /v1/compress`.
5. It applies the response only when message count, roles, tool-call IDs, and non-candidate content remain aligned.
6. If Headroom is unavailable, times out, or returns an unsafe result, the original context is used unchanged.

By default, remote proxy URLs are blocked because conversation context is sent to the proxy. Only local URLs are allowed unless remote access is explicitly enabled.

## Commands

```text
/headroom
/headroom status
/headroom on
/headroom off
/headroom display
/headroom health
/headroom stats
/headroom init
/headroom init config
/headroom init display
/headroom init glyphs
/headroom init all
/headroom-health
```

| Command | Behavior |
| --- | --- |
| `/headroom` or `/headroom status` | Shows current configuration and session statistics, including whether the widget is shown. |
| `/headroom on` | Enables compression for the current session and ensures the proxy is running. |
| `/headroom off` | Disables compression for the current session; leaves the proxy running. |
| `/headroom display` | Toggles only the status widget for the current OMP session; does not change compression or persist a file. |
| `/headroom health` | Checks the proxy and attempts auto-start when configured. |
| `/headroom stats` | Displays the proxy's `/stats` response. |
| `/headroom init` or `/headroom init all` | Creates or individually confirms replacement of all nine OMP Headroom defaults. |
| `/headroom init config` | Initializes only `~/.config/codesook-omp/headroom/settings.json`. |
| `/headroom init display` | Initializes only `~/.config/codesook-omp/headroom/display-config.json`. |
| `/headroom init glyphs` | Initializes the seven per-state glyph files in `~/.config/codesook-omp/headroom/`. |
| `/headroom-health` | Shortcut for `/headroom health`. |

Initialization creates parent directories as needed. Existing files are confirmed independently; declining a prompt preserves that file and reports it as skipped. The generated display file is direct JSON with `visible: true`, and generated glyphs are static one-frame `.txt` files using the active OMP theme symbols with Unicode fallbacks.

## Operational configuration

Operational settings use the first valid JSON object from these candidates, without merging:

1. OMP-specific settings: `~/.config/codesook-omp/headroom/settings.json`
2. Legacy Pi settings: `~/.pi/agent/headroom/settings.json`

For every setting, precedence is field-by-field:

1. A valid environment value.
2. The corresponding value in the selected settings file.
3. The built-in default.

Environment variables therefore always win over settings-file values. Empty or invalid environment values fall through to the selected file/default. If the OMP-specific file is missing or invalid, the legacy file is selected; if both are missing or invalid, built-in defaults are used. The two files are never merged.
Recommended OMP-specific file:

```text
~/.config/codesook-omp/headroom/settings.json
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
  "timeoutMs": 30000
}
```

| Setting | Environment variable (highest priority) | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `PI_HEADROOM_ENABLED` or `HEADROOM_ENABLED` | `true` | Enable compression at session start. |
| `baseUrl` or `url` | `PI_HEADROOM_URL`, `HEADROOM_URL`, or `HEADROOM_BASE_URL` | `http://127.0.0.1:8788` | Headroom proxy base URL. |
| `allowRemote` | `PI_HEADROOM_ALLOW_REMOTE` or `HEADROOM_ALLOW_REMOTE` | `false` | Allow non-local proxy URLs. |
| `autoStart` | `PI_HEADROOM_AUTO_START` or `HEADROOM_AUTO_START` | `true` | Start a persistent local proxy when offline. |
| `command` | `PI_HEADROOM_COMMAND` or `HEADROOM_COMMAND` | `headroom` | Headroom executable used for auto-start. |
| `minContextTokens` | `PI_HEADROOM_MIN_CONTEXT_TOKENS` or `HEADROOM_MIN_CONTEXT_TOKENS` | `20000` | Minimum context size before compression is attempted. |
| `minMessageChars` | `PI_HEADROOM_MIN_MESSAGE_CHARS` or `HEADROOM_MIN_MESSAGE_CHARS` | `2000` | Minimum `toolResult` size eligible for compression. |
| `timeoutMs` | `PI_HEADROOM_TIMEOUT_MS` or `HEADROOM_TIMEOUT_MS` | `30000` | HTTP timeout for Headroom requests. |

Boolean values accept JSON booleans and strings such as `1/0`, `true/false`, `yes/no`, and `on/off`.

The legacy path remains supported for migration and compatibility:

```text
~/.pi/agent/headroom/settings.json
```

If both files are valid, only the OMP-specific file is used; settings are not merged across files.

## Status widget

OMP does not currently expose an extension API for adding a custom ID to the native `statusLine.leftSegments` or `statusLine.rightSegments` arrays. This plugin therefore does not modify OMP core or the prompt-border editor.

The plugin renders one line through the supported `belowEditor` widget surface:

```text
                         ✓ Headroom -32% (1,234 saved)
```

The widget is right-aligned directly below the prompt box. It is not a native status-line segment and cannot be reordered with built-in segments such as `model`, `path`, or `context_pct`.

## Display configuration

Display settings use a dedicated file:

```text
~/.config/codesook-omp/headroom/display-config.json
```

The file contains the display configuration directly:

```json
{
  "visible": true,
  "glyphDirectory": "~/.config/codesook-omp/headroom",
  "status": {
    "off": "{icon} HR disabled",
    "online": "{icon} Headroom ready",
    "compressed": "{icon} saved {tokensSaved} tokens ({compressionPercent}%)",
    "offline": "{icon} proxy offline"
  }
}
```

`visible` controls the widget's startup state only. Set `"visible": false` to start a session with the widget hidden; omitting `visible` keeps it shown. `/headroom display` changes this setting only for the current OMP session and never writes the display configuration file.

`templates` is also accepted as an alias for `status`.

Supported placeholders:

```text
{icon}
{state}
{label}
{compressionPercent}
{tokensSaved}
{tokensBefore}
{tokensAfter}
{proxyStatus}
{error}
```

Default status text remains compatible with the Pi extension:

```text
○ Headroom off
⚠ Headroom remote blocked
⏳ Headroom starting
○ Headroom not running
○ Headroom idle
✓ Headroom
✓ Headroom -32% (1,234 saved)
```

## Per-state glyph files

The default glyph directory is:

```text
~/.config/codesook-omp/headroom/
```

Supported state files:

```text
off.txt
remote-blocked.txt
starting.txt
offline.txt
idle.txt
online.txt
compressed.txt
```

Example static asset:

```text
# ~/.config/codesook-omp/headroom/compressed.txt
󰄬
```

Each asset is a plain `.txt` file. Without an `fps=` directive, the widget renders only its first actual frame. To opt into animation, put the exact `fps=16` directive on the first non-empty line before the first frame:

```text
fps=16
􁩱􁩲

􁩳􁩴
```

Blank-line-separated blocks are frames, and each block is rendered as one glyph frame. A malformed, zero, negative, or otherwise invalid `fps=` value is removed and disables animation; the actual glyph frames still load and the widget uses the first one. Missing or empty files fall back to the active OMP theme symbol. The current `off.txt` style can remain static as-is; add `fps=16` before its first frame when animation is wanted.

A custom `glyphDirectory` may be set in the `headroom` display configuration. Paths beginning with `~/` are expanded against the current user's home directory.

## Privacy and remote proxies

Compression sends conversation context to the configured Headroom proxy. Remote URLs are blocked by default:

```text
localhost
127.0.0.1
::1
[::1]
```

To explicitly allow a trusted remote proxy:

```bash
PI_HEADROOM_ALLOW_REMOTE=1 omp
```

Do not enable this unless the remote proxy is trusted with the conversation context.

## Troubleshooting

### Proxy offline

Check the proxy from inside OMP:

```text
/headroom health
```

If auto-start is disabled or cannot find the executable, start it manually:

```bash
HEADROOM_TELEMETRY=off headroom proxy \
  --host 127.0.0.1 --port 8788 --mode token --no-cache
```

Then run `/headroom health` again. Use `PI_HEADROOM_COMMAND` when the
`headroom` executable is not on OMP's `PATH`.

### Compression does not run

Run `/headroom status` and `/headroom stats`. Compression is attempted only
when all of these are true:

- compression is enabled for the session;
- the proxy is healthy;
- context usage is at least `minContextTokens`;
- at least one `toolResult` is at least `minMessageChars` characters.

Lower the thresholds in `settings.json` or with the corresponding environment
variables when testing. A failed request or safety-alignment check leaves the
original OMP context unchanged.

### Remote proxy warning

If the widget reports `Headroom remote blocked`, the configured URL is not
local. Keep the default local-only policy, or explicitly opt in only for a
trusted proxy:

```bash
PI_HEADROOM_ALLOW_REMOTE=1 omp
```

This sends conversation context to that remote service.


## Development

```bash
bun install
bun test
bun run check:types
```

The package tests cover configuration precedence, remote URL policy, message preservation guards, glyph/template rendering, HTTP client behavior, command registration, and the right-aligned widget lifecycle.
