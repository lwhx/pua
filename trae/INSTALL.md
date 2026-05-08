# Trae 安装 PUA Skill

Trae 已支持 `SKILL.md` 形态的 Skill；与 Claude Code 不同的是，本仓库的 Claude Code hooks、commands、agents 不会自动迁移到 Trae。因此 Trae 版提供两层兼容：

1. 标准 Skill 包：`.trae/skills/pua/SKILL.md`、`.trae/skills/pua-en/SKILL.md`；
2. 旧版可粘贴规则：`trae/pua.md`、`trae/pua-en.md`。

## 推荐安装：npx skills

项目级安装到 Trae：

```bash
npx skills add tanweai/pua --skill pua-trae -a trae -y
```

说明：`pua-trae` 是给 `npx skills` 去重准备的 Trae 优化版；如果你想在 Trae 里保留短名 `pua`，用下面的手动安装复制 `.trae/skills/pua/`。

全局安装到 Trae：

```bash
npx skills add tanweai/pua --skill pua-trae -a trae -g -y
```

Trae CN：

```bash
npx skills add tanweai/pua --skill pua-trae -a trae-cn -g -y
```

对应目录：

| 平台 | 项目目录 | 全局目录 |
|---|---|---|
| Trae | `.trae/skills/` | `~/.trae/skills/` |
| Trae CN | `.trae/skills/` | `~/.trae-cn/skills/` |

## 手动安装

如果不用 `npx skills`：

```bash
mkdir -p .trae/skills
cp -R /path/to/pua/.trae/skills/pua /path/to/pua/.trae/skills/pua-en .trae/skills/
```

全局安装：

```bash
mkdir -p ~/.trae/skills
cp -R .trae/skills/pua ~/.trae/skills/
```

Trae CN 全局安装：

```bash
mkdir -p ~/.trae-cn/skills
cp -R .trae/skills/pua ~/.trae-cn/skills/
```

## 触发方式

在 Trae 对话里输入：

```text
使用 PUA skill 处理这个任务。
```

或在失败/卡住时输入：

```text
你再试试，按 PUA 的诊断先行、四权分离和验证闭环来做。
```

## 边界

- Trae 版是 instruction-only Skill，不具备 Claude Code 的 PreToolUse / Stop / SubagentStop hook。
- 真正的工具权限、联网权限、文件写入权限仍由 Trae 本身控制。
- 改测试/CI/部署/权限/删除文件前，按 Skill 内的“环境修改权”规则先让用户确认。
- 详细差异见 `trae/DIFF.md`。
