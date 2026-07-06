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

  // Tape measure: a point-to-point line, stored alongside the area boxes as
  // { kind:"tape", plan, ax, ay, bx, by } in its plan's natural-pixel coords.
  let distTool = false;
  let distDraw = null; // { plan, ax, ay } while placing the second end
  let distCursor = null; // { nx, ny } live second end (snapped)
  let tapeEnd = null; // { index, end:"a"|"b" } dragging a tape endpoint
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
  let peeking = false; // holding Space — top plan hidden to peek underneath
  let pasteReady = false; // opened via the bookmarklet's #paste — prompting for ⌘V
  let libHasPlans = false; // the library holds ≥1 saved plan — offer it in the guide

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
  const distBtn = document.getElementById("dist-btn");
  const scaleBar = document.getElementById("scale-bar");
  const scaleTrack = scaleBar.querySelector(".scale-track");
  const scaleMetricTick = scaleBar.querySelector(".scale-tick-metric");
  const scaleImperialTick = scaleBar.querySelector(".scale-tick-imperial");
  const scaleMetricLabel = scaleBar.querySelector(".scale-metric-label");
  const scaleImperialLabel = scaleBar.querySelector(".scale-imperial-label");
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
    pasteReady = false; // a plan is being added; dismiss the paste prompt
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

    // Per-plan wall filter (tint + differential opacity); built by updatePlanFilter.
    const fxFilter = document.createElementNS(SVGNS, "filter");
    fxFilter.setAttribute("id", `fx-${id}`);
    fxFilter.setAttribute("color-interpolation-filters", "sRGB");
    fxDefs.appendChild(fxFilter);

    const card = document.createElement("div");
    card.className = "card";
    const nameEl = document.createElement("span");
    nameEl.className = "card-name";
    const totalEl = document.createElement("span");
    totalEl.className = "card-total hidden";
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
    const tintBtn = document.createElement("button");
    tintBtn.className = "card-tint";
    tintBtn.type = "button";
    tintBtn.title = "Change this plan's tint";
    tintBtn.setAttribute("aria-label", "Change this plan's tint");
    const tintRow = document.createElement("span");
    tintRow.className = "card-tint-row hidden";
    tintRow.innerHTML =
      '<button class="swatch none" data-tint="" type="button" title="No tint" aria-label="No tint">✕</button>' +
      TINTS.map(
        (t, k) =>
          `<button class="swatch" data-tint="${k}" type="button" title="${t.name}"` +
          ` aria-label="${t.name}" style="background:${t.hex}"></button>`
      ).join("");
    const lockBtn = document.createElement("button");
    lockBtn.className = "card-lock";
    lockBtn.type = "button";
    lockBtn.textContent = "🔓";
    lockBtn.title = "Lock this plan in place";
    lockBtn.setAttribute("aria-pressed", "false");
    const del = document.createElement("button");
    del.className = "card-del";
    del.type = "button";
    del.textContent = "✕";
    del.title = "Remove this plan from the comparison";
    card.append(nameEl, totalEl, slider, recalBtn, showBtn, saveBtn, tintBtn, tintRow, lockBtn, del);
    cardsEl.appendChild(card);

    // Auto-tint: give the new plan the least-used palette colour.
    const tintCounts = TINTS.map((_, k) => plans.reduce((n, q) => n + (q.tint === k), 0));

    const opacity = opts.opacity != null ? opts.opacity : plans.length === 0 ? 1 : 0.6;
    const p = {
      id,
      name: opts.name || `Plan ${id}`,
      img,
      areaSvg: planSvg,
      card,
      nameEl,
      totalEl,
      slider,
      saveBtn,
      recalBtn,
      showBtn,
      tintBtn,
      fxFilter,
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
      locked: false, // pinned: not pickable/draggable until unlocked
      tint: tintCounts.indexOf(Math.min(...tintCounts)), // TINTS index | null
      save: !!opts.save,
    };
    slider.value = opacity * 100;

    slider.addEventListener("input", () => {
      p.opacity = slider.value / 100;
      updatePlanFilter(p);
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
    tintBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    tintBtn.addEventListener("click", () => {
      [...tintRow.children].forEach((b) =>
        b.classList.toggle("on", (b.dataset.tint === "" ? null : Number(b.dataset.tint)) === p.tint)
      );
      tintRow.classList.toggle("hidden");
    });
    tintRow.addEventListener("pointerdown", (e) => e.stopPropagation());
    tintRow.addEventListener("click", (e) => {
      const btn = e.target.closest(".swatch");
      if (!btn) return;
      p.tint = btn.dataset.tint === "" ? null : Number(btn.dataset.tint);
      tintRow.classList.add("hidden");
      updatePlanFilter(p);
      render();
    });
    lockBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    lockBtn.addEventListener("click", () => {
      p.locked = !p.locked;
      lockBtn.textContent = p.locked ? "🔒" : "🔓";
      lockBtn.title = p.locked ? "Unlock this plan" : "Lock this plan in place";
      lockBtn.setAttribute("aria-pressed", String(p.locked));
      lockBtn.classList.toggle("locked", p.locked);
      if (p.locked && selectedPlan === p) selectedPlan = null;
      render();
    });

    planSvg.addEventListener("pointerdown", areaEditDown);
    planSvg.addEventListener("pointermove", areaEditMove);
    planSvg.addEventListener("pointerup", areaEditUp);
    planSvg.addEventListener("pointercancel", areaEditUp);

    plans.push(p);
    return p;
  }

  // Soft-remove: the plan leaves the stack but its DOM lingers (hidden) so the
  // undo toast can bring it straight back; finalize tears it down for real.
  function removePlan(p) {
    if (calibPlan === p) endMeasure();
    const idx = plans.indexOf(p);
    if (idx >= 0) plans.splice(idx, 1);
    const boxes = [];
    for (let k = areas.length - 1; k >= 0; k--)
      if (areas[k].plan === p) boxes.unshift(...areas.splice(k, 1));
    if (selectedPlan === p) selectedPlan = null;
    if (showCalibFor === p) showCalibFor = null;
    selected = null;
    p.layer.style.display = "none";
    p.card.style.display = "none";
    const finalize = () => {
      if (p.objUrl) URL.revokeObjectURL(p.objUrl);
      p.layer.remove();
      p.card.remove();
      p.fxFilter.remove();
    };
    if (!p.loaded) {
      finalize(); // a failed load: nothing worth restoring
    } else {
      offerUndo(
        `Removed “${p.name}”`,
        () => {
          plans.push(p); // restored on top (the stack may have shifted since)
          layersEl.appendChild(p.layer);
          p.layer.style.display = "";
          p.card.style.display = "";
          areas.push(...boxes);
          render();
          continueCalibration();
        },
        finalize
      );
    }
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
    updatePlanFilter(p);
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

    // Holding Space hides the top plan to peek at what's underneath. (While
    // measuring, beginMeasure owns visibility — leave it alone.)
    const topLoaded = plans.filter((p) => p.loaded).pop();
    plans.forEach((p) => {
      if (!p.loaded) return;
      p.img.style.transform =
        `translate(${view.x}px, ${view.y}px) scale(${view.scale}) ` +
        `translate(${p.tx}px, ${p.ty}px) rotate(${p.rotation}deg) scale(${p.scale})`;
      // Opacity + tint live in the plan's own filter (updatePlanFilter), rebuilt
      // only when they change — not here, which runs on every pan/zoom/drag.
      if (!calibrating()) p.img.style.visibility = peeking && p === topLoaded ? "hidden" : "visible";
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
    updateScaleBar();
  }

  // Largest "nice" number (1/2/5 ×10ⁿ) not exceeding max.
  function niceRound(max) {
    const pow = Math.pow(10, Math.floor(Math.log10(max)));
    const d = max / pow;
    return (d >= 5 ? 5 : d >= 2 ? 2 : 1) * pow;
  }

  // Google-Maps-style scale bar: one shared baseline with a metric tick + label
  // above and an imperial tick + label below, each a nice round distance fitting
  // within a max width. Screen px per metre = view.scale · plan.scale / unitsPerPx
  // (equal across matched plans).
  function updateScaleBar() {
    const p = plans.find((pl) => pl.loaded && pl.unitsPerPx != null);
    if (!p) {
      scaleBar.classList.add("hidden");
      return;
    }
    const pxPerM = (view.scale * p.scale) / p.unitsPerPx;
    const maxPx = 100;

    const niceM = niceRound(maxPx / pxPerM);
    const metricPx = niceM * pxPerM;
    scaleMetricLabel.textContent =
      niceM >= 1000
        ? `${+(niceM / 1000).toFixed(2)} km`
        : niceM >= 1
        ? `${+niceM.toFixed(2)} m`
        : niceM >= 0.01
        ? `${Math.round(niceM * 100)} cm`
        : `${Math.round(niceM * 1000)} mm`;

    const pxPerFt = pxPerM * 0.3048;
    const maxFt = maxPx / pxPerFt;
    let impPx;
    if (maxFt >= 1) {
      const niceFt = niceRound(maxFt);
      impPx = niceFt * pxPerFt;
      scaleImperialLabel.textContent =
        niceFt >= 5280 ? `${+(niceFt / 5280).toFixed(2)} mi` : `${+niceFt.toFixed(0)} ft`;
    } else {
      const pxPerIn = pxPerFt / 12;
      const niceIn = niceRound(maxPx / pxPerIn);
      impPx = niceIn * pxPerIn;
      scaleImperialLabel.textContent = `${niceIn >= 1 ? niceIn : +niceIn.toFixed(1)} in`;
    }

    scaleMetricTick.style.right = metricPx + "px";
    scaleMetricLabel.style.width = metricPx + "px";
    scaleImperialTick.style.right = impPx + "px";
    scaleImperialLabel.style.width = impPx + "px";
    scaleTrack.style.width = Math.max(metricPx, impPx) + "px";
    scaleBar.classList.remove("hidden");
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

    p.tintBtn.style.background = p.tint != null ? TINTS[p.tint].hex : "#fff";
    p.tintBtn.classList.toggle("none", p.tint == null);

    // Running total of this plan's measured rooms (area boxes, not furniture).
    const rooms = areas.filter((a) => a.plan === p && a.kind === "area");
    const total = rooms.reduce((t, a) => t + a.w * a.h * p.unitsPerPx * p.unitsPerPx, 0);
    p.totalEl.textContent = rooms.length
      ? `${rooms.length} room${rooms.length === 1 ? "" : "s"} · ${total.toFixed(1)} m²`
      : "";
    p.totalEl.classList.toggle("hidden", !rooms.length);

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
    } else if (pasteReady) {
      title = "Paste your floorplan";
      body = "Press ⌘V / Ctrl+V to add the floorplan you copied. Esc to cancel.";
    } else if (!plans.some((p) => p.loaded)) {
      adding = true;
      title = "Add your first floor plan";
      body = ""; // the static add row carries the paste/drop/file copy
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
    guideLibBtn.classList.toggle("hidden", !libHasPlans); // only offer a non-empty library
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

  // Topmost unlocked plan under the cursor, else null (locked plans are
  // click-through: clicks reach whatever is beneath them).
  function pickPlan(e) {
    for (let k = plans.length - 1; k >= 0; k--)
      if (planAt(plans[k], e) && !plans[k].locked) return plans[k];
    return null;
  }

  stage.addEventListener("pointerdown", (e) => {
    if (
      (calibrating() && !calibPending) ||
      areaTool ||
      distTool ||
      e.target.closest("#guide") ||
      e.target.closest("#undo-toast") ||
      e.target.closest(".card") ||
      e.target.closest(".zoom-toolbar") ||
      e.target.closest(".tools-toolbar")
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
    // Note: clicking a plan does NOT restack it. Re-parenting its layer to the
    // top invalidates the cached wall-filter layer, which caused a stutter at
    // the start of every drag. Plans keep their load order; drag stays smooth.
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

  // A tape line: invisible fat hit line + visible line + end dots + length
  // label; endpoint handles and a delete button while selected.
  function tapeSVG(a, k, sel) {
    const A = planToScreen(a.plan, a.ax, a.ay);
    const B = planToScreen(a.plan, a.bx, a.by);
    const di = k == null ? "" : ` data-i="${k}"`;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const m = Math.hypot(a.bx - a.ax, a.by - a.ay) * a.plan.unitsPerPx;
    let s =
      `<line class="tape-hit"${di} x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"></line>` +
      `<line class="tape" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"></line>` +
      `<circle class="tape-dot" cx="${A.x}" cy="${A.y}" r="3"></circle>` +
      `<circle class="tape-dot" cx="${B.x}" cy="${B.y}" r="3"></circle>` +
      `<text class="tape-label" x="${(A.x + B.x) / 2 - (dy / len) * 14}"` +
      ` y="${(A.y + B.y) / 2 + (dx / len) * 14}">${m.toFixed(2)} m</text>`;
    if (sel) {
      s +=
        `<circle class="tape-end"${di} data-end="a" cx="${A.x}" cy="${A.y}" r="5.5"></circle>` +
        `<circle class="tape-end"${di} data-end="b" cx="${B.x}" cy="${B.y}" r="5.5"></circle>`;
      const d = { x: (A.x + B.x) / 2 + (dy / len) * 18, y: (A.y + B.y) / 2 - (dx / len) * 18 };
      const o = 3.5;
      s += `<circle class="del"${di} cx="${d.x}" cy="${d.y}" r="9"></circle>`;
      s += `<line class="del-x" x1="${d.x - o}" y1="${d.y - o}" x2="${d.x + o}" y2="${d.y + o}"></line>`;
      s += `<line class="del-x" x1="${d.x - o}" y1="${d.y + o}" x2="${d.x + o}" y2="${d.y - o}"></line>`;
    }
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
      : tapeEnd
      ? areas[tapeEnd.index]
      : null;

    areas.forEach((a, k) => {
      if (!a.plan.loaded || a.plan.unitsPerPx == null) return;
      const sel = k === selected && !areaDraw;
      let s;
      if (a.kind === "tape") {
        s = tapeSVG(a, k, sel);
      } else {
        s = boxPolygonSVG(a, k);
        if (a.kind === "furniture") s += boxIconSVG(a);
        if (sel) s += boxHandlesSVG(a, k);
        s += boxLabelsSVG(a, sel);
      }
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
    if (distDraw && distCursor) {
      top += tapeSVG(
        { kind: "tape", plan: distDraw.plan, ax: distDraw.ax, ay: distDraw.ay, bx: distCursor.nx, by: distCursor.ny },
        null,
        false
      );
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
    if (a.kind === "tape") {
      const A = planToScreen(a.plan, a.ax, a.ay);
      const B = planToScreen(a.plan, a.bx, a.by);
      const target = planUnderPoint((A.x + B.x) / 2, (A.y + B.y) / 2);
      if (!target || target === a.plan) return;
      const na = screenToPlan(target, A.x, A.y);
      const nb = screenToPlan(target, B.x, B.y);
      a.ax = na.nx;
      a.ay = na.ny;
      a.bx = nb.nx;
      a.by = nb.ny;
      a.plan = target;
      return;
    }
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
      if (distTool) setDistTool(false); // the two draw tools are exclusive
    }
    areaBtn.classList.toggle("active", on);
    areaSvg.classList.toggle("active", areaTool || distTool);
    if (on) showHint("Click two corners to measure a room.", 3200);
    else hideHint();
    render();
  }

  function setDistTool(on) {
    distTool = on;
    distDraw = null;
    distCursor = null;
    if (on) {
      selected = null;
      furnPlacing = null;
      if (areaTool) setAreaTool(false);
    }
    distBtn.classList.toggle("active", on);
    areaSvg.classList.toggle("active", areaTool || distTool);
    if (on) showHint("Click two points to measure the distance between them.", 3200);
    else hideHint();
    render();
  }

  // Snap the far end to horizontal/vertical (within 15°) in plan coords, so
  // tapes run along a (possibly rotated) plan's walls.
  function planSnap(a, pt) {
    const ang = (Math.atan2(Math.abs(pt.ny - a.ay), Math.abs(pt.nx - a.ax)) * 180) / Math.PI;
    if (ang <= 15) return { nx: pt.nx, ny: a.ay };
    if (ang >= 75) return { nx: a.ax, ny: pt.ny };
    return pt;
  }

  function distClick(sx, sy) {
    if (!distDraw) {
      const p = pickAreaPlan(sx, sy);
      if (!p) {
        showHint("Calibrate a plan first.", 2500);
        return;
      }
      const loc = screenToPlan(p, sx, sy);
      distDraw = { plan: p, ax: loc.nx, ay: loc.ny };
      distCursor = { nx: loc.nx, ny: loc.ny };
    } else {
      const end = planSnap(distDraw, screenToPlan(distDraw.plan, sx, sy));
      areas.push({
        kind: "tape",
        plan: distDraw.plan,
        ax: distDraw.ax,
        ay: distDraw.ay,
        bx: end.nx,
        by: end.ny,
      });
      setDistTool(false); // auto-exit, like the area tool
      selected = areas.length - 1;
    }
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
    if (distTool) setDistTool(false);
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
    furnJustPlaced = true; // the click that placed it shouldn't close the palette
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
    closeLibrary(); // the right-hand panels are mutually exclusive
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

  // Drawing a new box or tape: the top layer captures clicks while a tool is on.
  areaSvg.addEventListener("pointerdown", (e) => {
    if ((!areaTool && !distTool) || calibrating()) return;
    e.stopPropagation();
    const r = areaSvg.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    if (distTool) {
      distClick(sx, sy);
      render();
      return;
    }
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
    if (!areaDraw && !distDraw) return;
    const r = areaSvg.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    if (distDraw) distCursor = planSnap(distDraw, screenToPlan(distDraw.plan, sx, sy));
    else areaCursor = screenToPlan(areaDraw.plan, sx, sy);
    render();
  });

  // Editing existing boxes (DOM-target based, on each plan's own svg).
  function areaEditDown(e) {
    if (areaTool || distTool || calibrating()) return;
    const t = e.target;
    if (!t.dataset || t.dataset.i == null) return;
    e.stopPropagation();
    const k = Number(t.dataset.i);
    const r = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    if (t.classList.contains("del")) {
      const [box] = areas.splice(k, 1);
      selected = null;
      const what =
        box.kind === "furniture" ? box.label : box.kind === "tape" ? "tape measure" : "area";
      offerUndo(`Removed ${what}`, () => {
        areas.splice(Math.min(k, areas.length), 0, box);
        render();
      });
      render();
      return;
    }
    selected = k;
    selectedPlan = null;
    if (t.classList.contains("tape-end")) {
      tapeEnd = { index: k, end: t.dataset.end };
    } else if (t.classList.contains("rot")) {
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
    if (!areaResize && !areaMove && !areaRotate && !tapeEnd) return;
    const r = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    if (tapeEnd) {
      const a = areas[tapeEnd.index];
      const loc = screenToPlan(a.plan, sx, sy);
      const other = tapeEnd.end === "a" ? { ax: a.bx, ay: a.by } : { ax: a.ax, ay: a.ay };
      const pt = planSnap(other, loc);
      if (tapeEnd.end === "a") {
        a.ax = pt.nx;
        a.ay = pt.ny;
      } else {
        a.bx = pt.nx;
        a.by = pt.ny;
      }
    } else if (areaRotate) {
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
      const dnx = cur.nx - prev.nx;
      const dny = cur.ny - prev.ny;
      if (a.kind === "tape") {
        a.ax += dnx;
        a.ay += dny;
        a.bx += dnx;
        a.by += dny;
      } else {
        a.cx += dnx;
        a.cy += dny;
      }
      areaMove.lastSx = sx;
      areaMove.lastSy = sy;
    }
    render();
  }

  function areaEditUp(e) {
    if (!areaResize && !areaMove && !areaRotate && !tapeEnd) return;
    if (areaMove || tapeEnd) reanchorArea(areas[(areaMove || tapeEnd).index]);
    areaResize = null;
    areaMove = null;
    areaRotate = null;
    tapeEnd = null;
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
    // The loupe magnifies a clone of the measured plan's image, plus a mirror
    // of the calibration overlay so the in-progress line shows inside it too.
    loupeContent.innerHTML = "";
    const clone = p.img.cloneNode(false);
    clone.hidden = false;
    clone.style.visibility = "visible";
    clone.style.opacity = 1;
    clone.style.filter = ""; // magnify the raw plan, not its tint/transparency
    const mirror = document.createElementNS(SVGNS, "svg");
    mirror.setAttribute("class", "loupe-calib");
    loupeContent.append(clone, mirror);
    updateGuide();
  }

  function endMeasure() {
    calibPlan = null;
    calibPts = [];
    calibPending = null;
    calibSvg.innerHTML = "";
    calibSvg.classList.add("hidden");
    stage.classList.remove("measuring");
    loupe.classList.add("hidden");
    loupeContent.innerHTML = "";
    plans.forEach((q) => (q.img.style.visibility = "visible"));
    render();
  }

  // ---- Loupe: a magnified view around the cursor while placing calibration
  // points, so the line can land precisely on the drawing's walls.
  const loupe = document.getElementById("loupe");
  const loupeContent = document.getElementById("loupe-content");
  const LOUPE = 140; // matches .loupe width/height
  const LOUPE_K = 2.5;
  function updateLoupe(e) {
    if (!calibrating() || calibPending) return;
    const clone = loupeContent.firstChild;
    if (!clone) return;
    const r = stage.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    // The view is frozen while measuring, but copy the live transform anyway.
    clone.style.transform = calibPlan.img.style.transform;
    const mirror = loupeContent.lastChild;
    if (mirror !== clone) mirror.innerHTML = calibSvg.innerHTML;
    loupeContent.style.transform =
      `translate(${LOUPE / 2 - LOUPE_K * sx}px, ${LOUPE / 2 - LOUPE_K * sy}px) scale(${LOUPE_K})`;
    // Centre the loupe on the pointer, so the magnified point sits under the
    // crosshair exactly where you're aiming (its own crosshair coincides with
    // the OS one). The circle is click-through, so it never blocks placement.
    loupe.style.left = sx - LOUPE / 2 + "px";
    loupe.style.top = sy - LOUPE / 2 + "px";
    loupe.classList.remove("hidden");
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
  // After the preview redraws, so the loupe mirrors the fresh line.
  calibSvg.addEventListener("pointermove", updateLoupe);
  calibSvg.addEventListener("pointerleave", () => loupe.classList.add("hidden"));

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
    loupe.classList.add("hidden");
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

  // ---- Undo (one slot): offer to reverse the last destructive action ----
  const undoToast = document.getElementById("undo-toast");
  const undoText = document.getElementById("undo-text");
  let pendingUndo = null; // { undo, finalize, timer }
  function offerUndo(text, undo, finalize) {
    finalizeUndo(); // only one undo at a time — commit any previous one
    undoText.textContent = text;
    undoToast.classList.remove("hidden");
    pendingUndo = { undo, finalize, timer: setTimeout(finalizeUndo, 8000) };
  }
  function finalizeUndo() {
    if (!pendingUndo) return;
    clearTimeout(pendingUndo.timer);
    if (pendingUndo.finalize) pendingUndo.finalize();
    pendingUndo = null;
    undoToast.classList.add("hidden");
  }
  document.getElementById("undo-btn").addEventListener("click", () => {
    if (!pendingUndo) return;
    clearTimeout(pendingUndo.timer);
    const u = pendingUndo.undo;
    pendingUndo = null;
    undoToast.classList.add("hidden");
    u();
  });

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

  // Fit all: frame every loaded plan (their rotated corners, in world space).
  document.getElementById("zoom-fit").addEventListener("click", () => {
    const loaded = plans.filter((p) => p.loaded);
    if (!loaded.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    loaded.forEach((p) => {
      const a = (p.rotation * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const W = p.img.naturalWidth;
      const H = p.img.naturalHeight;
      [[0, 0], [W, 0], [W, H], [0, H]].forEach(([nx, ny]) => {
        const wx = p.tx + p.scale * (cos * nx - sin * ny);
        const wy = p.ty + p.scale * (sin * nx + cos * ny);
        minX = Math.min(minX, wx);
        minY = Math.min(minY, wy);
        maxX = Math.max(maxX, wx);
        maxY = Math.max(maxY, wy);
      });
    });
    const r = stage.getBoundingClientRect();
    const s = clamp(
      Math.min((r.width * 0.92) / (maxX - minX), (r.height * 0.92) / (maxY - minY)),
      0.1,
      10
    );
    view.scale = s;
    view.x = (r.width - (maxX - minX) * s) / 2 - minX * s;
    view.y = (r.height - (maxY - minY) * s) / 2 - minY * s;
    render();
  });
  areaBtn.addEventListener("click", () => setAreaTool(!areaTool));
  distBtn.addEventListener("click", () => setDistTool(!distTool));

  // ---- Per-plan wall filter: tint + differential transparency ----
  // A "dark pixels" mask (morphologically opened so thin dark features — text,
  // dimension lines — drop out, leaving thick strokes: the walls) is reused for
  // two things on every plan: optional tint (flood the walls a hue) and
  // differential opacity. The non-wall layer fades at the slider rate while the
  // walls fade far slower, so the structure stays legible as a plan goes sheer.
  // rest opacity = o; wall opacity = 1 − (1 − o)⁵ (walls hold on hard — at o=0.5
  // the rooms are 50% transparent but the walls only ~3%). Each plan owns a
  // filter (#fx-<id>), rebuilt by updatePlanFilter when its opacity/tint change.
  const TINTS = [
    { name: "Red", hex: "#d7263d" },
    { name: "Blue", hex: "#1d4ed8" },
    { name: "Green", hex: "#0e9f6e" },
    { name: "Orange", hex: "#d97706" },
    { name: "Purple", hex: "#7c3aed" },
  ];
  // Darkness (1 − luminance, alpha-aware) into the alpha channel: opaque dark
  // pixels → 1, light or transparent pixels → 0. Steep threshold keeps only
  // quite-dark pixels; erode→dilate then drops thin features, leaving walls.
  const FX_MASK =
    '<feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.2126 -0.7152 -0.0722 1 0"></feColorMatrix>' +
    '<feComponentTransfer><feFuncA type="table" tableValues="0 0 0 0 0 0 0 0.5 1 1 1"></feFuncA></feComponentTransfer>' +
    '<feMorphology operator="erode" radius="1"></feMorphology>' +
    '<feMorphology operator="dilate" radius="1" result="mask"></feMorphology>';
  const fxDefs = document.createElementNS(SVGNS, "svg");
  fxDefs.setAttribute("width", 0);
  fxDefs.setAttribute("height", 0);
  fxDefs.setAttribute("aria-hidden", "true");
  fxDefs.style.position = "absolute";
  document.body.appendChild(fxDefs);

  // True when p needs a filter at all (else the raw image shows through).
  const planNeedsFilter = (p) => p.tint != null || p.opacity < 1;

  // (Re)build p's filter to match its current opacity + tint, and point the
  // image at it (or clear the filter when the raw image would look identical).
  function updatePlanFilter(p) {
    if (!planNeedsFilter(p)) {
      p.img.style.filter = "";
      return;
    }
    const restOp = p.opacity;
    const wallOp = 1 - (1 - p.opacity) ** 5;
    // Wall pixels: flood colour if tinted, else the original wall pixels.
    const wallSrc =
      p.tint != null
        ? `<feFlood flood-color="${TINTS[p.tint].hex}" result="wc"></feFlood>` +
          `<feComposite in="wc" in2="mask" operator="in" result="wallpix"></feComposite>`
        : `<feComposite in="SourceGraphic" in2="mask" operator="in" result="wallpix"></feComposite>`;
    p.fxFilter.innerHTML =
      FX_MASK +
      wallSrc +
      `<feComponentTransfer in="wallpix" result="walls"><feFuncA type="linear" slope="${wallOp}"></feFuncA></feComponentTransfer>` +
      `<feComposite in="SourceGraphic" in2="mask" operator="out" result="restpix"></feComposite>` +
      `<feComponentTransfer in="restpix" result="rest"><feFuncA type="linear" slope="${restOp}"></feFuncA></feComponentTransfer>` +
      `<feMerge><feMergeNode in="rest"></feMergeNode><feMergeNode in="walls"></feMergeNode></feMerge>`;
    p.img.style.filter = `url(#fx-${p.id})`;
  }

  // Clicking anywhere outside an open panel closes it (each panel's own
  // toggle button still handles itself). The click that places a furniture
  // piece — or arms one, while a ghost is still following the cursor — keeps
  // the palette open for placing more. Membership uses composedPath, not
  // contains: clicking a control that re-renders its panel (library actions)
  // detaches the target before this handler runs.
  let furnJustPlaced = false;
  document.addEventListener("click", (e) => {
    const path = e.composedPath();
    const placing = furnJustPlaced || !!furnPlacing;
    furnJustPlaced = false;
    if (
      !placing &&
      !furniturePanel.classList.contains("hidden") &&
      !path.includes(furniturePanel) &&
      e.target !== furnitureBtn
    )
      closeFurniture();
    if (
      !libraryPanel.classList.contains("hidden") &&
      !path.includes(libraryPanel) &&
      e.target !== libraryBtn &&
      e.target !== guideLibBtn // the guide's "Open library" opener, not an outside click
    )
      closeLibrary();
  });

  // Add plan: one menu for every way in (file / library / Rightmove grab).
  const addPlanInput = document.getElementById("add-plan-input");
  const addPlanBtn = document.getElementById("add-plan");
  const addMenu = document.getElementById("add-menu");
  addPlanBtn.addEventListener("click", () => addMenu.classList.toggle("hidden"));
  addMenu.addEventListener("click", (e) => {
    if (e.target.closest("button")) addMenu.classList.add("hidden"); // picking an item closes it
  });
  document.addEventListener("click", (e) => {
    if (!addMenu.contains(e.target) && e.target !== addPlanBtn) addMenu.classList.add("hidden");
  });
  document.getElementById("add-file").addEventListener("click", () => addPlanInput.click());
  guideFileBtn.addEventListener("click", () => addPlanInput.click());
  addPlanInput.addEventListener("change", (e) => {
    for (const f of e.target.files) loadFile(f);
    e.target.value = "";
  });

  // ---- "Grab Floorplan" bookmarklet ----
  // Runs on the property page: finds the floorplan(s) (PAGE_MODEL on older
  // pages, an HTML scan otherwise), shows the full-res image in an overlay
  // with copy instructions, and opens the app at #paste (which prompts for
  // the ⌘V). Serialised via toString(), so it must be fully self-contained —
  // and must contain no // comments, because bookmarking the javascript: URL
  // strips its newlines, which would turn the rest of the code into a comment.
  function grabFloorplan(app) {
    try {
      var u = [];
      var pm = window.PAGE_MODEL;
      if (pm && pm.propertyData && pm.propertyData.floorplans) {
        pm.propertyData.floorplans.forEach(function (f) {
          if (f && f.url) u.push(f.url);
        });
      }
      if (!u.length) {
        var h = document.documentElement.innerHTML.replace(/\\\//g, "/");
        var re = /https?:\/\/[^"'\\\s)]*floorplan[^"'\\\s)]*?\.(?:jpe?g|png|gif|webp)/gi,
          m;
        while ((m = re.exec(h))) u.push(m[0]);
      }
      var byFile = {};
      u.forEach(function (x) {
        x = x.replace(/_max_\d+x\d+/i, "");
        var f = x.split("/").pop();
        if (!byFile[f] || byFile[f].indexOf("/dir/") !== -1) byFile[f] = x;
      });
      var found = Object.keys(byFile).map(function (f) {
        return byFile[f];
      });
      if (!found.length) {
        alert("No floorplan found on this page.");
        return;
      }
      var old = document.getElementById("fpo-grab");
      if (old) old.remove();
      var wrap = document.createElement("div");
      wrap.id = "fpo-grab";
      wrap.setAttribute("role", "dialog");
      wrap.setAttribute("aria-modal", "true");
      wrap.setAttribute("aria-label", "Grab floorplan");
      wrap.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.85);" +
        "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
        "gap:14px;padding:20px;font:14px/1.4 system-ui,sans-serif;";
      var bar = document.createElement("div");
      bar.style.cssText =
        "display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center;" +
        "background:#fff;color:#0f172a;padding:10px 14px;border-radius:10px;max-width:92vw;";
      var msg = document.createElement("strong");
      msg.textContent = "Right-click the plan → Copy Image, then";
      var openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.textContent = "Open Floor Plan Overlay";
      openBtn.style.cssText =
        "font:inherit;font-weight:600;padding:6px 12px;border:0;border-radius:8px;" +
        "background:#2563eb;color:#fff;cursor:pointer;";
      var closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", "Close");
      closeBtn.textContent = "✕";
      closeBtn.style.cssText =
        "font:inherit;padding:6px 10px;border:0;border-radius:8px;" +
        "background:#e2e8f0;color:#0f172a;cursor:pointer;";
      bar.append(msg, openBtn, closeBtn);
      var img = document.createElement("img");
      img.src = found[0];
      img.alt = "Floorplan";
      img.style.cssText =
        "max-width:92vw;max-height:72vh;background:#fff;border-radius:10px;object-fit:contain;";
      wrap.append(bar, img);
      if (found.length > 1) {
        var thumbs = document.createElement("div");
        thumbs.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;justify-content:center;";
        found.forEach(function (x, i) {
          var t = document.createElement("button");
          t.type = "button";
          t.textContent = "Plan " + (i + 1);
          t.style.cssText =
            "font:inherit;padding:6px 12px;border:0;border-radius:8px;background:#e2e8f0;cursor:pointer;";
          t.onclick = function () {
            img.src = x;
          };
          thumbs.appendChild(t);
        });
        wrap.appendChild(thumbs);
      }
      var close = function () {
        wrap.remove();
        document.removeEventListener("keydown", onKey);
      };
      var onKey = function (e) {
        if (e.key === "Escape") close();
      };
      document.addEventListener("keydown", onKey);
      closeBtn.onclick = close;
      wrap.onclick = function (e) {
        if (e.target === wrap) close();
      };
      openBtn.onclick = function () {
        var w = window.open(app + "#paste", "floorplan-overlay");
        if (w) w.focus();
        else alert("Popup blocked — switch to Floor Plan Overlay yourself and press Cmd/Ctrl+V.");
      };
      document.body.appendChild(wrap);
      openBtn.focus();
    } catch (e) {
      alert("Bookmarklet error: " + e.message);
    }
  }
  const APP_URL = location.href.split(/[#?]/)[0];
  const BOOKMARKLET =
    "javascript:(" + grabFloorplan.toString() + ")(" + JSON.stringify(APP_URL) + ");";
  const helpBtn = document.getElementById("help-btn");
  const helpPop = document.getElementById("help");
  const bmLink = document.getElementById("bm");
  const guideRmLink = document.getElementById("guide-rm-link");
  bmLink.href = BOOKMARKLET;
  helpBtn.addEventListener("click", () => helpPop.classList.remove("hidden"));
  document.getElementById("help-close").addEventListener("click", () => helpPop.classList.add("hidden"));
  guideRmLink.addEventListener("click", (e) => {
    e.preventDefault();
    helpPop.classList.remove("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!helpPop.contains(e.target) && e.target !== helpBtn && e.target !== guideRmLink)
      helpPop.classList.add("hidden");
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
    libHasPlans = true;
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
    closeLibrary(); // close the library after adding
    showHint(`Added “${rec.name}”.`, 2000);
  }

  const escapeHtml = (s) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function refreshLibrary() {
    libThumbUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    const recs = await PlanStore.list();
    libHasPlans = recs.length > 0;
    updateGuide();
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
    closeFurniture(); // the right-hand panels are mutually exclusive
    libraryPanel.classList.remove("hidden");
    libraryBtn.classList.add("active");
    refreshLibrary();
    ensurePersist();
  }
  function closeLibrary() {
    libraryPanel.classList.add("hidden");
    libraryBtn.classList.remove("active");
  }
  libraryBtn.addEventListener("click", openLibrary); // a menu item, so always open
  guideLibBtn.addEventListener("click", openLibrary);
  if (PlanStore.available())
    PlanStore.count().then((n) => {
      libHasPlans = n > 0;
      updateGuide();
    }).catch(() => {});

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
    } else if (!addMenu.classList.contains("hidden")) {
      addMenu.classList.add("hidden");
    } else if (!libraryPanel.classList.contains("hidden")) {
      closeLibrary();
    } else if (!furniturePanel.classList.contains("hidden")) {
      closeFurniture();
    } else if (pasteReady) {
      pasteReady = false;
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
    else if (distDraw) {
      distDraw = null;
      distCursor = null;
      render();
    } else if (distTool) setDistTool(false);
    else if (showCalibFor) {
      showCalibFor = null;
      render();
    } else if (selected !== null || selectedPlan !== null) {
      selected = null;
      selectedPlan = null;
      render();
    }
  });

  // Nudge the selected plan with the arrow keys (Shift = 10× coarser).
  const NUDGE_KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  document.addEventListener("keydown", (e) => {
    const d = NUDGE_KEYS[e.key];
    if (!d || !selectedPlan || calibrating() || e.target !== document.body) return;
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) / view.scale; // move by whole screen px
    selectedPlan.tx += d[0] * step;
    selectedPlan.ty += d[1] * step;
    render();
  });

  // Hold Space to peek under the top plan.
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat || peeking) return;
    if (e.target !== document.body || calibrating()) return;
    e.preventDefault();
    peeking = true;
    render();
  });
  document.addEventListener("keyup", (e) => {
    if (e.code !== "Space" || !peeking) return;
    peeking = false;
    render();
  });
  window.addEventListener("blur", () => {
    if (!peeking) return;
    peeking = false;
    render();
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

  // Opened via the bookmarklet's "Open Floor Plan Overlay" button: #paste
  // prompts for the floorplan on the clipboard. The hash is cleared straight
  // away so a later grab into this same (named) window re-fires hashchange.
  function checkPasteHash() {
    if (location.hash !== "#paste") return;
    history.replaceState(null, "", location.pathname + location.search);
    pasteReady = true;
    render();
  }
  window.addEventListener("hashchange", checkPasteHash);
  checkPasteHash();

  render();
})();
