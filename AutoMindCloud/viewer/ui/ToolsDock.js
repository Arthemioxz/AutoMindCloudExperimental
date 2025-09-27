// /viewer/ui/ToolsDock.js
// Floating tools dock: render modes, explode (smoothed & robust), section plane, views, projection, scene toggles, snapshot.
/* global THREE */

export function createToolsDock(app, theme) {
  if (!app || !app.camera || !app.controls || !app.renderer)
    throw new Error('[ToolsDock] Missing app.camera/controls/renderer');

  // --- Normalize theme to flat keys (works with your Theme.js nested shape) ---
  if (theme && theme.colors) {
    theme.teal       ??= theme.colors.teal;
    theme.tealSoft   ??= theme.colors.tealSoft;
    theme.tealFaint  ??= theme.colors.tealFaint;
    theme.bgPanel    ??= theme.colors.panelBg;
    theme.bgCanvas   ??= theme.colors.canvasBg;
    theme.stroke     ??= theme.colors.stroke;
    theme.text       ??= theme.colors.text;
    theme.textMuted  ??= theme.colors.textMuted;
  }
  if (theme && theme.shadows) {
    theme.shadow ??= (theme.shadows.lg || theme.shadows.md || theme.shadows.sm);
  }

  // --- Unified hover style for all buttons (teal/white, black text) ---
  function applyButtonHover(b, theme) {
    const teal
