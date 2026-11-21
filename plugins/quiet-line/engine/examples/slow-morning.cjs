/* ============================================================
   Slow Morning — a wide, high-completion Quiet Line drawing.
   Authoring example for arbitrary canvas sizes and custom marks.

   node examples/slow-morning.cjs [seed] [brush] [surface] [width] [height]
   ============================================================ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const CORE = require('../lib/core.cjs');
const RASTER = require('../lib/raster.cjs');

const args = process.argv.slice(2);
const seed = Number(args[0] || 271);
const brush = args[1] || 'brush';
const surface = args[2] || 'coldpress';
const W = Number(args[3] || 1600);
const H = Number(args[4] || 1100);
const weight = Number(args[5] || 2.2);
const S = Math.min(W, H);
const TAU = Math.PI * 2;

const nx = x => x / W;
const ny = y => y / H;
const P = pts => pts.map(p => [nx(p[0]), ny(p[1])]);
const item = (fn, pts, opts) => fn(P(pts), opts || {});
const line = (pts, opts) => item(CORE.stroke, pts, Object.assign({ width: 0.7, registration: 0.75 }, opts));
const curve = (pts, opts) => item(CORE.curve, pts, Object.assign({ steps: 18, width: 0.8, registration: 0.75 }, opts));
const fill = (pts, opts) => {
  const it = item(CORE.fill, pts, Object.assign({ rough: 0.5 }, opts));
  items.push(it);
  return it;
};
const ell = (cx, cy, rx, ry, opts) => CORE.ellipse(nx(cx), ny(cy), rx / W, ry / H, Object.assign({ steps: 120, width: 0.8, registration: 0.6 }, opts || {}));
const fell = (cx, cy, rx, ry, opts) => CORE.fillEllipse(nx(cx), ny(cy), rx / W, ry / H, Object.assign({ rough: 0.45 }, opts || {}));
const dot = (x, y, r, opts) => CORE.dot(nx(x), ny(y), r / S, opts || {});
const hx = h => h;

const items = [];

/* ---------- helpers ----------------------------------------- */

function leaf(base, tip, widthPx, leanPx, opts) {
  const shape = CORE.leafShape(
    [nx(base[0]), ny(base[1])],
    [nx(tip[0]), ny(tip[1])],
    widthPx / S,
    leanPx / S
  );
  const o = opts || {};
  items.push(CORE.fill(shape.outline, {
    color: o.color || 'sage',
    opacity: o.opacity == null ? 0.3 : o.opacity,
    rough: 0.38
  }));
  items.push(CORE.curve(shape.vein, {
    width: o.veinWidth || 0.34,
    opacity: o.veinOpacity == null ? 0.6 : o.veinOpacity,
    color: o.veinColor || 'ink',
    registration: 0.35,
    overshoot: 0.1
  }));
  items.push(CORE.curve(shape.outline.concat([shape.outline[0]]), {
    width: o.edgeWidth || 0.48,
    opacity: o.edgeOpacity == null ? 0.8 : o.edgeOpacity,
    color: o.edgeColor || 'ink',
    registration: 0.4,
    overshoot: 0.12
  }));
}

function hatchPx(poly, opts) {
  const o = Object.assign({
    gap: 16, angle: -32, color: 'ink', width: 0.28,
    opacity: 0.2, inset: 6, maxLines: 150
  }, opts || {});
  const rad = o.angle * Math.PI / 180;
  const cos = Math.cos(-rad), sin = Math.sin(-rad);
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p[0]; cy += p[1]; }
  cx /= poly.length; cy /= poly.length;
  const rot = p => {
    const dx = p[0] - cx, dy = p[1] - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  };
  const back = p => {
    const dx = p[0] - cx, dy = p[1] - cy;
    return [cx + dx * cos + dy * sin, cy - dx * sin + dy * cos];
  };
  const rp = poly.map(rot);
  let minY = Infinity, maxY = -Infinity;
  for (const p of rp) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  let made = 0;
  for (let y = minY + o.gap * 0.55; y < maxY && made < o.maxLines; y += o.gap) {
    const xs = [];
    for (let i = 0; i < rp.length; i++) {
      const a = rp[i], b = rp[(i + 1) % rp.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        const t = (y - a[1]) / (b[1] - a[1] || 1);
        xs.push([a[0] + (b[0] - a[0]) * t, y]);
      }
    }
    xs.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = xs[i][0] + o.inset;
      const x1 = xs[i + 1][0] - o.inset;
      if (x1 - x0 < 6) continue;
      const a = back([x0, y]);
      const b = back([x1, y]);
      items.push(line([a, b], {
        color: o.color, width: o.width, opacity: o.opacity,
        overshoot: 0.05, registration: 0.3
      }));
      made++;
    }
  }
}

function shadow(cx, cy, rx, ry, angle, opacity, color) {
  items.push(fell(cx, cy, rx, ry, { color: color || 'ink', opacity, rough: 0.8, rotate: angle }));
}

/* ---------- wall and window --------------------------------- */

// Warm, almost invisible wall wash keeps the paper alive without covering it.
fill([[-40, -40], [W + 40, -40], [W + 40, H + 40], [-40, H + 40]], {
  color: 'clay', opacity: 0.042, rough: 1.4
});

// Sky and distant landscape inside the window.
fill([[150, 100], [950, 100], [950, 670], [150, 670]], {
  color: hx('#8fa5a0'), opacity: 0.28, rough: 0.9
});
items.push(fell(735, 208, 51, 51, { color: 'ochre', opacity: 0.34, rough: 0.35 }));
items.push(ell(735, 208, 51, 51, { width: 0.58, opacity: 0.5, color: 'accent', steps: 90 }));

// Loose cloud bands.
fill([[210, 160], [430, 142], [620, 158], [610, 178], [420, 168], [230, 180]], {
  color: hx('#f1e9d8'), opacity: 0.16, rough: 0.8
});
fill([[610, 250], [820, 238], [930, 252], [910, 268], [800, 258], [630, 268]], {
  color: hx('#f1e9d8'), opacity: 0.12, rough: 0.8
});

