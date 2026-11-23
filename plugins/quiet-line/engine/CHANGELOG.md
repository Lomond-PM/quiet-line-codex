# Changelog / 更新记录

## 1.5.2 — 2026-11-23

- 笔触尺度与密度由视觉目标决定。工具和指南将阶段顺序、笔触手法和修改轮次表述为可选方法，并保留实际参数限制。
- 在维护规范中要求，将模型可见 Prompt 的修改单独列出交由用户决定。
- Let artistic intent determine stroke scale and density. Describe techniques as options and reserve parameter restrictions for tool behavior.
- Require a separate user review for model-visible prompt changes in the maintenance policy.

## 1.5.1 — 2026-11-23

- 修复 DSH 工程已保存但绘画工具报 `not lossless JSON` 的问题。成功返回预览时省略空提示，预览不可用时仍返回 PNG 路径和说明。
- Fix DSH project draw results rejected as `not lossless JSON` after the drawing had already saved. Preview responses omit absent fields and still report the saved PNG if a preview cannot be attached.

## 1.5.0 — 2026-11-23

- 可以创建空白工程，并在同一画布上交替使用全部八种画笔。工程保留油彩、干性材料和普通笔迹，换笔后可以继续湿拾色、擦除与擦揉。
- 支持打开旧湿画、干画工程以及导入独立的材料快照。混合工程可导出整幅 PNG、提取单种材料快照，也可用分支保留完整工程。
- 画布每边最高 2560 像素。

- Start a blank project and use all eight brushes on the same canvas. Projects retain oil, dry pigment and raster marks across tool changes, with continued wet pickup, erasing and smudging.
- Continue existing wet and dry projects and import standalone material snapshots. Export the full PNG or one material snapshot, or branch to keep all material states.
- The canvas supports up to 2560 pixels per side.

## 1.4.1 — 2026-11-20

- 修复湿油彩年龄循环导致旧颜料返湿、油画拾色及不透明度等问题；保留受控油刷既有默认笔形，避免无关的风格变化。
- 新增湿油画工程 `quiet_line_project` 的 `dry_paint`：显式干化当前颜料，保存新步骤且不改 PNG、颜色和厚度。历史按既有规则裁剪，干化前可先设检查点或备份。不是干性材料切换，也不模拟真实时间干燥。
- 新引擎读取旧工程／快照；旧引擎不理解新干化标记，降级前需备份。旧版本曾发生的年龄循环混淆无法追溯还原。

- Fix oil paint age wrapping, unintended pigment pickup and opacity handling. Explicit `dry_paint` records a new wet-project step with the same PNG, colour and relief but no wet pickup from dried pigment. Pin or branch first if the previous wet state must be preserved under normal retention. No real-time drying or dry-medium switch is simulated. Old state is readable; old engines do not understand the new dry marker, and previously lost age history cannot be recovered.

## 1.4.0 — 2026-11-20

### 中文

- **一个工程交替使用干湿材料**：`project_material:"wet"|"dry"` 显式切换。跨模式把当前 PNG 固定为下一阶段底图，同模式保留原材料模拟；旧状态仍在保留的历史里，可恢复、分支或按该步材料导出。不是可编辑图层，不做干湿物理混合。
- **逐步骤材料历史与旧版兼容**：历史标明各步材料，当前模式跟随 head；旧 1.3 工程只读及同模式写不迁移，首次显式切换在 CAS 事务内升级。新建／分支使用新格式，1.3 插件不能读取；建议备份旧工程。
- **笔宽更实用**：所有画笔整体宽度倍率统一 `0.1..30`；逐点局部 `controls.width` 保持 `0..3`。补足工具 schema 的范围、倍率／像素解释及越界修正建议。新宽笔采用接触尺度相关采样，旧合法输入保留原路径。
- **更明确的绘画指导**：构图、主体尺度、负形、透视与椭圆结构、漫反射／镜面高光／投影关系；可借鉴起型、明暗底稿、色彩结构到边缘细节的真实过程，但可跳过、合并、回头修正或改用直接画法。不因担心 overworking 过早停笔。
- **参考与三辅二**：必要且可用时借助外部参考或三维体块的相机／光照／深度等辅助图，实际查看并对齐视点，不以渲染替代用户要求的绘画，遵守权限、费用和上传约束。稀释油彩按低不透明度、低负载薄涂近似，不新增溶剂模拟。

### English

