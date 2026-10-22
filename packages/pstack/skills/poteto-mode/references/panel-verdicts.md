# Running a panel and merging its verdicts

Interrogate, the **how** critique step and every other review that asks several models the same question follow this file. It builds on `provider-dispatch.md`, which has the seats, the dropout policy and the spawn rules.

## 1. Read the roster

A hidden roster note names the panel: `pstack panel seats configured: A (pstack-panel-a: <provider>/<model>, vendor <vendor>), ...`. It lists only seats that have a model, in seat order, already capped by the `maxPanelSize` setting (default 5, which adds no cap). The panel is exactly those seats.

- Spawn nothing for a seat the roster leaves out. An absent seat is skipped without a report of failure, and pstack refuses its spawn anyway.
- An empty roster means no panel. Stop and tell the user to run `/pstack setup`. A workflow that can run without a panel (**how**) carries on without it.
- No roster note in the session means pstack's extension did not load. Say so and stop: without it no seat's model can be named.
- The roster is the only source for a seat's model and vendor. Never name a model from memory or from what a critic says about itself.

## 2. Dispatch the critics

Spawn one `pstack-panel-<seat>-critic` per roster seat in a single `task` call. Give every critic the same brief and the same grounding paths. Critics are read-only. Each yields a structured verdict:

- `verdict`: `approve`, `concerns` or `reject`
- `summary`
- `findings`: each with `severity` (`blocker`, `major`, `minor`, `nit`), `file`, `line`, `claim` and `evidence`

Collect the results with `wait`. Build one record per roster seat: `{ seat, model, vendor, verdict }`, with the critic's result in `verdict`. A seat that failed, was refused or returned nothing gets `verdict: null`. A seat that fell back to another model (pstack records it as a dropout) keeps its verdict and gets `fellBackTo` set to the model it ran on. Never rerun a seat on another model to fill a gap.

## 3. Merge with `judge_batch`, then synthesize

The helper `verdict.ts` sits in the package's `src/` directory, two levels above a skill's directory (`<skill dir>/../../src/verdict.ts`). Findings from different seats that sit in the same file are candidate duplicates, and the host's `judge_batch` decides which are. Run this in an `eval` cell (JavaScript, where the helper is `judgeBatch`):

```js
const { duplicateCandidates, SAME_ISSUE, mergeVerdicts, reviewerLines } = await import("<skill dir>/../../src/verdict.ts");
const runs = [/* { seat, model, vendor, verdict, fellBackTo? } per roster seat */];
const candidates = duplicateCandidates(runs);
const same = [];
if (Object.keys(candidates).length > 0) {
	const batch = await judgeBatch(candidates, SAME_ISSUE, { intent: "Deduplicating panel findings" });
	for await (const [key, item] of batch.drainIter({ timeout: 60 })) if (item.ok && item.answers.same.bool > 0.5) same.push(key);
	await batch.close();
}
const merged = mergeVerdicts(runs, same);
return { merged, reviewers: reviewerLines(merged) };
```

A pair the judge failed on stays two findings: a duplicate left in costs a line, a real finding merged away costs a defect. If the module cannot be imported, merge by hand with the same rules: findings that share one root cause become one finding, it keeps the highest severity and lists every seat that raised it, and the panel verdict is the worst verdict any seat returned.

`merged` holds the panel verdict, one entry per seat with its model, the deduplicated findings with `raisedBy`, and `notes`. Then spawn one `pstack-judge` agent for the synthesis. Hand it `merged` as JSON, the intent, the grounding paths and the framework the workflow names. It is read-only: it weighs and buckets the findings, and it reads the code to check a finding. It does not add findings of its own that no seat raised.

## 4. State the verdict

One verdict for the whole panel, never one per seat. It names every seat's model (`reviewers` has the lines) and carries every entry of `notes` word for word:

- `diversity reduced: single vendor` when every seat that returned a verdict is one vendor. A one-seat panel is single-vendor. The note stands beside the verdict, so that the reader weighs agreement as one lineage's opinion. A panel of two or more vendors gets no vendor note at all: do not write that it is not single-vendor, and do not mention the phrase.
- A seat that returned no verdict is a gap, not an approval.
- A seat that fell back names the model it ran on.
- Seats that ran the same model count as one opinion.

A finding that two or more seats raised independently is the strongest signal. A finding one seat raised is still read and weighed, with that in view.