fill([[150, 515], [250, 470], [360, 505], [470, 455], [590, 500], [720, 452], [850, 500], [950, 468], [950, 670], [150, 670]], {
  color: hx('#b8a57a'), opacity: 0.3, rough: 0.9
});
fill([[150, 600], [320, 548], [470, 583], [620, 535], [780, 588], [910, 552], [950, 570], [950, 670], [150, 670]], {
  color: hx('#7f8d70'), opacity: 0.32, rough: 0.9
});
fill([[150, 642], [400, 624], [660, 651], [950, 628], [950, 670], [150, 670]], {
  color: hx('#b9905e'), opacity: 0.3, rough: 0.8
});

// Long field lines and a little house in the middle distance.
for (let i = 0; i < 4; i++) {
  items.push(curve([[170, 626 + i * 9], [380, 618 + i * 8], [610, 634 + i * 6], [930, 618 + i * 7]], {
    width: 0.25, opacity: 0.22 + i * 0.03, color: 'ochre', steps: 18
  }));
}
fill([[684, 566], [744, 566], [744, 600], [684, 600]], {
  color: hx('#d8c8a6'), opacity: 0.58, rough: 0.28
});
fill([[674, 566], [714, 538], [754, 566]], { color: 'accent', opacity: 0.28, rough: 0.35 });
items.push(line([[684, 566], [744, 566], [744, 600], [684, 600], [684, 566]], {
  width: 0.32, opacity: 0.5, color: 'ink'
}));
items.push(line([[714, 600], [714, 578]], { width: 0.24, opacity: 0.4 }));

// A little tree line, far away.
for (let i = 0; i < 16; i++) {
  const x = 172 + i * 50 + Math.sin(i * 2.7) * 13;
  const y = 604 + Math.sin(i * 1.9) * 9;
  const h = 14 + (i % 5) * 8;
  items.push(line([[x, y], [x + (i % 2 ? 1 : -1) * 3, y - h]], {
    width: 0.34, opacity: 0.36, color: 'ink', overshoot: 0.1
  }));
  items.push(fell(x + (i % 2 ? 1 : -1) * 2, y - h - 2, 8 + (i % 3) * 4, 12 + (i % 4) * 4, {
    color: hx('#67765f'), opacity: 0.14, rough: 0.7
  }));
}
for (let i = 0; i < 3; i++) {
  const x = 560 + i * 58;
  const y = 300 - i * 28;
  items.push(curve([[x, y], [x + 8, y - 4], [x + 16, y]], {
    width: 0.28, opacity: 0.3, color: 'ink', steps: 5
  }));
}

// A single garden tree in the left pane: pale, clearly outside, and far enough
// back to let the branch in the jug stay the darkest thing in the window.
items.push(curve([[286, 662], [302, 590], [296, 520], [306, 458]], {
  width: 0.55, opacity: 0.34, color: 'ink', steps: 16
}));
items.push(curve([[296, 540], [252, 504], [228, 470]], { width: 0.38, opacity: 0.28, steps: 10 }));
items.push(curve([[300, 520], [350, 482], [382, 462]], { width: 0.34, opacity: 0.26, steps: 10 }));
items.push(curve([[306, 480], [278, 442], [260, 416]], { width: 0.28, opacity: 0.24, steps: 8 }));
fill([[208, 478], [246, 424], [312, 408], [370, 430], [394, 474], [360, 512], [292, 520], [238, 506]], {
  color: hx('#718064'), opacity: 0.24, rough: 0.7
});
fill([[236, 436], [286, 390], [350, 396], [384, 430], [354, 460], [292, 452]], {
  color: hx('#869574'), opacity: 0.22, rough: 0.7
});
for (let i = 0; i < 6; i++) {
  const a = i * 1.13;
  items.push(fell(280 + Math.cos(a) * 54, 452 + Math.sin(a) * 30, 26 + (i % 2) * 8, 18 + (i % 3) * 5, {
    color: hx('#697a60'), opacity: 0.12, rough: 0.65
  }));
}
for (let i = 0; i < 8; i++) {
  const x = 230 + i * 23 + Math.sin(i * 2) * 8;
  const y = 440 - (i % 3) * 18;
  items.push(curve([[x, y], [x + 12, y - 10], [x + 22, y - 2]], {
    width: 0.24, opacity: 0.3, color: hx('#55654f'), steps: 6
  }));
}

// Window frame: broad cream bars around a four-pane opening.
const frame = hx('#e8dcc4');
const frameBars = [
  [[110, 60], [990, 60], [990, 100], [110, 100]],
  [[110, 670], [990, 670], [990, 710], [110, 710]],
  [[110, 100], [150, 100], [150, 670], [110, 670]],
  [[950, 100], [990, 100], [990, 670], [950, 670]],
  [[540, 100], [570, 100], [570, 670], [540, 670]],
  [[150, 375], [950, 375], [950, 400], [150, 400]]
];
for (const bar of frameBars) {
  fill(bar, { color: frame, opacity: 0.52, rough: 0.35 });
  items.push(CORE.stroke(P(bar.concat([bar[0]])), { color: 'ink', width: 0.82, opacity: 0.86, closed: true, registration: 0.45 }));
  items.push(line([[bar[0][0], bar[0][1]], [bar[0][0] + 3, bar[0][1] + 3]], { width: 0.24, opacity: 0.22, color: hx('#fbf3e1') }));
}
// Deep edge shadows give the frame a little relief.
items.push(line([[934, 104], [934, 666]], { width: 0.6, opacity: 0.24 }));
items.push(line([[156, 662], [942, 662]], { width: 0.55, opacity: 0.22 }));
items.push(line([[114, 106], [114, 664]], { width: 0.4, opacity: 0.18, color: hx('#fbf3e1') }));
// Inner pane reflection: two long, nearly invisible diagonal lifts.
items.push(line([[175, 140], [330, 340]], { color: hx('#f4ead6'), width: 0.35, opacity: 0.32 }));
items.push(line([[192, 140], [347, 340]], { color: hx('#f4ead6'), width: 0.28, opacity: 0.2 }));
items.push(line([[610, 420], [790, 620]], { color: hx('#f4ead6'), width: 0.34, opacity: 0.25 }));

