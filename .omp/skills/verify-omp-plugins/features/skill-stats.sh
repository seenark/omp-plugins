#!/usr/bin/env bash
# Skill stats journey: drive /skill-stats in an already-launched verify-omp run.
#
#   features/skill-stats.sh RUN_ID
#
# Saves every screen to $EVID/skill-stats/NN-step.txt, prints one `PASS <step>` per step, and exits non-zero on the first
# failed step. It restarts the omp session once (the project step needs omp to discover a new Project Skill).
set -euo pipefail
set -E

RUN_ID="${1:?usage: skill-stats.sh RUN_ID (a run started with verify-omp launch)}"
VERIFY_OMP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)/verify-omp"
eval "$("$VERIFY_OMP" env "$RUN_ID")"

FEATURE=skill-stats
OUT="$EVID/$FEATURE"
mkdir -p "$OUT"

n=0
STEP=start
step() { STEP=$1; }
pass() { echo "PASS $STEP"; }
shot() { n=$((n + 1)); "$OMP_PTY" screen "$PTY" --out "$(printf '%s/%02d-%s.txt' "$OUT" "$n" "$1")" >/dev/null; }
trap 'echo "FAIL $STEP (line $LINENO)" >&2' ERR

STORE="$SCRATCH_HOME/.local/share/codesook-omp/skill-stats"

# Opens a dashboard and scrolls it (least-used first, so used rows sit below the fold) until the row matches.
dashboard_row() { # SUBMITTED_COMMAND ROW_REGEX SHOT_NAME
	"$OMP_PTY" submit "$PTY" "$1"
	"$OMP_PTY" scroll-until "$PTY" "$2" --max 60
	shot "$3"
	"$OMP_PTY" key "$PTY" esc
}

step "nothing recorded yet"
[[ ! -e $STORE ]]
"$OMP_PTY" submit "$PTY" "/skill-stats"
"$OMP_PTY" wait "$PTY" 'Skill stats: Global Skills'
"$OMP_PTY" wait "$PTY" 'Counts are total \(user/agent/subagent\)'
shot baseline
"$OMP_PTY" key "$PTY" esc
pass

step "Ponytail helper records a user use"
"$OMP_PTY" submit "$PTY" "/ponytail-review"
for _ in $(seq 40); do [[ -s $STORE/uses.jsonl ]] && break; sleep 0.5; done
[[ -s $STORE/uses.jsonl ]]
[[ "$(jq -sc '[.[] | {name, source}]' "$STORE/uses.jsonl")" == '[{"name":"ponytail-review","source":"user"}]' ]]
cp "$STORE/uses.jsonl" "$OUT/uses-first.jsonl"
shot recorded-prompt
pass

step "dashboard shows the use"
dashboard_row "/skill-stats" '^ponytail-review .*1 \(1/0/0\)' recorded
pass

step "reset moves the Reset Point and keeps the record"
"$OMP_PTY" submit "$PTY" "/skill-stats reset ponytail-review"
"$OMP_PTY" wait "$PTY" 'Reset skill stats\?'
shot reset-confirm
"$OMP_PTY" key "$PTY" enter # Yes
"$OMP_PTY" wait "$PTY" 'Reset point set for ponytail-review\. No records were deleted\.'
[[ "$(jq '.resetBySkill | length' "$STORE/meta.json")" == 1 ]]
[[ "$(wc -l <"$STORE/uses.jsonl" | tr -d ' ')" == 1 ]]
cp "$STORE/meta.json" "$OUT/meta-reset.json"
pass

step "since-reset count drops to zero"
dashboard_row "/skill-stats" '^ponytail-review .*0 \(0/0/0\)' reset
pass

step "import reads a fixture session into the project store"
PROJECT_SKILL="$PROJECT/.agents/skills/proj-skill"
mkdir -p "$PROJECT_SKILL"
printf -- '---\nname: proj-skill\ndescription: verify\n---\n' >"$PROJECT_SKILL/SKILL.md"
DAY=$(date -u -v-10d +%F 2>/dev/null || date -u -d '10 days ago' +%F) # inside the 30 day window, before recording started
SESSION_DIR="$SCRATCH_HOME/.omp/agent/sessions/--tmp-omp-verify-$RUN_ID-project--"
mkdir -p "$SESSION_DIR"
{
	printf '{"type":"title"}\n'
	printf '{"type":"session","version":3,"id":"fixture-sess","timestamp":"%sT10:00:00.000Z","cwd":"%s"}\n' "$DAY" "$PROJECT"
	printf '{"type":"custom_message","customType":"skill-prompt","attribution":"user","timestamp":"%sT10:01:00.000Z","id":"e1","details":{"name":"proj-skill","path":"%s/SKILL.md","lineCount":4}}\n' "$DAY" "$PROJECT_SKILL"
	printf '{"type":"custom","customType":"tool_execution_start","timestamp":"%sT10:02:00.000Z","id":"e2","data":{"toolCallId":"t1","toolName":"read","startedAt":"%sT10:02:00.000Z","args":{"path":"skill://proj-skill"}}}\n' "$DAY" "$DAY"
} >"$SESSION_DIR/${DAY}T10-00-00-000Z_fixture-sess.jsonl"
cp "$SESSION_DIR/${DAY}T10-00-00-000Z_fixture-sess.jsonl" "$OUT/fixture-sess.jsonl"
"$VERIFY_OMP" restart "$RUN_ID" >/dev/null
"$OMP_PTY" submit "$PTY" "/skill-stats import"
"$OMP_PTY" wait "$PTY" 'Imported 2 Skill Uses from 1 session files \(0 global, 2 project\)\.'
"$OMP_PTY" wait "$PTY" 'Skipped: none\.'
shot imported
pass

step "project dashboard lists the imported uses"
dashboard_row "/skill-stats project" '^proj-skill .*2 \(1/1/0\)' project
pass

step "project store is Git-ignored"
[[ "$(cat "$PROJECT/.omp/skill-stats/.gitignore")" == '*' ]]
[[ -z "$(git -C "$PROJECT" status --short | grep -F '.omp/skill-stats' || true)" ]]
pass

step "import refuses a second run"
"$OMP_PTY" submit "$PTY" "/skill-stats import"
"$OMP_PTY" wait "$PTY" 'already imported on'
shot import-again
pass
