# Coding-agent output compression pitfalls

## Scope, versions, method

This note lists failure modes of compressing or trimming tool output in coding agents. It covers `rtk`, Headroom `/v1/compress`, provider prompt caches, and the context-trimming features in Claude Code and Codex. Each entry states the symptom, the cause, a source, whether it applies to this setup, and a guard.

Setup under review:

- OMP with a planned `packages/rtk` plugin that calls `rtk rewrite` and sets a per-session `RTK_DB_PATH`.
- The existing `packages/headroom` plugin, which sends the conversation to a Headroom sidecar (`ghcr.io/headroomlabs-ai/headroom:0.40.0-code-nonroot`, Kompress off, `coding` profile) on every LLM call. It uses stateless mode today and is planned to use `config.session_id`.
- Languages: TypeScript, Go, Rust.
- Goal: lower the total bill, not a higher displayed saved percentage.

Versions checked:

- rtk **0.51.0** is installed (`rtk --version`). [0.52.0 was published 2026-10-13](https://github.com/rtk-ai/rtk/releases/tag/v0.52.0).
- Headroom [v0.40.0](https://github.com/headroomlabs-ai/headroom/tree/v0.40.0) docs and source.
- Provider docs were read on 2026-10-13.

Method: `gh issue` search and reading in `rtk-ai/rtk`, `headroomlabs-ai/headroom`, `anthropics/claude-code` and `openai/codex`; the v0.51.0 and v0.40.0 sources; and local probes. Probes ran `rtk 0.51.0` on macOS arm64 against throwaway Rust, Go and Bun projects in `/tmp`. They are cited as "Local probe". Third-party issue bodies are claims by reporters unless a local probe or a maintainer comment confirms them.

Applicability labels: **applies**, **not applicable**, **unclear**.

### Facts about this machine that change the analysis

1. **`pi-rtk-optimizer` is already installed.** `~/.omp/agent/extensions/pi-rtk-optimizer/config.json` has `mode: "rewrite"`, `outputCompaction.truncate = {enabled: true, maxChars: 12000}`, and `aggregateTestOutput`, `filterBuildOutput`, `compactGitOutput`, `aggregateLinterOutput` and `groupSearchOutput` all `true`. It rewrites bash commands and also compacts `bash`, `read` and `grep` results in a `tool_result` hook ([README](https://github.com/MasuRii/pi-rtk-optimizer/blob/main/README.md)). The new plugin would be a second owner of the same job.
2. **The current Headroom bridge hides tool arguments.** `packages/headroom/bridge.ts` (`convertToolCall`, lines 160-168) maps every tool call to `name: "pi_tool_result"` with `arguments: {"originalToolName": ...}`. The real `command` string is not sent.
3. **`rtk rewrite` returns exit 3 for every default rewrite.** Local probe: `git status`, `cargo test`, `go test ./...`, `bunx tsc --noEmit` and `cat foo.ts` all exit 3 with a valid rewrite on stdout. Unsupported commands exit 1 with no output. `~/.claude/settings.json` exists but contains no `deny` rule.
4. **`RTK_DB_PATH` only moves the tracking DB.** Local probe: with `RTK_DB_PATH=/tmp/rtkx/track.db`, a failing `rtk cargo test` wrote `track.db`. The recall store `recall.db` stayed under `~/Library/Application Support/rtk/`. `rtk rewrite` itself writes no DB. Local probe: `RTK_DB_PATH=/tmp/rtkx/t2.db rtk rewrite "cargo test"` created no file.

## Summary table

| ID | Pitfall | Applies | Guard (where) |
|---|---|---|---|
| R1 | `rtk rewrite` exit-code contract (0/1/2/3) | applies | Accept exit 0 and 3 only; require `rewritten !== original` (rtk plugin) |
| R2 | Pipe stages and consumers get rewritten | applies | Skip any command containing `\|` (rtk plugin) |
| R3 | Multi-line commands, assignment lines, quoting | applies | Skip commands containing a newline; reject multi-line stdout (rtk plugin) |
| R4 | Long-lived, interactive and stdin-driven commands | applies | Small deny-list before calling rtk (rtk plugin) |
| R5 | Filtered test/build output hides failures | applies | Do not rewrite `vitest`/`jest`; keep `rtk` for the rest; add an escape-hatch hint to the prompt (rtk plugin) |
| R6 | rtk's exit-code guard is not in 0.51.0 | applies | Rely on OMP's own exit-code line; do not trust the summary text alone |
| R7 | `never_worse` is a size guard, not a fidelity guard | applies | Do not read it as a safety property; measure cost from provider usage |
| R8 | Recall store: when a hint exists, where it lives | applies | Keep the hint line intact; set `RTK_RECALL_DB` deliberately |
| R9 | Permission verdicts come from Claude Code settings | applies, low | Treat 0 and 3 identically; ignore ask semantics |
| R10 | Savings accounting is inflated | applies | Measure with provider `usage`, not `rtk gain` |
| R11 | `cat`/`head`/`tail` rewritten to `rtk read` | applies | Exclude read-like commands from rewrite |
| R12 | `rtk git diff` truncates added lines | applies | Exclude `git diff` and `git show` from rewrite |
| R13 | Duplicate owners: `pi-rtk-optimizer` plus the new plugin | applies | Disable one; single owner of output compaction |
| R14 | Per-session DB hygiene and version drift | applies | 0700 temp dir, delete at shutdown; require rtk >= 0.51.0 |
| C1 | Prompt-cache prefix mechanics and price ratios | applies | Never change bytes already sent |
| C2 | Re-compressing history after first send | applies | Plugin-side store of forwarded text, keyed by tool-call id |
| C3 | Fail-open on `503` in session mode | applies | Retry once; replay stored text, never raw originals |
| C4 | Thinking-block prefix check | unclear | Same as C2; check model and account age |
| C5 | Minimum cacheable length | applies, low | Skip tiny tool results |
| C6 | Cold cache makes edits free | applies, optional | Only batch older edits after a TTL gap |
| C7 | OpenAI caching differences | unclear | Same invariants; read `cached_tokens` |
| C8 | Server-side clearing and Claude Code microcompact | not applicable, lessons apply | Gate any trimming by minimum tokens cleared |
| C9 | Head/tail truncation drops the middle | applies | Never truncate error-bearing middle; keep spill path |
| I1 | rtk then Headroom: double lossy compression | applies | Do not send already-compacted results to Headroom |
| I2 | Headroom read protection needs the command text | applies | Send real tool name and `arguments.command` |
| I3 | Elided content causes re-reads and loops | applies | Visible, actionable markers; `read` never compressed |
| I4 | Three truncation layers stack | applies | One owner per tool; document the order |

## A. rtk rewrite layer

### R1. `rtk rewrite` exit-code contract

- **Symptom.** Rewrites silently stop, or rewritten commands are dropped, with no error.
- **Cause.** `rtk rewrite --help` documents only exit 0 (rewrite) and exit 1 (none). The real contract has four values: 0 allow, 1 none or defer, 2 deny, 3 ask-or-default. The default verdict with no matching rule is **exit 3** ([src/hooks/README.md, lines 82-85](https://github.com/rtk-ai/rtk/blob/v0.51.0/src/hooks/README.md#L82-L85)). A hook that follows the documented idiom `REWRITTEN=$(rtk rewrite "$CMD") || exit 0` discards every exit-3 rewrite ([#3634](https://github.com/rtk-ai/rtk/issues/3634): 0.0% adoption over 34,182 commands). In Claude Code, exit-3 `updatedInput` is also dropped in permissive modes ([#1233](https://github.com/rtk-ai/rtk/issues/1233)). The stock Pi/OMP extension treats **0 and 3 as "rewrite"** and everything else as pass-through ([hooks/pi/rtk.ts, lines 8-12 and 38-47](https://github.com/rtk-ai/rtk/blob/v0.51.0/hooks/pi/rtk.ts#L8-L47)).
- **Local probe.** Exit 3 is what `rtk rewrite "cargo test"` returns on this machine; `RTK_DISABLED=1 cargo test` returns exit 1 with a stderr notice.
- **Applies.** Yes. The plugin shells out to the same command.
- **Guard (plugin).**
  - Run `rtk rewrite <cmd>` with a short timeout.
  - Accept the result only when the exit code is 0 or 3, stdout is non-empty, and `stdout.trim() !== cmd`.
  - Treat 1 and 2 as pass-through.
  - Treat a timeout or spawn error as pass-through.
  - Never branch on "non-zero means none".

### R2. Pipe stages are rewritten

- **Symptom.** `git log | head`, `cargo test 2>&1 | tail -3` and `grep -n x f | head -2` return different lines than the agent asked for. The pipe closing early can also panic rtk with a broken-pipe error.
- **Cause.** Since the safe-consumer change ([#3343](https://github.com/rtk-ai/rtk/issues/3343), tracked in [#3171](https://github.com/rtk-ai/rtk/issues/3171)) `head` and non-following `tail` count as safe pipe consumers, so the producer is rewritten. `head`/`tail` select by line position, and rtk's output has a different header, caps and a trailing recall hint ([#4207](https://github.com/rtk-ai/rtk/issues/4207), [#4364](https://github.com/rtk-ai/rtk/issues/4364), [#4445](https://github.com/rtk-ai/rtk/issues/4445), [#2487](https://github.com/rtk-ai/rtk/issues/2487); tracking issue [#3171](https://github.com/rtk-ai/rtk/issues/3171)).
- **Local probe.** `rtk rewrite "cargo test 2>&1 | tail -3"` returns `rtk cargo test 2>&1 | tail -3`; so do `git diff | head`, `git log --oneline | head -3` and `rg -n foo src | head`. With a failing Rust test, `rtk cargo test 2>&1 | tail -3` printed the summary line plus `[full output: rtk recall afb2e41fcaad]`. The raw `tail -3` printed `test result: FAILED...` and `error: test failed, to rerun pass --lib`. The recall line took one of the three slots.
- **`exclude_commands` does not help.** Local probe with a fake `HOME` and `exclude_commands = [..., "head", ...]`: `git log | head -3` was still rewritten. This matches [#3740](https://github.com/rtk-ai/rtk/issues/3740).
- **Applies.** Yes. Agents use these idioms constantly.
- **Guard (plugin).** Skip any command containing a top-level `|`. The agent has already truncated that output itself, so rtk adds little; [#2805](https://github.com/rtk-ai/rtk/issues/2805) shows rtk gets credit for the agent's own `head`/`tail`. The cost of skipping is near zero.

### R3. Multi-line commands, assignment lines, quoting

- **Symptom.** A variable assignment becomes a program invocation and the variable stays empty. Quoted text is edited. A multi-line rewrite breaks consumers that expect one line.
- **Cause.** In a multi-line command, the hook prefixed `rtk` to a bare `J=/tmp/jq` line ([#3764](https://github.com/rtk-ai/rtk/issues/3764)). The hook edited text inside a single-quoted sed replacement ([#3262](https://github.com/rtk-ai/rtk/issues/3262)). `rtk rewrite` can print a rewrite with an embedded newline, violating the one-command stdout contract ([#4351](https://github.com/rtk-ai/rtk/issues/4351)). `git commit` with a heredoc message is not rewritten ([#4483](https://github.com/rtk-ai/rtk/issues/4483)). The `case ... ;;` break ([#3197](https://github.com/rtk-ai/rtk/issues/3197)) is fixed in [0.52.0](https://github.com/rtk-ai/rtk/releases/tag/v0.52.0).
- **Local probe.** On 0.51.0, `rtk rewrite $'J=/tmp/jq\nls -l $J/f'` returned `rtk J=/tmp/jq` / `rtk ls -l $J/f` with exit 3. That rewrite is wrong. The heredoc `git commit` and the `case` statement returned exit 1.
- **Applies.** Yes. Models send multi-line scripts regularly.
- **Guard (plugin).** Skip commands that contain `\n`. Reject a rewrite whose stdout contains `\n`. Skip commands that already start with `rtk ` or `RTK_DISABLED=`.

### R4. Long-lived, interactive and stdin-driven commands

- **Symptom.** A command hangs after the remote side exits, stdin content is lost, or a dev server never returns control.
- **Cause.** `ssh` was wrapped by the Claude Code hook without a dedicated handler and hung ([#3748](https://github.com/rtk-ai/rtk/issues/3748)). The hook dropped stdin for `wrangler secret put`, storing empty secrets ([#2431](https://github.com/rtk-ai/rtk/issues/2431)). `rtk proxy` never returned when a descendant kept the pipes open ([#2829](https://github.com/rtk-ai/rtk/issues/2829)). `dotnet build` hung on a long-lived child daemon ([#2320](https://github.com/rtk-ai/rtk/issues/2320)).
- **Local probe.** `rtk rewrite "ssh host ls"` returned `rtk ssh host ls` and `rtk rewrite "bun run dev"` returned `rtk bun run dev`, both with exit 3. `tail -f log` and `less foo` returned exit 1, so rtk already skips them.
- **Applies.** Yes for `ssh`, dev servers and anything reading stdin. Not applicable to `cargo`, `go` and `tsc` one-shot builds.
- **Guard (plugin).** Skip commands whose program is `ssh`, `docker exec -it`, or whose arguments match `run dev|start|watch|serve|--watch`. Keep this list to a few lines and extend only when a real hang appears.

### R5. Filtered test and build output hides the failure

- **Symptom.** The agent sees a green or empty summary while the exit code is non-zero, or sees a count with the error text missing, and re-runs or chases a phantom.
- **Cause.** Filters count only some failure classes.
  - **TypeScript.** The vitest filter ignores suite-level failures such as import errors and failing `beforeAll`, and prints `PASS (N) FAIL (0)` ([#3935](https://github.com/rtk-ai/rtk/issues/3935); jest equivalent [#3588](https://github.com/rtk-ai/rtk/issues/3588)). It drops coverage-threshold errors, reported on **rtk 0.51.0** ([#4531](https://github.com/rtk-ai/rtk/issues/4531)). A suite that fails to load prints `PASS (0) FAIL (0)` ([#4171](https://github.com/rtk-ai/rtk/issues/4171), closed). That report describes the agent re-running through `rtk proxy` and paying for the raw output on top. `rtk tsc --showConfig` and `--listFiles` print `TypeScript: No errors found` ([#3750](https://github.com/rtk-ai/rtk/issues/3750)).
  - **Rust.** Warning blocks consume the 20-block budget, so errors vanish while the header still counts them ([#3762](https://github.com/rtk-ai/rtk/issues/3762)). `cargo test -- --list` prints nothing ([#4453](https://github.com/rtk-ai/rtk/issues/4453)). `cargo nextest` drops `N failed` when a test is slow ([#4420](https://github.com/rtk-ai/rtk/issues/4420)).
  - **Go.** `go test -v` drops passing-test output that tests print, which breaks grep gates ([#3985](https://github.com/rtk-ai/rtk/issues/3985)). A failing fuzz run drops the failing input ([#4434](https://github.com/rtk-ai/rtk/issues/4434)). `go test -list` prints "No tests found" ([#4419](https://github.com/rtk-ai/rtk/issues/4419)). Go filters can hide compiler errors ([#2281](https://github.com/rtk-ai/rtk/issues/2281)). `go test` summaries show the failing package and defer the error text to the tee file ([#1882](https://github.com/rtk-ai/rtk/issues/1882)).
  - **Generic.** The same class is tracked in [#2317](https://github.com/rtk-ai/rtk/issues/2317).
- **Local probes.** The common case is fine on 0.51.0.
  - A failing `cargo test` kept both panic messages and the `test result:` line.
  - A failing `go test` and a `go build` error kept `a_test.go:4: want 1 got 2` and `./b.go:2:23: undefined: undefinedThing`.
  - A failing `bun test` kept the `(fail)` line, expected and received values, and the unresolved-import error.
  - Dropped in all three: stdout the test itself printed (the Go test's `fmt.Println("stdout from test")` and Bun's `console.log("DEBUGLINE")`) and, for Bun, the source-context excerpt. Both are stored under the recall hash.
- **Applies.** Yes for vitest and jest, `--list`, `-v` and fuzz runs. Cargo, Go and Bun basic failures behaved correctly in the probes.
- **Guard.**
  - Plugin: do not rewrite `vitest`, `jest`, `bunx vitest`, `npx vitest`, or any command containing ` -- --list`, `go test ... -v`, `-list`, `-fuzz`. Keep rtk for `cargo test`, `go test`, `go build`, `cargo build`, `tsc` and `bun test`.
  - Local probe with `exclude_commands = ["vitest", "bunx vitest", ...]` under a fake `HOME`: a leading-token pattern excludes `vitest`, `bunx vitest run`, `npx vitest run` and `pnpm vitest run`. It matches the start of the command only, so a plugin-side check is simpler and stays in the repo.
  - Prompt (one stable line, so it stays cached): "If shell output looks truncated or contradicts the exit code, rerun with `RTK_DISABLED=1 <command>` or `rtk recall <hash>`." This targets the retry loops in [#1777](https://github.com/rtk-ai/rtk/issues/1777) and [#2280](https://github.com/rtk-ai/rtk/issues/2280).
  - Do not recommend `rtk proxy` as the fallback. It truncates `cargo` error output ([#3500](https://github.com/rtk-ai/rtk/issues/3500)) and mis-dispatches flags after `&&` ([#3253](https://github.com/rtk-ai/rtk/issues/3253)). Both are open reports on 0.43.0.

### R6. rtk's exit-code guard is not in 0.51.0

- **Symptom.** A filter prints an all-green summary after a non-zero exit.
- **Cause.** [PR #3577](https://github.com/rtk-ai/rtk/pull/3577) ("never-worse exit-code guard across all tool filters") is **open and unmerged**. [#4421](https://github.com/rtk-ai/rtk/issues/4421) lists rspec, phpunit, mvn, bun, deno, ctest and sbt as still rendering green on non-zero exit. The v0.51.0 `core/guard.rs` contains only the size guard ([lines 21-27](https://github.com/rtk-ai/rtk/blob/v0.51.0/src/core/guard.rs#L21-L27)) and no exit-code helper. The name "never-worse" in the PR title is not the same mechanism as R7.
- **Applies.** Yes for `bun test`. The rtk exit code itself is propagated in the probes ([#3220](https://github.com/rtk-ai/rtk/issues/3220) states the same for tsc).
- **Guard.** OMP's bash result already carries a `Command exited with code N` line, so the agent can see a contradiction. The prompt hint in R5 tells it what to do about one. No plugin code is needed beyond R5.

### R7. `never_worse` is a size guard, not a fidelity guard

- **Symptom.** A filter that shrinks output is accepted even if it dropped the one useful line.
- **Cause.** `never_worse(raw, filtered)` returns `raw` only when `estimate_tokens(filtered) > estimate_tokens(raw)` ([guard.rs](https://github.com/rtk-ai/rtk/blob/v0.51.0/src/core/guard.rs#L19-L27)). It protects against output that grows. It says nothing about missing content. One side effect: ruff printed `[]` on a clean tree because the injected JSON was shorter than the filter summary ([#4218](https://github.com/rtk-ai/rtk/issues/4218), fixed in 0.51.0 by an exception for clean runs).
- **Applies.** Yes, as a reading error: a "never worse" label is not a correctness guarantee.
- **Guard.** None in code. Do not use rtk's saved percentage as a quality proxy. See R10.

### R8. Recall store: when a hint exists, where it lives

- **Symptom.** The output ends with `[full output: rtk recall <hash>]`, or elides lines with no way back.
- **Cause.** Default mode is `sqlite` ([retriever.rs, lines 26-33](https://github.com/rtk-ai/rtk/blob/v0.51.0/src/core/retriever.rs#L26-L33)). In that mode a command output is stored only when the exit code is non-zero and the raw output is at least 500 bytes ([tee.rs, lines 52-66](https://github.com/rtk-ai/rtk/blob/v0.51.0/src/core/tee.rs#L52-L66)); a filter that trims a list can also force a hint. Defaults: 10 MiB per entry, 200 entries FIFO, 30-day retention ([retriever.rs, lines 17-19](https://github.com/rtk-ai/rtk/blob/v0.51.0/src/core/retriever.rs#L17-L19)). `RTK_RECALL_DB` overrides the path ([retriever.rs, lines 173-176](https://github.com/rtk-ai/rtk/blob/v0.51.0/src/core/retriever.rs#L173-L176)); `RTK_DB_PATH` does not. A **successful** run whose output rtk replaced has no recovery path ([#3750](https://github.com/rtk-ai/rtk/issues/3750)). Some caps elide lines and store nothing ([#4098](https://github.com/rtk-ai/rtk/issues/4098)). The legacy tee mode has a filename collision between concurrent instances ([#3431](https://github.com/rtk-ai/rtk/issues/3431)); that does not apply to the default sqlite mode.
- **Local probe.** After the `RTK_DB_PATH` test, `rtk recall --list` still listed the new `cargo_test` entries from the global `recall.db`.
- **Applies.** Yes. With a per-session `RTK_DB_PATH` only, all sessions share one 200-entry recall FIFO. A long parallel run can evict a hash the agent still holds.
- **Guard.**
  - Plugin: set `RTK_RECALL_DB` to a per-session path beside the per-session `RTK_DB_PATH`, in the same environment used for the `bash` tool, so `rtk recall <hash>` finds it. `rtk recall` starts with `rtk ` and is therefore not rewritten.
  - Headroom plugin: never let Headroom touch a result containing `[full output: rtk recall`. See I1.

### R9. Permission verdicts come from Claude Code settings

- **Symptom.** A rewrite is withheld or marked "ask" because of a Claude Code rule that OMP does not enforce.
- **Cause.** rtk reads `Bash(...)` rules from Claude Code `settings.json` files and maps them to exit codes. Deny returns exit 2 and passes through; ask and default return 3 ([README, lines 75-85](https://github.com/rtk-ai/rtk/blob/v0.51.0/src/hooks/README.md#L75-L85)). `RTK_REWRITE_HOST=<agent>` changes the default only for OpenClaw ([lines 87-99](https://github.com/rtk-ai/rtk/blob/v0.51.0/src/hooks/README.md#L87-L99)). The Pi hook's stated design is rewrite-only, with permission gating out of scope ([hooks/pi/README.md](https://github.com/rtk-ai/rtk/blob/v0.51.0/hooks/pi/README.md)). Several open reports show the rtk permission parser diverging from the host ([#4281](https://github.com/rtk-ai/rtk/issues/4281), [#3970](https://github.com/rtk-ai/rtk/issues/3970)); they matter only to hosts that rely on rtk for gating.
- **Applies.** Low. `~/.claude/settings.json` has no `deny` entry, so every default rewrite is exit 3. OMP does not use rtk for approval.
- **Guard.** Plugin treats 0 and 3 identically (R1), ignores "ask", and does not surface it to the user. A future `deny` rule in Claude Code settings would silently stop rewriting for matching commands; that is acceptable.

### R10. Savings accounting is inflated

- **Symptom.** `rtk gain` reports large savings that did not reduce the bill.
- **Cause.** rtk is credited with filtering the agent already did: 2.1M tokens claimed for a ~195-token saving ([#2805](https://github.com/rtk-ai/rtk/issues/2805)). `head -N`/`tail -N` rewrites are booked as a `cat` of the whole file ([#4366](https://github.com/rtk-ai/rtk/issues/4366)). Negative savings floor to zero ([#3702](https://github.com/rtk-ai/rtk/issues/3702)). Filters that never engage are invisible: `curl` passed 34M tokens at 0% in two months ([#4390](https://github.com/rtk-ai/rtk/issues/4390)) and JSON reads leaked 2.9M at 3% ([#4393](https://github.com/rtk-ai/rtk/issues/4393)). One independent eval reported rtk defaults at **16% higher cost per passing run** than no rtk, on an August build ([#3492](https://github.com/rtk-ai/rtk/issues/3492)). A commenter could not reproduce the exit-code root cause on `develop` at 0.48.0 across 35 cases, so treat that number as a caution, not a measurement of 0.51.0.
- **Applies.** Yes, because the plugin displays "RTK Savings" ([CONTEXT.md](../../CONTEXT.md)) and the goal is total bill.
- **Guard.** Label the display as an estimate. Judge changes by provider `usage` (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`) over a fixed task set, not by `rtk gain`.

### R11. `cat`, `head`, `tail` rewritten to `rtk read`

- **Symptom.** Code reads return filtered text, or the agent re-reads a file in a different form.
- **Cause.** `rtk read --max-lines N` returned N/2 lines ([#3370](https://github.com/rtk-ai/rtk/issues/3370)) and dropped middle lines with no gap marker ([#3421](https://github.com/rtk-ai/rtk/issues/3421)). Data and code reads gain almost nothing: `.tsx` 1-6% and `.json` 3% ([#4393](https://github.com/rtk-ai/rtk/issues/4393)).
- **Local probe.** On 0.51.0 `head -50 f` rewrites to `rtk read f --head-lines 50` and `rtk read src/lib.rs --head-lines 10` printed exactly 10 lines. The N/2 bug does not reproduce through this path. `cat f` rewrites to `rtk read f` and printed all 126 of 126 lines with no filtering at the default level. `sed -n 1,50p f` returned exit 1.
- **Applies.** Yes for risk, no for savings. The rewrite adds a surface for bugs with about zero benefit on code. It also defeats Headroom's read protection (I2).
- **Guard (plugin).** Skip rewrite when the program is `cat`, `head`, `tail`, `sed`, `nl` or `bat`. OMP's own `read` tool is the intended path for code.

### R12. `rtk git diff` truncates added lines

- **Symptom.** A diff reviewed or used for a patch is cut off.
- **Cause.** Compaction caps hunks. Related reports: silent loss on large diffs ([#3257](https://github.com/rtk-ai/rtk/issues/3257)), patch bodies dropped with colored output ([#3842](https://github.com/rtk-ai/rtk/issues/3842)), output that breaks `patch`/`git apply` consumers ([#1918](https://github.com/rtk-ai/rtk/issues/1918)).
- **Local probe.** A 120-line addition printed 100 `+` lines then `... (20 additions truncated)` and `[full diff: rtk git diff --no-compact]`.
- **Applies.** Yes. The marker is explicit and the recovery command is not rewritten again because it starts with `rtk `. The cost is one extra tool call every time the diff exceeds the cap.
- **Guard (plugin).** Skip `git diff` and `git show`. Keep `git status` and `git log` without pipes.

### R13. Two owners of the same job

- **Symptom.** A command is rewritten twice, or output is compacted twice by different engines.
- **Cause.** `pi-rtk-optimizer` is installed and configured to rewrite and to hard-truncate every result at 12,000 characters. It reimplements test, build, git, linter and search aggregation in the extension, separate from rtk's binary filters. Its README warns that compaction causes `old text does not match` edit failures ([README](https://github.com/MasuRii/pi-rtk-optimizer/blob/main/README.md)). The stock rtk hook skips commands that already start with `rtk ` ([hooks/pi/rtk.ts, line 123](https://github.com/rtk-ai/rtk/blob/v0.51.0/hooks/pi/rtk.ts#L123)), so a second rewriter would not double-prefix. Output compaction has no such guard.
- **Observation.** A `grep` call in this research session returned a result ending `[+3 hidden: rtk recall cbb8308a9fda]`, which is rtk's elision format. That is consistent with the current extension setup compacting at result level.
- **Applies.** Yes.
- **Guard.** Disable `pi-rtk-optimizer` (or set `outputCompaction.enabled: false`) when the new plugin is enabled. Give exactly one component ownership of bash output compaction.

### R14. Per-session DB hygiene and version drift

- **Symptom.** Commands persist in a database nobody cleans; a corrupt DB prints an error on every call; behavior changes across rtk versions.
- **Cause.** The hook records every Bash command verbatim in `hook_decisions.raw_cmd`, and neither `exclude_commands` nor `[tracking] enabled = false` stops it ([#4147](https://github.com/rtk-ai/rtk/issues/4147)); `tracking.db` exposes full command history ([#1160](https://github.com/rtk-ai/rtk/issues/1160)). A corrupt `history.db` is never moved aside and logs once per command ([#4209](https://github.com/rtk-ai/rtk/issues/4209)). `RTK_DB_PATH` is the first-priority override ([tracking.rs, lines 1635-1639](https://github.com/rtk-ai/rtk/blob/v0.51.0/src/core/tracking.rs#L1635-L1639)). This build reports no telemetry endpoint (`rtk telemetry status`, local probe).
- **Applies.** Yes, with a caveat: `rtk rewrite` writes no DB (local probe), so `hook_decisions` only appears if the `rtk hook <agent>` path is used.
- **Guard.** Create the per-session DB and recall DB in a `0700` temp directory and delete it on session shutdown. Check `rtk --version` at load and require at least 0.51.0 (the stock hook requires 0.23.0 and has no upper bound). Consider [0.52.0](https://github.com/rtk-ai/rtk/releases/tag/v0.52.0) after reading its notes; it fixes `case` terminators and Go fuzz summaries.

## B. Provider prompt caching

### C1. Anthropic prefix-cache mechanics

Facts, all from [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching):

- The cached prefix is `tools`, then `system`, then `messages`. A cache entry is a hash of the whole prefix up to a breakpoint, so changing any earlier block changes the hash and misses.
- Reads look back at most 20 block positions for an entry an earlier request wrote.
- Minimum cacheable length per model: 512 tokens for Opus 5.5, Opus 5, Sonnet 5.5, Fable 5 and 5.1, Haiku 5.5; 1,024 for Sonnet 5, Sonnet 4.6, Opus 4.8; 2,048 for Opus 4.7; 4,096 for Opus 4.6, Opus 4.5 and Haiku 4.5. Below the minimum nothing is cached and no error is returned.
- Default lifetime is 5 minutes, refreshed free on each hit and measured from the request start. A 1-hour TTL is available.
- Multipliers: 5-minute write 1.25x, 1-hour write 2x, read 0.1x of base input. Opus 5.5 and Sonnet 5.5 reads are 0.05x.
- Example, Sonnet 5.5: base $2/MTok, 5-minute write $2.50/MTok, read $0.10/MTok.

Cost consequence. A cache bust on a prefix of P tokens costs about P times (write price minus read price) extra. For Sonnet 5.5 a 100k-token prefix costs about $0.24 extra to rewrite and $0.01 to read. Compressing a new 20k-token tool result to 8k saves about $0.03 once at write price, plus about $0.0012 per later turn at read price. One bust cancels roughly eight such compressions. Compression pays only when it never changes bytes that were already sent.

### C2. Re-compressing history after the first send

- **Symptom.** `tokens_saved` is positive and cache-read tokens fall to the system and tools floor.
- **Cause.** Headroom documents it: without a session, `/v1/compress` "sees one isolated call and has no idea what the provider already cached"; re-sending pristine messages "silently busts the cache", and compression strength can change as a result moves away from the end of the conversation ([proxy.mdx, lines 631-662](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/docs/content/docs/proxy.mdx#L631-L662)). Session mode keeps replay state in process, so every already-returned message comes back unchanged. That state lives for `HEADROOM_COMPRESSION_CACHE_TTL_SECONDS` of idle time (default 3,900) and is lost on restart ([line 695](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/docs/content/docs/proxy.mdx#L695)). Claude Code users measured the same effect: each mid-history prune dropped `cache_read` to the shared prefix and rewrote 620-830k tokens ([anthropics/claude-code#94177](https://github.com/anthropics/claude-code/issues/94177)).
- **Applies.** Yes. The plugin sends the full raw conversation on each call. Session mode fixes this only while Headroom's process state survives. A container restart, an idle gap above 3,900 s, or a changed `session_id` re-compresses from raw and can change old bytes. The plugin calls `resetSession` on `session_start`, `session_switch` and `session_branch` (`index.ts`, lines 133-143). If the id changes on a branch, the branch's shared history is re-compressed. Whether the id changes there is a design choice not yet made.
- **Guard (plugin).** Keep a plugin-side map from tool-call id to the text last forwarded, persisted with the session. Every call: replace each known id with the stored text, compress only ids not yet in the map, then store the result. Headroom's own rule: "send back your own previous output, not the original messages" ([lines 643-645](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/docs/content/docs/proxy.mdx#L643-L645)). The map makes the prefix independent of Headroom's memory.

### C3. Fail-open on `503` in session mode

- **Symptom.** After a transient failure the next request misses the cache for the whole conversation.
- **Cause.** The planned "fail open on 503" conflicts with the contract. In session mode "timeouts and busy sessions are a `503`, never fail-open. Handing back originals would leave the caller forwarding bytes the replay state does not know about"; "retry the turn and it lands on consistent state" ([proxy.mdx, line 694](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/docs/content/docs/proxy.mdx#L694)). Without a session, a timeout returns 200 with originals and `compression_skipped: true` ([line 627](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/docs/content/docs/proxy.mdx#L627)). Concurrent turns on one session that wait over 10 s also get 503.
- **Applies.** Yes, directly to the planned change.
- **Guard (plugin).** On 503, retry once. If it still fails, forward the C2 map's stored text for known ids and raw text for new ids. Never fall back to raw text for ids already forwarded in compressed form. A `compression_skipped: true` reply (200, originals) must be handled the same way. Use one `session_id` per OMP agent session, including subagents: Headroom serializes turns per id, and it warns that an id shared across conversations (Claude Code subagents do this with the header option) blends them into one replay state ([line 696](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/docs/content/docs/proxy.mdx#L696)).

### C4. Thinking-block prefix check

- **Symptom.** HTTP 400 `Invalid signature in thinking block`, or silently dropped thinking and more output tokens.
- **Cause.** On Claude Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5, a thinking block stays valid only while everything sent before it is unchanged. The checked prefix is `system`, `tools` and every earlier message. "Clear or shorten an earlier `tool_result`" is listed as invalid for every later thinking block. The API enforces this by default for accounts created on or after 2026-08-31; older accounts see it only when `thinking.block_binding.prefix_mismatch_behavior` is set. The documented fix: "Shorten a tool result ... before the first time you send it, not after" ([Preserved thinking, prefix check](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#prefix-check)). Dropped blocks make the model regenerate reasoning, so output tokens rise.
- **Applies.** Unclear. It applies if this setup sends the listed models with thinking directly to Anthropic on an account created on or after 2026-08-31, or sets the mismatch behavior. It does not apply to models before Fable 5.1, to Mythos 5.1, or to OpenAI models. The provider, model and account age were not given.
- **Guard.** C2 and C3 satisfy the documented rule: shorten before first send, then never alter. Add a debug log when a forwarded text for a known id differs from the stored one; that is the signal that a restart or a fallback changed history. Do not replace stored text with a new compression of the same result.

### C5. Minimum cacheable length

- **Symptom.** Compression saves nothing measurable early in a session.
- **Cause.** Prompts below the model minimum are never cached ([prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)); the system prompt and tool definitions of a coding agent usually exceed it already.
- **Applies.** Low.
- **Guard.** Do not send tool results below roughly 1-2k tokens as compression candidates. The saving is smaller than a single round trip's latency through the tunnel.

### C6. A cold cache makes edits free

- **Symptom.** An unavoidable change (history edit, model switch, resume) costs a full rewrite.
- **Cause.** When the 5-minute entry has already expired, the next request pays a full write regardless. The Claude Code forensics report observed one prune that cost nothing extra when aligned with a TTL miss, versus 1.3M tokens written within a minute when it was not ([#94177](https://github.com/anthropics/claude-code/issues/94177)).
- **Applies.** Optional. It is a scheduling optimization, not a correctness issue.
- **Guard.** If you ever re-compress older results, do it only when the time since the last LLM call exceeds the cache TTL in use (5 minutes by default, 1 hour if configured). Skip this until the main guards are in place; C4 may forbid it on some models.

### C7. OpenAI prompt caching

- **Cause and facts.** Caching is automatic and prefix-based. Cached reads are discounted up to 95%. On GPT-5.6 and later, the minimum is 1,024 visible tokens, writes cost 1.25x and reads 0.1x, and the lifetime is at least 30 minutes after the last use. On earlier models the minimum varies with request settings, `in_memory` entries last about 5-10 minutes of inactivity, and `24h` retention is optional. Traffic above 15 requests per minute for one prefix can overflow to a machine without the entry. `usage.input_tokens_details.cached_tokens` reports hits ([OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching.md), "Summary of model differences" table).
- **Applies.** Unclear. The invariant is the same as C1: stable prefix bytes, deterministic replay.
- **Guard.** Same as C2 and C3. Read `cached_tokens` before and after enabling the plugin.

### C8. Server-side clearing and Claude Code microcompact

- **Symptom.** Old tool results are replaced by a placeholder; the agent re-reads files or "remembers" what it can no longer see.
- **Cause.** The official `clear_tool_uses_20250919` strategy defaults to `trigger` 100,000 input tokens, `keep` 3 tool uses, and no `clear_at_least`. The documentation states that clearing "invalidates cached prompt prefixes" and advises `clear_at_least` so the cleared tokens are worth the cache write ([Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing#context-editing-and-prompt-caching)). Claude Code's own microcompact replaces results with `[Old tool result content cleared]` and has been reported to do so silently ([#42542](https://github.com/anthropics/claude-code/issues/42542), [#57788](https://github.com/anthropics/claude-code/issues/57788)). A reporter who read the bundled source gives `keepRecent = 5` and `clearAtLeastTokens = 20000` as fixed values ([#98204](https://github.com/anthropics/claude-code/issues/98204)); that is a secondary, unverified source. Image eviction in long sessions mutated the prefix and rewrote 600-740k tokens on every later turn ([#90716](https://github.com/anthropics/claude-code/issues/90716)).
- **Applies.** Not applicable as a feature: OMP is the harness, and nothing here enables `context_management`. The lesson applies: any trimming of history needs a minimum-tokens-cleared gate and must be batched.
- **Guard.** No code. Do not add a second history-trimmer on top of OMP's own compaction without a measured minimum.

### C9. Head and tail truncation drops the middle

- **Symptom.** The error is in the middle of a long log and is gone.
- **Cause.** Codex truncates tool output as a head and tail snippet, which "frequently removes critical error information located in the middle" ([openai/codex#9502](https://github.com/openai/codex/issues/9502)), breaks JSON and XML ([#9504](https://github.com/openai/codex/issues/9504)), and has no spill path ([#14206](https://github.com/openai/codex/issues/14206)). After auto-compaction, one user reports the agent re-reading the same files in a loop ([#35226](https://github.com/openai/codex/issues/35226)).
- **Applies.** Yes, as a design warning: `pi-rtk-optimizer` truncates at 12,000 characters, rtk caps lists, OMP truncates large bash output to an artifact, and Headroom elides code bodies.
- **Guard.** Keep recovery paths visible (`artifact://`, `rtk recall`, `read`). See I4.

## C. Interplay

### I1. rtk then Headroom: double lossy compression

- **Symptom.** A result already trimmed by rtk is trimmed again, and the second loss has no recovery path.
- **Cause.** Headroom filed this against a Pi extension: a 262,369-character log became 12,000 characters via rtk truncation, then 10,698 via Headroom `router:search`; another fixture went from 12,000 to 10,515 via `router:log`. "The CCR/retrieval path cannot restore bytes that RTK already removed" ([headroom#3056](https://github.com/headroomlabs-ai/headroom/issues/3056); closed because the code lived on an unmerged branch). `headroom wrap` also auto-installed rtk hooks and double-compressed output ([headroom#1915](https://github.com/headroomlabs-ai/headroom/issues/1915), closed). In `/v1/compress` the default is marker-free, so Headroom's lossy edit stores no original and the model cannot retrieve it ([proxy.mdx, lines 582-584 and 668](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/docs/content/docs/proxy.mdx#L582-L584)). A recall hint line `[full output: rtk recall <hash>]` is plain text; a compressor can drop it.
- **Applies.** Yes. Headroom v0.40.0 does not recognize rtk's markers. Its only rtk awareness is peeling an `rtk` prefix when it parses a bash command (`content_router.py`, [lines 818-832](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/headroom/transforms/content_router.py#L818-L832)).
- **Guard (headroom plugin).** Do not offer a tool result to Headroom when any of these hold: the producing command starts with `rtk `, was rewritten by the rtk plugin, or the text contains `[full output: rtk recall`, `[rtk]`, `hidden: rtk recall`, or `... (N additions truncated)`. Send the stored (verbatim) text instead. rtk already shrank these results, so Headroom's marginal saving is small. The cost is a slightly larger prompt for rtk-compacted commands.

### I2. Headroom read protection needs the command text

- **Symptom.** Source read through `bash` is lossy-compressed and edits fail on stale or elided text.
- **Cause.** The `coding` profile sets `protect_reads=True`: "file reads are never lossy-compressed" ([proxy.mdx, line 173](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/docs/content/docs/proxy.mdx#L173)). For bash-family agents the exclusion by tool name never catches reads, so Headroom parses the command text: `_is_read_command` recognizes `cat`, `head`, `tail`, `nl`, `bat`, `less`, `more` and `sed -n` ([`_READ_VERBS`, line 683](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/headroom/transforms/content_router.py#L683)). It gets the command from the tool-call arguments (`command` or `cmd`) in `_tool_call_command_text` ([lines 555-572](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/headroom/transforms/content_router.py#L555-L572)), and only for tool names `bash`, `shell`, `local_shell` for the search fold ([line 1972](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/headroom/transforms/content_router.py#L1972)). The docstring gives the reason: lossy reads caused agents to re-read the same file in several forms and lowered resolve rates in SWE-bench ([lines 724-733](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/headroom/transforms/content_router.py#L724-L733)).
- **Applies.** Yes, twice.
  - The current bridge sends `pi_tool_result` with `{"originalToolName": ...}` and no `command`, so the parser sees nothing. This holds even after the planned switch to real tool names, unless `arguments` also carries the command.
  - With rtk rewriting `cat f` to `rtk read f`, the program Headroom sees is `read`, which is not in `_READ_VERBS`. `rtk cat f` would be recognized, but rtk does not generate it.
- **Guard.** Headroom plugin: send the real tool `name` and `arguments` containing `command` for bash. rtk plugin: skip `cat`/`head`/`tail`/`sed` rewrites (R11). Also confirm that OMP's own `read` tool name is excluded by the sidecar: the exclusion is by name and must match the exact casing OMP uses.

### I3. Elided content causes re-reads and loops

- **Symptom.** The agent re-runs a command, re-reads a file, or hunts a phantom problem. The second run costs more than the saving.
- **Cause.**
  - Headroom: lossy compression produced plausible but wrong output, such as a `grep` hit that was not there ([headroom#1307](https://github.com/headroomlabs-ai/headroom/issues/1307)). An AST outline said `114 definition(s); bodies elided` after the client had already truncated the file at 25,000 tokens, so it read as a complete inventory ([headroom#2421](https://github.com/headroomlabs-ai/headroom/issues/2421), closed 2026-10-08).
  - rtk: `PASS (0) FAIL (0)` made the agent re-run through `rtk proxy` and pay for raw output as well ([#4171](https://github.com/rtk-ai/rtk/issues/4171)). `ruff` output "No issues found" for an `rtk` rewrite made the model believe it had mistyped the command and loop ([#2280](https://github.com/rtk-ai/rtk/issues/2280)). A condensed `npm test` summary led to repeated identical retries ([#1777](https://github.com/rtk-ai/rtk/issues/1777)).
  - Edits: `old text does not match` failures after compaction ([pi-rtk-optimizer README](https://github.com/MasuRii/pi-rtk-optimizer/blob/main/README.md)).
- **Applies.** Yes. Headroom's code-aware step replaces function bodies with `// [N lines omitted]` and the profile has `protect_recent_code=4`.
- **Guard.**
  - Never compress `read`, `edit`, `write` and `grep` results (name-based exclusion, with real tool names).
  - Keep every elision marker visible and actionable. rtk's markers carry a recovery command; Headroom's do not, so keep Headroom off rtk-processed output (I1).
  - Include the R5 prompt line about `RTK_DISABLED=1` and `rtk recall`.
  - Judge the setup by output tokens plus total turns on a fixed task set. A re-read costs more than most savings.

### I4. Three truncation layers stack

- **Symptom.** Nobody knows which layer removed a line.
- **Cause.** Order of effect for one `bash` call: rtk filter, `pi-rtk-optimizer` truncation if still installed, OMP's own output cap with an artifact path, then Headroom per request. Each has a different recovery path (`rtk recall`, none, `artifact://`, none). Claude Code and Codex show the same pattern with their own caps ([anthropics/claude-code#42542](https://github.com/anthropics/claude-code/issues/42542), [openai/codex#9502](https://github.com/openai/codex/issues/9502)).
- **Applies.** Yes.
- **Guard.** One owner per tool class. Suggested split: rtk owns shell build and test output from `cargo`, `go`, `tsc`, `bun test`; OMP owns reads and edits untouched; Headroom owns the rest, excluding anything rtk already processed. Write this split into the plugin READMEs.

## Recommended plugin guards

**`packages/rtk`**

- Skip rewrite when the command: contains `|` or `\n`; starts with `rtk ` or `RTK_DISABLED=`; has program `cat`, `head`, `tail`, `sed`, `nl`, `bat`, `ssh`, `vitest` or `jest` (including `bunx`/`npx`/`pnpm` forms); is `git diff` or `git show`; contains `--list`, `go test` with `-v|-list|-fuzz`; or matches `run dev|start|watch|serve`.
- Accept a rewrite only for exit 0 or 3, with non-empty single-line stdout different from the input. Pass through on timeout.
- Per-session `RTK_DB_PATH` and `RTK_RECALL_DB` in a `0700` temp directory, passed to the bash tool environment, deleted at shutdown.
- Require rtk >= 0.51.0 at load.
- Add one stable prompt line: use `RTK_DISABLED=1 <cmd>` or `rtk recall <hash>` when output looks truncated or contradicts the exit code.
- Disable `pi-rtk-optimizer` output compaction.

**`packages/headroom`**

- Send real tool names and `arguments.command` for bash.
- Keep a persisted per-session map from tool-call id to forwarded text. Compress only new ids. Replay stored text on retry, `503`, `compression_skipped` and Headroom restart.
- Retry `503` once before falling back. Never fall back to raw text for ids already forwarded compressed.
- One `session_id` per OMP agent session. Re-seed the map on `session_branch`.
- Do not offer results containing rtk markers, or from `rtk`-prefixed commands, to Headroom.
- Do not offer results below about 1-2k tokens.
- Log a warning when a replayed text differs from the stored one.

**Server (Headroom sidecar)**

- Leave `config.mode` unset (marker-free, [proxy.mdx line 668](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/docs/content/docs/proxy.mdx#L668)). Keep `HEADROOM_PROTECT_READS` on by using the `coding` profile; the content router's own default is `0` when the variable is unset ([content_router.py, lines 541-552](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/headroom/transforms/content_router.py#L541-L552)), so verify it is on in this deployment.
- Raise `HEADROOM_COMPRESSION_CACHE_TTL_SECONDS` above the longest expected idle gap (default 3,900 s) only if the plugin-side map is not built.
- Pin to one process; replay state is in-process ([line 695](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/docs/content/docs/proxy.mdx#L695)).

## Not verified here

- Whether the sidecar's `coding` profile actually sets `HEADROOM_PROTECT_READS` at runtime. The docs say `protect_reads=True`; the router reads an environment variable that defaults to `0`. No sidecar was reachable locally (`localhost:8787` returned nothing), so this was not tested.
- Which provider, model and account age this setup uses. C4 and C7 depend on it.
- rtk 0.52.0 behavior. Probes ran on 0.51.0 only.
- vitest and jest suite-level failure rendering. No Node test project was run; the claims rest on the cited issues, of which #4531 names rtk 0.51.0.

## Sources

- rtk: [v0.51.0 source](https://github.com/rtk-ai/rtk/tree/v0.51.0), [release 0.51.0](https://github.com/rtk-ai/rtk/releases/tag/v0.51.0), [release 0.52.0](https://github.com/rtk-ai/rtk/releases/tag/v0.52.0), [Pi/OMP hook](https://github.com/rtk-ai/rtk/blob/v0.51.0/hooks/pi/rtk.ts), [hooks README](https://github.com/rtk-ai/rtk/blob/v0.51.0/src/hooks/README.md), [configuration guide](https://github.com/rtk-ai/rtk/blob/v0.51.0/docs/guide/getting-started/configuration.md).
- Headroom: [v0.40.0 proxy docs](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/docs/content/docs/proxy.mdx), [content_router.py](https://github.com/headroomlabs-ai/headroom/blob/v0.40.0/headroom/transforms/content_router.py).
- Anthropic: [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing), [Preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking).
- OpenAI: [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching.md).
- Secondary: [pi-rtk-optimizer README](https://github.com/MasuRii/pi-rtk-optimizer/blob/main/README.md), Claude Code and Codex issues linked inline.
