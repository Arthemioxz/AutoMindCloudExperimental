// AutoMindCloud/viewer/ui/ToolsDock.js
// Dock de herramientas (incluye botón para abrir/cerrar panel de componentes).

import { THEME } from "../Theme.js";

export function createToolsDock(app, theme = THEME) {
  const root = document.createElement("div");
  root.style.position = "fixed";
  root.style.top = "10px";
  root.style.right = "10px";
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.gap = "6px";
  root.style.zIndex = "30";
  root.style.fontFamily = theme.font;

  function makeButton(label, title) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.title = title || "";
    btn.style.minWidth = "28px";
    btn.style.height = "28px";
    btn.style.padding = "0 8px";
    btn.style.borderRadius = "8px";
    btn.style.border = `1px solid ${theme.borderSoft}`;
    btn.style.background = theme.bgPanel;
    btn.style.color = theme.fg;
    btn.style.fontSize = "11px";
    btn.style.cursor = "pointer";
    btn.style.boxShadow = "0 2px 6px rgba(0,0,0,0.12)";
    btn.style.display = "flex";
    btn.style.alignItems = "center";
    btn.style.justifyContent = "center";
    btn.style.gap = "4px";
    btn.onmouseenter = () => {
      btn.style.background = theme.bgHover;
    };
    btn.onmouseleave = () => {
      btn.style.background = theme.bgPanel;
    };
    return btn;
  }

  // Reset cámara
  const resetBtn = makeButton("R", "Reset vista");
  resetBtn.onclick = () => {
    if (!app || !app.camera || !app.controls || !app.robot) return;
    const THREE = window.THREE;
    const box = new THREE.Box3().setFromObject(app.robot);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fov = (app.camera.fov || 60) * (Math.PI / 180);
    const dist = maxDim / Math.tan(Math.max(1e-3, fov / 2));
    const dir = new THREE.Vector3(1, 0.8, 1).normalize();
    const pos = center.clone().add(dir.multiplyScalar(dist * 1.2));
    app.camera.position.copy(pos);
    app.camera.lookAt(center);
    app.controls.target.copy(center);
    app.controls.update();
  };
  root.appendChild(resetBtn);

  // Toggle proyección
  const projBtn = makeButton("P", "Cambiar proyección Persp/Ortho");
  projBtn.onclick = () => {
    if (!app || typeof app.setProjection !== "function") return;
    const current = app._projectionMode || "perspective";
    const next = current === "perspective" ? "orthographic" : "perspective";
    app.setProjection(next);
    app._projectionMode = next;
  };
  root.appendChild(projBtn);

  // Botón Componentes (solo si existe panel)
  if (app && app.componentsPanel) {
    const compBtn = makeButton("C", "Mostrar/ocultar componentes");
    compBtn.onclick = () => {
      if (!app.componentsPanel) return;
      app.componentsPanel.toggle();
    };
    root.appendChild(compBtn);
  }

  document.body.appendChild(root);

  function destroy() {
    if (root && root.parentNode) {
      root.parentNode.removeChild(root);
    }
  }

  return {
    destroy,
  };
}
