/* AutoMindCloud/Sound.js
   Utility to decode a Base64 MP3 and play it on demand.
   - Call Sound.setFromBase64(b64) once (string may include or omit data URI prefix).
   - Then call Sound.play(volume) on any click.
   - Autoplay-policy safe: lazy AudioContext, resumes on first user interaction.
*/

(function (root) {
  'use strict';

  const Sound = {};
  let ctx = null;
  let gainNode = null;
  let audioBuffer = null;
  let htmlAudio = null;
  let lastAB = null;

  // -------- Helpers --------
  function ensureCtx() {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      gainNode = ctx.createGain();
      gainNode.gain.value = 1.0;
      gainNode.connect(ctx.destination);
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
    const bin = atob(stripDataURI(b64));
    const len = bin.length;
    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  // -------- Public API --------
  /** Provide Base64 string of an MP3 */
  Sound.setFromBase64 = async function (b64, mime = 'audio/mpeg') {
    if (!b64) throw new Error('No base64 provided.');
    const ab = base64ToArrayBuffer(b64);
    lastAB = ab;

    const AC = root.AudioContext || root.webkitAudioContext;
    if (AC) {
      ensureCtx();
      try {
        audioBuffer = await ctx.decodeAudioData(ab.slice(0));
        htmlAudio = null;
        return true;
      } catch (e) {
        console.warn('[Sound] decodeAudioData failed, fallback to HTMLAudio', e);
      }
    }
    // Fallback: <audio> element
    const blob = new Blob([ab], { type: mime });
    const url = URL.createObjectURL(blob);
    htmlAudio = new Audio(url);
    audioBuffer = null;
    return true;
  };

  Sound.isReady = function () {
    return !!(audioBuffer || htmlAudio);
  };

  /** Play sound */
  Sound.play = async function (volume = 1.0) {
    if (!Sound.isReady()) return false;
    if (audioBuffer) {
      ensureCtx();
      await resumeCtx();
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      const g = ctx.createGain();
      g.gain.value = volume;
      src.connect(g).connect(ctx.destination);
      src.start();
      return true;
    }
    if (htmlAudio) {
      try {

        console.log("Button Clicked");
         
        htmlAudio.currentTime = 0;
        htmlAudio.volume = volume;
        await htmlAudio.play();
        
        return true;
      } catch (e) {
        console.error('[Sound] HTMLAudio play failed:', e);
        return false;
      }
    }
    return false;
  };

  root.Sound = Sound;
})(typeof window !== 'undefined' ? window : this);
