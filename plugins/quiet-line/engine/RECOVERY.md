# 1.0.9 brush recovery — packaged as 1.0.16

Date: 2026-11-19. Base: preserved 1.0.15 reconstructed rollback.

## Evidence-driven changes to the base

- Remove `wAmp` random draw added after the 1.0.9 reference was generated; restore original PRNG consumption order.
- Hair starts: `j0 = max(0, min(n-2, round(head * invStep)))`.
- Hair ends: `j1 = max(j0+1, n-1-min(round(tail * invStep), maxTail))`. The previous plus-and-clamp implementation neutralized the stagger.
- Restore `hGain` multiplier `(small ? 1.2 : 1)`.
- Restore both per-hair `col` and `carry` shade amplitudes from 0.24 to 0.10.

Historical session: session-48fc8e0a-5bed-4657-a5bc-0e9afb9f58a9.
Relevant recorded events: 4075/4126 (indices), 4710 (small hGain), 4734
(tail limit), 4944/5006 (hair shading), 5111 (later wAmp addition), 5244
(later 0.24 shade change), 5077 (reference output collection).

## Verified output SHA-256

Each recovered output is byte-for-byte equal to its historical reference:

| Reference | SHA-256 |
|---|---|
| strokes.png — 900x560, oil/coldpress, seed 77, wet .65, impasto .75, load .72 | dfed6769c2c8a92a7a66262231a2f5f770c32e2748fc5cd249afa9eaf2cbc86c |
| cup.png — 1200x800, oil/linen, seed 241, defaults | f546ece46cf4e518e7c3de40cf3ffe3e33e9439d81af10db840957679ca0eb92 |
| cat.png — 1200x800, oil/linen, seed 241, defaults | 9a4435b3e457b66883a3d847cfa719f5506f8c46540c5971626eedba04a97b73 |
| stroke-zoom.png — 1280x640, oil/warm, seed 5 | 42dc62f7df1cdd9dfa8b5a4a465d7ac678592089bc2c706fc94513fc2f011c6e |
| crossing-zoom.png — 1280x960, oil/warm, seed 5 | c7081ee971bcadf74c068dcf8ed487e938b0195808069da368409213d5dcfacf |

Scripts and original references are retained under the workspace's oil-work
folder. The recovered scripts have the `restore-` prefix. Original references
are in `final9`. Source byte identity with deleted original 1.0.9 is not proven;
disabled experimental branches remain inert. Five matching regressions establish
recovery of the requested historical rendering, not correctness for all inputs.

## Preservation

Do not delete old version directories or snapshots. 1.0.15 remains available at
the locally preserved dsh-local-quiet-line-board-1.0.15 directory and its existing
snapshot. The installed recovered package is 1.0.16 in a new real directory so
DSH does not reuse modules cached from the old source path.
