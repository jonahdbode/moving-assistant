// ---------------------------------------------------------------------------
// App wiring: item picker state, packing recompute, truck comparison scenes,
// fuel/time cost table.
// ---------------------------------------------------------------------------

const state = {
  qty: {}, // itemId -> quantity
  dimensionOverrides: {}, // itemId -> { w, d, h } in inches
  dimensionEditOpen: {}, // itemId -> whether per-instance editors are visible
  dimensionGroups: {}, // itemId -> [{ count, w, d, h }]
  loadTier: {}, // box itemId -> heavy-box or light-box
  boxLightQty: {}, // box itemId -> number assigned to the light-box tier
  customItems: [], // user-defined items with dimensions in inches
  activeCategory: Object.keys(ITEM_CATALOG)[0],
  compare: {
    A: "t12",
    B: "t16",
  },
  activeTrip: { A: 0, B: 0 },
  distanceMiles: 5,
  localMileageCost: true,
  showFormation: false,
  showMeasurements: false,
  measurementsBySide: { A: false, B: false },
  movingBySide: { A: false, B: false },
  costOverrides: {},
  packingStrategy: "formation",
  ignoreWeightConstraints: false,
  showObjectModels: false,
  showLoadingSteps: false,
  activeLoadingStep: 5,
  recalculateThrough: 2,
  manualPlacements: {},
  selectedItems: {},
  manualMessages: {},
  lockedPlacements: {},
};

const history = [];
const HISTORY_LIMIT = 30;

let savedState = null;
try {
  savedState = JSON.parse(localStorage.getItem("penske-wizard-state") || "null");
} catch {
  localStorage.removeItem("penske-wizard-state");
}
if (savedState?.qty) state.qty = savedState.qty;
if (savedState?.dimensionOverrides) state.dimensionOverrides = savedState.dimensionOverrides;
if (savedState?.dimensionGroups) state.dimensionGroups = savedState.dimensionGroups;
if (savedState?.dimensionEditOpen) state.dimensionEditOpen = savedState.dimensionEditOpen;
if (savedState?.loadTier) state.loadTier = savedState.loadTier;
if (savedState?.schemaVersion >= 3 && savedState.boxLightQty) state.boxLightQty = savedState.boxLightQty;
if (Array.isArray(savedState?.customItems)) state.customItems = savedState.customItems;
if (savedState?.activeCategory) state.activeCategory = savedState.activeCategory;
if (savedState?.compare) state.compare = { ...state.compare, ...savedState.compare };
if (savedState?.distanceMiles != null) state.distanceMiles = savedState.distanceMiles;
if (savedState?.localMileageCost != null) state.localMileageCost = savedState.localMileageCost;
if (savedState?.packingStrategy) state.packingStrategy = savedState.packingStrategy;
if (savedState?.ignoreWeightConstraints != null) state.ignoreWeightConstraints = savedState.ignoreWeightConstraints;
if (savedState?.schemaVersion >= 4 && savedState.showObjectModels != null) state.showObjectModels = savedState.showObjectModels;
if (savedState?.showLoadingSteps != null) state.showLoadingSteps = savedState.showLoadingSteps;
if (savedState?.showFormation != null) state.showFormation = savedState.showFormation;
if (savedState?.showMeasurements != null) state.showMeasurements = savedState.showMeasurements;
if (savedState?.measurementsBySide) state.measurementsBySide = { ...state.measurementsBySide, ...savedState.measurementsBySide };
if (savedState?.movingBySide) state.movingBySide = { ...state.movingBySide, ...savedState.movingBySide };
if (savedState?.costOverrides) state.costOverrides = savedState.costOverrides;
if (savedState?.activeLoadingStep != null) state.activeLoadingStep = savedState.activeLoadingStep;
if (savedState?.recalculateThrough != null) state.recalculateThrough = savedState.recalculateThrough;
if (savedState?.manualPlacements) state.manualPlacements = savedState.manualPlacements;
if (savedState?.lockedPlacements) state.lockedPlacements = savedState.lockedPlacements;

const scenes = {}; // A/B -> TruckScene
let lastPackResults = {}; // A/B -> packTruck() result

function saveState() {
  localStorage.setItem("penske-wizard-state", JSON.stringify({
    schemaVersion: 4,
    qty: state.qty,
    dimensionOverrides: state.dimensionOverrides,
    dimensionGroups: state.dimensionGroups,
    dimensionEditOpen: state.dimensionEditOpen,
    loadTier: state.loadTier,
    boxLightQty: state.boxLightQty,
    customItems: state.customItems,
    activeCategory: state.activeCategory,
    compare: state.compare,
    distanceMiles: state.distanceMiles,
    localMileageCost: state.localMileageCost,
    packingStrategy: state.packingStrategy,
    ignoreWeightConstraints: state.ignoreWeightConstraints,
    showObjectModels: state.showObjectModels,
    showLoadingSteps: state.showLoadingSteps,
    showFormation: state.showFormation,
    showMeasurements: state.showMeasurements,
    measurementsBySide: state.measurementsBySide,
    movingBySide: state.movingBySide,
    costOverrides: state.costOverrides,
    activeLoadingStep: state.activeLoadingStep,
    recalculateThrough: state.recalculateThrough,
    manualPlacements: state.manualPlacements,
    lockedPlacements: state.lockedPlacements,
  }));
}

function resetPlan() {
  pushHistory();
  state.qty = {};
  state.dimensionOverrides = {};
  state.dimensionGroups = {};
  state.dimensionEditOpen = {};
  state.boxLightQty = {};
  state.manualPlacements = {};
  state.selectedItems = {};
  state.lockedPlacements = {};
  seedDefaultSelection();
  saveState();
  renderItems();
  recompute();
}

function undoPlan() {
  const previous = history.pop();
  if (previous) restoreSnapshot(previous);
}

function snapshot() {
  return JSON.stringify({ qty: state.qty, dimensionOverrides: state.dimensionOverrides, dimensionGroups: state.dimensionGroups, boxLightQty: state.boxLightQty, customItems: state.customItems, manualPlacements: state.manualPlacements, lockedPlacements: state.lockedPlacements });
}

function pushHistory() {
  history.push(snapshot());
  if (history.length > HISTORY_LIMIT) history.shift();
}

