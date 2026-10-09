#!/usr/bin/env bash
#
# gh-safe-merge.sh — merge a site PR only when every expected check passed on
# the exact head a review approved. Use it instead of `gh pr merge`.
#
# WHY: the repo has no branch protection, and main deploys to production via
# Cloudflare Pages. On 2026-10-07 a PR merged when `gh pr checks` showed
# nothing pending — only Cloudflare Pages had registered; the other six had
# not started. An absent check is not a pass. Ported from sage-server's gate
# (eval-layer plan P1-3), without its version bump.
#
# WHAT IT REFUSES (exit 1, every message starts "  ✗ Not merging —"):
#   - customer data in the PR title/body or commits (sage-server's pii-guard,
#     required to have its index: a missing scanner or index refuses)
#   - no `SAGE-REVIEW: verdict=APPROVE head=<sha>` comment for the exact PR
#     head (post it with sage-server's scripts/review-marker.sh after a final
#     review), or a later CHANGES verdict
#   - any expected check missing, failed or cancelled; still pending at the
#     timeout
# Then: `gh pr merge --squash --match-head-commit <that head>`.
#
# USAGE: scripts/gh-safe-merge.sh <PR#> [--timeout-min N]
set -uo pipefail

PR=${1:?usage: scripts/gh-safe-merge.sh <PR#> [--timeout-min N]}
TIMEOUT_MIN=40
[ "${2:-}" = "--timeout-min" ] && TIMEOUT_MIN=${3:?}
PII_GUARD=${PII_GUARD:-/home/cluke/sage-main/scripts/pii-guard.js}
EXPECTED=(analytics-validation blog-validation content-guard data-integrity safe-build test "Cloudflare Pages")

no() { echo "  ✗ Not merging — $*" >&2; exit 1; }

state=$(gh pr view "$PR" --json state -q .state) || no "cannot read PR #$PR"
[ "$state" = MERGED ] && { echo "  PR #$PR is already merged."; exit 0; }
[ "$state" = OPEN ] || no "PR #$PR is $state"
head=$(gh pr view "$PR" --json headRefOid -q .headRefOid) || no "cannot read the PR head"

# 1. Customer data — fails closed.
[ -f "$PII_GUARD" ] || no "pii-guard not found at $PII_GUARD, so the customer-data check cannot run"
git fetch -q origin main "$head" 2>/dev/null || git fetch -q origin main || true
git cat-file -e "${head}^{commit}" 2>/dev/null || no "PR head $head could not be fetched, so its commits cannot be scanned"
gh pr view "$PR" --json title,body -q '.title + "\n" + .body' | PII_GUARD_REQUIRE_INDEX=1 node "$PII_GUARD" scan-text \
  || no "customer data (or no pii-guard index) in the PR title/body"
PII_GUARD_REQUIRE_INDEX=1 node "$PII_GUARD" scan-range "$head" --not origin/main \
  || no "customer data (or no pii-guard index) in the PR's commits"

# 2. A review approved this exact head (the latest marker from a collaborator wins).
review_ok() {
  local h=$1 bodies line
  # Read the comments first, so a failed read and "no marker" give different, non-empty reasons.
  bodies=$(gh api "repos/{owner}/{repo}/issues/$PR/comments" --paginate \
    -q '.[] | select(.author_association=="OWNER" or .author_association=="MEMBER" or .author_association=="COLLABORATOR") | .body' 2>/dev/null) \
    || { echo "could not read the PR comments"; return 1; }
  line=$(printf '%s\n' "$bodies" | tr -d '\r' | grep -E '^[[:space:]]*SAGE-REVIEW: verdict=(APPROVE|CHANGES) head=[0-9a-f]{40}[[:space:]]*$' | tail -1 || true)
  [ -n "$line" ] || { echo "no SAGE-REVIEW marker on PR #$PR"; return 1; }
  case "$line" in
    *"verdict=APPROVE head=$h"*) return 0 ;;
    *verdict=CHANGES*) echo "the latest review asked for changes: fix them and get a fresh full review"; return 1 ;;
    *) echo "the latest approval is for ${line##*head=}, not the head $h"; return 1 ;;
  esac
}
msg=$(review_ok "$head") || no "$msg. After a full final review of that exact head: review-marker.sh <PR> <sha-you-reviewed> <APPROVE|CHANGES>. Never post one to unblock a merge."
echo "  ✓ Review approved this exact head ${head:0:12}."

# 3. Every expected check present and passing on that head.
deadline=$(( $(date +%s) + TIMEOUT_MIN * 60 ))
while :; do
  checks=$(gh pr checks "$PR" 2>/dev/null | awk -F'\t' '{print $1 "\t" $2}')
  missing=(); bad=(); pending=0
  for name in "${EXPECTED[@]}"; do
    st=$(printf '%s\n' "$checks" | awk -F'\t' -v n="$name" '$1==n {print $2}' | tail -1)
    case "$st" in
      # Only pass. None of the 7 is path-filtered or conditional on a PR, so a
      # 'skipping' check means a job that never ran: not a pass.
      pass) ;;
      pending|queued|in_progress|'') [ -z "$st" ] && missing+=("$name"); pending=1 ;;
      *) bad+=("$name=$st") ;;   # fail, cancel, skipping
    esac
  done
  [ ${#bad[@]} -gt 0 ] && no "checks did not pass: ${bad[*]} (a cancelled check is not a pass: re-run it, then gate again)"
  [ "$pending" = 0 ] && break
  [ "$(date +%s)" -ge "$deadline" ] && no "after ${TIMEOUT_MIN} min still waiting on: ${missing[*]:-}${missing[*]:+ (never appeared) }pending checks"
  sleep 30
done
echo "  ✓ All ${#EXPECTED[@]} checks passed: ${EXPECTED[*]}"

# 4. Re-check the head did not move, then merge exactly it.
now=$(gh pr view "$PR" --json headRefOid -q .headRefOid)
[ "$now" = "$head" ] || no "the PR head moved during the wait ($head → $now): review and gate the new head"
msg=$(review_ok "$head") || no "$msg"
# No --delete-branch: it also checks main out locally, which fails when another
# worktree holds main, AFTER the remote merge succeeded (a false refusal on #101).
# The PR state is the source of truth; the branch is deleted through the API.
gh pr merge "$PR" --squash --match-head-commit "$head" || true
[ "$(gh pr view "$PR" --json state -q .state)" = MERGED ] || no "gh pr merge did not merge PR #$PR"
branch=$(gh pr view "$PR" --json headRefName -q .headRefName)
gh api -X DELETE "repos/{owner}/{repo}/git/refs/heads/$branch" >/dev/null 2>&1 || echo "  ! could not delete branch $branch (delete it by hand)"
echo "✔ Merged PR #$PR at ${head:0:12}."
