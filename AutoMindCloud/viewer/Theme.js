// AutoMindCloud/viewer/Theme.js
// -----------------------------
// Paleta base (teal/white) y tokens de UI.
// Exporta nombrado (THEME) y por defecto (default).

export const THEME = {
  colors: {
    teal: '#0ea5a6',
    tealSoft: '#14b8b9',
    tealFaint: 'rgba(20,184,185,0.12)',
    panelBg: '#ffffff',
    canvasBg: 0xffffff,       // number para THREE.Color
    stroke: '#d7e7e7',
    text: '#0b3b3c',
    textMuted: '#577e7f',
  },
  shadows: {
    sm: '0 4px 12px rgba(0,0,0,0.08)',
    md: '0 8px 24px rgba(0,0,0,0.12)',
    lg: '0 12px 36px rgba(0,0,0,0.14)',
  },
  fonts: {
    ui: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial",
  }
};

export default THEME;