function restoreSnapshot(value) {
  const restored = JSON.parse(value);
  state.qty = restored.qty || {};
  state.dimensionOverrides = restored.dimensionOverrides || {};
  state.dimensionGroups = restored.dimensionGroups || {};
  state.boxLightQty = restored.boxLightQty || {};
  state.customItems = restored.customItems || [];
  state.manualPlacements = restored.manualPlacements || {};
  state.lockedPlacements = restored.lockedPlacements || {};
  saveState();
  renderItems();
  recompute();
}

function allItemsFlat() {
  return [
    ...Object.entries(ITEM_CATALOG).flatMap(([room, items]) =>
      items.map((item) => ({ ...item, room }))
    ),
    ...state.customItems.map((item) => ({ ...item, room: "Custom" })),
  ];
}

function getSelection() {
  return allItemsFlat()
    .filter((item) => (state.qty[item.id] || 0) > 0)
    .map((item) => {
      const quantity = state.qty[item.id];
      const defaultTier = getDefaultTier(item);
      const storedLightQuantity = state.boxLightQty?.[item.id];
      const lightDefault = defaultTier === "light" || defaultTier === "light-box";
      const lightQty = storedLightQuantity == null && lightDefault
        ? quantity
        : Math.min(storedLightQuantity || 0, quantity);
      const groups = getDimensionGroups(item, quantity);
      const instances = groups.flatMap((group) => Array.from({ length: group.count }, () => ({ w: group.w, d: group.d, h: group.h })));
      return { ...item, ...instances[0], instances, qty: quantity, lightQty, loadTier: state.loadTier?.[item.id] || defaultTier };
    });
}

function getInstanceDimensions(item, index) {
  return state.dimensionOverrides[`${item.id}-${index}`]
    || (index === 0 && state.dimensionOverrides[item.id])
    || { w: item.w, d: item.d, h: item.h };
}

function getDimensionGroups(item, quantity) {
  const savedGroups = state.dimensionGroups[item.id];
  if (Array.isArray(savedGroups) && savedGroups.length > 0) {
    const groups = [];
    let remaining = quantity;
    for (const group of savedGroups) {
      const count = Math.max(0, Math.min(remaining, Number(group.count) || 0));
      if (count > 0) groups.push({ ...group, count });
      remaining -= count;
    }
    if (remaining > 0) groups.push({ count: remaining, ...getInstanceDimensions(item, 0) });
    return groups;
  }
  return [{ count: quantity, ...getInstanceDimensions(item, 0) }];
}

function getDefaultTier(item) {
  if (item.defaultTier) return item.defaultTier;
  if (item.zone === "box") return /large|wardrobe/i.test(item.name) ? "heavy-box" : "light-box";
  if (item.zone === "mattress" || /sofa|couch/i.test(item.name)) return "soft";
  if (item.zone === "appliance" || /desk|bookcase|table|dresser|cabinet|buffet/i.test(item.name)) return "heavy";
  if (/chair/i.test(item.name)) return "light";
  return "light";
}

function loadingStep(item) {
  if (item.tier === "heavy" || item.zone === "appliance") return 1;
  if (item.tier === "soft" || item.zone === "mattress") return 2;
  if (item.tier === "light") return 3;
  if (item.tier === "heavy-box") return 4;
  return 5;
}

// ---------------- Item picker ----------------

function renderTabs() {
  const wrap = document.getElementById("category-tabs");
  wrap.innerHTML = "";
  const categories = ["Everything", ...Object.keys(ITEM_CATALOG), "Custom"];
  for (const cat of categories) {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (cat === state.activeCategory ? " active" : "");
    btn.textContent = cat;
    btn.onclick = () => {
      state.activeCategory = cat;
      saveState();
      renderTabs();
      renderItems();
    };
    wrap.appendChild(btn);
  }
}

