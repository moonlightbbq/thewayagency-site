#!/usr/bin/env bash
# Push this run's commit to origin/<branch>, rebasing onto anything that landed
# while the run was working.
#
# Why: since sage-server #943, SAGE commits to this repo's main directly
# (reviewer approvals, rejects, topic approvals, the content queue), each one
# conditioned on the blob it read. A publish run that started before such a
# commit used to fail its plain `git push` as non-fast-forward and drop the
# day's publish.
#
# Safety rule: a conflict is NEVER resolved here. Git's three-way rebase keeps
# both sides only when they touched different lines. When the remote changed
# the same lines as this run (for example SAGE edited the calendar entry this
# run published), the rebase is aborted, nothing is pushed and the step fails
# loudly. Silently picking a side is exactly the lost update #943 removed.
#
# Usage: scripts/git-push-rebase.sh [branch]   (default: main)
#   PUSH_ATTEMPTS (default 4) bounds the retries; PUSH_RETRY_SLEEP (default 5)
#   is the base back-off in seconds (attempt n waits n * base).
set -euo pipefail

BRANCH="${1:-main}"
ATTEMPTS="${PUSH_ATTEMPTS:-4}"
SLEEP_BASE="${PUSH_RETRY_SLEEP:-5}"

for attempt in $(seq 1 "$ATTEMPTS"); do
  if git push origin "HEAD:refs/heads/${BRANCH}"; then
    [ "$attempt" -gt 1 ] && echo "Pushed on attempt ${attempt} after rebasing onto origin/${BRANCH}."
    exit 0
  fi
  if [ "$attempt" -eq "$ATTEMPTS" ]; then
    break
  fi
  echo "::warning::git push was rejected (attempt ${attempt}/${ATTEMPTS}); rebasing onto origin/${BRANCH} and retrying."
  # actions/checkout is shallow by default; deepen enough to find the merge base.
  if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
    git fetch --deepen=200 origin "$BRANCH"
  else
    git fetch origin "$BRANCH"
  fi
  # --autostash: the workflow commits only the paths it stages, and a tracked
  # file it left modified (a generated file) would otherwise block the rebase.
  if ! git rebase --autostash "origin/${BRANCH}"; then
    conflicted="$(git diff --name-only --diff-filter=U | tr '\n' ' ')"
    git rebase --abort || true
    echo "::error::origin/${BRANCH} changed the same lines as this run (conflict in: ${conflicted:-unknown}). Nothing was pushed and no side was picked. A re-run (or the next scheduled run) redoes today's publish from the current main; review emails this run already sent were not recorded, so they may be sent again."
    exit 1
  fi
  sleep $(( attempt * SLEEP_BASE ))
done

echo "::error::git push to ${BRANCH} was still rejected after ${ATTEMPTS} attempts. Nothing more was pushed."
exit 1
