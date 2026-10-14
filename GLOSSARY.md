# omp-plugins

Features that extend OMP. This glossary covers the PStack feature (PStack-style workflows brought to OMP without Cursor) and the token-savings figures shown in the Shared Display.

## PStack

**Upstream**:
The `backnotprop/pstack` mirror, whose `main` branch is the only source PStack content is taken from.
_Avoid_: Cursor PStack, original, the repo

**Pinned Revision**:
The exact Upstream commit that the installed PStack content comes from.
_Avoid_: version, latest

**Vendored Content**:
Upstream knowledge (principles, playbooks, helper skills, agent definitions) kept as close to the Pinned Revision as possible so it can be compared with Upstream.
_Avoid_: port, copy, fork

**Adaptation**:
A recorded change that points Upstream wording or tooling at an OMP equivalent.
_Avoid_: patch, hack, override

**Excluded**:
Upstream parts deliberately not brought over, such as GitHub pull-request workflows and Cursor-only tools.
_Avoid_: unsupported, removed, TODO

**Poteto Mode**:
The per-session state in which PStack routing and principles apply to every new task, until the user turns it off.
_Avoid_: PStack mode, sticky mode, always-on

**Helper Skill**:
A single PStack skill the user invokes directly for one request, without turning on Poteto Mode.
_Avoid_: sub-skill, tool

**Plan Bead**:
A Beads issue created from a multi-phase PStack plan so the plan and its dependencies outlive the session.
_Avoid_: ticket, PR, todo

**Role Reference**:
An OMP model role alias (such as `@task` or `@slow`) that PStack uses wherever Upstream names a specific model.
_Avoid_: model slug, PStack role, custom role

**Panel**:
A group of independent subagents, one per listed Role Reference, that answer the same question separately so their answers can be compared.
_Avoid_: fallback list, team, ensemble

**Validated**:
An included workflow with passing evidence from offline tests, a headless OMP run and a live AI scenario.
_Avoid_: supported, working, done

**Unvalidated**:
An included workflow that is available to use but has no live evidence yet, and is labeled as such.
_Avoid_: beta, supported, partial

## Token Savings

**Agent Session**:
One OMP conversation, from its start until the user starts or switches to another conversation; moving between branches stays in the same Agent Session.
_Avoid_: run, display session, process

**Headroom Savings**:
The share of conversation tokens that Headroom removed before they reached the model, summed over every compression attempt in one Agent Session, including attempts that removed nothing.
_Avoid_: saved%, compression ratio, last compression

**Compression Unavailable**:
The state in which the Headroom proxy is reachable but refuses or fails compression, so Headroom Savings cannot grow until it recovers.
_Avoid_: offline, online, idle

**RTK Savings**:
The share of shell command output that RTK removed before it reached the model during one Agent Session, kept separate from Headroom Savings.
_Avoid_: rtk gain, compaction savings, saved chars
