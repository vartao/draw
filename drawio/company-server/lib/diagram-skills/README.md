# Diagram Skills

这里维护 AI 图表生成的类型规则。每个图表类型一个目录，目录里放一个 `SKILL.md`。

```text
diagram-skills/
  erd/
    SKILL.md
  flowchart/
    SKILL.md
```

服务端每次生成图表提示词时，都会优先读取对应类型的 `SKILL.md`。例如 ER 图读取 `erd/SKILL.md`。

## 怎么维护

直接编辑对应类型的 `SKILL.md`：

- `flowchart/SKILL.md`：流程图
- `swimlane/SKILL.md`：泳道图
- `sequence/SKILL.md`：UML 时序图
- `uml_class/SKILL.md`：UML 类图
- `erd/SKILL.md`：ER 图
- `architecture/SKILL.md`：架构图
- `c4/SKILL.md`：C4 图
- `general/SKILL.md`：通用关系图

建议保持这些章节：

- `适用场景`
- `输出规则`
- `禁止事项`
- `输出结构`

规则会影响模型输出结构；最终 draw.io XML 排版仍由 `../diagram-skill.js` 控制。也就是说，字段旋转、连线绕路、布局重叠这类渲染问题，需要改渲染代码，不只改 `SKILL.md`。

服务端仍保留旧版 `<type>.json` fallback，但默认规则已经迁移到 `SKILL.md`。新维护请使用 Markdown。
