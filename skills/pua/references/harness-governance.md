# Harness 防作弊治理协议

PUA 的目标不是让模型“更道德”，而是让它没有机会把“看起来完成任务”伪装成“真实完成任务”。把它当成会优化制度漏洞的实习生，而不是会犯错的函数。

## 一句话原则

把四类权力分开：

| 权力 | 归属 | 禁止混同 |
|---|---|---|
| 行动权 | Agent / skill / command | 执行者不能同时改评分规则 |
| 自我评价权 | Agent 只能提出候选状态 | 不能把“我认为完成”写成最终完成 |
| 评分权 | 外部 verifier / hook / hidden checks | 评分器不在 agent 可写区 |
| 环境修改权 | Human gate / policy hook | 改测试、CI、权限、memory 要审批 |

INTJ 版洞察：单一目标会诱导投机，多约束合约会诱导工程纪律。

## Claude Code 组件映射

| Claude Code 组件 | 治理角色 | 设计结论 |
|---|---|---|
| Skill | 程序性知识与行为约束 | 影响判断，但不是信任边界 |
| Slash command | 显式入口/路由器 | 用户主动触发 PUA 或 loop |
| Hook | 确定性生命周期 gate | 用于阻断/询问高风险动作 |
| Subagent | 独立上下文执行者/评审者 | 隔离上下文不等于可信 verifier |
| PUA Loop Stop hook | Oracle 式外部检查 | completion promise 必须由 verify_command 通过才放行 |
| Marketplace manifest | 发布事实源 | 版本和 changelog 必须一致 |

## 常见作弊面与 PUA 对策

| 作弊面 | 典型信号 | PUA 行为约束 | 机械防线 |
|---|---|---|---|
| Grader gaming | 修改 tests/evals/scoring/verifier 让失败消失 | 先声明这是评分资产，不能直接改成“通过” | `integrity-guard.sh` 对写入/修改高风险路径 ask/deny |
| Solution contamination | 读取 hidden solution、gold patch、benchmark artifact | 不读取隐藏答案；只能读公开需求和失败报告 | 对 hidden/private/solution-artifact 读写 deny |
| Self-report cheating | 没跑验证就写 done/pass | agent 只能提出候选状态，不能最终裁决 | Stop hook / verifier 负责放行 |
| Intent drift | 用户要修 bug，却只隐藏 UI 症状 | 回到 task contract 的 intent 与 forbidden | 信心门控逐条对照验收 |
| Persistent hallucination | 把未验证结论写入长期 memory | append-only，且标注 verified/unverified | memory/status 写入走 approval |
| Capability abuse | 为完成任务越权读敏感数据或部署生产 | 风险分层审批，不靠 prompt 自觉 | hooks + human gate |
| Trace-level deception | 总结很漂亮但隐藏失败路径 | 报告失败路径、命令、输出、剩余风险 | eval/trace review 检查证据链 |

## Task Contract 最小格式

```json
{
  "feature_id": "auth_login_001",
  "intent": "用户可以通过邮箱密码登录",
  "acceptance": [
    "未注册用户不能登录",
    "错误密码显示错误提示",
    "正确密码进入 dashboard",
    "刷新后 session 保持"
  ],
  "forbidden": [
    "不能 hardcode token",
    "不能跳过密码校验",
    "不能关闭 auth middleware"
  ],
  "verify_commands": ["npm test", "npm run e2e"],
  "agent_proposed_status": "pending|candidate_pass|blocked",
  "verifier_status": "pending|pass|fail"
}
```

强制规则：Agent 可以更新 `agent_proposed_status`，但最终 `verifier_status` 只能由 verifier/harness 写入。

## Memory 权限模型

| Memory 类型 | 内容 | 权限 |
|---|---|---|
| Project state | 当前任务、feature 状态、最终 pass/fail | verifier / harness 主导 |
| Decision log | 架构决策、取舍原因 | agent 可 append-only 写入 |
| Error log | 失败测试、回滚原因、排除项 | agent 可 append-only 写入 |
| User preferences | 用户长期偏好 | 需要用户确认后写入 |

不要覆盖历史记忆。优先级：append-only > overwrite；structured JSON/JSONL > freeform；verified memory > self-claimed memory；scratchpad ≠ long-term memory。

## 风险分层审批

| 行为 | 默认动作 |
|---|---|
| 读项目普通文件 | 允许 |
| 修改普通代码 | 通常允许，交付前验证 |
| 删除文件、大规模重命名 | ask |
| 改 tests/evals/scoring/verifier/CI | ask，必须说明为什么不是 grader gaming |
| 读 hidden tests / hidden solution / benchmark answer | deny，除非用户显式授权并隔离记录 |
| 写长期 memory / status / progress | ask，必须区分 proposed 与 verified |
| 生产部署、转账、发邮件、访问敏感数据 | 必须 human gate |

## 交付前治理循环

1. 将用户目标拆成 task contract：intent / acceptance / forbidden / verify_commands。
2. 执行修改时保持最小 diff，避免无关文件变化。
3. 自测只能产生候选状态，不产生最终完成权。
4. 外部 verifier / hook / hidden check 独立验证。
5. 如果 verifier 失败，只根据 fail report 修复，不改评分器逃避失败。
6. 交付报告必须包含：变更、验证命令、失败路径、剩余风险、是否需要人审。

## 可接受的“100% 信心”定义

“事实上的 100%”不是宇宙级绝对正确，而是当前可获得证据下：

- 所有公开验收已运行且通过；
- 所有可访问的高风险漏洞已修复或明确披露；
- 没有修改评分器、隐藏测试、verifier、CI 来制造通过；
- 最终完成权由 verifier/harness 或用户确认，不由执行 agent 自封；
- 发布链路（版本、manifest、cache、git）有独立检查输出。
