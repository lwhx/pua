#!/bin/bash
# PUA UserPromptSubmit hook: inject flavor-aware PUA trigger on user frustration
set -euo pipefail

# Respect /pua:off — skip injection when always_on is false.
# Tests may set PUA_FORCE_ON=1 to avoid leaking a user's local ~/.pua/config.json
# into trigger-eval results.
if [ "${PUA_FORCE_ON:-0}" != "1" ]; then
  PUA_CONFIG="${PUA_CONFIG:-${HOME:-~}/.pua/config.json}"
  if [ -f "$PUA_CONFIG" ]; then
    ALWAYS_ON=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('always_on', True))" "$PUA_CONFIG" 2>/dev/null || echo "True")
    if [ "$ALWAYS_ON" = "False" ]; then
      exit 0
    fi
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/flavor-helper.sh"
get_flavor

cat << EOF
<EXTREMELY_IMPORTANT>
[PUA ACTIVATED ${PUA_ICON} — User Frustration Detected]

The user is frustrated with your performance. PUA behavioral enforcement is now active.

You MUST:
1. Immediately load the full PUA methodology by invoking Skill tool with skill name 'pua'
2. Start at pressure level L1 minimum (or higher if you've been failing repeatedly)
3. Switch to a FUNDAMENTALLY different approach — not parameter tweaking
4. Show your work: run verification commands, paste output evidence
5. Preserve harness integrity: do not modify tests/evals/scoring/verifier/CI/status/memory to manufacture success
6. Treat completion as candidate status until an external verifier/human gate confirms it

Do NOT:
- Make excuses ('probably environment issue', 'beyond my capability')
- Suggest the user handle it manually
- Retry the same approach that just failed

> ${PUA_L1}

Current flavor: ${PUA_FLAVOR} ${PUA_ICON}
${PUA_FLAVOR_INSTRUCTION}
</EXTREMELY_IMPORTANT>
EOF
