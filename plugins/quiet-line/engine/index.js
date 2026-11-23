/**
 * Quiet Line — a model-facing hand-drawn illustration board for DSH.
 *
 * The tool renders one of six richer hand-drawn studies, or a custom
 * composition made of strokes, filled washes and dots, to a PNG. It
 * writes the image under the session working directory and attaches
 * the rendered image to the tool result so the agent and the user can
 * see it.
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CORE = require('./lib/core.cjs');
const RASTER = require('./lib/raster.cjs');
const { loadBaseImage, writeDrawing } = require('./lib/base-image.cjs');
const { loadPaintState, savePaintState } = require('./lib/paint-state.cjs');
const DRY_TOOL = require('./lib/dry-tool.cjs');
const PROJECT_TOOL = require('./lib/project-tool.cjs');
const { ART_GUIDANCE } = require('./lib/art-guidance.cjs');

export const name = 'quiet-line-board';
export const inject = ['tools', 'workingDirectory'];

const SUBJECTS = ['morning', 'sprig', 'cup', 'cat', 'house', 'hills'];
const SUBJECT_LABELS = {
  morning: 'Morning (sun over a field)',
  sprig: 'Sprig (potted cutting)',
  cup: 'Still Warm (tea and saucer)',
  cat: 'Small Cat (seated, wearing a scarf)',
  house: 'Home, Roughly (garden scene)',
  hills: 'Two Hills (layered landscape)'
};
const BRUSH_IDS = Object.keys(CORE.BRUSHES);
const SURFACE_IDS = Object.keys(CORE.SURFACES);
const BRUSH_LABELS = {
  ink: 'solid ink pen',
  fountain: 'fine, crisp fountain pen',
  pencil: 'soft graphite pencil',
  charcoal: 'dry, smudged charcoal',
  brush: 'dense brush with bristle streaks',
  marker: 'flat, translucent marker',
  oil: 'loaded oil brush with impasto ridges',
  oilknife: 'flat palette knife with a hard paint edge'
};
const SURFACE_LABELS = {
  warm: 'warm white paper',
  coldpress: 'cold-press watercolor paper',
  kraft: 'toothed kraft paper',
  linen: 'woven linen canvas',
  newsprint: 'cool newsprint',
  charcoal: 'dark charcoal paper'
};
const TONES = ['ink', 'accent', 'clay', 'ochre', 'sage'];

const POINT = {
  type: 'array',
  items: { type: 'number' },
  description: 'A [x, y] pair in normalized canvas space (0..1, y down; -0.2..1.2 is allowed for a deliberate bleed).'
};

const STROKE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    points: {
      type: 'array',
      items: POINT,
      description: 'Ordered points of the line. Two points make a straight stroke; more make a hand-drawn curve.'
    },
    color: { type: 'string', description: 'ink, accent, clay, ochre, sage, or a #rrggbb value. Default ink.' },
    width: { type: 'number', minimum: 0.1, maximum: 30, description: 'Stroke width multiplier of base weight, 0.1–30 for every brush (including dry_media). Default 1; NOT pixels. Approximate nominal pixels = weight × (short canvas side / 420)^0.68 × width × brush scale; pressure, taper and tip also affect contact. For large solid areas prefer fills outside dry-media mode.' },
    pressure: { type: 'number', minimum: 0, maximum: 1, description: 'Dry-media shorthand only: contact pressure affecting density, default 0.5. Requires dry_media:true; not the global pressure-variation setting.' },
    grade: { type: 'string', enum: ['H', 'HB', '2B', '4B', '6B', '8B'], description: 'Dry-media shorthand only: material softness, default 2B. Requires dry_media:true.' },
    opacity: { type: 'number', description: '0–1. Default 0.95.' },
    controls: {
      type: 'array', description: 'One object per points entry (same length). Smoothly interpolated along the stroke; pressure=0 explicitly lifts the brush. Omitted fields inherit stroke defaults.',
      items: { type: 'object', additionalProperties: false, properties: {
        pressure: { type: 'number', minimum: 0, maximum: 1 },
        width: { type: 'number', minimum: 0, maximum: 3, description: 'Local multiplier of the stroke width, 0–3; default 1, 0 lifts contact. NOT pixels or a replacement for strokes[].width (0.1–30).' },
        opacity: { type: 'number', minimum: 0, maximum: 1 },
        angle: { type: 'number', minimum: -360, maximum: 360, description: 'Canvas-space degrees; shortest-path rotation.' },
        tilt: { type: 'number', minimum: 0, maximum: 1 }
      } }
    },
    tip: { type: 'string', enum: ['round', 'flat'], description: 'Oil or dry-media footprint; flat enables directional elliptical contact.' },
    aspect: { type: 'number', minimum: 0.05, maximum: 1, description: 'Flat tip minor/major ratio; default 0.3.' },
    angle: { type: 'number', minimum: -360, maximum: 360, description: 'Oil flat-tip major-axis angle in canvas degrees (0=right); default 0. Use controls.angle to rotate along the gesture.' },
    tilt: { type: 'number', minimum: 0, maximum: 1, description: 'Oil contact tilt: 0 upright, 1 on its side.' },
    hardness: { type: 'number', minimum: 0, maximum: 1, description: 'Oil edge hardness; independent of grain and flow.' },
    flow: { type: 'number', minimum: 0, maximum: 1, description: 'Paint deposited per contact; 0 deposits nothing. Separate from opacity and load.' },
    cap: { type: 'string', enum: ['round', 'flat', 'taper'], description: 'Explicit stroke endpoint treatment. Controls pressure=0 can place intermediate lifts.' },
    closed: { type: 'boolean', description: 'Join the last point back to the first with a small hand-drawn overlap.' },
    overshoot: { type: 'number', description: 'Endpoint overshoot multiplier, 0–3. Default 0 with explicit new controls; legacy strokes default 1.' }
  },
  required: ['points']
};

const FILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    points: {
      type: 'array',
      items: POINT,
      description: 'Closed polygon to wash or fill.'
    },
    color: { type: 'string', description: 'ink, accent, clay, ochre, sage, or a #rrggbb value. Default ink.' },
    opacity: { type: 'number', description: 'Wash opacity, 0–1. Default 0.18.' },
    rough: { type: 'number', description: 'Edge roughness, 0–1. Default 0.5.' },
    hatch: {
      type: 'object',
      additionalProperties: false,
      properties: {
        gap: { type: 'number', description: 'Hatch spacing in normalized units, 0.005–0.12. Default 0.024.' },
        angle: { type: 'number', description: 'Hatch angle in degrees. Default -32.' },
        color: { type: 'string' },
        width: { type: 'number', description: 'Hatch stroke width multiplier. Default 0.4.' },
        opacity: { type: 'number', description: '0–1. Default 0.24.' }
      }
    }
  },
  required: ['points']
};

const DOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x: { type: 'number', description: '0–1 horizontal position.' },
    y: { type: 'number', description: '0–1 vertical position.' },
    r: { type: 'number', description: 'Radius in normalized units. Default 0.012.' },
    rx: { type: 'number' },
    ry: { type: 'number' },
    color: { type: 'string' },
    opacity: { type: 'number' }
  },
  required: ['x', 'y']
};

const IMAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string' },
    mediaType: { type: 'string' },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    name: { type: 'string' }
  },
  required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height']
};

function fail(message) {
  throw new Error(message);
}

function numberIn(value, fallback, min, max, label) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    const widthHint = /^(strokes|operations)\[\d+\](?:\.controls\[\d+\])?\.width$/.test(label)
      ? label.includes('.controls[')
        ? '; controls.width is a local multiplier, not pixels. Use stroke/operation width (0.1–30) for the overall size'
        : '; width is a multiplier of base weight, not pixels. Use 1 for normal contact, up to 30 for broad marks, or use fills for large solid areas outside dry-media mode'
      : '';
    fail(`${label} must be between ${min} and ${max}${widthHint}`);
  }
  return n;
}

function integerIn(value, fallback, min, max, label) {
  return Math.round(numberIn(value, fallback, min, max, label));
}

function point(p, label) {
  if (!Array.isArray(p) || p.length !== 2) fail(`${label} must be an [x, y] pair`);
  const x = Number(p[0]), y = Number(p[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) fail(`${label} must contain finite numbers`);
  return [x, y];
}

function color(value, label) {
  if (value == null) return undefined;
  if (typeof value !== 'string') fail(`${label} must be a string`);
  if (TONES.includes(value)) return value;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  fail(`${label} must be ink, accent, clay, ochre, sage, or #rrggbb`);
}

function pointsOf(value, label, min) {
  if (!Array.isArray(value) || value.length < min) fail(`${label} must contain at least ${min} points`);
  if (value.length > 400) fail(`${label} is limited to 400 points`);
  return value.map((p, i) => point(p, `${label}[${i}]`));
}

function normalizeStroke(raw, i) {
  const label = `strokes[${i}]`;
  if (!raw || typeof raw !== 'object') fail(`${label} must be an object`);
  if (raw.grade != null || raw.pressure != null) fail(`${label}.grade/pressure require dry_media:true; use controls for legacy per-point pressure`);
  const points = pointsOf(raw.points, `${label}.points`, 2);
  const extra = {};
  for (const [key, min, max] of [['angle', -360, 360], ['tilt', 0, 1], ['hardness', 0, 1], ['flow', 0, 1], ['aspect', 0.05, 1]]) {
    if (raw[key] != null) extra[key] = numberIn(raw[key], undefined, min, max, `${label}.${key}`);
  }
  for (const [key, values] of [['tip', ['round', 'flat']], ['cap', ['round', 'flat', 'taper']]]) {
    if (raw[key] != null) {
      if (!values.includes(raw[key])) fail(`${label}.${key} must be ${values.join(' or ')}`);
      extra[key] = raw[key];
    }
  }
  if (raw.controls != null) {
    if (!Array.isArray(raw.controls) || raw.controls.length !== points.length) fail(`${label}.controls must have one object per point`);
    extra.controls = raw.controls.map((control, j) => {
      if (!control || typeof control !== 'object' || Array.isArray(control)) fail(`${label}.controls[${j}] must be an object`);
      const result = {};
      for (const [key, min, max] of [['pressure', 0, 1], ['width', 0, 3], ['opacity', 0, 1], ['angle', -360, 360], ['tilt', 0, 1]]) {
        if (control[key] != null) result[key] = numberIn(control[key], undefined, min, max, `${label}.controls[${j}].${key}`);
      }
      for (const key of Object.keys(control)) if (!(key in result)) fail(`Unknown or null control ${key}`);
      return result;
    });
  }
  return CORE.stroke(points, {
    ...extra,
    color: color(raw.color, `${label}.color`),
    width: numberIn(raw.width, 1, 0.1, 30, `${label}.width`),
    opacity: numberIn(raw.opacity, 0.95, 0, 1, `${label}.opacity`),
    closed: raw.closed === true,
    ...(raw.overshoot == null ? {} : { overshoot: numberIn(raw.overshoot, 1, 0, 3, `${label}.overshoot`) })
  });
}

function normalizeFill(raw, i) {
  const label = `fills[${i}]`;
  if (!raw || typeof raw !== 'object') fail(`${label} must be an object`);
  const item = CORE.fill(pointsOf(raw.points, `${label}.points`, 3), {
    color: color(raw.color, `${label}.color`),
    opacity: numberIn(raw.opacity, 0.18, 0, 1, `${label}.opacity`),
    rough: numberIn(raw.rough, 0.5, 0, 1, `${label}.rough`)
  });
  if (raw.hatch != null) {
    if (typeof raw.hatch !== 'object') fail(`${label}.hatch must be an object`);
    item.hatch = {
      gap: numberIn(raw.hatch.gap, 0.024, 0.005, 0.12, `${label}.hatch.gap`),
      angle: numberIn(raw.hatch.angle, -32, -180, 180, `${label}.hatch.angle`),
      color: color(raw.hatch.color, `${label}.hatch.color`) || 'ink',
      width: numberIn(raw.hatch.width, 0.4, 0.1, 2, `${label}.hatch.width`),
      opacity: numberIn(raw.hatch.opacity, 0.24, 0, 1, `${label}.hatch.opacity`)
    };
  }
  return item;
}

function normalizeDot(raw, i) {
  const label = `dots[${i}]`;
  if (!raw || typeof raw !== 'object') fail(`${label} must be an object`);
  const item = CORE.dot(
    numberIn(raw.x, 0.5, -0.2, 1.2, `${label}.x`),
    numberIn(raw.y, 0.5, -0.2, 1.2, `${label}.y`),
    numberIn(raw.r, 0.012, 0.002, 0.08, `${label}.r`),
    {
      color: color(raw.color, `${label}.color`),
      opacity: numberIn(raw.opacity, 0.96, 0, 1, `${label}.opacity`)
    }
  );
  if (raw.rx != null) item.rx = numberIn(raw.rx, 0.012, 0.002, 0.1, `${label}.rx`);
  if (raw.ry != null) item.ry = numberIn(raw.ry, 0.012, 0.002, 0.1, `${label}.ry`);
  return item;
}

function slug(text) {
  const value = String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return value || 'quiet-line';
}

function outputPath(cwd, requested, title, seed) {
  const fallback = path.join('quiet-line-out', `${slug(title)}-${String(seed).padStart(4, '0')}.png`);
  let chosen = fallback;
  if (requested != null && String(requested).trim() !== '') {
    chosen = String(requested).trim();
    if (path.isAbsolute(chosen)) fail('output must be a path inside the session working directory');
    if (!/\.png$/i.test(chosen)) chosen += '.png';
  }
  const abs = path.resolve(cwd, chosen);
  const root = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
  if (abs !== cwd && !abs.startsWith(root)) fail('output must stay inside the session working directory');
  if (path.extname(abs).toLowerCase() !== '.png') fail('output must end in .png');
  return abs;
}

async function attachImage(ctx, png, name, limits) {
  const attachments = ctx.get('attachments');
  if (!attachments) return { note: 'No attachment service is mounted; the PNG is on disk only.' };
  if (png.length > limits.maxImageBytes) {
    return {
      note: `The PNG is ${png.length} bytes, above the ${limits.maxImageBytes}-byte attachment limit; the file is on disk only.`
    };
  }
  try {
    const ref = await attachments.saveImage({ data: png, mediaType: 'image/png', name });
    if (ref.width > limits.maxImageDimension || ref.height > limits.maxImageDimension) {
      return {
        note: `The rendered image is ${ref.width}×${ref.height}, above the ${limits.maxImageDimension}px attachment dimension limit; the file is on disk only.`
      };
    }
    return {
      image: {
        attachmentId: ref.attachmentId,
        mediaType: ref.mediaType,
        bytes: ref.bytes,
        width: ref.width,
        height: ref.height,
        ...(ref.name === undefined ? {} : { name: ref.name })
      }
    };
  } catch (error) {
    return {
      note: `The image could not be attached: ${error && error.message ? error.message : String(error)}`
    };
  }
}

function renderValue(value) {
  const lines = [
    `Drew “${value.title}” ${value.baseImage ? 'over an existing image' : `on ${SURFACE_LABELS[value.surface] || value.surface}`} with a ${BRUSH_LABELS[value.brush] || value.brush} at ${value.width}×${value.height}, seed ${value.seed}, ${value.marks} new marks.`,
    `File: ${value.path}`
  ];
  if (value.project) {
    lines.push(`Project: ${value.project} — ${value.projectMode} step ${value.projectStep}, revision ${value.projectRevision}. Editable material state and this PNG are auto-saved in the single project file.`);
    lines.push('Continue with project set to this same file. Use quiet_line_project to list history, restore, checkpoint, branch or export; no loose state snapshots are needed. Choose a brush or dry-media operations for the next pass. Changing brushes keeps existing material states editable.');
    if (value.projectTransition) lines.push(value.projectTransition);
    if (value.note) lines.push(value.note);
    return lines.join('\n');
  }
  if (value.baseImage) lines.push(`Continued over: ${value.baseImage}. Existing image is a flattened dry layer.${value.resizedBase ? ' Base image was resized to the output dimensions.' : ''}`);
  if (value.dryMedia) {
    lines.push('Material-aware dry media: operations were applied in order. Erasing and smudging affect new material only, never the flattened base image.');
    if (value.resumedDryState) lines.push(`Resumed dry materials: ${value.resumedDryState}`);
    if (value.dryState) lines.push(`Dry state: ${value.dryState}. Continue with dry_state set to this file to retain removable pigment and substrate; use save_dry_state to save the next stage.`);
    else lines.push('To keep material editable across calls, request save_dry_state while drawing. This PNG alone cannot recover removable pigment.');
    if (value.note) lines.push(value.note);
    return lines.join('\n');
  }
  if (value.resumedState) lines.push(`Resumed wet paint: ${value.resumedState}`);
  if (value.paintState) lines.push(`Wet state: ${value.paintState}. Continue with paint_state set to this file, not base_image, to retain wet pickup and thickness.`);
  else lines.push(`For a drawing revision, use base_image set to this result's path for dry overpainting. To preserve wet oil across future calls, request save_state while drawing. Do not switch to external image processing unless requested or necessary.`);
  if (value.note) lines.push(value.note);
  return lines.join('\n');
}

export function apply(ctx) {
  const drawingTool = {
    name: 'quiet_line_draw',
    description:
      'Draw a Quiet Line hand-drawn illustration on a chosen surface and attach it to the result. ' +
      'Pick a brush (ink, fountain, pencil, charcoal, brush, marker, oil, palette knife) and a canvas material ' +
      '(warm paper, cold-press, kraft, linen, newsprint, charcoal paper), then choose a built-in study or supply ' +
      'custom strokes, filled washes and dots. All marks receive trajectory wobble, pressure variation, tapered ends ' +
      'and optional hatching; oil and palette-knife strokes go through a wet paint simulation with paint pickup, ' +
      'bristle ridges and impasto. Start fresh or paint new marks over an existing image. ' +
      'For drawing revisions, normally use this tool on the previous image and show the painted result, rather than ' +
      'switching to generic image-processing scripts merely because an image already exists. Use other editing tools ' +
      'when the user explicitly requests image processing (such as crop/filter/colour adjustment) or this tool cannot perform the change. ' +
      'Use a project (.qlproject) to autosave a canvas, paint and undo history. A new project with no marks is blank. Choose any brush on each call. Oil, dry pigment and regular marks stay in the same project with their own painting behavior. Use quiet_line_project for history, restore, branch and export. Existing image pixels are a flattened dry layer. Legacy snapshots remain supported: save_state to a new .qlpaint file, then resume with paint_state (not base_image). Stroke controls enable per-point pressure/width/opacity/angle/tilt and oil tip/hardness/flow. State snapshots also allow branching from an earlier call; editable layers, masks and arbitrary per-stroke undo are not provided. ' +
      'For material-aware graphite/charcoal, use dry_media with ordered operations: pencil, charcoal, eraser, kneaded and smudge. Save .qldry with save_dry_state, resume via dry_state; standalone dry/wet snapshots are independent. Projects retain separate oil and dry pigment states across brush changes. Different materials are composited without a physical interaction model between oil and dry pigment. ' + ART_GUIDANCE,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...PROJECT_TOOL.parameters,
        ...DRY_TOOL.parameters,
        paint_state: { type: 'string', description: 'Resume a local .qlpaint wet oil snapshot. Inherits fixed brush, surface, seed, grain and dimensions; omit those options. Mutually exclusive with base_image and subject. Restores pigment/height/wetness, not flattened PNG pixels.' },
        save_state: { type: 'string', description: 'Optional NEW .qlpaint path within working directory. Oil/oilknife only. Saves wet state for another call; never overwrites existing files. Saving is opt-in and has canvas-sized I/O cost. Keep previous snapshots for call-level rollback/branching.' },
        base_image: {
          type: 'string',
          description: 'Optional existing local PNG, JPEG or static WebP path, absolute or relative to the session working directory. Draw ONLY the requested additions over it. Inherits its oriented dimensions, proportionally reduced only above 2560px; no new paper is applied to old pixels. Accepts up to 32 MiB / 32 megapixels. Existing paint is a dry flattened image, not recoverable wet layers. The source is never overwritten.'
        },
        subject: {
          type: 'string',
          enum: SUBJECTS,
          description: `Built-in study: ${SUBJECTS.map(id => `${id} = ${SUBJECT_LABELS[id]}`).join('; ')}. Omit for custom-only art; defaults to sun only when neither base_image nor custom marks are supplied. With base_image, omit subject to avoid repainting an entire study.`
        },
        title: {
          type: 'string',
          description: 'Short human title used in the result and default filename. Defaults to the study title.'
        },
        brush: {
          type: 'string',
          enum: BRUSH_IDS,
          description: `Drawing tool: ${BRUSH_IDS.map(id => `${id} = ${BRUSH_LABELS[id]}`).join('; ')}. Default ink.`
        },
        surface: {
          type: 'string',
          enum: SURFACE_IDS,
          description: `Canvas material: ${SURFACE_IDS.map(id => `${id} = ${SURFACE_LABELS[id]}`).join('; ')}. Default warm. With base_image, affects only new marks and their texture, never replaces the existing background.`
        },
        seed: {
          type: 'integer',
          description: 'Deterministic hand variation, 1–9999. Reuse a seed to redraw the same study.'
        },
        size: {
          type: 'integer',
          description: 'Square shorthand for width and height, 320–2560 (1–2560 with base_image). Default 1200 for a new canvas; omit to inherit base image dimensions. Explicit square size may stretch the base. Ignored on an axis where width or height is given.'
        },
        width: {
          type: 'integer',
          description: 'Canvas width, 320–2560 pixels (1–2560 with base_image). Omit to inherit the base width; with base_image and only this axis set, preserve aspect ratio. Setting both axes explicitly resizes the base to that exact size and may stretch it.'
        },
        height: {
          type: 'integer',
          description: 'Canvas height, 320–2560 pixels (1–2560 with base_image). Omit to inherit the base height; with base_image and only this axis set, preserve aspect ratio. Setting both axes explicitly resizes the base to that exact size and may stretch it.'
        },
        wobble: {
          type: 'integer',
          description: 'Trajectory looseness, 0–100. Default 58.'
        },
        pressure: {
          type: 'integer',
          description: 'Ink pressure variation, 0–100. Default 66.'
        },
        grain: {
          type: 'integer',
          description: 'Paper grain and dry-ink texture, 0–100. Default 46.'
        },
        wetness: {
          type: 'integer',
          description: 'Oil-brush paint pickup and wet mixing, 0–100. Default 55; ignored by non-oil brushes.'
        },
        impasto: {
          type: 'integer',
          description: 'Oil-brush paint thickness, ridge light and groove, 0–100. Default 62; ignored by non-oil brushes.'
        },
        load: {
          type: 'integer',
          description: 'Oil-brush paint load, 0–100. Lower values run drier and thinner over the stroke. Default 65; ignored by non-oil brushes.'
        },
        weight: {
          type: 'number',
          description: 'Base ink weight, 1.5–4.5. Around 3 is confident and full. Default 3.0.'
        },
        accent: {
          type: 'string',
          description: 'Optional warm accent as #rrggbb. By default the surface supplies its own ink and accent palette.'
        },
        output: {
          type: 'string',
          description: 'Optional PNG path inside the session working directory. Default quiet-line-out/<title>-<seed>.png. With base_image, an explicit path must be NEW; default filenames gain a numeric suffix if occupied. Neither the source nor any existing file is overwritten during continuation.'
        },
        strokes: {
          type: 'array',
          items: STROKE_SCHEMA,
          description: 'Custom hand-drawn strokes. Points are normalized 0..1. Use for extra details or a completely custom drawing.'
        },
        fills: {
          type: 'array',
          items: FILL_SCHEMA,
          description: 'Custom filled washes. Add hatch to turn a wash into a textured mass. Points are normalized 0..1.'
        },
        dots: {
          type: 'array',
          items: DOT_SCHEMA,
          description: 'Custom filled dots for eyes, berries, punctuation or navigation.'
        }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          subject: { type: 'string' },
          brush: { type: 'string' },
          surface: { type: 'string' },
          seed: { type: 'integer' },
          path: { type: 'string' },
          absolutePath: { type: 'string' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          bytes: { type: 'integer' },
          marks: { type: 'integer' },
          baseImage: { type: 'string' },
          resizedBase: { type: 'boolean' },
          dryMedia: { type: 'boolean' },
          dryState: { type: 'string' },
          resumedDryState: { type: 'string' },
          paintState: { type: 'string' },
          resumedState: { type: 'string' },
          project: { type: 'string' },
          projectStep: { type: 'integer' },
          projectRevision: { type: 'integer' },
          projectMode: { type: 'string', enum: ['wet', 'dry', 'mixed'] },
          projectTransition: { type: 'string' },
          image: IMAGE_SCHEMA,
          note: { type: 'string' }
        },
        required: ['title', 'subject', 'brush', 'surface', 'seed', 'path', 'absolutePath', 'width', 'height', 'bytes', 'marks']
      },
      render(_args, value) {
        const blocks = [{ type: 'text', text: renderValue(value) }];
        if (value.image) blocks.push({ type: 'image', attachment: value.image });
        return blocks;
      }
    },
    timeoutMs: 60000,
    isConcurrencySafe: () => false,
    async execute(args, exec, options = {}) {
      if (!exec.agent) fail('quiet_line_draw needs an owning Agent session');
      if (args.project != null) return PROJECT_TOOL.executeProject(args, exec, {
        ctx, execute: (raw, run, opts) => drawingTool.execute(raw, run, opts),
        outputPath, writeDrawing, attachImage
      });
      PROJECT_TOOL.checkWithoutProject(args);
      if (args.dry_media != null && typeof args.dry_media !== 'boolean') fail('dry_media must be boolean');
      if (args.dry_media || args.operations != null || args.dry_state != null || args.save_dry_state != null) {
        return DRY_TOOL.executeDry(args, exec, {ctx, fail, numberIn, integerIn, color, pointsOf, loadBaseImage, writeDrawing, outputPath, attachImage, path, CORE});
      }
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
      if (!cwd) fail('the session working directory is unavailable');

      const hasPaintState = args.paint_state != null;
      if (hasPaintState && (args.base_image != null || (args.subject != null && !options.projectLayer))) fail('paint_state cannot be combined with base_image or subject');
      const paintState = hasPaintState ? await loadPaintState(cwd, args.paint_state) : undefined;
      const metadata = paintState?.metadata;
      if (metadata) {
        const keys = options.projectLayer ? ['surface', 'seed', 'width', 'height'] : ['brush', 'surface', 'seed', 'width', 'height'];
        for (const key of keys) {
          if (args[key] != null && args[key] !== metadata[key]) fail(`paint_state fixes ${key}; omit it or use ${metadata[key]}`);
        }
        if (args.size != null && (args.size !== metadata.width || args.size !== metadata.height)) fail('paint_state dimensions cannot be resized');
        if (args.grain != null && Math.abs(args.grain / 100 - (metadata.settings?.texture ?? metadata.grain)) > 1e-9) fail('paint_state fixes grain; omit it');
      }
      const customStrokes = Array.isArray(args.strokes) ? args.strokes.map(normalizeStroke) : [];
      const customFills = Array.isArray(args.fills) ? args.fills.map(normalizeFill) : [];
      const customDots = Array.isArray(args.dots) ? args.dots.map(normalizeDot) : [];
      const hasCustom = customStrokes.length + customFills.length + customDots.length > 0;
      const requestedSubject = typeof args.subject === 'string' ? args.subject : undefined;
      if (requestedSubject !== undefined && !SUBJECTS.includes(requestedSubject)) {
        fail(`subject must be one of ${SUBJECTS.join(', ')}`);
      }
      const hasBaseImage = args.base_image != null;
      const subject = requestedSubject || (hasCustom || hasBaseImage || hasPaintState ? 'custom' : 'morning');
      const base = SUBJECTS.includes(subject) ? CORE.sketches.find(item => item.id === subject) : undefined;
      if (!base && subject !== 'custom') fail(`unknown subject “${subject}”`);
      const items = (base ? base.items.slice() : []).concat(customFills, customStrokes, customDots);
      if (!items.length && !hasBaseImage && !hasPaintState) fail('nothing to draw: choose a subject or supply custom strokes, fills or dots');
      const title = (args.title && String(args.title).trim()) || (base ? base.title : hasBaseImage ? 'Continued drawing' : 'Custom study');
      const sketch = {
        id: subject,
        title,
        cn: base ? base.cn : '即兴',
        note: base ? base.note : 'improvised marks',
        noteCn: base ? base.noteCn : '',
        items
      };

      const brush = args.brush == null ? (metadata?.brush || 'ink') : String(args.brush);
      if (!BRUSH_IDS.includes(brush)) fail(`brush must be one of ${BRUSH_IDS.join(', ')}`);
      if (args.save_state != null && !['oil', 'oilknife'].includes(brush)) fail('save_state requires oil or oilknife');
      const surface = args.surface == null ? (metadata?.surface || 'warm') : String(args.surface);
      if (!SURFACE_IDS.includes(surface)) fail(`surface must be one of ${SURFACE_IDS.join(', ')}`);
      const seed = integerIn(args.seed, metadata?.seed ?? 241, 1, 9999, 'seed');
      const baseImage = hasBaseImage ? await loadBaseImage(cwd, args.base_image, args) : undefined;
      const size = hasBaseImage || hasPaintState ? undefined : integerIn(args.size, 1200, 320, CORE.MAX_CANVAS_SIDE, 'size');
      const width = metadata?.width ?? (baseImage ? baseImage.width : integerIn(args.width == null ? size : args.width, size, 320, CORE.MAX_CANVAS_SIDE, 'width'));
      const height = metadata?.height ?? (baseImage ? baseImage.height : integerIn(args.height == null ? size : args.height, size, 320, CORE.MAX_CANVAS_SIDE, 'height'));
      const previousSettings = metadata?.settings;
      const wetness = args.wetness == null ? (previousSettings?.wetness ?? 0.55) : numberIn(args.wetness, 55, 0, 100, 'wetness') / 100;
      const impasto = args.impasto == null ? (previousSettings?.impasto ?? 0.62) : numberIn(args.impasto, 62, 0, 100, 'impasto') / 100;
      const load = args.load == null ? (previousSettings?.load ?? 0.65) : numberIn(args.load, 65, 0, 100, 'load') / 100;
      let accent = previousSettings?.accent || undefined;
      if (args.accent != null) {
        if (typeof args.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(args.accent)) {
          fail('accent must be a #rrggbb color');
        }
        accent = args.accent;
      }
      const style = {
        seed,
        weight: numberIn(args.weight, previousSettings?.weight ?? 3.0, 1.5, 4.5, 'weight'),
        wobble: args.wobble == null ? (previousSettings?.wobble ?? 0.58) : numberIn(args.wobble, 58, 0, 100, 'wobble') / 100,
        pressure: args.pressure == null ? (previousSettings?.pressure ?? 0.66) : numberIn(args.pressure, 66, 0, 100, 'pressure') / 100,
        texture: args.grain == null ? (previousSettings?.texture ?? 0.46) : numberIn(args.grain, 46, 0, 100, 'grain') / 100,
        itemOffset: options.itemOffset ?? metadata?.itemOffset ?? 0,
        padding: options.projectLayer && !requestedSubject ? 0 : 0.02,
        brush,
        surface,
        ...(accent === undefined ? {} : { accent })
      };
      options.observeOilSettings?.({
        itemOffset: style.itemOffset, weight: style.weight, wobble: style.wobble * 100,
        pressure: style.pressure * 100, grain: style.texture * 100, accent: style.accent,
        wetness: wetness * 100, impasto: impasto * 100, load: load * 100
      });
      const built = CORE.buildSketch(sketch, style, { width, height });
      const rendered = RASTER.renderPNG(built, {
        width, height, seed, grain: metadata?.grain ?? built.grain, surface, wetness, impasto, load, baseImage,
        paintState,
        consumePaintState: options.projectLayer === true,
        fixedPaintRelief: options.projectLayer === true,
        captureState: args.save_state != null && (options.projectLayer
          ? snapshot => savePaintState(cwd, args.save_state, snapshot)
          : true),
        itemOffset: style.itemOffset + items.length,
        settings: { weight: style.weight, wobble: style.wobble, pressure: style.pressure, texture: style.texture,
          wetness, impasto, load, accent: accent || null }
      });
      const requestedTarget = outputPath(cwd, args.output, title, seed);
      const target = await writeDrawing(cwd, requestedTarget, rendered.png, {
        continuation: hasBaseImage || hasPaintState || args.save_state != null,
        explicitOutput: args.output != null && String(args.output).trim() !== ''
      });

      const savedState = args.save_state == null ? undefined : options.projectLayer
        ? args.save_state : await savePaintState(cwd, args.save_state, rendered.paintState);
      const limits = ctx.get('attachments')?.imageLimits;
      let image, note;
      if (limits && !options.projectLayer) {
        const attached = await attachImage(ctx, rendered.png, path.basename(target), limits);
        image = attached.image;
        note = attached.note;
      } else {
        note = 'No attachment service is mounted; the PNG is on disk only.';
      }

      const relative = path.relative(cwd, target).split(path.sep).join('/');
      return {
        title,
        subject,
        brush,
        surface,
        seed,
        path: relative,
        absolutePath: target,
        width: rendered.width,
        height: rendered.height,
        bytes: rendered.png.length,
        marks: built.stats.marks,
        ...(baseImage ? { baseImage: baseImage.path, resizedBase: baseImage.resized } : {}),
        ...(savedState ? { paintState: savedState } : {}),
        ...(hasPaintState ? { resumedState: path.resolve(cwd, args.paint_state) } : {}),
        ...(image ? { image } : {}),
        ...(note ? { note } : {})
      };
    },
    presentCall(args) {
      const subject = args && args.subject ? args.subject : (args && (args.base_image || args.paint_state || args.dry_state || args.operations || args.dry_media || args.strokes || args.fills || args.dots) ? 'custom' : 'morning');
      const brush = args && args.brush ? ` · ${args.brush}` : '';
      return { card: 'generic', title: `${args && (args.base_image || args.paint_state || args.dry_state) ? 'Continue' : 'Draw'} ${subject}${brush}`, kind: 'other' };
    }
  };
  ctx.tools.register(drawingTool);
  ctx.tools.register(PROJECT_TOOL.createProjectTool(ctx));
}
