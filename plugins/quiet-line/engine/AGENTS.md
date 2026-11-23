# Quiet Line 维护规范 / Maintenance policy

## 模型可见 Prompt

- 修改绘画引擎时，保留现有创作指导。不得顺带新增或强化影响 Agent 创作策略、审美偏好或笔触选择的内置指导，包括作画顺序、构图、光线以及笔触的尺度、密度和数量。
- 确有必要修改模型可见 Prompt 时，单独列出所涉及的位置、变更前后的原文、理由和预期影响。请用户决定是否接受，获得明确同意后再应用。
- 检查 Agent 可见的工具介绍、参数说明、错误及返回文本、插件文案、技能指令，以及作为指导提供的文档和示例。准确说明单位、取值范围、材料行为和文件保存规则，把技术约束表述为可验证的事实。
- 本规范适用于 Quiet Line 的开发、移植和打包。将维护规范保存在维护文档中，绘画时加载已经审阅的绘画提示。

## Model-visible prompts

- Preserve the existing creative guidance when changing the painting engine. Engine work must never add or strengthen incidental built-in guidance that influences an agent's creative strategy, aesthetic preferences, or stroke choices, including painting sequence, composition, lighting, and stroke scale, density, or count.
- When a model-visible prompt change is necessary, list each affected location, the exact before and after text, the reason, and the expected impact in a separate review. Let the user decide whether to accept it. Apply the change after the user explicitly accepts it.
- Review model-visible tool descriptions, parameter guidance, errors and tool results, plugin copy, skill instructions, and documentation and examples supplied as guidance. Describe units, supported ranges, material behavior, and file handling accurately as verifiable technical facts.
- This policy applies to Quiet Line development, ports, and packaging. Keep the policy in maintenance documentation and load the reviewed drawing prompts for painting sessions.
