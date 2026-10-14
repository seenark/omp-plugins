# omp-plugins

Features that extend OMP. This glossary covers content vendored from other projects, the token-savings figures shown in the Shared Display, and the Instruction Modes.

## Vendoring

**Upstream**:
The external project a piece of Vendored Content comes from, such as `JuliusBrussee/caveman` or `DietrichGebert/ponytail`.
_Avoid_: original, the repo, source

**Pinned Revision**:
The exact Upstream commit that the installed Vendored Content comes from.
_Avoid_: version, latest

**Vendored Content**:
Upstream files kept byte-for-byte at the Pinned Revision so every update is a reviewable diff.
_Avoid_: port, copy, fork

**Adaptation**:
A recorded change that points Upstream wording or tooling at an OMP equivalent.
_Avoid_: patch, hack, override

**Excluded**:
Upstream parts deliberately not brought over, such as Upstream's own CLI, proxy or skills this setup does not use.
_Avoid_: unsupported, removed, TODO

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

## Instruction Modes

**Instruction Mode**:
A set of standing instructions, such as Ponytail or Caveman, added to every request in an Agent Session until the user turns it off.
_Avoid_: persona, style plugin, sticky mode

**Mode Level**:
The setting an Instruction Mode runs at in an Agent Session, named exactly as its Upstream names it (such as `ultracave` or `lite`), where `off` means its instructions are not sent at all.
_Avoid_: intensity, strength
