// ---------------------------------------------------------------------------
// Data model: item catalog (dims in inches) and truck cargo specs.
// Dimensions/cargo specs sourced from MoveMate's public truck comparison page;
// item dims approximate the Truck Wizard's household item footprints.
// ---------------------------------------------------------------------------

// zone drives packing order/placement rule (see packing.js):
//  'appliance' -> heaviest, loaded FRONT, single layer
//  'furniture' -> desks/tables/case goods, loaded MIDDLE, single layer
//  'mattress'  -> mattresses/box springs, stood on edge along LEFT side
//  'box'       -> stackable boxes, fill remaining space, grid-stacked

const ITEM_CATALOG = {
  "Living Room": [
    { id: "ac", name: "Air Conditioner", w: 25, d: 17, h: 23, zone: "appliance", color: 0xdc3545 },
    { id: "bar-cart", name: "Bar Cart", w: 32, d: 32, h: 16, zone: "furniture", color: 0x1d4ed8 },
    { id: "small-bookcase", name: "Small Bookcase", w: 32, d: 12, h: 42, zone: "furniture", color: 0x1d4ed8 },
    { id: "tall-bookcase", name: "Tall Bookcase", w: 32, d: 12, h: 80, zone: "furniture", color: 0x1d4ed8 },
    { id: "sofa", name: "Sectional Sofa", w: 84, d: 35, h: 33, zone: "furniture", color: 0x1d4ed8 },
    { id: "tv", name: "65\" TV (boxed)", w: 62, d: 6, h: 38, zone: "furniture", color: 0x1d4ed8 },
    { id: "large-box-lr", name: "Large Box", w: 22, d: 22, h: 22, zone: "box", color: 0xb45309 },
  ],
  "Kitchen & Dining": [
    { id: "fridge", name: "Refrigerator", w: 36, d: 34, h: 70, zone: "appliance", color: 0xdc3545 },
    { id: "stove", name: "Stove / Range", w: 30, d: 28, h: 36, zone: "appliance", color: 0xdc3545 },
    { id: "dining-table", name: "Dining Table", w: 60, d: 36, h: 30, zone: "furniture", color: 0x1d4ed8 },
    { id: "dining-chair", name: "Dining Chair", w: 20, d: 20, h: 36, zone: "furniture", color: 0x1d4ed8 },
    { id: "medium-box-kd", name: "Medium Box", w: 18, d: 18, h: 16, zone: "box", color: 0xb45309 },
  ],
  "Bedroom": [
    { id: "queen-mattress", name: "Queen Mattress", w: 60, d: 80, h: 10, zone: "mattress", color: 0x7c3aed },
    { id: "queen-boxspring", name: "Queen Box Spring", w: 60, d: 80, h: 9, zone: "mattress", color: 0x7c3aed },
    { id: "dresser", name: "Dresser", w: 60, d: 20, h: 32, zone: "furniture", color: 0x1d4ed8 },
    { id: "nightstand", name: "Nightstand", w: 24, d: 16, h: 24, zone: "furniture", color: 0x1d4ed8 },
    { id: "wardrobe-box", name: "Wardrobe Box", w: 24, d: 24, h: 48, zone: "box", color: 0xb45309 },
  ],
  "Office": [
    { id: "desk", name: "Desk", w: 48, d: 24, h: 30, zone: "furniture", color: 0x1d4ed8 },
    { id: "office-chair", name: "Office Chair", w: 26, d: 26, h: 40, zone: "furniture", color: 0x1d4ed8 },
    { id: "file-cabinet", name: "File Cabinet", w: 18, d: 24, h: 28, zone: "furniture", color: 0x1d4ed8 },
    { id: "small-box-office", name: "Small Box", w: 16, d: 16, h: 12, zone: "box", color: 0xb45309 },
  ],
  "Rec Room": [
    { id: "treadmill", name: "Treadmill", w: 32, d: 70, h: 55, zone: "appliance", color: 0xdc3545 },
    { id: "washer", name: "Washer", w: 27, d: 30, h: 42, zone: "appliance", color: 0xdc3545 },
    { id: "dryer", name: "Dryer", w: 27, d: 30, h: 42, zone: "appliance", color: 0xdc3545 },
    { id: "large-box-rr", name: "Large Box", w: 22, d: 22, h: 22, zone: "box", color: 0xb45309 },
  ],
  "Garage & Outside": [
    { id: "lawn-mower", name: "Lawn Mower", w: 24, d: 60, h: 40, zone: "furniture", color: 0x1d4ed8 },
    { id: "bicycle", name: "Bicycle", w: 24, d: 70, h: 40, zone: "furniture", color: 0x1d4ed8 },
    { id: "large-box-garage", name: "Large Box", w: 22, d: 22, h: 22, zone: "box", color: 0xb45309 },
  ],
  "Laundry": [
    { id: "ironing-board", name: "Ironing Board (boxed)", w: 14, d: 54, h: 6, zone: "box", color: 0xb45309 },
    { id: "small-box-laundry", name: "Small Box", w: 16, d: 16, h: 12, zone: "box", color: 0xb45309 },
  ],
};

