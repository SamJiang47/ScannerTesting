/*
  camera.js
  ---------
  Manages the camera lifecycle:
    - Open rear camera via getUserMedia
    - Attach stream to the video element
    - Run a requestAnimationFrame decode loop
    - Call all three decoders on each frame
    - Expose start() and stop()
*/

var Camera = (function () {
  'use strict';

  var _stream    = null;
  var _raf       = null;
  var _running   = false;
  var _onResult  = null;
  var _onStatus  = null;

  /* ── Open camera and start loop ── */
  function start(videoEl, onResult, onStatus) {
    _onResult = onResult;
    _onStatus = onStatus;

    _onStatus('Starting camera\u2026');

    /*
      Constraints:
        - facingMode environment  → rear camera on phones
        - min + ideal widths      → never use exact, which causes
                                    OverconstrainedError on many devices
    */
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode : { ideal: 'environment' },
        width      : { min: 320, ideal: 1280 },
        height     : { min: 240, ideal: 720  }
      }
    })
    .then(function (stream) {
      _stream       = stream;
      videoEl.srcObject = stream;

      videoEl.addEventListener('loadedmetadata', function () {
        videoEl.play().then(function () {
          _running = true;
          _onStatus('Scanning\u2026  aim at any barcode or QR code');
          _loop(videoEl);
        });
      }, { once: true });
    })
    .catch(function (err) {
      var msg = 'Camera error.';
      if (err.name === 'NotAllowedError')
        msg = 'Camera access denied. Allow camera access and try again.';
      else if (err.name === 'NotFoundError')
        msg = 'No camera found on this device.';
      else if (err.name === 'NotReadableError')
        msg = 'Camera is in use by another app.';
      else if (err.name === 'OverconstrainedError')
        msg = 'Camera does not support these settings on this device.';
      else if (err.name === 'SecurityError')
        msg = 'Camera blocked. Ensure the page is served over HTTPS.';
      else
        msg = 'Camera error: ' + (err.message || err.name);
      _onStatus(msg);
    });
  }

  /* ── Stop camera and cancel loop ── */
  function stop(videoEl) {
    _running = false;

    if (_raf !== null) {
      cancelAnimationFrame(_raf);
      _raf = null;
    }

    if (_stream) {
      _stream.getTracks().forEach(function (t) { t.stop(); });
      _stream = null;
    }

    if (videoEl.srcObject) videoEl.srcObject = null;
  }

  /* ── Decode loop ── */
  function _loop(videoEl) {
    if (!_running) return;

    /* Skip frame if video not ready */
    if (videoEl.readyState < 2) {
      _raf = requestAnimationFrame(function () { _loop(videoEl); });
      return;
    }

    /* Capture and binarize frame */
    var frame = Processor.captureFrame(videoEl);
    if (frame) {
      var gray = Processor.toGrayscale(frame);
      var bin  = Processor.binarize(gray, frame.width, frame.height);

      /* Try all decoders */
      var result = Decoder1D.decode(bin, frame.width, frame.height)
                || DecoderQR.decode(bin, frame.width, frame.height)
                || DecoderPDF417.decode(bin, frame.width, frame.height);

      if (result) {
        _onResult(result.value, result.format);
      }
    }

    _raf = requestAnimationFrame(function () { _loop(videoEl); });
  }

  return { start: start, stop: stop };

}());