// Windowsill, broad enough to catch a soft shadow.
fill([[70, 690], [1030, 690], [1050, 742], [50, 742]], {
  color: frame, opacity: 0.58, rough: 0.35
});
items.push(line([[70, 690], [1030, 690]], { width: 0.86, opacity: 0.84 }));
items.push(line([[50, 742], [1050, 742]], { width: 0.7, opacity: 0.74 }));
items.push(line([[150, 710], [950, 710]], { width: 0.42, opacity: 0.4 }));
items.push(line([[70, 732], [1030, 732]], { width: 0.3, opacity: 0.2, color: hx('#fbf3e1') }));
shadow(540, 760, 470, 28, 0, 0.09, 'ink');
hatchPx([[90, 745], [1010, 745], [1030, 775], [70, 775]], {
  gap: 18, angle: -12, color: 'ink', width: 0.24, opacity: 0.16, inset: 8, maxLines: 30
});

/* ---------- curtain ----------------------------------------- */

// A gathered linen curtain, tied at the waist and flaring to the table.
const curtain = [[930, 42], [1216, 42], [1202, 210], [1150, 380], [1128, 500], [1182, 650], [1196, 760], [900, 760], [936, 620], [945, 500], [938, 360]];
fill(curtain, { color: hx('#8e987b'), opacity: 0.16, rough: 0.65 });
fill([[930, 42], [995, 42], [970, 220], [952, 360], [945, 500], [936, 620], [900, 760], [932, 760], [960, 620], [972, 500], [984, 360], [1004, 220]], {
  color: hx('#6e7b61'), opacity: 0.07, rough: 0.55
});
fill([[1128, 210], [1216, 42], [1168, 42], [1120, 210], [1110, 380], [1128, 500], [1160, 620], [1196, 760], [1160, 760], [1114, 620], [1098, 500], [1102, 380]], {
  color: hx('#f0e2c9'), opacity: 0.08, rough: 0.55
});
fill([[1060, 42], [1120, 42], [1108, 210], [1092, 380], [1090, 500], [1120, 620], [1160, 760], [1118, 760], [1072, 620], [1058, 500], [1064, 380], [1070, 210]], {
  color: hx('#6e7b61'), opacity: 0.065, rough: 0.55
});
items.push(curve([[930, 42], [932, 220], [938, 380], [945, 500], [936, 620], [900, 760]], {
  width: 0.8, opacity: 0.82, color: 'ink', steps: 24
}));
items.push(curve([[1216, 42], [1202, 210], [1150, 380], [1128, 500], [1182, 650], [1196, 760]], {
  width: 0.55, opacity: 0.62, steps: 24
}));
// Folds gather into the tie and open again below it.
for (let i = 0; i < 8; i++) {
  const top = 970 + i * 32;
  const waist = 982 + i * 18;
  const bottom = 924 + i * 37;
  items.push(curve([[top, 48], [top + 4, 220], [waist, 500], [bottom, 755]], {
    width: i % 3 === 0 ? 0.68 : 0.38,
    opacity: i % 3 === 0 ? 0.5 : 0.3,
    color: 'ink', steps: 18
  }));
}
items.push(curve([[1005, 48], [996, 250], [984, 500], [944, 755]], {
  width: 0.34, opacity: 0.25, color: 'ink', steps: 14
}));
// A soft cloth tie, with a knot and two hanging ends.
items.push(curve([[942, 492], [1000, 498], [1062, 492], [1120, 502]], {
  width: 1.0, opacity: 0.72
}));
items.push(curve([[946, 510], [1002, 516], [1064, 510], [1124, 520]], {
  width: 0.42, opacity: 0.45
}));
fill([[1080, 496], [1062, 486], [1056, 504], [1074, 510]], { color: 'accent', opacity: 0.18, rough: 0.4 });
fill([[1098, 494], [1114, 484], [1120, 502], [1102, 508]], { color: 'accent', opacity: 0.18, rough: 0.4 });
items.push(curve([[1080, 496], [1062, 486], [1056, 504], [1074, 510], [1080, 496]], { width: 0.28, opacity: 0.55, steps: 10 }));
items.push(curve([[1098, 494], [1114, 484], [1120, 502], [1102, 508], [1098, 494]], { width: 0.28, opacity: 0.55, steps: 10 }));
items.push(fell(1090, 502, 7, 6, { color: 'accent', opacity: 0.25, rough: 0.35 }));
items.push(ell(1090, 502, 7, 6, { width: 0.3, opacity: 0.55, steps: 40 }));
items.push(curve([[1086, 508], [1072, 548], [1084, 578]], { width: 0.3, opacity: 0.42, steps: 8 }));
items.push(curve([[1096, 508], [1114, 544], [1104, 574]], { width: 0.28, opacity: 0.36, steps: 8 }));
// Deep shadow where the cloth meets the wall, and at the floor hem.
fill([[1180, 760], [1260, 760], [1260, 900], [1170, 900]], {
  color: 'clay', opacity: 0.06, rough: 0.8
});
hatchPx([[940, 700], [1196, 700], [1196, 760], [900, 760]], {
  gap: 15, angle: -8, color: 'ink', width: 0.22, opacity: 0.16, inset: 8, maxLines: 20
});
// Curtain rod, mostly visible at the left and right of the cloth.
items.push(line([[60, 48], [1240, 48]], { width: 0.9, opacity: 0.72 }));
items.push(dot(60, 48, 8, { color: 'ink', opacity: 0.7 }));
items.push(dot(1240, 48, 8, { color: 'ink', opacity: 0.7 }));

/* ---------- wall shelf and a small botanical card ----------- */

// A pressed-leaf card above a narrow shelf fills the quiet right wall.
fill([[1348, 208], [1520, 208], [1520, 352], [1348, 352]], {
  color: hx('#eee2ca'), opacity: 0.42, rough: 0.3
});
items.push(line([[1348, 208], [1520, 208], [1520, 352], [1348, 352], [1348, 208]], {
  width: 0.72, opacity: 0.72, closed: true
}));
items.push(line([[1360, 220], [1508, 220], [1508, 340], [1360, 340], [1360, 220]], {
  width: 0.28, opacity: 0.4
}));
leaf([1438, 326], [1432, 252], 22, -8, {
  color: 'sage', opacity: 0.32, veinWidth: 0.25, edgeWidth: 0.34, edgeOpacity: 0.55
});
items.push(line([[1402, 332], [1464, 332]], { width: 0.26, opacity: 0.35 }));

