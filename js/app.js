/*
  app.js
  ------
  iOS WebKit (iPhone Chrome / Safari) compatible barcode scanner.

  Root cause of previous failures:
    iOS WebKit requires the <video> element to be fully visible
    and rendered with real pixel dimensions before drawImage(video)
    on a canvas returns actual pixel data. If the video is hidden
    in any way, drawImage returns a black frame and ZXing sees
    nothing to decode.

  Fix:
    - <video> is never hidden — it always sits in the DOM with full
      dimensions.
    - The placeholder div covers the video with a solid background
      and is removed (opacity 0) once the camera is live.
    - drawImage therefore always captures real camera pixels.

  iOS additional requirements honoured here:
    - video.play() called inside a user-gesture promise chain
    - video has autoplay muted playsinline attributes (set in HTML)
    - getUserMedia constraints use ideal not exact to avoid
      OverconstrainedError on iPhones
    - Canvas dimensions set from videoWidth/videoHeight after
      loadedmetadata fires, not before
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
  var reader    = null;
  var camStream = null;
  var rafHandle = null;
  var scanning  = false;

  /* ── Offscreen canvas for ZXing ── */
  var offCanvas = document.createElement('canvas');
  var offCtx    = offCanvas.getContext('2d');

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

  /* ════════════════════════════════════
     BUILD ZXING READER
  ════════════════════════════════════ */
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

  /* ════════════════════════════════════
     BUTTON
  ════════════════════════════════════ */
  mainBtn.addEventListener('click', function () {
    if (scanning) { doStop(false); } else { doStart(); }
  });

  /* ════════════════════════════════════
     X BUTTON  — close card + restart
  ════════════════════════════════════ */
  xBtn.addEventListener('click', function () {
    overlay.classList.remove('visible');
    doStart();
  });

  /* ════════════════════════════════════
     START
  ════════════════════════════════════ */
  function doStart() {
    mainBtn.disabled = true;
    setStatus('Starting camera\u2026');

    reader = buildReader();

    /*
      Do NOT use exact width/height — iOS rejects them.
      ideal lets WebKit pick the closest supported mode.
    */
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode : { ideal: 'environment' },
        width      : { min: 320, ideal: 1920 },
        height     : { min: 240, ideal: 1080 }
      }
    })

    .then(function (stream) {
      camStream         = stream;
      videoEl.srcObject = stream;

      videoEl.addEventListener('loadedmetadata', function () {

        /*
          Set canvas to real video dimensions AFTER loadedmetadata.
          On iOS, videoWidth/videoHeight are 0 before this event.
        */
        offCanvas.width  = videoEl.videoWidth;
        offCanvas.height = videoEl.videoHeight;

        /*
          iOS requires play() to be called from within a user-gesture
          chain. We are inside a .then() originating from a button
          click, so this satisfies the requirement.
        */
        videoEl.play()

          .then(function () {
            scanning          = true;
            mainBtn.disabled  = false;
            mainBtn.className = 'btn btn-stop';
            btnLabel.textContent = 'Stop Scanner';

            /*
              Show camera feed — just hide the placeholder.
              The video itself has always been visible to WebKit.
            */
            placeholder.classList.add('gone');
            vf.classList.add('active');
            scanline.classList.add('active');
            setStatus('Scanning\u2026  aim at any barcode or QR code');

            rafHandle = requestAnimationFrame(decodeLoop);
          })

          .catch(handleError);

      }, { once: true });
    })

    .catch(handleError);
  }

  /* ════════════════════════════════════
     DECODE LOOP
     ~60 fps on iPhone.
     Each tick: copy video frame → canvas,
     ask ZXing to decode the canvas pixels.
  ════════════════════════════════════ */
  function decodeLoop() {
    if (!scanning) return;

    /*
      readyState 4 = HAVE_ENOUGH_DATA
      Use the strictest ready-state on iOS to ensure
      the frame is fully populated before we copy it.
    */
    if (videoEl.readyState < 4) {
      rafHandle = requestAnimationFrame(decodeLoop);
      return;
    }

    /*
      Stamp current video frame onto the offscreen canvas.
      Because the video element is always visible (not hidden),
      iOS WebKit gives us real pixels here.
    */
    offCtx.drawImage(videoEl, 0, 0, offCanvas.width, offCanvas.height);

    try {
      var result = reader.decodeFromCanvas(offCanvas);

      if (result) {
        scanning = false;
        cancelAnimationFrame(rafHandle);
        rafHandle = null;

        var value = result.getText();
        var fmt   = FMT[result.getBarcodeFormat()] || 'Unknown';

        doStop(true);
        showResult(value, fmt);
      }

    } catch (e) {
      /*
        NotFoundException on every empty frame — totally normal.
        ChecksumException / FormatException are also non-fatal.
        Only log genuinely unexpected errors.
      */
      if (e && e.name !== 'NotFoundException'
            && e.name !== 'ChecksumException'
            && e.name !== 'FormatException') {
        console.warn('ZXing:', e.name, e.message);
      }
      rafHandle = requestAnimationFrame(decodeLoop);
    }
  }

  /* ════════════════════════════════════
     STOP
  ════════════════════════════════════ */
  function doStop(silent) {
    scanning = false;

    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }

    if (camStream) {
      camStream.getTracks().forEach(function (t) { t.stop(); });
      camStream = null;
    }

    videoEl.srcObject = null;
    reader            = null;

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

  /* ════════════════════════════════════
     SHOW RESULT CARD
  ════════════════════════════════════ */
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

  /* ════════════════════════════════════
     ERROR HANDLER
  ════════════════════════════════════ */
  function handleError(err) {
    scanning         = false;
    mainBtn.disabled = false;
    reader           = null;
    camStream        = null;

    var msg = 'Camera error.';
    if (err) {
      if      (err.name === 'NotAllowedError')
        msg = 'Camera access denied. Go to iPhone Settings \u2192 Chrome \u2192 Camera and allow access.';
      else if (err.name === 'NotFoundError')
        msg = 'No camera found.';
      else if (err.name === 'NotReadableError')
        msg = 'Camera in use by another app.';
      else if (err.name === 'OverconstrainedError')
        msg = 'Camera settings not supported on this device.';
      else if (err.name === 'SecurityError')
        msg = 'Camera blocked. The page must be served over HTTPS.';
      else
        msg = 'Camera error: ' + (err.message || err.name);
    }
    setStatus(msg);
  }

  function setStatus(msg) { statusMsg.textContent = msg; }

}());
