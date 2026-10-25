#!/usr/bin/env bash
# The agent loop's outer cycle. Run it by hand in the first window of a tmux server on the
# loop machine, from the clean main checkout:
#
#   bash scripts/agent-loop/dispatch.sh
#
# Every tick: one fresh `claude -p "/dispatch"` session fast-forwards main (falling back to https
# when the forwarded ssh agent is gone) and does one pass by the rules of
# .claude/skills/dispatch/SKILL.md, then exits (it remembers nothing between ticks).
# Then it waits AGENT_LOOP_INTERVAL seconds; Enter runs the next tick now, q quits.
# Task sessions (`task-<N>`) are created in this tmux server by scripts/agent-loop/start-task.mjs.
#
# Environment (all optional):
#   AGENT_LOOP_MODEL     model for every loop session (default opus — the alias of the latest Opus)
#   AGENT_LOOP_INTERVAL  seconds between ticks (default 600)
#   AGENT_LOOP_HOME      state directory (default ~/.claude/agent-loop)
#   AGENT_LOOP_MAX_TASKS, AGENT_LOOP_LOAD5_MAX, AGENT_LOOP_MEM_MIN_PCT, AGENT_LOOP_TASK_TIMEOUT_HOURS,
#   AGENT_LOOP_MUTATION_BUDGET_MIN — limits read by facts.mjs / mutation-budget.mjs
#   AGENT_LOOP_MAX_RESUMES — how many times a task is requeued (resumed) before it goes to the human
set -uo pipefail

export AGENT_LOOP_MODEL="${AGENT_LOOP_MODEL:-opus}"
export AGENT_LOOP_HOME="${AGENT_LOOP_HOME:-$HOME/.claude/agent-loop}"
AGENT_LOOP_INTERVAL="${AGENT_LOOP_INTERVAL:-600}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$AGENT_LOOP_HOME/dispatch.log"
mkdir -p "$AGENT_LOOP_HOME/tasks"

fail() { echo "dispatch: $*" >&2; exit 1; }
log() { echo "[$(date -Is)] $*" | tee -a "$LOG"; }

[[ -n "${TMUX:-}" ]] || fail "run me inside tmux: task sessions are created in this tmux server"
command -v gh >/dev/null 2>&1 || fail "gh is not in PATH"
command -v claude >/dev/null 2>&1 || fail "claude is not in PATH"
command -v node >/dev/null 2>&1 || fail "node is not in PATH"
gh auth status >/dev/null 2>&1 || fail "gh is not authenticated (gh auth login or GH_TOKEN before starting tmux)"
if command -v claude-lease >/dev/null 2>&1; then
    echo "dispatch: lease capacity: $(claude-lease capacity 2>&1 | tr '\n' ' ')"
else
    echo "dispatch: claude-lease is not in PATH — heavy runs will not be serialized"
fi
cd "$REPO" || fail "cannot cd to $REPO"
branch="$(git branch --show-current)"
[[ "$branch" == "main" ]] || fail "repo is on '$branch', the loop needs a clean main checkout"
[[ -z "$(git status --porcelain)" ]] || fail "working tree is dirty; the loop needs a clean main checkout"

echo "dispatch: repo $REPO, model $AGENT_LOOP_MODEL, interval ${AGENT_LOOP_INTERVAL}s, state $AGENT_LOOP_HOME"
echo "dispatch: Enter — tick now, q — quit"

while :; do
    log "tick"
    claude -p --model "$AGENT_LOOP_MODEL" --permission-mode bypassPermissions "/dispatch" 2>&1 | tee -a "$LOG"
    log "tick done (exit ${PIPESTATUS[0]})"
    echo "dispatch: next tick in ${AGENT_LOOP_INTERVAL}s (Enter — now, q — quit)"
    if read -r -t "$AGENT_LOOP_INTERVAL" key; then
        [[ "$key" == "q" ]] && exit 0
    fi
done
