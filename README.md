# Floor Plan Overlay

Overlay and compare property floor plans (from Rightmove, Zoopla, etc.) at a matched
real-world scale, and measure room areas — entirely in your browser.

> **Vibe-coded.** This was built quickly and iteratively with an AI assistant. Expect rough
> edges, and don't rely on the measurements for anything important.

> **Your data stays local.** Plans you add and anything you save to your library live only in
> your browser (IndexedDB). Nothing is uploaded to any server.

## Use it

It's a static site — no build, no backend. **Serve it over http(s)**, not `file://`, so the
saved-plans Library (which uses IndexedDB) works:

```sh
# from the project folder
python3 -m http.server
# then open http://localhost:8000
```

Or host it anywhere static (GitHub Pages, nginx, …).

## What it does

- **Add any number of plans** (Add plan / paste ⌘V / drag-drop / your Library) and stack them.
- **Calibrate** each plan by drawing a line on a known length and entering its real size; all
  plans are then auto-scaled to match, so equal real distances line up.
- **Move, rotate, and fade** each plan (per-plan opacity) to compare them.
- **Measure area** — draw, move, resize and rotate rectangles that read out width × height and m².
- **Library** — save calibrated plans (image + scale + calibration line) to reuse later;
  recalibrating a saved plan updates it automatically.
- **Rightmove floorplan finder bookmarklet** — a one-time bookmark that grabs a property's
  floorplan URL so you can paste it straight in.

## Files

`index.html`, `styles.css`, `app.js` (all the UI/logic), `storage.js` (IndexedDB wrapper).
See `CLAUDE.md` for an architecture overview.
