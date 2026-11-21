# 1.1.0 — 笔触控制与湿画快照

本轮优先完成四项：逐点控制、旋转扁平刷、边缘与流量、跨调用湿画状态。旧参数仍有效；不提供完整绘画编辑器。

需要反复续画但不想散落许多快照时，优先使用新的[单文件工程](PROJECTS.md)：自动历史、命名检查点、回退、分支和导出。本文的独立 `.qlpaint` 方式保持兼容。

For iterative work without scattered snapshots, prefer [single-file projects](PROJECTS.md). Standalone `.qlpaint` snapshots below remain supported.

## 笔宽与薄涂 / Width and thin paint (1.4.0)

- 所有画笔的 `strokes[].width` 与干性 `operations[].width` 均为 **0.1..30**，是宽度倍率而非像素。`weight` 仍为 **1.5..4.5**；逐点 `controls[].width` 仍为 **0..3**，是叠乘的局部倍率，不是整体宽度字段。
- 不能把“100 像素宽”直接写成 `width:100`。实际接触还受短边尺寸、笔种、压力、侧锋和收尖影响，按当前工具字段说明选择倍率；大色面用合规宽笔或重叠铺色，非干性模式也可用 `fills`。不要只用密密麻麻的细线填满。
- 油画薄涂可用较低笔触 `opacity` 与克制的 `impasto` 近似，按需要降低 `load`；这是视觉上的低不透明度／薄颜料，不是溶剂、黏度或化学稀释。低 `load` 会较早耗尽颜料，可能只留下起点刷痕／干刷而非完整连续色带；需要连续薄涂时保留足够负载，主要降低 `opacity`／`impasto`。多次湿叠仍可能累积覆盖与混色，`opacity` 不是整个区域永远不超过的透明度上限。
- 旧合法笔宽仍走原有渲染路径；新宽笔使用与接触尺度相适应的采样。大画布、多宽笔仍然更昂贵，并不保证恒定耗时。

All brushes accept stroke width **0.1..30**, matching dry-operation width. It is a multiplier, not a pixel diameter. `weight` remains **1.5..4.5**; `controls[].width` remains a separate local **0..3** multiplier. Contact also depends on canvas scale, brush, pressure, tip and taper. Use valid broad marks or overlapping passes; non-dry modes may use fills. Low stroke `opacity` and restrained `impasto`, with `load` reduced when useful, approximate thin paint visually, not solvent physics. Low `load` can run dry early, leaving an initial dab or dry-brush trace rather than a continuous band; for continuous thin passages keep enough load and mainly lower opacity/impasto. Repeated overlap can still accumulate coverage and mix paint. Wider strokes have scale-aware sampling; large canvases and many broad marks still cost more.

## 逐点控制

每条 stroke 的 `controls` 与 `points` 一一对应，各对象字段均可省略：

| 字段 | 范围 / 默认 | 含义 |
| --- | --- | --- |
| pressure | 0..1 / 1 | 接触压力；0 为抬笔，不沉积 |
| width | 0..3 / 1 | 局部宽度倍率，乘 stroke.width；0 为无宽度 |
| opacity | 0..1 / 1 | 局部沉积强度，乘 stroke.opacity；不是整笔最终透明度上限 |
| angle | -360..360 / stroke.angle 或 0 | 扁平刷长轴相对画布的角度；0 向右，90 向下 |
| tilt | 0..1 / stroke.tilt 或 0 | 倾斜铺开程度，增大扁平刷短轴接触面积 |

压力、宽度、透明度和倾角按源线段的像素弧长连续插值；角度走最短旋转路径。油画会对几何圆滑切角以避免锐折，属性锚点随几何移动，但压力等属性数值本身不被平均，不强行穿过原始尖角。需要在某区域完全断开时，在该区域两端均设 pressure:0；单个零点只在该点抬起后立即重新落下。要精确定位端头，使用 wobble:0、pressure:0（关闭自动压力起伏）、overshoot:0；本轮控制是可预测的程序笔触，不是数位板硬件采样。

