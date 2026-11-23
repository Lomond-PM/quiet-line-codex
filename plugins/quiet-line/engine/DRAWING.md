# 绘画方法 / Drawing with intention

[README](README.md) · [干性材料 / Dry media](DRY-MEDIA.md) · [旧笔触与湿画 / Legacy strokes and wet painting](CONTROL.md)

工具负责落笔，模型负责观察、取舍与构图。以下技巧与练习可按创作意图和用户要求取用，也可尝试其他画法。

The renderer makes marks and the model makes visual decisions. Choose among the techniques and exercises below according to the artistic intent and the user's requirements.

**让视觉目标决定笔触尺度与密度。**

Choose stroke scale and density according to artistic intent. Use broad strokes for large masses and smaller, varied strokes wherever they improve form, texture, depth, or expression.

## 1. 构图与细节 / Composition and detail

**中文**

- 画幅、主体位置、观看方向和视觉重心可通过大形试排，也可以从眼睛、树叶或杯沿的局部出发，再向外发展画面。
- 比较外接形的高宽、主要轴线、相邻形之间的距离；检查负形，例如手臂与躯干之间、树枝与天空之间的空隙。
- 对比、边缘和细节密度既可以集中在一个或多个焦点，也可以分布在整个画面。
- 对于写生与参考图，可以随时回看对象或图像。描述参考时，只报告实际看过的内容。

**English**

- Explore format, subject placement, direction and balance by blocking shapes or by developing the picture from a local detail such as an eye, a leaf or a cup rim.
- Compare bounding-box proportions, main axes, intervals and negative spaces: the gap beside an arm or the sky between branches can reveal an error faster than a detail.
- Contrast, edge clarity and density of detail can create one or several focal areas or draw attention across the picture.
- Refer back to the subject or image as useful. Describe only the references you actually inspected.

### 构图与透视检查 / Composition and perspective checks

**中文**

- 缩略图可用于检查画幅、裁切、主体占比、留白、视觉重心、前中后景和对比，也能帮助区分刻意安排的相切、切边和紧凑边距与意外效果。
- 画面采用线性透视时，视点、视平线与透视类型可用于检查方向关系。同方向的平行线共用消失点，消失点可以在画外。不同朝向的物体可以有不同消失点组。方盒、圆柱、轴线和临时辅助线都可用于校验。
- 相对尺度、遮挡、缩短、接触关系与椭圆轴向都是处理空间的线索。正交、平面化和夸张透视也能表达不同的空间关系。

**English**

- A thumbnail can help assess crop, subject scale, negative space, balance, depth and contrast, as well as how tangencies, cut-off edges and tight margins read.
- When using linear perspective, viewpoint, eye level, horizon and projection can help check directions. Parallel directions share vanishing points, which may be off-canvas. Differently oriented objects can use different vanishing-point sets. Boxes, cylinders, axes and temporary guides are available checks.
- Relative scale, overlap, foreshortening, contact and ellipse orientation can help shape space. Orthographic, flat and deliberately distorted treatments offer other spatial effects.

## 2. 用光组织体积 / Organize volume with light

**中文**

- 需要用光表现体积时，可以考虑光源的位置、方向和大小，以及它们对受光面、投影方向和边缘软硬的影响。
- 亮面、中间调、形体暗面、投影和接触暗部可按画面的明度结构选择、合并或细分。球面上的渐变、盒体平面之间的边界和轮廓线都可表现体积。
- 反光可提亮暗面，投影落点和接触暗部可表现物体与表面的关系。漫反射受光取决于光向与表面朝向，镜面高光还受视线、材质和粗糙度影响。

**English**

- When using light to describe volume, consider how light position, direction and size affect lit planes, cast shadow direction and edge softness.
- Lights, midtones, form shadows, cast shadows and contact accents can be selected, grouped or subdivided according to the picture. Gradients on a sphere, plane changes on a box and contours can all convey form.
- Reflected light can lift a shadow. Cast shadows and contact accents can help describe how objects meet a surface. Diffuse illumination depends on light and surface orientation. Specular highlights also depend on the view and on material roughness.

## 3. 铅笔与炭笔 / Graphite and charcoal

**中文**

- 轻线可以用来试形，侧锋可以铺出宽调子。密集线条或点状笔迹同样可以组织调子、纹理和节奏。
- 排线的间距、方向、长度、压力和交叉层数可以表现体积，也可以服务于平面图案和表现力。
- 铅笔硬度影响沉积。硬铅适合较浅的笔迹，软铅可加深调子。炭笔留下可擦揉的浮粉。
- 纸擦笔会搬运浮粉并软化笔迹。擦揉范围取决于希望保留的结构边、排线或过渡效果。
- 可塑橡皮用于逐渐提亮和找形；普通橡皮用于更明确的修正。提亮是移走已建模材料，不是往纸上盖白漆。
- 新干性材料流程使用 `dry_media:true` 与有序 `operations`。旧 `brush:pencil/charcoal` + `strokes` 仍是风格化线条路径；旧路径没有因为新功能而自动获得材料擦除、侧锋接触或浮粉搬运。

**English**

