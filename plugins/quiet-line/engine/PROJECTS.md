# 单文件绘画工程 / Single-file drawing projects

[README](README.md) · [干性材料 / Dry media](DRY-MEDIA.md) · [湿画快照 / Wet snapshots](CONTROL.md) · [绘画方法 / Drawing practice](DRAWING.md)

## 为什么用工程 / Why projects

`.qlpaint` 和 `.qldry` 是独立的材料状态快照。它们继续有效，但不必再为每一轮绘制手动保存一个新文件。

新的 **`.qlproject`** 把一个画布的材料快照、PNG 预览、步骤记录和命名检查点放进一个 SQLite 工程文件。模型每次把 `project` 传给 `quiet_line_draw`，成功后自动记录一步；下一次仍使用同一个工程路径。PNG 依然作为绘画结果独立导出，工程不会自动删除你已有的 PNG 或快照。

`.qlpaint` and `.qldry` remain standalone material snapshots. A **`.qlproject`** instead holds material snapshots, PNG previews, step metadata and named checkpoints in one SQLite project. Pass the same `project` path to successive `quiet_line_draw` calls; successful calls automatically record new steps. PNG output remains independent. Existing PNGs and snapshots are never automatically deleted.

同一工程可交替使用油画笔、调色刀、石墨、炭笔、墨水、钢笔、毛刷和马克笔，并保留已有的湿油彩、干性材料和普通笔迹。下一次调用可以直接选笔。每次成功调用保存整个画布和相应材料状态。

A single project can alternate between oil, palette knife, graphite, charcoal, ink, fountain pen, brush and marker while retaining existing oil, dry pigment and raster marks. Choose another tool on the next call. Each successful call saves the complete canvas and its material state.

## 新建空白画布 / Create a blank canvas

只给出工程名即可创建空白画布，可选设定尺寸与纸面 / Give the project a name and optionally set its size and surface:

```json
{
  "project": "blank-study.qlproject",
  "width": 900,
  "height": 600,
  "surface": "linen"
}
```

之后继续使用同一个工程路径。工程尺寸随首个画布保存 / Reuse the same project path on subsequent calls. The project retains the initial canvas dimensions.

## 默认保留策略 / Retention defaults

- 最近 **30 步未命名自动历史**，可调整为 `1..500`。
- 另支持最多 **64 个命名检查点**，不会被自动清理。
- 默认 **2048 MiB** 逻辑容量，可调整为 `64..8192 MiB`。容量计算含压缩材料状态、PNG 预览及记录；SQLite 页结构另有至多 16 MiB 的预留。
- 超过历史数量或容量时，从最旧的未命名步骤开始清理，但保留当前步骤及所有命名检查点。若这样仍无法满足容量限制，本次提交失败，原工程不变；需要先取消一些检查点或提高容量。
- 历史记录数不是笔画数：**一次成功工具调用是一整步**，其中可以包含许多笔画和材料操作。

Defaults retain the **30 most recent unpinned automatic steps**, configurable from `1..500`, plus up to **64 named checkpoints**. The logical size limit defaults to **2048 MiB**, configurable from `64..8192 MiB`; this includes compressed material snapshots, PNG previews and records, with up to 16 MiB reserved separately for SQLite page overhead. Oldest unpinned steps are pruned first, never the current head or pinned checkpoints. If the remaining data still exceeds capacity, the commit fails without replacing the previous project. Unpin checkpoints or raise the limit. A history step is one successful tool call, not one individual stroke.

### 工程存储 / Project storage

Quiet Line 1.6.0 新建的画布使用 v4 工程。多个步骤可以引用同一份材质数据，每步仍可单独恢复或导出。容量上限继续按各步完整的逻辑大小计算。工程内总会保存该步的完整 PNG。在绘画调用里指定 `"output": false`，可以只写工程；指定 PNG 路径则同时导出图片。

New canvases use format v4 in Quiet Line 1.6.0. Steps share byte-identical material data and can be restored or exported independently. The capacity limit still counts the full logical size of each step. Every step retains its PNG in the project. Set `output` to `false` on a project draw to skip the external PNG, or supply a path to export it.

