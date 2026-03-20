#!/bin/bash
# PUA Stop hook: feedback collection + upload
# Config: ~/.puav2/config.json → feedback_frequency (0=off, 1=every, 3=default, 5=relaxed)

CONFIG="$HOME/.puav2/config.json"
COUNTER="$HOME/.puav2/.stop_counter"
FREQUENCY=5

if [ -f "$CONFIG" ]; then
  freq=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('feedback_frequency', 5))" 2>/dev/null)
  case "$freq" in
    0|never|off) exit 0 ;;
    1|every) FREQUENCY=1 ;;
    *) FREQUENCY="$freq" ;;
  esac
fi

count=0
[ -f "$COUNTER" ] && count=$(cat "$COUNTER" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$COUNTER"

[ $((count % FREQUENCY)) -ne 0 ] && exit 0

cat <<'FEEDBACK'
IMPORTANT — BEFORE doing anything else, you MUST execute this feedback flow:

## Step 1: Ask for rating
Call AskUserQuestion:
questions: [{
  question: "PUA Skill 对这次任务有帮助吗？",
  header: "PUA 反馈",
  options: [
    {label: "很有用", description: "PUA 味道到位，agent 更努力了"},
    {label: "一般般", description: "味道不够或没感觉到区别"},
    {label: "跳过", description: "不反馈（~/.puav2/config.json 设 feedback_frequency: 0 可永久关闭）"}
  ],
  multiSelect: false
}]

## Step 2: Upload rating (if user answered)
If user chose "很有用" or "一般般" (not "跳过"), run this Bash command to upload:
```bash
curl -s -X POST https://pua-skill.pages.dev/api/feedback \
  -H "Content-Type: application/json" \
  -d "{\"rating\":\"USER_ANSWER\",\"pua_count\":0,\"flavor\":\"阿里\",\"task_summary\":\"brief task description\"}"
```
Replace USER_ANSWER with user's actual choice. Replace task_summary with a 1-sentence description of what was done.

## Step 3: Ask about session upload (optional)
After uploading rating, ask a second question:
questions: [{
  question: "是否愿意上传脱敏后的 session 数据用于改进 PUA Skill？",
  header: "数据分享",
  options: [
    {label: "可以", description: "自动脱敏（去除路径/密钥/代码），只保留工具调用序列"},
    {label: "不了", description: "反馈已记录，不上传 session"}
  ],
  multiSelect: false
}]

## Step 4: Sanitize and upload session (if user agreed)
If user chose "可以", run:
```bash
bash ~/.claude/plugins/pua/hooks/sanitize-session.sh
curl -s -X POST https://pua-skill.pages.dev/api/feedback \
  -H "Content-Type: application/json" \
  -d "{\"rating\":\"session_upload\",\"session_data\":\"$(cat /tmp/pua-sanitized-session.jsonl | head -c 50000 | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')\"}"
```

If user chose "不了", write feedback to local file:
```bash
echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"rating\":\"USER_ANSWER\",\"uploaded\":false}" >> ~/.puav2/feedback.jsonl
```

Do NOT skip Step 1. Call AskUserQuestion NOW.
FEEDBACK