// Shelf board, brackets and a small collection of things.
fill([[1266, 426], [1582, 426], [1582, 446], [1266, 446]], {
  color: hx('#b99a6c'), opacity: 0.32, rough: 0.35
});
items.push(line([[1266, 426], [1582, 426], [1582, 446], [1266, 446], [1266, 426]], {
  width: 0.7, opacity: 0.76, closed: true
}));
items.push(line([[1272, 446], [1272, 472]], { width: 0.4, opacity: 0.55 }));
items.push(line([[1568, 446], [1568, 472]], { width: 0.4, opacity: 0.55 }));
items.push(curve([[1280, 448], [1302, 468], [1302, 446]], { width: 0.35, opacity: 0.5, steps: 8 }));
items.push(curve([[1564, 448], [1542, 468], [1542, 446]], { width: 0.35, opacity: 0.5, steps: 8 }));
shadow(1420, 474, 145, 10, 0, 0.05, 'ink');

// small white vase with a cutting
fill([[1312, 376], [1300, 400], [1302, 424], [1334, 432], [1366, 422], [1366, 392], [1354, 376]], {
  color: hx('#eee3cd'), opacity: 0.6, rough: 0.3
});
items.push(curve([[1312, 376], [1300, 400], [1302, 424], [1334, 432], [1366, 422], [1366, 392], [1354, 376]], {
  width: 0.52, opacity: 0.76, steps: 18
}));
items.push(ell(1333, 376, 22, 5, { width: 0.4, opacity: 0.7, steps: 60 }));
leaf([1332, 380], [1316, 326], 11, -4, { color: 'sage', opacity: 0.3, veinWidth: 0.16, edgeWidth: 0.24, edgeOpacity: 0.5 });
leaf([1332, 378], [1348, 320], 10, 4, { color: 'sage', opacity: 0.28, veinWidth: 0.15, edgeWidth: 0.22, edgeOpacity: 0.45 });
items.push(line([[1332, 380], [1326, 338], [1316, 326]], { width: 0.3, opacity: 0.5 }));
// two slim books and a bowl
fill([[1394, 390], [1474, 382], [1484, 424], [1402, 430]], { color: 'sage', opacity: 0.3, rough: 0.3 });
items.push(line([[1394, 390], [1474, 382], [1484, 424], [1402, 430], [1394, 390]], {
  width: 0.4, opacity: 0.68, closed: true
}));
fill([[1402, 376], [1462, 370], [1470, 398], [1410, 404]], { color: 'ochre', opacity: 0.26, rough: 0.3 });
items.push(line([[1402, 376], [1462, 370], [1470, 398], [1410, 404], [1402, 376]], {
  width: 0.34, opacity: 0.6, closed: true
}));
fill([[1498, 402], [1562, 402], [1554, 426], [1506, 426]], { color: 'clay', opacity: 0.24, rough: 0.3 });
items.push(ell(1530, 402, 32, 7, { width: 0.38, opacity: 0.6, steps: 70 }));
items.push(curve([[1498, 402], [1506, 426], [1554, 426], [1562, 402]], { width: 0.38, opacity: 0.62, steps: 16 }));

// A trailing vine softens the wall and links shelf to table.
items.push(curve([[1340, 428], [1352, 484], [1328, 540], [1346, 596], [1334, 650]], {
  width: 0.38, opacity: 0.55, color: 'ink', steps: 20
}));
items.push(curve([[1348, 470], [1372, 506], [1382, 548]], {
  width: 0.26, opacity: 0.4, color: 'ink', steps: 12
}));
const vineLeaves = [
  [[1352, 484], [1376, 472], 14, -4, 'sage'],
  [[1328, 540], [1302, 532], 12, 4, 'sage'],
  [[1346, 596], [1372, 588], 13, -5, 'ochre'],
  [[1334, 650], [1308, 642], 11, 4, 'sage'],
  [[1372, 506], [1394, 498], 10, -4, 'sage'],
  [[1382, 548], [1402, 542], 9, -3, 'ochre']
];
for (const [base, tip, w, lean, color] of vineLeaves) {
  leaf(base, tip, w, lean, {
    color, opacity: color === 'ochre' ? 0.28 : 0.32,
    veinWidth: 0.18, edgeWidth: 0.3, edgeOpacity: 0.5
  });
}

/* ---------- table ------------------------------------------- */

fill([[0, 745], [W, 745], [W, H], [0, H]], {
  color: hx('#c5a06c'), opacity: 0.1, rough: 1.0
});
items.push(curve([[0, 748], [400, 742], [800, 752], [1200, 744], [1600, 750]], {
  width: 0.92, opacity: 0.76, color: 'ink', steps: 24
}));
items.push(line([[0, 760], [1600, 760]], { width: 0.28, opacity: 0.24, color: 'ink' }));
items.push(line([[0, 756], [1600, 756]], { width: 0.3, opacity: 0.18, color: hx('#f3e4c7') }));

// Long, quiet wood grain.
for (let i = 0; i < 9; i++) {
  const y = 790 + i * 35;
  const bend = Math.sin(i * 1.7) * 11;
  items.push(curve([[20, y], [420, y - bend], [840, y + bend * 0.6], [1240, y - bend * 0.4], [1580, y + 4]], {
    width: 0.28, opacity: 0.15 + (i % 3) * 0.03, color: 'ochre', steps: 24
  }));
}
items.push(ell(1280, 861, 13, 4, { width: 0.28, opacity: 0.2, color: 'ink' }));
items.push(ell(1280, 861, 7, 2, { width: 0.22, opacity: 0.16, color: 'ochre' }));

// A soft sheet of light entering from the window; the far right goes quiet.
fill([[150, 742], [950, 742], [1450, 1100], [260, 1100]], {
  color: hx('#f0d49a'), opacity: 0.07, rough: 0.9
});
fill([[830, 745], [1600, 745], [1600, 1100], [980, 1100]], {
  color: 'ink', opacity: 0.028, rough: 1.15
});
fill([[1040, 745], [1360, 745], [1560, 1100], [1190, 1100]], {
  color: hx('#8d7b62'), opacity: 0.025, rough: 1.0
});

/* ---------- newspaper at the left edge ---------------------- */