用 `quiet_line_project` 的 `compact` 操作把旧工程的全部现存历史复制到新文件。步骤编号、检查点、当前步骤和修订号一起保留。新文件需要 Quiet Line 1.6.0 或更新版本。原件可继续用原来的插件打开，两份同时保留会占用两份文件的空间。

Use `compact` to copy all retained history into a new v4 file. It preserves step IDs, checkpoints, the current head and the revision. The copy requires Quiet Line 1.6.0 or later. The original stays usable with its existing plugin. Both files occupy disk space when retained together.

```json
{"project":"blank-study.qlproject","action":"compact","target":"blank-study-compact.qlproject"}
```

## 开始湿画工程 / Start a wet project

调用 `quiet_line_draw` / Call `quiet_line_draw`:

```json
{
  "project": "still-life.qlproject",
  "brush": "oil",
  "size": 800,
  "title": "Still life — block in",
  "strokes": [
    {"points": [[0.2, 0.65], [0.8, 0.65]], "width": 3, "color": "ochre"}
  ],
  "project_checkpoint": "Block in"
}
```

继续时无需 `paint_state` 或 `save_state` / Continue without loose snapshots:

```json
{
  "project": "still-life.qlproject",
  "strokes": [
    {"points": [[0.45, 0.3], [0.5, 0.7]], "width": 2, "color": "clay"}
  ]
}
```

## 让油彩干化 / Dry oil paint explicitly

在湿油画工程中，可以调用 `quiet_line_project`：

```json
{"project":"still-life.qlproject","action":"dry_paint"}
```

这会把当前步骤中的油彩标记为已干并保存新一步，保留 PNG、颜料颜色和厚度。干化立即生效，之后的油画笔会跳过这层已干颜料的湿拾色。即使上一轮用的是石墨、炭笔或普通笔刷，只要当前工程有油彩，就可以干化。要干化某个历史状态，先用 `restore` 回到该步。干化步骤遵循同样的历史保留策略。

旧 `.qlpaint` 可先导入一个新湿工程，再干化；原快照不会修改。新版可读取旧工程和快照，但旧版本可能无法正确解释新版干化后的湿度标记，因此降级前请备份并保留原工程。旧版本若已发生笔画年龄循环混淆，无法推断真实历史；新版本无法复原此前已经丢失的信息。

`quiet_line_project` action `dry_paint` immediately marks the current oil as dry in a new step, preserving the PNG, pigment colour and relief. Subsequent oil strokes skip wet pickup from that dried paint. The action works after a dry-media or raster pass as long as the current state includes oil. To dry an earlier state, restore that step first. The usual history retention rules apply. You can also import an older `.qlpaint` snapshot into a new project and then dry it.

## 开始干性材料工程 / Start a dry project

```json
{
  "project": "charcoal-study.qlproject",
  "dry_media": true,
  "size": 700,
  "operations": [
    {"tool": "charcoal", "points": [[0.2, 0.5], [0.8, 0.5]], "width": 10, "pressure": 0.35, "grade": "6B", "tilt": 0.8, "angle": 90},
    {"tool": "kneaded", "points": [[0.48, 0.35], [0.48, 0.65]], "width": 6, "pressure": 0.7}
  ],
  "project_history_limit": 30,
  "project_max_mb": 2048
}
```

下次传同一个 `project` 和新的 `operations`，即可继续叠加、擦除或擦揉工程中的干性材料。`project_history_limit` 和 `project_max_mb` 省略时继承现值，显式提供时调整保留策略。命名检查点独立保留。

Reuse `project` with new `operations` to deposit, erase or smudge dry pigment already in the project. Retention settings inherit when omitted. Explicit values adjust the policy while keeping named checkpoints pinned.

## 在同一工程交替用干湿材料 / Alternate media in one project

传 `brush` 选择下一轮笔刷，或用 `operations` 执行干性材料操作。省略笔刷时可延续上一轮笔刷。旧脚本可继续使用 `project_material:"wet"` 或 `"dry"` 提示默认笔刷。显式指定的 `brush` 优先。干性 `operations` 与油彩 `strokes` 分调用提交。

Pass `brush` to select a tool for the next pass, or use `operations` for dry-media actions. You can omit the brush to continue with the previous tool. Existing scripts can still pass `project_material:"wet"` or `"dry"` to suggest a default. An explicit `brush` takes priority. Submit dry `operations` and oil `strokes` in separate calls.

