# Continue painting — 1.0.19

## Overpainting an existing image

`quiet_line_draw` accepts an existing image as a base for new marks. An
editable Quiet Line project or material snapshot preserves simulated paint
state across calls. Choose the workflow according to the requested change.

## Main flow

1. Inspect the previous image to locate the requested additions.
2. Set `base_image` to its local path. Absolute paths and paths relative to the
   session working directory are supported, including images outside that
   directory. Remote URLs and attachment identifiers are not local paths.
3. Supply the new strokes, fills or dots using normalized coordinates. Omit
   `subject` to skip a built-in study. Omit `size`, `width` and `height` to
   inherit the image dimensions within the supported range.
4. Use a new `output` name or omit it for an automatically unique default name.
5. To add more marks to the resulting bitmap, pass its path as `base_image`.

Example tool arguments:

```json
{
  "base_image": "quiet-line-out/still-warm-0241.png",
  "title": "Cup with a painted stem",
  "brush": "oil",
  "surface": "linen",
  "seed": 241,
  "strokes": [
    {"points": [[0.48,0.64],[0.47,0.53],[0.49,0.46]], "color": "#637751", "width": 0.8}
  ],
  "output": "quiet-line-out/cup-iteration-2.png"
}
```

With a base image and no marks, the tool simply saves a separate copy without
adding the default morning study. This is useful for preservation checks.
It is not a generative repainting or inpainting system: replacing objects
requires explicitly painting the covering/background and replacement marks.
It does not claim to infer a hidden scene or automatically erase an object.

## Dimensions, pixels and safety

- Static PNG, JPEG and WebP only. Content is decoded rather than trusting the
  extension. Animated/multipage input is rejected. EXIF orientation is applied.
- Maximum input is 32 MiB and 32 megapixels. Corrupt/unsupported inputs fail with
  an error rather than starting a blank drawing.
- Output is PNG, at most 2560px per side. Default dimensions equal the oriented
  original, scaled proportionally down only if its long side exceeds 2560px.
  Small inputs below 320px remain their original size.
- One explicit width/height preserves aspect ratio; both explicit dimensions
  resize to that exact rectangle and can stretch the image. `size` is an
  explicit square shorthand. Continuation dimensions must be integers 1–2560.
- Inputs are decoded to 8-bit sRGB RGBA. Existing PNG transparency is retained.
  Non-sRGB profiles, high bit depth, EXIF orientation and optional resizing can
  transform decoded pixels; this is not a lossless metadata-preservation tool.
- With an ordinary 8-bit sRGB PNG at unchanged dimensions, untouched pixels
  remain numerically identical, including alpha. No paper, vignette or grain
  is applied to old pixels. Grain affects only newly drawn marks.
- `surface` still affects the palette/texture/contact of NEW marks, not the old
  background. The 1.0.18 oil brush and lighting module is unchanged.
- Source bytes are never written. Continuation writes use exclusive creation:
  an existing output, including a symlink or hardlink, is never truncated.
  Occupied explicit output paths fail. Default names gain `-2`, `-3`, etc.
- Outputs stay in the working directory; a parent directory resolving through
  a junction/symlink outside it is rejected before writing the image.

## Paint-state limitation

The imported bitmap is a flattened, dry layer. Prior wetness, pigment film,
height, stroke groups and editable layers cannot be reconstructed from a PNG.
New oil marks use the accepted wet-paint simulation among marks in the CURRENT
call. They are alpha-composited over the imported image, not mixed with it as
wet pigment. Cross-call impasto heights and wet mixing are not persisted.

## Implementation / verification

`lib/base-image.cjs` uses pinned Sharp 0.35.5 (matching this DSH runtime's decoder version to avoid Windows libvips DLL conflicts) to decode PNG/JPEG/WebP, orient,
convert and optionally resize input. It does not paint the additions. All new
marks still go through Quiet Line core/raster/oil. The original RGB blank-canvas
branch remains unchanged; an optional RGBA source-over branch handles the base.

Regression verification covers all eight fresh-canvas brushes against 1.0.18
byte-for-byte, no-op pixel preservation, unpainted pixels, a second iteration,
transparent source-over, EXIF orientation, supported formats, dimensions,
invalid/oversized input and same-path/hardlink overwrite rejection. Review the
live tool after installation; offline tests alone do not prove live activation.

UX self-review (no subagent/browser-control tool available): the base_image
parameter is discoverable in the registered schema; main flow and exception
cases are described; results identify the source and resizing; call cards say
Continue; collisions return an actionable message. Existing Host image result
cards are reused, with no new client panel or replacement GUI. Live image
attachment verification is required, but a GUI screenshot is unavailable.

Rollback: keep the accepted 1.0.18 package; reinstall that bundle if needed.
