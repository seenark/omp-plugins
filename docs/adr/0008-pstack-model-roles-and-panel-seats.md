---
status: accepted
---
# pstack Model Roles and Panel Seats

Every pstack Lane resolves its model through a `pstack-*` Model Role in OMP's own `modelRoles`. pstack stores no model selector anywhere else, so a role edited by hand, by `/pstack setup` or by a preset is the only place a model is named. The role table lives in `packages/pstack/src/roles.ts`; the Lane agent files are generated from it and `/pstack setup` menus and `/pstack doctor` read it. A test fails when the generated agent files drift from the table, and another when the README stops carrying each role's text; the README itself is written by hand.

Work roles (`pstack-explore`, `-build`, `-mechanical`, `-design`, `-judge`, `-security`) fall back to a built-in OMP role (`@smol`, `@task`, `@tiny`, `@designer`, `@slow`) because the agent lists both roles and OMP skips an unset one. Panel Seats (`pstack-panel-a` to `-e`) have no fallback: OMP does not skip an unset single role, so the child would fail on its first prompt. pstack therefore treats an unset seat as absent and blocks the spawn of its agents with a reason that says to skip the seat. A panel has one to five seats, capped further by the `maxPanelSize` setting, which the spawn guard enforces as well as the roster: a configured seat beyond the cap is blocked the same way.

A panel is only worth its cost when its seats disagree for independent reasons, so pstack enforces it:

- Two seats on the same model are refused by setup and reported as an error by doctor. The same model through another provider or thinking suffix counts as the same.
- When every seat shares a vendor the verdict states `diversity reduced: single vendor`. This is a warning, not a block: the Claude-only configuration is a supported budget choice.
- A Panel Seat's Agent Session that fell back to another model is recorded as a Dropout and named in the verdict.

`/pstack setup` and `/pstack preset` change two things through OMP's in-process settings API: the `pstack-*` roles (plus an empty fallback chain per configured seat), and `task.isolation.enabled`, only after the user confirms it, because panel builders and arena or swarm writers need it. They probe every selected model with a real turn first, read the config back and restore the previous one on mismatch. `default`, `commit`, `vision`, `tiny`, `advisor` and every other role and setting stay as the owner set them. Rerunning with the same choices changes nothing. Presets (`claude-only`, `claude-codex`, `lean`) choose tiers from model-id keywords, because OMP exposes no capability tier. A preset fills only the seats it needs (`claude-only` seats A to C, `lean` A and B, `claude-codex` adds one Codex seat), and `claude-codex` on roles the user already has is a delta: one Codex seat and the judge, nothing else.

This does not conflict with ADR-0004. That ADR makes `/omp-plugins` the owner of the Codesook Root Plugin Configuration, `~/.config/codesook-omp/config.json`. `modelRoles`, `retry.fallbackChains` and `task.isolation.enabled` belong to OMP's own configuration, which no Codesook plugin owns, and OMP's settings API validates and serializes them. The Root Plugin Configuration carries only pstack's behavior (suspend toggles, `maxPanelSize`, guard strictness), and the settings page never edits a model role.

## Considered Options

- **Name Lanes after OMP's built-in agent roles and store concrete selectors in a pstack file** (what the replaced community port did) — rejected. The selectors went stale and a "multi-model" panel could silently be one model.
- **Unset seat falls back to a default model** — rejected. A fallback makes every seat the same model, which is the failure the panel exists to prevent.
- **Block a single-vendor panel** — rejected. Claude-only is the owner's current budget; the verdict says what the panel could not provide instead.
- **Write roles by editing `config.yml` text** — rejected. The settings API validates and serializes; readback and restore guard the write.
- **Derive tiers from a capability field** — rejected; OMP has none. Keyword inference is a recorded shortcut in `setup/presets.ts`.
