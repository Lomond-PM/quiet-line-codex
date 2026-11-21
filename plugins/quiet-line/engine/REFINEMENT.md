# 1.0.17 — conservative width-detail pass

Base: verified 1.0.16 (recovered 1.0.9 rendering). Baseline is preserved unchanged.

## Scope

Only lib/oil.cjs width calculations changed. No cleanup of unrelated dead code.
No edits to core geometry, pigment shading, coverage/spread, impasto, transport,
head/tail indices, or PRNG call order. Visible marks are intentionally changed;
this release is not supposed to match the five historical PNG hashes.

Let d = clamp01((halfWidth - 4) / 6) * (1 - abs(v)^4), or zero for knife.
The original width random sample r is reused, without consuming another sample:

    hw = max(.30, spacing * (.62 + .22*r + .22*d*(r-.5)))

The expected pre-clamp half-width remains .73*spacing, while the spread between
individual hairs grows slightly. The effect is zero on marks up to 8 canvas
pixels wide (engine average path width), increasing gradually on broader marks.
It fades toward the outer hairs, but does not promise pixel-identical outlines.

Along-hair width modulation is slightly reduced with d, from amplitude .30 to
at most .22, with the original noise frequency and per-hair phase. This reduces
beading without synchronizing the entire tuft. d=0 uses the original arithmetic.
Existing paint-supply narrowing remains unchanged.

## Checks

- Syntax validation passed.
- 2400 generated brush bundles (200 seeds, 6 widths, oil and knife): unchanged
  PRNG consumption and every non-width hair property; finite bounded widths;
  unchanged fine and knife widths. Includes head/tail, shade, load and phase.
- Six rendered before/after cases: short-stroke board, fine marks, palette knife,
  long stroke, crossing close-up and detail strokes.
- Fine marks SHA-256 remains
  abff2cc94b40bc70595421a472408561dd83f8afb963f8755539d3abb8562282.
- Knife board SHA-256 remains
  4a69f84507657c8a540301be26181128f5d460bfdf907e988bb2c06777e7ba98.
- Short-stroke board mean absolute channel difference: .253 / 255.
  Mean-RGB<180 coverage: 77559 -> 77507 pixels (about -.067%). This is only a
  coarse coverage check, not proof of all surface/load behavior.
- Visual inspection of matched board and 2x long-stroke detail: change is subtle;
  opaque body and staggered ends remain, with slightly varied interior tracks.

Workspace evidence: oil-work/test-refine117.cjs, invariants-refine117.cjs,
compare-refine117.py, and refine117-results (comparison, hashes, metrics).

Rollback: reinstall the unchanged package directory
the locally preserved dsh-local-quiet-line-board-1.0.16 directory using plugin_manager.
Do not delete any preserved version or snapshot.
