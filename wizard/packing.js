// ---------------------------------------------------------------------------
// Packing engine: places items inside a truck's cargo box following the
// "I formation" loading rules from MoveMate's Load a Moving Truck guide:
//   - Heavy appliances load FIRST (front of truck)
//   - Desks / heavy furniture load NEXT (boxes can go underneath)
//   - Mattresses / box springs stand on edge, hugging the left wall
//   - Boxes fill remaining space, stacked to the ceiling
// Coordinates: x = width (0..truckW), y = height (0..truckH), z = depth/length
// (0 = front/cab wall .. truckL = rear door). All units in feet.
//
// Simplification note: the loading guide shows mattresses as a dedicated
// column running the full left side of the truck. In practice that only
// works in wider trucks -- reserving a fixed-width column in a narrow truck
// starves the furniture zone of usable width and produces "false" overflow.
// Instead, each zone (appliances -> furniture -> mattresses -> boxes) is
// packed across the FULL truck width, one after another along the length.
// Mattress/furniture placements still hug the left wall first, which keeps
// the same "along the side" visual read in the 3D view.
//
// This is a heuristic shelf-packer, not an optimal 3D bin-packing solver --
// it's built to produce a visually representative, "good enough" load plan.
// ---------------------------------------------------------------------------

function inchesToFeet(v) {
  return v / 12;
}

// Expand {item, qty} rows into individual unit instances.
function expandUnits(selection) {
  const units = [];
  let uid = 0;
  for (const row of selection) {
    for (let i = 0; i < row.qty; i++) {
      const isLightTier = (row.zone === "box" || row.zone === "furniture") && i >= row.qty - (row.lightQty || 0);
      const dimensions = row.instances?.[i] || row;
      const heavyTier = row.zone === "box" ? "heavy-box" : row.zone === "furniture" ? "heavy" : row.loadTier || row.defaultTier || formationTier(row);
      units.push({
        uid: `${row.id}-${i}`,
        name: row.name,
        zone: row.zone,
        color: row.color,
        w: inchesToFeet(dimensions.w),
        d: inchesToFeet(dimensions.d),
        h: inchesToFeet(dimensions.h),
        baseW: inchesToFeet(dimensions.w),
        baseD: inchesToFeet(dimensions.d),
        baseH: inchesToFeet(dimensions.h),
        tier: isLightTier ? (row.zone === "box" ? "light-box" : "light") : heavyTier,
      });
    }
  }
  return units;
}

function formationTier(item) {
  const name = item.name.toLowerCase();
  if (item.zone === "mattress" || /sofa|couch/.test(name)) return "soft";
  if (item.zone === "box") return /large|wardrobe|heavy/.test(name) ? "heavy-box" : "light-box";
  if (/desk|bookcase/.test(name)) return "heavy";
  return "heavy";
}

function loadingPriority(item) {
  if (item.zone === "appliance") return 0;
  if (item.tier === "heavy") return 0;
  if (item.zone === "mattress" || item.tier === "soft") return 1;
  if (item.tier === "light") return 2;
  if (item.tier === "heavy-box") return 3;
  if (item.tier === "light-box") return 4;
  return 2;
}

// Shelf packer for non-stackable single-layer items (appliances/furniture/mattresses).
// Packs across the full truck width, advances along z; tries rotating an item
// 90 degrees (swap w/d) if it doesn't fit the current orientation's width.
function shelfPackSingleLayer(items, truckWidth, truckHeight, zStart, truckLength) {
  const placements = [];
  const overflow = [];
  let cursorX = 0;
  let cursorZ = zStart;
  let shelfDepth = 0;

  for (let item of items) {
    // Lay tall case goods on their side when the depth becomes a valid height.
    if (item.h > truckHeight + 1e-6 && item.d <= truckHeight + 1e-6) {
      item = { ...item, d: item.h, h: item.d, rotated: true };
    }
    if (item.h > truckHeight + 1e-6) {
      overflow.push(item);
      continue;
    }
    // Rotate (swap footprint) if it doesn't fit as-is but would fit rotated.
    if (item.w > truckWidth + 1e-6 && item.d <= truckWidth + 1e-6) {
      item = { ...item, w: item.d, d: item.w, rotated: true };
    }
    if (item.w > truckWidth + 1e-6) {
      overflow.push(item); // doesn't fit in either orientation
      continue;
    }
    if (cursorX + item.w > truckWidth + 1e-6) {
      // new row/shelf
      cursorZ += shelfDepth;
      cursorX = 0;
      shelfDepth = 0;
    }
    if (cursorZ + item.d > truckLength + 1e-6) {
      overflow.push(item);
      continue;
    }
    placements.push({ ...item, x: cursorX, y: 0, z: cursorZ });
    cursorX += item.w;
    shelfDepth = Math.max(shelfDepth, item.d);
  }
  const zUsed = cursorZ + shelfDepth;
  return { placements, overflow, zUsed: Math.min(zUsed, truckLength) };
}

