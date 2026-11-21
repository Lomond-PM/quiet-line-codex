# 绘画方法 / Drawing with intention

[README](README.md) · [干性材料 / Dry media](DRY-MEDIA.md) · [旧笔触与湿画 / Legacy strokes and wet painting](CONTROL.md)

工具负责落笔，模型负责观察、取舍与构图。这份指南是工作方法，不是要求每张图套用一种画风；用户的题材、审美、时间与费用限制始终优先。简短英文指导由 [art-guidance.cjs](lib/art-guidance.cjs) 导出，供工具描述使用；这里展开说明。

The renderer makes marks; the model makes visual decisions. These are working methods, not a mandatory style. The user's subject, taste, time and cost limits take precedence. A short English version is exported by [art-guidance.cjs](lib/art-guidance.cjs) for the tool description; this document provides the fuller practice guide.

## 1. 先安排画面 / Compose before detailing

**中文**

- 先确定画幅、主体位置、观看方向和重心。用一两块大形概括，而不是从眼睛、树叶或杯沿开始。
- 比较外接形的高宽、主要轴线、相邻形之间的距离；检查负形，例如手臂与躯干之间、树枝与天空之间的空隙。
- 选一个视觉焦点。最高对比、最清晰的边缘和最密的细节不必遍布全图。
- 对写生或参考图，先观察再落笔；对想象画，先决定最重要的关系。不要假装看到了未实际查看的图片。

**English**

- Choose the format, subject placement, direction and visual balance. Block one or two large silhouettes before drawing eyes, leaves or cup rims.
- Compare bounding-box proportions, main axes, intervals and negative spaces: the gap beside an arm or the sky between branches can reveal an error faster than a detail.
- Choose a focal point. Reserve the strongest contrast, sharpest edges and richest detail rather than distributing them everywhere.
- Observe an available reference before drawing. For imagined work, decide the essential relationships first. Do not claim to have inspected an image you have not viewed.

### 构图与透视检查 / Composition and perspective checks

**中文**

- 把构图当成持续检查项：画幅与裁切、主体占比、留白、视觉重心、前中后景、主次对比。缩小看大剪影与明暗块，先改主体过小、重心失衡或背景抢戏，再画纹理；避免无意的切边、相切和拥挤边距。
- 空间场景先明确视点、视平线和透视类型。同方向的平行线应共用消失点，消失点可以在画外；不同朝向的物体可以有不同消失点组，但须服从同一视点。用方盒、圆柱、轴线或临时辅助线校验，再细化。
- 检查近大远小、遮挡次序、缩短、桌面与地面接触、椭圆开合和轴向。不要用漂亮的纹理掩饰结构错误。正交、平面化和夸张透视都可选择，但应出于表达，而不是无意漂移。

**English**

- Recheck format/crop, subject scale, negative space, balance, depth planes and contrast hierarchy throughout. Read silhouettes and value masses at thumbnail size. Correct weak placement before texture; avoid accidental tangencies and cramped margins.
- Establish viewpoint, eye level/horizon and projection. Parallel directions share vanishing points, which may be off-canvas. Differently oriented objects may use different vanishing-point sets under the same view. Test with boxes, cylinders, axes or temporary guides.
- Check relative scale, overlap, foreshortening, ground contact and ellipse orientation/openness. Texture cannot repair construction. Orthographic, flat and deliberately distorted styles are valid intentional choices.

## 2. 用光组织体积 / Organize volume with light

**中文**

1. 先定一个主光源；投影方向和受光面应彼此一致。
2. 用三到五组明暗概括：亮面、中间调、形体暗面、投影，必要时单列最深接触暗部。
3. 让笔触解释平面朝向与转折。球面是逐渐转暗，盒体可有明确明暗交界，不能都只用一圈深轮廓。
4. 暗部的反光可以比核心暗部亮，但通常不应抢过受光面的整体亮度。
5. 检查投影的落点与接触暗部，物体才像放在桌面上，而不是浮在背景前。
6. 区分漫反射受光与镜面高光：亮面由光向与表面朝向组织，高光还取决于视线、粗糙度与材质。不要给每个物体随意点同一颗白点。主光源方向与大小也应和投影方向、软硬相符。

