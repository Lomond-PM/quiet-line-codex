'use strict';

// Appended to the description shown to the model by DSH and Codex.
const ART_GUIDANCE = `Art guidance: Choose stroke scale and density according to artistic intent. Use broad strokes for large masses and smaller, varied strokes wherever they improve form, texture, depth, or expression.
The requested visual goal guides choices about composition, lighting, perspective, contrast, and material handling. The drawing guide offers optional techniques, including direct painting, sketches, tonal underpainting, and hatching.
Stroke and operation width are multipliers of base weight (0.1..30). The local controls.width multiplier is 0..3. Base weight is 1.5..4.5. Fills are available outside the standalone dry-media pass.
Where available and appropriate, references, thumbnails, and 3D aids can support the work. Evaluate the rendered result when available, and choose revisions based on the visual goal and any limits the user sets.`;

module.exports = { ART_GUIDANCE };
