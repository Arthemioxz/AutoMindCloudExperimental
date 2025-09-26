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

// Theme.js

export function injectGlobalButtonStyles() {
  const css = `
  /* Reusable button with teal <-> white hover */
  .amc-btn {
    background: var(--panel-bg);
    color: var(--text);
    border: 1px solid var(--stroke);
    border-radius: 12px;
    padding: 8px 12px;
    font-weight: 700;
    cursor: pointer;
    transition: background .15s ease, color .15s ease, border-color .15s ease, box-shadow .15s ease, transform .12s ease;
    box-shadow: var(--shadow);
  }
  .amc-btn:hover {
    background: var(--teal);
    color: #fff;
    border-color: var(--teal);
    box-shadow: var(--shadow-lg);
    transform: translateY(-1px);
  }

  /* Optional smaller variant */
  .amc-btn--sm { padding: 6px 10px; border-radius: 10px; }

  /* If you have buttons sitting on the dock/panel header */
  .amc-btn--ghost {
    background: var(--panel-bg);
    color: var(--text);
    border-color: var(--stroke);
    box-shadow: none;
  }
  .amc-btn--ghost:hover {
    background: var(--teal);
    color: #fff;
    border-color: var(--teal);
  }`;
  const style = document.createElement('style');
  style.setAttribute('data-amc-buttons', 'true');
  style.textContent = css;
  document.head.appendChild(style);
}

// Export por defecto también (para compatibilidad)
export default THEME;
