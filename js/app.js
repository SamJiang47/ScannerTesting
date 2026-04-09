(function () {
  'use strict';

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

  var reader     = null;
  var camStream  = null;
  var rafHandle  = null;
  var scanning   = false;

  /*
    Offscreen canvas — we own its dimensions and draw every
    video frame to it ourselves before passing to ZXing.
    This completely bypasses ZXing's internal canvas which gets
    created with videoWidth/videoHeight at the moment the
    playing event fires — on iOS those values are 0, so ZXing's
    internal canvas stays 0x0 forever and decodes nothing.
  */
  var offCanvas = document.createElement('canvas');
  var offCtx    = offCanvas.getContext('2d');

  var FMT = {
    0:'Aztec', 1:'Codabar', 2:'Code 39', 3:'Code 93',
    4:'Code 128', 5:'Data Matrix', 6:'EAN-8', 7:'EAN-13',
    8:'ITF (FedEx Ground)', 9:'MaxiCode (UPS)',
    10:'PDF417 (FedEx / USPS)', 11:'QR Code',
    12:'RSS 14', 13:'RSS Expanded', 14:'UPC-A', 15:'UPC-E',
    16:'UPC/EAN Extension'
  };

  /* ── Build reader ── */
  function buildReader() {
    var hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.CODE_93,  ZXing.BarcodeFormat.PDF_417,
      ZXing.BarcodeFormat.QR_CODE,  ZXing.BarcodeFormat.DATA_MATRIX,
      ZXing.BarcodeFormat.AZTEC,    ZXing.BarcodeFormat.MAXICODE,
      ZXing.BarcodeFormat.ITF,      ZXing.BarcodeFormat.CODABAR,
      ZXing.BarcodeFormat.EAN_13,   ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.UPC_A,    ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.RSS_14,   ZXing.BarcodeFormat.RSS_EXPANDED
    ]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER,    true);
    hints.set(ZXing.DecodeHintType.CHARACTER_SET, 'UTF-8');
    /*
      BrowserMultiFormatReader.decodeBitmap(bitmap) calls
      MultiFormatReader.decodeWithState(bitmap) internally.
      We use decodeBitmap so we supply our own BinaryBitmap
      built from a canvas we control — bypassing ZXing's
      broken internal video→canvas path on iOS.
    */
    return new ZXing.BrowserMultiFormatReader(hints);
  }

  /* ── Buttons ── */
  mainBtn.addEventListener('click', function () {
    if (scanning) { doStop(false); } else { doStart(); }
  });

  xBtn.addEventListener('click', function () {
    overlay.classList.remove('visible');
    doStart();
  });

  /* ── Start ── */
  function doStart() {
    if (reader) { reader.reset(); reader = null; }
    scanning         = false;
    mainBtn.disabled = true;
    setStatus('Starting camera\u2026');

    reader = buildReader();

    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode : 'environment',
        width      : { min: 320, ideal: 1280 },
        height     : { min: 240, ideal: 720  }
      }
    })

    .then(function (stream) {
      camStream = stream;
      videoEl.srcObject = stream;

      videoEl.addEventListener('loadedmetadata', function onMeta() {
        videoEl.removeEventListener('loadedmetadata', onMeta);
        videoEl.play().then(function () {

          /*
            Wait until videoWidth is actually non-zero.
            On iOS, videoWidth can still be 0 immediately
            after play() resolves, so we poll until real.
          */
          function waitForDimensions() {
            if (videoEl.videoWidth > 0) {
              onCameraReady();
            } else {
              setTimeout(waitForDimensions, 50);
            }
          }
          waitForDimensions();

        }).catch(handleError);
      });
    })

    .catch(handleError);
  }

  /* Called once video dimensions are confirmed non-zero */
  function onCameraReady() {
    /* Size our canvas to match the actual video frame */
    offCanvas.width  = videoEl.videoWidth;
    offCanvas.height = videoEl.videoHeight;

    scanning          = true;
    mainBtn.disabled  = false;
    mainBtn.className = 'btn btn-stop';
    btnLabel.textContent = 'Stop Scanner';
    placeholder.classList.add('gone');
    vf.classList.add('active');
    scanline.classList.add('active');
    setStatus('Scanning\u2026  aim at any barcode or QR code');

    rafHandle = requestAnimationFrame(decodeLoop);
  }

  /* ── Decode loop ── */
  function decodeLoop() {
    if (!scanning) return;

    /* Must have a real frame */
    if (videoEl.readyState < 2 || !videoEl.videoWidth) {
      rafHandle = requestAnimationFrame(decodeLoop);
      return;
    }

    /* Re-size canvas if the stream changed resolution */
    if (offCanvas.width !== videoEl.videoWidth ||
        offCanvas.height !== videoEl.videoHeight) {
      offCanvas.width  = videoEl.videoWidth;
      offCanvas.height = videoEl.videoHeight;
    }

    /* Stamp current video frame onto our canvas */
    offCtx.drawImage(videoEl, 0, 0, offCanvas.width, offCanvas.height);

    try {
      /*
        Build a BinaryBitmap directly from our canvas pixels.
        HTMLCanvasElementLuminanceSource reads getImageData()
        from the canvas — this is the correct, iOS-safe path.
        decodeBitmap passes it to MultiFormatReader.decodeWithState().
      */
      var lum    = new ZXing.HTMLCanvasElementLuminanceSource(offCanvas);
      var bin    = new ZXing.HybridBinarizer(lum);
      var bitmap = new ZXing.BinaryBitmap(bin);
      var result = reader.decodeBitmap(bitmap);

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
      /* NotFoundException fires on every frame with no code — normal */
      if (e && e.name !== 'NotFoundException'
            && e.name !== 'ChecksumException'
            && e.name !== 'FormatException') {
        console.warn('ZXing decode error:', e.name, e.message);
      }
      rafHandle = requestAnimationFrame(decodeLoop);
    }
  }

  /* ── Stop ── */
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

    if (videoEl.srcObject) { videoEl.srcObject = null; }
    if (reader) { reader.reset(); reader = null; }

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

  /* ── Show result ── */
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

  /* ── Error handler ── */
  function handleError(err) {
    scanning         = false;
    mainBtn.disabled = false;
    reader           = null;
    camStream        = null;

    var msg = 'Camera error.';
    if (err) {
      if      (err.name === 'NotAllowedError')
        msg = 'Camera denied. On iPhone: Settings \u2192 Chrome \u2192 Camera \u2192 Allow.';
      else if (err.name === 'NotFoundError')
        msg = 'No camera found on this device.';
      else if (err.name === 'NotReadableError')
        msg = 'Camera in use by another app. Close it and retry.';
      else if (err.name === 'OverconstrainedError')
        msg = 'Camera settings not supported. Try again.';
      else if (err.name === 'SecurityError')
        msg = 'Camera blocked. Page must be served over HTTPS.';
      else
        msg = 'Error: ' + (err.message || err.name || String(err));
    }
    setStatus(msg);
  }

  function setStatus(msg) { statusMsg.textContent = msg; }

}());