先用炭笔起型 / Start with charcoal construction:

```json
{
  "project": "mixed-study.qlproject",
  "size": 320,
  "operations": [{"tool": "charcoal", "points": [[0.3, 0.7], [0.5, 0.3], [0.7, 0.7]], "width": 4, "pressure": 0.25}],
  "project_checkpoint": "Charcoal construction"
}
```

再薄涂油彩 / Switch to thin oil colour:

```json
{
  "project": "mixed-study.qlproject",
  "brush": "oil",
  "load": 20,
  "impasto": 10,
  "strokes": [{"points": [[0.35, 0.6], [0.65, 0.6]], "width": 18, "opacity": 0.25, "color": "ochre"}],
  "project_checkpoint": "Thin colour block in"
}
```

最后用干性材料加线 / Switch back for dry accents:

```json
{
  "project": "mixed-study.qlproject",
  "operations": [{"tool": "pencil", "points": [[0.32, 0.71], [0.68, 0.71]], "width": 2, "pressure": 0.45}]
}
```

换笔后，干性材料仍可擦除和擦揉，已有油彩仍按其湿度参与拾色。普通笔迹与各材料自动合成，干性橡皮作用于石墨和炭粉，油画笔从油彩拾色。工程管理工具以整幅画布和材料快照为操作单位，可恢复、分支或导出合成 PNG。

Dry pigment stays erasable and smudgeable after a tool change. Existing oil retains its wetness for later pickup. Quiet Line composites ordinary marks with both materials. An eraser works on graphite and charcoal, and oil brushes pick up oil paint. Project tools act on the whole canvas or on material snapshots. Restore or branch the complete canvas, or export the composite PNG or one material snapshot from a selected step.

旧湿画、干画工程可以直接读取与继续绘制。首次保存新版混合状态时，工程在事务内升级并保留旧的历史步骤。旧文件中已固化的底图仍作为底图使用。旧插件可能无法打开包含混合步骤的工程。

Existing wet and dry projects can be read and continued. The first save of a mixed state upgrades the project in a transaction and retains earlier history steps. Substrates fixed by older releases remain available as base imagery. Older engines may be unable to open projects with mixed steps.

## 历史、恢复与分支 / History, restore and branch

管理工具名为 **`quiet_line_project`**。`project` 始终必填；步骤使用工具列表返回的 **ID**，不是显示顺序或笔画编号。

Use **`quiet_line_project`**. Always provide `project`; use actual step IDs from its list, not row positions or stroke numbers.

| `action` | 其他字段 / Other fields | 作用 / Effect |
| --- | --- | --- |
| `list` | — | 列出当前步骤、历史、检查点和容量设置 / List head, history, checkpoints and limits |
| `checkpoint` | `step`（省略为当前 / default head）, `label` | 为该步骤命名并保留 / Name and pin a step |
| `delete_checkpoint` | `step`（省略为当前 / default head） | 取消长期保留，不代表立刻删除该步骤 / Unpin, not necessarily immediately delete the step |
| `restore` | `step` | 恢复所选画布，保留之后的历史 / Restore the selected canvas while keeping later history |
| `prune` | `history_limit`, `max_mb`（均可省略 / optional） | 调整策略并立即清理可清理历史 / Apply retention and prune eligible history |
| `branch` | `step`（省略为当前 / default head）, `target` | 以所选状态另存一个新工程，不修改原工程 / Create a new project from one selected state, source unchanged |
| `export` | `step`（省略为当前 / default head）, `target` | 导出合成 PNG 或所选步骤的材料快照 / Export the composite PNG or a material snapshot from the selected step |
| `dry_paint` | — | 干化当前步骤中的油彩 / Dry oil paint in the current step |
| `recover` | — | 显式恢复中断写入的 SQLite 事务并检查工程，不生成新步骤 / Explicitly recover an interrupted SQLite transaction and check the project, without adding a step |

```json
{"project": "still-life.qlproject", "action": "list"}
```

```json
{"project": "still-life.qlproject", "action": "checkpoint", "step": 2, "label": "Before highlights"}
```

```json
{"project": "still-life.qlproject", "action": "restore", "step": 2}
```

