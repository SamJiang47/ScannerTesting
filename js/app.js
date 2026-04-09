/*
  app.js
  ------
  UI logic: wires the button, camera, and result card together.

  Scan behaviour:
    - Camera runs until a code is recognized.
    - On recognition: camera stops immediately, result card appears.
    - Hitting X on the result card: card closes AND camera restarts.
    - The Stop button still works at any time to fully stop scanning.
*/

(function () {
  'use strict';

  var isScanning  = false;

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

  /* ── Main button click ── */
  mainBtn.addEventListener('click', function () {
    if (isScanning) { doStop(); } else { doStart(); }
  });

  /*
    ── X button ──
    Close the result card AND immediately restart the camera
    so the user is ready for the next scan without any extra tap.
  */
  xBtn.addEventListener('click', function () {
    overlay.classList.remove('visible');
    doStart();
  });

  /* ══════════════════════════════════════
     START
  ══════════════════════════════════════ */
  function doStart() {
    mainBtn.disabled = true;

    Camera.start(
      videoEl,

      /* ── onResult: fires once when a code is found ── */
      function (value, format) {
        /*
          Stop the camera immediately — no more frames decoded
          until the user dismisses the result card.
        */
        doStop(/* silent = */ true);

        /* Show the result card */
        showResult(value, format);
      },

      /* ── onStatus: camera lifecycle messages ── */
      function (msg) {
        statusMsg.textContent = msg;

        /* Camera came live */
        if (msg.indexOf('Scanning') === 0) {
          isScanning        = true;
          mainBtn.disabled  = false;
          mainBtn.className = 'btn btn-stop';
          btnLabel.textContent = 'Stop Scanner';
          videoEl.classList.add('live');
          placeholder.classList.add('gone');
          vf.classList.add('active');
          scanline.classList.add('active');
        }

        /* Camera error — re-enable button */
        if (msg.indexOf('error')   !== -1 ||
            msg.indexOf('denied')  !== -1 ||
            msg.indexOf('blocked') !== -1 ||
            msg.indexOf('use')     !== -1 ||
            msg.indexOf('found')   !== -1) {
          mainBtn.disabled = false;
        }
      }
    );
  }

  /* ══════════════════════════════════════
     STOP
     silent=true  → keep button as-is (called internally after a scan)
     silent=false → reset button to "Start Scanner" (called by user)
  ══════════════════════════════════════ */
  function doStop(silent) {
    isScanning = false;
    Camera.stop(videoEl);

    videoEl.classList.remove('live');
    placeholder.classList.remove('gone');
    vf.classList.remove('active');
    scanline.classList.remove('active');

    if (!silent) {
      mainBtn.disabled      = false;
      mainBtn.className     = 'btn btn-start';
      btnLabel.textContent  = 'Start Scanner';
      statusMsg.textContent = 'Ready';
    }
  }

  /* ══════════════════════════════════════
     SHOW RESULT CARD
  ══════════════════════════════════════ */
  function showResult(value, format) {
    rHeadline.textContent = "Code Recognized: '" + value + "'";
    rRaw.textContent      = value;
    rMeta.textContent     = 'Format detected: ' + format;
    overlay.classList.add('visible');

    /*
      Reset the main button back to "Start Scanner" while the card
      is showing, so if the user manually closes via X, the button
      state is already correct for the auto-restart that follows.
    */
    mainBtn.disabled      = false;
    mainBtn.className     = 'btn btn-start';
    btnLabel.textContent  = 'Start Scanner';
    statusMsg.textContent = 'Code found \u2014 close the result card to scan again';
  }

}());