- **Alternate wet/dry phases in one project:** explicit `project_material:"wet"|"dry"` switches fix the current PNG as the next phase's base. Same-mode calls retain their live material. Earlier states remain restorable/branchable/exportable in retained history. No editable layers or wet/dry physical mixing.
- **Per-step media and compatibility:** history records each step's medium and head mode follows restore. Reading/same-mode editing preserves 1.3 files; first explicit switching upgrades in the CAS transaction. New/branched projects use a format that 1.3 cannot read; back up old projects.
- **Practical brush widths:** all brushes accept overall width multipliers `0.1..30`; per-point `controls.width` remains `0..3`. Tool bounds, multiplier-vs-pixel explanations and corrective errors now agree. New wide marks use contact-scale sampling; old valid inputs keep their rendering path.
- **Stronger craft guidance:** composition, subject scale, negative space, perspective/ellipse construction, diffuse/specular light and shadows. Painting stages are adaptable, not compulsory; direct painting and structural revisions remain valid. Purposeful iteration should not stop prematurely from fear of overworking.
- **References and 3D-to-2D:** optional external references or 3D camera/light/depth aids, actually inspected and aligned, never silently replacing requested painting. Respect permissions, costs and uploads. Low-opacity, low-load thin oils approximate dilution visually, without solvent physics.

## 1.3.0 — 2026-11-20

### 中文

- **单文件绘画工程**：`quiet_line_draw` 提供 `project`，把湿油画或新干性材料的过程状态、PNG 预览和检查点存入一个 `.qlproject`，不再为每轮绘画堆积独立快照。
- **自动历史与检查点**：默认最近 30 步未命名历史，另可保留最多 64 个命名检查点；默认 2048 MiB 容量，可调整历史数量与容量。自动清理不删除当前步骤或命名检查点，容量不足则安全失败。
- **工程管理工具**：新增 `quiet_line_project`，支持查询、检查点、恢复、取消检查点、清理、另存分支及导出 PNG／独立材料状态。恢复后可以继续生成新分支，不立即丢弃后续历史。
- **兼容旧状态**：新工程可导入 `.qlpaint` 或 `.qldry`，不改动源文件。现有不使用工程的绘画参数继续有效。
- **事务与修订保护**：SQLite 单文件事务、防路径逃逸与排他新文件输出，检查修订以拒绝并发覆盖。工程不是无限空间或任意单笔撤销，详见[工程指南](PROJECTS.md)。

### English

- **Single-file drawing projects:** `quiet_line_draw` accepts `project` to keep wet-oil or dry-material states, PNG previews and checkpoints in one `.qlproject`, instead of scattering snapshots for every call.
- **History and checkpoints:** retain 30 unpinned automatic steps plus up to 64 named checkpoints by default. Logical capacity defaults to 2048 MiB. Limits are configurable; automatic pruning never drops the head or named checkpoints and fails safely when capacity cannot be met.
- **Project management:** new `quiet_line_project` lists history, pins/unpins checkpoints, restores, prunes, branches and exports PNGs or standalone material snapshots. Restore preserves later history until normal retention applies.
- **Old snapshots still work:** import `.qlpaint` / `.qldry` into new projects without modifying sources. Non-project drawing calls remain supported.
- **Transactions and revisions:** SQLite transactions, path containment, exclusive outputs and revision checks protect against failed or concurrent commits. Projects are not unlimited storage or per-stroke undo. See the [project guide](PROJECTS.md).

## 1.2.0 — 2026-11-20

### 中文

- **独立干性材料模式**：显式开启 `dry_media:true`，通过有序 `operations` 在一次调用中切换石墨、炭条、普通橡皮、可塑橡皮和方向性擦揉。也提供 `brush:pencil/charcoal` + `strokes` 绘画简写；两种输入不能同用。
- **材料与接触控制**：支持压力相关沉积、纸齿覆盖、H 至 8B 等级、倾斜／定向侧锋、受限叠加，以及附着与松散材料的区别。普通橡皮移除材料，可塑橡皮偏向提走浮粉；纸擦笔沿路径搬运松散部分，不是整图模糊。
- **独立 `.qldry` 状态**：`save_dry_state` 显式保存，`dry_state` 继续；与油画 `.qlpaint` 不互通。保存原始底图与材料状态，不把预览 PNG 烘焙后重新当材料叠加；新文件保存、有界校验，父目录须已存在。
- **兼容边界**：未启用新模式时，旧笔触与湿油画流程保持原有路径。`base_image` 中的旧像素是受保护底图，擦除与擦揉只影响新干性材料，不能反推原图的纸与炭粉。
- **内置绘画指导**：紧凑的英文指导用于工具描述，覆盖构图、负形、光源、明暗、体积、边缘、排线、侧锋、橡皮／擦揉与油画。鼓励观察输出后继续有目的地修正，不因担心 overworking 过早停笔，同时遵守用户轮数、时间和费用限制，不无限加笔。
- 新增双语[绘画方法与练习](DRAWING.md)及[干性材料指南](DRY-MEDIA.md)，包括字段、顺序操作、状态续画、练习与实现边界。