function catalogItem(id, name, w, d, h, zone, icon, color = 0x1d4ed8) {
  const defaultTier = zone === "box" ? (/large|wardrobe/i.test(name) ? "heavy-box" : "light-box") : zone === "mattress" || /sofa|couch/i.test(name) ? "soft" : zone === "appliance" || /desk|bookcase|table|dresser|cabinet|buffet/i.test(name) ? "heavy" : "light";
  return { id, name, w, d, h, zone, icon, color, defaultTier };
}

// Additional wizard options transcribed from the supplied MoveMate screenshots.
ITEM_CATALOG["Living Room"].push(
  catalogItem("rug-lr", "Rug", 10, 10, 100, "box", "🪡", 0xb45309),
  catalogItem("sewing-machine-lr", "Sewing Machine", 18, 12, 10, "appliance", "🧵", 0xf28c28),
  catalogItem("sofa-3-seat", "3 Seat Sofa", 32, 34, 79, "furniture", "🛋️"),
  catalogItem("sofa-4-seat", "4 Seat Sofa", 31, 34, 98, "furniture", "🛋️"),
  catalogItem("loveseat", "Loveseat", 32, 34, 56, "furniture", "🛋️"),
  catalogItem("chaise", "Chaise Lounge", 36, 36, 60, "furniture", "🛋️"),
  catalogItem("stereo", "Stereo", 12, 12, 15, "appliance", "🔊", 0xf28c28),
  catalogItem("storage-bin-lr", "Storage Bins", 18, 13, 27, "box", "🗃️", 0xb8bec7),
  catalogItem("stroller-lr", "Stroller", 21, 28, 16, "furniture", "👶"),
  catalogItem("toy-box-lr", "Toy Box", 33, 23, 18, "box", "📦", 0x4b5563),
  catalogItem("trash-small-lr", "Small Trash Can", 7, 15, 15, "box", "🗑️", 0xb8bec7),
  catalogItem("tv-32", "32\" TV", 29, 18, 3, "furniture", "📺"),
  catalogItem("tv-48", "48\" TV", 44, 26, 3, "furniture", "📺"),
  catalogItem("tv-75", "75\" TV", 67, 39, 4, "furniture", "📺"),
  catalogItem("vacuum-lr", "Vacuum Cleaner", 16, 43, 14, "furniture", "🧹"),
);
ITEM_CATALOG["Kitchen & Dining"].push(
  catalogItem("bakers-rack", "Baker's Rack", 28, 65, 19, "furniture", "🗄️"),
  catalogItem("bar-stool", "Bar Stool", 17, 34, 17, "furniture", "🪑"),
  catalogItem("bistro-set", "Bistro Table Set", 25, 35, 40, "furniture", "🍽️"),
  catalogItem("kitchen-cabinet", "Kitchen Cabinet", 30, 36, 25, "furniture", "🗄️"),
  catalogItem("utility-cabinet-kd", "Utility Cabinet", 15, 84, 14, "furniture", "🗄️"),
  catalogItem("high-chair", "High Chair", 22, 43, 34, "furniture", "🪑"),
  catalogItem("dishwasher", "Dishwasher", 24, 35, 25, "appliance", "◻️", 0xf28c28),
  catalogItem("kitchen-chair", "Kitchen Chairs", 19, 30, 20, "furniture", "🪑"),
  catalogItem("large-kitchen-table", "Large Kitchen Table", 42, 30, 70, "furniture", "🍽️"),
  catalogItem("small-kitchen-table", "Small Kitchen Table", 36, 30, 48, "furniture", "🍽️"),
  catalogItem("litter-box", "Litter Box", 16, 17, 20, "box", "🐾", 0xb8bec7),
  catalogItem("microwave", "Microwave", 30, 18, 16, "appliance", "▣", 0xf28c28),
  catalogItem("pet-crate-kd", "Pet Crate", 24, 19, 18, "box", "🐾", 0xb8bec7),
  catalogItem("range-36", "36\" Range", 48, 36, 30, "appliance", "🔥", 0xf28c28),
  catalogItem("range-30", "30\" Range", 30, 45, 26, "appliance", "🔥", 0xf28c28),
  catalogItem("range-24", "24\" Range", 24, 40, 26, "appliance", "🔥", 0xf28c28),
  catalogItem("freezer", "Freezer", 55, 32, 30, "appliance", "❄️", 0xf28c28),
  catalogItem("fridge-32-36", "32-36\" Fridge", 35, 70, 35, "appliance", "❄️", 0xf28c28),
  catalogItem("fridge-24-30", "24-30\" Fridge", 30, 67, 30, "appliance", "❄️", 0xf28c28),
  catalogItem("fridge-under-20", "<= 20\" Fridge", 20, 34, 23, "appliance", "❄️", 0xf28c28),
);
ITEM_CATALOG["Bedroom"].push(
  catalogItem("bunk-bed", "Bunk Bed", 43, 48, 80, "furniture", "🛏️"),
  catalogItem("double-bed", "Double Bed", 54, 30, 75, "furniture", "🛏️"),
  catalogItem("twin-bed", "Twin Bed", 38, 30, 75, "furniture", "🛏️"),
  catalogItem("queen-bed", "Queen Bed", 59, 30, 79, "furniture", "🛏️"),
  catalogItem("king-bed", "King Bed", 75, 30, 79, "furniture", "🛏️"),
  catalogItem("bench-bedroom", "Bench", 50, 20, 20, "furniture", "🪑"),
  catalogItem("changing-table", "Changing Table", 46, 38, 20, "furniture", "🗄️"),
  catalogItem("crib", "Crib", 60, 38, 34, "furniture", "🛏️"),
  catalogItem("double-dresser", "Double Dresser", 61, 43, 20, "furniture", "🗄️"),
  catalogItem("single-dresser", "Single Dresser", 45, 38, 20, "furniture", "🗄️"),
  catalogItem("triple-dresser", "Triple Dresser", 72, 43, 20, "furniture", "🗄️"),
  catalogItem("headboard", "Headboard", 75, 60, 4, "furniture", "🛏️"),
  catalogItem("luggage", "Luggage", 21, 32, 13, "box", "🧳", 0xb8bec7),
  catalogItem("vanity", "Vanity", 36, 55, 18, "furniture", "🪞"),
  catalogItem("night-stand-2", "Night Stand", 22, 23, 17, "furniture", "🗄️"),
);
ITEM_CATALOG["Office"].push(
  catalogItem("computer", "Computer", 14, 14, 7, "appliance", "🖥️", 0xf28c28),
  catalogItem("monitor", "Monitor", 20, 17, 7, "appliance", "🖥️", 0xf28c28),
  catalogItem("printer", "Printer", 17, 10, 17, "appliance", "🖨️", 0xf28c28),
  catalogItem("desk-chair", "Desk Chair", 20, 35, 21, "furniture", "🪑"),
  catalogItem("filing-2", "2 Door Filing Cabinet", 29, 30, 20, "furniture", "🗄️"),
  catalogItem("filing-4", "4 Door Filing Cabinet", 21, 55, 25, "furniture", "🗄️"),
);
ITEM_CATALOG["Rec Room"].push(
  catalogItem("kids-playhouse", "Kid's Playhouse", 40, 44, 35, "furniture", "🏠"),
  catalogItem("ping-pong", "Ping-Pong Table", 22, 65, 48, "furniture", "🏓"),
  catalogItem("pool-table", "Pool Table", 56, 31, 100, "furniture", "🎱"),
  catalogItem("weights", "Weights", 30, 40, 20, "appliance", "🏋️", 0xf28c28),
  catalogItem("folding-chair", "Folding Chair", 22, 37, 5, "furniture", "🪑"),
);
ITEM_CATALOG["Garage & Outside"].push(
  catalogItem("fire-pit", "Fire Pit", 34, 34, 34, "appliance", "🔥", 0xf28c28),
  catalogItem("garden-hose", "Garden Hose", 22, 22, 18, "box", "〰️", 0xb8bec7),
  catalogItem("small-grill", "Small Grill", 40, 33, 20, "appliance", "🔥", 0xf28c28),
  catalogItem("large-grill", "Large Grill", 50, 45, 24, "appliance", "🔥", 0xf28c28),
  catalogItem("kayak", "Kayak/Canoe", 30, 19, 156, "furniture", "🛶"),
  catalogItem("ladder-10", "10' Ladder", 30, 120, 10, "furniture", "🪜"),
  catalogItem("ladder-5", "5' Ladder", 20, 60, 10, "furniture", "🪜"),
  catalogItem("leaf-blower", "Leaf Blower", 37, 15, 10, "appliance", "🍃", 0xf28c28),
  catalogItem("push-mower", "Push Mower", 50, 21, 50, "furniture", "🛠️"),
  catalogItem("riding-mower", "Riding Mower", 52, 43, 65, "furniture", "🛠️"),
  catalogItem("outdoor-chair", "Outdoor Chair", 28, 32, 30, "furniture", "🪑"),
  catalogItem("outdoor-table", "Outdoor Coffee Table", 20, 21, 50, "furniture", "🍽️"),
  catalogItem("outdoor-loveseat", "Outdoor Loveseat", 55, 32, 29, "furniture", "🛋️"),
  catalogItem("patio-chairs", "Patio Chairs", 23, 35, 23, "furniture", "🪑"),
  catalogItem("outdoor-sectional", "Outdoor Sectional", 95, 32, 35, "furniture", "🛋️"),
  catalogItem("outdoor-sofa", "Outdoor Sofa", 90, 32, 30, "furniture", "🛋️"),
  catalogItem("patio-storage", "Patio Storage", 57, 25, 27, "furniture", "🗄️"),
  catalogItem("patio-table", "Large Patio Table", 38, 29, 64, "furniture", "🍽️"),
  catalogItem("patio-small-table", "Small Patio Table", 35, 29, 35, "furniture", "🍽️"),
  catalogItem("umbrella", "Patio Table Umbrella", 10, 100, 10, "furniture", "⛱️"),
  catalogItem("picnic-table", "Picnic Table and Bench", 35, 27, 72, "furniture", "🍽️"),
  catalogItem("snowblower", "Snowblower", 24, 33, 45, "appliance", "❄️", 0xf28c28),
  catalogItem("swing-set", "Swing Set", 92, 25, 22, "furniture", "🎠"),
  catalogItem("table-saw", "Table Saw", 20, 30, 30, "appliance", "🛠️", 0xf28c28),
  catalogItem("wheelbarrow", "Wheelbarrow", 27, 23, 53, "furniture", "🛠️"),
);
ITEM_CATALOG["Laundry"].push(
  catalogItem("bathroom-cabinet", "Bathroom Cabinet", 21, 68, 13, "furniture", "🗄️"),
  catalogItem("hamper", "Hamper", 20, 24, 15, "box", "🧺", 0xb8bec7),
  catalogItem("ironing-board-2", "Ironing Board", 14, 15, 54, "box", "▱", 0xb8bec7),
  catalogItem("washer-2", "Washing Machine", 30, 41, 34, "appliance", "◻️", 0xf28c28),
  catalogItem("dryer-2", "Dryer", 30, 41, 34, "appliance", "◻️", 0xf28c28),
);