function renderItems() {
  const grid = document.getElementById("items-grid");
  const customForm = document.getElementById("custom-item-form");
  const search = document.getElementById("catalog-search");
  customForm.hidden = state.activeCategory !== "Custom";
  grid.innerHTML = "";
  const query = search.value.trim().toLowerCase();
  const items = state.activeCategory === "Everything"
    ? allItemsFlat().filter((item) => (state.qty[item.id] || 0) > 0)
    : state.activeCategory === "Custom"
      ? state.customItems.map((item) => ({ ...item, room: "Custom" }))
      : ITEM_CATALOG[state.activeCategory].map((item) => ({ ...item, room: state.activeCategory }));
  const searchableItems = query && state.activeCategory !== "Everything" ? allItemsFlat() : items;
  const filteredItems = query
    ? searchableItems.filter((item) => `${item.name} ${item.room} ${item.zone}`.toLowerCase().includes(query))
    : items;
  if (filteredItems.length === 0) {
    grid.innerHTML = `<p class="empty-state">${query ? "No matching items in this view." : state.activeCategory === "Everything" ? "Your selected items will appear here." : "No items in this category yet."}</p>`;
    return;
  }
  for (const item of filteredItems) {
    const row = document.createElement("div");
    row.className = "item-row";
    const loadCategory = item.zone === "mattress" || /sofa|couch/i.test(item.name)
      ? "Sofas / Mattresses"
      : item.zone === "furniture" && /desk|bookcase/i.test(item.name)
        ? "Heavy Objects"
        : item.zone === "box"
          ? "Box"
          : item.zone === "appliance"
            ? "Heavy Objects"
            : "Furniture";
    const quantity = state.qty[item.id] || 0;
    const dimensions = getInstanceDimensions(item, 0);
    const dimensionGroups = getDimensionGroups(item, quantity);
    const defaultTier = getDefaultTier(item);
    const defaultLightQuantity = defaultTier === "light" || defaultTier === "light-box" ? quantity : 0;
    const lightQuantity = state.boxLightQty?.[item.id] == null
      ? defaultLightQuantity
      : Math.min(state.boxLightQty[item.id], quantity);
    const splitTier = item.zone === "box" || (item.zone === "furniture" && !/sofa|couch/i.test(item.name));
    const tierControl = splitTier ? `
      <label class="box-split">Heavy <strong>${quantity - lightQuantity}</strong> / Light
        <input class="box-light-qty" type="number" min="0" max="${quantity}" value="${lightQuantity}" aria-label="${item.name} light quantity" />
      </label>` : `<span class="load-category">${loadCategory}</span>`;
    const dimensionEditor = state.dimensionEditOpen[item.id] ? `
      <div class="dimension-editor-list">
        ${dimensionGroups.map((group, index) => {
          return `<label class="dimension-instance"><input class="group-count" data-group="${index}" type="number" min="1" max="${quantity}" value="${group.count}" aria-label="${item.name} group ${index + 1} quantity" /> items:
            <input class="dimension-input" data-group="${index}" data-dimension="w" type="number" min="1" value="${group.w}" aria-label="${item.name} group ${index + 1} width in inches" />
            <input class="dimension-input" data-group="${index}" data-dimension="d" type="number" min="1" value="${group.d}" aria-label="${item.name} group ${index + 1} depth in inches" />
            <input class="dimension-input" data-group="${index}" data-dimension="h" type="number" min="1" value="${group.h}" aria-label="${item.name} group ${index + 1} height in inches" />
          </label>`;
        }).join("")}
        ${quantity > 1 ? '<button class="add-dimension-group" type="button">+ Add group</button>' : ""}
      </div>` : `<span class="locked-dimensions">${dimensions.w}" x ${dimensions.d}" x ${dimensions.h}"</span>`;
    row.innerHTML = `
      <div class="item-info">
        <span class="item-name"><span class="item-icon">${item.icon || (item.zone === "box" ? "📦" : item.zone === "mattress" ? "🛏️" : item.zone === "appliance" ? "◻️" : "🪑")}</span>${item.name}${state.activeCategory === "Everything" || query ? ` <span class="room">(${item.room})</span>` : ""}</span>
        ${dimensionEditor}
        <button class="dimension-toggle" type="button">${state.dimensionEditOpen[item.id] ? "Lock dimensions" : "Edit dimensions"}</button>
        ${item.custom ? '<button class="remove-custom-item" type="button">Remove</button>' : ""}
        ${tierControl}
      </div>
      <div class="stepper">
        <button data-action="dec">−</button>
        <span class="qty">${state.qty[item.id] || 0}</span>
        <button data-action="inc">+</button>
      </div>
    `;
    const lightQuantityInput = row.querySelector(".box-light-qty");
    if (lightQuantityInput) lightQuantityInput.onchange = (event) => {
      pushHistory();
      state.boxLightQty = { ...(state.boxLightQty || {}), [item.id]: Math.max(0, Math.min(quantity, Number(event.target.value) || 0)) };
      saveState();
      renderItems();
      recompute();
    };
    row.querySelector(".dimension-toggle").onclick = () => {
      state.dimensionEditOpen[item.id] = !state.dimensionEditOpen[item.id];
      saveState();
      renderItems();
    };
    row.querySelector(".remove-custom-item")?.addEventListener("click", () => {
      pushHistory();
      state.customItems = state.customItems.filter((customItem) => customItem.id !== item.id);
      delete state.qty[item.id];
      delete state.dimensionGroups[item.id];
      delete state.dimensionOverrides[item.id];
      saveState();
      renderTabs();
      renderItems();
      recompute();
    });
    row.querySelectorAll(".dimension-input").forEach((input) => input.onchange = () => {
      pushHistory();
      const groupIndex = Number(input.dataset.group);
      const groups = getDimensionGroups(item, quantity);
      groups[groupIndex][input.dataset.dimension] = Math.max(1, Number(input.value) || item[input.dataset.dimension]);
      state.dimensionGroups[item.id] = groups;
      saveState();
      renderItems();
      recompute();
    });
    row.querySelectorAll(".group-count").forEach((input) => input.onchange = () => {
      pushHistory();
      const groupIndex = Number(input.dataset.group);
      const groups = getDimensionGroups(item, quantity);
      groups[groupIndex].count = Math.max(1, Math.min(quantity, Number(input.value) || 1));
      state.dimensionGroups[item.id] = groups;
      saveState();
      renderItems();
      recompute();
    });
    row.querySelector(".add-dimension-group")?.addEventListener("click", () => {
      pushHistory();
      const groups = getDimensionGroups(item, quantity);
      const sourceIndex = groups.findIndex((group) => group.count > 1);
      if (sourceIndex >= 0) {
        const source = groups[sourceIndex];
        const splitCount = Math.floor(source.count / 2);
        source.count -= splitCount;
        groups.splice(sourceIndex + 1, 0, { count: splitCount, w: source.w, d: source.d, h: source.h });
      }
      state.dimensionGroups[item.id] = groups;
      saveState();
      renderItems();
    });
    row.querySelector('[data-action="dec"]').onclick = () => {
      pushHistory();
      state.qty[item.id] = Math.max(0, (state.qty[item.id] || 0) - 1);
      saveState();
      renderItems();
      recompute();
    };
    row.querySelector('[data-action="inc"]').onclick = () => {
      pushHistory();
      state.qty[item.id] = (state.qty[item.id] || 0) + 1;
      saveState();
      renderItems();
      recompute();
    };
    grid.appendChild(row);
  }
}

// ---------------- Summary (total volume + naive recommendation) ----------------

function renderSummary() {
  const selection = getSelection();
  const totalCuFt = expandUnits(selection).reduce((sum, item) => sum + item.w * item.d * item.h, 0);
  document.getElementById("total-volume").textContent = `${totalCuFt.toFixed(0)} cu ft`;

  // Recommended = smallest truck that fits everything in a single trip.
  let recommended = TRUCKS[TRUCKS.length - 1];
  for (const truck of TRUCKS) {
    const result = packTruck(selection, truck, state.packingStrategy, state.ignoreWeightConstraints);
    if (result.tripCount === 1 && result.impossibleItems.length === 0) {
      recommended = truck;
      break;
    }
  }
  document.getElementById("recommended-truck").textContent = selection.length ? recommended.label : "—";
}

// ---------------- Truck comparison (3D) ----------------

