# 单文件绘画工程 / Single-file drawing projects

[README](README.md) · [干性材料 / Dry media](DRY-MEDIA.md) · [湿画快照 / Wet snapshots](CONTROL.md) · [绘画方法 / Drawing practice](DRAWING.md)

## 为什么用工程 / Why projects

`.qlpaint` 和 `.qldry` 是独立的材料状态快照。它们继续有效，但不必再为每一轮绘制手动保存一个新文件。

新的 **`.qlproject`** 把一个画布的材料快照、PNG 预览、步骤记录和命名检查点放进一个 SQLite 工程文件。模型每次把 `project` 传给 `quiet_line_draw`，成功后自动记录一步；下一次仍使用同一个工程路径。PNG 依然作为绘画结果独立导出，工程不会自动删除你已有的 PNG 或快照。

`.qlpaint` and `.qldry` remain standalone material snapshots. A **`.qlproject`** instead holds material snapshots, PNG previews, step metadata and named checkpoints in one SQLite project. Pass the same `project` path to successive `quiet_line_draw` calls; successful calls automatically record new steps. PNG output remains independent. Existing PNGs and snapshots are never automatically deleted.

1.4.0 起，同一工程可以**分阶段交替使用干湿材料**：`wet`（oil / oilknife）与 `dry`（干性铅笔／炭条）。默认继承当前材料；需要更换时显式设置 `project_material`。切换把当前可见图像固定为下一阶段的底图，旧材料状态仍保存在保留的历史步骤中。它不是图层编辑器，不模拟湿油彩与炭粉的物理混合，也不会把固定底图反解为可擦揉或湿混材料。

Since 1.4.0 one project can **alternate wet and dry phases**. Calls inherit the active medium unless `project_material` explicitly selects `wet` or `dry`. A switch fixes the visible image as the next phase's base; the previous editable material state remains in retained history. This is not a layer editor, wet-pigment/charcoal interaction simulation or reconstruction of material from flattened pixels.

## 默认保留策略 / Retention defaults

- 最近 **30 步未命名自动历史**，可调整为 `1..500`。
- 另支持最多 **64 个命名检查点**，不会被自动清理。
- 默认 **2048 MiB** 逻辑容量，可调整为 `64..8192 MiB`。容量计算含压缩材料状态、PNG 预览及记录；SQLite 页结构另有至多 16 MiB 的预留。
- 超过历史数量或容量时，从最旧的未命名步骤开始清理，但保留当前步骤及所有命名检查点。若这样仍无法满足容量限制，本次提交失败，原工程不变；需要先取消一些检查点或提高容量。
- 历史记录数不是笔画数：**一次成功工具调用是一整步**，其中可以包含许多笔画和材料操作。

Defaults retain the **30 most recent unpinned automatic steps**, configurable from `1..500`, plus up to **64 named checkpoints**. The logical size limit defaults to **2048 MiB**, configurable from `64..8192 MiB`; this includes compressed material snapshots, PNG previews and records, with up to 16 MiB reserved separately for SQLite page overhead. Oldest unpinned steps are pruned first, never the current head or pinned checkpoints. If the remaining data still exceeds capacity, the commit fails without replacing the previous project. Unpin checkpoints or raise the limit. A history step is one successful tool call, not one individual stroke.

**一个文件不意味着无限空间。** 当前保存的是完整、压缩后的材料快照，而不是每笔的极小增量；复杂或大画布工程仍可能很大。已有历史不需要在每次绘制时重新演算。

**One file does not mean unlimited space.** History stores full compressed material snapshots, not tiny per-stroke deltas. Complex projects can still be large, but earlier strokes do not have to be replayed for each new drawing.

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

这会把当前油彩标记为已干并另存为新的工程步骤，原有 PNG、颜料颜色与厚度不变；继续用油画笔时不会从这层已干颜料拾色。无需等待现实时间。这不是切换到 `project_material:"dry"`：后者是石墨／炭笔阶段，并会将画面固定为底图。干化只作用于当前湿油画 head，不支持选取历史步；如需先回到历史，请先 restore。正常历史清理规则仍然适用：若需要保证可以恢复干化前的湿状态，应在干化前给该步骤建立命名检查点或先分支备份。

旧 `.qlpaint` 可先导入一个新湿工程，再干化；原快照不会修改。新版可读取旧工程和快照，但旧版本可能无法正确解释新版干化后的湿度标记，因此降级前请备份并保留原工程。旧版本若已发生笔画年龄循环混淆，无法推断真实历史；新版本无法复原此前已经丢失的信息。

In a wet oil project, `quiet_line_project` action `dry_paint` saves the current oil as a new dry-paint step without changing its PNG, pigment colour or relief. No real-time waiting is simulated. This is not `project_material:"dry"`, which switches to graphite/charcoal and fixes the image as a base. Only the current wet head can be dried. Normal retention applies: pin a checkpoint or branch before drying if the wet state must remain recoverable. Old `.qlpaint` snapshots can be imported into a new wet project first without modifying the source. The new engine reads old state, but older versions may not interpret the new dry marker correctly; back up before downgrading. Previously lost age information after a legacy wrap cannot be reconstructed.

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

