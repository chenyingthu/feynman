# Pi-Agent Skill 设计指南

> 基于 Feynman 项目实践总结的 Skill 设计与开发规范

---

## 1. 架构原则

### 1.1 三层分离架构

所有 Skill 必须遵循三层架构，各层职责清晰分离：

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Skill (用户入口层)                              │
│  - 极简元数据声明                                         │
│  - 工作流路由委托                                         │
│  - 输出契约声明                                           │
│  Location: skills/<name>/SKILL.md                        │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Workflow (流程控制层)                           │
│  - 完整执行步骤                                           │
│  - 制品生命周期管理                                       │
│  - 质量门禁与验证点                                       │
│  Location: prompts/<workflow>.md                         │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Subagent (专业执行层)                           │
│  - 角色定义与行为约束                                     │
│  - 工具授权与完整性戒律                                   │
│  - 输出格式化要求                                         │
│  Location: .feynman/agents/<agent>.md                    │
└─────────────────────────────────────────────────────────┘
```

**核心原则：**
- **Skill 不实现逻辑**：只引用 Workflow，不自包含完整指令
- **Workflow 不假设代理行为**：明确委托给特定 Subagent
- **Subagent 不超出授权**：严格限制工具集和输出格式

---

## 2. Skill 文件规范

### 2.1 文件位置

```
skills/
├── <skill-name>/
│   └── SKILL.md          # 必须存在
│   └── (可选) config.json #  Skill 级别配置
```

### 2.2 文件结构模板

```markdown
---
name: <skill-name>
description: <一句话描述 Skill 的用途>
---

# <Skill 显示名称>

<简短说明 Skill 的功能>

## Activation

<触发条件描述>
- When: <何时触发>
- Input: <期望输入格式>
- Flags: <支持的命令行选项>

## Workflow

Run the `/<workflow-name>` workflow. 
The slash command expands the full workflow instructions in the active session; do not try to read a relative prompt-template path from the installed skill directory.

## Agents

Agents used: `<agent1>`, `<agent2>`, `<agent3>`

## Output

<输出描述> in `<location>/<slug>.<ext>` with `<location>/<slug>.<sidecar>.md` sidecar.

```

### 2.3 必填字段说明

| 字段 | 要求 | 示例 |
|------|------|------|
| `name` | 小写，连字符分隔，<20字符 | `deep-research`, `lit-review` |
| `description` | 一句话，明确价值 | `Run a thorough, source-heavy investigation...` |
| `workflow` | 对应 prompts/*.md 文件名 | `/deepresearch` → `prompts/deepresearch.md` |
| `agents` | 至少声明一个子代理 | `researcher`, `verifier` |
| `output` | 必须指定输出路径和格式 | `outputs/<slug>.md` |

### 2.4 禁止行为

❌ **Skill 文件禁止：**
- 复制 Workflow 的完整指令内容
- 引用外部 API 密钥或配置值
- 定义复杂的条件分支逻辑
- 修改子代理的核心行为

---

## 3. Subagent 设计规范

### 3.1 Subagent Charter 模式

每个 Subagent 必须遵循 **Charter（特许状）模式**，包含三部分：

```yaml
---
name: <agent-name>
description: <角色一句话描述>
thinking: <high|medium|low>    # 认知复杂度声明
tools: <tool1>, <tool2>       # 明确授权的工具集
output: <filename>            # 输出文件名约定
defaultProgress: true|false   # 是否默认显示进度
---

# <角色名称>

You are Feynman's <role> subagent.

## Integrity Commandments

1. **戒律1**: <具体约束>
2. **戒律2**: <具体约束>
...

## Operating Rules

<执行规则>

## Output Format

<输出格式规范>

## Output Contract

- Save to the output path specified by the parent (default: `<filename>`).
- <其他输出要求>
```

### 3.2 完整性戒律（Integrity Commandments）

每个代理必须定义 3-6 条不可违背的完整性戒律：

**通用戒律清单：**

| 代理类型 | 示例戒律 |
|----------|----------|
| Researcher | Never fabricate a source |
| Researcher | URL or it didn't happen |
| Verifier | Verify meaning, not just topic overlap |
| Verifier | Refuse fake certainty |
| Reviewer | Every weakness must reference a specific passage |
| Reviewer | Distinguish between fatal issues and polish |
| Writer | Never extrapolate details you haven't read |

### 3.3 工具授权原则

**最小权限原则：** 只授予完成任务必需的工具集。

```yaml
# Researcher - 需要探索收集
tools: read, write, edit, bash, grep, find, ls, web_search, fetch_content, get_search_content

