# @codesook/omp-ponytail

Ponytail, the "lazy senior developer" [Instruction Mode](../../CONTEXT.md), for [oh-my-pi](https://github.com/can1357/oh-my-pi). The package adds the pinned `skills/ponytail/SKILL.md` rules to every request of an Agent Session until you turn them off, and publishes its status as a Shared Display source when that opt-in host is loaded. It replaces the third-party plugin `@dietrichgebert/ponytail` in this setup; do not load both.

## Install

From this workspace:

```sh
omp --extension ./packages/ponytail/src/index.ts
```

As a published package:

```sh
omp plugin install npm:@codesook/omp-ponytail
```

From the repository, select the `ponytail` feature (opt-in): `omp plugin install 'github:seenark/omp-plugins[ponytail]'`. Requires OMP and pi-tui `>=18.2.8`; subagent inheritance needs OMP 18.3.2+.

## Mode Levels and commands

Mode Levels are named exactly as Upstream names them: `off`, `lite`, `full`, `ultra`. `full` is the default for new Agent Sessions. `review` is a fifth level that only exists when an older Upstream session entry holds it: it injects the single line `PONYTAIL MODE ACTIVE — level: review. Behavior defined by /ponytail-review skill.` and cannot be set by command or saved as a default.

```text
/ponytail                        Turn Ponytail on (default level, `full` if the default is off); report status when already on
/ponytail status                 Report the current level and the default
/ponytail off|lite|full|ultra    Set the level for this Agent Session
/ponytail default <level>        Save behavior.ponytail.defaultMode (off|lite|full|ultra)
```

Level choices append a `ponytail-mode` session entry (`{ "mode": "<level>" }`, the shape Upstream writes), so resume, `/new`, branch and tree navigation recover the newest valid entry of the branch. Entries Upstream wrote earlier keep working. `/ponytail default` changes only the saved default, not the current session.

Typing exactly `stop ponytail` or `normal mode` (case-insensitive, trailing `.`/`!`/`?` ignored) as a user message turns Ponytail off for the session. Messages sent by extensions are ignored, and a sentence that merely contains the phrase does not match.

A subagent starts at its parent's current level, including `off`, and records that level as its own `ponytail-mode` entry (OMP 18.3.2+ for `ctx.agent`; older hosts skip inheritance). A child's own entry wins, a later parent change does not move a running child, and a child whose parent is gone uses the saved default.

### Helper commands

| Command | Vendored skill |
| --- | --- |
| `/ponytail-review [text]` | `skills/ponytail-review/SKILL.md` |
| `/ponytail-audit [text]` | `skills/ponytail-audit/SKILL.md` |
| `/ponytail-debt [text]` | `skills/ponytail-debt/SKILL.md` |
| `/ponytail-gain [text]` | `skills/ponytail-gain/SKILL.md` |
| `/ponytail-help [text]` | `skills/ponytail-help/SKILL.md` |

Upstream aliases these to `/skill:<name>`. OMP expands `/skill:` only for text typed into its input, never for a message an extension sends, so each command here sends the skill itself: the vendored body (frontmatter removed) in the message shape OMP builds for a user-invoked skill, followed by `User: <text>` when you pass text. While the agent is busy the message is queued as a follow-up, as in Upstream. They are one-shot and never change the Mode Level.

**Skill registration.** OMP plugin `features` accept `extensions`, `tools`, `hooks` and `commands` entries but no `skills` entry (`PluginFeature` in OMP's `extensibility/plugins/types.ts`), and `resources_discover` (the extension hook that could return `skillPaths`) is declared but never emitted by OMP 18.6.1. OMP picks up skills only from a `skills/` directory at the root of an installed package. Installing this package on its own (`omp plugin install npm:@codesook/omp-ponytail` or the `packages/ponytail` path) therefore also lists the six vendored skills as `/skill:ponytail*`, while installing the repository root with the `ponytail` feature does not, because the root has no `skills/`. The helper commands work in both cases, so they are the supported way to run the skills.

## Suspension by pstack

When `@codesook/omp-pstack` activates, it asks Ponytail over the `codesook/instruction-mode-suspension/v1` EventBus channel to switch off for the Agent Session. Ponytail records Mode Level `off` as a `ponytail-mode` session entry, exactly like `/ponytail off`; the Root Plugin Configuration is not touched and other sessions are unaffected. `/ponytail <mode>` turns it back on. Turn the suspension off with `behavior.pstack.suspendPonytail` in `/omp-plugins`.

## Configuration

All settings persist in the root envelope `~/.config/codesook-omp/config.json`, edited through `/omp-plugins` or by hand:

```json
{
  "version": 1,
  "display": {
    "ponytail": {
      "visible": true,
      "nativeVisible": false,
      "template": "{activity} {glyph} ponytail: {modeIcon}{mode}",
      "glyphDirectory": "~/.config/codesook-omp/ponytail"
    }
  },
  "behavior": {
    "ponytail": { "defaultMode": "full" }
  }
}
```

- `behavior.ponytail.defaultMode`: `off`, `lite`, `full` or `ultra` (default `full`). Any other value, including `review`, is invalid: Ponytail warns and the default becomes `off` (fail closed). An unparseable root file does the same and is never overwritten.
- `PONYTAIL_DEFAULT_MODE` (`off|lite|full|ultra`, case-insensitive) overrides the saved default, because Upstream documents it as the highest-priority default. An invalid value is ignored.
- A change made in `/omp-plugins` applies to running sessions at once; a session that already chose its own level keeps it.
- Missing sections use the defaults above. Nothing is created on start-up.

## Display

When the Shared Display host is loaded, Ponytail publishes complete frame sequences on source `ponytail`; `display.ponytail.visible: false` publishes `null`. `nativeVisible` independently controls the static `ctx.ui.setStatus("ponytail", ...)` footer text, which uses only the first row of frame zero. Both are cleared when the level is `off` and on shutdown. Without the host, the publisher is a no-op and no private widget or timer exists.

Template placeholders: `{activity}` (`●` while the agent runs, `○` otherwise), `{glyph}` (current frame), `{mode}` (upper-case level) and `{modeIcon}` (`🌿 ` lite, `⚡ ` full, `🔥 ` ultra, empty for review). The glyph is not themed.

The package ships `assets/off.txt`, `lite.txt`, `full.txt`, `ultra.txt` and `review.txt` (one `🐴` frame each). A file `<level>.txt` in `display.ponytail.glyphDirectory` overrides its packaged asset when the Shared Display parser accepts it (optional `fps=` header, then frames); otherwise the packaged asset, then a single `🐴`. `seedMissingPonytailGlyphs` copies only the files a directory lacks.

## Pinned Revision and Vendored Content

Upstream: [`DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail), Pinned Revision `2961b52fc1fe6a5a87c7a959a79512e5c2f3ffe5` (package version 5.2.0, MIT). Vendored Content, byte-identical to that commit: `skills/ponytail/SKILL.md`, `skills/ponytail-review/SKILL.md`, `skills/ponytail-audit/SKILL.md`, `skills/ponytail-debt/SKILL.md`, `skills/ponytail-gain/SKILL.md` and `skills/ponytail-help/SKILL.md`. The file list, Upstream, Pinned Revision and the full MIT license are in `THIRD-PARTY-NOTICES.txt`.

The instruction text is built as Upstream's `hooks/ponytail-instructions.js` does: `PONYTAIL MODE ACTIVE — level: <level>`, a blank line, then the `ponytail` skill without frontmatter, keeping only the current level's intensity-table row and quoted example line. The code is reimplemented in TypeScript, not imported.

Two sentences in the vendored `ponytail-help` skill are stale here because the file stays unedited: it points to `~/.config/ponytail/config.json` and `%APPDATA%\ponytail\config.json` (this package reads only the root envelope) and to Claude Code's `/plugin` update flow. `ponytail-gain` names `benchmarks/results/2026-10-07-agentic.md` and the Upstream README as the source of its figures; it only cites them and never reads them.

## Adaptations

- **Prompt injection.** `before_agent_start` appends exactly one element to the `systemPrompt` string array and returns the new array. Earlier elements stay untouched, and nothing is joined into a string. Upstream at the Pinned Revision does the same for arrays, but falls back to string concatenation and the Pi `sections` object; neither exists here.
- **Unreadable skill.** Upstream embeds fallback instruction text for an unreadable `SKILL.md`. Here, an unreadable vendored skill logs one warning and skips injection, like Caveman.
- **Config.** `defaultMode` and display settings live in the root envelope, not `~/.config/ponytail/config.json`; an invalid default fails closed to `off`, where Upstream falls back to `full`. `/ponytail default` writes the root envelope.
- **Env overrides.** Kept: `PONYTAIL_DEFAULT_MODE` (documented by Upstream's README, INSTALL guide and `ponytail-help`). Dropped: `PONYTAIL_HIDE_STATUS` and `PONYTAIL_QUIET_STARTUP`, which Upstream does not document for users; `display.ponytail.visible`/`nativeVisible` replace the first, and no start-up toast is shown.
- **Display.** Upstream's themed native status text is replaced by the template-driven Shared Display producer plus optional native status.
- **Helper commands.** They send the vendored skill body themselves instead of `/skill:<name>`; see Helper commands.
- **Session events.** Level recovery runs on `session_start`, `session_switch`, `session_branch` and `session_tree`.

## Excluded

Upstream's `ponytail-mcp` server, the CLI and install scripts, the hooks and rule files for Claude Code, Codex, Copilot, Cursor, Qoder, Gemini, Kimi, OpenCode, OpenClaw, Windsurf, Kiro, Cline and other agents, the statusline scripts, Upstream's subagent hook, `hooks/ponytail-map.js`, the TOML command files, the benchmarks, the Pi `pi-extension` tests, and the translated READMEs are not brought over.