这是艺术用途的程序材料模型，不是完整物理模拟，也不新增可编辑图层、独立蒙版、任意单笔撤销或自动曲面排线。

### English

- **Opt-in dry materials:** `dry_media:true` with ordered `operations` switches among graphite, charcoal, regular eraser, kneaded eraser and directional smudge within one call. A `brush:pencil/charcoal` + `strokes` shorthand is also available; do not combine the two forms.
- **Material and contact controls:** pressure-dependent deposition, paper-tooth coverage, H through 8B grades, oriented/tilted side contact, bounded accumulation and separate bound/loose material. Erasers remove material, kneaded erasers favor lifting loose powder, and smudge transports the loose component along a path rather than blurring the whole image.
- **Separate `.qldry` snapshots:** explicitly save with `save_dry_state` and continue with `dry_state`; not interchangeable with oil `.qlpaint`. Substrate and material state are retained without baking the preview PNG back into the simulation. Saves are new-file-only with bounded validation; parent directories must already exist.
- **Compatibility boundary:** without the opt-in, legacy strokes and wet oils keep their existing paths. Old pixels in a `base_image` are protected substrate. Erasing and smudging affect new dry material, not an inferred decomposition of the source image.
- **Built-in art guidance:** concise English guidance for the tool description covers composition, negative space, light, values, volume, edges, hatching, side contact, erasing/smudging and oils. It encourages inspecting and purposefully revising outputs instead of stopping prematurely from fear of overworking, while respecting user pass/time/cost limits and never adding marks indefinitely.
- Added bilingual [drawing methods and exercises](DRAWING.md) and [dry-media documentation](DRY-MEDIA.md), covering fields, operation order, saved-state continuation, practice and limitations.

This is a procedural artistic material model, not complete physics. It does not add editable layers, independent masks, arbitrary per-stroke undo or automatic surface-following hatching.

## 1.1.1 — 2026-11-20

### 中文

修复在已有图片上首次使用 `base_image` + `save_state` 时失败的问题。

- **原因**：sharp 解码返回 Node.js `Buffer`，它虽然是 `Uint8Array` 的子类，但湿画快照要求精确的 `Uint8Array` 类型。此前没有在解码边界统一类型，导致快照捕获时报 `Invalid paint state: baseRGBA type/length`，尚未写出 PNG 就已失败。
- **修复**：将可信图片解码结果复制成独立的 `Uint8Array`，不改变像素值，不放宽快照类型校验。
- **新增回归**：通过真实 PNG、JPEG、WebP 文件调用绘画工具，覆盖油画笔和画刀、无新增笔迹的初始快照、非正方形缩放、RGBA/透明度保留、保存后读取与续画、空续画、分步与一次完成的 PNG 一致性，以及原图不被改写。
- 新增快照拒绝 `Buffer` 类型的测试，确保格式校验仍然严格。此前的缺口是底图单元测试仅构造了精确类型的 `Uint8Array`，未覆盖真实解码到工具执行的完整路径。

工具参数及 `.qlpaint` 文件格式未改变。1.1.0 其他正常生成的湿画状态无需迁移。升级后请重新加载插件；如果当前 DSH 进程仍运行缓存代码，请重启 DSH。

### English

Fixed initial `base_image` + `save_state` failing on existing images.

- **Cause:** sharp returns a Node.js `Buffer`. Although it subclasses `Uint8Array`, wet-state snapshots require the exact `Uint8Array` type. The mismatch caused `Invalid paint state: baseRGBA type/length` during capture, before PNG output was written.
- **Fix:** copy trusted decoded RGBA into an owned, exact `Uint8Array` at the decoder boundary, preserving pixel values and keeping strict snapshot validation intact.
- **Regression coverage:** real PNG/JPEG/WebP files through the actual tool handler, oil and palette knife, empty initial snapshots, non-square resizing, RGBA/alpha preservation, save/load/resume, empty resumes, split/single PNG equality and unchanged source files.
- Added a negative test that snapshots still reject `Buffer` values. Earlier base-state unit tests used synthetic exact `Uint8Array` data and missed the real decoding-to-tool boundary.

No tool parameter or `.qlpaint` format changes. Previously valid 1.1.0 snapshots need no migration. Reload the plugin after upgrading; restart DSH if its process still uses cached plugin code.