**English**

1. Establish one principal light; lit planes and cast shadows should agree.
2. Block three to five value families: light, middle tone, form shadow, cast shadow and, if needed, the darkest contact accents.
3. Let marks explain planes and turning surfaces. A sphere turns gradually; a box can change value abruptly. Neither needs an equally dark outline everywhere.
4. Reflected light may lift a shadow without breaking the larger light/shadow separation.
5. Place cast shadows and contact accents convincingly so objects sit on a surface rather than float.
6. Distinguish diffuse illumination from specular highlights: lit planes depend on light and surface orientation; highlights also depend on view and roughness/material. They are not an arbitrary white dot on every object. Light direction and size should agree with cast-shadow direction and softness.

## 3. 铅笔与炭笔 / Graphite and charcoal

**中文**

- 起形用轻线，先纠正比例；铺大灰面用侧锋，不必用成百上千条同样粗细的线填满。
- 排线沿体积走；通过间距、方向、长短、压力和交叉层数组织灰度，而不是把噪点等同于素描质感。
- 硬铅用于克制的细线，软铅用于较深、较宽的调子。炭条适合大暗面和可擦揉浮粉，不能只当作更粗的铅笔。
- 纸擦笔只软化需要软化的地方。保留一些明确的结构边、转折和新鲜排线，避免把一切揉成均匀的灰雾。
- 可塑橡皮用于逐渐提亮和找形；普通橡皮用于更明确的修正。提亮是移走已建模材料，不是往纸上盖白漆。
- 新干性材料流程使用 `dry_media:true` 与有序 `operations`。旧 `brush:pencil/charcoal` + `strokes` 仍是风格化线条路径；旧路径没有因为新功能而自动获得材料擦除、侧锋接触或浮粉搬运。

**English**

- Start lightly and correct proportions. Use side strokes for broad values instead of filling every area with hundreds of identical lines.
- Hatch along the form. Vary spacing, direction, length, pressure and cross-hatching layers to organize tone; random noise alone is not convincing drawing texture.
- Hard graphite suits restrained fine marks; softer grades support darker, broader passages. Charcoal has a distinct broad, loose-powder character, not merely a thicker pencil line.
- Smudge selectively. Retain structural edges, turning points and some fresh hatching instead of rubbing everything into uniform fog.
- Use kneaded erasers to lift gradually and regular erasers for firmer corrections. Lifting removes modeled material; it does not paint white over the paper.
- Use `dry_media:true` and ordered `operations` for the material workflow. Legacy `brush:pencil/charcoal` with `strokes` remains the stylized path; it does not automatically gain material erasing, side-tip contact or powder transport.

## 4. 油画与边缘 / Oils and edge control

**中文**

先铺大色块与明暗，不要让颜色细节掩盖结构。顺形用笔，以软硬边和虚实变化组织空间；背景与暗部可以适度丢边，焦点处再明确。薄涂、较实的色块、少量厚涂高光可以形成层次，不必全画面堆厚。

未干交叠会拾色混色：利用它连接相近色；需要干净亮色时，减少无目的来回搅动。画刀不是万能锐化器，它的定向接触和拖带也应服务于形体。油画续画使用 `.qlpaint` 湿画状态；不要把一张 PNG 当作尚未干的颜料状态。

**English**

Establish large colour and value masses before small colour variations. Follow the form with directional strokes and vary hard, soft and lost edges. Lose some boundaries into adjacent values; clarify the focal area. Contrast thin passages, more solid masses and selective impasto highlights rather than loading every inch equally.

Wet overlap picks up and mixes pigment: use it to connect related colours, but avoid aimless stirring when a clean light is needed. A palette knife is not a universal sharpening filter; its orientation and drag should describe the subject. Continue wet oils from `.qlpaint`, not from the flattened pixels of a PNG.

### 借鉴真实作画，不固定范式 / Borrow practice, not a rigid recipe

**中文**

