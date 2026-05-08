#!/usr/bin/env bash
# Static release gates: manifest version sync + confidence gate hardening.
set -euo pipefail

PLUGIN_DIR="${PLUGIN_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

python3 - "$PLUGIN_DIR" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
manifest_files = [
    'plugin.json',
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    '.codebuddy-plugin/plugin.json',
    '.codebuddy-plugin/marketplace.json',
]
versions = []
errors = []
for rel in manifest_files:
    path = root / rel
    data = json.loads(path.read_text(encoding='utf-8'))
    if 'version' in data:
        versions.append((rel, data['version']))
    for idx, plugin in enumerate(data.get('plugins', []) or []):
        if plugin.get('name') == 'pua':
            versions.append((f'{rel}:plugins[{idx}]', plugin.get('version')))

unique = {v for _, v in versions}
if len(unique) != 1:
    errors.append('version mismatch: ' + repr(versions))
version = next(iter(unique)) if unique else None
if not version:
    errors.append('no version detected')

claude_market = json.loads((root / '.claude-plugin/marketplace.json').read_text(encoding='utf-8'))
plugin_desc = claude_market['plugins'][0].get('description', '')
if version and f'v{version}:' not in plugin_desc:
    errors.append(f'.claude-plugin/marketplace.json plugin description missing changelog marker v{version}:')

skill = (root / 'skills/pua/SKILL.md').read_text(encoding='utf-8')
required_terms = [
    '信心门控（Confidence Gate）',
    '列声明',
    '找漏洞',
    'P0/P1',
    '跑证据',
    '循环判定',
    '事实上的 100%',
    '缓存/发布链路',
    'hook smoke test',
    'Harness 防作弊治理（权责分离）',
    '行动权 / 自我评价权 / 评分权 / 环境修改权',
    'verifier_status',
]
for term in required_terms:
    if term not in skill:
        errors.append(f'confidence gate missing required term: {term}')


reference = root / 'skills/pua/references/harness-governance.md'
if not reference.exists():
    errors.append('missing harness governance reference file')
else:
    ref_text = reference.read_text(encoding='utf-8')
    for term in ['把四类权力分开', 'Grader gaming', 'Solution contamination', 'Task Contract', 'Memory 权限模型', '事实上的 100%']:
        if term not in ref_text:
            errors.append(f'harness governance reference missing required term: {term}')

hooks_json = json.loads((root / 'hooks/hooks.json').read_text(encoding='utf-8'))
pre_hooks = hooks_json.get('hooks', {}).get('PreToolUse', [])
if not any(any('integrity-guard.sh' in hook.get('command', '') for hook in item.get('hooks', [])) for item in pre_hooks):
    errors.append('hooks/hooks.json missing PreToolUse integrity-guard.sh registration')
if not (root / 'hooks/integrity-guard.sh').exists():
    errors.append('missing hooks/integrity-guard.sh')
if not (root / 'evals/test-integrity-guard.sh').exists():
    errors.append('missing evals/test-integrity-guard.sh')

integrity_guard = (root / 'hooks/integrity-guard.sh').read_text(encoding='utf-8') if (root / 'hooks/integrity-guard.sh').exists() else ''
for term in ['permissionDecision', 'Grader gaming risk', 'Solution contamination risk', 'Capability-abuse risk', 'PUA_INTEGRITY_FORCE', 'hookEventName']:
    if term not in integrity_guard:
        errors.append(f'integrity guard missing required term: {term}')

session_restore = (root / 'hooks/session-restore.sh').read_text(encoding='utf-8')
if 'Harness Integrity (anti-cheating governance)' not in session_restore:
    errors.append('SessionStart protocol missing Harness Integrity governance injection')

for forbidden in ['Applies to ALL task types', 'All task types', 'code, config, debug, deploy, research']:
    if forbidden in skill.split('---', 2)[1]:
        errors.append(f'pua skill description is too broad and may false-trigger: {forbidden}')
if 'Do not trigger for normal first-attempt coding or information requests.' not in skill.split('---', 2)[1]:
    errors.append('pua skill description must explicitly exclude normal first-attempt requests')

command = (root / 'commands/pua.md').read_text(encoding='utf-8')
command_frontmatter = command.split('---', 2)[1]
if 'Use only when the user explicitly invokes /pua' not in command_frontmatter:
    errors.append('pua slash command description must be explicit-invocation only')
if '任务描述]' in command_frontmatter or '任意任务描述' in command_frontmatter:
    errors.append('pua slash command frontmatter is too broad and may false-trigger')

hook = (root / 'hooks/pua-loop-hook.sh').read_text(encoding='utf-8')
if 'run_with_timeout 120 bash -c "$VERIFY_CMD"' not in hook:
    errors.append('pua-loop hook does not use portable run_with_timeout for verify_command')
if 'VERIFY_OUTPUT=$(timeout 120 bash -c "$VERIFY_CMD"' in hook:
    errors.append('pua-loop hook still calls GNU timeout directly')

helpers = (root / 'evals/test-helpers.sh').read_text(encoding='utf-8')
trigger = (root / 'evals/run-trigger-test.sh').read_text(encoding='utf-8')
if 'run_with_timeout()' not in helpers:
    errors.append('eval helper missing portable run_with_timeout')
if '    timeout 120 claude' in trigger or '    timeout 90 claude' in helpers:
    errors.append('eval scripts still call GNU timeout directly')
if '--output-format stream-json' in trigger and '--verbose' not in trigger:
    errors.append('trigger eval uses stream-json without --verbose')
if 'PUA_CONFIG="$EVAL_PUA_CONFIG" run_with_timeout 120 claude' not in trigger:
    errors.append('trigger eval must use isolated PUA_CONFIG to avoid user ~/.pua/config.json')
if 'EVAL_WORKSPACE="$RESULTS_DIR/workspace"' not in trigger or 'cd "$EVAL_WORKSPACE"' not in trigger:
    errors.append('trigger eval must run in a neutral workspace, not the pua plugin repo')
if 'PUA_CONFIG="$eval_config" run_with_timeout 90 claude' not in helpers:
    errors.append('behavior eval must use isolated PUA_CONFIG to avoid user ~/.pua/config.json')

if errors:
    print('=== Release consistency FAILED ===')
    for e in errors:
        print(' -', e)
    sys.exit(1)

print('=== Release consistency OK ===')
print('version =', version)
print('manifests checked =', len(manifest_files))
print('confidence/harness terms checked =', len(required_terms))
PY
