#!/usr/bin/env bash
# Beads journey: drive the Beads segment and /beads tasks in an already-launched verify-omp run.
#
#   features/beads.sh RUN_ID
#
# Saves every screen to $EVID/beads/NN-step.txt, prints one `PASS <step>` per step, and exits non-zero on the first
# failed step. All bd writes come from this shell, never from the plugin, and run with HOME=$SCRATCH_HOME.
set -euo pipefail
set -E

RUN_ID="${1:?usage: beads.sh RUN_ID (a run started with verify-omp launch)}"
eval "$("$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)/verify-omp" env "$RUN_ID")"

FEATURE=beads
OUT="$EVID/$FEATURE"
mkdir -p "$OUT"

n=0
STEP=start
step() { STEP=$1; }
pass() { echo "PASS $STEP"; }
shot() { n=$((n + 1)); "$OMP_PTY" screen "$PTY" --out "$(printf '%s/%02d-%s.txt' "$OUT" "$n" "$1")" >/dev/null; }
screen_has() { local s; s=$("$OMP_PTY" screen "$PTY"); grep -Eq -- "$1" <<<"$s"; }
screen_lacks() { if screen_has "$1"; then echo "unexpected on screen: $1" >&2; return 1; fi; }
trap 'echo "FAIL $STEP (line $LINENO)" >&2' ERR

bd_p() { (cd "$PROJECT" && HOME="$SCRATCH_HOME" BD_NON_INTERACTIVE=1 bd "$@"); }

step "seed the project"
command -v bd >/dev/null
[[ ! -e $PROJECT/.beads ]]
bd_p init --non-interactive --stealth --skip-agents --skip-hooks -p vrf --quiet
A=$(bd_p create "Ready task" -p 1 -d "First line of the description" --json | jq -r .id)
B=$(bd_p create "Active task" -p 0 --json | jq -r .id)
C=$(bd_p create "Blocked task" -p 2 --json | jq -r .id)
bd_p update "$B" --status in_progress >/dev/null
bd_p dep add "$C" "$A" >/dev/null
printf 'ready=%s active=%s blocked=%s\n' "$A" "$B" "$C" >"$OUT/issues.txt"
pass

step "segment shows counts after one refresh"
"$OMP_PTY" submit "$PTY" "/beads status"
"$OMP_PTY" wait "$PTY" 'Beads: ready'
"$OMP_PTY" key "$PTY" esc
"$OMP_PTY" wait "$PTY" 'Beads: 1 ready · 3 open'
shot counts
pass

step "tasks overlay groups and orders issues"
"$OMP_PTY" submit "$PTY" "/beads tasks"
"$OMP_PTY" wait "$PTY" '(?s)In progress \(1\).*P0  Active task.*Ready \(1\).*P1  Ready task - First line of the description.*Blocked \(1\).*P2  Blocked task'
shot tasks
pass

step "overlay updates in place with no key press"
ADDED=$(bd_p create "Added from outside" -p 0 --json | jq -r .id)
"$OMP_PTY" wait "$PTY" 'Added from outside'
"$OMP_PTY" wait "$PTY" 'Ready \(2\)'
shot live
pass

step "keys typed into the overlay never reach the editor"
"$OMP_PTY" key "$PTY" char:q char:z char:x
screen_has 'In progress \(1\)' # still open
screen_lacks 'qzx'
"$OMP_PTY" key "$PTY" enter
"$OMP_PTY" wait "$PTY" 'In progress \(1\)' --absent
screen_lacks '║.*qzx'
shot closed
pass

step "segment follows a change made from another terminal"
"$OMP_PTY" wait "$PTY" 'Beads: 2 ready · 4 open'
bd_p update "$A" --status deferred >/dev/null
"$OMP_PTY" wait "$PTY" 'Beads: 1 ready · 3 open'
shot deferred
pass

step "menu path opens the tasks overlay"
"$OMP_PTY" submit "$PTY" "/beads"
"$OMP_PTY" wait "$PTY" 'Show tasks'
shot menu
"$OMP_PTY" key "$PTY" down enter
"$OMP_PTY" wait "$PTY" 'Beads Tasks'
shot menu-tasks
"$OMP_PTY" key "$PTY" esc
pass

step "empty state when no issue is open"
for id in "$B" "$ADDED" "$C"; do bd_p close --force "$id" >/dev/null; done
"$OMP_PTY" submit "$PTY" "/beads tasks"
"$OMP_PTY" wait "$PTY" 'No open issues\.'
shot empty
"$OMP_PTY" key "$PTY" esc
"$OMP_PTY" wait "$PTY" 'Beads: ready'
shot empty-segment
pass