// Interior cargo dims (feet) + specs, from movematetruckrental.com/trucks-and-vans/
const TRUCKS = [
  { id: "van", label: "Cargo Van", rooms: "Up to 1 room", L: 11 + 11 / 12, W: 4.5, H: 6.75, cuft: 404, weightCap: 3500, mpg: 12, mpgMax: 12, fuel: "regular", ramp: false },
  { id: "t12", label: "12' Truck", rooms: "1-2 rooms", L: 12, W: 6.5, H: 6 + 1 / 12, cuft: 450, weightCap: 3100, mpg: 8, mpgMax: 12, fuel: "regular", ramp: false },
  { id: "t16", label: "16' Truck", rooms: "2-3 rooms", L: 16, W: 7 + 7 / 12, H: 6.5, cuft: 800, weightCap: 4300, mpg: 8, mpgMax: 12, fuel: "regular", ramp: true },
  { id: "t22", label: "22' Truck", rooms: "3-5 rooms", L: 21 + 11 / 12, W: 8 + 1 / 12, H: 8 + 1 / 12, cuft: 1200, weightCap: 10000, mpg: 13, mpgMax: 13, fuel: "diesel", ramp: true },
  { id: "t26", label: "26' Truck", rooms: "5-7 rooms", L: 25 + 11 / 12, W: 8 + 1 / 12, H: 8 + 1 / 12, cuft: 1700, weightCap: 10000, mpg: 13, mpgMax: 13, fuel: "diesel", ramp: true },
];

// Fuel Savings Estimator defaults (movematetruckrental.com/plan-your-move/drive/fuel-savings-estimator/)
const FUEL_PRICES = { diesel: 5.57, regular: 3.97 };

const ZONE_COLORS = {
  appliance: 0xdc3545,
  furniture: 0x1d4ed8,
  mattress: 0x7c3aed,
  box: 0xb45309,
};
