# Agent Setup Guide

Procedure for an AI agent that is asked to install or set up `omp-plugins` for a user. Follow the phases in order. **Never install, uninstall, or overwrite anything before the user confirms that step.** Use the `ask` tool for every question; batch related questions into one call; put the recommended option first.

Vocabulary: see `GLOSSARY.md`. Feature names: `headroom`, `prompt-border-style`, `shared-display`, `ponytail`, `caveman`, `codegraph`, `beads`, `rtk`. `pstack` is offered alongside them but installs as its own package. The root package also installs the unified `/omp-plugins` settings command.

## Phase 0: inspect, change nothing

Run and record the results (all read-only):

```sh
bun --version                    # need >= 1.4.0
omp --version                    # need >= 18.3.1
omp plugin list                  # installed plugins and enabled features
which docker bd rtk codegraph    # missing binary prints nothing
rtk --version                    # need >= 0.51.0
codegraph status --json .        # "initialized": true/false for the project
bd --version
cat ~/.omp/agent/mcp.json        # is a codegraph MCP server configured?
docker ps --filter name=headroom # is a Headroom container already running?
```

Missing `bun` or `omp` blocks everything: tell the user, give the upstream install link, and stop.

## Phase 1: ask which features to install

Ask one multi-select question. Describe each choice in one line and list its prerequisites so the user can decide:

| Feature | What it gives | Needs |
| --- | --- | --- |
| `shared-display` | One status line that hosts every feature segment | nothing |
| `prompt-border-style` | Styled prompt border, spinners, Context Rail | nothing |
| `headroom` | Context compression through a Headroom proxy | A running Headroom proxy (Phase 3) |
| `ponytail` | "Lazy senior developer" instruction mode | nothing |
| `caveman` | Terse-output instruction mode | nothing |
| `rtk` | Rewrites shell commands to filter output | `rtk` CLI >= 0.51.0 |
| `codegraph` | Code graph exploration guidance | `codegraph` CLI plus an MCP server entry |
| `beads` | Issue-tracker guidance | `bd` CLI |
| `pstack` | pstack workflows (poteto-mode, playbooks, review panel on `pstack-*` model roles) | Its own plugin, installed from the `release/pstack` branch (`github:seenark/omp-plugins#release/pstack`), not a root feature; model roles chosen with `/pstack setup` |

Recommend `shared-display` whenever the user picks any other display-producing feature (`headroom`, `ponytail`, `caveman`, `rtk`, `codegraph`, `beads`, `pstack`): without it their segments fall back to separate native status entries.

## Phase 2: conflicting third-party plugins

For every selected feature, check `omp plugin list` for its third-party counterpart:

| Selected | Existing plugin to look for | Why it overlaps |
| --- | --- | --- |
| `ponytail` | `@dietrichgebert/ponytail` | Both inject the same instructions and register `/ponytail` |
| `rtk` | `pi-rtk-optimizer` | Both rewrite `bash` commands |
| `caveman` | any other Caveman skill/plugin that injects Caveman rules | Both add terse-output rules |
| `headroom` | any other Headroom or compression plugin/extension | Both compress the same tool results |
| `pstack` | `pstack@omp-pstack` (the community marketplace port of pstack) | pstack from `release/pstack` replaces it: both ship `/poteto-mode` and the `pstack-*` agents, so the two copies would race for the same skills and agent names |

If one is present, ask the user: **remove it, or keep it?** Show the tradeoff, then recommend removal.

Remove it (recommended):

- Good: instructions and command rewrites apply once; one command owner; the display shows one segment; token counts stay honest.
- Bad: the user loses any settings or customization they made in the old plugin; those do not migrate.

Keep it:

- Good: nothing changes for the user's current workflow; no config to redo.
- Bad: instructions are injected twice (more tokens, conflicting modes); command rewrites may stack and corrupt output; duplicate slash commands; two segments in the display; harder to debug.

After the user picks, ask them to **confirm the exact command** before running it:

```sh
omp plugin uninstall @dietrichgebert/ponytail
omp plugin uninstall pi-rtk-optimizer
omp plugin uninstall pstack@omp-pstack
```

If the user keeps a conflicting plugin, do not enable the matching feature unless they confirm again after reading the tradeoff.

`omp plugin uninstall` reinstalls the remaining plugins from `~/.omp/plugins/package.json`; if omp-plugins was linked from a checkout it is replaced by the GitHub copy. Do all uninstalls **before** the Phase 6 install.

## Phase 3: Headroom (only if `headroom` was selected)

The plugin never installs or starts a proxy. First ask what already exists:

- **Already running**: ask for its URL and whether it needs a token. Skip to configuration below.
- **Install with Docker**: continue.
- **Skip proxy for now**: install the feature anyway; `/headroom health` will report not running. Say so.

Docker install. Ask these, do not guess:

1. **Where should it run?** Options: this machine; another host over SSH (ask for the SSH alias); user's own existing deployment.
2. **Install directory?** Suggest `~/headroom` on the chosen host. Ask for another if the user wants one.
3. **Host port?** Suggest `8788`, the plugin default (`behavior.headroom.baseUrl` is `http://127.0.0.1:8788`). If another port is used, set `baseUrl` to match.
4. **Proxy token?** Required by Headroom 0.40+ for non-loopback binds. Offer to generate one (`openssl rand -hex 24`), or ask the user for theirs. Never print it back more than once and never commit it.

Then, after the user confirms the plan:

