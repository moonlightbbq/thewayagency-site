#!/usr/bin/env bash
# Push this run's commit to origin/<branch>, rebasing it onto anything that
# landed while the run was working.
#
# Why: since sage-server #943, SAGE commits to this repo's main directly
# (reviewer approvals, rejects, topic approvals, the content queue), each one
# conditioned on the blob it read. A publish run that started before such a
# commit used to fail its plain `git push` as non-fast-forward and drop the
# day's publish.
#
# Safety rule: a conflict is NEVER resolved here. Every refusal below pushes
# nothing and fails the step loudly. Silently picking a side is exactly the lost
# update #943 removed.
#  1. Only this run's own commits move: the ones on top of the commit the run
#     checked out. actions/checkout leaves origin/<branch> at that commit, and it
#     is recorded before anything is fetched. `git rebase --onto` replays exactly
#     those commits, so a shallow checkout needs no deepening, and a checkout
#     that is not of <branch> is refused instead of pushed to it.
#  2. If <branch> was rewritten (force-pushed: a PII history purge, a reset),
#     the commit the run started from is no longer in its history. Rebasing
#     would put the old history back on top, the purged files with it. Refused.
#  3. Git's three-way rebase keeps both sides only when they changed different
#     lines. A same-lines conflict is aborted and refused.
#  4. Different lines is not enough. scripts/push-cas-check.js refuses when
#     origin changed a calendar entry or a file this run also changed since the
#     run read it (a post rescheduled or reassigned while this run published
#     it merges cleanly line by line), checks the rebased commit holds exactly
#     this run's changes on top of origin's, and that the JSON still parses.
#     That is the compare-and-swap rule SAGE applies to its own writes.
#
# Usage: scripts/git-push-rebase.sh [branch]   (default: main)
#   PUSH_ATTEMPTS (default 4) bounds the pushes; PUSH_RETRY_SLEEP (default 5) is
#   the base back-off in seconds (retry n waits n * base, BEFORE it fetches, so
#   the push goes out right after the rebase).
set -euo pipefail

BRANCH="${1:-main}"
ATTEMPTS="${PUSH_ATTEMPTS:-4}"
SLEEP_BASE="${PUSH_RETRY_SLEEP:-5}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKING="refs/remotes/origin/${BRANCH}"

# Every way this script gives up says the same things: what was (not) pushed
# and what to do next.
give_up() {
  trap - ERR
  echo "::error::$1 Nothing was pushed: origin/${BRANCH} has none of this run's changes, and no side was picked. Do NOT use \"Re-run jobs\": a re-run replays this run's original commit and fails the same way. Start a new run instead (Actions > Publish Scheduled Blog Posts > Run workflow), or wait for the next scheduled run; it redoes today's publish from the current ${BRANCH}. Review emails and reminders this run sent were not recorded on ${BRANCH}, so the new run sends them again."
  exit 1
}
trap 'give_up "git-push-rebase.sh failed unexpectedly (exit $?, line ${LINENO}; see the output above)."' ERR

if ! base="$(git rev-parse --verify -q "${TRACKING}^{commit}")"; then
  give_up "There is no origin/${BRANCH} to start from: this run did not check out ${BRANCH}."
fi
if ! git merge-base --is-ancestor "$base" HEAD; then
  give_up "HEAD is not built on origin/${BRANCH} (${base}), so this run's own commits cannot be told apart from others."
fi

attempt=1
while :; do
  if git push origin "HEAD:refs/heads/${BRANCH}"; then
    if [ "$attempt" -gt 1 ]; then echo "Pushed on attempt ${attempt}/${ATTEMPTS}, after rebasing onto origin/${BRANCH} at ${base}."; fi
    exit 0
  fi
  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    give_up "git push to ${BRANCH} was rejected ${ATTEMPTS} times (see git's messages above)."
  fi
  echo "::warning::git push was rejected (attempt ${attempt}/${ATTEMPTS}); rebasing this run's commit onto the current origin/${BRANCH} and retrying."
  # Back off BEFORE fetching: the push then follows the rebase at once, rather
  # than giving main a sleep's worth of time to move again.
  sleep $(( attempt * SLEEP_BASE ))
  attempt=$(( attempt + 1 ))

  # A failed fetch (network, auth) is retried like a rejected push, within the
  # same bound; the next push of the un-rebased commit lands only if it is a
  # fast-forward.
  if ! git fetch --no-tags origin "+refs/heads/${BRANCH}:${TRACKING}"; then
    echo "::warning::git fetch of origin/${BRANCH} failed (see above); retrying."
    continue
  fi
  theirs="$(git rev-parse --verify "${TRACKING}^{commit}")"

  # Rule 2. In a shallow checkout the walk from theirs reaches base whenever
  # base is in its history; anything else (rewritten, or unprovable) refuses.
  if ! git merge-base --is-ancestor "$base" "$theirs"; then
    give_up "origin/${BRANCH} was rewritten (force-pushed) while this run worked: the commit the run started from, ${base}, is no longer in its history. Rebasing would put the old history back on top, including anything the rewrite removed (a PII purge)."
  fi

  # Rules 1 and 3. --autostash: the workflow commits only the paths it stages,
  # and a tracked file it left modified (update-reviews.js rewrites pages it
  # does not stage) would otherwise block the rebase.
  mine="$(git rev-parse --verify HEAD)"
  if ! git rebase --autostash --onto "$theirs" "$base"; then
    conflicted="$(git diff --name-only --diff-filter=U | tr '\n' ' ')"
    git rebase --abort >/dev/null 2>&1 || true
    if [ -n "${conflicted// /}" ]; then
      give_up "origin/${BRANCH} changed the same lines as this run (conflict in: ${conflicted% })."
    fi
    give_up "The rebase onto origin/${BRANCH} could not start (see git's message above; for example an untracked file this run left is in the way of one origin added)."
  fi

  # The rebase succeeded but putting the uncommitted edits back conflicted: git
  # leaves conflict markers in those files (exit 0). They are not part of the
  # push. Keep them in the stash and give the working tree the rebased commit's
  # version, so no later step reads conflict markers.
  stash_conflicts="$(git diff --name-only --diff-filter=U | tr '\n' ' ')"
  if [ -n "${stash_conflicts// /}" ]; then
    echo "::warning::This run's uncommitted edits to ${stash_conflicts% } (not part of the push) conflict with origin/${BRANCH}. They are kept in the stash ('autostash'), and the working tree now holds the rebased commit's version of those files."
    while IFS= read -r -d '' f; do
      if git cat-file -e "HEAD:${f}" 2>/dev/null; then
        git checkout -q HEAD -- "$f"
      else
        git rm -q -f --cached -- "$f" >/dev/null 2>&1 || true
        rm -f -- "$f"
      fi
    done < <(git diff --name-only -z --diff-filter=U)
  fi

  # Rule 4.
  if ! node "${HERE}/push-cas-check.js" "$base" "$mine" "$theirs" HEAD; then
    git reset -q --keep "$mine" >/dev/null 2>&1 || true
    give_up "The compare-and-swap check refused the rebased commit (reasons listed above). Typically origin/${BRANCH} changed a calendar entry or file this run also changed, after the run read it: the lines merged, but the run decided on a copy that is no longer current."
  fi
  base="$theirs"
done