function buildCompareCards() {
  const grid = document.getElementById("compare-grid");
  grid.innerHTML = "";
  for (const side of ["A", "B"]) {
    const card = document.createElement("div");
    card.className = "truck-card";
    card.innerHTML = `
      <div class="truck-card-header">
        <select id="truck-select-${side}"></select>
        <button class="card-measurements-toggle" id="measurements-toggle-${side}" type="button">Measurements off</button>
        <button class="card-moving-toggle" id="moving-toggle-${side}" type="button">Moving off</button>
        <button class="card-lock-all" id="lock-all-${side}" type="button">Lock all in place</button>
      </div>
      <div class="truck-canvas-wrap">
        <canvas id="canvas-${side}"></canvas>
      </div>
      <div class="manual-controls" id="manual-controls-${side}"></div>
      <button class="finish-reorganizing" id="finish-reorganizing-${side}" type="button">Finish reorganizing</button>
      <div class="trip-tabs" id="trip-tabs-${side}"></div>
      <div class="truck-stats" id="truck-stats-${side}"></div>
    `;
    grid.appendChild(card);

    const select = card.querySelector(`#truck-select-${side}`);
    for (const truck of TRUCKS) {
      const opt = document.createElement("option");
      opt.value = truck.id;
      opt.textContent = `${truck.label} (${truck.cuft} cu ft)`;
      if (truck.id === state.compare[side]) opt.selected = true;
      select.appendChild(opt);
    }
    select.onchange = (e) => {
      state.compare[side] = e.target.value;
      saveState();
      state.activeTrip[side] = 0;
      recompute();
    };

    scenes[side] = new TruckScene(card.querySelector(`#canvas-${side}`));
    const measurementButton = card.querySelector(`#measurements-toggle-${side}`);
    measurementButton.classList.toggle("active", state.measurementsBySide[side]);
    measurementButton.textContent = state.measurementsBySide[side] ? "Measurements on" : "Measurements off";
    measurementButton.onclick = () => {
      state.measurementsBySide[side] = !state.measurementsBySide[side];
      saveState();
      measurementButton.classList.toggle("active", state.measurementsBySide[side]);
      measurementButton.textContent = state.measurementsBySide[side] ? "Measurements on" : "Measurements off";
      scenes[side].setMeasurementsVisible(state.measurementsBySide[side]);
    };
    const movingButton = card.querySelector(`#moving-toggle-${side}`);
    const updateMovingButton = () => {
      movingButton.classList.toggle("active", state.movingBySide[side]);
      movingButton.textContent = state.movingBySide[side] ? "Moving on" : "Moving off";
    };
    updateMovingButton();
    movingButton.onclick = () => {
      state.movingBySide[side] = !state.movingBySide[side];
      if (!state.movingBySide[side]) {
        scenes[side].clearMovingItem();
        state.selectedItems[side] = null;
        scenes[side].selectedMesh = null;
      }
      saveState();
      updateMovingButton();
      renderCompareSide(side);
    };
    card.querySelector(`#lock-all-${side}`).onclick = () => {
      const result = lastPackResults[side]?.result;
      let count = 0;
      for (const [tripIndex, placements] of (result?.trips || []).map((trip) => trip.placements).entries()) {
        const manualKey = `${side}-${tripIndex}`;
        const manual = state.manualPlacements[manualKey] || {};
        const locked = state.lockedPlacements[manualKey] || {};
        for (const uid of Object.keys(manual)) {
          if (!locked[uid]) count++;
          locked[uid] = true;
        }
        if (Object.keys(locked).length) state.lockedPlacements[manualKey] = locked;
      }
      state.manualMessages[side] = count ? `Locked ${count} moved item${count === 1 ? "" : "s"} in place` : "No moved items to lock";
      saveState();
      renderCompareSide(side);
    };
  }
}

