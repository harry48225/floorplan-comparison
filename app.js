(() => {
  "use strict";

  // ---- State ----
  // Dynamic stack of plans, back-to-front (plans[0] is the bottom layer).
  // Each plan owns its DOM: a .layer (img + per-plan area svg) and a .card
  // (opacity slider + remove button). Coords below are in *world* space.
  // plan = { id, name, img, areaSvg, card, slider, layer, loaded, blob, objUrl,
  //          tx, ty, scale, rotation, unitsPerPx, opacity, save }
  const plans = [];
  let nextId = 1;

  // Global view transform applied on top of every plan (pan + zoom together).
  const view = { x: 0, y: 0, scale: 1 };

  // Area-measuring tool. Boxes are stored in their plan's natural-pixel coords
  // (anchored to a plan *object*), so they track that plan and their m² is
  // view-independent. box = { plan, cx, cy, w, h, angle }.
  let areaTool = false;
  let areaDraw = null; // { plan, x1, y1 } while placing the second corner
  let areaCursor = null; // { nx, ny } live second corner
  let areaMove = null; // { index, lastSx, lastSy }
  let areaResize = null; // { index, sx, sy } (which corner/edge, -1|0|1)
  let areaRotate = null; // { index }
  let selected = null; // index into areas[] of the box in edit mode, or null
  const areas = [];
  let furnPlacing = null; // { item, sx, sy } while placing a furniture piece

  // Local→plan offsets for the 8 resize handles (and their resize cursors).
  const RESIZE_HANDLES = [
    { sx: -1, sy: -1, cursor: "nwse-resize" },
    { sx: 1, sy: -1, cursor: "nesw-resize" },
    { sx: 1, sy: 1, cursor: "nwse-resize" },
    { sx: -1, sy: 1, cursor: "nesw-resize" },
    { sx: 0, sy: -1, cursor: "ns-resize" },
    { sx: 1, sy: 0, cursor: "ew-resize" },
    { sx: 0, sy: 1, cursor: "ns-resize" },
    { sx: -1, sy: 0, cursor: "ew-resize" },
  ];

  let selectedPlan = null; // plan object showing its rotate handle, or null
  let planRotating = false; // dragging a plan's rotate knob
  let addingPlan = false; // showing the "add a plan" prompt on demand

  // Calibration: idle -> measuring a plan -> confirm pending -> applied.
  let calibPlan = null; // plan object being measured, or null
  let calibPts = [];
  let calibPending = null; // { plan, real, naturalLen, la, lb } awaiting confirm
  let calibCancelable = false; // true when re-measuring an already-calibrated plan
  let showCalibFor = null; // plan whose stored calibration line is being shown

  // ---- DOM ----
  const stage = document.getElementById("stage");
  const layersEl = document.getElementById("layers");
  const cardsEl = document.getElementById("cards");
  const areaSvg = document.getElementById("area-layer");
  const planUiSvg = document.getElementById("plan-ui");
  const calibSvg = document.getElementById("calib-layer");
  const areaBtn = document.getElementById("area-btn");
  const furnitureBtn = document.getElementById("furniture-btn");
  const furniturePanel = document.getElementById("furniture");
  const furnGrid = document.getElementById("furn-grid");
  const hint = document.getElementById("hint");
  const guide = document.getElementById("guide");
  const guideTitle = guide.querySelector(".guide-title");
  const guideBody = guide.querySelector(".guide-body");
  const confirmRow = document.getElementById("confirm-row");
  const saveLibRow = document.getElementById("save-lib-row");
  const saveLibCheck = document.getElementById("save-lib");
  const saveLibNote = document.getElementById("save-lib-note");
  const guideAddRow = document.getElementById("guide-add-row");
  const guideFileBtn = document.getElementById("guide-file");
  const guideLibBtn = document.getElementById("guide-library");

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const calibrating = () => calibPlan !== null;
  const formatLen = (n) => String(Math.round(n * 1000) / 1000);
  const SVGNS = "http://www.w3.org/2000/svg";

  // ---- Plan lifecycle ----
  function addPlan(opts = {}) {
    addingPlan = false; // a plan is being added; dismiss the prompt
    const id = nextId++;
    const layer = document.createElement("div");
    layer.className = "layer";
    const img = document.createElement("img");
    img.draggable = false;
    img.hidden = true;
    const planSvg = document.createElementNS(SVGNS, "svg");
    planSvg.setAttribute("class", "area-plan");
    layer.append(img, planSvg);
    layersEl.appendChild(layer);

    const card = document.createElement("div");
    card.className = "card";
    const nameEl = document.createElement("span");
    nameEl.className = "card-name";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = 0;
    slider.max = 100;
    slider.className = "card-opacity";
    const recalBtn = document.createElement("button");
    recalBtn.className = "card-recal hidden";
    recalBtn.type = "button";
    recalBtn.textContent = "📏 Recalibrate";
    recalBtn.title = "Redraw the line to set a new scale";
    const showBtn = document.createElement("button");
    showBtn.className = "card-show hidden";
    showBtn.type = "button";
    showBtn.textContent = "Show calibration";
    showBtn.title = "Show the calibration line on this plan";
    const saveBtn = document.createElement("button");
    saveBtn.className = "card-save hidden";
    saveBtn.type = "button";
    saveBtn.innerHTML = '<span class="card-dot"></span>Save to library';
    saveBtn.title = "This plan isn't saved — click to add it to your library";
    const del = document.createElement("button");
    del.className = "card-del";
    del.type = "button";
    del.textContent = "✕";
    del.title = "Remove this plan from the comparison";
    card.append(nameEl, slider, recalBtn, showBtn, saveBtn, del);
    cardsEl.appendChild(card);

    const opacity = opts.opacity != null ? opts.opacity : plans.length === 0 ? 1 : 0.6;
    const p = {
      id,
      name: opts.name || `Plan ${id}`,
      img,
      areaSvg: planSvg,
      card,
      nameEl,
      slider,
      saveBtn,
      recalBtn,
      showBtn,
      layer,
      loaded: false,
      blob: null,
      objUrl: null,
      libId: null, // library record id, once saved/loaded from it
      calibLine: null, // { la, lb, real } stored calibration line
      created: null,
      tx: 0,
      ty: 0,
      scale: 1,
      rotation: 0,
      unitsPerPx: null,
      opacity,
      save: !!opts.save,
    };
    slider.value = opacity * 100;

    slider.addEventListener("input", () => {
      p.opacity = slider.value / 100;
      render();
    });
    slider.addEventListener("pointerdown", (e) => e.stopPropagation());
    del.addEventListener("pointerdown", (e) => e.stopPropagation());
    del.addEventListener("click", () => removePlan(p));
    saveBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    saveBtn.addEventListener("click", () => saveToLibrary(p));
    recalBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    recalBtn.addEventListener("click", () => {
      if (calibrating()) return;
      selected = null;
      selectedPlan = null;
      showCalibFor = null;
      beginMeasure(p); // redraw the line to set a new scale
    });
    showBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    showBtn.addEventListener("click", () => {
      showCalibFor = showCalibFor === p ? null : p;
      render();
    });

    planSvg.addEventListener("pointerdown", areaEditDown);
    planSvg.addEventListener("pointermove", areaEditMove);
    planSvg.addEventListener("pointerup", areaEditUp);
    planSvg.addEventListener("pointercancel", areaEditUp);

    plans.push(p);
    return p;
  }

  function removePlan(p) {
    if (calibPlan === p) endMeasure();
    if (p.objUrl) URL.revokeObjectURL(p.objUrl);
    p.layer.remove();
    p.card.remove();
    const idx = plans.indexOf(p);
    if (idx >= 0) plans.splice(idx, 1);
    for (let k = areas.length - 1; k >= 0; k--) if (areas[k].plan === p) areas.splice(k, 1);
    if (selectedPlan === p) selectedPlan = null;
    if (showCalibFor === p) showCalibFor = null;
    selected = null;
    render();
    continueCalibration(); // a still-uncalibrated plan may now need measuring
  }

  // ---- Loading images ----
  function setImageSrc(p, src, upp = null, blob = null) {
    if (p.objUrl) URL.revokeObjectURL(p.objUrl);
    p.objUrl = src.startsWith("blob:") ? src : null;
    p.pendingUpp = upp;
    p.blob = blob;
    p.img.onload = () => onImageLoaded(p);
    p.img.onerror = () => {
      showHint("That image failed to load.", 3000);
      removePlan(p);
    };
    p.img.src = src;
  }

  function onImageLoaded(p) {
    p.loaded = true;
    p.scale = fitScale(p);
    p.rotation = 0;
    centre(p);
    p.unitsPerPx = p.pendingUpp;
    p.img.hidden = false;
    render();
    continueCalibration();
  }

  // Add a brand-new plan from a user-supplied file (eligible to be saved).
  function loadFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const p = addPlan({ save: true });
    const reader = new FileReader();
    reader.onload = () => setImageSrc(p, reader.result, null, file);
    reader.readAsDataURL(file);
  }

  // Direct image URL (e.g. pasted from the bookmarklet). Can't be saved (CORS).
  function loadFromUrl(url) {
    url = url.trim();
    if (/\.(jpe?g|png|gif|webp)(\?|#|$)/i.test(url)) {
      const p = addPlan({ save: false });
      p.fromUrl = true; // can't be saved to the library (no readable Blob)
      p.url = url;
      setImageSrc(p, url, null, null);
      showHint("Loading image…", 1500);
      return;
    }
    showHint('Paste a floorplan image URL, or use the “Grab Floorplan” bookmarklet.', 4500);
  }

  // Scale so the image fits ~90% of the stage.
  function fitScale(p) {
    const r = stage.getBoundingClientRect();
    return Math.min((r.width * 0.9) / p.img.naturalWidth, (r.height * 0.9) / p.img.naturalHeight, 1) || 1;
  }

  // Centre a plan within the stage at its current scale.
  function centre(p) {
    const r = stage.getBoundingClientRect();
    p.tx = (r.width - p.img.naturalWidth * p.scale) / 2;
    p.ty = (r.height - p.img.naturalHeight * p.scale) / 2;
  }

  // ---- Coordinate helpers: plan natural-pixel space <-> stage screen space.
  function planToScreen(p, nx, ny) {
    const a = (p.rotation * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const wx = p.tx + p.scale * (cos * nx - sin * ny);
    const wy = p.ty + p.scale * (sin * nx + cos * ny);
    return { x: view.x + view.scale * wx, y: view.y + view.scale * wy };
  }
  function screenToPlan(p, sx, sy) {
    const wx = (sx - view.x) / view.scale;
    const wy = (sy - view.y) / view.scale;
    const dx = wx - p.tx;
    const dy = wy - p.ty;
    const a = (p.rotation * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return { nx: (cos * dx + sin * dy) / p.scale, ny: (-sin * dx + cos * dy) / p.scale };
  }
  function planCentreScreen(p) {
    return planToScreen(p, p.img.naturalWidth / 2, p.img.naturalHeight / 2);
  }

  // ---- Rendering ----
  function render() {
    stage.classList.toggle("confirming", !!calibPending);
    stage.classList.toggle("placing", !!furnPlacing);

    plans.forEach((p) => {
      if (!p.loaded) return;
      p.img.style.transform =
        `translate(${view.x}px, ${view.y}px) scale(${view.scale}) ` +
        `translate(${p.tx}px, ${p.ty}px) rotate(${p.rotation}deg) scale(${p.scale})`;
      p.img.style.opacity = p.opacity;
      positionCard(p);
    });

    renderAreas();
    renderPlanUI();

    if (calibPending) {
      const a = planToScreen(calibPending.plan, calibPending.la.nx, calibPending.la.ny);
      const b = planToScreen(calibPending.plan, calibPending.lb.nx, calibPending.lb.ny);
      drawLine(a, b, `${formatLen(calibPending.real)} m`);
    } else if (!calibrating()) {
      // Outside measuring: optionally show a plan's stored calibration line.
      const sp = showCalibFor;
      if (sp && sp.loaded && sp.calibLine) {
        const a = planToScreen(sp, sp.calibLine.la.nx, sp.calibLine.la.ny);
        const b = planToScreen(sp, sp.calibLine.lb.nx, sp.calibLine.lb.ny);
        calibSvg.classList.remove("hidden");
        calibSvg.classList.add("readonly");
        drawLine(a, b, `${formatLen(sp.calibLine.real)} m`);
      } else {
        calibSvg.classList.add("hidden");
        calibSvg.classList.remove("readonly");
        calibSvg.innerHTML = "";
      }
    }

    updateGuide();
  }

  // Tuck a plan's card just inside its top-left (0,0) corner.
  function positionCard(p) {
    p.card.classList.toggle("show", p.loaded);
    if (!p.loaded) return;
    p.nameEl.textContent = p.name;
    // Recalibrate once calibrated; show-calibration when a line is stored;
    // save when savable + unsaved.
    p.recalBtn.classList.toggle("hidden", p.unitsPerPx == null);
    p.showBtn.classList.toggle("hidden", !p.calibLine);
    p.showBtn.textContent = showCalibFor === p ? "Hide calibration" : "Show calibration";
    p.saveBtn.classList.toggle("hidden", !(canSave(p) && p.unitsPerPx != null));

    const r = stage.getBoundingClientRect();
    const bw = p.card.offsetWidth || 90;
    const bh = p.card.offsetHeight || 28;
    const corner = planToScreen(p, 0, 0);
    const ctr = planCentreScreen(p);
    const pad = 4;
    const left = ctr.x >= corner.x ? corner.x + pad : corner.x - bw - pad;
    const top = ctr.y >= corner.y ? corner.y + pad : corner.y - bh - pad;
    p.card.style.left = clamp(left, 4, r.width - bw - 4) + "px";
    p.card.style.top = clamp(top, 4, r.height - bh - 4) + "px";
  }

  // ---- Guide / onboarding ----
  function updateGuide() {
    let title = "";
    let body = "";
    let show = true;
    let confirm = false;
    let adding = false;

    if (calibPending) {
      confirm = true;
      title = "Does this look right?";
      body = `That line is set to ${formatLen(calibPending.real)} m. Confirm to set the scale, or redo it.`;
    } else if (calibrating()) {
      title = `Set the scale of ${calibPlan.name}`;
      body = "Draw a line along a known length (e.g. a labelled wall), then enter its real length. Press Esc to start the line over.";
    } else if (addingPlan || !plans.some((p) => p.loaded)) {
      adding = true;
      title = plans.some((p) => p.loaded) ? "Add another floor plan" : "Add your first floor plan";
      body = "Paste (⌘V), drop an image here, choose a file, or open your Library.";
    } else {
      show = false; // plans loaded; nothing to prompt
    }

    guide.classList.toggle("hidden", !show);
    confirmRow.classList.toggle("hidden", !confirm);
    // In the confirm step: show the save checkbox if savable, else (for a
    // URL-loaded plan that can't be saved) explain why.
    const showSave = confirm && canSave(calibPending.plan);
    const showNote = confirm && !canSave(calibPending.plan) && calibPending.plan.fromUrl;
    saveLibRow.classList.toggle("hidden", !showSave);
    saveLibNote.classList.toggle("hidden", !showNote);
    if (showNote) {
      const u = escapeHtml(calibPending.plan.url || "");
      saveLibNote.innerHTML =
        `Loaded from a URL, so it can't be saved directly. ` +
        `<a href="${u}" target="_blank" rel="noopener">Open the image</a>, right-click → ` +
        `Copy image, then come back and paste it here to save it to your library.`;
    }
    guideAddRow.classList.toggle("hidden", !adding);
    guideTitle.textContent = title;
    guideBody.textContent = body;
  }

  // ---- Dragging: drag a plan to move it; drag empty canvas to pan the view.
  let drag = null; // null | {kind:"view"} | {kind:"plan", plan}
  let lastX = 0;
  let lastY = 0;

  function startDrag(e, d) {
    drag = d;
    lastX = e.clientX;
    lastY = e.clientY;
    stage.setPointerCapture(e.pointerId);
  }

  // True if the cursor is over plan p's image (inverts view + plan transforms).
  function planAt(p, e) {
    if (!p.loaded) return false;
    const r = stage.getBoundingClientRect();
    const loc = screenToPlan(p, e.clientX - r.left, e.clientY - r.top);
    return loc.nx >= 0 && loc.nx <= p.img.naturalWidth && loc.ny >= 0 && loc.ny <= p.img.naturalHeight;
  }

  // Topmost plan under the cursor, else null.
  function pickPlan(e) {
    for (let k = plans.length - 1; k >= 0; k--) if (planAt(plans[k], e)) return plans[k];
    return null;
  }

  stage.addEventListener("pointerdown", (e) => {
    if (
      (calibrating() && !calibPending) ||
      areaTool ||
      e.target.closest("#guide") ||
      e.target.closest(".card") ||
      e.target.closest(".zoom-toolbar") ||
      e.target.closest(".tools-toolbar") ||
      e.target.closest(".library-fab")
    )
      return;
    if (furnPlacing) {
      const r = stage.getBoundingClientRect();
      placeFurnitureAt(e.clientX - r.left, e.clientY - r.top);
      return;
    }
    if (calibPending) {
      startDrag(e, { kind: "view" }); // while confirming, dragging pans the view
      return;
    }
    const p = pickPlan(e);
    selected = null;
    selectedPlan = p; // clicking a plan selects it; empty canvas deselects
    addingPlan = false; // clicking the canvas dismisses the add prompt
    render();
    startDrag(e, p ? { kind: "plan", plan: p } : { kind: "view" });
  });

  // Furniture placement ghost: track the cursor over the canvas and redraw.
  stage.addEventListener("pointermove", (e) => {
    if (!furnPlacing) return;
    const r = stage.getBoundingClientRect();
    furnPlacing.sx = e.clientX - r.left;
    furnPlacing.sy = e.clientY - r.top;
    render();
  });

  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (drag.kind === "view") {
      view.x += dx;
      view.y += dy;
    } else {
      drag.plan.tx += dx / view.scale;
      drag.plan.ty += dy / view.scale;
    }
    lastX = e.clientX;
    lastY = e.clientY;
    render();
  });

  const endDrag = (e) => {
    if (!drag) return;
    drag = null;
    try {
      stage.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // Releasing a piece dragged from the palette over the canvas drops it here.
  // (Click-to-place drops on pointerdown, which has already cleared furnPlacing.)
  stage.addEventListener("pointerup", (e) => {
    if (!furnPlacing) return;
    const r = stage.getBoundingClientRect();
    placeFurnitureAt(e.clientX - r.left, e.clientY - r.top);
  });

  stage.addEventListener(
    "wheel",
    (e) => {
      if (calibrating() && !calibPending) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomView(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false }
  );

  function zoomView(factor, px, py) {
    const ns = clamp(view.scale * factor, 0.1, 10);
    view.x = px - (ns / view.scale) * (px - view.x);
    view.y = py - (ns / view.scale) * (py - view.y);
    view.scale = ns;
    render();
  }

  // ---- Area measuring tool ----
  function boxPoint(a, sx, sy) {
    const r = (a.angle * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const lx = (sx * a.w) / 2;
    const ly = (sy * a.h) / 2;
    return { nx: a.cx + lx * cos - ly * sin, ny: a.cy + lx * sin + ly * cos };
  }
  function boxCorners(a) {
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
      const pt = boxPoint(a, sx, sy);
      return planToScreen(a.plan, pt.nx, pt.ny);
    });
  }
  function boxPolygonSVG(a, k) {
    const c = boxCorners(a);
    const di = k == null ? "" : ` data-i="${k}"`;
    const cls = a.kind === "furniture" ? "abox furn" : "abox";
    return `<polygon class="${cls}"${di} points="${c.map((q) => `${q.x},${q.y}`).join(" ")}"></polygon>`;
  }
  // A furniture piece's schematic, affine-mapped from its unit-box icon onto the
  // placed rectangle (so it scales/rotates with the piece). Not interactive.
  function boxIconSVG(a) {
    const icon = window.Furniture && Furniture.ICONS[a.icon];
    if (!icon) return "";
    const c = boxCorners(a); // [tl, tr, br, bl] for local (-1,-1),(1,-1),(1,1),(-1,1)
    const A = c[1].x - c[0].x;
    const B = c[1].y - c[0].y;
    const C = c[3].x - c[0].x;
    const D = c[3].y - c[0].y;
    return `<g class="furn-icon" transform="matrix(${A} ${B} ${C} ${D} ${c[0].x} ${c[0].y})">${icon}</g>`;
  }
  // Area boxes show width/height + m². Furniture shows its name, plus its real
  // dimensions while selected/being moved (showDims).
  function boxLabelsSVG(a, showDims) {
    const upp = a.plan.unitsPerPx;
    const ctr = planToScreen(a.plan, a.cx, a.cy);
    if (a.kind === "furniture") {
      // Labels only while selected/placed — the schematic identifies it otherwise.
      if (!showDims) return "";
      // Stack both upright in screen space (name, then dimensions just below) so
      // they don't rotate with the piece or overlap each other at any angle.
      return (
        `<text x="${ctr.x}" y="${ctr.y}" class="furn-name">${escapeHtml(a.label)}</text>` +
        `<text x="${ctr.x}" y="${ctr.y + 16}" class="furn-dim">${(a.w * upp).toFixed(2)} × ${(a.h * upp).toFixed(2)} m</text>`
      );
    }
    const c = boxCorners(a);
    const mid = (u, v) => ({ x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 });
    const w = mid(c[0], c[1]);
    const h = mid(c[0], c[3]);
    const wM = a.w * upp;
    const hM = a.h * upp;
    return (
      `<text x="${w.x}" y="${w.y}">${wM.toFixed(2)} m</text>` +
      `<text x="${h.x}" y="${h.y}">${hM.toFixed(2)} m</text>` +
      `<text x="${ctr.x}" y="${ctr.y}" class="area">${(wM * hM).toFixed(2)} m²</text>`
    );
  }
  function boxHandlesSVG(a, k) {
    const hs = 4.5;
    let s = "";
    // Furniture is locked to its real size — rotate/delete only, no resize.
    if (a.kind !== "furniture") {
      for (const hd of RESIZE_HANDLES) {
        const pt = boxPoint(a, hd.sx, hd.sy);
        const c = planToScreen(a.plan, pt.nx, pt.ny);
        s += `<rect class="handle" data-i="${k}" data-sx="${hd.sx}" data-sy="${hd.sy}" x="${c.x - hs}" y="${c.y - hs}" width="${2 * hs}" height="${2 * hs}" style="cursor:${hd.cursor}"></rect>`;
      }
    }
    const ctr = planToScreen(a.plan, a.cx, a.cy);
    const outward = (pt, dist) => {
      const c = planToScreen(a.plan, pt.nx, pt.ny);
      const dx = c.x - ctr.x;
      const dy = c.y - ctr.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: c.x + (dx / len) * dist, y: c.y + (dy / len) * dist, ax: c.x, ay: c.y };
    };
    const rot = outward(boxPoint(a, 0, -1), 24);
    s += `<line class="rot-stem" x1="${rot.ax}" y1="${rot.ay}" x2="${rot.x}" y2="${rot.y}"></line>`;
    s += `<circle class="rot" data-i="${k}" cx="${rot.x}" cy="${rot.y}" r="7"></circle>`;
    const d = outward(boxPoint(a, 1, -1), 16);
    const o = 3.5;
    s += `<circle class="del" data-i="${k}" cx="${d.x}" cy="${d.y}" r="9"></circle>`;
    s += `<line class="del-x" x1="${d.x - o}" y1="${d.y - o}" x2="${d.x + o}" y2="${d.y + o}"></line>`;
    s += `<line class="del-x" x1="${d.x - o}" y1="${d.y + o}" x2="${d.x + o}" y2="${d.y - o}"></line>`;
    return s;
  }

  function renderAreas() {
    const byPlan = new Map(plans.map((p) => [p, ""]));
    let top = "";
    const activeBox = areaMove
      ? areas[areaMove.index]
      : areaResize
      ? areas[areaResize.index]
      : areaRotate
      ? areas[areaRotate.index]
      : null;

    areas.forEach((a, k) => {
      if (!a.plan.loaded || a.plan.unitsPerPx == null) return;
      const sel = k === selected && !areaDraw;
      let s = boxPolygonSVG(a, k);
      if (a.kind === "furniture") s += boxIconSVG(a);
      if (sel) s += boxHandlesSVG(a, k);
      s += boxLabelsSVG(a, sel);
      if (a === activeBox) top += s; // lift the dragged box above everything
      else byPlan.set(a.plan, byPlan.get(a.plan) + s);
    });

    plans.forEach((p) => {
      p.areaSvg.innerHTML = byPlan.get(p) || "";
    });

    if (areaDraw && areaCursor) {
      const a = drawingBox();
      if (a.plan.loaded && a.plan.unitsPerPx != null) top += boxPolygonSVG(a, null) + boxLabelsSVG(a);
    }
    const ghost = furnGhostBox();
    if (ghost) top += boxPolygonSVG(ghost, null) + boxIconSVG(ghost) + boxLabelsSVG(ghost, true);
    areaSvg.innerHTML = top;
  }

  function drawingBox() {
    return {
      kind: "area",
      plan: areaDraw.plan,
      cx: (areaDraw.x1 + areaCursor.nx) / 2,
      cy: (areaDraw.y1 + areaCursor.ny) / 2,
      w: Math.abs(areaCursor.nx - areaDraw.x1),
      h: Math.abs(areaCursor.ny - areaDraw.y1),
      angle: 0,
    };
  }

  // Topmost loaded+calibrated plan whose image contains the point, else null.
  function planUnderPoint(sx, sy) {
    for (let k = plans.length - 1; k >= 0; k--) {
      const p = plans[k];
      if (!p.loaded || p.unitsPerPx == null) continue;
      const loc = screenToPlan(p, sx, sy);
      if (loc.nx >= 0 && loc.nx <= p.img.naturalWidth && loc.ny >= 0 && loc.ny <= p.img.naturalHeight)
        return p;
    }
    return null;
  }
  function pickAreaPlan(sx, sy) {
    return planUnderPoint(sx, sy) || plans.find((p) => p.loaded && p.unitsPerPx != null) || null;
  }

  // After a move, lock the box to whichever plan its centre now sits over.
  function reanchorArea(a) {
    const ctr = planToScreen(a.plan, a.cx, a.cy);
    const target = planUnderPoint(ctr.x, ctr.y);
    if (!target || target === a.plan) return;
    const scaleRatio = a.plan.scale / target.scale;
    const nc = screenToPlan(target, ctr.x, ctr.y);
    a.angle += a.plan.rotation - target.rotation;
    a.w *= scaleRatio;
    a.h *= scaleRatio;
    a.cx = nc.nx;
    a.cy = nc.ny;
    a.plan = target;
  }

  function setAreaTool(on) {
    areaTool = on;
    areaDraw = null;
    areaCursor = null;
    if (on) {
      selected = null;
      furnPlacing = null; // don't leave a furniture ghost armed under the area tool
    }
    areaBtn.classList.toggle("active", on);
    areaSvg.classList.toggle("active", on);
    if (on) showHint("Click two corners to measure a room.", 3200);
    else hideHint();
    render();
  }

  // ---- Furniture: place a real-world-sized piece from the catalogue. ----
  // A furniture item is an area box with kind:"furniture" — it reuses the same
  // move/rotate/re-anchor machinery, but at a fixed real size and locked to it.
  // Picking one arms placement (furnPlacing): a ghost follows the cursor and the
  // next canvas click drops it. Esc cancels.
  function furnitureBox(item, p, nx, ny) {
    return {
      kind: "furniture",
      label: item.name,
      icon: item.icon,
      plan: p,
      cx: nx,
      cy: ny,
      w: item.w / p.unitsPerPx,
      h: item.h / p.unitsPerPx,
      angle: -p.rotation, // sit axis-aligned regardless of the plan's rotation
    };
  }

  function armFurniture(item) {
    if (!plans.some((p) => p.loaded && p.unitsPerPx != null)) {
      showHint("Calibrate a plan first, then add furniture.", 3200);
      return;
    }
    if (areaTool) setAreaTool(false);
    furnPlacing = { item, sx: null, sy: null };
    selected = null;
    selectedPlan = null;
    showHint(`Click or drag onto the plan to place the ${item.name}. Esc to cancel.`, 5000);
    render();
  }

  // The furniture ghost for the current cursor position, or null if off-plan.
  function furnGhostBox() {
    if (!furnPlacing || furnPlacing.sx == null) return null;
    const p = pickAreaPlan(furnPlacing.sx, furnPlacing.sy);
    if (!p) return null;
    const loc = screenToPlan(p, furnPlacing.sx, furnPlacing.sy);
    return furnitureBox(furnPlacing.item, p, loc.nx, loc.ny);
  }

  function placeFurnitureAt(sx, sy) {
    const item = furnPlacing.item;
    const p = pickAreaPlan(sx, sy);
    furnPlacing = null;
    if (!p) {
      showHint("Calibrate a plan first, then add furniture.", 3200);
      render();
      return;
    }
    const loc = screenToPlan(p, sx, sy);
    areas.push(furnitureBox(item, p, loc.nx, loc.ny));
    selected = areas.length - 1;
    selectedPlan = null;
    showHint(`Placed ${item.name}. Drag to move, use the knob to rotate.`, 2600);
    render();
  }

  function buildFurniturePalette() {
    furnGrid.innerHTML = Furniture.CATALOG.map(
      (group) =>
        `<div class="furn-cat">${escapeHtml(group.category)}</div>` +
        group.items
          .map(
            (it) =>
              `<button class="furn-item" type="button" data-id="${it.id}">` +
              `<svg class="furn-ic" viewBox="0 0 1 1" aria-hidden="true">${Furniture.ICONS[it.icon] || ""}</svg>` +
              `<span class="furn-item-name">${escapeHtml(it.name)}</span>` +
              `<span class="furn-item-dim">${it.w.toFixed(2)} × ${it.h.toFixed(2)} m</span>` +
              `</button>`
          )
          .join("")
    ).join("");
  }

  const furnById = {};
  Furniture.CATALOG.forEach((g) => g.items.forEach((it) => (furnById[it.id] = it)));

  // Arm a piece from the palette. pointerdown enables press-and-drag straight onto
  // the canvas (the armed ghost follows the cursor, drops on release); click keeps
  // the click-to-arm-then-click-to-place flow (and keyboard activation).
  function armFromEvent(e) {
    const btn = e.target.closest(".furn-item");
    if (!btn) return;
    const item = furnById[btn.dataset.id];
    if (item) armFurniture(item);
  }
  furnGrid.addEventListener("pointerdown", armFromEvent);
  furnGrid.addEventListener("click", armFromEvent);

  function openFurniture() {
    if (!furnGrid.childElementCount) buildFurniturePalette();
    closeLibrary(); // the two right-hand panels are mutually exclusive
    furniturePanel.classList.remove("hidden");
    furnitureBtn.classList.add("active");
  }
  function closeFurniture() {
    furniturePanel.classList.add("hidden");
    furnitureBtn.classList.remove("active");
  }
  furnitureBtn.addEventListener("click", () => {
    if (furniturePanel.classList.contains("hidden")) openFurniture();
    else closeFurniture();
  });
  document.getElementById("furn-close").addEventListener("click", closeFurniture);

  // Drawing a new box: the top layer captures clicks while the tool is on.
  areaSvg.addEventListener("pointerdown", (e) => {
    if (!areaTool || calibrating()) return;
    e.stopPropagation();
    const r = areaSvg.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    if (!areaDraw) {
      const p = pickAreaPlan(sx, sy);
      if (!p) {
        showHint("Calibrate a plan first.", 2500);
        return;
      }
      const loc = screenToPlan(p, sx, sy);
      areaDraw = { plan: p, x1: loc.nx, y1: loc.ny };
      areaCursor = { nx: loc.nx, ny: loc.ny };
    } else {
      areaCursor = screenToPlan(areaDraw.plan, sx, sy);
      areas.push(drawingBox());
      areaDraw = null;
      areaCursor = null;
      areaTool = false;
      areaBtn.classList.remove("active");
      areaSvg.classList.remove("active");
      selected = areas.length - 1;
      hideHint();
    }
    render();
  });

  areaSvg.addEventListener("pointermove", (e) => {
    if (!areaDraw) return;
    const r = areaSvg.getBoundingClientRect();
    areaCursor = screenToPlan(areaDraw.plan, e.clientX - r.left, e.clientY - r.top);
    render();
  });

  // Editing existing boxes (DOM-target based, on each plan's own svg).
  function areaEditDown(e) {
    if (areaTool || calibrating()) return;
    const t = e.target;
    if (!t.dataset || t.dataset.i == null) return;
    e.stopPropagation();
    const k = Number(t.dataset.i);
    const r = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    if (t.classList.contains("del")) {
      areas.splice(k, 1);
      selected = null;
      render();
      return;
    }
    selected = k;
    selectedPlan = null;
    if (t.classList.contains("rot")) {
      areaRotate = { index: k };
    } else if (t.classList.contains("handle")) {
      areaResize = { index: k, sx: Number(t.dataset.sx), sy: Number(t.dataset.sy) };
    } else {
      areaMove = { index: k, lastSx: sx, lastSy: sy };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    render();
  }

  function areaEditMove(e) {
    if (!areaResize && !areaMove && !areaRotate) return;
    const r = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    if (areaRotate) {
      const a = areas[areaRotate.index];
      const ctr = planToScreen(a.plan, a.cx, a.cy);
      const deg = (Math.atan2(sy - ctr.y, sx - ctr.x) * 180) / Math.PI;
      a.angle = deg + 90 - a.plan.rotation;
      const snapped = Math.round(a.angle / 90) * 90;
      if (Math.abs(a.angle - snapped) < 7) a.angle = snapped;
    } else if (areaResize) {
      const a = areas[areaResize.index];
      const loc = screenToPlan(a.plan, sx, sy);
      const rad = (a.angle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = loc.nx - a.cx;
      const dy = loc.ny - a.cy;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      let mx = 0;
      let my = 0;
      if (areaResize.sx !== 0) {
        const fixed = (-areaResize.sx * a.w) / 2;
        a.w = Math.abs(lx - fixed);
        mx = (lx + fixed) / 2;
      }
      if (areaResize.sy !== 0) {
        const fixed = (-areaResize.sy * a.h) / 2;
        a.h = Math.abs(ly - fixed);
        my = (ly + fixed) / 2;
      }
      a.cx += mx * cos - my * sin;
      a.cy += mx * sin + my * cos;
    } else {
      const a = areas[areaMove.index];
      const cur = screenToPlan(a.plan, sx, sy);
      const prev = screenToPlan(a.plan, areaMove.lastSx, areaMove.lastSy);
      a.cx += cur.nx - prev.nx;
      a.cy += cur.ny - prev.ny;
      areaMove.lastSx = sx;
      areaMove.lastSy = sy;
    }
    render();
  }

  function areaEditUp(e) {
    if (!areaResize && !areaMove && !areaRotate) return;
    if (areaMove) reanchorArea(areas[areaMove.index]);
    areaResize = null;
    areaMove = null;
    areaRotate = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
    render();
  }

  // Rescale a single plan about its own centre (used by scale-matching).
  function rescalePlan(p, newScale) {
    const a = (p.rotation * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const kx = (cos * p.img.naturalWidth - sin * p.img.naturalHeight) / 2;
    const ky = (sin * p.img.naturalWidth + cos * p.img.naturalHeight) / 2;
    p.tx += (p.scale - newScale) * kx;
    p.ty += (p.scale - newScale) * ky;
    p.scale = newScale;
  }

  // ---- Plan selection UI: border + rotate handle (no resize). ----
  function renderPlanUI() {
    const p = selectedPlan;
    if (!p || !p.loaded) {
      planUiSvg.innerHTML = "";
      return;
    }
    const W = p.img.naturalWidth;
    const H = p.img.naturalHeight;
    const c = [[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => planToScreen(p, x, y));
    const topMid = planToScreen(p, W / 2, 0);
    const ctr = planToScreen(p, W / 2, H / 2);
    const dx = topMid.x - ctr.x;
    const dy = topMid.y - ctr.y;
    const len = Math.hypot(dx, dy) || 1;
    const knob = { x: topMid.x + (dx / len) * 28, y: topMid.y + (dy / len) * 28 };
    planUiSvg.innerHTML =
      `<polygon class="plan-border" points="${c.map((q) => `${q.x},${q.y}`).join(" ")}"></polygon>` +
      `<line class="rot-stem" x1="${topMid.x}" y1="${topMid.y}" x2="${knob.x}" y2="${knob.y}"></line>` +
      `<circle class="rot plan-rot" cx="${knob.x}" cy="${knob.y}" r="8"></circle>`;
  }

  planUiSvg.addEventListener("pointerdown", (e) => {
    if (!selectedPlan || !e.target.classList.contains("plan-rot")) return;
    e.stopPropagation();
    planRotating = true;
    planUiSvg.setPointerCapture(e.pointerId);
  });
  planUiSvg.addEventListener("pointermove", (e) => {
    if (!planRotating || !selectedPlan) return;
    const r = stage.getBoundingClientRect();
    const ctr = planCentreScreen(selectedPlan);
    const deg = (Math.atan2(e.clientY - r.top - ctr.y, e.clientX - r.left - ctr.x) * 180) / Math.PI;
    let target = deg + 90;
    const snapped = Math.round(target / 90) * 90;
    if (Math.abs(target - snapped) < 7) target = snapped;
    rotatePlan(selectedPlan, target - selectedPlan.rotation);
  });
  const endPlanRotate = (e) => {
    if (!planRotating) return;
    planRotating = false;
    try {
      planUiSvg.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };
  planUiSvg.addEventListener("pointerup", endPlanRotate);
  planUiSvg.addEventListener("pointercancel", endPlanRotate);

  function rotatePlan(p, deltaDeg) {
    if (!p.loaded) return;
    const cx = p.img.naturalWidth / 2;
    const cy = p.img.naturalHeight / 2;
    const screenCentre = (deg) => {
      const a = (deg * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      return { x: p.scale * (cos * cx - sin * cy), y: p.scale * (sin * cx + cos * cy) };
    };
    const before = screenCentre(p.rotation);
    const after = screenCentre(p.rotation + deltaDeg);
    p.tx += before.x - after.x;
    p.ty += before.y - after.y;
    p.rotation += deltaDeg;
    render();
  }

  // ---- Calibration (automatic) ----
  function continueCalibration() {
    if (calibrating()) return;
    const pending = plans.find((p) => p.loaded && p.unitsPerPx == null);
    if (pending) {
      beginMeasure(pending);
    } else {
      matchAll();
    }
  }

  // Scale every calibrated plan to the first one's real-world scale.
  function matchAll() {
    const cal = plans.filter((p) => p.loaded && p.unitsPerPx != null);
    if (cal.length < 2) return;
    const ref = cal[0];
    cal.slice(1).forEach((p) => rescalePlan(p, ref.scale * (p.unitsPerPx / ref.unitsPerPx)));
    render();
    showHint("Scales matched — drag to line the plans up.", 2600);
  }

  function beginMeasure(p) {
    calibPlan = p;
    calibCancelable = p.unitsPerPx != null; // re-measuring → Esc can cancel it
    showCalibFor = null;
    calibPts = [];
    calibSvg.innerHTML = "";
    calibSvg.classList.remove("hidden", "readonly");
    stage.classList.add("measuring");
    // Show only the plan being measured.
    plans.forEach((q) => {
      if (q.loaded) q.img.style.visibility = q === p ? "visible" : "hidden";
    });
    updateGuide();
  }

  function endMeasure() {
    calibPlan = null;
    calibPts = [];
    calibPending = null;
    calibSvg.innerHTML = "";
    calibSvg.classList.add("hidden");
    stage.classList.remove("measuring");
    plans.forEach((q) => (q.img.style.visibility = "visible"));
    render();
  }

  function ptFromEvent(e) {
    const r = calibSvg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function snap(a, p) {
    const ang = (Math.atan2(Math.abs(p.y - a.y), Math.abs(p.x - a.x)) * 180) / Math.PI;
    if (ang <= 15) return { x: p.x, y: a.y };
    if (ang >= 75) return { x: a.x, y: p.y };
    return p;
  }

  calibSvg.addEventListener("pointerdown", (e) => {
    if (!calibrating() || calibPending) return;
    let p = ptFromEvent(e);
    if (calibPts.length === 1) p = snap(calibPts[0], p);
    calibPts.push(p);
    drawLine(calibPts[0], calibPts[1] || null);
    if (calibPts.length === 2) finishMeasure();
  });
  calibSvg.addEventListener("pointermove", (e) => {
    if (!calibrating() || calibPending || calibPts.length !== 1) return;
    drawLine(calibPts[0], snap(calibPts[0], ptFromEvent(e)));
  });

  function drawLine(a, b, label) {
    if (!b) {
      calibSvg.innerHTML = `<circle cx="${a.x}" cy="${a.y}" r="3"></circle>`;
      return;
    }
    let s =
      '<defs><marker id="arw" viewBox="0 0 10 10" refX="8" refY="5"' +
      ' markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0,0 L10,5 L0,10 z"></path></marker></defs>' +
      `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"` +
      ' marker-start="url(#arw)" marker-end="url(#arw)"></line>';
    if (label) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const lx = (a.x + b.x) / 2 - (dy / len) * 16;
      const ly = (a.y + b.y) / 2 + (dx / len) * 16;
      s += `<text class="calib-label" x="${lx}" y="${ly}">${label}</text>`;
    }
    calibSvg.innerHTML = s;
  }

  function finishMeasure() {
    const p = calibPlan;
    const [a, b] = calibPts;
    const screenLen = Math.hypot(b.x - a.x, b.y - a.y);
    const naturalLen = screenLen / (p.scale * view.scale);
    if (naturalLen < 1) {
      showHint("Line too short — draw it again.", 1800);
      resetMeasure();
      return;
    }
    const input = window.prompt(`Real length of that line on ${p.name} (metres):`, "");
    if (input === null) return resetMeasure();
    const real = parseFloat(String(input).replace(",", "."));
    if (!(real > 0)) {
      showHint("Enter a positive number — draw it again.", 2200);
      resetMeasure();
      return;
    }
    calibPending = {
      plan: p,
      real,
      naturalLen,
      la: screenToPlan(p, a.x, a.y),
      lb: screenToPlan(p, b.x, b.y),
    };
    render();
  }

  function resetMeasure() {
    calibPts = [];
    calibPending = null;
    calibSvg.innerHTML = "";
    render();
  }

  function confirmMeasure() {
    if (!calibPending) return;
    const p = calibPending.plan;
    p.unitsPerPx = calibPending.real / calibPending.naturalLen;
    p.calibLine = { la: calibPending.la, lb: calibPending.lb, real: calibPending.real };
    const wantSave = canSave(p) && saveLibCheck.checked;
    calibPending = null;
    endMeasure();
    if (p.libId) updateLibrary(p); // recalibrating a saved plan → persist it
    else if (wantSave) saveToLibrary(p);
    continueCalibration();
  }

  // ---- Hints ----
  let hintTimer = null;
  function showHint(text, ms) {
    hint.textContent = text;
    hint.classList.remove("hidden");
    clearTimeout(hintTimer);
    if (ms) hintTimer = setTimeout(hideHint, ms);
  }
  function hideHint() {
    hint.classList.add("hidden");
  }

  // ---- Toolbar wiring ----
  const zoomCentre = (factor) => {
    const r = stage.getBoundingClientRect();
    zoomView(factor, r.width / 2, r.height / 2);
  };
  document.getElementById("zoom-in").addEventListener("click", () => zoomCentre(1.2));
  document.getElementById("zoom-out").addEventListener("click", () => zoomCentre(1 / 1.2));
  areaBtn.addEventListener("click", () => setAreaTool(!areaTool));

  // Add plan: show the "add a plan" prompt (paste / drop / choose file / Library).
  const addPlanInput = document.getElementById("add-plan-input");
  document.getElementById("add-plan").addEventListener("click", () => {
    addingPlan = true;
    render();
  });
  guideFileBtn.addEventListener("click", () => addPlanInput.click());
  addPlanInput.addEventListener("change", (e) => {
    for (const f of e.target.files) loadFile(f);
    e.target.value = "";
  });

  // ---- "Grab Floorplan" bookmarklet ----
  function grabFloorplan() {
    try {
      var u = [];
      var p = window.PAGE_MODEL;
      if (p && p.propertyData && p.propertyData.floorplans) {
        p.propertyData.floorplans.forEach(function (f) {
          if (f && f.url) u.push(f.url);
        });
      }
      if (!u.length) {
        var h = document.documentElement.innerHTML.replace(/\\\//g, "/");
        var re = /https?:\/\/[^"'\\\s)]*floorplan[^"'\\\s)]*?\.(?:jpe?g|png|gif|webp)/gi,
          m;
        while ((m = re.exec(h))) u.push(m[0]);
      }
      if (!u.length) {
        alert("No floorplan found on this page.");
        return;
      }
      var b =
        u.find(function (x) {
          return !/_max_\d+x\d+/i.test(x);
        }) || u[0].replace(/_max_\d+x\d+/i, "");
      var done = function () {
        alert("Floorplan URL copied — switch to Floor Plan Overlay and press Cmd/Ctrl+V.");
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(b).then(done, function () {
          prompt("Copy this floorplan URL:", b);
        });
      } else {
        prompt("Copy this floorplan URL:", b);
      }
    } catch (e) {
      alert("Bookmarklet error: " + e.message);
    }
  }
  const BOOKMARKLET = "javascript:(" + grabFloorplan.toString() + ")();";
  const helpBtn = document.getElementById("help-btn");
  const helpPop = document.getElementById("help");
  const bmLink = document.getElementById("bm");
  bmLink.href = BOOKMARKLET;
  helpBtn.addEventListener("click", () => helpPop.classList.toggle("hidden"));
  document.addEventListener("click", (e) => {
    if (!helpPop.contains(e.target) && e.target !== helpBtn) helpPop.classList.add("hidden");
  });
  bmLink.addEventListener("click", (e) => {
    e.preventDefault();
    copyText(BOOKMARKLET, "Bookmarklet code copied — or drag the button to your bookmarks bar.");
  });
  document.getElementById("bm-copy").addEventListener("click", () =>
    copyText(BOOKMARKLET, "Bookmarklet code copied.")
  );
  function copyText(text, msg) {
    (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(
      () => showHint(msg, 2600),
      () => window.prompt("Copy this bookmarklet code:", text)
    );
  }

  // ---- Library (saved calibrated plans, in IndexedDB) ----
  const libraryBtn = document.getElementById("library-btn");
  const libraryPanel = document.getElementById("library");
  const libGrid = document.getElementById("lib-grid");
  const libUsage = document.getElementById("lib-usage");
  const libThumbUrls = [];
  if (!PlanStore.available()) libraryBtn.style.display = "none";

  const canSave = (p) => PlanStore.available() && p.save && !!p.blob;

  function makeThumb(img) {
    return new Promise((resolve) => {
      const s = Math.min(200 / img.naturalWidth, 200 / img.naturalHeight, 1);
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(img.naturalWidth * s));
      cv.height = Math.max(1, Math.round(img.naturalHeight * s));
      try {
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob((b) => resolve(b), "image/jpeg", 0.7);
      } catch (_) {
        resolve(null);
      }
    });
  }

  // Write a plan to its library record (calibration line included).
  async function persistPlan(p) {
    const thumb = await makeThumb(p.img);
    await PlanStore.save({
      id: p.libId,
      name: p.name,
      blob: p.blob,
      type: p.blob.type || "image/jpeg",
      unitsPerPx: p.unitsPerPx,
      width: p.img.naturalWidth,
      height: p.img.naturalHeight,
      thumb,
      calibLine: p.calibLine || null,
      created: p.created,
      updated: Date.now(),
    });
    if (!libraryPanel.classList.contains("hidden")) refreshLibrary();
  }

  async function saveToLibrary(p) {
    const nm = window.prompt("Name this floor plan:", p.name);
    if (nm === null) return; // cancelled — leave it unsaved
    p.name = nm.trim() || p.name;
    p.libId = p.libId || PlanStore.uuid();
    p.created = p.created || Date.now();
    await persistPlan(p);
    p.save = false; // saved; hide the card's unsaved/save control
    showHint(`Saved “${p.name}” to library.`, 2200);
    render();
  }

  // Silently update an already-saved plan (used after recalibration).
  async function updateLibrary(p) {
    if (!p.libId || !PlanStore.available()) return;
    await persistPlan(p);
    showHint(`Updated “${p.name}” in library.`, 2000);
  }

  async function loadFromLibrary(id) {
    const rec = await PlanStore.get(id);
    if (!rec) return;
    const p = addPlan({ name: rec.name, save: false });
    p.libId = rec.id;
    p.calibLine = rec.calibLine || null;
    p.created = rec.created;
    setImageSrc(p, URL.createObjectURL(rec.blob), rec.unitsPerPx, rec.blob);
    libraryPanel.classList.add("hidden"); // close the library after adding
    showHint(`Added “${rec.name}”.`, 2000);
  }

  const escapeHtml = (s) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function refreshLibrary() {
    libThumbUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    const recs = await PlanStore.list();
    if (!recs.length) {
      libGrid.innerHTML =
        '<p class="lib-empty">No saved plans yet. When you add a plan, tick “Save to library” after calibrating it.</p>';
    } else {
      libGrid.innerHTML = recs
        .map((r) => {
          let thumb = '<div class="lib-thumb lib-thumb-blank"></div>';
          if (r.thumb) {
            const u = URL.createObjectURL(r.thumb);
            libThumbUrls.push(u);
            thumb = `<img class="lib-thumb" src="${u}" alt="" />`;
          }
          return (
            `<div class="lib-card" data-id="${r.id}">${thumb}` +
            `<div class="lib-name">${escapeHtml(r.name)}</div>` +
            `<div class="lib-actions">` +
            `<button data-act="add">Add</button>` +
            `<button data-act="rename" title="Rename">✎</button>` +
            `<button data-act="delete" title="Delete">🗑</button>` +
            `</div></div>`
          );
        })
        .join("");
    }
    Promise.all([PlanStore.estimate(), PlanStore.persisted()]).then(([{ usage, quota }, kept]) => {
      const mb = quota ? `${(usage / 1e6).toFixed(1)} MB used` : "";
      libUsage.textContent = kept ? (mb ? mb + " · kept on this device" : "Kept on this device") : mb;
    });
  }

  let persistAsked = false;
  async function ensurePersist() {
    if (persistAsked) return;
    persistAsked = true;
    if (await PlanStore.persisted()) return;
    await PlanStore.requestPersist();
    refreshLibrary();
  }

  libGrid.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    const card = e.target.closest(".lib-card");
    if (!btn || !card) return;
    const id = card.dataset.id;
    const act = btn.dataset.act;
    if (act === "add") loadFromLibrary(id);
    else if (act === "delete") {
      if (confirm("Delete this saved plan from the library?")) {
        await PlanStore.remove(id);
        refreshLibrary();
      }
    } else if (act === "rename") {
      const rec = await PlanStore.get(id);
      const nn = window.prompt("Rename:", rec ? rec.name : "");
      if (nn && nn.trim()) {
        await PlanStore.rename(id, nn.trim());
        refreshLibrary();
      }
    }
  });

  function openLibrary() {
    closeFurniture(); // the two right-hand panels are mutually exclusive
    libraryPanel.classList.remove("hidden");
    libraryBtn.classList.add("active");
    refreshLibrary();
    ensurePersist();
  }
  function closeLibrary() {
    libraryPanel.classList.add("hidden");
    libraryBtn.classList.remove("active");
  }
  libraryBtn.addEventListener("click", () => {
    if (libraryPanel.classList.contains("hidden")) openLibrary();
    else closeLibrary();
  });
  guideLibBtn.addEventListener("click", openLibrary);
  if (!PlanStore.available()) guideLibBtn.classList.add("hidden");

  // ---- About modal ----
  const aboutModal = document.getElementById("about");
  document.getElementById("about-btn").addEventListener("click", () =>
    aboutModal.classList.remove("hidden")
  );
  document.getElementById("about-close").addEventListener("click", () =>
    aboutModal.classList.add("hidden")
  );
  aboutModal.addEventListener("click", (e) => {
    if (e.target === aboutModal) aboutModal.classList.add("hidden"); // backdrop
  });
  document.getElementById("lib-close").addEventListener("click", closeLibrary);
  // Manual fallback: save the selected plan (if you skipped the confirm checkbox).
  document.getElementById("lib-save").addEventListener("click", () => {
    const p = selectedPlan;
    if (!p || !p.loaded || p.unitsPerPx == null) {
      showHint("Select a calibrated plan to save it.", 2800);
      return;
    }
    if (!canSave(p)) {
      showHint("This plan can't be saved (loaded from a URL, or already saved).", 4000);
      return;
    }
    saveToLibrary(p);
  });

  // Export the whole library to a JSON backup file.
  document.getElementById("lib-export").addEventListener("click", async () => {
    const bundle = await PlanStore.exportAll();
    if (!bundle.plans.length) {
      showHint("Your library is empty — nothing to export.", 2800);
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: "application/json" }));
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `floorplans-backup-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showHint(`Exported ${bundle.plans.length} plan${bundle.plans.length === 1 ? "" : "s"}.`, 2400);
  });

  // Restore a library from a JSON backup file (overwrites matching ids).
  const libImportFile = document.getElementById("lib-import-file");
  document.getElementById("lib-import").addEventListener("click", () => libImportFile.click());
  libImportFile.addEventListener("change", async () => {
    const file = libImportFile.files[0];
    libImportFile.value = ""; // let the same file be re-picked later
    if (!file) return;
    let bundle;
    try {
      bundle = JSON.parse(await file.text());
    } catch (_) {
      showHint("That file isn't a valid backup.", 3200);
      return;
    }
    try {
      const { added, skipped } = await PlanStore.importAll(bundle);
      refreshLibrary();
      let msg = `Imported ${added} plan${added === 1 ? "" : "s"}.`;
      if (skipped) msg += ` ${skipped} skipped.`;
      showHint(msg, 2800);
    } catch (err) {
      showHint(err.message || "Couldn't import that file.", 3600);
    }
  });

  // ---- Calibration confirm + keyboard + paste/drop ----
  document.getElementById("confirm-yes").addEventListener("click", confirmMeasure);
  document.getElementById("confirm-redo").addEventListener("click", resetMeasure);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (furnPlacing) {
      furnPlacing = null;
      render();
    } else if (!aboutModal.classList.contains("hidden")) {
      aboutModal.classList.add("hidden");
    } else if (!libraryPanel.classList.contains("hidden")) {
      closeLibrary();
    } else if (!furniturePanel.classList.contains("hidden")) {
      closeFurniture();
    } else if (addingPlan) {
      addingPlan = false;
      render();
    } else if (calibrating()) {
      // Mid-line: just cancel the line. No line yet: cancel a recalibration
      // entirely (an initial calibration stays — the plan must be measured).
      if (calibPending || calibPts.length >= 1) resetMeasure();
      else if (calibCancelable) endMeasure();
    } else if (areaDraw) {
      areaDraw = null;
      areaCursor = null;
      render();
    } else if (areaTool) setAreaTool(false);
    else if (showCalibFor) {
      showCalibFor = null;
      render();
    } else if (selected !== null || selectedPlan !== null) {
      selected = null;
      selectedPlan = null;
      render();
    }
  });

  document.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith("image/"));
    if (item) {
      e.preventDefault();
      loadFile(item.getAsFile());
      return;
    }
    const text = e.clipboardData?.getData("text")?.trim();
    if (text && /^https?:\/\//i.test(text)) {
      e.preventDefault();
      loadFromUrl(text);
    }
  });

  stage.addEventListener("dragover", (e) => {
    e.preventDefault();
    stage.classList.add("dragover");
  });
  stage.addEventListener("dragleave", (e) => {
    if (e.target === stage) stage.classList.remove("dragover");
  });
  stage.addEventListener("drop", (e) => {
    e.preventDefault();
    stage.classList.remove("dragover");
    for (const f of e.dataTransfer.files) loadFile(f);
  });

  render();
})();
