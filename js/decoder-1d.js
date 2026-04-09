/*
  decoder-1d.js
  -------------
  Pure-JS decoder for all requested 1-D barcode symbologies:
    Code 128  (UPS, FedEx, USPS standard tracking)
    Code 39
    Code 93
    ITF-14    (FedEx Ground)
    EAN-13
    EAN-8
    UPC-A
    UPC-E
    Codabar

  Strategy
  --------
  1. Sample multiple horizontal rows across the image.
  2. For each row, compute a run-length array of alternating
     black/white run widths.
  3. Pass the run-length array to each symbology decoder.
  4. Return the first successful decode.
*/

var Decoder1D = (function () {
  'use strict';

  /* ═══════════════════════════════════════════════════
     UTILITY
  ═══════════════════════════════════════════════════ */

  /*
    runLengths(row)
    Converts boolean pixel row into an array of integer run widths.
    e.g. [T,T,T,F,F,T] → [3,2,1]  (black=3, white=2, black=1)
    Always starts with the first run (black or white).
  */
  function runLengths(row) {
    var runs   = [];
    var count  = 1;
    for (var i = 1; i < row.length; i++) {
      if (row[i] === row[i-1]) {
        count++;
      } else {
        runs.push(count);
        count = 1;
      }
    }
    runs.push(count);
    /* Drop leading/trailing white runs — start/end on black */
    var start = row[0] ? 0 : 1;
    var end   = row[row.length-1] ? runs.length : runs.length - 1;
    return runs.slice(start, end);
  }

  /* Normalise a window of run-lengths to unit widths */
  function normalise(runs, count) {
    var total = 0;
    for (var i = 0; i < count; i++) total += runs[i];
    var unit = total / count;
    var norm = [];
    for (var j = 0; j < count; j++) {
      norm.push(Math.round(runs[j] / unit));
    }
    return norm;
  }

  /* ═══════════════════════════════════════════════════
     CODE 128
  ═══════════════════════════════════════════════════ */

  /* Code 128 value table indexed 0-106 */
  var C128_CHARS = (function () {
    var t = [];
    /* Values 0-94 map to ASCII 32-126 in Code B */
    for (var i = 0; i <= 94; i++) t.push(String.fromCharCode(32 + i));
    /* 95-107 are control symbols */
    t.push('\xc3'); /* FNC3  */
    t.push('\xc2'); /* FNC2  */
    t.push('\xc1'); /* SHIFT */
    t.push('\xc4'); /* CODE C*/
    t.push('\xc5'); /* CODE B*/
    t.push('\xc6'); /* FNC4  */
    t.push('\xc0'); /* CODE A*/
    t.push('\xc7'); /* FNC1  */
    t.push('\xc8'); /* START A */
    t.push('\xc9'); /* START B */
    t.push('\xca'); /* START C */
    t.push('\xcb'); /* STOP   */
    return t;
  }());

  /*
    Code 128 bar patterns: each symbol is 6 elements (3 bars + 3 spaces)
    encoded as widths 1-4.  Standard published table.
  */
  var C128_PATTERNS = [
    [2,1,2,2,2,2],[2,2,2,1,2,2],[2,2,2,2,2,1],[1,2,1,2,2,3],
    [1,2,1,3,2,2],[1,3,1,2,2,2],[1,2,2,2,1,3],[1,2,2,3,1,2],
    [1,3,2,2,1,2],[2,2,1,2,1,3],[2,2,1,3,1,2],[2,3,1,2,1,2],
    [1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,2,3,1],[1,1,3,2,2,2],
    [1,2,3,1,2,2],[1,2,3,2,2,1],[2,2,3,2,1,1],[2,2,1,1,3,2],
    [2,2,1,2,3,1],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],
    [3,1,1,2,2,2],[3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],
    [3,2,2,1,1,2],[3,2,2,2,1,1],[2,1,2,1,2,3],[2,1,2,3,2,1],
    [2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,2,3],[1,3,1,3,2,1],
    [1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],
    [2,3,1,1,1,3],[2,3,1,3,1,1],[1,1,2,1,3,3],[1,1,2,3,3,1],
    [1,3,2,1,3,1],[1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],
    [3,1,3,1,2,1],[2,1,1,3,3,1],[2,3,1,1,3,1],[2,1,3,1,1,3],
    [2,1,3,3,1,1],[2,1,3,1,3,1],[3,1,1,1,2,3],[3,1,1,3,2,1],
    [3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],[3,3,2,1,1,1],
    [3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],
    [1,1,1,4,2,2],[1,2,1,1,2,4],[1,2,1,4,2,1],[1,4,1,1,2,2],
    [1,4,1,2,2,1],[1,1,2,2,1,4],[1,1,2,4,1,2],[1,2,2,1,1,4],
    [1,2,2,4,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],[2,4,1,2,1,1],
    [2,2,1,1,1,4],[4,1,3,1,1,1],[2,4,1,1,1,2],[1,3,4,1,1,1],
    [1,1,1,2,4,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,1,4,2,1,2],
    [1,2,4,1,1,2],[1,2,4,2,1,1],[4,1,1,2,1,2],[4,2,1,1,1,2],
    [4,2,1,2,1,1],[2,1,2,1,4,1],[2,1,4,1,2,1],[4,1,2,1,2,1],
    [1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],[1,1,4,1,1,3],
    [1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,1,3,1,4,1],
    [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1],[2,1,1,4,1,2],
    [2,1,1,2,1,4],[2,1,1,2,3,2],[2,3,3,1,1,1]
  ];

  /* Reverse-lookup: pattern string → value index */
  var C128_MAP = (function () {
    var m = {};
    C128_PATTERNS.forEach(function (p, i) { m[p.join('')] = i; });
    return m;
  }());

  function matchC128Symbol(runs, offset) {
    if (offset + 6 > runs.length) return -1;
    var total = 0;
    for (var i = 0; i < 6; i++) total += runs[offset + i];
    var unit  = total / 11;
    var key   = '';
    for (var j = 0; j < 6; j++) {
      var w = Math.round(runs[offset + j] / unit);
      if (w < 1 || w > 4) return -1;
      key += w;
    }
    var v = C128_MAP[key];
    return v !== undefined ? v : -1;
  }

  function decodeCode128(runs) {
    /* Find START A/B/C: values 103/104/105 */
    for (var s = 0; s <= runs.length - 13; s++) {
      var sv = matchC128Symbol(runs, s);
      if (sv !== 103 && sv !== 104 && sv !== 105) continue;

      var mode = sv === 103 ? 'A' : sv === 104 ? 'B' : 'C';
      var pos  = s + 6;
      var text = '';
      var vals = [];

      while (pos + 6 <= runs.length) {
        var v = matchC128Symbol(runs, pos);
        if (v === -1) break;
        vals.push(v);
        pos += 6;

        /* STOP symbol */
        if (v === 106) {
          if (vals.length < 2) break;
          /* Verify checksum */
          var check = sv;
          for (var ci = 0; ci < vals.length - 1; ci++) {
            check += vals[ci] * (ci + 1);
          }
          if ((check % 103) !== vals[vals.length - 2]) break;

          /* Decode payload */
          for (var di = 0; di < vals.length - 2; di++) {
            var val = vals[di];
            if (val >= 100 && val <= 102) {
              /* Code switch / FNC — handle mode changes */
              if (val === 100) mode = 'B';
              if (val === 101) mode = 'A';
              if (val === 99)  mode = 'C';
              continue;
            }
            if (mode === 'C') {
              text += (val < 10 ? '0' : '') + val;
            } else {
              text += C128_CHARS[val] || '';
            }
          }
          return text.replace(/[\xc0-\xcb]/g, '');
        }
      }
    }
    return null;
  }

  /* ═══════════════════════════════════════════════════
     CODE 39
  ═══════════════════════════════════════════════════ */

  var C39_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%*';

  /* Code 39: 9 elements per char (5 bars + 4 spaces), wide=2 narrow=1 */
  var C39_PATTERNS = [
    '101001101101','110100110101','101100110101','110110011010',
    '101001110101','110100111010','101100111010','101001011011',
    '110100101101','101100101101','110010110101','100110110101',
    '110011011010','100101110101','110010111010','100110111010',
    '100101011011','110010101101','100110101101','100111010101', /* 0-19 */
    '101001101011','110100110100','101100110100','110110011000', /* 20-23 */
    '101001110100','110100111000','101100111000','101001011010', /* 24-27 */
    '110100101100','101100101100','110010110100','100110110100', /* 28-31 */
    '110011011000','100101110100','110010111000','100110111000', /* 32-35 */
    '100101011010','110010101100','100110101100','100101101011', /* 36-39 */
    '101101001011','101101100101','101101101001','101011001011'  /* 40-43 */
  ];

  var C39_MAP = (function () {
    var m = {};
    C39_PATTERNS.forEach(function (p, i) { m[p] = C39_CHARS[i]; });
    return m;
  }());

  function decodeCode39(runs) {
    /* Each character uses 9 runs + 1 inter-character gap = 10 runs */
    if (runs.length < 10) return null;
    var text = '';
    var i    = 0;
    while (i + 9 <= runs.length) {
      /* Determine narrow unit from first 9 runs */
      var total = 0;
      for (var k = 0; k < 9; k++) total += runs[i + k];
      /* Code 39 character total widths: narrow=3+6=9, wide varies 12-16 */
      var unit = total / 12;
      var key  = '';
      for (var j = 0; j < 9; j++) {
        key += runs[i + j] / unit < 1.7 ? '0' : '1';
      }
      /* Map to character */
      var ch = null;
      for (var pi = 0; pi < C39_PATTERNS.length; pi++) {
        var pat = C39_PATTERNS[pi];
        /* Compare as wide/narrow pattern */
        var match = true;
        var ptot  = 0;
        for (var pk = 0; pk < 9; pk++) ptot += runs[i + pk];
        var pu = ptot / 12;
        for (var pm = 0; pm < 9; pm++) {
          var isWide = runs[i + pm] / pu >= 1.7;
          if ((isWide ? '1' : '0') !== pat[pm * 2]) { match = false; break; }
        }
        if (match) { ch = C39_CHARS[pi]; break; }
      }
      if (ch === null) return null;
      if (ch !== '*') text += ch;
      i += 10; /* skip inter-char gap */
    }
    if (text.length === 0) return null;
    return text;
  }

  /* ═══════════════════════════════════════════════════
     CODE 93
  ═══════════════════════════════════════════════════ */

  var C93_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';

  var C93_PATTERNS = [
    '131112','111213','111312','111411','121113',
    '121212','121311','111114','131211','141111',
    '211113','211212','211311','221112','221211',
    '231111','112113','112212','112311','122112',
    '132111','111123','111222','111321','121122',
    '131121','212112','212211','211122','211221',
    '221121','222111','112122','112221','122121',
    '123111','121131','311112','311211','321111',
    '112131','113121','211131','121221','312111',
    '311121','122211'
  ];

  var C93_MAP = (function () {
    var m = {};
    C93_PATTERNS.forEach(function (p, i) { m[p] = C93_CHARS[i]; });
    /* Start/stop */
    m['111141'] = 'START';
    m['1111411'] = 'STOP';
    return m;
  }());

  function decodeCode93(runs) {
    if (runs.length < 6) return null;
    /* Find START pattern 111141 */
    var si = -1;
    for (var s = 0; s <= runs.length - 6; s++) {
      var n = matchC93(runs, s);
      if (n === 'START') { si = s + 6; break; }
    }
    if (si === -1) return null;

    var text = '';
    var i    = si;
    while (i + 6 <= runs.length) {
      var sym = matchC93(runs, i);
      if (sym === null) return null;
      if (sym === 'STOP') break;
      text += sym;
      i += 6;
    }
    /* Remove last two checksum characters */
    if (text.length < 2) return null;
    return text.slice(0, -2);
  }

  function matchC93(runs, offset) {
    var total = 0;
    for (var i = 0; i < 6; i++) total += runs[offset + i];
    var unit = total / 9;
    var key  = '';
    for (var j = 0; j < 6; j++) {
      var w = Math.round(runs[offset + j] / unit);
      if (w < 1 || w > 4) return null;
      key += w;
    }
    return C93_MAP[key] || null;
  }

  /* ═══════════════════════════════════════════════════
     ITF (Interleaved 2 of 5) — FedEx Ground uses ITF-14
  ═══════════════════════════════════════════════════ */

  /* ITF: 5 bars per digit, wide=2/narrow=1, pairs interleaved */
  var ITF_PATTERNS = {
    '00110': '0', '10001': '1', '01001': '2', '11000': '3',
    '00101': '4', '10100': '5', '01100': '6', '00011': '7',
    '10010': '8', '01010': '9'
  };

  function decodeITF(runs) {
    if (runs.length < 10) return null;
    /* Skip start guard: narrow-narrow-narrow-narrow (4 narrows) */
    var unit = runs[0]; /* first narrow bar approximates unit */
    var i    = 4;       /* skip start guard */
    var text = '';

    while (i + 10 <= runs.length - 3) { /* -3 for stop guard */
      /* Decode a pair of digits: 10 runs = 5 bar widths + 5 space widths interleaved */
      var bars   = [runs[i], runs[i+2], runs[i+4], runs[i+6], runs[i+8]];
      var spaces = [runs[i+1], runs[i+3], runs[i+5], runs[i+7], runs[i+9]];

      var bkey = '';
      var skey = '';
      for (var k = 0; k < 5; k++) {
        bkey += bars[k]   / unit >= 1.7 ? '1' : '0';
        skey += spaces[k] / unit >= 1.7 ? '1' : '0';
      }

      var bd = ITF_PATTERNS[bkey];
      var sd = ITF_PATTERNS[skey];
      if (!bd || !sd) return null;
      text += bd + sd;
      i += 10;
    }

    if (text.length === 0) return null;
    return text;
  }

  /* ═══════════════════════════════════════════════════
     EAN-13 / EAN-8 / UPC-A / UPC-E
  ═══════════════════════════════════════════════════ */

  /* L-code patterns (binary, bar widths 1-4) */
  var EAN_L = [
    [3,2,1,1],[2,2,2,1],[2,1,2,2],[1,4,1,1],[1,1,3,2],
    [1,2,3,1],[1,1,1,4],[1,3,1,2],[1,2,1,3],[3,1,1,2]
  ];
  /* G-code (reversed L) */
  var EAN_G = EAN_L.map(function (p) { return p.slice().reverse(); });
  /* R-code (complement of L) */
  var EAN_R = EAN_L.map(function (p) {
    return p.map(function (v, i) { return i % 2 === 0 ? v : v; });
  });

  /* First-digit parity patterns for EAN-13 */
  var EAN13_FIRST = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG',
                     'LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];

  function matchEANDigit(runs, offset, unit) {
    var total = 0;
    for (var i = 0; i < 4; i++) total += runs[offset + i];
    var u = total / 7;
    var pattern = [];
    for (var j = 0; j < 4; j++) {
      pattern.push(Math.round(runs[offset + j] / u));
    }
    for (var d = 0; d < 10; d++) {
      if (arrEq(pattern, EAN_L[d])) return { digit: d, type: 'L' };
      if (arrEq(pattern, EAN_G[d])) return { digit: d, type: 'G' };
      if (arrEq(pattern, EAN_R[d])) return { digit: d, type: 'R' };
    }
    return null;
  }

  function arrEq(a, b) {
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function decodeEAN13(runs) {
    if (runs.length < 59) return null;
    /* Start guard: 1,1,1 */
    var i = 3;
    var digits = [];
    var types  = [];

    /* Left 6 digits */
    for (var d = 0; d < 6; d++) {
      var m = matchEANDigit(runs, i, 1);
      if (!m) return null;
      digits.push(m.digit);
      types.push(m.type);
      i += 4;
    }
    /* Centre guard: 1,1,1,1,1 */
    i += 5;
    /* Right 6 digits */
    for (var d2 = 0; d2 < 6; d2++) {
      var m2 = matchEANDigit(runs, i, 1);
      if (!m2) return null;
      digits.push(m2.digit);
      i += 4;
    }
    /* Determine first digit from parity pattern */
    var parity = types.join('');
    var first  = EAN13_FIRST.indexOf(parity);
    if (first === -1) return null;

    var result = String(first) + digits.join('');
    /* Checksum */
    if (!eanChecksum(result)) return null;
    return result;
  }

  function decodeEAN8(runs) {
    if (runs.length < 43) return null;
    var i      = 3;
    var digits = [];
    for (var d = 0; d < 4; d++) {
      var m = matchEANDigit(runs, i, 1);
      if (!m || m.type !== 'L') return null;
      digits.push(m.digit);
      i += 4;
    }
    i += 5;
    for (var d2 = 0; d2 < 4; d2++) {
      var m2 = matchEANDigit(runs, i, 1);
      if (!m2 || m2.type !== 'R') return null;
      digits.push(m2.digit);
      i += 4;
    }
    var result = digits.join('');
    if (!eanChecksum(result)) return null;
    return result;
  }

  function eanChecksum(s) {
    var sum = 0;
    for (var i = 0; i < s.length - 1; i++) {
      sum += parseInt(s[i]) * (i % 2 === 0 ? 1 : 3);
    }
    var check = (10 - (sum % 10)) % 10;
    return check === parseInt(s[s.length - 1]);
  }

  /* ═══════════════════════════════════════════════════
     CODABAR
  ═══════════════════════════════════════════════════ */

  var CODABAR_CHARS = '0123456789-$:/.+ABCD';
  var CODABAR_PATTERNS = [
    '0000011','0000110','0001001','1100000','0010010',
    '1000010','0100001','0100100','0110000','1001000',
    '0001100','0011000','1000101','1010001','1010100',
    '0010101','0000111','0100011','0001011','0001110',
    '1001001','1100100','0101100','1100001'  /* A B C D */
  ];

  function decodeCodabar(runs) {
    if (runs.length < 7) return null;
    var i    = 0;
    var text = '';
    while (i + 7 <= runs.length) {
      var total = 0;
      for (var k = 0; k < 7; k++) total += runs[i + k];
      var unit = total / 10;
      var key  = '';
      for (var j = 0; j < 7; j++) {
        key += runs[i + j] / unit >= 1.7 ? '1' : '0';
      }
      var idx = CODABAR_PATTERNS.indexOf(key);
      if (idx === -1) return null;
      text += CODABAR_CHARS[idx];
      i += 8; /* 7 bars + 1 inter-char gap */
    }
    if (text.length < 2) return null;
    return text;
  }

  /* ═══════════════════════════════════════════════════
     MAIN DECODE — try all symbologies on multiple rows
  ═══════════════════════════════════════════════════ */

  function decode(bin, width, height) {
    /* Sample rows at 25%, 40%, 50%, 60%, 75% of image height */
    var rowFractions = [0.25, 0.35, 0.45, 0.50, 0.55, 0.65, 0.75];

    for (var ri = 0; ri < rowFractions.length; ri++) {
      var y   = Math.round(rowFractions[ri] * height);
      var row = Processor.getRow(bin, width, y);
      var rl  = runLengths(row);
      if (rl.length < 6) continue;

      var result;

      result = decodeCode128(rl);
      if (result) return { value: result, format: 'Code 128' };

      result = decodeCode39(rl);
      if (result) return { value: result, format: 'Code 39' };

      result = decodeCode93(rl);
      if (result) return { value: result, format: 'Code 93' };

      result = decodeITF(rl);
      if (result) return { value: result, format: 'ITF (FedEx Ground)' };

      result = decodeEAN13(rl);
      if (result) return { value: result, format: 'EAN-13' };

      result = decodeEAN8(rl);
      if (result) return { value: result, format: 'EAN-8' };

      result = decodeCodabar(rl);
      if (result) return { value: result, format: 'Codabar' };
    }

    return null;
  }

  return { decode: decode };

}());