function renderCompareSide(side) {
  const truck = TRUCKS.find((t) => t.id === state.compare[side]);
  const selection = getSelection();
  const manualKey = `${side}-${state.activeTrip[side]}`;
  const manual = state.manualPlacements[manualKey] || {};
  const fixedPlacements = Object.entries(manual).map(([uid, placement]) => {
    const source = expandUnits(selection).find((item) => item.uid === uid);
    return source ? { ...source, ...placement, uid } : null;
  }).filter(Boolean);
  const result = packTruck(selection, truck, state.packingStrategy, state.ignoreWeightConstraints, fixedPlacements);
  lastPackResults[side] = { truck, result };

  if (state.activeTrip[side] >= result.tripCount) state.activeTrip[side] = 0;

  // trip tabs (only shown if >1 trip needed)
  const tripTabsEl = document.getElementById(`trip-tabs-${side}`);
  tripTabsEl.innerHTML = "";
  if (result.tripCount > 1) {
    for (let i = 0; i < result.tripCount; i++) {
      const tab = document.createElement("button");
      tab.className = "trip-tab" + (i === state.activeTrip[side] ? " active" : "");
      tab.textContent = `Trip ${i + 1}`;
      tab.onclick = () => {
        pushHistory();
        state.activeTrip[side] = i;
        renderCompareSide(side);
      };
      tripTabsEl.appendChild(tab);
    }
  }

  const trip = result.trips[state.activeTrip[side]] || { placements: [] };
  const plannedPlacements = trip.placements.map((item) => manual[item.uid] ? { ...item, ...manual[item.uid], manual: true } : item);
  const visiblePlacements = state.showLoadingSteps
    ? plannedPlacements.filter((item) => loadingStep(item) <= state.activeLoadingStep)
    : plannedPlacements;
  scenes[side].render(truck, visiblePlacements, state.showFormation, state.showObjectModels, (uid, position, dimensions, options) => {
    const item = plannedPlacements.find((placement) => placement.uid === uid);
    if (!item) return false;
    const shape = dimensions || { w: item.w, d: item.d, h: item.h };
    const candidate = {
      x: position.x + truck.W / 2 - shape.w / 2,
      y: options?.dropToFloor ? 0 : position.y,
      z: position.z - shape.d / 2,
    };
    const selectionByUid = new Map(expandUnits(selection).map((selected) => [selected.uid, selected]));
    const manualPlacements = Object.entries(state.manualPlacements[manualKey] || {})
      .filter(([manualUid]) => manualUid !== uid)
      .map(([manualUid, manualPlacement]) => ({ ...manualPlacement, uid: manualUid, name: selectionByUid.get(manualUid)?.name || "another manually placed item" }));
    const horizontalOverlaps = manualPlacements.filter((other) =>
      candidate.x < other.x + other.w - 1e-6 && candidate.x + shape.w > other.x + 1e-6 &&
      candidate.z < other.z + other.d - 1e-6 && candidate.z + shape.d > other.z + 1e-6);
    if (options?.dropToFloor && horizontalOverlaps.length) {
      candidate.y = Math.max(...horizontalOverlaps.map((other) => other.y + other.h));
    }
    const validBounds = candidate.x >= -1e-6 && candidate.y >= -1e-6 && candidate.z >= -1e-6 &&
      candidate.x + shape.w <= truck.W + 1e-6 && candidate.y + shape.h <= truck.H + 1e-6 &&
      candidate.z + shape.d <= truck.L + 1e-6;
    const overlapsAnother = manualPlacements.find((other) =>
      candidate.x < other.x + other.w - 1e-6 && candidate.x + shape.w > other.x + 1e-6 &&
      candidate.y < other.y + other.h - 1e-6 && candidate.y + shape.h > other.y + 1e-6 &&
      candidate.z < other.z + other.d - 1e-6 && candidate.z + shape.d > other.z + 1e-6);
    if (!validBounds || overlapsAnother) {
      if (shape.h > truck.H + 1e-6) {
        scenes[side].lastPlacementError = `This ${item.name} height exceeds this truck size (${Math.round(shape.h * 12)} in > ${Math.round(truck.H * 12)} in interior height).`;
      } else if (shape.w > truck.W + 1e-6) {
        scenes[side].lastPlacementError = `This ${item.name} width exceeds this truck size (${Math.round(shape.w * 12)} in > ${Math.round(truck.W * 12)} in interior width).`;
      } else if (shape.d > truck.L + 1e-6) {
        scenes[side].lastPlacementError = `This ${item.name} length exceeds this truck size (${Math.round(shape.d * 12)} in > ${Math.round(truck.L * 12)} in cargo length).`;
      } else if (overlapsAnother) {
        scenes[side].lastPlacementError = `There is not enough room for this ${item.name} beside the manually placed ${overlapsAnother.name} (at x ${overlapsAnother.x.toFixed(2)}, z ${overlapsAnother.z.toFixed(2)}). Move that item first or use Undo move.`;
      } else {
        scenes[side].lastPlacementError = `This ${item.name} would leave the truck's usable cargo space.`;
      }
      return false;
    }
    scenes[side].lastPlacementError = "";
    state.manualPlacements[manualKey] = { ...(state.manualPlacements[manualKey] || {}), [uid]: { ...candidate, ...shape } };
    saveState();
    renderCompareSide(side);
    return true;
  });
  if (state.movingBySide[side] && scenes[side].movingKey) scenes[side].setMovingItem(scenes[side].movingKey);
  scenes[side].onItemSelect = (item) => {
    state.selectedItems[side] = item.uid;
    scenes[side].selectedKey = item.uid;
    if (state.movingBySide[side]) scenes[side].setMovingItem(item.uid);
    scenes[side].setMeasurementsVisible(state.measurementsBySide[side]);
    renderManualControls(side);
  };
  scenes[side].setMeasurementsVisible(state.measurementsBySide[side]);
  scenes[side].onLockInPlace = () => {
    const uid = state.selectedItems[side];
    if (!uid || !state.manualPlacements[manualKey]?.[uid]) return;
    state.lockedPlacements[manualKey] = { ...(state.lockedPlacements[manualKey] || {}), [uid]: true };
    state.manualMessages[side] = "Position locked in place";
    saveState();
    renderManualControls(side);
  };
  scenes[side].onUndoMoving = () => {
    const selectedUid = state.selectedItems[side];
    if (!selectedUid) return;
    delete state.manualPlacements[manualKey]?.[selectedUid];
    delete state.lockedPlacements[manualKey]?.[selectedUid];
    if (state.manualPlacements[manualKey] && Object.keys(state.manualPlacements[manualKey]).length === 0) delete state.manualPlacements[manualKey];
    state.manualMessages[side] = "Returned to automatic placement";
    saveState();
    renderCompareSide(side);
  };
  scenes[side].onFinishReorganizing = () => {
    scenes[side].clearMovingItem();
    state.selectedItems[side] = null;
    state.manualMessages[side] = "Reorganized plan recalculated";
    recompute();
  };
  scenes[side].onRecalculateRemaining = (throughStep = state.recalculateThrough) => {
    state.manualMessages[side] = `Recalculated around placed items through Step ${throughStep}`;
    saveState();
    renderCompareSide(side);
  };
  renderManualControls(side);
  document.getElementById(`finish-reorganizing-${side}`).onclick = () => scenes[side].onFinishReorganizing();

  const statsEl = document.getElementById(`truck-stats-${side}`);
  const strategyLabel = state.packingStrategy === "efficient" ? "Efficient rotation / space-first" : "I-formation guided";
  const tripVolume = trip.placements.reduce((sum, item) => sum + item.w * item.d * item.h, 0);
  const utilPct = Math.min(100, (tripVolume / truck.cuft) * 100);
  const itemCounts = trip.placements.reduce((counts, item) => {
    counts[item.name] = (counts[item.name] || 0) + 1;
    return counts;
  }, {});
  const tripSummary = Object.entries(itemCounts).map(([name, count]) => `${count} × ${name}`).join(" · ");
  const stepLabels = ["Heavy furniture", "Sofas / mattresses", "Light furniture", "Heavy boxes", "Small boxes / misc"];
  const stepStatus = state.showLoadingSteps ? `<div class="strategy-status">Loading Step ${state.activeLoadingStep}: ${stepLabels[state.activeLoadingStep - 1]}</div>` : "";
  const tripLabel = result.trips.length ? `on Trip ${state.activeTrip[side] + 1}` : "No feasible trip";
  let html = `<div>${tripVolume.toFixed(0)} cu ft ${tripLabel} · ${truck.cuft} cu ft / trip · ${utilPct.toFixed(0)}% utilized</div><div class="trip-summary">${tripSummary || "No items loaded"}</div><div class="strategy-status">${strategyLabel}</div>${stepStatus}`;
  if (result.tripCount > 1) {
    html += `<div class="warn">Doesn't fit in one trip — ${result.tripCount} trips needed in this truck</div>`;
    if (utilPct < 50) {
      html += `<div class="trip-explanation">The load is spread across multiple large items and the truck's shape, so unused gaps remain even though this trip is only ${utilPct.toFixed(0)}% full by volume.</div>`;
    }
  }
  if (result.impossibleItems.length > 0) {
    html += `<div class="warn">${result.impossibleItems.length} item(s) too large for this truck's cargo box</div>`;
  }
  statsEl.innerHTML = html;
  renderPackingTips();
}

