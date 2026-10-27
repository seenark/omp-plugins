#!/usr/bin/env bash
# Process monitor journey: drive /procs in an already-launched verify-omp run.
#
#   features/process-monitor.sh RUN_ID
#
# Saves every screen to $EVID/process-monitor/NN-step.txt, prints one `PASS <step>` per step, and exits non-zero on the first
# failed step. It starts stand-in processes (bun listeners) from this shell and kills only those, by recorded PID, and only
# while their environment still carries the marker they were started with.
set -euo pipefail
set -E

RUN_ID="${1:?usage: process-monitor.sh RUN_ID (a run started with verify-omp launch)}"
VERIFY_OMP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)/verify-omp"
eval "$("$VERIFY_OMP" env "$RUN_ID")"

FEATURE=process-monitor
TAG=verify-demo
OUT="$EVID/$FEATURE"
mkdir -p "$OUT"

n=0
STEP=start
step() { STEP=$1; }
pass() { echo "PASS $STEP"; }
shot() { n=$((n + 1)); "$OMP_PTY" screen "$PTY" --out "$(printf '%s/%02d-%s.txt' "$OUT" "$n" "$1")" >/dev/null; }
screen_has() { local s; s=$("$OMP_PTY" screen "$PTY"); grep -Eq -- "$1" <<<"$s"; }
screen_lacks() { if screen_has "$1"; then echo "unexpected on screen: $1" >&2; return 1; fi; }

STANDINS=() # "pid|ENV=value" for every stand-in this script started
has_marker() { local e; e=$(/bin/ps -wwE -o command= -p "$1" 2>/dev/null || true); grep -Eq " $2( |\$)" <<<"$e"; }
reap() { # PID: kill a recorded stand-in, but only while it still carries its marker
	local entry
	for entry in ${STANDINS[@]+"${STANDINS[@]}"}; do
		[[ ${entry%%|*} == "$1" ]] && has_marker "$1" "${entry#*|}" && kill "$1" 2>/dev/null || true
	done
}
cleanup() {
	local entry
	for entry in ${STANDINS[@]+"${STANDINS[@]}"}; do reap "${entry%%|*}"; done
}
trap 'echo "FAIL $STEP (line $LINENO)" >&2' ERR
trap cleanup EXIT

# Sets STANDIN_PID and STANDIN_PORT. Not callable inside $(...): a background job started there dies with the subshell.
start_standin() { # ENV=value marker the process carries
	# -u: a shell inside omp exports its own OMP_PLUGINS_SESSION, which would attribute the untagged stand-in to that session
	env -u OMP_PLUGINS_SESSION "$1" nohup bun -e 'Bun.serve({port:0,fetch:()=>new Response("x")});setInterval(()=>{},1e6)' >/dev/null 2>&1 &
	sleep 2
	STANDIN_PID=$(pgrep -n -f 'Bun.serve\(\{port:0')
	has_marker "$STANDIN_PID" "$1" || { echo "pid $STANDIN_PID does not carry $1" >&2; return 1; }
	STANDINS+=("$STANDIN_PID|$1")
	STANDIN_PORT=$(lsof -nP -a -p "$STANDIN_PID" -iTCP -sTCP:LISTEN -Fn | sed -n 's/^n.*://p' | sort -u | sed -n 1p)
	[[ -n $STANDIN_PORT ]] || { echo "pid $STANDIN_PID listens on no port" >&2; return 1; }
}
gone() { local i; for i in $(seq 20); do kill -0 "$1" 2>/dev/null || return 0; sleep 0.5; done; return 1; }
alive() { kill -0 "$1" 2>/dev/null; }

step "stand-ins listening"
start_standin "OMP_PLUGINS_SESSION=$TAG"; D=$STANDIN_PID; DPORT=$STANDIN_PORT
start_standin "VERIFY_OMP_STANDIN=$RUN_ID"; U=$STANDIN_PID # no session tag: the monitor cannot attribute it
printf 'attributed pid=%s port=%s session=%s\nunknown pid=%s\n' "$D" "$DPORT" "$TAG" "$U" >"$OUT/standins.txt"
pass

