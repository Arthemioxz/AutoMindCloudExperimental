/* AutoMindCloud/Sound.js
   Minimal sound helper for click SFX
   - setFromBase64(b64[, mime])     -> decodes and prepares a sound from Base64
   - setFromURL(url)                -> fetches and prepares a sound from a URL
   - setFromArrayBuffer(ab[, mime]) -> prepares from raw bytes
   - play([volume])                 -> plays the prepared sound (0..1)
   - setVolume(volume)              -> sets master volume (0..1)
   - isReady()                      -> true if a sound is ready
   - downloadFromBase64([filename]) -> saves Base64 to .mp3 on the client
   Notes:
   * Uses a lazy AudioContext to respect autoplay policies.
   * Falls back to <audio> element when AudioContext/decoding isn’t available.
*/
(function (root) {
  'use strict';

  const Sound = {};
  let ctx = null, masterGain = null;
  let decodedBuffer = null;     // WebAudio decoded sound
  let htmlAudio = null;         // Fallback <audio>
  let lastArrayBuffer = null;   // raw bytes for download
  let masterVolume = 1.0;

  console.log("Sound Button Activated");
  
  // ---------- internals ----------
  function ensureCtx() {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = masterVolume;
      masterGain.connect(ctx.destination);
    }
    return ctx;
  }

  async function resumeCtx() {
    if (ctx && ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (_e) {}
    }
  }

  function stripDataURI(b64) {
    return String(b64 || '').replace(/^data:.*;base64,/, '');
  }

  function base64ToArrayBuffer(b64) {
    const clean = stripDataURI(b64);
    const bin = atob(clean);
    const len = bin.length;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  function abToBlob(ab, mime = 'audio/mpeg') {
    return new Blob([ab], { type: mime });
  }

  function blobToObjectURL(blob) {
    return URL.createObjectURL(blob);
  }

  function resetAll() {
    decodedBuffer = null;
    if (htmlAudio) { try { htmlAudio.pause(); } catch(_){} htmlAudio = null; }
  }

  async function tryDecodeWebAudio(ab) {
    const ac = ensureCtx();
    if (!ac) return null;
    await resumeCtx();
    return new Promise((resolve) => {
      // Some browsers still expect old signature; wrap safely
      const onDone = (buf) => resolve(buf || null);
      const onErr  = () => resolve(null);
      try {
        ac.decodeAudioData(ab.slice(0), onDone, onErr);
      } catch (_e) {
        // Modern spec returns a Promise
        ac.decodeAudioData(ab.slice(0)).then(onDone).catch(onErr);
      }
    });
  }

  // ---------- public API ----------
  Sound.setVolume = function (v) {
    masterVolume = Math.max(0, Math.min(1, Number(v) || 0));
    if (masterGain) masterGain.gain.value = masterVolume;
  };

  Sound.isReady = function () {
    return !!(decodedBuffer || htmlAudio);
  };

  Sound.setFromArrayBuffer = async function (ab, mime = 'audio/mpeg') {
    resetAll();
    lastArrayBuffer = ab;

    const decoded = await tryDecodeWebAudio(ab);
    if (decoded) {
      decodedBuffer = decoded;
      htmlAudio = null;
      return true;
    }

    // Fallback: HTMLAudioElement via blob URL
    const blob = abToBlob(ab, mime);
    const url  = blobToObjectURL(blob);
    htmlAudio = new Audio();
    htmlAudio.src = url;
    decodedBuffer = null;
    try { await htmlAudio.play(); htmlAudio.pause(); htmlAudio.currentTime = 0; } catch(_){}
    return true;
  };

  Sound.setFromBase64 = async function (b64, mime = 'audio/mpeg') {
    const ab = base64ToArrayBuffer(b64);
    return await Sound.setFromArrayBuffer(ab, mime);
  };

  Sound.setFromURL = async function (url) {
    resetAll();
    // fetch as arrayBuffer (needs CORS if cross-origin)
    const res = await fetch(url);
    const ab = await res.arrayBuffer();
    return await Sound.setFromArrayBuffer(ab);
  };

  Sound.play = async function (volume = 1.0) {
    if (decodedBuffer) {
      ensureCtx(); await resumeCtx();
      if (!ctx || !masterGain) return;

      const src = ctx.createBufferSource();
      src.buffer = decodedBuffer;

      const gain = ctx.createGain();
      const v = Math.max(0, Math.min(1, Number(volume) || 1));
      gain.gain.value = v;

      src.connect(gain).connect(masterGain);
      src.start();
      return true;
    }

    if (htmlAudio) {
      try {
        htmlAudio.currentTime = 0;
        htmlAudio.volume = Math.max(0, Math.min(1, Number(volume) || 1)) * masterVolume;
        await htmlAudio.play();
        return true;
      } catch (_e) {
        // If direct play fails (policy), try user-gesture-initiated resume later
        return false;
      }
    }

    return false;
  };

  // Save Base64 as .mp3 on client
  Sound.downloadFromBase64 = function (filename = 'click_sound.mp3') {
    let ab = lastArrayBuffer;
    if (!ab) {
      console.warn('[Sound] No cached ArrayBuffer; pass the Base64 again to download reliably.');
      return;
    }
    const blob = abToBlob(ab, 'audio/mpeg');
    const url  = blobToObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  };

  // UMD export
  root.Sound = Sound;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Sound;
  }
})(typeof window !== 'undefined' ? window : this);
