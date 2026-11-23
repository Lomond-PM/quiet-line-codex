---
name: quiet-line
description: Use Quiet Line to draw custom strokes, washes, dry graphite/charcoal or wet oils, continue a PNG or material state, or manage a .qlproject painting. Use when the user requests Quiet Line or asks to continue work created with it.
---

# Quiet Line

Use the plugin's `quiet_line_draw` and `quiet_line_project` tools. Set `workspace` to the absolute path of the active workspace or the user's chosen drawing folder. Paths for new PNGs and project files are relative to it. If a chat hasn't loaded the MCP tools, the packaged [CLI](../../cli.mjs) can run the same calls using a local JSON arguments file.

- For custom art omit `subject` and provide your own strokes, washes or dots. Coordinates are normalized with y down. Points are ordered; a stroke's `width` is a multiplier of the base brush size. The built-in subjects are ready-made studies suitable for a quick demonstration.
- To overpaint an existing PNG, `base_image` provides the previous image as a base for new marks. Use a fresh `output` path for each pass. Projectless chats that provide an `outputs/` folder should place their delivered files there.
- Start an empty `.qlproject` by passing `project` with optional dimensions and surface. Pass the same `project` on later calls and select the brush for each pass. Use `oil` and `oilknife` for wet oil, or ordered `operations` for graphite, charcoal, erasing, and smudging. You can alternate painting tools while retaining their material states. Use `quiet_line_project` with `action: "dry_paint"` to dry the current oil while retaining its image and relief. Pin a checkpoint when the user wants to preserve an earlier state.
- If the preview is available, check whether the artwork meets the requested visual goal. The final PNG is at `absolutePath`. Return that image, plus the project file if the user wanted an editable painting.

Read the bundled [drawing guide](../../engine/DRAWING.md) for composition and workflow, [brush controls](../../engine/CONTROL.md) for deliberate wet or stylized strokes, [dry media](../../engine/DRY-MEDIA.md) for erase/smudge behavior, or [projects](../../engine/PROJECTS.md) for history, export, and material changes.
