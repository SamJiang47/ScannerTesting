/*
  processor.js
  ------------
  Captures a frame from the live video element into an off-screen
  canvas, converts it to a grayscale bitmap, then applies an adaptive
  local-threshold binarization so the decoders receive a clean
  black-and-white image regardless of lighting conditions.
*/

var Processor = (function () {
  'use strict';

  /* Offscreen canvas reused every frame */
  var _canvas = null;
  var _ctx    = null;

  function ensureCanvas(w, h) {
    if (!_canvas) {
      _canvas = document.createElement('canvas');
      _ctx    = _canvas.getContext('2d');
    }
    if (_canvas.width !== w || _canvas.height !== h) {
      _canvas.width  = w;
      _canvas.height = h;
    }
  }

  /*
    captureFrame(videoEl)
    Returns { data: Uint8ClampedArray, width, height }
    where data is a flat RGBA array of the current video frame
    scaled to a fixed working width for consistent decode speed.
  */
  function captureFrame(videoEl) {
    var VW = videoEl.videoWidth;
    var VH = videoEl.videoHeight;
    if (!VW || !VH) return null;

    /* Work at 640px wide — wide enough for dense barcodes, fast enough */
    var WORK_W = 640;
    var WORK_H = Math.round(VH * (WORK_W / VW));

    ensureCanvas(WORK_W, WORK_H);
    _ctx.drawImage(videoEl, 0, 0, WORK_W, WORK_H);

    var imageData = _ctx.getImageData(0, 0, WORK_W, WORK_H);
    return { data: imageData.data, width: WORK_W, height: WORK_H };
  }

  /*
    toGrayscale(frame)
    Converts RGBA flat array to a Uint8Array of luminance values.
  */
  function toGrayscale(frame) {
    var src  = frame.data;
    var len  = frame.width * frame.height;
    var gray = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      var p = i * 4;
      /* Rec.601 luminance weights */
      gray[i] = (src[p] * 77 + src[p+1] * 150 + src[p+2] * 29) >> 8;
    }
    return gray;
  }

  /*
    binarize(gray, width, height)
    Adaptive threshold using an integral image (summed area table).
    Each pixel is thresholded against the mean of its local neighbourhood.
    Returns Uint8Array where 0 = black, 255 = white.
  */
  function binarize(gray, width, height) {
    var len       = width * height;
    var bin       = new Uint8Array(len);
    var blockSize = Math.floor(Math.min(width, height) / 8) | 0;
    if (blockSize < 8)  blockSize = 8;
    if (blockSize > 40) blockSize = 40;
    var half = blockSize >> 1;

    /* Build integral image */
    var integral = new Int32Array(len);
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var idx = y * width + x;
        var val = gray[idx];
        integral[idx] = val
          + (x > 0 ? integral[idx - 1] : 0)
          + (y > 0 ? integral[idx - width] : 0)
          - (x > 0 && y > 0 ? integral[idx - width - 1] : 0);
      }
    }

    /* Threshold each pixel against local mean */
    for (var y2 = 0; y2 < height; y2++) {
      for (var x2 = 0; x2 < width; x2++) {
        var x1 = Math.max(0, x2 - half);
        var y1 = Math.max(0, y2 - half);
        var x3 = Math.min(width  - 1, x2 + half);
        var y3 = Math.min(height - 1, y2 + half);
        var count = (x3 - x1 + 1) * (y3 - y1 + 1);
        var sum   = integral[y3 * width + x3]
                  - (x1 > 0 ? integral[y3 * width + x1 - 1] : 0)
                  - (y1 > 0 ? integral[(y1-1) * width + x3] : 0)
                  + (x1 > 0 && y1 > 0 ? integral[(y1-1)*width + x1 - 1] : 0);
        var mean  = (sum / count) | 0;
        var i2    = y2 * width + x2;
        /* Slight bias: require pixel to be meaningfully below mean */
        bin[i2] = gray[i2] < (mean - 5) ? 0 : 255;
      }
    }

    return bin;
  }

  /*
    getRow(bin, width, y)
    Returns a boolean array for a single horizontal scanline.
    true = black module, false = white.
  */
  function getRow(bin, width, y) {
    var row   = new Array(width);
    var base  = y * width;
    for (var x = 0; x < width; x++) {
      row[x] = bin[base + x] === 0;
    }
    return row;
  }

  /*
    getColumn(bin, width, height, x)
    Returns a boolean array for a single vertical scanline.
  */
  function getColumn(bin, width, height, x) {
    var col = new Array(height);
    for (var y = 0; y < height; y++) {
      col[y] = bin[y * width + x] === 0;
    }
    return col;
  }

  return {
    captureFrame : captureFrame,
    toGrayscale  : toGrayscale,
    binarize     : binarize,
    getRow       : getRow,
    getColumn    : getColumn
  };

}());
