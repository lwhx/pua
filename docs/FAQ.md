# PUA FAQ / Issue Playbook

## 需不需要总是开启 PUA？

不建议无脑 always-on。推荐按风险分层：

| 场景 | 建议 |
|---|---|
| 普通首轮问答/简单代码 | 不必 always-on，避免噪音 |
| Debug、失败 2 次以上、用户明显不满 | 开启 PUA 或手动触发 |
| 高风险交付、测试/评分/CI/memory 相关 | 开启 PUA + harness governance，按四权分离执行 |
| 项目初期探索 | 使用温和味道或仅用诊断先行/验证闭环 |

核心不是“压力越大越好”，而是把**行动、诊断、评分、环境修改**分开，并用证据交付。压力只负责防摆烂，不能替代 verifier。

## Claude 说这是 prompt injection，怎么办？

从 v3.3.0 起，UserPromptSubmit hook 已做两件事：

1. hook 脚本内部过滤关键词；普通首轮请求不再注入。
2. 注入文案改为“用户安装的 productivity context”，不再使用强制式 `MUST invoke Skill` 文案。

如果仍遇到拒绝：

- 先确认 Claude Code 版本足够新；
- 使用 `/pua:off` 关闭自动注入，只在需要时手动 `/pua`；
- 对调试任务使用诊断先行格式：`[PUA-DIAGNOSIS] 问题是... 证据是... 下一步...`；
- 如果模型仍拒绝，提供完整 session JSONL，便于复现。

## 封闭网络 / 内网环境怎么用？

使用 `/pua:offline` 或手动设置：

```json
{
  "offline": true,
  "feedback_frequency": 0
}
```

离线模式会关闭 PUA 自身的反馈问卷、排行榜上报和 session 上传提示；PUA 的本地验证、压力升级、诊断先行仍可使用。

## Codex CLI 子命令怎么对应 Claude Code？

Codex 没有 Claude Code 的 `/pua:xxx` slash command 命名空间时，可以用 `$pua-xxx` alias：

| Claude Code | Codex CLI |
|---|---|
| `/pua:on` | `$pua-on` |
| `/pua:off` | `$pua-off` |
| `/pua:p7` | `$pua-p7` |
| `/pua:p9` | `$pua-p9` |
| `/pua:p10` | `$pua-p10` |
| `/pua:pro` | `$pua-pro` |
| `/pua:pua-loop` | `$pua-loop` |

## Pi / Trae 支持状态

- `pi/pua/`：官方轻量 pi extension，提供 `/pua-on`、`/pua-off`、`/pua-status`、`/pua-reset` 和会话注入。
- `trae/`：Prompt/Rule 适配包，可直接复制到 Trae 自定义规则；不具备 Claude Code hooks。

## “下场”这个词为什么改了？

“下场”同时可能表示“亲自动手介入”和“停止工作/退场”，容易让 agent lifecycle 语义混乱。现在统一为：

- start/intervene → “亲自动手” / “亲自介入”；
- stop/release → “释放” / “退场”。