- Light lines can test shapes and side contact can create broad tones. Dense lines or dots can also build tone, texture and rhythm.
- Hatching spacing, direction, length, pressure and cross-hatching layers can describe form or serve a flat pattern or expressive effect.
- Graphite grade affects deposition. Hard grades can make lighter marks and soft grades can deepen tones. Charcoal leaves loose powder that can be smudged.
- Smudging moves loose powder and softens marks. Its extent depends on the edges, hatching and transitions you want in the picture.
- Use kneaded erasers to lift gradually and regular erasers for firmer corrections. Lifting removes modeled material; it does not paint white over the paper.
- Use `dry_media:true` and ordered `operations` for the material workflow. Legacy `brush:pencil/charcoal` with `strokes` remains the stylized path; it does not automatically gain material erasing, side-tip contact or powder transport.

## 4. 油画与边缘 / Oils and edge control

**中文**

大色块、小笔触、软硬边、薄涂和厚涂都可按画面需要搭配。顺形笔触与虚实边缘能帮助组织空间，逆向笔触、均匀厚涂或遍布全图的细节也可用来表现纹理、节奏和光感。

未干油彩与新笔触交叠时会拾色和混色。干化后再画可以让后续笔触的颜色保持独立。画刀角度影响接触与拖带。有 `.qlproject` 或 `.qlpaint` 可续画湿油彩，导入的 PNG 则作为固定底图。

**English**

Large colour masses, small marks, hard and soft edges, thin passages and impasto can be combined as the picture needs. Strokes that follow the form and edges that merge into adjacent values can shape space. Cross-form marks, even impasto and detail across the picture can serve texture, rhythm or light.

Wet overlap picks up and mixes pigment. Drying allows subsequent strokes to retain their own colour. Palette-knife orientation affects contact and drag. A `.qlproject` or `.qlpaint` retains the wet state for continuation. An imported PNG is a fixed base.

### 借鉴真实作画，不固定范式 / Borrow practice, not a rigid recipe

**中文**

可参考：构图与透视 → 轻线起型／单色底稿 → 明暗与投影的大关系 → 大色块、冷暖与色彩结构 → 转面、边缘、材质与少量重点细节。油画可以先用炭笔起型，或以低不透明度、低 `load`、较薄的笔触近似稀释油彩，再铺更实的色面与局部厚涂。这是视觉上的薄涂近似，没有溶剂或化学稀释模拟。低 `load` 会提前耗尽颜料；需要连续薄涂时保留足够负载，主要降低 `opacity`／`impasto`，不要把低负载等同于均匀稀释。

流程只是脚手架：可合并、跳过、调整顺序、回头改构图，也可直接画法或使用更适合题材的方法。不是每张图都必须有底稿、必须分六轮，或必须先完成一张素描。不要把遵守工序当作画面已经成立。

同一工程通过 `brush` 选择下一轮笔刷，通过 `operations` 擦除、擦揉或添加干性材料。已有干性笔迹和油彩状态会保留，便于后续回到原材料继续画。需要保存画面某个重要版本时，可设命名检查点。详见[工程指南](PROJECTS.md)。

**English**

One useful scaffold is composition/perspective → light construction or tonal underpainting → broad light/shadow masses → large colour planes and warm/cool structure → form, edges, materials and selective accents. Oils may start from charcoal construction or low-opacity, low-`load`, thin paint approximating a diluted block-in, then fuller colour and selective impasto. This is visual dilution, not solvent chemistry. Low `load` can run dry early; for continuous thin passages retain enough paint and mainly lower opacity/impasto instead of treating low load as uniform dilution.

Combine, skip, reorder or revisit stages; direct painting or another method may suit the subject better. Neither a separate drawing nor six tool calls is compulsory. Ritual completion is not visual success.

Select the brush for the next pass with `brush`. Use `operations` to erase, smudge, or add dry pigment. Existing oil and dry pigment remain available across brush changes. Pin a checkpoint when you want to retain a version of the complete painting. See the [project guide](PROJECTS.md).

## 5. 看结果，再有目的地继续 / Inspect, decide, continue

**中文**

预览可以帮助判断某轮处理对画面的影响。修正的顺序、范围和轮数取决于作品目标及用户指定的限制。

可以考虑：

1. 实际查看刚生成的图片（当前环境可查看时）；若无法查看，明确说明限制，不要假称已完成视觉检查。
2. 根据预览辨别需要修改的地方，例如主体占比、暗部结构、边缘或纹理。
3. 为每个差距安排具体操作，再输出检查；保护已经奏效的区域。
4. 保存合适的干画或湿画节点，需要时从旧节点分支。PNG 适合展示，材料状态适合继续编辑。
5. 按用户要求判断完成度，遵守用户给出的轮数、调用次数、时间或费用限制。

**English**

A preview can show how a pass affects the picture. Choose the order, scope and number of revisions according to the artistic goal and the constraints the user sets.

Options include:

1. Actually inspect the rendered image when the environment permits it. If unavailable, state that limitation rather than claiming visual verification.
2. Identify what the preview suggests changing, such as subject scale, shadow structure, edges or texture.
3. Make specific corrections, render and inspect again. Protect areas that already work.
4. Save appropriate dry or wet checkpoints and branch when useful. PNGs show the image; material states preserve its editable simulation.
5. Assess completion against the user's request and honor any pass, call, time or cost limits they set.

## 6. 三个练习 / Three exercises

以下步骤是各练习的示范，可按需要调整。Each exercise illustrates one possible approach that you can adapt.

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