可参考：构图与透视 → 轻线起型／单色底稿 → 明暗与投影的大关系 → 大色块、冷暖与色彩结构 → 转面、边缘、材质与少量重点细节。油画可以先用炭笔起型，或以低不透明度、低 `load`、较薄的笔触近似稀释油彩，再铺更实的色面与局部厚涂。这是视觉上的薄涂近似，没有溶剂或化学稀释模拟。低 `load` 会提前耗尽颜料；需要连续薄涂时保留足够负载，主要降低 `opacity`／`impasto`，不要把低负载等同于均匀稀释。

流程只是脚手架：可合并、跳过、调整顺序、回头改构图，也可直接画法或使用更适合题材的方法。不是每张图都必须有底稿、必须分六轮，或必须先完成一张素描。不要把遵守工序当作画面已经成立。

同一工程用 `project_material:"dry"` 与 `project_material:"wet"` 显式切换材料；同模式续画保留原模拟状态，跨模式把当前图像固定成下一阶段底图。固定后的旧炭笔不能在新湿画阶段直接擦除；可恢复或分支到历史干画步骤重新调整。重要切换前保存命名检查点。详见[工程指南](PROJECTS.md)。

**English**

One useful scaffold is composition/perspective → light construction or tonal underpainting → broad light/shadow masses → large colour planes and warm/cool structure → form, edges, materials and selective accents. Oils may start from charcoal construction or low-opacity, low-`load`, thin paint approximating a diluted block-in, then fuller colour and selective impasto. This is visual dilution, not solvent chemistry. Low `load` can run dry early; for continuous thin passages retain enough paint and mainly lower opacity/impasto instead of treating low load as uniform dilution.

Combine, skip, reorder or revisit stages; direct painting or another method may suit the subject better. Neither a separate drawing nor six tool calls is compulsory. Ritual completion is not visual success.

Use `project_material:"dry"` / `project_material:"wet"` to explicitly change a project's active medium. Same-mode continuation keeps its simulation; a switch fixes the current image as the next phase's base. Old charcoal is not directly erasable in the new oil phase; restore or branch to its retained dry step to revise it. Name important checkpoints before switching. See the [project guide](PROJECTS.md).

## 5. 看结果，再有目的地继续 / Inspect, decide, continue

**中文**

不要因为担心 “overworking／画过头” 就过早停笔。作品往往需要几轮明确的修正：比例、明暗分组、体积、边缘，最后才是细节。多画几轮本身不是问题；没有观察和目标地反复加笔才是问题。

每轮尽量遵循：

1. 实际查看刚生成的图片（当前环境可查看时）；若无法查看，明确说明限制，不要假称已完成视觉检查。
2. 只选一到三个最影响画面的差距，例如“主体偏小”“暗部太碎”“焦点边缘不够清晰”。
3. 为每个差距安排具体操作，再输出检查；保护已经奏效的区域。
4. 保存合适的干画或湿画节点，需要时从旧节点分支。PNG 适合展示，材料状态适合继续编辑。
5. 用户要求已经满足就停下；用户指定了轮数、调用次数、时间、费用或完成度时，始终以此为界。不无限循环，不为堆笔数而加笔。

**English**

Do not stop prematurely merely from fear of overworking. Several focused revisions can improve proportions, value grouping, volume and edges before details. More passes are not inherently a problem; unobserved, purposeless repetition is.

For each pass:

1. Actually inspect the rendered image when the environment permits it. If unavailable, state that limitation rather than claiming visual verification.
2. Choose one to three important mismatches, such as a small subject, fragmented shadows or an unclear focal edge.
3. Make specific corrections, render and inspect again. Protect areas that already work.
4. Save appropriate dry or wet checkpoints and branch when useful. PNGs show the image; material states preserve its editable simulation.
5. Stop when the request is satisfied or the user's pass, call, time, cost or detail limits are reached. Never loop indefinitely or add strokes just to increase a count.

## 6. 三个练习 / Three exercises

### A. 三明度球体 / Three-value sphere