```json
{"project": "still-life.qlproject", "action": "branch", "step": 2, "target": "still-life-alternative.qlproject"}
```

```json
{"project": "still-life.qlproject", "action": "export", "target": "still-life-preview.png"}
```

恢复之后继续绘制会生成新 ID，父步骤为恢复的那一步。之后的旧步骤不会因恢复动作立刻消失，但仍受自动历史清理规则影响。想长期保留两个方向时，先命名检查点或另存分支。

Drawing after restore creates a new step ID whose parent is the restored step. Later old steps are not immediately discarded by restore, but remain subject to normal retention. Pin important alternatives or branch them into separate projects.

用 `.png` 导出完整画面，用 `.qlpaint` 或 `.qldry` 导出所选步骤中的油彩或干性材料快照。用 `branch` 保留所有材料状态。新工程、分支和导出只写入工作目录内，需使用新的目标路径。导出父目录须已存在。

Export `.png` for the composite artwork, or `.qlpaint` or `.qldry` for a snapshot of oil or dry pigment in the selected step. Use `branch` to keep all material states together. Project creation, branches and exports require new targets within the session working directory. Export parent directories must exist.

## 导入旧快照 / Import old snapshots

向一个**尚不存在的新工程**提供 `paint_state` 或 `dry_state`，即可迁移材料；源快照保持不变。例如调用 `quiet_line_draw`：

Provide `paint_state` or `dry_state` with a **new, nonexistent project** to import the material without changing its source:

```json
{
  "project": "imported-oil.qlproject",
  "paint_state": "old-study.qlpaint",
  "project_checkpoint": "Imported state"
}
```

```json
{
  "project": "imported-charcoal.qlproject",
  "dry_state": "old-study.qldry",
  "project_checkpoint": "Imported state"
}
```

已有工程自行持有材料，不能再同时指定 `base_image`、`paint_state` 或 `dry_state` 来悄悄替换它；如需另一幅画，请创建新工程。使用工程时不再提供 `save_state` 或 `save_dry_state`，因为材料由工程自动保存。`project_checkpoint` 等工程选项不能脱离 `project` 单独使用。

Existing projects own their material state: do not combine them with `base_image`, `paint_state` or `dry_state` to silently replace it. Create a new project for different material. Do not supply `save_state` / `save_dry_state` with a project; it saves automatically. Project-only options require `project`.

## 安全与文件行为 / Safety and file behavior

提交使用 SQLite 事务，并核对读入时的修订号。并行绘画若在渲染期间遇到工程已被另一次调用更新，会报告冲突而不是覆盖对方的最新进度。绘画、校验、容量检查或提交失败时，不更新已有工程；PNG 可能已经被导出，但不会因此假称工程提交成功。

Commits use SQLite transactions and revision checks. Concurrent calls cannot silently overwrite a newer revision. Rendering, validation, capacity or commit failures leave the previous project intact; an independent PNG may already have been exported, but is not reported as a successful project commit.

平时保存的是一个 `.qlproject`。写入期间 SQLite 可能短暂创建事务日志；**不要在写入或崩溃恢复时手动删除日志**。普通读取遇到遗留日志会停止；确认没有仍在写入的工具后，调用 `quiet_line_project` 的 `recover` 动作，由 SQLite 恢复最后一次完整提交并执行完整一致性检查。它不会增加历史步骤，也不保证修复任意外部损坏。材料桥接使用的隐藏临时目录会在正常结束或捕获异常时清理，强制终止进程可能留下临时文件。工具关闭数据库后，可复制工程文件备份。保留重要作品的外部备份仍然有价值，工程并不替代备份。

Normally the persistent result is one `.qlproject`. SQLite may briefly create a transaction journal; **do not manually delete it during writes or crash recovery**. Ordinary reads stop when a journal is present. After ensuring no tool is still writing, call `quiet_line_project` with `action:"recover"` to let SQLite restore the last complete commit and run a full consistency check. This does not create a history step or promise to repair arbitrary external corruption. Hidden temporary material-bridge directories are cleaned on normal completion and caught errors; forcibly terminating the process may leave temporary files. Once the tool has closed the database, copy the project for backup. A project is not a replacement for external backups.