const paper = [[-42, 946], [346, 920], [378, 1048], [4, 1078]];
shadow(186, 1062, 206, 18, 0.04, 0.11, 'ink');
fill(paper, { color: hx('#d9d1bd'), opacity: 0.55, rough: 0.28 });
fill([[246, 928], [346, 920], [378, 1048], [278, 1055]], {
  color: hx('#cbc1ab'), opacity: 0.38, rough: 0.3
});
items.push(line([...paper, paper[0]], { width: 0.7, opacity: 0.76, closed: true }));
items.push(line([[244, 926], [262, 1052]], { width: 0.32, opacity: 0.3, color: 'ink' }));
items.push(line([[250, 928], [268, 1052]], { width: 0.28, opacity: 0.18, color: hx('#f0e7d2') }));
// masthead, headline and a picture block
items.push(line([[-4, 964], [212, 948]], { width: 1.05, opacity: 0.78 }));
items.push(line([[-4, 980], [206, 964]], { width: 0.46, opacity: 0.48 }));
items.push(line([[18, 986], [206, 970]], { width: 0.34, opacity: 0.38 }));
fill([[18, 996], [136, 988], [142, 1044], [24, 1050]], {
  color: hx('#b8ad97'), opacity: 0.5, rough: 0.25
});
hatchPx([[20, 996], [136, 988], [142, 1044], [24, 1050]], {
  gap: 8, angle: -26, color: 'ink', width: 0.2, opacity: 0.28, inset: 3, maxLines: 48
});
items.push(line([[18, 996], [136, 988], [142, 1044], [24, 1050], [18, 996]], {
  width: 0.34, opacity: 0.5, closed: true
}));
// columns of type
for (let c = 0; c < 2; c++) {
  const x0 = 158 + c * 74;
  for (let r = 0; r < 10; r++) {
    const y = 976 + c * 3 + r * 7;
    items.push(line([[x0, y], [x0 + 52 + (r % 3) * 7, y - 2]], {
      width: 0.19, opacity: 0.24, color: 'ink'
    }));
  }
}
for (let r = 0; r < 9; r++) {
  const y = 1008 + r * 7;
  items.push(line([[20, y], [128, y - 3]], {
    width: 0.18, opacity: 0.22, color: 'ink'
  }));
}
// a pair of reading glasses and a pen
fill([[264, 968], [300, 964], [304, 990], [268, 995]], {
  color: hx('#f4ecd8'), opacity: 0.3, rough: 0.25
});
fill([[312, 964], [348, 960], [354, 986], [318, 990]], {
  color: hx('#f4ecd8'), opacity: 0.3, rough: 0.25
});
items.push(ell(282, 981, 20, 13, { width: 0.42, opacity: 0.7, steps: 60 }));
items.push(ell(333, 976, 20, 13, { width: 0.42, opacity: 0.7, steps: 60 }));
items.push(curve([[302, 980], [312, 974]], { width: 0.28, opacity: 0.55, steps: 6 }));
items.push(line([[352, 972], [372, 966]], { width: 0.24, opacity: 0.4 }));
items.push(line([[214, 1052], [330, 1036]], { width: 0.56, opacity: 0.84 }));
items.push(line([[330, 1036], [354, 1032]], { width: 0.36, opacity: 0.7, color: 'accent' }));
items.push(dot(357, 1031, 3.6, { color: 'ink', opacity: 0.65 }));

/* ---------- cloth on the right ------------------------------ */

fill([[1130, 985], [1490, 1000], [1540, 1090], [1110, 1088]], {
  color: hx('#8d987a'), opacity: 0.075, rough: 0.8
});
for (let i = 0; i < 4; i++) {
  items.push(curve([[1170 + i * 78, 995], [1160 + i * 78, 1035], [1175 + i * 78, 1080]], {
    width: 0.32, opacity: 0.28, color: 'ink', steps: 10
  }));
}

/* ---------- jug and branches -------------------------------- */

const branch = (pts, w, color) => items.push(curve(pts, {
  width: w, opacity: 0.9, color: color || 'ink', steps: 20, overshoot: 0.8, registration: 0.6
}));
branch([[556, 805], [548, 735], [520, 660], [482, 585], [462, 505]], 1.05);
branch([[556, 805], [566, 720], [598, 642], [636, 565], [662, 486]], 0.92);
branch([[552, 802], [520, 738], [480, 690], [430, 646]], 0.72);
branch([[562, 802], [602, 752], [650, 706], [706, 680]], 0.65);
branch([[530, 700], [495, 657], [455, 628]], 0.45);
branch([[590, 660], [628, 625], [648, 598]], 0.42);
branch([[510, 635], [494, 590], [484, 552]], 0.35);
branch([[640, 548], [656, 520], [662, 492]], 0.32);

const leaves = [
  [[466, 584], [414, 530], 32, 12, 'sage'],
  [[486, 558], [534, 500], 30, -8, 'sage'],
  [[520, 660], [474, 618], 23, 7, 'sage'],
  [[598, 642], [642, 596], 26, -8, 'sage'],
  [[628, 565], [616, 506], 31, 11, 'sage'],
  [[650, 590], [700, 558], 25, -9, 'ochre'],
  [[650, 706], [692, 674], 22, -6, 'sage'],
  [[684, 680], [720, 648], 24, -6, 'ochre'],
  [[660, 486], [652, 430], 23, 3, 'sage'],
  [[462, 505], [444, 454], 18, 6, 'ochre']
];
for (const [base, tip, w, lean, color] of leaves) {
  leaf(base, tip, w, lean, {
    color,
    opacity: color === 'ochre' ? 0.3 : 0.34,
    veinWidth: 0.27,
    edgeWidth: 0.48,
    edgeOpacity: 0.74
  });
}
// A second flush of smaller leaves and buds fills the upper branch.
const extraLeaves = [
  [[548, 735], [512, 702], 17, 7, 'sage'],
  [[566, 720], [590, 682], 16, -5, 'ochre'],
  [[662, 486], [680, 442], 15, 3, 'sage'],
  [[430, 646], [400, 622], 13, 5, 'sage']
];
for (const [base, tip, w, lean, color] of extraLeaves) {
  leaf(base, tip, w, lean, {
    color,
    opacity: color === 'ochre' ? 0.3 : 0.34,
    veinWidth: 0.22,
    edgeWidth: 0.38,
    edgeOpacity: 0.68
  });
}
items.push(dot(444, 452, 4.2, { color: 'accent', opacity: 0.6 }));
items.push(dot(678, 442, 3.6, { color: 'accent', opacity: 0.55 }));
items.push(dot(400, 620, 3.2, { color: 'ochre', opacity: 0.55 }));

