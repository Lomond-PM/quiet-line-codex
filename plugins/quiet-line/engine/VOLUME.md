# 1.0.18: first paint-volume lighting pass

## Scope and cause

Based on the accepted 1.0.17 brush. Only flushOil in lib/oil.cjs changes.
The previous flush loop cleared hgt as each pixel was resolved. Subsequent
pixels therefore sampled zero on the left/up, while right/down still retained
paint. The apparent slope and curvature depended on iteration order. Slope
mostly drove an unbounded, thresholded glint rather than broad diffuse shading.

## Change

- Keep height intact until all pixels have been shaded. Clear film arrays in
  a separate final pass, retaining the original cleared region and semantics.
- Compute a separable binomial-filtered height field for lighting only, at
  one-canvas-pixel filter spacing; actual hgt/cov/col/stamp remain untouched.
- Sobel normals, normalized fixed upper-left studio illumination, bounded
  diffuse response (-.13..+.16), a modest broad reflection (power 24), and
  groove attenuation capped at .025. Relief follows impasto.
- Preserve original alpha compositing exactly. No added silhouette, outline,
  external drop shadow, RNG calls, pigment mixing or hair-shape changes.

Thicker existing deposits and their shoulders become visibly raised instead of
merely acquiring brighter streaks. This is a height-field shading pass, not a
3D mesh renderer. It does not add cast shadows, overhangs or new deposit physics.
Very close views still expose the existing hair/support height structure.
Later strokes following an interleaved non-oil flush can pick up the newly
resolved colour from the existing coarse dry-pickup cache, as intended.

## Verification

verify-volume118.cjs: 24 seeded film cases (oil/knife, impasto 0/.62/1,
load .25/.8), each including a thin mark and crossing loaded marks:
- col, cov, hgt, stamp byte-identical before flush vs 1.0.17.
- alpha byte-identical after flush, including edge coverage and tails.
- all film data cleared and empty re-flush is a no-op.
- rotating a symmetric raised test patch and the light 180 degrees gives
  identical RGBA (max error 0); old scan-order code fails (max error 198).

Visual cases: short-stroke board, fine lines, knife board, broad long mark,
cream/red crossing, dry paint, impasto 0 vs 100, full cup and cat on linen.
Cup/cat with ink remain byte-identical to 1.0.17. Oil colour/lighting changes
are intentional. Tests establish sampled invariants, not every possible input.

1200x800 oil studies on this machine: cat 610ms baseline / 627ms new,
cup 523ms / 525ms in one local run (not a statistical benchmark).
Two temporary Float32 lighting buffers cost 8 bytes per pixel in the padded
dirty rectangle. Full 1800x1800 output at 2x supersampling adds roughly 104MB
at worst; buffers are released after flush. No change to persistent wet state.

Evidence is in workspace oil-work/volume118-results and the test-volume118.cjs,
verify-volume118.cjs, studies-volume118.cjs, compare-volume118.py scripts.

Rollback: reinstall the unchanged package at
the locally preserved dsh-local-quiet-line-board-1.0.17 directory through plugin_manager.
