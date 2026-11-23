#!/usr/bin/env bash
# Pull requests opened on GitHub (https://github.com/MariusEng/notepad/pulls). GitHub is a mirror of git.1011.no:
# the push mirror overwrites anything merged on GitHub, so pull requests are merged HERE and pushed to git.1011.no.
# The mirror then pushes main to GitHub, and GitHub marks the pull request as merged by itself.
#
#   scripts/github-pr.sh list          open pull requests
#   scripts/github-pr.sh show 12       fetch #12 into the local branch github-pr-12 and show its commits and changes
#   scripts/github-pr.sh merge 12      merge github-pr-12 into main (a merge commit) and push main to git.1011.no
#
# Remember the project rules when merging: bump the version and add a CHANGELOG.md entry (in a follow-up commit).
set -euo pipefail

github_repo="${GITHUB_REPO:-MariusEng/notepad}"
remote="https://github.com/$github_repo.git"
cmd="${1:-list}"
n="${2:-}"

case "$cmd" in
  list)
    gh pr list -R "$github_repo" --state open
    ;;
  show)
    [ -n "$n" ] || { echo "usage: $0 show <number>" >&2; exit 1; }
    git fetch -q "$remote" "+refs/pull/$n/head:refs/heads/github-pr-$n"
    base=$(git merge-base main "github-pr-$n")
    gh pr view "$n" -R "$github_repo" 2>/dev/null | head -20 || true
    echo
    git log --oneline "$base..github-pr-$n"
    git diff --stat "$base" "github-pr-$n"
    echo
    echo "Full diff: git diff main...github-pr-$n    Try it: git switch github-pr-$n"
    ;;
  merge)
    [ -n "$n" ] || { echo "usage: $0 merge <number>" >&2; exit 1; }
    [ -z "$(git status --porcelain)" ] || { echo "Commit or stash your changes first." >&2; exit 1; }
    git fetch -q "$remote" "+refs/pull/$n/head:refs/heads/github-pr-$n"
    title=$(gh pr view "$n" -R "$github_repo" --json title,author -q '"\(.title) (by \(.author.login))"' 2>/dev/null || echo "#$n")
    git switch -q main
    git pull -q --ff-only origin main
    git merge --no-ff "github-pr-$n" -m "Merge GitHub pull request #$n: $title"
    git push origin main
    git branch -q -D "github-pr-$n"
    echo "Merged and pushed. The mirror pushes main to GitHub, which then marks #$n as merged."
    ;;
  *)
    echo "usage: $0 list | show <n> | merge <n>" >&2
    exit 1
    ;;
esac