# Verifier - 需要验证追溯
tools: read, bash, grep, find, ls, web_search, fetch_content, get_search_content

# Reviewer - 主要分析阅读
tools: read, bash, grep

# Writer - 主要创作编辑
tools: read, write, edit
```

### 3.4 输出合约强制要求

每个 Subagent 必须包含明确的 **Output Contract** 章节：

```markdown
## Output Contract

- Save to the output path specified by the parent (default: `<default-path>`).
- Minimum viable output: <最低产出要求>
- Return a one-line summary to the parent, not full findings.
- Include a short `<Status Section>` with: done, blocked, or needs follow-up.
```

---

## 4. Workflow 设计规范

### 4.1 Workflow 文件定位

```
prompts/
├── <workflow>.md          # 主工作流指令
├── <workflow>-part-2.md  # （可选）分拆指令
└── draft.md              # 通用 writer 提示词
```

### 4.2 Artifact Contract 规范

**强制要求**的工作流必须声明其 Artifact Contract：

```markdown
## Artifact Contract

Required outputs:
1. `outputs/.plans/<slug>.md` - Plan with objectives and constraints
2. `outputs/<slug>.md` - Final deliverable
3. `outputs/<slug>.provenance.md` - Provenance sidecar
4. `outputs/.drafts/<slug>-<stage>.md` - Intermediate artifacts

Optional outputs:
- `outputs/.plans/<slug>.manifest.json` - State tracking
```

### 4.3 Stage Lifecycle 规范

工作流必须明确定义阶段（Stages）：

| Stage | Purpose | Artifact Pattern |
|-------|---------|------------------|
| `plan` | Define scope and approach | `.plans/<slug>.md` |
| `gather` | Collect evidence | `.drafts/<slug>-<source>.md` |
| `synthesize` | Combine and analyze | `.drafts/<slug>-<analysis>.md` |
| `draft` | Create deliverable | `.drafts/<slug>-draft.md` |
| `verify` | Citation and validation | `*-cited.md`, `*-verified.md` |
| `review` | Quality assessment | `*-review.md` |
| `deliver` | Final output | `outputs/<slug>.md` |

### 4.4 Manifest 状态追踪

**强烈推荐** 使用 manifest 文件追踪工作流状态：

```json
{
  "workflow": "lit",
  "slug": "<topic-slug>",
  "mode": "deep",
  "requiredArtifacts": [
    "outputs/<slug>.md",
    "outputs/<slug>.provenance.md"
  ],
  "currentStage": "synthesize",
  "status": "running"
}
```

---

## 5. 质量门禁与测试

### 5.1 Content-Policy 测试

每个 Workflow 必须与 `tests/content-policy.test.ts` 中的规则兼容：

```typescript
// 必须验证的合规性检查
test("<workflow> workflow requires durable artifacts", () => {
  assert.match(prompt, /write the requested durable artifact/i);
  assert.match(prompt, /verify on disk that.*exists/i);
});

test("<workflow> does not end with only an explanation", () => {
  assert.match(prompt, /Never end with only an explanation/i);
});
```

### 5.2 Artifact Guard 要求

**所有生成长篇报告的工作流** 必须兼容 Artifact Guard：

```typescript
// CLI 侧实现
import { runLitArtifactGuard } from "./workflows/lit-artifact-guard.js";

const guardResult = runLitArtifactGuard({
  command: "lit",
  rest: args,
  workingDir,
  exitCode: piExitCode,
  startedAtMs: Date.now(),
});

if (!guardResult.ok && guardResult.recoverable) {
  // 触发自动恢复流程
}
```

### 5.3 测试覆盖要求

| Skill 类型 | 必需测试 |
|-----------|----------|
| 任何 Skill | content-policy.test.ts 扩展用例 |
| Instrumentation | dedicated.test.ts 单元测试 |
| Multi-stage workflow | 阶段转换测试 |
| 文件输出 | 路径解析 + mtime 验证 |

---

## 6. CLI 集成规范

### 6.1 命令注册

在 `metadata/commands.mjs` 中注册：

```javascript
export const cliCommandSections = [
  {
    title: "Research Workflows",
    commands: [
      {
        usage: "<skill-name> <topic>",
        description: "Brief description",
        topLevelCli: true,  // 启用顶层 CLI 调用
      },
    ],
  },
];

