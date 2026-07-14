// ---------------------------------------------------------------------------
// ADDON PRIORITIZATION CONFIG  (Addon-Creation-General-Plan §5)
// Capacity is managed with difficulty points + weekly-update slots, not a
// fixed addon count. /addonpoll runs the monthly vote; the top-voted addons
// are filled into the weekly budget by difficulty, the rest fall to monthly.
// Edit this list as addons come and go.
// ---------------------------------------------------------------------------

// Total difficulty points available for weekly-update slots.
export const WEEKLY_SLOT_BUDGET = 10;

// How many addons a member may pick in the monthly poll.
export const MAX_VOTES = 3;

// difficulty = maintenance difficulty score (how hard it is to update weekly).
export const addons = [
  { name: 'Aberrant', difficulty: 3 },
  { name: 'Better Potions', difficulty: 2 },
  { name: 'Computers', difficulty: 5 },
  { name: 'Dream Addon', difficulty: 3 },
  { name: 'Ender Inventory', difficulty: 1 },
  { name: 'Peripherals', difficulty: 4 },
  { name: 'Potion Beacons', difficulty: 2 },
  { name: 'VTM', difficulty: 5 },
];
