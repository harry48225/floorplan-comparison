# Floor Plan Overlay

A static, dependency-free web app for comparing two property floor plans (e.g. from
Rightmove/Zoopla) by overlaying them at a matched real-world scale, plus a tool to
measure room areas.

## Running

No build step. Open `index.html` directly (`open index.html`) for everyday use — images
load via the file picker / paste / drag-drop, so there are no cross-origin issues for the
app itself. **The saved-plans Library (IndexedDB) only works reliably when the page is
served over `http(s)`** (localhost or a static host like GitHub Pages); on `file://` the
library entry points are hidden. Intended to be hosted publicly.

## Files

- `index.html` — markup: the header (brand · tip · About), the `#stage` canvas, the SVG
  overlay layers, the guide banner, the floating toolbars (including the add-plan menu),
  the Rightmove-grab popover, and the Library/Furniture panels.
- `styles.css` — light theme; all layout and the SVG overlay styling.
- `app.js` — all app logic, wrapped in one IIFE. No modules, no framework.
- `storage.js` — `window.PlanStore`: a tiny IndexedDB wrapper for saved plans (loaded
  before `app.js`). No personal data is bundled in the repo.
- `furniture.js` — `window.Furniture = { CATALOG, ICONS }`: the standard furniture
  catalogue (real-world sizes in metres) and top-down icon schematics (loaded before
  `app.js`). Data only, no logic.

## Core model

**N plans** in a dynamic stack: `plans` is an array, back-to-front (`plans[0]` is the bottom
layer; the last is on top). Plans are added/removed at runtime; **always reference a plan by
its object, never by a fixed index** (indices shift on add/remove).
```
plan = { id, name, img, areaSvg, card, slider, layer, loaded, blob, objUrl,
         tx, ty, scale, rotation, unitsPerPx, opacity, locked, tint, save }
```
Plans keep their load order in the stack — clicking one does **not** restack it (re-parenting
a layer would invalidate its cached wall-filter and stutter the next drag).
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
clicks, snaps to H/V within 15°, with a **loupe** — a circular magnifier cloning the measured
plan's image — following the cursor for precision), enter the real length, then a **confirm**
step shows it on the arrow and lets you pan/zoom to check (and tick **Save to library**) before
committing. Esc restarts the line. Once ≥2 plans are calibrated, `matchAll()` rescales every plan to the first
calibrated plan so equal real distances render at equal screen size. Library plans arrive
pre-calibrated (stored `unitsPerPx`) and skip measuring.

## Interaction summary

- **Load (adds a new plan each time):** paste (⌘V), drag-drop, or the **＋ Add plan** menu
  at the top of the right-hand tools toolbar — **From file… / From library… / From
  Rightmove/Zoopla…**, the one home for every source (the header holds no actions). The
  empty-canvas guide leads with paste; its **Open library** button only shows when the
  library has plans (`libHasPlans`, seeded by `PlanStore.count()` at startup), and its muted
  link — like the menu's Rightmove item — opens the grab popover (`#help`).
  The Rightmove bookmarklet (`grabFloorplan`, in that popover) runs on the property page:
  it finds the floorplan(s), shows the full-res image in an injected overlay with
  "Right-click → Copy Image" instructions, and its button opens the app at `#paste` (a named
  window, reused on repeat grabs), which shows a "press ⌘V" guide state (`pasteReady`).
  Pasting the copied image delivers real bytes, so the plan is library-saveable — unlike a
  pasted image *URL*, which still loads but can't be saved. The bookmarklet is serialised
  with `toString()`, so it must stay self-contained and must contain **no `//` comments**
  (bookmarking strips newlines from the `javascript:` URL).
- **Library:** `storage.js` / IndexedDB. New file-loaded plans offer a **Save to library**
  checkbox in the confirm step (default on); `#lib-save` is a manual fallback for the selected
  plan. Stores image Blob + `unitsPerPx` + thumbnail. Add / rename / delete from the panel;
  persistence is requested automatically on first open. The footer's size readout sums the
  stored blob bytes (`navigator.storage.estimate()` reports the whole origin and is heavily
  padded in Firefox). Remote-URL images can't be saved (no
  Blob / tainted canvas). **Backup:** the Library footer has **Export** (whole library →
  a self-contained JSON file; image bytes as base64 data URLs) and **Import** (restore from
  such a file — keeps original ids and overwrites matches, so re-importing is idempotent).
  See `PlanStore.exportAll` / `importAll`.
- **Move a plan:** drag it, or **nudge the selected plan with the arrow keys** (1 screen px;
  Shift = 10). **Remove a plan from the canvas:** the ✕ on its card (does not touch the
  library; undoable via the toast). **Pan the view:** drag empty canvas. **Zoom:** wheel or
  the +/− toolbar; **⛶ fits every plan in view**.
- **Peek:** hold **Space** to hide the top plan and see what's underneath.
- **Lock:** the padlock on a plan's card pins it — locked plans are click-through
  (`pickPlan` skips them), so they can't be selected, dragged, or nudged.