function renderPackingTips() {
  const target = document.getElementById("packing-tips-list");
  if (!target) return;
  const side = ["A", "B"].find((candidate) => state.movingBySide[candidate] && state.selectedItems[candidate]);
  if (!side) {
    target.textContent = "Turn Moving on and select an item to see truck-specific tips.";
    return;
  }
  const truck = lastPackResults[side]?.truck;
  const trip = lastPackResults[side]?.result.trips[state.activeTrip[side]];
  const manual = state.manualPlacements[`${side}-${state.activeTrip[side]}`] || {};
  const item = trip?.placements
    .map((placement) => manual[placement.uid] ? { ...placement, ...manual[placement] } : placement)
    .find((placement) => placement.uid === state.selectedItems[side]);
  if (!truck || !item) {
    target.textContent = "Select an item in the scene to see truck-specific tips.";
    return;
  }
  const width = (item.baseW || item.w) * 12;
  const depth = (item.baseD || item.d) * 12;
  const height = (item.baseH || item.h) * 12;
  const tips = [];
  if (width > truck.W * 12) {
    tips.push(`${item.name} is ${Math.round(width)} in wide, wider than the ${truck.label}'s ${Math.round(truck.W * 12)} in interior width. ${depth <= truck.W * 12 ? `Rotate it so its ${Math.round(depth)} in depth faces across the truck.` : "It will not fit across this truck in either orientation."}`);
  }
  if (height > truck.H * 12 && depth > truck.H * 12) {
    tips.push(`${item.name} is too tall to stand in the ${truck.label}; its ${Math.round(height)} in height exceeds the ${Math.round(truck.H * 12)} in interior height.`);
  }
  if (Math.max(width, depth) > truck.L * 12) {
    tips.push(`${item.name} has a ${Math.round(Math.max(width, depth))} in side longer than the ${truck.label}'s ${Math.round(truck.L * 12)} in cargo length.`);
  }
  target.innerHTML = tips.length ? `<ul>${[...new Set(tips)].map((tip) => `<li>${tip}</li>`).join("")}</ul>` : "This item fits the displayed truck dimensions. Keep it supported and leave heavier items low.";
}

function renderManualControls(side) {
  const controls = document.getElementById(`manual-controls-${side}`);
  const uid = state.selectedItems[side];
  const tripKey = `${side}-${state.activeTrip[side]}`;
  const manual = state.manualPlacements[tripKey] || {};
  const placement = lastPackResults[side]?.result.trips[state.activeTrip[side]]?.placements
    .map((item) => manual[item.uid] ? { ...item, ...manual[item.uid] } : item)
    .find((item) => item.uid === uid);
  controls.innerHTML = placement && state.movingBySide[side] ? `
    <div class="manual-item-meta"><strong>${placement.name}</strong><span class="selected-tier">${placement.tier} · x ${placement.x.toFixed(2)} · z ${placement.z.toFixed(2)}</span></div>
    <div class="move-buttons">
      <button data-move="left" title="Move left">←</button>
      <button data-move="forward" title="Move toward cab">↑</button>
      <button data-move="back" title="Move toward rear">↓</button>
      <button data-move="right" title="Move right">→</button>
      <button data-rotate title="Rotate 90 degrees">Rotate</button>
    </div>
    <div class="manual-actions">${manual[uid] ? '<button class="undo-moving" type="button">Undo move</button>' : ""}<button class="lock-in-place" type="button">${state.lockedPlacements[tripKey]?.[uid] ? "Locked in place" : "Lock in place"}</button></div>
    <span class="manual-message">${state.manualMessages[side] || ""}</span>` : '<span>Click an item in the scene to position it.</span>';
  controls.querySelectorAll("[data-move]").forEach((button) => button.onclick = () => {
    state.manualMessages[side] = scenes[side].moveSelected(button.dataset.move) === false ? (scenes[side].lastPlacementError || "Move blocked: item would leave the truck or overlap another item.") : "Moved";
    renderManualControls(side);
  });
  controls.querySelector("[data-rotate]")?.addEventListener("click", () => {
    state.manualMessages[side] = scenes[side].rotateSelected() === false ? (scenes[side].lastPlacementError || "Rotation blocked: item would leave the truck or overlap another item.") : "Rotated";
    renderManualControls(side);
  });
  controls.querySelector(".undo-moving")?.addEventListener("click", () => scenes[side].onUndoMoving?.());
  controls.querySelector(".lock-in-place")?.addEventListener("click", () => scenes[side].onLockInPlace?.());
}

// ---------------- Fuel & time table ----------------

