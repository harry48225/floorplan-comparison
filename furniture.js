// Standard furniture footprints for the "what fits" overlay. Sizes are in metres
// (width W across × depth/length D), measured top-down. Loaded before app.js;
// exposes window.Furniture = { CATALOG, ICONS }.
//
// Beds are UK National Bed Federation standard mattress sizes plus a standard
// bedframe allowance (~15 cm wider, ~20 cm longer than the mattress). Storage and
// kitchen/utility appliances use the standard 600 mm cabinet depth. Seating,
// tables, desks, the TV stand and bike are typical real-world sizes — actual
// products vary, so these are sensible middle-of-the-road figures.
window.Furniture = (() => {
  "use strict";

  // Each icon is a top-down schematic authored in a unit box (x and y run 0→1).
  // app.js affine-maps it onto the placed piece, so it scales and rotates with
  // the furniture. The "front"/head of a piece points to -y (up). Shapes are
  // stroked (fill:none) with a non-scaling stroke — see styles.css .furn-icon.
  // Icons draw only the piece itself — no chairs/stools (they're separate
  // catalogue items) — so the drawn shape fills the item's real footprint.
  const ICONS = {
    bed:
      '<rect x=".05" y=".04" width=".9" height=".92" rx=".05"/>' +
      '<rect x=".12" y=".09" width=".33" height=".18" rx=".03"/>' +
      '<rect x=".55" y=".09" width=".33" height=".18" rx=".03"/>' +
      '<line x1=".05" y1=".34" x2=".95" y2=".34"/>',
    sofa:
      '<rect x=".05" y=".05" width=".9" height=".9" rx=".08"/>' +
      '<line x1=".05" y1=".3" x2=".95" y2=".3"/>' +
      '<line x1=".22" y1=".3" x2=".22" y2=".95"/>' +
      '<line x1=".78" y1=".3" x2=".78" y2=".95"/>' +
      '<line x1=".5" y1=".3" x2=".5" y2=".9"/>',
    sofaCorner: '<path d="M.05 .95 L.05 .05 L.55 .05 L.55 .55 L.95 .55 L.95 .95 Z"/>',
    armchair:
      '<rect x=".08" y=".08" width=".84" height=".84" rx=".1"/>' +
      '<line x1=".08" y1=".32" x2=".92" y2=".32"/>' +
      '<line x1=".28" y1=".32" x2=".28" y2=".92"/>' +
      '<line x1=".72" y1=".32" x2=".72" y2=".92"/>',
    table: '<rect x=".05" y=".05" width=".9" height=".9" rx=".03"/>',
    coffee: '<rect x=".12" y=".2" width=".76" height=".6" rx=".05"/>',
    desk:
      '<rect x=".05" y=".05" width=".9" height=".9" rx=".02"/>' +
      '<rect x=".38" y=".12" width=".24" height=".14" rx=".01"/>',
    deskCorner:
      '<path d="M.05 .05 L.95 .05 L.95 .5 L.5 .5 L.5 .95 L.05 .95 Z"/>' +
      '<rect x=".14" y=".12" width=".22" height=".1" rx=".01"/>',
    wardrobe:
      '<rect x=".05" y=".05" width=".9" height=".9" rx=".02"/>' +
      '<line x1=".5" y1=".05" x2=".5" y2=".95"/>' +
      '<line x1=".43" y1=".42" x2=".43" y2=".58"/>' +
      '<line x1=".57" y1=".42" x2=".57" y2=".58"/>',
    chest:
      '<rect x=".05" y=".08" width=".9" height=".84" rx=".02"/>' +
      '<line x1=".05" y1=".36" x2=".95" y2=".36"/>' +
      '<line x1=".05" y1=".64" x2=".95" y2=".64"/>' +
      '<circle cx=".5" cy=".22" r=".03"/>' +
      '<circle cx=".5" cy=".5" r=".03"/>' +
      '<circle cx=".5" cy=".78" r=".03"/>',
    bedside:
      '<rect x=".1" y=".1" width=".8" height=".8" rx=".03"/>' +
      '<line x1=".1" y1=".45" x2=".9" y2=".45"/>' +
      '<circle cx=".5" cy=".68" r=".05"/>',
    fridge:
      '<rect x=".08" y=".05" width=".84" height=".9" rx=".03"/>' +
      '<line x1=".08" y1=".5" x2=".92" y2=".5"/>' +
      '<line x1=".8" y1=".14" x2=".8" y2=".42"/>' +
      '<line x1=".8" y1=".58" x2=".8" y2=".86"/>',
    washer:
      '<rect x=".06" y=".06" width=".88" height=".88" rx=".04"/>' +
      '<circle cx=".5" cy=".5" r=".33"/>' +
      '<circle cx=".5" cy=".5" r=".15"/>',
    dishwasher:
      '<rect x=".08" y=".05" width=".84" height=".9" rx=".03"/>' +
      '<line x1=".08" y1=".2" x2=".92" y2=".2"/>' +
      '<line x1=".3" y1=".32" x2=".3" y2=".85"/>' +
      '<line x1=".5" y1=".32" x2=".5" y2=".85"/>' +
      '<line x1=".7" y1=".32" x2=".7" y2=".85"/>',
    tv:
      '<rect x=".05" y=".4" width=".9" height=".5" rx=".03"/>' +
      '<rect x=".13" y=".12" width=".74" height=".12" rx=".02"/>' +
      '<line x1=".5" y1=".24" x2=".5" y2=".4"/>',
    bike:
      '<circle cx=".5" cy=".16" r=".13"/>' +
      '<circle cx=".5" cy=".84" r=".13"/>' +
      '<line x1=".5" y1=".29" x2=".5" y2=".71"/>' +
      '<line x1=".3" y1=".1" x2=".7" y2=".1"/>' +
      '<line x1=".4" y1=".5" x2=".6" y2=".5"/>',
    bikeVertical:
      '<ellipse cx=".5" cy=".3" rx=".05" ry=".28"/>' +
      '<line x1=".28" y1=".3" x2=".72" y2=".3"/>' +
      '<line x1=".5" y1=".58" x2=".5" y2=".88"/>' +
      '<line x1=".12" y1=".88" x2=".88" y2=".88"/>',
    tableRound: '<circle cx=".5" cy=".5" r=".45"/>',
    console:
      '<rect x=".05" y=".25" width=".9" height=".3" rx=".02"/>' +
      '<line x1=".07" y1=".55" x2=".07" y2=".85"/>' +
      '<line x1=".93" y1=".55" x2=".93" y2=".85"/>' +
      '<line x1=".07" y1=".85" x2=".93" y2=".85"/>',
    chair:
      '<rect x=".18" y=".2" width=".64" height=".64" rx=".05"/>' +
      '<rect x=".14" y=".07" width=".72" height=".13" rx=".03"/>',
    stool:
      '<rect x=".12" y=".12" width=".76" height=".76" rx=".14"/>' +
      '<line x1=".28" y1=".28" x2=".72" y2=".72"/>' +
      '<line x1=".72" y1=".28" x2=".28" y2=".72"/>',
    barstool:
      '<circle cx=".5" cy=".5" r=".32"/>' +
      '<circle cx=".5" cy=".5" r=".06"/>',
    lamp:
      '<circle cx=".5" cy=".5" r=".2"/>' +
      '<line x1=".5" y1=".5" x2=".5" y2=".1"/>' +
      '<line x1=".5" y1=".5" x2=".14" y2=".86"/>' +
      '<line x1=".5" y1=".5" x2=".86" y2=".86"/>',
    cot:
      '<rect x=".08" y=".05" width=".84" height=".9" rx=".04"/>' +
      '<line x1=".22" y1=".05" x2=".22" y2=".95"/>' +
      '<line x1=".36" y1=".05" x2=".36" y2=".95"/>' +
      '<line x1=".5" y1=".05" x2=".5" y2=".95"/>' +
      '<line x1=".64" y1=".05" x2=".64" y2=".95"/>' +
      '<line x1=".78" y1=".05" x2=".78" y2=".95"/>',
    dressingTable:
      '<rect x=".05" y=".05" width=".9" height=".9" rx=".02"/>' +
      '<line x1=".5" y1=".05" x2=".5" y2=".95"/>' +
      '<circle cx=".35" cy=".5" r=".03"/>' +
      '<circle cx=".65" cy=".5" r=".03"/>',
    piano:
      '<rect x=".05" y=".1" width=".9" height=".55" rx=".02"/>' +
      '<rect x=".1" y=".65" width=".8" height=".18" rx=".02"/>' +
      '<line x1=".24" y1=".65" x2=".24" y2=".83"/>' +
      '<line x1=".38" y1=".65" x2=".38" y2=".83"/>' +
      '<line x1=".52" y1=".65" x2=".52" y2=".83"/>' +
      '<line x1=".66" y1=".65" x2=".66" y2=".83"/>' +
      '<line x1=".8" y1=".65" x2=".8" y2=".83"/>',
    bookcase:
      '<rect x=".05" y=".1" width=".9" height=".8" rx=".02"/>' +
      '<line x1=".18" y1=".1" x2=".18" y2=".9"/>' +
      '<line x1=".31" y1=".1" x2=".31" y2=".9"/>' +
      '<line x1=".44" y1=".1" x2=".44" y2=".9"/>' +
      '<line x1=".57" y1=".1" x2=".57" y2=".9"/>' +
      '<line x1=".7" y1=".1" x2=".7" y2=".9"/>' +
      '<line x1=".83" y1=".1" x2=".83" y2=".9"/>',
    wardrobeSingle:
      '<rect x=".05" y=".05" width=".9" height=".9" rx=".02"/>' +
      '<line x1=".8" y1=".42" x2=".8" y2=".58"/>',
    wardrobeTriple:
      '<rect x=".05" y=".05" width=".9" height=".9" rx=".02"/>' +
      '<line x1=".3833" y1=".05" x2=".3833" y2=".95"/>' +
      '<line x1=".6167" y1=".05" x2=".6167" y2=".95"/>' +
      '<line x1=".19" y1=".42" x2=".19" y2=".58"/>' +
      '<line x1=".5" y1=".42" x2=".5" y2=".58"/>' +
      '<line x1=".81" y1=".42" x2=".81" y2=".58"/>',
  };

  const CATALOG = [
    {
      category: "Beds",
      items: [
        { id: "bed-single", name: "Single bed", w: 1.05, h: 2.1, icon: "bed" },
        { id: "bed-small-double", name: "Small double bed", w: 1.35, h: 2.1, icon: "bed" },
        { id: "bed-double", name: "Double bed", w: 1.5, h: 2.1, icon: "bed" },
        { id: "bed-king", name: "King bed", w: 1.65, h: 2.2, icon: "bed" },
        { id: "bed-super-king", name: "Super king bed", w: 1.95, h: 2.2, icon: "bed" },
        { id: "cot", name: "Cot", w: 0.65, h: 1.25, icon: "cot" },
      ],
    },
    {
      category: "Seating",
      items: [
        { id: "armchair", name: "Armchair", w: 0.9, h: 0.9, icon: "armchair" },
        { id: "sofa-2", name: "2-seat sofa", w: 1.6, h: 0.9, icon: "sofa" },
        { id: "sofa-3", name: "3-seat sofa", w: 2.1, h: 0.95, icon: "sofa" },
        { id: "sofa-corner", name: "Corner sofa", w: 2.4, h: 2.0, icon: "sofaCorner" },
        { id: "chair-dining", name: "Dining chair", w: 0.45, h: 0.5, icon: "chair" },
        { id: "ottoman", name: "Footstool / ottoman", w: 0.6, h: 0.6, icon: "stool" },
        { id: "bar-stool", name: "Bar stool", w: 0.4, h: 0.4, icon: "barstool" },
      ],
    },
    {
      category: "Tables",
      items: [
        { id: "dining-4", name: "Dining table (4)", w: 1.2, h: 0.8, icon: "table" },
        { id: "dining-6", name: "Dining table (6)", w: 1.6, h: 0.9, icon: "table" },
        { id: "dining-round-4", name: "Round dining table (4)", w: 1.0, h: 1.0, icon: "tableRound" },
        { id: "dining-round-6", name: "Round dining table (6)", w: 1.3, h: 1.3, icon: "tableRound" },
        { id: "coffee", name: "Coffee table", w: 1.1, h: 0.6, icon: "coffee" },
        { id: "console", name: "Console / hall table", w: 0.9, h: 0.35, icon: "console" },
      ],
    },
    {
      category: "Desks",
      items: [
        { id: "desk-compact", name: "Desk (compact)", w: 1.0, h: 0.5, icon: "desk" },
        { id: "desk-large", name: "Desk (large)", w: 1.4, h: 0.7, icon: "desk" },
        { id: "desk-corner", name: "Corner desk", w: 1.4, h: 1.4, icon: "deskCorner" },
      ],
    },
    {
      category: "Storage",
      items: [
        { id: "wardrobe-single", name: "Single wardrobe", w: 0.5, h: 0.6, icon: "wardrobeSingle" },
        { id: "wardrobe", name: "Wardrobe", w: 1.0, h: 0.6, icon: "wardrobe" },
        { id: "wardrobe-triple", name: "Triple wardrobe", w: 1.5, h: 0.6, icon: "wardrobeTriple" },
        { id: "chest", name: "Chest of drawers", w: 0.8, h: 0.45, icon: "chest" },
        { id: "bedside", name: "Bedside table", w: 0.45, h: 0.4, icon: "bedside" },
        { id: "dressing-table", name: "Dressing table", w: 1.0, h: 0.45, icon: "dressingTable" },
        { id: "bookcase-small", name: "Bookcase (small)", w: 0.8, h: 0.3, icon: "bookcase" },
        { id: "bookcase-large", name: "Bookcase (large)", w: 1.2, h: 0.3, icon: "bookcase" },
      ],
    },
    {
      category: "Appliances",
      items: [
        { id: "fridge", name: "Fridge-freezer", w: 0.6, h: 0.6, icon: "fridge" },
        { id: "washer", name: "Washing machine", w: 0.6, h: 0.6, icon: "washer" },
        { id: "dishwasher", name: "Dishwasher", w: 0.6, h: 0.6, icon: "dishwasher" },
      ],
    },
    {
      category: "Other",
      items: [
        { id: "tv", name: "TV stand", w: 1.2, h: 0.4, icon: "tv" },
        { id: "piano-upright", name: "Upright piano", w: 1.5, h: 0.6, icon: "piano" },
        { id: "lamp-floor", name: "Floor lamp", w: 0.4, h: 0.4, icon: "lamp" },
        { id: "bike", name: "Bike", w: 0.6, h: 1.8, icon: "bike" },
        { id: "bike-vertical", name: "Bike (vertical)", w: 0.6, h: 1.1, icon: "bikeVertical" },
      ],
    },
  ];

  return { CATALOG, ICONS };
})();
