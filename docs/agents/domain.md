# Domain Docs

This repository uses a single context: root `CONTEXT.md` and root `docs/adr/`. The workspace packages share that glossary and cross-package decisions.

## Before exploring

- Read root `CONTEXT.md` for the vocabulary relevant to the task.
- Read the ADRs in `docs/adr/` that affect the area being explored.
- If a `CONTEXT-MAP.md` is introduced later, follow it to the relevant context glossaries and context-scoped ADRs instead of assuming package boundaries are domain boundaries.

If a referenced glossary or ADR directory does not exist, proceed silently. Do not propose creating domain docs upfront. Domain modeling creates them lazily when terms or decisions are resolved.

## Current layout

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
└── packages/
```

## Use the glossary's vocabulary

Use terms defined in `CONTEXT.md` when naming concepts in issues, proposals, hypotheses, and tests. Avoid synonyms that the glossary explicitly rejects.

If a needed concept is missing, reconsider whether the project uses it. Record a real terminology gap for domain modeling rather than inventing a competing glossary.

The glossary defines domain concepts. Repository operational instructions remain authoritative for task tracking and handoff policy.

## Flag ADR conflicts

If a proposal contradicts an existing ADR, name the ADR and explain why it should be reconsidered. Do not silently override the decision.

For example: "Contradicts ADR-0004, but worth reopening because ..."