// Jug shadow, then body.
shadow(570, 1015, 148, 24, -0.03, 0.13, 'ink');
fill([[522, 805], [505, 842], [490, 882], [488, 930], [500, 975], [528, 1003], [570, 1012], [614, 1000], [646, 970], [660, 925], [655, 872], [638, 830], [606, 806]], {
  color: 'accent', opacity: 0.48, rough: 0.38
});
// shaded right cheek and a warm reflected left cheek
fill([[574, 814], [614, 810], [646, 846], [660, 902], [650, 955], [616, 1000], [578, 1011], [596, 955], [600, 900], [590, 850]], {
  color: hx('#8e4e39'), opacity: 0.18, rough: 0.45
});
fill([[520, 842], [502, 884], [504, 936], [526, 978], [550, 996], [536, 948], [540, 890], [552, 850]], {
  color: hx('#f2e0c8'), opacity: 0.1, rough: 0.45
});
items.push(curve([[522, 805], [495, 850], [486, 905], [495, 965], [530, 1002], [574, 1012], [620, 997], [650, 960], [660, 910], [650, 858], [620, 820], [580, 806]], {
  width: 1.18, opacity: 0.94, closed: false, steps: 28
}));
// rim
fill([[512, 793], [608, 793], [614, 812], [506, 812]], { color: 'accent', opacity: 0.44, rough: 0.35 });
items.push(fell(560, 794, 48, 11, { color: 'accent', opacity: 0.28, rough: 0.3 }));
items.push(ell(560, 794, 48, 11, { width: 0.72, opacity: 0.9, steps: 100 }));
items.push(line([[522, 806], [534, 800]], { width: 0.35, opacity: 0.35 }));
// handle
items.push(curve([[642, 850], [692, 866], [702, 905], [684, 942], [642, 958]], {
  width: 1.2, opacity: 0.9, steps: 18
}));
items.push(curve([[650, 858], [684, 878], [688, 908], [668, 934]], {
  width: 0.32, opacity: 0.35, steps: 14
}));
// highlight and a few ceramic marks
items.push(curve([[510, 860], [501, 906], [514, 952], [540, 982]], {
  width: 0.46, opacity: 0.3, color: hx('#f8ead2'), steps: 18
}));
items.push(curve([[594, 850], [610, 885], [610, 930]], {
  width: 0.28, opacity: 0.28, color: 'ink', steps: 12
}));
// painted bands and a tiny stamped leaf
items.push(curve([[497, 888], [540, 895], [590, 891], [646, 878]], {
  width: 0.34, opacity: 0.42, color: 'ink', steps: 16
}));
items.push(curve([[498, 906], [540, 913], [592, 909], [648, 895]], {
  width: 0.24, opacity: 0.3, color: 'ink', steps: 16
}));
leaf([570, 888], [584, 866], 11, -4, {
  color: 'sage', opacity: 0.24, veinWidth: 0.16, edgeWidth: 0.22, edgeOpacity: 0.42
});
hatchPx([[596, 840], [642, 868], [652, 922], [632, 975], [590, 996], [606, 955], [616, 905]], {
  gap: 14, angle: -58, color: 'ink', width: 0.3, opacity: 0.3, inset: 4
});
// contact shadow that follows the curve of the jug
hatchPx([[468, 1004], [674, 946], [678, 984], [470, 1028]], {
  gap: 12, angle: -8, color: 'ink', width: 0.26, opacity: 0.18, inset: 5, maxLines: 28
});

/* ---------- books ------------------------------------------- */

shadow(880, 1052, 170, 20, 0.02, 0.13, 'ink');
hatchPx([[750, 1038], [1020, 1020], [1010, 1056], [760, 1070]], {
  gap: 13, angle: -6, color: 'ink', width: 0.24, opacity: 0.13, inset: 5, maxLines: 20
});
// bottom book
fill([[726, 1016], [964, 1004], [982, 1044], [746, 1058]], { color: 'clay', opacity: 0.26, rough: 0.35 });
items.push(line([[726, 1016], [964, 1004], [982, 1044], [746, 1058], [726, 1016]], {
  width: 0.7, opacity: 0.8, closed: true
}));
fill([[744, 1012], [888, 1004], [894, 1018], [750, 1026]], { color: hx('#f1e3c9'), opacity: 0.46, rough: 0.25 });
// middle book
fill([[748, 970], [982, 958], [1000, 1014], [770, 1028]], { color: 'ochre', opacity: 0.3, rough: 0.35 });
items.push(line([[748, 970], [982, 958], [1000, 1014], [770, 1028], [748, 970]], {
  width: 0.78, opacity: 0.84, closed: true
}));
fill([[768, 968], [900, 960], [906, 978], [774, 986]], { color: hx('#f1e3c9'), opacity: 0.5, rough: 0.25 });
for (let i = 0; i < 5; i++) {
  items.push(line([[780 + i * 24, 969], [786 + i * 24, 981]], { width: 0.22, opacity: 0.24 }));
}
items.push(line([[760, 1004], [990, 992]], { width: 0.3, opacity: 0.32 }));
// top book
fill([[792, 926], [974, 916], [990, 968], [806, 978]], { color: 'sage', opacity: 0.3, rough: 0.35 });
items.push(line([[792, 926], [974, 916], [990, 968], [806, 978], [792, 926]], {
  width: 0.74, opacity: 0.84, closed: true
}));
fill([[808, 925], [918, 918], [924, 935], [814, 942]], { color: hx('#f1e3c9'), opacity: 0.45, rough: 0.25 });
items.push(line([[802, 954], [982, 944]], { width: 0.3, opacity: 0.3 }));
items.push(curve([[812, 941], [850, 937], [888, 938]], { width: 0.25, opacity: 0.38 }));
items.push(line([[828, 963], [948, 950]], { width: 0.22, opacity: 0.26 }));
// a thin bookmark and a pencil left between the pages
fill([[930, 922], [945, 920], [952, 986], [935, 985]], { color: 'accent', opacity: 0.34, rough: 0.4 });
items.push(line([[930, 922], [945, 920], [952, 986], [935, 985], [930, 922]], {
  width: 0.36, opacity: 0.58, closed: true
}));
items.push(line([[846, 932], [998, 919]], { width: 0.62, opacity: 0.8 }));
items.push(line([[846, 936], [998, 923]], { width: 0.2, opacity: 0.35 }));
items.push(line([[786, 929], [806, 927]], { width: 0.26, opacity: 0.45, color: hx('#d9b37b') }));