function renderCostTable() {
  const tbody = document.getElementById("cost-table-body");
  tbody.innerHTML = "";
  const selection = getSelection();
  const distance = state.distanceMiles;

  const rows = TRUCKS.map((truck) => {
    const result = packTruck(selection, truck, state.packingStrategy, state.ignoreWeightConstraints);
    const overrides = state.costOverrides[truck.id] || {};
    const mpg = Math.min(truck.mpgMax || truck.mpg, Math.max(3, Number(overrides.mpg) || truck.mpg));
    const fuelPrice = Number(overrides.fuelPrice) || FUEL_PRICES[truck.fuel];
    const mileRate = Number(overrides.mileRate) >= 0 ? Number(overrides.mileRate) : 1;
    const roundTripMiles = distance * 2 * result.tripCount;
    const totalVolume = result.totalVolumeCuFt;
    const oneWay = !state.localMileageCost;
    const oneWayFitsByVolume = totalVolume <= truck.cuft;
    const unavailableOneWay = oneWay && !oneWayFitsByVolume;
    const displayTrips = oneWay ? 1 : result.tripCount;
    const totalMiles = oneWay ? distance : roundTripMiles;
    const gallons = totalMiles / mpg;
    const fuelCost = gallons * fuelPrice;
    const mileageCost = state.localMileageCost ? totalMiles * mileRate : 0;
    const variableCost = fuelCost + mileageCost;
    const driveHours = totalMiles / 45; // assume 45 mph average local driving
    const loadHours = (displayTrips * 45) / 60; // 45 min load/unload per trip
    const totalHours = driveHours + loadHours;
    const unavailable = oneWay ? unavailableOneWay : false;
    return { truck, result, mpg, fuelPrice, mileRate, displayTrips, totalMiles, fuelCost, mileageCost, variableCost, totalHours, unavailable };
  });

  const feasible = rows.filter((r) => !r.unavailable);
  const best = feasible.reduce((min, r) => (r.displayTrips < min.displayTrips ? r : min), feasible[0]);

  for (const row of rows) {
    const tr = document.createElement("tr");
    if (best && row.truck.id === best.truck.id) tr.className = "recommended";
    const hrs = Math.floor(row.totalHours);
    const mins = Math.round((row.totalHours - hrs) * 60);
    tr.innerHTML = `
      <td>${row.truck.label}</td>
      <td>${row.unavailable ? "—" : row.displayTrips}</td>
      <td>${row.unavailable ? "—" : row.totalMiles.toFixed(0) + " mi"}</td>
      <td>${row.unavailable ? "—" : `<input class="cost-input" data-cost="mpg" type="number" min="3" max="${row.truck.mpgMax || row.truck.mpg}" step="0.1" value="${row.mpg}" aria-label="${row.truck.label} MPG" />`}</td>
      <td>${row.unavailable ? "—" : `<input class="cost-input" data-cost="fuelPrice" type="number" min="0" step="0.01" value="${row.fuelPrice.toFixed(2)}" aria-label="${row.truck.label} fuel price" />`}</td>
      <td>${row.unavailable ? "—" : `<input class="cost-input" data-cost="mileRate" type="number" min="0" step="0.01" value="${row.mileRate.toFixed(2)}" aria-label="${row.truck.label} mileage rate" />`}</td>
      <td>${row.unavailable ? "—" : "$" + row.fuelCost.toFixed(2)}</td>
      <td>${row.unavailable ? "—" : "$" + row.mileageCost.toFixed(2)}</td>
      <td>${row.unavailable ? "—" : "$" + row.variableCost.toFixed(2)}</td>
      <td>${row.unavailable ? "—" : `${hrs}h ${mins}m`}</td>
    `;
    tbody.appendChild(tr);
    tr.querySelectorAll(".cost-input").forEach((input) => input.onchange = () => {
      const minimum = input.dataset.cost === "mpg" ? 3 : 0;
      const maximum = input.dataset.cost === "mpg" ? (row.truck.mpgMax || row.truck.mpg) : Infinity;
      state.costOverrides[row.truck.id] = { ...(state.costOverrides[row.truck.id] || {}), [input.dataset.cost]: Math.min(maximum, Math.max(minimum, Number(input.value) || minimum)) };
      saveState();
      renderCostTable();
    });
  }
}

// ---------------- Recompute everything ----------------

function recompute() {
  renderSummary();
  renderCompareSide("A");
  renderCompareSide("B");
  renderCostTable();
}

const confirmResetPlan = () => {
  if (window.confirm("Reset the packing plan? This will remove all quantities, saved orientations, moved objects, and locks.")) resetPlan();
};
document.getElementById("recalculate-button").onclick = confirmResetPlan;
document.getElementById("undo-button").onclick = undoPlan;
document.getElementById("reset-button").onclick = confirmResetPlan;

document.getElementById("custom-item-form").onsubmit = (event) => {
  event.preventDefault();
  const name = document.getElementById("custom-item-name").value.trim();
  const width = Math.max(1, Number(document.getElementById("custom-item-width").value) || 0);
  const depth = Math.max(1, Number(document.getElementById("custom-item-depth").value) || 0);
  const height = Math.max(1, Number(document.getElementById("custom-item-height").value) || 0);
  const tier = document.getElementById("custom-item-tier").value;
  if (!name || !width || !depth || !height) return;
  const zone = tier.includes("box") ? "box" : tier === "soft" ? "mattress" : "furniture";
  const color = tier === "soft" ? 0x55a66d : tier.includes("box") ? 0xb45309 : tier === "light" ? 0x1d4ed8 : 0xf28c28;
  const id = `custom-${Date.now()}-${state.customItems.length}`;
  pushHistory();
  state.customItems.push({ id, name, w: width, d: depth, h: height, zone, defaultTier: tier, color, custom: true });
  state.qty[id] = 1;
  state.activeCategory = "Custom";
  event.currentTarget.reset();
  saveState();
  renderTabs();
  renderItems();
  recompute();
};

document.getElementById("catalog-search").addEventListener("input", () => renderItems());

document.getElementById("distance-input").addEventListener("input", (e) => {
  state.distanceMiles = Math.max(0, Number(e.target.value) || 0);
  saveState();
  renderCostTable();
});

document.getElementById("distance-input").value = state.distanceMiles;
document.getElementById("local-mileage-toggle").checked = state.localMileageCost;
document.getElementById("local-mileage-toggle").addEventListener("change", (e) => {
  state.localMileageCost = e.target.checked;
  saveState();
  renderCostTable();
});

document.getElementById("formation-toggle").addEventListener("click", (e) => {
  state.showFormation = !state.showFormation;
  e.currentTarget.textContent = state.showFormation ? "Formation guide on" : "Formation guide off";
  e.currentTarget.classList.toggle("active", state.showFormation);
  saveState();
  renderCompareSide("A");
  renderCompareSide("B");
});

document.getElementById("formation-toggle").textContent = state.showFormation ? "Formation guide on" : "Formation guide off";
document.getElementById("formation-toggle").classList.toggle("active", state.showFormation);

document.getElementById("packing-strategy").value = state.packingStrategy;
document.getElementById("packing-strategy").addEventListener("change", (e) => {
  state.packingStrategy = e.target.value;
  saveState();
  recompute();
});

document.getElementById("ignore-weight-toggle").checked = state.ignoreWeightConstraints;
document.getElementById("ignore-weight-toggle").addEventListener("change", (e) => {
  state.ignoreWeightConstraints = e.target.checked;
  saveState();
  recompute();
});

document.getElementById("object-model-toggle").checked = state.showObjectModels;
document.getElementById("object-model-toggle").addEventListener("change", (e) => {
  state.showObjectModels = e.target.checked;
  saveState();
  recompute();
});

document.getElementById("loading-steps-toggle").checked = state.showLoadingSteps;
document.querySelector(".loading-step-controls").hidden = !state.showLoadingSteps;
document.getElementById("loading-steps-toggle").addEventListener("change", (e) => {
  state.showLoadingSteps = e.target.checked;
  document.querySelector(".loading-step-controls").hidden = !state.showLoadingSteps;
  saveState();
  recompute();
});

