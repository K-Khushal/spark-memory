#!/bin/bash
# Blocks destructive git commands for agents (git-guardrails-claude-code skill,
# customised: feature-branch pushes are allowed so agents can open PRs; pushes
# to main/master and force pushes are not).

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

block() {
  echo "BLOCKED: '$COMMAND' $1. The user has prevented you from doing this." >&2
  exit 2
}

DANGEROUS_PATTERNS=(
  "git reset --hard"
  "reset --hard"
  "git clean -fd"
  "git clean -f"
  "git branch -D"
  "git checkout \."
  "git restore \."
  "push --force"
  "push -f( |$)"
  "push --force-with-lease"
  "git push( [^|;&]*)? (main|master)( |$)"
  "git push( [^|;&]*)? [^ ]*:(main|master)( |$)"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qE "$pattern"; then
    block "matches dangerous pattern '$pattern'"
  fi
done

# A bare `git push` (no branch named) from main would push main.
if echo "$COMMAND" | grep -qE "git push( +(-u|--set-upstream))?( +origin)? *($|[;&|])"; then
  BRANCH=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
    block "would push from $BRANCH; push a feature branch and open a PR instead"
  fi
fi

exit 0