export const topLevelCommandNames = [
  // ... 列表中添加命令名
];
```

### 6.2 参数传递

Skill 命令参数通过 `resolveInitialPrompt` 转换为 slash 格式：

```typescript
// 输入: feynman lit power electronics --deep
// 输出: /lit power electronics --deep
```

### 6.3 响应式输出

| 场景 | 输出格式 |
|------|----------|
| 成功完成 | `✅ <Artifact> written: <path>` |
| Guard 恢复触发 | `🔄 Recovery triggered for <slug>` |
| 部分失败 | `⚠️ Partial: <missing artifacts>` |
| Guard 阻止 | `❌ Blocked: <reason>` |

---

## 7. 制品命名规范

### 7.1 Slug 生成规则

```typescript
function deriveSlugFromTopicParts(parts: string[]): string | undefined {
  const text = parts
    .join(" ")
    .replace(/--[a-z0-9-]+(?:=\S+)?/gi, " ")  // 过滤选项
    .toLowerCase();
  const asciiWords = text.match(/[a-z0-9]+/g) ?? [];
  return asciiWords.slice(0, 5).join("-");  // 最多5个单词
}
```

**规则：**
- 仅保留 ASCII 字母数字（非 ASCII 字符忽略）
- 最多 5 个单词
- 小写，连字符分隔
- 匹配 `/^[a-z0-9][a-z0-9-]{0,80}$/` 模式

### 7.2 目录结构

```
outputs/
├── <slug>.md                    # 最终产出（必须）
├── <slug>.provenance.md        # 溯源文件（必须）
├── <slug>.blocked.md           # Guard 阻塞文件（如失败）
├── .plans/
│   ├── <slug>.md               # 计划文档
│   └── <slug>.manifest.json    # 状态追踪
└── .drafts/
    ├── <slug>-draft.md         # 草稿版本
    ├── <slug>-cited.md         # 引用版
    ├── <slug>-revised.md       # 修订版
    ├── <slug>-taxonomy.md     # 分类文档
    ├── <slug>-evidence-matrix.md # 证据矩阵
    └── <slug>-method-comparison.md # 方法对比
```

---

## 8. 扩展指南

### 8.1 添加新 Skill 的流程

1. [ ] 确定 Workflow（新建或复用现有）
2. [ ] 设计 Subagent 职责（新建或复用现有）
3. [ ] 创建 `skills/<name>/SKILL.md`
4. [ ] 在 `metadata/commands.mjs` 注册命令
5. [ ] 编写 content-policy 测试用例
6. [ ] （可选）编写单元测试
7. [ ] 验证 `./tests/content-policy.test.ts` 通过
8. [ ] 更新文档

### 8.2 复用现有组件

**复用优先原则：** 优先复用现有 Subagent 而非新建。

| 任务类型 | 推荐代理 | Workflow 模板 |
|----------|----------|---------------|
| 证据收集 | researcher | `deepresearch` |
| 事实验证 | verifier | `deepresearch` |-verify |
| 质量评审 | reviewer | `lit` 的 review 阶段 |
| 文档撰写 | writer | `draft` |
| 文献检索 | researcher | `lit` candidate-pool |

---

## 9. 最佳实践总结

### 9.1 Do's

✅ Skill 保持极简，只声明不实现  
✅ Workflow 明确定义 Artifact Contract  
✅ Subagent 定义完整性戒律和 Output Contract  
✅ 使用 mtime 验证防止过期制品  
✅ 为每个 Workflow 添加 Content-Policy 测试  
✅ Guard 机制防止静默失败  
✅ 溯源文件随主产出一起写入  

### 9.2 Don'ts

❌ 在 Skill 中复制 Workflow 内容  
❌ Subagent 超越授权工具集  
❌ Workflow 结束于解释而非制品写入  
❌ 忽略 Content-Policy 测试失败  
❌ 在 Prompt 中使用未经审批的占位符内容  
❌ 允许制品路径遍历安全风险  

---

## 附录 A: 参考文档

| 文件 | 说明 |
|------|------|
| `CLAUDE.md` | 项目概述和开发命令 |
| `skills/*/SKILL.md` | 现有 Skill 实例 |
| `.feynman/agents/*.md` | Subagent Charter 实例 |
| `prompts/<workflow>.md` | Workflow 指令实例 |
| `tests/content-policy.test.ts` | 合规性测试模板 |

---

*Version: 1.0*  
*Based on Feynman project practices*  
*Last updated: 2026-04-29*