此后仅需 `project` 和新的 `operations`。材料模式自动继承；恢复材料时仍遵守原状态的尺寸、纸面等约束。`project_history_limit` 和 `project_max_mb` 省略时继承现值，显式提供时调整保留策略；检查点不会因此被静默删除。

Later calls need only `project` and new `operations`. Mode is inherited, and original state constraints such as dimensions and substrate still apply. Retention settings inherit when omitted; explicit values adjust the policy without silently dropping named checkpoints.

## 在同一工程交替用干湿材料 / Alternate media in one project

`project_material` 为 `dry` 或 `wet`，只可与 `project` 一起使用。省略时继承当前模式，不能仅凭传入另一种笔画偷偷固化工程。显式切换为湿画且未指定 `brush` 时使用油画笔。一个调用只操作一种材料；交替调用即可，不在同一调用混传 `operations` 与油画 `strokes`。

`project_material` selects `dry` or `wet` and requires `project`. Omission inherits the active mode; another kind of mark does not silently flatten a project. Explicit wet creation/switching defaults to the oil brush. One call operates in one material; alternate calls rather than mixing dry `operations` and oil `strokes` in one call.

先用炭笔起型 / Start with charcoal construction:

```json
{
  "project": "mixed-study.qlproject",
  "project_material": "dry",
  "size": 320,
  "operations": [{"tool": "charcoal", "points": [[0.3, 0.7], [0.5, 0.3], [0.7, 0.7]], "width": 4, "pressure": 0.25}],
  "project_checkpoint": "Charcoal construction"
}
```

再薄涂油彩 / Switch to thin oil colour:

```json
{
  "project": "mixed-study.qlproject",
  "project_material": "wet",
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
  "project_material": "dry",
  "operations": [{"tool": "pencil", "points": [[0.32, 0.71], [0.68, 0.71]], "width": 2, "pressure": 0.45}]
}
```

**切换边界：** 每次更换材料，会把上一阶段 PNG 固定为新材料的底图；尺寸不变。新阶段的橡皮只能移走本阶段新材料，不能擦掉已固定的油画或炭笔；湿画拾色也不能恢复旧阶段的湿度。相同模式连续调用则仍保留可擦揉材料或湿混状态，不重复固化。历史列表逐步骤标明材料；恢复或分支会回到该步真正的材料状态，导出快照的扩展名也按**所选步骤**而非当前头部决定。命名切换前的重要步骤，防止被正常保留策略清理。

**Switch boundary:** each change fixes the previous PNG as the new medium's base, preserving dimensions. Erasers remove only new dry marks; old fixed oils/charcoal are not erasable, and wet pickup cannot recover an earlier phase's wetness. Same-mode calls keep the live material without re-flattening. History identifies each step's material; restore/branch revives that step's real state. Snapshot export uses the **selected step's** mode, not the current head. Pin important pre-switch steps against ordinary retention pruning.

**兼容：** 1.3 工程只读和同模式写仍保持原格式；首次显式材料切换才在事务中升级格式。新建／分支工程使用新格式。1.3 不能读取新格式；升级后不要用旧插件打开新工程。迁移前备份重要旧工程。

**Compatibility:** reading or same-mode editing of a 1.3 project preserves its old format. Its first explicit material switch upgrades transactionally. New/branched projects use the new format, which 1.3 cannot read. Back up important old projects before migrating; use the updated plugin for new-format files.

## 历史、恢复与分支 / History, restore and branch

管理工具名为 **`quiet_line_project`**。`project` 始终必填；步骤使用工具列表返回的 **ID**，不是显示顺序或笔画编号。

Use **`quiet_line_project`**. Always provide `project`; use actual step IDs from its list, not row positions or stroke numbers.

| `action` | 其他字段 / Other fields | 作用 / Effect |
| --- | --- | --- |
| `list` | — | 列出当前步骤、历史、检查点和容量设置 / List head, history, checkpoints and limits |
| `checkpoint` | `step`（省略为当前 / default head）, `label` | 为该步骤命名并保留 / Name and pin a step |
| `delete_checkpoint` | `step`（省略为当前 / default head） | 取消长期保留，不代表立刻删除该步骤 / Unpin, not necessarily immediately delete the step |
| `restore` | `step` | 切换当前材料到已有步骤，不删除之后的历史 / Move head to an existing step without deleting later history |
| `prune` | `history_limit`, `max_mb`（均可省略 / optional） | 调整策略并立即清理可清理历史 / Apply retention and prune eligible history |
| `branch` | `step`（省略为当前 / default head）, `target` | 以所选状态另存一个新工程，不修改原工程 / Create a new project from one selected state, source unchanged |
| `export` | `step`（省略为当前 / default head）, `target` | 导出 PNG 或对应模式快照 / Export PNG or the mode's standalone snapshot |
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

导出快照时，所选历史步骤为湿画则使用 `.qlpaint`，为干性材料则使用 `.qldry`；PNG 使用 `.png`。新工程、分支和导出只写入工作目录内，不覆盖已有目标。导出父目录须已存在。

Export `.qlpaint` for wet material, `.qldry` for dry material, or `.png` for the preview. Project creation, branches and exports stay within the session working directory and never overwrite existing output targets. Export parent directories must exist.

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
