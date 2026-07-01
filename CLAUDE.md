# Floor Plan Overlay

A static, dependency-free web app for comparing two property floor plans (e.g. from
Rightmove/Zoopla) by overlaying them at a matched real-world scale, plus a tool to
measure room areas.

## Running

No build step. Open `index.html` directly (`open index.html`) for everyday use — images
load via the file picker / paste / drag-drop, so there are no cross-origin issues for the
app itself. **The saved-plans Library (IndexedDB) only works reliably when the page is
served over `http(s)`** (localhost or a static host like GitHub Pages); on `file://` the
Library button is hidden. Intended to be hosted publicly.

## Files

- `index.html` — markup: toolbar, the `#stage` canvas, two plan `<section.panel>`s, the
  SVG overlay layers, the guide banner, floating toolbars, and the Library panel.
- `styles.css` — light theme; all layout and the SVG overlay styling.
- `app.js` — all app logic, wrapped in one IIFE. No modules, no framework.
- `storage.js` — `window.PlanStore`: a tiny IndexedDB wrapper for saved plans (loaded
  before `app.js`). No personal data is bundled in the repo.

## Core model

**N plans** in a dynamic stack: `plans` is an array, back-to-front (`plans[0]` is the bottom
layer; the last is on top). Plans are added/removed at runtime; **always reference a plan by
its object, never by a fixed index** (indices shift on add/remove).
```
plan = { id, name, img, areaSvg, card, slider, layer, loaded, blob, objUrl,
         tx, ty, scale, rotation, unitsPerPx, opacity, save }
```
- Each plan owns its DOM, created in `addPlan()`: a `.layer` (its `<img>` + per-plan
  `<svg.area-plan>`) in `#layers`, and a `.card` (opacity slider + remove ✕) in `#cards`.
  `removePlan()` tears it down and drops its area boxes.
- `tx/ty/scale/rotation` position the image in *world* space (rotation° about its centre).
- `unitsPerPx` = real metres per *natural* image pixel (calibration); `null` until calibrated.
- `blob` is the source image bytes (for saving); `save` = eligible to offer "Save to library".
- A single global `view = { x, y, scale }` (pan + zoom) is applied on top of every plan.

`render()` sets each image's transform to
`translate(view) scale(view) · translate(tx,ty) rotate(rotation) scale(scale)`
(transform-origin `0 0`), positions the cards, and redraws the SVG overlays.

`planToScreen(p,nx,ny)` / `screenToPlan(p,sx,sy)` take a **plan object** and convert between
its natural-pixel coords and stage-relative screen coords. Most geometry goes through these.

## Calibration (automatic)

On loading an un-calibrated plan, the app drops straight into measuring it (`continueCalibration`
finds the first loaded plan with `unitsPerPx == null`): draw a line along a known length (two
clicks, snaps to H/V within 15°), enter the real length, then a **confirm** step shows it on
the arrow and lets you pan/zoom to check (and tick **Save to library**) before committing. Esc
restarts the line. Once ≥2 plans are calibrated, `matchAll()` rescales every plan to the first
calibrated plan so equal real distances render at equal screen size. Library plans arrive
pre-calibrated (stored `unitsPerPx`) and skip measuring.

## Interaction summary

- **Load (adds a new plan each time):** paste (⌘V), drag-drop, or **Library → Add**. The
  Rightmove bookmarklet (under **Rightmove ▾**) runs on the property page and copies the
  floorplan URL to paste.
- **Library:** `storage.js` / IndexedDB. New file-loaded plans offer a **Save to library**
  checkbox in the confirm step (default on); `#lib-save` is a manual fallback for the selected
  plan. Stores image Blob + `unitsPerPx` + thumbnail. Add / rename / delete from the panel;
  persistence is requested automatically on first open. Remote-URL images can't be saved (no
  Blob / tainted canvas). **Backup:** the Library footer has **Export** (whole library →
  a self-contained JSON file; image bytes as base64 data URLs) and **Import** (restore from
  such a file — keeps original ids and overwrites matches, so re-importing is idempotent).
  See `PlanStore.exportAll` / `importAll`.
- **Move a plan:** drag it. **Remove a plan from the canvas:** the ✕ on its card (does not
  touch the library). **Pan the view:** drag empty canvas. **Zoom:** wheel or the +/− toolbar.
- **Rotate a plan:** click it to select (dashed border + rotate knob above the top edge),
  drag the knob (snaps to 90° within ~7°). No resize — plans can't be resized.
- **Opacity:** per-plan slider on the card tucked into the plan's top-left corner.
- **Measure area** (floating toolbar, top-left): click two corners to draw a rectangle; it
  auto-exits and selects the box. Boxes show width/height + m². Select for handles (8 resize +
  rotate + delete ×). Stored `{ plan, cx, cy, w, h, angle }` in the owning plan's natural-pixel
  coords. Dragging a box onto another plan re-anchors it (keeps on-screen size/angle).

## Layering & hit-testing (important gotchas)

- Each plan's `.layer` (img + its `<svg.area-plan>`) stacks in `#layers` in array order, so an
  upper plan's image **occludes lower plans' boxes** — visually and for clicks. Box hit-testing
  is **DOM-target based** (read `data-i` / classes off `e.target` per plan svg), letting the
  browser handle occlusion; only the *exposed* part of a box is clickable.
- `#layers`, `.layer`, and `.card` are `pointer-events: none` (click-through); only the
  `<img>`s and the SVG shapes are hit targets — otherwise a full-stage upper layer would
  swallow every click.
- `pointer-events` is inherited: SVG roots are `none`, so interactive shapes must set
  `pointer-events: all` explicitly (polygons, handles, `.del`, `.rot`).
- z-order: `#layers` (interleaved per-plan) < `#area-layer` (z2: drawing preview + the box
  being dragged, lifted above its plan) < `#plan-ui` (z3, plan border/rotate) ≈ `#cards` (z3)
  < calib (z4) < guide / toolbars (z5) < hint (z6) < help/library popovers (z10–11).
- A box being actively dragged is lifted to `#area-layer` so it stays visible above the
  occluding plan while you move it.

## Conventions

- Plain ES (no TS), 2-space indent, double quotes, semicolons. Match the existing style.
- Keep it a zero-dependency static site — don't add a build step or libraries.
- Geometry: work in plan-local natural pixels where possible (view/zoom-independent), convert
  to screen only for rendering/hit-testing via `planToScreen`/`screenToPlan`.
