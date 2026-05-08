# Trae 安装 PUA Skill

Trae 目前没有和 Claude Code 完全一致的 plugin marketplace / hooks 机制。本目录提供可直接粘贴到 Trae 自定义规则/Prompt/Skill 的官方文本版本，解决 issue #93 的“一个个手贴太麻烦”问题。

## 推荐安装

1. 打开 Trae 的自定义 Rules / Prompt / Skill 设置。
2. 新建规则，名称建议：`pua`。
3. 将 `trae/pua.md` 的完整内容粘贴进去。
4. 如果需要英文版，用 `trae/pua-en.md`。
5. 对需要 PUA 的项目启用该规则。

## 触发方式

在 Trae 对话里输入：

```text
使用 PUA 模式处理这个任务。
```

或在失败/卡住时输入：

```text
你再试试，按 PUA 的诊断先行和验证闭环来做。
```

## 边界

- Trae 版是 prompt/rule 适配，不具备 Claude Code 的 hook、Stop feedback、UserPromptSubmit 自动触发能力。
- 真正的工具权限、联网权限、文件写入权限仍由 Trae 本身控制。
- 如果 Trae 后续提供正式 extension API，本目录再升级为可安装包。
