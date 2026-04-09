/*
  app.js
  ------
  All scanner logic using the locally bundled ZXing library.

  Scan behaviour:
    - Press camera button → camera opens, scanning begins.
    - Code recognized → camera stops immediately, result card appears.
    - Press X → result card closes, camera restarts for next scan.
    - Press Stop Scanner at any time → fully stops, button resets.
*/

(function () {
  'use strict';

  /* ── Elements ── */
  var videoEl     = document.getElementById('video');
  var mainBtn     = document.getElementById('mainBtn');
  var btnLabel    = document.getElementById('btnLabel');
  var statusMsg   = document.getElementById('statusMsg');
  var placeholder = document.getElementById('placeholder');
  var vf          = document.getElementById('vf');
  var scanline    = document.getElementById('scanline');
  var overlay     = document.getElementById('overlay');
  var xBtn        = document.getElementById('xBtn');
  var rHeadline   = document.getElementById('rHeadline');
  var rRaw        = document.getElementById('rRaw');
  var rMeta       = document.getElementById('rMeta');

  /* ── State ── */
  var reader     = null;   /* ZXing BrowserMultiFormatReader instance */
  var isScanning = false;
  var gotResult  = false;  /* guard: only handle the very first result */

  /* ── Format names ── */
  var FORMAT_NAMES = {
    0:  'Aztec',
    1:  'Codabar',
    2:  'Code 39',
    3:  'Code 93',
    4:  'Code 128',
    5:  'Data Matrix',
    6:  'EAN-8',
    7:  'EAN-13',
    8:  'ITF (FedEx Ground)',
    9:  'MaxiCode (UPS)',
    10: 'PDF417 (FedEx / USPS)',
    11: 'QR Code',
    12: 'RSS 14',
    13: 'RSS Expanded',
    14: 'UPC-A',
    15: 'UPC-E',
    16: 'UPC/EAN Extension'
  };

  /* ══════════════════════════════════════════
     BUILD ZXING READER
     All formats enabled. TRY_HARDER is critical
     on mobile for angled or small barcodes.
  ══════════════════════════════════════════ */
  function buildReader() {
    var hints = new Map();

    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.CODE_93,
      ZXing.BarcodeFormat.PDF_417,
      ZXing.BarcodeFormat.QR_CODE,
      ZXing.BarcodeFormat.DATA_MATRIX,
      ZXing.BarcodeFormat.AZTEC,
      ZXing.BarcodeFormat.MAXICODE,
      ZXing.BarcodeFormat.ITF,
      ZXing.BarcodeFormat.CODABAR,
      ZXing.BarcodeFormat.EAN_13,
      ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.UPC_A,
      ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.RSS_14,
      ZXing.BarcodeFormat.RSS_EXPANDED
    ]);

    hints.set(ZXing.DecodeHintType.TRY_HARDER,    true);
    hints.set(ZXing.DecodeHintType.CHARACTER_SET, 'UTF-8');

    return new ZXing.BrowserMultiFormatReader(hints);
  }

  /* ══════════════════════════════════════════
     BUTTON CLICK
  ══════════════════════════════════════════ */
  mainBtn.addEventListener('click', function () {
    if (isScanning) { doStop(); } else { doStart(); }
  });

  /* ══════════════════════════════════════════
     X BUTTON
     Close card → restart camera automatically.
  ══════════════════════════════════════════ */
  xBtn.addEventListener('click', function () {
    overlay.classList.remove('visible');
    doStart();
  });

  /* ══════════════════════════════════════════
     START
  ══════════════════════════════════════════ */
  function doStart() {
    mainBtn.disabled = true;
    gotResult        = false;
    setStatus('Starting camera\u2026');

    reader = buildReader();

    /*
      decodeFromConstraints:
        - ZXing owns the full camera lifecycle internally.
        - This is the only ZXing API that works reliably on
          both Android Chrome and iOS Safari.
        - The callback fires on every frame:
            result is set when a code is found.
            err is NotFoundException on most frames (no code
            visible yet) — this is normal, not an error.
    */
    var constraints = {
      video: {
        facingMode : { ideal: 'environment' },
        width      : { min: 320, ideal: 1280 },
        height     : { min: 240, ideal: 720  }
      }
    };

    reader.decodeFromConstraints(constraints, videoEl, function (result, err) {

      /* Ignore all frames after first result */
      if (gotResult) return;

      if (result) {
        gotResult = true;

        var value  = result.getText();
        var format = result.getBarcodeFormat();
        var label  = FORMAT_NAMES[format] !== undefined
                       ? FORMAT_NAMES[format]
                       : 'Format ' + format;

        /*
          Stop the camera immediately so no more frames are
          decoded until the user dismisses the result card.
        */
        doStop(true /* silent */);

        showResult(value, label);
      }

      /*
        Silently ignore NotFoundException — it fires every frame
        where no barcode is visible, which is completely normal.
        Only log genuine unexpected errors.
      */
      if (err && !(err instanceof ZXing.NotFoundException)) {
        console.warn('ZXing error:', err);
      }
    })

    .then(function () {
      /*
        decodeFromConstraints resolved — the camera stream is live.
        Update UI to scanning state.
      */
      isScanning        = true;
      mainBtn.disabled  = false;
      mainBtn.className = 'btn btn-stop';
      btnLabel.textContent = 'Stop Scanner';
      videoEl.classList.add('live');
      placeholder.classList.add('gone');
      vf.classList.add('active');
      scanline.classList.add('active');
      setStatus('Scanning\u2026  aim at any barcode or QR code');
    })

    .catch(function (err) {
      /* Camera access error */
      isScanning       = false;
      mainBtn.disabled = false;
      reader           = null;

      var msg = 'Camera error.';
      if (err) {
        if      (err.name === 'NotAllowedError')
          msg = 'Camera access denied. Allow camera access in your browser settings and try again.';
        else if (err.name === 'NotFoundError')
          msg = 'No camera found on this device.';
        else if (err.name === 'NotReadableError')
          msg = 'Camera is in use by another app. Close it and retry.';
        else if (err.name === 'OverconstrainedError')
          msg = 'Camera cannot satisfy settings on this device.';
        else if (err.name === 'SecurityError')
          msg = 'Camera blocked. Ensure the page is served over HTTPS.';
        else
          msg = 'Camera error: ' + (err.message || err.name);
      }
      setStatus(msg);
    });
  }

  /* ══════════════════════════════════════════
     STOP
     silent = true  → internal stop after scan found,
                       keep button state neutral while
                       result card is showing.
     silent = false → user pressed Stop, full UI reset.
  ══════════════════════════════════════════ */
  function doStop(silent) {
    isScanning = false;
    gotResult  = false;

    if (reader) {
      /*
        reset() stops all media tracks and kills ZXing's
        decode loop. Always let ZXing close what it opened.
      */
      reader.reset();
      reader = null;
    }

    videoEl.classList.remove('live');
    placeholder.classList.remove('gone');
    vf.classList.remove('active');
    scanline.classList.remove('active');

    if (!silent) {
      mainBtn.disabled      = false;
      mainBtn.className     = 'btn btn-start';
      btnLabel.textContent  = 'Start Scanner';
      setStatus('Ready');
    }
  }

  /* ══════════════════════════════════════════
     SHOW RESULT CARD
  ══════════════════════════════════════════ */
  function showResult(value, label) {
    rHeadline.textContent = "Code Recognized: '" + value + "'";
    rRaw.textContent      = value;
    rMeta.textContent     = 'Format detected: ' + label;
    overlay.classList.add('visible');

    /* Reset button so it shows Start when card is visible */
    mainBtn.disabled      = false;
    mainBtn.className     = 'btn btn-start';
    btnLabel.textContent  = 'Start Scanner';
    setStatus('Code found \u2014 press \u2715 to scan again');
  }

  /* ── Helper ── */
  function setStatus(msg) { statusMsg.textContent = msg; }

}());
