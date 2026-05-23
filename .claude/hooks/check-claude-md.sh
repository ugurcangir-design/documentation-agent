#!/usr/bin/env bash
# PostToolUse hook — fires after every Bash command. When the command
# contained `git commit`, emit a system reminder asking Claude to update
# CLAUDE.md if the commit changed anything Claude.md documents.
#
# Wired up in .claude/settings.json under hooks.PostToolUse.

set -e

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")

# Only the commit case is interesting — silent otherwise so we don't
# emit noise after every Bash call.
if echo "$CMD" | grep -q "git commit"; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: "📝 CLAUDE.md güncelliğini kontrol et. Bu commit; dosya yapısı, sabitler / limitler, route'\''lar, kalıcılık şeması veya çekirdek davranışlardan birini değiştirdiyse CLAUDE.md'\''ye yansıtılmalı. Yansıtılması gereken bir şey varsa CLAUDE.md'\''yi güncelleyip ayrı (follow-up) bir commit at; ilgisiz bir commit ise (yalnızca CLAUDE.md / docs / .claude/ dosyaları değiştiyse) atla."
    }
  }'
fi