```json
{
  "brush":"oil", "surface":"linen", "seed":623,
  "size":640, "wobble":0, "pressure":0, "weight":4,
  "save_state":"quiet-line-out/study-1.qlpaint",
  "strokes":[{
    "points":[[0.15,0.5],[0.4,0.4],[0.65,0.55],[0.85,0.4]],
    "controls":[
      {"pressure":0,"angle":0},
      {"pressure":1,"angle":35,"tilt":0.4},
      {"pressure":0.65,"angle":80,"width":0.6},
      {"pressure":0,"angle":120}
    ],
    "tip":"flat", "aspect":0.3, "hardness":0.55, "flow":0.8,
    "cap":"taper", "overshoot":0, "width":3, "color":"#b6402c"
  }]
}
```

## 扁平刷、软硬边和流量

stroke 可增加 `tip:"round"|"flat"`、`aspect:0.05..1`（默认0.3）、`angle`、`tilt`、`hardness:0..1`、`flow:0..1`、`cap:"round"|"flat"|"taper"`。

- 油画与画刀：tip/angle/tilt 改变实际定向接触面。扁平刷采用椭圆细丝束，不是矩形贴图；倾角是接触形状近似，不是三维笔杆物理。
- hardness 改变边缘沉积衰减，不等于 grain；flow 控制每次接触沉积，不等于 load。load 是笔内携带颜料并随行程消耗。
- 非油画支持 pressure/width/opacity/flow/cap；不模拟 tip/angle/tilt/hardness。非油画透明度按短几何段近似，自交仍正常叠色。
- 新字段启用新的受控沉积分支，保留湿混色、取色、耗料、纸齿、厚度。并未照搬旧分支全部末端飞白、fringe 和 scrape 特效。无新字段时使用旧渲染路径。

## 湿画状态：与 base_image 不同

`save_state` 显式保存 `.qlpaint` 新文件，`paint_state` 恢复。仅 oil/oilknife；PNG 用于查看，状态文件用于继续湿画。不要把 PNG 当作湿状态文件。

```json
{
  "paint_state":"quiet-line-out/study-1.qlpaint",
  "save_state":"quiet-line-out/study-2.qlpaint",
  "output":"quiet-line-out/study-2.png",
  "strokes":[{
    "points":[[0.5,0.2],[0.5,0.8]],
    "color":"#326b87", "width":3, "tip":"flat", "angle":80
  }]
}
```

- 恢复原始纸底/透明底、premultiplied ink、湿颜料颜色、覆盖、厚度、干燥序号、干层拾色缓冲、纸齿、笔画随机种子偏移；不会把上一张 PNG 再叠一遍。
- 尺寸、brush、surface、seed、grain 固定并继承；不允许恢复时调整这些属性。weight/wobble/pressure/原始texture/wetness/impasto/load/accent 也被保存为续画默认值，可调整其中非固定属性。
- 文件为带版本、严格校验的压缩二进制快照，不包含可执行对象。上限每轴1800像素，状态文件与解压数据上限192 MiB。大画布会有较高瞬时内存需求。
- 输出在当前工作目录内，父目录需已存在；状态文件不覆盖旧文件。PNG 续画也另存。保存失败时已生成的 PNG 可能仍存在，可换一个状态文件名重试。
- `base_image` 仍用于在普通 PNG/JPEG/WebP 上干叠画；可在此基础上首次 save_state，但无法从原图逆向恢复旧湿料。
- 不能把 paint_state 与 base_image 或 subject 同时提供。只恢复、不加 marks 可以导出该节点的 PNG。

### 回退、分支与未实现部分

保留 study-1、study-2 等快照，重新从 study-1 续画可做**调用级回退与分支**。没有分层模型、独立蒙版、局部擦除或任意单笔撤销；快照不是可编辑图层。湿度按笔画序号演化，不按现实墙钟时间挥发。

## 性能与验证

新增笔触只扫描该笔采样和接触区域，不重放已有笔画。显式保存/读取状态、PNG 输出与最终展示解析有画布大小相关的固定成本，不能把跨调用整张图导出称为 O(单笔面积)。快照仅在 save_state 请求时复制/编码。

运行：`node tests/controls.cjs`、`node tests/state.cjs`、`node tests/integration.mjs`。设置 QUIET_LINE_BASELINE 为1.0.19包目录，可比较8种旧画笔输出字节。`node examples/control-benchmark.cjs` 比较完成不同笔数后的相同受控笔触成本；计时为诊断，不是机器无关性能保证。
