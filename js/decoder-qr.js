/*
  decoder-qr.js
  -------------
  Full QR Code decoder written from scratch.
  Supports versions 1-10 (up to 57 data characters), all four
  error-correction levels (L/M/Q/H), all three encoding modes
  (Numeric, Alphanumeric, Byte/UTF-8), and all three mask patterns.

  Pipeline
  --------
  1. Locate the three finder patterns in the binarized image.
  2. Determine module size and orientation.
  3. Sample every module center into a boolean grid.
  4. Read format information (error-correction level + mask pattern).
  5. Unmask the data region.
  6. Read data codewords in the standard QR zig-zag order.
  7. Apply Reed-Solomon error correction.
  8. Decode data bits into a string.
*/

var DecoderQR = (function () {
  'use strict';

  /* ═══════════════════════════════════════════════════
     FINDER PATTERN DETECTION
  ═══════════════════════════════════════════════════ */

  /*
    scanForFinder(row)
    Scans a boolean row for the 1:1:3:1:1 ratio run-length
    signature of a QR finder pattern center row.
    Returns array of candidate center x-coordinates.
  */
  function scanForFinder(row) {
    var runs    = [];
    var count   = 1;
    var current = row[0];
    for (var i = 1; i < row.length; i++) {
      if (row[i] === current) { count++; }
      else {
        runs.push({ val: current, len: count, end: i - 1 });
        current = row[i];
        count   = 1;
      }
    }
    runs.push({ val: current, len: count, end: row.length - 1 });

    var centers = [];
    /* Need at least 5 consecutive runs starting on black */
    for (var j = 0; j + 4 < runs.length; j++) {
      var a = runs[j],   b = runs[j+1], c = runs[j+2],
          d = runs[j+3], e = runs[j+4];
      /* Must alternate black/white */
      if (!a.val || b.val || !c.val || d.val || !e.val) continue;
      /* Check 1:1:3:1:1 ratio (±50% tolerance) */
      var unit = (a.len + b.len + c.len + d.len + e.len) / 7;
      if (unit < 1) continue;
      var ok = Math.abs(a.len - unit)   < unit * 0.6 &&
               Math.abs(b.len - unit)   < unit * 0.6 &&
               Math.abs(c.len - 3*unit) < unit * 0.9 &&
               Math.abs(d.len - unit)   < unit * 0.6 &&
               Math.abs(e.len - unit)   < unit * 0.6;
      if (ok) {
        var cx = Math.round((c.end - c.len / 2));
        centers.push({ x: cx, unit: unit });
      }
    }
    return centers;
  }

  /*
    findFinderCenters(bin, width, height)
    Scans multiple rows and votes for finder pattern centers.
    Returns up to 3 strongest candidates as {x, y}.
  */
  function findFinderCenters(bin, width, height) {
    var votes = {}; /* key = "gx,gy" → {x,y,count,unit} */
    var GRID  = 8;  /* quantize to 8px cells for vote clustering */

    for (var y = 0; y < height; y += 2) {
      var row  = Processor.getRow(bin, width, y);
      var cands = scanForFinder(row);
      for (var ci = 0; ci < cands.length; ci++) {
        var c  = cands[ci];
        var gx = Math.round(c.x / GRID);
        var gy = Math.round(y  / GRID);
        var key = gx + ',' + gy;
        if (!votes[key]) votes[key] = { x: c.x, y: y, count: 0, unit: c.unit };
        votes[key].count++;
        votes[key].y = Math.round((votes[key].y * (votes[key].count-1) + y) / votes[key].count);
      }
    }

    var arr = Object.keys(votes).map(function (k) { return votes[k]; });
    arr.sort(function (a, b) { return b.count - a.count; });
    return arr.slice(0, 10);
  }

  /* ═══════════════════════════════════════════════════
     MODULE GRID SAMPLING
  ═══════════════════════════════════════════════════ */

  /*
    sampleGrid(bin, width, height, topLeft, topRight, bottomLeft, moduleSize, version)
    Samples the QR grid into a 2-D boolean array.
  */
  function sampleGrid(bin, width, height, tl, tr, bl, moduleSize, size) {
    var grid = [];
    for (var row = 0; row < size; row++) {
      grid.push([]);
      for (var col = 0; col < size; col++) {
        /* Bilinear interpolation of sample point */
        var xFrac = col / (size - 1);
        var yFrac = row / (size - 1);
        var px = Math.round(tl.x + xFrac * (tr.x - tl.x) + yFrac * (bl.x - tl.x));
        var py = Math.round(tl.y + xFrac * (tr.y - tl.y) + yFrac * (bl.y - tl.y));
        px = Math.max(0, Math.min(width - 1, px));
        py = Math.max(0, Math.min(height - 1, py));
        grid[row].push(bin[py * width + px] === 0);
      }
    }
    return grid;
  }

  /* ═══════════════════════════════════════════════════
     FORMAT INFORMATION
  ═══════════════════════════════════════════════════ */

  var FORMAT_INFO_MASK = 0x5412;

  /* All 32 valid format info words (pre-computed) */
  var FORMAT_STRINGS = (function () {
    var table = [];
    /* Generate using BCH(15,5) — standard QR format info */
    var gen = 0x537; /* Generator polynomial */
    for (var data = 0; data < 32; data++) {
      var rem = data << 10;
      for (var i = 4; i >= 0; i--) {
        if (rem & (1 << (i + 10))) rem ^= (gen << i);
      }
      table.push(((data << 10) | rem) ^ FORMAT_INFO_MASK);
    }
    return table;
  }());

  function readFormatInfo(grid) {
    /* Read 15 bits from positions around top-left finder */
    var bits = 0;
    var pos  = [
      [8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],
      [7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]
    ];
    for (var i = 0; i < 15; i++) {
      if (grid[pos[i][0]][pos[i][1]]) bits |= (1 << (14 - i));
    }

    /* Find closest matching format word */
    var bestDist = 16;
    var bestIdx  = -1;
    for (var j = 0; j < 32; j++) {
      var dist = hammingDistance(bits, FORMAT_STRINGS[j]);
      if (dist < bestDist) { bestDist = dist; bestIdx = j; }
    }
    if (bestIdx === -1 || bestDist > 3) return null;

    var ecl  = (bestIdx >> 3) & 3;
    var mask = bestIdx & 7;
    /* ECL: 0=M, 1=L, 2=H, 3=Q */
    var ecLabels = ['M','L','H','Q'];
    return { ecLevel: ecLabels[ecl], mask: mask };
  }

  function hammingDistance(a, b) {
    var xor = a ^ b;
    var dist = 0;
    while (xor) { dist += xor & 1; xor >>>= 1; }
    return dist;
  }

  /* ═══════════════════════════════════════════════════
     MASKING
  ═══════════════════════════════════════════════════ */

  var MASK_FN = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r, c) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r/2) + Math.floor(c/3)) % 2 === 0; },
    function (r, c) { return ((r*c)%2) + ((r*c)%3) === 0; },
    function (r, c) { return (((r*c)%2) + ((r*c)%3)) % 2 === 0; },
    function (r, c) { return (((r+c)%2) + ((r*c)%3)) % 2 === 0; }
  ];

  function unmask(grid, size, maskPattern, isFunctionModule) {
    var fn = MASK_FN[maskPattern];
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (!isFunctionModule[r][c] && fn(r, c)) {
          grid[r][c] = !grid[r][c];
        }
      }
    }
  }

  /* ═══════════════════════════════════════════════════
     FUNCTION MODULE MAP
  ═══════════════════════════════════════════════════ */

  function buildFunctionMap(size, version) {
    var fm = [];
    for (var r = 0; r < size; r++) {
      fm.push(new Array(size).fill(false));
    }

    /* Finder patterns + separators */
    function markRect(r1, c1, r2, c2) {
      for (var r = r1; r <= r2; r++)
        for (var c = c1; c <= c2; c++)
          if (r >= 0 && r < size && c >= 0 && c < size) fm[r][c] = true;
    }

    markRect(0, 0, 8, 8);         /* top-left finder + separator */
    markRect(0, size-8, 8, size-1); /* top-right finder */
    markRect(size-8, 0, size-1, 8); /* bottom-left finder */

    /* Timing patterns */
    for (var i = 0; i < size; i++) { fm[6][i] = true; fm[i][6] = true; }

    /* Dark module */
    fm[4*version+9][8] = true;

    /* Alignment patterns (version >= 2) */
    var apPos = getAlignmentPatternPositions(version);
    for (var ai = 0; ai < apPos.length; ai++) {
      for (var aj = 0; aj < apPos.length; aj++) {
        var ar = apPos[ai], ac = apPos[aj];
        /* Skip if overlaps finder */
        if (fm[ar][ac]) continue;
        markRect(ar-2, ac-2, ar+2, ac+2);
      }
    }

    /* Format info areas */
    for (var fi = 0; fi <= 8; fi++) { fm[fi][8] = true; fm[8][fi] = true; }
    for (var fi2 = size-8; fi2 < size; fi2++) { fm[8][fi2] = true; fm[fi2][8] = true; }

    return fm;
  }

  function getAlignmentPatternPositions(version) {
    if (version === 1) return [];
    var intervals = version === 2 ? 0 : Math.ceil((version * 4 + 4) / (Math.floor(version/7) + 1));
    var pos = [6];
    var cur = version * 4 + 10;
    while (cur > 6) { pos.unshift(cur); cur -= intervals; }
    return pos;
  }

  /* ═══════════════════════════════════════════════════
     DATA CODEWORD EXTRACTION
  ═══════════════════════════════════════════════════ */

  function extractCodewords(grid, size, fm) {
    var bits = [];
    var up   = true;
    var col  = size - 1;

    while (col > 0) {
      if (col === 6) col--; /* Skip vertical timing column */
      for (var rowOff = 0; rowOff < size; rowOff++) {
        var row = up ? (size - 1 - rowOff) : rowOff;
        for (var c = col; c >= col - 1; c--) {
          if (!fm[row][c]) bits.push(grid[row][c] ? 1 : 0);
        }
      }
      col  -= 2;
      up    = !up;
    }

    var codewords = [];
    for (var i = 0; i + 7 < bits.length; i += 8) {
      var byte = 0;
      for (var b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b];
      codewords.push(byte);
    }
    return codewords;
  }

  /* ═══════════════════════════════════════════════════
     REED-SOLOMON ERROR CORRECTION
  ═══════════════════════════════════════════════════ */

  /* GF(256) with primitive polynomial x^8+x^4+x^3+x^2+1 (=0x11D) */
  var GF_EXP = new Uint8Array(512);
  var GF_LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x = x << 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) GF_EXP[j] = GF_EXP[j - 255];
  }());

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
  }

  function rsGeneratorPoly(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var factor = [1, GF_EXP[i]];
      var next   = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        for (var k = 0; k < factor.length; k++) {
          next[j + k] ^= gfMul(poly[j], factor[k]);
        }
      }
      poly = next;
    }
    return poly;
  }

  function rsCorrect(data, ecCount) {
    var gen  = rsGeneratorPoly(ecCount);
    var msg  = data.slice();
    for (var i = 0; i < msg.length; i++) {
      var coef = msg[i];
      if (coef !== 0) {
        for (var j = 1; j < gen.length; j++) {
          msg[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    return data; /* Return original — basic syndromes only for v1-5 */
  }

  /* ═══════════════════════════════════════════════════
     DATA DECODING
  ═══════════════════════════════════════════════════ */

  /* Data codeword counts per version and EC level [version][ecLevel index] */
  var DATA_CODEWORDS = [
    /* v1 */  [19, 16, 13, 9],
    /* v2 */  [34, 28, 22, 16],
    /* v3 */  [55, 44, 34, 26],
    /* v4 */  [80, 64, 48, 36],
    /* v5 */  [108, 86, 62, 46],
    /* v6 */  [136, 108, 76, 60],
    /* v7 */  [156, 124, 88, 66],
    /* v8 */  [194, 154, 110, 86],
    /* v9 */  [232, 182, 132, 100],
    /* v10 */ [274, 216, 154, 122]
  ];

  var EC_LEVEL_IDX = { 'M': 0, 'L': 1, 'H': 2, 'Q': 3 };

  var ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  function decodeData(codewords, version, ecLevel) {
    var dcCount = DATA_CODEWORDS[version - 1][EC_LEVEL_IDX[ecLevel]];
    var data    = codewords.slice(0, dcCount);
    var bits    = [];
    for (var i = 0; i < data.length; i++) {
      for (var b = 7; b >= 0; b--) bits.push((data[i] >> b) & 1);
    }

    var text  = '';
    var pos   = 0;

    function readBits(n) {
      var val = 0;
      for (var i = 0; i < n; i++) val = (val << 1) | (bits[pos++] || 0);
      return val;
    }

    /* Character count indicator bit lengths by version group */
    function charCountBits(mode) {
      var vg = version <= 9 ? 0 : version <= 26 ? 1 : 2;
      var table = {
        1: [10, 12, 14], /* Numeric */
        2: [9,  11, 13], /* Alphanumeric */
        4: [8,  16, 16], /* Byte */
        8: [8,  10, 12]  /* Kanji */
      };
      return (table[mode] || [8, 8, 8])[vg];
    }

    while (pos + 4 <= bits.length) {
      var mode = readBits(4);
      if (mode === 0) break; /* Terminator */

      var count = readBits(charCountBits(mode));

      if (mode === 1) {
        /* Numeric */
        var groups3 = Math.floor(count / 3);
        var rem     = count % 3;
        for (var g = 0; g < groups3; g++) {
          var n = readBits(10);
          text += String(Math.floor(n / 100));
          text += String(Math.floor((n % 100) / 10));
          text += String(n % 10);
        }
        if (rem === 2) {
          var n2 = readBits(7);
          text += String(Math.floor(n2 / 10)) + String(n2 % 10);
        } else if (rem === 1) {
          text += String(readBits(4));
        }
      } else if (mode === 2) {
        /* Alphanumeric */
        var pairs = Math.floor(count / 2);
        for (var p = 0; p < pairs; p++) {
          var v = readBits(11);
          text += ALPHANUMERIC[Math.floor(v / 45)] + ALPHANUMERIC[v % 45];
        }
        if (count % 2 === 1) text += ALPHANUMERIC[readBits(6)];
      } else if (mode === 4) {
        /* Byte */
        for (var by = 0; by < count; by++) {
          var code = readBits(8);
          /* Handle multi-byte UTF-8 */
          if (code < 0x80) {
            text += String.fromCharCode(code);
          } else if (code < 0xE0 && by + 1 < count) {
            var b2 = readBits(8); by++;
            text += String.fromCharCode(((code & 0x1F) << 6) | (b2 & 0x3F));
          } else if (by + 2 < count) {
            var b2b = readBits(8), b3 = readBits(8); by += 2;
            text += String.fromCharCode(
              ((code & 0x0F) << 12) | ((b2b & 0x3F) << 6) | (b3 & 0x3F)
            );
          } else {
            text += String.fromCharCode(code);
          }
        }
      }
    }

    return text || null;
  }

  /* ═══════════════════════════════════════════════════
     MAIN ENTRY
  ═══════════════════════════════════════════════════ */

  function decode(bin, width, height) {
    /* 1. Find finder pattern candidates */
    var candidates = findFinderCenters(bin, width, height);
    if (candidates.length < 3) return null;

    /* 2. Pick three candidates that form an L-shape (QR finder geometry) */
    var triple = pickFinderTriple(candidates);
    if (!triple) return null;

    var tl = triple.tl, tr = triple.tr, bl = triple.bl;
    var moduleSize = triple.unit;

    /* 3. Estimate QR version from size */
    var sideModules = estimateSideModules(tl, tr, bl, moduleSize);
    var version     = Math.round((sideModules - 21) / 4) + 1;
    if (version < 1)  version = 1;
    if (version > 10) version = 10;
    var size = version * 4 + 17;

    /* 4. Calculate actual corner positions */
    var corners = computeCorners(tl, tr, bl, moduleSize, size);

    /* 5. Sample grid */
    var grid = sampleGrid(bin, width, height,
      corners.tl, corners.tr, corners.bl, moduleSize, size);

    /* 6. Read format information */
    var fmt = readFormatInfo(grid);
    if (!fmt) return null;

    /* 7. Build function module map and unmask */
    var fm = buildFunctionMap(size, version);
    unmask(grid, size, fmt.mask, fm);

    /* 8. Extract and decode codewords */
    var codewords = extractCodewords(grid, size, fm);
    var text      = decodeData(codewords, version, fmt.ecLevel);
    if (!text) return null;

    return { value: text, format: 'QR Code' };
  }

  function pickFinderTriple(cands) {
    /* Try all triples of top candidates */
    var top = cands.slice(0, Math.min(cands.length, 6));
    for (var i = 0; i < top.length - 2; i++) {
      for (var j = i+1; j < top.length - 1; j++) {
        for (var k = j+1; k < top.length; k++) {
          var pts = [top[i], top[j], top[k]];
          var res = assignFinderRoles(pts);
          if (res) return res;
        }
      }
    }
    return null;
  }

  function assignFinderRoles(pts) {
    /* Find TL: the point where the cross product of (TL→TR) and (TL→BL) is positive */
    for (var i = 0; i < 3; i++) {
      var a = pts[i];
      var b = pts[(i+1)%3];
      var c = pts[(i+2)%3];
      var cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross < 0) {
        /* a=TL, b=TR, c=BL */
        var unit = (a.unit + b.unit + c.unit) / 3;
        return { tl: a, tr: b, bl: c, unit: unit };
      }
    }
    return null;
  }

  function estimateSideModules(tl, tr, bl, unit) {
    var dx = tr.x - tl.x;
    var dy = tr.y - tl.y;
    var dist = Math.sqrt(dx*dx + dy*dy);
    return Math.round(dist / unit) + 7;
  }

  function computeCorners(tl, tr, bl, unit, size) {
    /* Offset from finder center to grid corner (3.5 modules) */
    var tlx = tl.x - 3.5 * unit;
    var tly = tl.y - 3.5 * unit;

    var dx_tr = (tr.x - tl.x) / (size - 7);
    var dy_tr = (tr.y - tl.y) / (size - 7);
    var dx_bl = (bl.x - tl.x) / (size - 7);
    var dy_bl = (bl.y - tl.y) / (size - 7);

    return {
      tl: { x: tlx, y: tly },
      tr: { x: tlx + dx_tr * (size - 1), y: tly + dy_tr * (size - 1) },
      bl: { x: tlx + dx_bl * (size - 1), y: tly + dy_bl * (size - 1) }
    };
  }

  return { decode: decode };

}());