- **Rotate a plan:** click it to select (dashed border + rotate knob above the top edge),
  drag the knob (snaps to 90° within ~7°). No resize — plans can't be resized.
- **Opacity:** per-plan slider on the card tucked into the plan's top-left corner. The card
  also shows a running total of the plan's measured rooms (`N rooms · X m²`). Opacity is
  **differential** — the walls fade slower than the rest, so structure stays legible as a
  plan goes sheer: rest opacity = slider `o`, wall opacity = `1 − (1 − o)⁵` (e.g. at o=0.5
  the rooms are 50% transparent but the walls only ~3%). Both hit 0 at o=0 and 1 at o=1.
- **Tint:** every new plan auto-takes the least-used palette colour (`p.tint` = index into
  `TINTS` | null, assigned in `addPlan`). The coloured dot on the plan's card opens an inline
  swatch row (5 colours + ✕ none) to change or disable it.
- **Wall filter** (tint + differential opacity share one per-plan SVG filter `#fx-<id>`,
  created in `addPlan`, rebuilt by `updatePlanFilter` only when opacity or tint change — never
  in `render`). A dark-pixel alpha **wall mask** is morphologically opened (erode→dilate,
  radius 1, natural-px user space) so thin dark features — room labels, dimension lines — drop
  out, leaving the walls. The image is then split into a wall layer (flood colour if tinted,
  else original; alpha × wall opacity) composited `in` the mask, and a rest layer (original;
  alpha × rest opacity) composited `out` the mask, and the two are merged. No filter is
  attached when a plan is fully opaque and untinted. The loupe clone clears its filter so it
  magnifies the raw plan.
- **Undo:** removing a plan or deleting an area/tape/furniture shows a one-slot undo toast
  (`offerUndo`, 8 s). Plan removal is a *soft* delete — DOM lingers hidden until finalized.
- **Scale bar** (`#scale-bar`, bottom, left of the zoom buttons): a dynamic Google-Maps-style
  bar — one shared baseline with a metric tick + label above and an imperial tick + label below
  (measured from a shared right-hand origin) — redrawn each `render()` by `updateScaleBar()`.
  Screen px per metre = `view.scale · p.scale / unitsPerPx` (equal across matched plans); each
  picks a nice 1/2/5 ×10ⁿ distance ≤100 px, labelled in m/cm and ft/in (via `niceRound`).
  Hidden until at least one plan is calibrated.
- **Tools toolbar** (floating, top-right): ＋ Add plan (with its dropdown menu), then the
  three tools — Measure area, Tape measure, Furniture — each with an inline-SVG icon. The
  tool buttons are **disabled until some plan is loaded and calibrated**; `render()` also
  disarms an armed tool if that last calibrated plan is removed.
- **Measure area**: click two corners to draw a rectangle; it
  auto-exits and selects the box. Boxes show width/height + m². Select for handles (8 resize +
  rotate + delete ×). Stored `{ kind:"area", plan, cx, cy, w, h, angle }` in the owning plan's
  natural-pixel coords. Dragging a box onto another plan re-anchors it (keeps on-screen
  size/angle).
- **Tape measure** (next to Measure area): click two points for a point-to-point distance —
  snaps to the plan's H/V axes within 15° (`planSnap`, in plan coords so it follows plan
  rotation), auto-exits, and draws as a double-ended arrow labelled in metres. Stored
  alongside the boxes as
  `{ kind:"tape", plan, ax, ay, bx, by }`; select to drag its endpoints or delete, drag the
  line to move (re-anchors by its midpoint). The area and tape draw tools are mutually
  exclusive.
- **Furniture** (right-hand toolbar → **Furniture** palette): picking a catalogue item *arms*
  placement (`furnPlacing`) — a ghost follows the cursor and the next canvas click drops the
  real-world-sized piece, anchored to the plan under the cursor (Esc cancels). You can also
  **press-and-drag** an item straight from the palette onto the canvas: pointerdown arms it,
  the ghost follows, and it drops on pointerup over the stage (same armed state, dropped on
  release instead of a click). The Furniture
  and Library panels sit in the same top-right spot and are mutually exclusive (opening one
  closes the other; both live outside `#stage` so their clicks/scroll don't reach the canvas). A
  furniture piece is just an area box with `kind:"furniture"` (plus `label`, `icon`) — it
  reuses all the move/rotate/re-anchor machinery, so `w/h` are still the plan's natural pixels
  (`realMetres / unitsPerPx`). It's **locked to its real size** (rotate/delete only, no resize)
  and shows its name + dimensions only while selected/placing (the schematic identifies it
  otherwise); both labels are stacked upright in screen space (name, then dimensions 16px
  below) so they never rotate with the piece or overlap. `furniture.js` holds the catalogue
  (metres) and per-item icon schematics authored in a unit box; `boxIconSVG` affine-maps the
  icon onto the placed rectangle (`vector-effect: non-scaling-stroke`) so it scales/rotates
  with the piece. Placements are transient — not saved to the library.

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
- The toolbar buttons' icon SVGs are `pointer-events: none`, so the outside-click handlers'
  `e.target` checks (add menu, panels, popover) always see the `<button>` itself.
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
