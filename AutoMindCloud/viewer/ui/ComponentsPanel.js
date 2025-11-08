// /viewer/ui/ComponentsPanel.js
// Panel lateral de componentes + detalle con descripción IA.

export function createComponentsPanel(app, theme) {
  if (
    !app ||
    !app.getComponents ||
    !app.isolate ||
    !app.showAll ||
    !app.getDescription ||
    !app.on
  ) {
    throw new Error("[ComponentsPanel] Missing required app APIs");
  }

  const host =
    (app.core && app.core.container) ||
    document.getElementById("urdf-viewer") ||
    document.body;

  host.style.position = host.style.position || "relative";

  const ui = {
    root: document.createElement("div"),
    toggleBtn: document.createElement("button"),
    panel: document.createElement("div"),
    header: document.createElement("div"),
    title: document.createElement("div"),
    showAllBtn: document.createElement("button"),
    details: document.createElement("div"),
    detailsTitle: document.createElement("div"),
    detailsBody: document.createElement("div"),
    list: document.createElement("div"),
  };

  // ===== Root =====
  ui.root.style.position = "absolute";
  ui.root.style.left = "0";
  ui.root.style.top = "0";
  ui.root.style.height = "100%";
  ui.root.style.pointerEvents = "none";
  ui.root.style.zIndex = "30";

  // ===== Toggle Button =====
  ui.toggleBtn.textContent = "Components";
  ui.toggleBtn.style.position = "absolute";
  ui.toggleBtn.style.left = "10px";
  ui.toggleBtn.style.top = "10px";
  ui.toggleBtn.style.padding = "6px 10px";
  ui.toggleBtn.style.fontSize = "11px";
  ui.toggleBtn.style.borderRadius = "6px";
  ui.toggleBtn.style.border = "none";
  ui.toggleBtn.style.cursor = "pointer";
  ui.toggleBtn.style.pointerEvents = "auto";
  ui.toggleBtn.style.background =
    (theme && theme.panelBg) || "rgba(10,10,10,0.9)";
  ui.toggleBtn.style.color = (theme && theme.textSoft) || "#eee";

  let panelVisible = true;
  ui.toggleBtn.onclick = () => {
    panelVisible = !panelVisible;
    ui.panel.style.display = panelVisible ? "flex" : "none";
  };

  // ===== Panel =====
  ui.panel.style.position = "absolute";
  ui.panel.style.left = "10px";
  ui.panel.style.top = "40px";
  ui.panel.style.bottom = "10px";
  ui.panel.style.width = "260px";
  ui.panel.style.display = "flex";
  ui.panel.style.flexDirection = "column";
  ui.panel.style.gap = "6px";
  ui.panel.style.padding = "8px";
  ui.panel.style.borderRadius = "10px";
  ui.panel.style.background =
    (theme && theme.panelBg) || "rgba(8,8,8,0.96)";
  ui.panel.style.backdropFilter = "blur(6px)";
  ui.panel.style.boxShadow = "0 8px 18px rgba(0,0,0,0.5)";
  ui.panel.style.pointerEvents = "auto";
  ui.panel.style.overflow = "hidden";

  // ===== Header =====
  ui.header.style.display = "flex";
  ui.header.style.alignItems = "center";
  ui.header.style.justifyContent = "space-between";
  ui.header.style.gap = "6px";

  ui.title.textContent = "Componentes";
  ui.title.style.fontSize = "12px";
  ui.title.style.fontWeight = "600";
  ui.title.style.color = (theme && theme.textStrong) || "#ffffff";

  ui.showAllBtn.textContent = "Show all";
  ui.showAllBtn.style.fontSize = "10px";
  ui.showAllBtn.style.padding = "4px 8px";
  ui.showAllBtn.style.border = "none";
  ui.showAllBtn.style.borderRadius = "6px";
  ui.showAllBtn.style.cursor = "pointer";
  ui.showAllBtn.style.background =
    (theme && theme.accentBg) || "#18a0fb";
  ui.showAllBtn.style.color = "#000";
  ui.showAllBtn.onclick = () => {
    app.showAll();
  };

  // ===== Detalle =====
  ui.details.style.flex = "0 0 auto";
  ui.details.style.padding = "6px";
  ui.details.style.borderRadius = "6px";
  ui.details.style.background = "rgba(0,0,0,0.65)";
  ui.details.style.border = "1px solid rgba(255,255,255,0.06)";
  ui.details.style.minHeight = "70px";

  ui.detailsTitle.style.fontSize = "11px";
  ui.detailsTitle.style.fontWeight = "600";
  ui.detailsTitle.style.color = (theme && theme.textStrong) || "#ffffff";
  ui.detailsTitle.dataset.key = "";

  ui.detailsBody.style.marginTop = "4px";
  ui.detailsBody.style.fontSize = "10px";
  ui.detailsBody.style.lineHeight = "1.4";
  ui.detailsBody.style.color = (theme && theme.textSoft) || "#cccccc";
  ui.detailsBody.textContent = "Selecciona un componente para ver su descripción.";

  // ===== Lista =====
  ui.list.style.flex = "1 1 auto";
  ui.list.style.marginTop = "4px";
  ui.list.style.overflowY = "auto";
  ui.list.style.display = "flex";
  ui.list.style.flexDirection = "column";
  ui.list.style.gap = "2px";

  function renderList() {
    const comps = app.getComponents();
    ui.list.innerHTML = "";

    comps.forEach((comp) => {
      const row = document.createElement("div");
      row.textContent = comp.label || comp.key;
      row.style.padding = "4px 6px";
      row.style.borderRadius = "4px";
      row.style.fontSize = "10px";
      row.style.cursor = "pointer";
      row.style.color = (theme && theme.textSoft) || "#cccccc";
      row.style.background = "transparent";
      row.style.transition = "all 0.15s ease";

      row.onmouseenter = () => {
        row.style.background = "rgba(24,160,251,0.18)";
        row.style.color = "#ffffff";
      };
      row.onmouseleave = () => {
        if (ui.detailsTitle.dataset.key === comp.key) {
          row.style.background = "rgba(24,160,251,0.24)";
          row.style.color = "#ffffff";
        } else {
          row.style.background = "transparent";
          row.style.color = (theme && theme.textSoft) || "#cccccc";
        }
      };

      row.onclick = () => {
        // Visual
        Array.from(ui.list.children).forEach((c) => {
          c.style.background = "transparent";
          c.style.color = (theme && theme.textSoft) || "#cccccc";
        });
        row.style.background = "rgba(24,160,251,0.24)";
        row.style.color = "#ffffff";

        // Acción
        ui.detailsTitle.textContent = comp.label || comp.key;
        ui.detailsTitle.dataset.key = comp.key;

        const desc = app.getDescription(comp.key);
        ui.detailsBody.textContent =
          (desc && desc.trim()) || "Sin descripción aún. (Se llenará al terminar el análisis IA)";

        app.isolate(comp.key);
      };

      ui.list.appendChild(row);
    });
  }

  // Actualizar descripción cuando lleguen nuevas desde IA
  app.on("descriptionsUpdated", () => {
    const currentKey = ui.detailsTitle.dataset.key;
    if (currentKey) {
      const d = app.getDescription(currentKey);
      if (d && d.trim()) {
        ui.detailsBody.textContent = d.trim();
      }
    }
  });

  // Montaje DOM
  ui.header.appendChild(ui.title);
  ui.header.appendChild(ui.showAllBtn);

  ui.details.appendChild(ui.detailsTitle);
  ui.details.appendChild(ui.detailsBody);

  ui.panel.appendChild(ui.header);
  ui.panel.appendChild(ui.details);
  ui.panel.appendChild(ui.list);

  ui.root.appendChild(ui.toggleBtn);
  ui.root.appendChild(ui.panel);

  host.appendChild(ui.root);

  // Inicial
  renderList();

  console.log("[ComponentsPanel] Listo.");
  return ui;
}
