import type { LocationId, Position } from "@/lib/types";

export const MAP_WIDTH = 32;
export const MAP_HEIGHT = 18;

export const baseMapRows = [
  "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
  "^^^^^^..^^^^^^....^^^^^^..^^^^^",
  "^^....tt....^..tt..^^....tt..^^",
  "^..hr....g...^......^..hj....^^",
  "^..rrr....g..^..ww..^....s...^^",
  "^....rr...g..+++++++^..hh....^^",
  "^..tt...~~~..+f...o+...hh....^^",
  "^.......~~~..+.....+...gg....^^",
  "^..hc..~~~...+.....+.........^^",
  "^...........+++...+++..tt....^^",
  "^..tt....a.....r.....hw......^^",
  "^......tt......r....c........^^",
  "^...tt...........tt.....e....^^",
  "^..............tt......tt....^^",
  "^^....tt...............tt...^^^",
  "^^^........^^^^^^........^^^^^^",
  "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
  "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
];

export const locationPositions: Record<LocationId, Position> = {
  shrine: { x: 13, y: 10 },
  garden: { x: 9, y: 5 },
  archive: { x: 7, y: 10 },
  clinic: { x: 22, y: 10 },
  jail: { x: 25, y: 3 },
  square: { x: 15, y: 7 },
  fire: { x: 14, y: 6 },
  well: { x: 19, y: 6 },
  store: { x: 26, y: 4 },
  road: { x: 4, y: 5 },
  gate: { x: 27, y: 12 },
  shed: { x: 26, y: 4 },
  hut_reed: { x: 4, y: 3 },
  hut_loom: { x: 24, y: 5 },
  hut_clerk: { x: 4, y: 8 },
  hut_witness: { x: 24, y: 10 },
};

export const LOCATION_GLYPHS: Record<LocationId, string> = {
  shrine: "s",
  garden: "g",
  archive: "a",
  clinic: "h",
  jail: "j",
  square: "+",
  fire: "f",
  well: "o",
  store: "s",
  road: "r",
  gate: "e",
  shed: "s",
  hut_reed: "h",
  hut_loom: "h",
  hut_clerk: "h",
  hut_witness: "h",
};