// Grid-stack boxes (grouped by footprint) into the remaining volume: fills
// width x height x depth grid floor-to-ceiling, then advances rows along z.
function stackBoxes(boxes, truckWidth, truckHeight, zStart, truckLength) {
  const placements = [];
  const overflow = [];
  let cursorZ = zStart;

  const groups = new Map();
  for (const b of boxes) {
    const key = `${b.w.toFixed(2)}x${b.d.toFixed(2)}x${b.h.toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }

  for (const group of groups.values()) {
    const sample = group[0];
    if (sample.w > truckWidth + 1e-6 || sample.h > truckHeight + 1e-6) {
      overflow.push(...group);
      continue;
    }
    const perRow = Math.max(1, Math.floor(truckWidth / sample.w));
    const layers = Math.max(1, Math.floor(truckHeight / sample.h));
    const rowsAvailable = Math.max(0, Math.floor((truckLength - cursorZ) / sample.d));
    const capacity = perRow * layers * rowsAvailable;

    const placeCount = Math.min(group.length, capacity);
    let placed = 0;
    outer: for (let row = 0; row < rowsAvailable; row++) {
      for (let layer = 0; layer < layers; layer++) {
        for (let col = 0; col < perRow; col++) {
          if (placed >= placeCount) break outer;
          const item = group[placed];
          placements.push({
            ...item,
            x: col * sample.w,
            y: layer * sample.h,
            z: cursorZ + row * sample.d,
          });
          placed++;
        }
      }
    }
    for (let i = placed; i < group.length; i++) overflow.push(group[i]);
    if (rowsAvailable > 0 && placed > 0) {
      const rowsUsed = Math.ceil(placed / (perRow * layers));
      cursorZ += rowsUsed * sample.d;
    }
  }
  return { placements, overflow, zUsed: Math.min(cursorZ, truckLength) };
}

// Stand mattresses on edge when the truck has enough height; otherwise lay
// them flat so a shorter truck can still carry them safely.
function orientMattress(m, truckWidth, truckHeight) {
  const standing = { ...m, w: m.h, h: m.d, d: m.w, rotated: true };
  if (standing.w <= truckWidth + 1e-6 && standing.h <= truckHeight + 1e-6) {
    return standing;
  }
  return { ...m, rotated: false };
}

function orientations(item) {
  if (item.zone === "mattress") {
    const flat = { ...item, w: item.baseW, d: item.baseD, h: item.baseH, rotated: false };
    const standingOnWidth = { ...item, w: item.baseH, d: item.baseD, h: item.baseW, rotated: true };
    const standingOnLength = { ...item, w: item.baseH, d: item.baseW, h: item.baseD, rotated: true };
    return [flat, standingOnWidth, standingOnLength].filter((candidate, index, candidates) => candidates.findIndex((other) =>
      other.w === candidate.w && other.d === candidate.d && other.h === candidate.h) === index);
  }
  const candidates = [
    { ...item },
    { ...item, w: item.w, d: item.h, h: item.d, rotated: true },
    { ...item, w: item.d, d: item.w, rotated: true },
    { ...item, w: item.d, d: item.h, h: item.w, rotated: true },
    { ...item, w: item.h, d: item.w, h: item.d, rotated: true },
    { ...item, w: item.h, d: item.d, h: item.w, rotated: true },
  ];
  return candidates.filter((candidate, index) => candidates.findIndex((other) =>
    other.w === candidate.w && other.d === candidate.d && other.h === candidate.h) === index);
}

function overlaps(a, b) {
  return a.x < b.x + b.w - 1e-6 && a.x + a.w > b.x + 1e-6 &&
    a.y < b.y + b.h - 1e-6 && a.y + a.h > b.y + 1e-6 &&
    a.z < b.z + b.d - 1e-6 && a.z + a.d > b.z + 1e-6;
}

function isSupported(candidate, placements) {
  if (candidate.y <= 1e-6) return true;
  const supportedArea = placements.reduce((area, placement) => {
    if (Math.abs(placement.y + placement.h - candidate.y) > 1e-6) return area;
    const width = Math.max(0, Math.min(candidate.x + candidate.w, placement.x + placement.w) - Math.max(candidate.x, placement.x));
    const depth = Math.max(0, Math.min(candidate.z + candidate.d, placement.z + placement.d) - Math.max(candidate.z, placement.z));
    return area + width * depth;
  }, 0);
  return supportedArea >= candidate.w * candidate.d * 0.65;
}

function canStackItem(item, candidate, placements, ignoreWeightConstraints = false) {
  if (candidate.y <= 1e-6) return true;
  if (ignoreWeightConstraints) return true;
  if (item.tier === "heavy") return false;
  return placements.some((placement) => {
    if (Math.abs(placement.y + placement.h - candidate.y) > 1e-6) return false;
    const width = Math.max(0, Math.min(candidate.x + candidate.w, placement.x + placement.w) - Math.max(candidate.x, placement.x));
    const depth = Math.max(0, Math.min(candidate.z + candidate.d, placement.z + placement.d) - Math.max(candidate.z, placement.z));
    return width * depth >= candidate.w * candidate.d * 0.65;
  });
}

function formationBounds(item, truck) {
  if (item.zone === "mattress") return { minX: 0, maxX: truck.W * 0.3, minZ: 0, maxZ: truck.L * 0.65 };
  if (item.tier === "soft") return { minX: truck.W * 0.5, maxX: truck.W, minZ: truck.L * 0.18, maxZ: truck.L * 0.72 };
  if (item.zone === "appliance") return { minX: 0, maxX: truck.W, minZ: 0, maxZ: truck.L * 0.3 };
  if (item.tier === "heavy-box") return { minX: truck.W * 0.25, maxX: truck.W * 0.75, minZ: truck.L * 0.3, maxZ: truck.L * 0.72 };
  if (item.tier === "light-box") return { minX: truck.W * 0.15, maxX: truck.W * 0.85, minZ: truck.L * 0.55, maxZ: truck.L * 0.9 };
  return { minX: 0, maxX: truck.W, minZ: 0, maxZ: truck.L };
}

function formationDistance(item, shape, x, z, truck) {
  const bounds = formationBounds(item, truck);
  const xDistance = item.zone === "mattress"
    ? x
    : item.tier === "soft"
      ? Math.abs((bounds.maxX - shape.w) - x)
      : Math.abs((bounds.minX + bounds.maxX - shape.w) / 2 - x);
  const zDistance = item.zone === "appliance" || item.tier === "heavy" || item.tier === "heavy-box" || item.tier === "light-box"
    ? z
    : item.zone === "mattress"
      ? Math.abs(bounds.minZ - z)
      : Math.abs(bounds.minZ - z);
  const lowProfileBonus = item.zone === "furniture" && /bookcase|cabinet|dresser/i.test(item.name) && shape.h < item.h
    ? -Math.min(2, item.h - shape.h)
    : 0;
  const standingMattressBonus = item.zone === "mattress" && shape.h > item.h ? -4 : 0;
  return xDistance + zDistance + lowProfileBonus + standingMattressBonus;
}

function placeInFreeSpace(item, placements, truck, zone, formationOnly = false, formationWeight = 8, allowStack = false, ignoreWeightConstraints = false) {
  const xEdges = new Set([0]);
  const yEdges = new Set([0]);
  const zEdges = new Set([0]);
  for (const placement of placements) {
    xEdges.add(placement.x + placement.w);
    yEdges.add(placement.y + placement.h);
    zEdges.add(placement.z + placement.d);
  }
  const targetZ = zone === "appliance" ? 0 : zone === "furniture" ? truck.L * 0.2 : zone === "mattress" ? truck.L * 0.1 : truck.L * 0.45;
  const preferredBounds = formationBounds(item, truck);
  const bounds = formationOnly ? preferredBounds : {
    minX: 0,
    maxX: truck.W,
    minZ: 0,
    maxZ: truck.L,
  };
  xEdges.add(bounds.minX);
  zEdges.add(bounds.minZ);
  const candidates = [];
  for (const shape of orientations(item)) {
    if (shape.w > truck.W + 1e-6 || shape.d > truck.L + 1e-6 || shape.h > truck.H + 1e-6) continue;
    xEdges.add(Math.max(bounds.minX, bounds.maxX - shape.w));
    zEdges.add(Math.max(bounds.minZ, bounds.maxZ - shape.d));
    for (const x of xEdges) for (const y of yEdges) for (const z of zEdges) {
      if (x + shape.w > truck.W + 1e-6 || y + shape.h > truck.H + 1e-6 || z + shape.d > truck.L + 1e-6) continue;
      if (x < bounds.minX - 1e-6 || x + shape.w > bounds.maxX + 1e-6 || z < bounds.minZ - 1e-6 || z + shape.d > bounds.maxZ + 1e-6) continue;
      const candidate = { ...shape, x, y, z };
      const isSoft = item.tier === "soft";
      const isLightBox = item.tier === "light-box";
      const isHeavyBox = item.tier === "heavy-box";
      if (canStackItem(item, candidate, placements, ignoreWeightConstraints) && (allowStack || ignoreWeightConstraints || candidate.y <= 1e-6 || zone === "box" || zone === "mattress") && isSupported(candidate, placements) && !placements.some((placement) => overlaps(candidate, placement))) {
        const outsidePreferred = candidate.x < preferredBounds.minX || candidate.x + shape.w > preferredBounds.maxX || candidate.z < preferredBounds.minZ || candidate.z + shape.d > preferredBounds.maxZ;
        candidates.push({ candidate, score: (outsidePreferred ? formationWeight : 0) + formationWeight * formationDistance(item, shape, x, z, truck) + Math.abs(z - targetZ) + y * (zone === "box" ? -0.15 : 0.1) });
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  if (candidates.length > 0) return candidates[0].candidate;
  if (formationOnly) return placeInFreeSpace(item, placements, truck, zone, false);
  return null;
}

// Pack one truck-load ("one trip") from a pool of unit items.
// Returns placements that fit + leftover items that didn't fit (for next trip).
function packOneTrip(units, truck, orderMode = "formation", ignoreWeightConstraints = false, fixedPlacements = []) {
  const fixedIds = new Set(fixedPlacements.map((placement) => placement.uid));
  const placements = fixedPlacements.map((placement) => ({ ...placement, manual: true }));
  const overflow = [];
  const ordered = units.filter((item) => !fixedIds.has(item.uid)).sort((a, b) => {
    if (orderMode === "volume") return (b.w * b.d * b.h) - (a.w * a.d * a.h);
    if (orderMode === "footprint") return (b.w * b.d) - (a.w * a.d);
    if (orderMode === "depth") return b.d - a.d;
    if (orderMode === "boxes-last") return loadingPriority(a) - loadingPriority(b);
    return loadingPriority(a) - loadingPriority(b) || (b.w * b.d * b.h) - (a.w * a.d * a.h);
  });
  if (orderMode === "formation") {
    ordered.sort((a, b) => (a.zone === "mattress" ? 0 : 1) - (b.zone === "mattress" ? 0 : 1) || loadingPriority(a) - loadingPriority(b));
  }
  for (const sourceItem of ordered) {
    const item = sourceItem;
    const efficientPlacement = orderMode !== "formation";
    const placement = placeInFreeSpace(item, placements, truck, sourceItem.zone, false, orderMode === "formation" ? 8 : 0, efficientPlacement, ignoreWeightConstraints);
    if (placement) placements.push(placement);
    else overflow.push(sourceItem);
  }
  const lengthUsed = placements.reduce((max, placement) => Math.max(max, placement.z + placement.d), 0);
  return { placements, overflow, lengthUsed };
}

function buildPlan(units, truck, mode, ignoreWeightConstraints = false, fixedPlacements = []) {
  const trips = [];
  let remaining = units;
  const MAX_TRIPS = 12;
  while (remaining.length > 0 && trips.length < MAX_TRIPS) {
    const result = packOneTrip(remaining, truck, mode, ignoreWeightConstraints, trips.length === 0 ? fixedPlacements : []);
    if (result.placements.length === 0) {
      // Keep unplaceable items in the warning state without inventing an empty trip.
      remaining = result.overflow.length ? result.overflow : remaining;
      break;
    }
    trips.push(result);
    remaining = result.overflow;
  }
  return { trips, remaining };
}

// Full multi-trip packer: repeats packOneTrip on leftovers until everything is placed
// (or a safety cap of trips is hit, in which case remaining items are flagged impossible).
function packTruck(selection, truck, strategy = "formation", ignoreWeightConstraints = false, fixedPlacements = []) {
  const allUnits = expandUnits(selection);
  const totalVolumeCuFt = allUnits.reduce((sum, u) => sum + u.w * u.d * u.h, 0);

  const modes = strategy === "efficient"
    ? ["volume", "footprint", "depth", "boxes-last"]
    : ["formation"];
  const plans = modes.map((mode) => buildPlan(allUnits, truck, mode, ignoreWeightConstraints, fixedPlacements));
  plans.sort((a, b) => {
    const impossibleA = a.remaining.length > 0 ? 1 : 0;
    const impossibleB = b.remaining.length > 0 ? 1 : 0;
    if (impossibleA !== impossibleB) return impossibleA - impossibleB;
    if (a.trips.length !== b.trips.length) return a.trips.length - b.trips.length;
    const smallestA = Math.min(...a.trips.map((trip) => trip.placements.reduce((sum, item) => sum + item.w * item.d * item.h, 0)));
    const smallestB = Math.min(...b.trips.map((trip) => trip.placements.reduce((sum, item) => sum + item.w * item.d * item.h, 0)));
    return smallestB - smallestA;
  });
  const bestPlan = plans[0];
  const trips = bestPlan.trips;
  const impossibleItems = bestPlan.remaining.length > 0 ? bestPlan.remaining : [];

  return {
    trips,
    tripCount: trips.length,
    totalVolumeCuFt,
    truckCapacityCuFt: truck.cuft,
    volumeUtilization: Math.min(1, totalVolumeCuFt / (truck.cuft * trips.length || truck.cuft)),
    impossibleItems,
  };
}
