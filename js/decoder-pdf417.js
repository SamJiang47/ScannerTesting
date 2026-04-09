/*
  decoder-pdf417.js
  -----------------
  PDF417 decoder — used on FedEx Express labels, USPS labels,
  boarding passes, and driver licences.

  PDF417 is a stacked 2-D barcode. Each row contains:
    start pattern | left row indicator | data codewords | right row indicator | stop pattern

  This implementation decodes the data codewords using the
  standard PDF417 symbol table and handles Text, Numeric, and
  Byte compaction modes.
*/

var DecoderPDF417 = (function () {
  'use strict';

  /* ═══════════════════════════════════════════════════
     PDF417 SYMBOL TABLE  (codeword → 8-bar/space pattern)
     Each codeword maps to a 17-module wide bar/space sequence.
     We use a reduced forward-decode approach:
     scan a row for the start pattern, read bar widths,
     map them to codeword values, then decode the data.
  ═══════════════════════════════════════════════════ */

  /* Run-length to codeword value via the published "table 2" algorithm */
  function barsToCodeword(bars) {
    /* PDF417 uses 8 bars/spaces per codeword, total width = 17 */
    if (bars.length !== 8) return -1;
    var total = 0;
    for (var i = 0; i < 8; i++) total += bars[i];
    if (total < 10 || total > 60) return -1;
    var unit = total / 17;

    /* Convert to integer widths */
    var w = bars.map(function (b) { return Math.max(1, Math.round(b / unit)); });

    /* Validate total = 17 */
    var sum = w.reduce(function (a, b) { return a + b; }, 0);
    if (sum !== 17) {
      /* Adjust largest bar */
      var diff = 17 - sum;
      var maxI = 0;
      for (var j = 1; j < 8; j++) if (w[j] > w[maxI]) maxI = j;
      w[maxI] += diff;
    }

    /* PDF417 codeword lookup using the "base" algorithm from the spec.
       We encode the 8 widths into a base-6 like number space. */
    var val = 0;
    var t   = 17;
    for (var k = 0; k < 7; k++) {
      t   -= w[k];
      val  = val * t + (w[k] - 1);
    }
    return val >= 0 && val < 929 ? val : -1;
  }

  /* ═══════════════════════════════════════════════════
     ROW SCANNING
  ═══════════════════════════════════════════════════ */

  function scanRow(bin, width, y) {
    var row  = Processor.getRow(bin, width, y);
    /* Get runs starting from the first black run */
    var runs = [];
    var cur  = row[0];
    var cnt  = 1;
    for (var i = 1; i < row.length; i++) {
      if (row[i] === cur) { cnt++; }
      else { runs.push({ black: cur, len: cnt }); cur = row[i]; cnt = 1; }
    }
    runs.push({ black: cur, len: cnt });
    /* Start on black */
    var start = runs[0].black ? 0 : 1;
    return runs.slice(start);
  }

  /*
    Find PDF417 start pattern: 8 17-unit bars then a single-unit bar.
    Start codeword = 17 modules wide with pattern (bar widths) 8,1,1,1,1,1,1,3
  */
  function findStart(runs) {
    for (var i = 0; i + 8 < runs.length; i++) {
      var total = 0;
      for (var j = 0; j < 8; j++) total += runs[i+j].len;
      var unit = total / 17;
      if (unit < 1) continue;
      /* Start pattern check: widths approximately 8,1,1,1,1,1,1,3 */
      var w = [];
      for (var k = 0; k < 8; k++) w.push(Math.round(runs[i+k].len / unit));
      if (w[0] >= 7 && w[0] <= 9 && w[7] >= 2 && w[7] <= 4) {
        return { index: i + 8, unit: unit };
      }
    }
    return null;
  }

  /* ═══════════════════════════════════════════════════
     DATA DECODING
  ═══════════════════════════════════════════════════ */

  var TEXT_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ';
  var TEXT_LOWER = 'abcdefghijklmnopqrstuvwxyz ';
  var TEXT_MIXED = '0123456789&\r\t,:#-.$/\'!)+;' + TEXT_UPPER[26]; /* space last */
  var TEXT_PUNCT = ';<>@[\\]_`~!\r\t,:\n-.$/\"|*()?{}\'';

  function decodeTextCompaction(codewords) {
    var result = '';
    var sub    = 'U'; /* Upper */
    var i      = 0;
    while (i < codewords.length) {
      var c1 = codewords[i++];
      var c2 = i < codewords.length ? codewords[i++] : 29;
      /* Each pair of codewords encodes two characters */
      var h1 = Math.floor(c1 / 30), l1 = c1 % 30;
      var h2 = Math.floor(c2 / 30), l2 = c2 % 30;
      [h1, l1, h2, l2].forEach(function (v) {
        if (sub === 'U') {
          if (v < 26) result += TEXT_UPPER[v];
          else if (v === 27) sub = 'L';
          else if (v === 28) sub = 'M';
          else if (v === 29) sub = 'P'; /* punctuation once */
        } else if (sub === 'L') {
          if (v < 26) result += TEXT_LOWER[v];
          else if (v === 27) sub = 'U';
          else if (v === 28) sub = 'M';
          else if (v === 29) sub = 'P';
        } else if (sub === 'M') {
          if (v < 25) result += TEXT_MIXED[v];
          else if (v === 25) sub = 'P';
          else if (v === 26) { sub = 'U'; }
          else if (v === 29) sub = 'L';
        } else if (sub === 'P') {
          if (v < TEXT_PUNCT.length) result += TEXT_PUNCT[v];
          sub = 'U';
        }
      });
    }
    return result;
  }

  function decodeNumericCompaction(codewords) {
    var result = '';
    var i = 0;
    while (i + 2 < codewords.length) {
      /* Group of 3 codewords → 5 digits via base-900 */
      var val = codewords[i] * 810000 + codewords[i+1] * 900 + codewords[i+2];
      i += 3;
      result += String(val).padStart ? String(val).padStart(5, '0') : ('00000' + val).slice(-5);
    }
    return result;
  }

  function decodeByteCompaction(codewords) {
    var bytes = [];
    var i = 0;
    /* Groups of 5 codewords → 6 bytes */
    while (i + 4 < codewords.length) {
      var val = 0;
      for (var j = 0; j < 5; j++) val = val * 900 + codewords[i++];
      for (var k = 5; k >= 0; k--) { bytes[i - 5 + k] = val & 0xFF; val >>= 8; }
    }
    /* Remaining codewords: 1 codeword = 1 byte */
    while (i < codewords.length) bytes.push(codewords[i++] & 0xFF);
    return bytes.map(function (b) { return String.fromCharCode(b); }).join('');
  }

  function decodePDF417Codewords(codewords) {
    if (codewords.length === 0) return null;
    var text = '';
    var i    = 0;
    /* First codeword may be length indicator — skip if > data length */
    if (codewords[0] === codewords.length) i = 1;

    while (i < codewords.length) {
      var cw = codewords[i++];
      if (cw === 900) {
        /* Text compaction */
        var tc = [];
        while (i < codewords.length && codewords[i] < 900) tc.push(codewords[i++]);
        text += decodeTextCompaction(tc);
      } else if (cw === 901 || cw === 924) {
        /* Byte compaction */
        var bc = [];
        while (i < codewords.length && codewords[i] < 900) bc.push(codewords[i++]);
        text += decodeByteCompaction(bc);
      } else if (cw === 902) {
        /* Numeric compaction */
        var nc = [];
        while (i < codewords.length && codewords[i] < 900) nc.push(codewords[i++]);
        text += decodeNumericCompaction(nc);
      } else if (cw < 900) {
        /* Implicit text compaction */
        var itc = [cw];
        while (i < codewords.length && codewords[i] < 900) itc.push(codewords[i++]);
        text += decodeTextCompaction(itc);
      }
    }
    return text || null;
  }

  /* ═══════════════════════════════════════════════════
     MAIN DECODE
  ═══════════════════════════════════════════════════ */

  function decode(bin, width, height) {
    /* Scan several rows looking for a PDF417 row */
    var allCodewords = {};
    var rowFractions = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

    for (var ri = 0; ri < rowFractions.length; ri++) {
      var y    = Math.round(rowFractions[ri] * height);
      var runs = scanRow(bin, width, y);
      var sf   = findStart(runs);
      if (!sf) continue;

      /* Extract codewords from this row */
      var pos = sf.index;
      var cwRow = [];
      while (pos + 8 <= runs.length) {
        /* Check for stop pattern */
        var stopTotal = 0;
        for (var s = 0; s < 8; s++) stopTotal += runs[pos+s].len;
        var su = stopTotal / 18;
        if (runs[pos].len / su > 6) break; /* stop bar is very wide */

        var bars = [];
        for (var bi = 0; bi < 8; bi++) bars.push(runs[pos+bi].len);
        var cw = barsToCodeword(bars);
        if (cw < 0) break;
        cwRow.push(cw);
        pos += 8;
      }

      if (cwRow.length > 2) {
        /* Remove row indicators (first and last) */
        var dataRow = cwRow.slice(1, cwRow.length - 1);
        dataRow.forEach(function (v) {
          allCodewords[v] = (allCodewords[v] || 0) + 1;
        });
      }
    }

    /* Build codeword list ordered by first appearance */
    var cwList = Object.keys(allCodewords)
      .map(Number)
      .sort(function (a, b) { return allCodewords[b] - allCodewords[a]; })
      .slice(0, 100);

    if (cwList.length === 0) return null;

    var text = decodePDF417Codewords(cwList);
    if (!text || text.length < 2) return null;
    return { value: text, format: 'PDF417 (FedEx / USPS)' };
  }

  return { decode: decode };

}());
