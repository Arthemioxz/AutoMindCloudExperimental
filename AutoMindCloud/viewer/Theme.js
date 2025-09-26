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
    ui: "Inter, 'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif",
  },
  sizes: {
    radiusSm: '8px',
    radiusMd: '12px',
    radiusLg: '18px',
    paddingSm: '6px',
    paddingMd: '8px',
    paddingLg: '12px',
  },
};

// Helper opcional: inyecta variables CSS globales para paneles HTML
export function injectCssVars(theme = THEME) {
  const { colors, shadows } = theme;
  const css = `
  :root {
    --teal: ${colors.teal};
    --teal-soft: ${colors.tealSoft};
    --teal-faint: ${colors.tealFaint};
    --text: ${colors.text};
    --text-muted: ${colors.textMuted};
    --panel-bg: ${colors.panelBg};
    --stroke: ${colors.stroke};
    --shadow: ${shadows.md};
    --shadow-lg: ${shadows.lg};
  }`;
  const style = document.createElement('style');
  style.setAttribute('data-amc-theme', 'true');
  style.textContent = css;
  document.head.appendChild(style);
}

// Export por defecto también (para compatibilidad)
export default THEME;

