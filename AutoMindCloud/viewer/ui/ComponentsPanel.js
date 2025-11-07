// AutoMindCloud/viewer/ui/ComponentsPanel.js
// Panel lateral con lista de componentes y descripciones.

import { THEME } from "../Theme.js";

export function createComponentsPanel(app, theme = THEME) {
  const state = {
    isOpen: false,
  };

  const root = document.createElement("div");
  root.style.position = "fixed";
  root.style.left = "0";
  root.style.top = "0";
  root.style.bottom = "0";
  root.style.width = "260px";
  root.style.background = theme.bgPanel;
  root.style.borderRight = `1px solid ${theme.borderSoft}`;
  root.style.boxShadow = "2px 0 12px rgba(0,0,0,0.08)";
  root.style.display = "none";
  root.style.zIndex = "20";
  root.style.padding = "8px";
  root.style.boxSizing = "border-box";
  root.style.fontFamily = theme.font;
  root.style.color = theme.fg;
  root.style.overflow = "hidden";

  const header = document.createElement("div");
  header.textContent = "Componentes";
  header.style.fontWeight = "600";
  header.style.marginBottom = "6px";
  header.style.fontSize = "14px";

  const listWrap = document.createElement("div");
  listWrap.style.position = "absolute";
  listWrap.style.left = "8px";
  listWrap.style.right = "8px";
  listWrap.style.top = "26px";
  listWrap.style.bottom = "90px";
  listWrap.style.overflowY = "auto";
  listWrap.style.borderRadius = "8px";
  listWrap.style.border = `1px solid ${theme.borderSoft}`;
  listWrap.style.background = theme.bgSubtle;

  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "4px";
  list.style.padding = "4px";
  listWrap.appendChild(list);

  const details = document.createElement("div");
  details.style.position = "absolute";
  details.style.left = "8px";
  details.style.right = "8px";
  details.style.bottom = "8px";
  details.style.height = "76px";
  details.style.borderRadius = "8px";
  details.style.border = `1px solid ${theme.borderSoft}`;
  details.style.background = theme.bgSubtle;
  details.style.padding = "6px";
  details.style.boxSizing = "border-box";
  details.style.display = "flex";
  details.style.flexDirection = "column";
  details.style.fontSize = "11px";
  details.style.gap = "2px";

  const detailsTitle = document.createElement("div");
  detailsTitle.style.fontWeight = "600";
  detailsTitle.style.fontSize = "11px";
  detailsTitle.style.color = theme.accent;

  const detailsText = document.createElement("div");
  detailsText.style.flex = "1";
  detailsText.style.overflow = "auto";
  detailsText.style.lineHeight = "1.25";

  details.appendChild(detailsTitle);
  details.appendChild(detailsText);

  root.appendChild(header);
  root.appendChild(listWrap);
  root.appendChild(details);

  document.body.appendChild(root);

  function open() {
    state.isOpen = true;
    root.style.display = "block";
    refresh();
  }

  function close() {
    state.isOpen = false;
    root.style.display = "none";
  }

  function toggle() {
    state.isOpen ? close() : open();
  }

  function set(isOpen) {
    isOpen ? open() : close();
  }

  function clearList() {
    while (list.firstChild) list.removeChild(list.firstChild);
  }

  function getComponentDescription(assetKey) {
    if (!app || !app.componentDescriptions) return "";
    return app.componentDescriptions[assetKey] || "";
  }

  function showDetails(ent) {
    if (!ent) {
      detailsTitle.textContent = "";
      detailsText.textContent = "";
      return;
    }

    const title =
      ent.base ||
      ent.assetKey ||
      ent.key ||
      (typeof ent === "string" ? ent : "");

    detailsTitle.textContent = title || "";

    const key = ent.assetKey || ent.key || title;
    const desc = getComponentDescription(key);

    detailsText.textContent =
      desc && desc.trim()
        ? desc.trim()
        : "Descripción en generación…";
  }

  function buildRow(ent) {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";
    row.style.padding = "4px";
    row.style.borderRadius = "6px";
    row.style.cursor = "pointer";
    row.style.transition = "all 0.14s ease";

    row.onmouseenter = () => {
      row.style.background = theme.bgHover;
      row.style.transform = "translateX(2px)";
    };
    row.onmouseleave = () => {
      row.style.background = "transparent";
      row.style.transform = "translateX(0)";
    };

    const thumb = document.createElement("div");
    thumb.style.width = "34px";
    thumb.style.height = "24px";
    thumb.style.borderRadius = "4px";
    thumb.style.background = theme.bgSoft;
    thumb.style.flexShrink = "0";
    thumb.style.overflow = "hidden";

    if (app && app.assets && typeof app.assets.thumbnail === "function") {
      const url =
        app.assets.thumbnail(ent.assetKey || ent.key || ent.base) || null;
      if (url) {
        const img = document.createElement("img");
        img.src = url;
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        thumb.appendChild(img);
      }
    }

    const label = document.createElement("div");
    label.style.flex = "1";
    label.style.fontSize = "11px";
    label.style.whiteSpace = "nowrap";
    label.style.overflow = "hidden";
    label.style.textOverflow = "ellipsis";
    label.textContent =
      ent.base || ent.assetKey || ent.key || "(sin nombre)";

    row.appendChild(thumb);
    row.appendChild(label);

    row.onclick = () => {
      showDetails(ent);
      if (app && typeof app.focusComponent === "function") {
        app.focusComponent(ent.assetKey || ent.key || ent.base);
      }
    };

    return row;
  }

  function refresh() {
    if (!state.isOpen) return;
    clearList();

    if (!app || !app.assets || typeof app.assets.list !== "function") {
      const msg = document.createElement("div");
      msg.textContent = "Sin datos de componentes.";
      msg.style.fontSize = "10px";
      msg.style.opacity = "0.7";
      msg.style.padding = "6px";
      list.appendChild(msg);
      return;
    }

    const items = app.assets.list() || [];
    if (!items.length) {
      const msg = document.createElement("div");
      msg.textContent = "Sin componentes detectados.";
      msg.style.fontSize = "10px";
      msg.style.opacity = "0.7";
      msg.style.padding = "6px";
      list.appendChild(msg);
      return;
    }

    items.forEach((ent) => {
      list.appendChild(buildRow(ent));
    });
  }

  function destroy() {
    if (root && root.parentNode) {
      root.parentNode.removeChild(root);
    }
  }

  // Actualiza descripciones en caliente (mini-lotes)
  function updateDescriptions(partial) {
    if (!partial || typeof partial !== "object") return;
    if (!app.componentDescriptions) app.componentDescriptions = {};

    for (const k of Object.keys(partial)) {
      const v = partial[k];
      app.componentDescriptions[k] = (v || "").toString();
    }

    // refrescar detalle si alguno está visible
    const currentTitle = detailsTitle.textContent || "";
    if (!currentTitle) return;

    const items =
      (app.assets && typeof app.assets.list === "function"
        ? app.assets.list()
        : []) || [];

    const current =
      items.find(
        (ent) =>
          ent.assetKey === currentTitle ||
          ent.key === currentTitle ||
          ent.base === currentTitle
      ) || null;

    if (current) showDetails(current);
  }

  return {
    open,
    close,
    toggle,
    set,
    refresh,
    destroy,
    updateDescriptions,
  };
}