step "overlay opens"
"$OMP_PTY" submit "$PTY" "/procs"
"$OMP_PTY" wait "$PTY" 'OMP processes'
"$OMP_PTY" wait "$PTY" 'Enter/Esc close'
shot overlay
pass

step "stand-in listed as leftover"
"$OMP_PTY" wait "$PTY" "$D .*⚠ leftover\$"
screen_has "$D +:$DPORT " # the row names the listening port
shot leftover
pass

step "unknown-origin row is view-only"
"$OMP_PTY" scroll-until "$PTY" "^› +$U " --max 80
"$OMP_PTY" key "$PTY" bspace
"$OMP_PTY" wait "$PTY" 'Not started by OMP as far as can be proven: view-only\.'
screen_lacks "Stop pid"
shot view-only
alive "$U"
pass

step "overlay closes"
"$OMP_PTY" key "$PTY" esc
"$OMP_PTY" wait "$PTY" 'OMP processes' --absent
pass

step "status segment counts leftover ports"
"$OMP_PTY" wait "$PTY" '⚠ \d+ ports' --timeout 45
shot segment
pass

step "stop is confirmed and kills the stand-in"
"$OMP_PTY" submit "$PTY" "/procs"
"$OMP_PTY" wait "$PTY" "$D .*⚠ leftover\$"
"$OMP_PTY" scroll-until "$PTY" "^› +$D " --max 80
"$OMP_PTY" key "$PTY" bspace
"$OMP_PTY" wait "$PTY" "Stop pid $D\\?"
screen_has "Ports: $DPORT"
shot confirm
"$OMP_PTY" key "$PTY" enter # Yes is the default row
"$OMP_PTY" wait "$PTY" "Stop pid $D\\?" --absent
gone "$D"
"$OMP_PTY" wait "$PTY" "$D .*⚠ leftover\$" --absent # the refreshed list dropped the row
shot stopped
pass

step "declined stop leaves the process"
start_standin "OMP_PLUGINS_SESSION=$TAG"; D2=$STANDIN_PID
"$OMP_PTY" submit "$PTY" "/procs"
"$OMP_PTY" wait "$PTY" "$D2 .*⚠ leftover\$"
"$OMP_PTY" scroll-until "$PTY" "^› +$D2 " --max 80
"$OMP_PTY" key "$PTY" bspace
"$OMP_PTY" wait "$PTY" "Stop pid $D2\\?"
"$OMP_PTY" key "$PTY" down enter # No
"$OMP_PTY" wait "$PTY" "Stop pid $D2\\?" --absent
"$OMP_PTY" wait "$PTY" "$D2 .*⚠ leftover\$"
alive "$D2"
shot declined
"$OMP_PTY" key "$PTY" esc
pass

step "next start reports a process from an earlier session"
mkdir -p "$SCRATCH_HOME/.local/share/codesook-omp/process-monitor/ended"
: >"$SCRATCH_HOME/.local/share/codesook-omp/process-monitor/ended/$TAG"
"$VERIFY_OMP" restart "$RUN_ID" >/dev/null
"$OMP_PTY" wait "$PTY" 'Warning: 1 process started by an earlier OMP session is still running:' --timeout 15
shot next-start
reap "$D2"
gone "$D2"
pass

step "/new offers to close the previous session's processes"
"$OMP_PTY" submit "$PTY" "/session"
"$OMP_PTY" wait "$PTY" 'Session Info'
shot session
SESSION_ID=$("$OMP_PTY" screen "$PTY" | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | sed -n 1p)
[[ -n $SESSION_ID ]]
start_standin "OMP_PLUGINS_SESSION=$SESSION_ID"; D3=$STANDIN_PID
"$OMP_PTY" submit "$PTY" "/new"
"$OMP_PTY" wait "$PTY" 'The previous session left 1 process running:'
"$OMP_PTY" wait "$PTY" 'Close all'
shot close-all-prompt
"$OMP_PTY" key "$PTY" enter # Close all
"$OMP_PTY" wait "$PTY" 'The previous session left' --absent
gone "$D3"
shot closed
pass