/* ---------- cup --------------------------------------------- */

shadow(1160, 978, 108, 18, 0.02, 0.12, 'ink');
hatchPx([[1070, 980], [1236, 980], [1216, 1010], [1090, 1010]], {
  gap: 12, angle: -5, color: 'ink', width: 0.24, opacity: 0.14, inset: 5, maxLines: 22
});
fill([[1102, 894], [1088, 925], [1100, 956], [1140, 966], [1180, 952], [1196, 920], [1184, 886]], {
  color: hx('#eadbc0'), opacity: 0.38, rough: 0.3
});
items.push(curve([[1102, 894], [1088, 925], [1100, 956], [1140, 966], [1180, 952], [1196, 920], [1184, 886]], {
  width: 0.86, opacity: 0.86, steps: 22
}));
items.push(fell(1142, 889, 43, 9, { color: hx('#a97748'), opacity: 0.4, rough: 0.3 }));
items.push(ell(1142, 889, 43, 9, { width: 0.56, opacity: 0.84, steps: 90 }));
items.push(curve([[1112, 892], [1140, 896], [1168, 891]], { width: 0.28, opacity: 0.3, color: hx('#d8c3a3'), steps: 10 }));
items.push(curve([[1191, 902], [1232, 908], [1230, 944], [1190, 951]], {
  width: 1.0, opacity: 0.82, steps: 14
}));
// saucer
fill([[1060, 962], [1224, 962], [1204, 988], [1080, 988]], { color: 'clay', opacity: 0.16, rough: 0.3 });
items.push(fell(1142, 970, 84, 17, { color: 'clay', opacity: 0.11, rough: 0.25 }));
items.push(ell(1142, 970, 84, 17, { width: 0.62, opacity: 0.66, steps: 110 }));
items.push(ell(1142, 966, 58, 11, { width: 0.38, opacity: 0.42, steps: 90 }));
// A small biscuit on the saucer.
fill([[1184, 970], [1204, 966], [1212, 980], [1196, 990], [1182, 984]], {
  color: hx('#c69b62'), opacity: 0.45, rough: 0.35
});
items.push(curve([[1184, 970], [1204, 966], [1212, 980], [1196, 990], [1182, 984], [1184, 970]], {
  width: 0.4, opacity: 0.62, steps: 16
}));
items.push(dot(1196, 976, 2.4, { color: 'ink', opacity: 0.35 }));
items.push(dot(1204, 982, 2, { color: 'ink', opacity: 0.3 }));
// steam
items.push(curve([[1120, 870], [1110, 838], [1126, 806], [1116, 776]], {
  width: 0.32, opacity: 0.28, color: 'ink', steps: 16
}));
items.push(curve([[1158, 866], [1168, 832], [1152, 802], [1160, 770]], {
  width: 0.28, opacity: 0.22, color: 'ink', steps: 16
}));

/* ---------- a pear, left on the table ----------------------- */

shadow(1012, 1068, 40, 9, 0.04, 0.11, 'ink');
fill([[1012, 990], [992, 1004], [982, 1030], [990, 1054], [1012, 1064], [1034, 1054], [1042, 1030], [1032, 1004]], {
  color: hx('#b1a05f'), opacity: 0.46, rough: 0.38
});
fill([[1000, 1010], [990, 1030], [996, 1050], [1012, 1058], [1006, 1034], [1004, 1016]], {
  color: hx('#d8c789'), opacity: 0.2, rough: 0.4
});
items.push(curve([[1012, 990], [992, 1004], [982, 1030], [990, 1054], [1012, 1064], [1034, 1054], [1042, 1030], [1032, 1004], [1012, 990]], {
  width: 0.72, opacity: 0.86, steps: 26
}));
items.push(line([[1012, 994], [1008, 976]], { width: 0.6, opacity: 0.8, color: hx('#6c5535') }));
leaf([1008, 980], [1034, 966], 12, -5, {
  color: 'sage', opacity: 0.32, veinWidth: 0.16, edgeWidth: 0.26, edgeOpacity: 0.55
});
items.push(curve([[1002, 1020], [996, 1040], [1006, 1052]], {
  width: 0.3, opacity: 0.22, color: hx('#f1e6c8'), steps: 10
}));
hatchPx([[1018, 1002], [1040, 1024], [1034, 1052], [1012, 1060], [1018, 1036]], {
  gap: 8, angle: 28, color: 'ink', width: 0.2, opacity: 0.18, inset: 3, maxLines: 30
});

/* ---------- sleeping cat ------------------------------------ */

// A folded cushion, then a curled cat with its head tucked toward us.
fill([[1232, 1000], [1472, 1006], [1508, 1085], [1222, 1090]], {
  color: hx('#a79270'), opacity: 0.13, rough: 0.7
});
items.push(curve([[1238, 1010], [1330, 1018], [1430, 1012], [1496, 1032]], { width: 0.34, opacity: 0.35, steps: 16 }));
items.push(curve([[1234, 1056], [1340, 1062], [1440, 1054], [1500, 1072]], { width: 0.28, opacity: 0.26, steps: 16 }));
shadow(1380, 1078, 142, 15, 0.02, 0.11, 'ink');