document.getElementById("recalculate-through").value = String(state.recalculateThrough);
document.getElementById("recalculate-through").onchange = (event) => {
  state.recalculateThrough = Number(event.target.value);
  state.activeLoadingStep = state.recalculateThrough;
  document.querySelectorAll(".loading-step").forEach((stepButton) => stepButton.classList.toggle("active", Number(stepButton.dataset.step) === state.activeLoadingStep));
  saveState();
};
document.querySelector(".recalculate-remaining").onclick = () => {
  scenes.A.onRecalculateRemaining?.(state.recalculateThrough);
  scenes.B.onRecalculateRemaining?.(state.recalculateThrough);
};

document.querySelector(".lock-through-step").onclick = () => {
  const throughStep = state.activeLoadingStep;
  for (const side of ["A", "B"]) {
    const result = lastPackResults[side]?.result;
    for (const [tripIndex, trip] of (result?.trips || []).entries()) {
      const manualKey = `${side}-${tripIndex}`;
      const existing = state.manualPlacements[manualKey] || {};
      const locked = state.lockedPlacements[manualKey] || {};
      for (const planned of trip.placements.filter((item) => loadingStep(item) <= throughStep)) {
        const placement = existing[planned.uid] ? { ...planned, ...existing[planned.uid] } : planned;
        existing[planned.uid] = { x: placement.x, y: placement.y, z: placement.z, w: placement.w, d: placement.d, h: placement.h };
        locked[planned.uid] = true;
      }
      if (Object.keys(existing).length) state.manualPlacements[manualKey] = existing;
      if (Object.keys(locked).length) state.lockedPlacements[manualKey] = locked;
    }
    state.manualMessages[side] = `Locked items through Step ${throughStep}`;
  }
  saveState();
  renderCompareSide("A");
  renderCompareSide("B");
};

document.querySelector(".unlock-through-step").onclick = () => {
  const throughStep = state.activeLoadingStep;
  for (const side of ["A", "B"]) {
    const result = lastPackResults[side]?.result;
    for (const [tripIndex, trip] of (result?.trips || []).entries()) {
      const manualKey = `${side}-${tripIndex}`;
      const manual = state.manualPlacements[manualKey] || {};
      const locked = state.lockedPlacements[manualKey] || {};
      for (const planned of trip.placements.filter((item) => loadingStep(item) <= throughStep)) {
        delete manual[planned.uid];
        delete locked[planned.uid];
      }
      if (Object.keys(manual).length) state.manualPlacements[manualKey] = manual;
      else delete state.manualPlacements[manualKey];
      if (Object.keys(locked).length) state.lockedPlacements[manualKey] = locked;
      else delete state.lockedPlacements[manualKey];
    }
    state.manualMessages[side] = `Unlocked items through Step ${throughStep}`;
  }
  saveState();
  renderCompareSide("A");
  renderCompareSide("B");
};

document.querySelectorAll(".loading-step").forEach((button) => {
  button.classList.toggle("active", Number(button.dataset.step) === state.activeLoadingStep);
  button.onclick = () => {
    state.activeLoadingStep = Number(button.dataset.step);
    state.recalculateThrough = state.activeLoadingStep;
    state.showLoadingSteps = true;
    saveState();
    document.getElementById("loading-steps-toggle").checked = true;
    document.getElementById("recalculate-through").value = String(state.recalculateThrough);
    document.querySelectorAll(".loading-step").forEach((stepButton) => stepButton.classList.toggle("active", stepButton === button));
    recompute();
  };
});

// ---------------- Seed a default selection so the demo isn't empty ----------------

function seedDefaultSelection() {
  if (Object.keys(state.qty).length > 0) return;
  state.qty["sofa"] = 1;
  state.qty["tall-bookcase"] = 1;
  state.qty["queen-mattress"] = 1;
  state.qty["queen-boxspring"] = 1;
  state.qty["dresser"] = 1;
  state.qty["dining-table"] = 1;
  state.qty["dining-chair"] = 4;
  state.qty["large-box-lr"] = 6;
  state.qty["medium-box-kd"] = 8;
}

function applyUrlSelection() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("reset") !== "1") return;
  const inventory = (params.get("inventory") || "").toLowerCase();
  const quantity = (pattern, fallback = 1) => {
    const match = inventory.match(new RegExp(`(\\d+)\\s+(?:${pattern})`));
    return match ? Number(match[1]) : fallback;
  };
  const nextQty = {};
  const threeBedroomApartment = /3[- ]bedroom apartment|3 bedrooms?/i.test(inventory);
  if (threeBedroomApartment) {
    nextQty["queen-mattress"] = 3;
    nextQty["queen-boxspring"] = 3;
    nextQty.sofa = 1;
    nextQty["sofa-3-seat"] = 1;
    nextQty.dresser = 1;
    nextQty["dining-table"] = 1;
    nextQty["dining-chair"] = 6;
    nextQty["medium-box-kd"] = 20;
  }
  if (!threeBedroomApartment) {
    if (params.get("item") === "sofa" || /sofa|couch/.test(inventory)) nextQty.sofa = quantity("sectional sofas?|sofas?|couches?", 1);
    if (/queen bed|queen mattress/.test(inventory)) nextQty["queen-mattress"] = quantity("queen beds?|queen mattresses?", 1);
    if (/dresser/.test(inventory)) nextQty.dresser = quantity("dressers?", 1);
    if (/dining table/.test(inventory)) nextQty["dining-table"] = quantity("dining tables?", 1);
    if (/dining chair/.test(inventory)) nextQty["dining-chair"] = quantity("dining chairs?", 1);
    if (/box|moving box/.test(inventory)) nextQty["medium-box-kd"] = quantity("(?:moving )?boxes?", 20);
  }
  state.qty = Object.keys(nextQty).length ? nextQty : { sofa: 1 };
  state.dimensionOverrides = {};
  state.dimensionGroups = {};
  state.dimensionEditOpen = {};
  state.loadTier = {};
  state.boxLightQty = {};
  state.customItems = [];
  state.manualPlacements = {};
  state.selectedItems = {};
  state.lockedPlacements = {};
  const couchView = params.get("item") === "sofa" && params.get("view") === "couch";
  state.showObjectModels = couchView;
  state.showFormation = false;
  state.activeCategory = "Living Room";
  const objectModelToggle = document.getElementById("object-model-toggle");
  if (objectModelToggle) objectModelToggle.checked = couchView;
  saveState();
}

// ---------------- Init ----------------

applyUrlSelection();
seedDefaultSelection();
renderTabs();
renderItems();
buildCompareCards();
recompute();
