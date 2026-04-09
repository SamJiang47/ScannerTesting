/*
  app.js
  ------
  UI logic: wires the button, camera, and result card together.
*/

(function () {
  'use strict';

  var isScanning  = false;
  var lastValue   = null;
  var cooldownTmr = null;
  var COOLDOWN    = 2500;

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

  /* ── Button click ── */
  mainBtn.addEventListener('click', function () {
    if (isScanning) { doStop(); } else { doStart(); }
  });

  /* ── X button closes result card ── */
  xBtn.addEventListener('click', function () {
    overlay.classList.remove('visible');
  });

  /* ── Start ── */
  function doStart() {
    mainBtn.disabled = true;

    Camera.start(
      videoEl,

      /* onResult */
      function (value, format) {
        if (value === lastValue) return;
        lastValue = value;
        clearTimeout(cooldownTmr);
        cooldownTmr = setTimeout(function () { lastValue = null; }, COOLDOWN);
        showResult(value, format);
      },

      /* onStatus */
      function (msg) {
        statusMsg.textContent = msg;

        /* Detect that camera came live */
        if (msg.indexOf('Scanning') === 0) {
          isScanning = true;
          mainBtn.disabled  = false;
          mainBtn.className = 'btn btn-stop';
          btnLabel.textContent = 'Stop Scanner';
          videoEl.classList.add('live');
          placeholder.classList.add('gone');
          vf.classList.add('active');
          scanline.classList.add('active');
        }

        /* Detect error */
        if (msg.indexOf('error') !== -1 || msg.indexOf('denied') !== -1 ||
            msg.indexOf('blocked') !== -1 || msg.indexOf('use') !== -1 ||
            msg.indexOf('found') !== -1) {
          mainBtn.disabled = false;
        }
      }
    );
  }

  /* ── Stop ── */
  function doStop() {
    isScanning = false;
    Camera.stop(videoEl);

    videoEl.classList.remove('live');
    placeholder.classList.remove('gone');
    vf.classList.remove('active');
    scanline.classList.remove('active');

    mainBtn.disabled  = false;
    mainBtn.className = 'btn btn-start';
    btnLabel.textContent = 'Start Scanner';
    statusMsg.textContent = 'Ready';

    lastValue = null;
    clearTimeout(cooldownTmr);
  }

  /* ── Show result card ── */
  function showResult(value, format) {
    rHeadline.textContent = "Code Recognized: '" + value + "'";
    rRaw.textContent      = value;
    rMeta.textContent     = 'Format detected: ' + format;
    overlay.classList.add('visible');
  }

}());