// Back and haunch: the dark shape behind the face.
fill([[1328, 1014], [1340, 980], [1374, 966], [1418, 970], [1454, 992], [1480, 1026], [1472, 1058], [1438, 1076], [1392, 1078], [1348, 1068], [1320, 1048]], {
  color: hx('#c79c68'), opacity: 0.38, rough: 0.5
});
fill([[1370, 982], [1418, 978], [1452, 998], [1472, 1032], [1452, 1046], [1412, 1014], [1374, 1002]], {
  color: hx('#9b7048'), opacity: 0.16, rough: 0.5
});
items.push(curve([[1328, 1014], [1340, 980], [1374, 966], [1418, 970], [1454, 992], [1480, 1026], [1472, 1058], [1438, 1076], [1392, 1078], [1348, 1068], [1320, 1048], [1328, 1014]], {
  width: 1.05, opacity: 0.92, closed: false, steps: 32
}));
// Head, turned slightly toward the viewer.
fill([[1290, 1026], [1292, 1004], [1308, 990], [1334, 992], [1352, 1008], [1358, 1032], [1342, 1050], [1314, 1053], [1296, 1040]], {
  color: hx('#d6ad77'), opacity: 0.48, rough: 0.42
});
fill([[1300, 1012], [1318, 1002], [1336, 1010], [1338, 1028], [1322, 1042], [1302, 1036]], {
  color: hx('#e5c28e'), opacity: 0.18, rough: 0.4
});
items.push(curve([[1290, 1026], [1292, 1004], [1308, 990], [1334, 992], [1352, 1008], [1358, 1032], [1342, 1050], [1314, 1053], [1296, 1040], [1290, 1026]], {
  width: 0.82, opacity: 0.95, closed: false, steps: 26
}));
// Ears.
fill([[1294, 1002], [1288, 975], [1312, 990]], { color: hx('#c79c68'), opacity: 0.42, rough: 0.35 });
fill([[1330, 992], [1349, 973], [1356, 999]], { color: hx('#c79c68'), opacity: 0.42, rough: 0.35 });
fill([[1298, 1000], [1294, 984], [1308, 994]], { color: 'accent', opacity: 0.2, rough: 0.3 });
fill([[1334, 992], [1346, 981], [1350, 998]], { color: 'accent', opacity: 0.2, rough: 0.3 });
items.push(line([[1294, 1002], [1288, 975], [1312, 990]], { width: 0.55, opacity: 0.85 }));
items.push(line([[1330, 992], [1349, 973], [1356, 999]], { width: 0.55, opacity: 0.85 }));
// Closed eyes, nose and muzzle.
items.push(curve([[1304, 1018], [1312, 1022], [1320, 1018]], { width: 0.44, opacity: 0.82, steps: 8 }));
items.push(curve([[1328, 1018], [1336, 1022], [1344, 1018]], { width: 0.44, opacity: 0.82, steps: 8 }));
items.push(dot(1324, 1032, 4.6, { color: 'accent', opacity: 0.78 }));
items.push(curve([[1324, 1036], [1318, 1041], [1312, 1038]], { width: 0.24, opacity: 0.5, steps: 6 }));
items.push(curve([[1324, 1036], [1330, 1041], [1336, 1038]], { width: 0.24, opacity: 0.5, steps: 6 }));
// Whiskers.
for (let i = 0; i < 3; i++) {
  items.push(line([[1302 - i * 2, 1032 + i * 3], [1268 - i * 3, 1028 + i * 8]], { width: 0.22, opacity: 0.36 }));
  items.push(line([[1346 + i * 2, 1030 + i * 3], [1374 + i * 4, 1024 + i * 9]], { width: 0.22, opacity: 0.36 }));
}
// Paws tucked against the cushion.
fill([[1332, 1052], [1354, 1046], [1368, 1060], [1354, 1072], [1332, 1068]], {
  color: hx('#d6ad77'), opacity: 0.35, rough: 0.4
});
items.push(curve([[1332, 1052], [1354, 1046], [1368, 1060], [1354, 1072], [1332, 1068], [1332, 1052]], {
  width: 0.5, opacity: 0.8, steps: 18
}));
items.push(line([[1344, 1054], [1341, 1064]], { width: 0.24, opacity: 0.45 }));
items.push(line([[1354, 1053], [1353, 1065]], { width: 0.24, opacity: 0.45 }));
fill([[1408, 1068], [1436, 1062], [1450, 1076], [1432, 1084], [1410, 1080]], {
  color: hx('#d6ad77'), opacity: 0.3, rough: 0.4
});
items.push(curve([[1408, 1068], [1436, 1062], [1450, 1076], [1432, 1084], [1410, 1080], [1408, 1068]], {
  width: 0.45, opacity: 0.75, steps: 16
}));
// Tail, curling around the front.
items.push(curve([[1456, 1048], [1482, 1060], [1462, 1078], [1400, 1085], [1348, 1072], [1320, 1060]], {
  width: 1.2, opacity: 0.88, steps: 24
}));
items.push(curve([[1452, 1052], [1472, 1063], [1456, 1072], [1402, 1079]], {
  width: 0.4, opacity: 0.32, steps: 16
}));
// Fur hatching and a few tabby stripes.
hatchPx([[1340, 986], [1392, 978], [1442, 994], [1462, 1028], [1434, 1042], [1388, 1016], [1350, 1000]], {
  gap: 9, angle: 12, color: 'ink', width: 0.26, opacity: 0.25, inset: 3, maxLines: 80
});
for (let i = 0; i < 5; i++) {
  items.push(curve([[1360 + i * 18, 986], [1368 + i * 18, 1000], [1360 + i * 18, 1010]], {
    width: 0.3, opacity: 0.34, steps: 8
  }));
}


/* ---------- final table details ----------------------------- */

// A few fallen leaves and a tiny crumb.
leaf([690, 1050], [728, 1028], 17, -6, { color: 'sage', opacity: 0.28, veinWidth: 0.2, edgeWidth: 0.3, edgeOpacity: 0.55 });
leaf([710, 1058], [746, 1042], 13, -4, { color: 'ochre', opacity: 0.25, veinWidth: 0.18, edgeWidth: 0.26, edgeOpacity: 0.45 });
items.push(dot(772, 1067, 3.2, { color: 'ink', opacity: 0.4 }));
items.push(dot(1118, 1018, 2.6, { color: 'ink', opacity: 0.3 }));

/* ---------- render ----------------------------------------- */

const style = {
  seed,
  weight,
  wobble: 0.55,
  pressure: 0.62,
  texture: 0.5,
  padding: 0,
  brush,
  surface
};
const sketch = {
  id: 'slow-morning',
  title: 'Slow Morning',
  cn: '慢早晨',
  note: 'light stays a little longer on the table',
  noteCn: '光在桌面上多停了一会儿',
  items
};
const built = CORE.buildSketch(sketch, style, { width: W, height: H });
const out = RASTER.renderPNG(built, { width: W, height: H, seed, surface, grain: built.grain });
const dir = path.resolve(__dirname, '../../quiet-line-out');
fs.mkdirSync(dir, { recursive: true });
const suffix = `${brush}-${surface}`;
const file = path.join(dir, `slow-morning-${seed}-${suffix}.png`);
fs.writeFileSync(file, out.png);
console.log(JSON.stringify({
  file,
  width: out.width,
  height: out.height,
  marks: built.stats.marks,
  fills: built.stats.fills,
  brush,
  surface,
  bytes: out.png.length
}, null, 2));