1. Check Docker works on the target: `docker info`. If it does not, stop and report.
2. Copy this repo's `compose.yaml` into the install directory and edit only the published port (`"127.0.0.1:<port>:8787"`). Keep every safety variable; the reasons are in `docs/research/headroom-0.40-agent-pitfalls.md`.
3. Create `.env` next to it with `HEADROOM_PROXY_TOKEN=<token>`, mode `0600`.
4. Create the state directory and give the container user (uid/gid 1000) ownership: `mkdir -p ~/.headroom && sudo chown 1000:1000 ~/.headroom` (ask before using `sudo`).
5. `docker compose up -d`, then wait for `docker inspect --format '{{.State.Health.Status}}' headroom` to print `healthy`.
6. Remote host: the proxy listens on loopback only. Ask how the user wants to reach it (SSH tunnel or their own tunnel/proxy), because the plugin requires `behavior.headroom.allowRemote: true` for any non-loopback `baseUrl`. Do not open the port to the network on your own.
7. Save the token for the plugin: `/headroom token` (interactive; never pass the token as an argument), or write `~/.config/codesook-omp/headroom/proxy-token` with mode `0600`.
8. Set `behavior.headroom.baseUrl` through `/omp-plugins` if it differs from the default, then run `/headroom health`.

Upgrades follow `docs/agents/upstream-sync.md`.

## Phase 4: dependency checks

Do this for each selected feature that needs a CLI. If the binary is missing (Phase 0), ask: "Install it for you, or will you install it yourself?" Install only after a yes, using the user's package manager when possible. Show the command first.

| Dependency | Check | Install options (pick what the machine already uses) |
| --- | --- | --- |
| `rtk` >= 0.51.0 | `rtk --version` | `brew install rtk` (macOS/Linux with Homebrew), otherwise the install section of https://github.com/rtk-ai/rtk. Upgrade: `brew upgrade rtk` |
| `codegraph` | `codegraph status --json .` | `npm install -g @colbymchenry/codegraph`, or `mise use -g npm:@colbymchenry/codegraph` if the user uses mise |
| `bd` | `bd --version` | https://github.com/gastownhall/beads releases; `mise use -g aqua:gastownhall/beads` if the user uses mise, or `brew`/`go install` per upstream |

Package names above come from this machine's `mise` entries; verify them against the upstream project page before running, and report any mismatch instead of improvising a different source.

Extra steps per dependency:

- **`codegraph`**: the plugin does not write MCP config. If `~/.omp/agent/mcp.json` lacks a `codegraph` server, ask before adding:

  ```json
  { "mcpServers": { "codegraph": { "type": "stdio", "command": "codegraph", "args": ["serve", "--mcp"] } } }
  ```

  Merge into the existing file; never replace it. Then ask whether to initialize the current project (`/codegraph init`, which runs native `codegraph init <project> --yes` and builds the initial graph). Detection never initializes.
- **`beads`**: ask whether to initialize the current project. `/beads init` offers Standard/team vs Stealth and a Git-hook choice; relay those choices to the user instead of picking for them. Beads availability does not authorize issue operations.
- **`rtk`**: nothing else to configure; confirm `rtk --version` afterwards.

If the user declines a dependency, drop the dependent feature from the install list (or install it and say it will show a missing-prerequisite state).

## Phase 5: confirm the plan

Print one summary and ask for a final go/no-go:

- features to install;
- third-party plugins to remove (and the ones the user chose to keep, with the accepted tradeoff);
- dependencies to install and the exact commands;
- Headroom target host, directory, port, and token location (never the token itself);
- files that will be created or modified.

Proceed only on an explicit yes.

## Phase 6: install

From GitHub (end users):

```sh
omp plugin install 'github:seenark/omp-plugins[<comma-separated features>]'
```

From a checkout (developers; edits load on next start):

```sh
bun install
omp plugin link "$PWD"
omp plugin features omp-plugins --enable=<comma-separated features>
readlink ~/.omp/plugins/node_modules/omp-plugins   # prints the checkout path
```

Keep selectors quoted; `[` and `]` are shell-special. Root install always includes the unified settings command.

`pstack` is not an `omp-plugins` feature: it installs as its own plugin from the GitHub release branch, `omp plugin install github:seenark/omp-plugins#release/pstack` (pin with `#pstack-v<version>`; developers: `omp plugin link ./packages/pstack`). Listing it as a feature as well would load its extension twice. Install it only after the user confirms.

## Phase 7: configure and verify

1. Restart `omp` (features load at start).
2. Create default config and glyph files: `/omp-plugins init config`. It only creates what is missing and never overwrites.
3. Run each installed feature's status command and read the result:

   | Feature | Command | Healthy result |
   | --- | --- | --- |
   | `headroom` | `/headroom health` | proxy reachable |
   | `codegraph` | `/codegraph status` | `ready` (the MCP tool may take a few seconds after start) |
   | `beads` | `/beads status` | `ready` |
   | `rtk` | footer segment or `rtk --version` | segment shows RTK savings |
   | `ponytail` | `/ponytail status` | mode reported |
   | `caveman` | `/caveman status` | mode reported |
   | `pstack` | `/pstack doctor` | no errors; if model roles are unset, run `/pstack setup` with the user |

4. Report to the user: what was installed, what was skipped or kept, any feature in a not-ready state with the exact fix, and any file you wrote. Do not commit, push, or sync anything unless asked.

## Failure rules

- A step fails: report the exact command and error, stop that feature, and continue only with independent ones.
- Never use force flags, delete data directories, or reinitialize existing project data (`.codegraph/`, `.beads/`) to make a step pass.
- Never write the Headroom token into JSON config, logs, commits, or chat.
