/*
  app.js
  ------
  Uses decodeOnceFromConstraints — the ONLY single-scan ZXing method
  that exists in this build and works reliably on iPhone Chrome/Safari.

  decodeFromCanvas does NOT exist in this ZXing build.
  decodeFromConstraints (continuous) has callback issues on iOS WebKit.
  decodeOnceFromConstraints resolves with the first code found and is
  the correct API for one-scan-at-a-time behaviour.
*/

(function () {
  'use strict';

  /* ── DOM ── */
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
  var reader     = null;
  var isScanning = false;

  /* ── Format labels ── */
  var FMT = {
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

  /* ══════════════════════════════════════
     VERIFY ZXING LOADED
  ══════════════════════════════════════ */
  if (typeof ZXing === 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      setStatus('ERROR: ZXing failed to load. Check js/zxing.min.js exists in repo.');
      mainBtn.disabled = true;
    });
    return;
  }

  /* ══════════════════════════════════════
     BUILD READER
  ══════════════════════════════════════ */
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

  /* ══════════════════════════════════════
     BUTTON
  ══════════════════════════════════════ */
  mainBtn.addEventListener('click', function () {
    if (isScanning) { doStop(false); } else { doStart(); }
  });

  /* ══════════════════════════════════════
     X BUTTON — close card + restart
  ══════════════════════════════════════ */
  xBtn.addEventListener('click', function () {
    overlay.classList.remove('visible');
    doStart();
  });

  /* ══════════════════════════════════════
     START
  ══════════════════════════════════════ */
  function doStart() {
    /* Clean up any leftover reader from a previous session */
    if (reader) { reader.reset(); reader = null; }

    isScanning       = false;
    mainBtn.disabled = true;
    setStatus('Starting camera\u2026');

    reader = buildReader();

    /*
      Show the camera feed once the first frame is actually rendered.
      loadeddata fires after the first frame is available — safer than
      loadedmetadata on iOS which fires before pixels are ready.
    */
    function onFirstFrame() {
      videoEl.removeEventListener('loadeddata', onFirstFrame);
      isScanning        = true;
      mainBtn.disabled  = false;
      mainBtn.className = 'btn btn-stop';
      btnLabel.textContent = 'Stop Scanner';
      placeholder.classList.add('gone');
      vf.classList.add('active');
      scanline.classList.add('active');
      setStatus('Scanning\u2026  aim at any barcode or QR code');
    }

    videoEl.addEventListener('loadeddata', onFirstFrame);

    /*
      decodeOnceFromConstraints:
        - This is the method that actually exists in this ZXing build.
        - ZXing calls getUserMedia internally, attaches the stream to
          the video element, calls play(), and runs the decode loop.
        - It resolves with the first Result found, then stops.
        - facingMode as a plain string (not object) is more reliable
          for rear camera selection on iPhone.
        - No exact width/height — ideal only, to avoid
          OverconstrainedError on devices that reject exact values.
    */
    var constraints = {
      video: {
        facingMode : 'environment',
        width      : { min: 320, ideal: 1920 },
        height     : { min: 240, ideal: 1080 }
      }
    };

    reader.decodeOnceFromConstraints(constraints, videoEl)

      .then(function (result) {
        /* Remove the frame listener in case it hasn't fired yet */
        videoEl.removeEventListener('loadeddata', onFirstFrame);

        var value = result.getText();
        var fmt   = result.getBarcodeFormat();
        var label = FMT[fmt] !== undefined ? FMT[fmt] : 'Format ' + fmt;

        /* Stop camera before showing result */
        doStop(true /* silent */);
        showResult(value, label);
      })

      .catch(function (err) {
        videoEl.removeEventListener('loadeddata', onFirstFrame);

        /*
          If isScanning is false the user pressed Stop Scanner,
          which called reader.reset() — not a real error.
        */
        if (!isScanning) return;

        isScanning = false;
        handleError(err);
      });
  }

  /* ══════════════════════════════════════
     STOP
     silent = true  → after successful scan, keep button neutral
     silent = false → user pressed Stop, full reset
  ══════════════════════════════════════ */
  function doStop(silent) {
    isScanning = false;

    if (reader) {
      /*
        reset() stops all media tracks ZXing opened and kills the
        decode loop. Always let ZXing close what it opened.
      */
      reader.reset();
      reader = null;
    }

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

  /* ══════════════════════════════════════
     SHOW RESULT CARD
  ══════════════════════════════════════ */
  function showResult(value, label) {
    rHeadline.textContent = "Code Recognized: '" + value + "'";
    rRaw.textContent      = value;
    rMeta.textContent     = 'Format detected: ' + label;
    overlay.classList.add('visible');

    mainBtn.disabled      = false;
    mainBtn.className     = 'btn btn-start';
    btnLabel.textContent  = 'Start Scanner';
    setStatus('Code found \u2014 press \u2715 to scan again');
  }

  /* ══════════════════════════════════════
     ERROR HANDLER
  ══════════════════════════════════════ */
  function handleError(err) {
    isScanning       = false;
    mainBtn.disabled = false;
    reader           = null;

    var msg = 'Camera error.';
    if (err) {
      if (err.name === 'NotAllowedError')
        msg = 'Camera denied. On iPhone: Settings \u2192 Chrome \u2192 Camera \u2192 Allow.';
      else if (err.name === 'NotFoundError')
        msg = 'No camera found on this device.';
      else if (err.name === 'NotReadableError')
        msg = 'Camera in use by another app. Close it and retry.';
      else if (err.name === 'OverconstrainedError')
        msg = 'Camera settings not supported. Try again.';
      else if (err.name === 'SecurityError')
        msg = 'Camera blocked. Page must be served over HTTPS.';
      else if (err.name === 'NotFoundException')
        msg = 'No code found. Try again with better lighting.';
      else
        msg = 'Error: ' + (err.message || err.name || String(err));
    }
    setStatus(msg);
  }

  function setStatus(msg) { statusMsg.textContent = msg; }

}());
