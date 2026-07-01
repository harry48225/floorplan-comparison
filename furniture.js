// Standard furniture footprints for the "what fits" overlay. Sizes are in metres
// (width W across × depth/length D), measured top-down. Loaded before app.js;
// exposes window.Furniture = { CATALOG, ICONS }.
//
// Beds use UK National Bed Federation standard mattress sizes. Storage and
// kitchen/utility appliances use the standard 600 mm cabinet depth. Seating,
// tables, desks, the TV stand and bike are typical real-world sizes — actual
// products vary, so these are sensible middle-of-the-road figures.
window.Furniture = (() => {
  "use strict";

  // Each icon is a top-down schematic authored in a unit box (x and y run 0→1).
  // app.js affine-maps it onto the placed piece, so it scales and rotates with
  // the furniture. The "front"/head of a piece points to -y (up). Shapes are
  // stroked (fill:none) with a non-scaling stroke — see styles.css .furn-icon.
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
    table:
      '<rect x=".28" y=".24" width=".44" height=".52" rx=".03"/>' +
      '<rect x=".32" y=".05" width=".36" height=".12" rx=".02"/>' +
      '<rect x=".32" y=".83" width=".36" height=".12" rx=".02"/>' +
      '<rect x=".05" y=".34" width=".12" height=".32" rx=".02"/>' +
      '<rect x=".83" y=".34" width=".12" height=".32" rx=".02"/>',
    coffee: '<rect x=".12" y=".2" width=".76" height=".6" rx=".05"/>',
    desk:
      '<rect x=".05" y=".08" width=".9" height=".42" rx=".02"/>' +
      '<rect x=".38" y=".14" width=".24" height=".1" rx=".01"/>' +
      '<circle cx=".5" cy=".74" r=".16"/>',
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
  };

  const CATALOG = [
    {
      category: "Beds",
      items: [
        { id: "bed-single", name: "Single bed", w: 0.9, h: 1.9, icon: "bed" },
        { id: "bed-small-double", name: "Small double bed", w: 1.2, h: 1.9, icon: "bed" },
        { id: "bed-double", name: "Double bed", w: 1.35, h: 1.9, icon: "bed" },
        { id: "bed-king", name: "King bed", w: 1.5, h: 2.0, icon: "bed" },
        { id: "bed-super-king", name: "Super king bed", w: 1.8, h: 2.0, icon: "bed" },
      ],
    },
    {
      category: "Seating",
      items: [
        { id: "armchair", name: "Armchair", w: 0.9, h: 0.9, icon: "sofa" },
        { id: "sofa-2", name: "2-seat sofa", w: 1.6, h: 0.9, icon: "sofa" },
        { id: "sofa-3", name: "3-seat sofa", w: 2.1, h: 0.95, icon: "sofa" },
        { id: "sofa-corner", name: "Corner sofa", w: 2.4, h: 2.0, icon: "sofaCorner" },
      ],
    },
    {
      category: "Tables",
      items: [
        { id: "dining-4", name: "Dining table (4)", w: 1.2, h: 0.8, icon: "table" },
        { id: "dining-6", name: "Dining table (6)", w: 1.6, h: 0.9, icon: "table" },
        { id: "coffee", name: "Coffee table", w: 1.1, h: 0.6, icon: "coffee" },
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
        { id: "wardrobe", name: "Wardrobe", w: 1.0, h: 0.6, icon: "wardrobe" },
        { id: "chest", name: "Chest of drawers", w: 0.8, h: 0.45, icon: "chest" },
        { id: "bedside", name: "Bedside table", w: 0.45, h: 0.4, icon: "bedside" },
      ],
    },
    {
      category: "Appliances",
      items: [
        { id: "fridge", name: "Fridge-freezer", w: 0.6, h: 0.6, icon: "fridge" },
        { id: "washer", name: "Washing machine", w: 0.6, h: 0.6, icon: "washer" },
        { id: "dishwasher", name: "Dishwasher", w: 0.6, h: 0.6, icon: "washer" },
      ],
    },
    {
      category: "Other",
      items: [
        { id: "tv", name: "TV stand", w: 1.2, h: 0.4, icon: "tv" },
        { id: "bike", name: "Bike", w: 0.6, h: 1.8, icon: "bike" },
      ],
    },
  ];

  return { CATALOG, ICONS };
})();