**中文：** 选择暖纸与左上光。轻画外形，分亮面、中间调、暗面；加一块落在右下的投影。第二轮沿球面排线，把接触暗部压实；第三轮只修比例、软化转面并用橡皮提一处高光。缩小看时仍应读成球，而不是一个涂灰的圆。

**English:** On warm paper, choose upper-left light. Block a sphere into light, middle and dark, with a cast shadow to the lower right. On pass two, hatch around the form and strengthen contact accents. On pass three, correct proportions, soften the turn and lift one highlight. At thumbnail size it should read as a sphere, not a grey disc.

### B. 炭笔布料／石块 / Charcoal cloth or stone

**中文：** 用侧锋概括两三块大灰面，以炭条加核心暗部。只在转面处沿形擦揉，保留一两条硬边；用可塑橡皮提出受光棱线。检查最暗、最亮和边缘变化是否集中在你想强调的位置。

**English:** Block two or three broad values with side strokes, then establish core darks in charcoal. Smudge along selected turning planes while retaining a few hard edges. Lift lit ridges with a kneaded eraser. Check that the extremes and edge changes support your intended emphasis.

### C. 限色油画小景 / Limited-palette oil study

**中文：** 先定冷暖关系和三块主色，不急着画树叶。第二轮调整天空、地面和主体的明度比例，第三轮再放少量厚涂亮点。每轮都比较整体；不因担心画过头而放弃仍明显需要的修正，也不因尚有调用预算而硬添细节。

**English:** Choose a warm/cool relationship and three main colour masses before drawing leaves. On pass two, adjust the sky/ground/subject value balance; on pass three, add selective loaded highlights. Compare the whole at every stage. Do not abandon a clear improvement from fear of overworking, or invent extra details just because calls remain.

## 7. 外部参考与三辅二 / References and 3D-to-2D aids

**中文**

必要且环境允许时，可以借助照片、参考图、构图缩略图或三辅二流程：以简单三维体块搭景，明确相机、视平线、焦距／投影、主体尺度及灯光，渲染剪影、灰模明暗、深度或法线辅助图，再据此绘画。对建筑、室内、复杂姿势或强透视尤其有用，但不要求每张图都建模。

必须实际查看辅助图，核对它与最终构图的视点、比例、裁切和光照是否一致。法线／深度图用于理解结构，不直接当作最终颜色；参考关系而不是盲目描摹，也不偷偷用三维渲染或外部生成图替代用户要求的手绘过程。是否采用底图由任务决定，导入为底图后只是固定像素。遵守参考素材的权限、隐私、署名及用户约束；需要付费服务、上传素材或安装软件时取得相应授权。辅助工具不可用时，用现有画具中的简单形体与辅助线即可，不虚称已建模或已看图。

**English**

When useful and available, use photos, references, thumbnails or a 3D-to-2D workflow: block simple volumes, choose camera/horizon/focal length or projection, scale and lighting, then render silhouette, clay-value, depth or normal references. This can clarify architecture, interiors, complex poses and strong perspective; modeling is optional, not required for every picture.

Actually inspect aids and match viewpoint, proportions, crop and light. Depth/normals explain structure, not final colour. Interpret rather than blindly trace, and never silently substitute a render or externally generated image for requested painting. A reference may stay beside the canvas; importing it as a base fixes its pixels. Respect permissions, privacy, attribution and user constraints, obtaining authorization where required for paid services, uploads or installation. If aids are unavailable, use simple construction marks instead; do not claim unseen references or nonexistent modeling.

## 边界 / Limits

这些是可控、可重复的程序近似，不是石墨光泽、纸纤维磨损、炭粉颗粒碰撞或真实油彩流变的完整物理模型。画得是否有说服力，仍取决于观察、构图和每一轮的取舍。不同状态格式不能互换，也不是图层、蒙版或任意单笔撤销系统。

These are controllable, repeatable procedural approximations, not full physics of graphite sheen, fibre wear, colliding charcoal particles or paint rheology. Convincing results still depend on observation, composition and decisions between passes. State formats are not interchangeable and do not constitute layers, masks or arbitrary per-stroke undo.
