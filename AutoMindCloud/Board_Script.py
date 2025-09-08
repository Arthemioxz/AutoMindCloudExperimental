# ... (todo tu código anterior idéntico)

def board(serial: str = "board"):
    serial = _sanitize_serial(serial)
    cb_name = _ensure_callback_registered(serial)

    STORAGE_KEY  = f"amc_pizarra_snapshot_dataurl_{serial}"
    IMG_ID       = f"amc_persisted_snapshot_{serial}"
    CONTAINER_ID = f"amc_persisted_snapshot_container_{serial}"
    PNG_PATH     = f"/content/pizarra_cell_{serial}.png"

    initial_data_url = _extract_snapshot_from_ipynb(serial) or _file_to_dataurl(PNG_PATH)

    js_code = f"""
<script>
(function(){{
  // (JS idéntico al tuyo)
}})();
</script>
"""

    html = f"""
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Pizarra {serial}</title>
<style>
  :root{{ --muted:#e2e8f0; }}
  *{{ box-sizing:border-box; }}
  body{{ margin:0; font-family:ui-sans-serif,system-ui; background:#f8fafc; }}
  .toolbar{{ display:flex; gap:10px; flex-wrap:wrap; margin:12px; align-items:center; }}
  .toolbar button{{ padding:8px 12px; border:1px solid var(--muted); border-radius:8px; cursor:pointer; background:#fff; }}
  .toolbar input[type="color"], .toolbar input[type="range"]{{ height:36px; }}

  /* 🔥 NUEVO: contenedor con scroll para poder mostrar el doble de ancho */
  .board-wrap{{ width:100%; overflow-x:auto; overflow-y:hidden; }}

  /* 🔥 NUEVO: canvas al 200% del ancho visible */
  canvas{{ border:1px solid var(--muted); border-radius:12px; width:200%; height:460px; touch-action:none; cursor:crosshair; background:#fff; }}

  .serial{{ margin:8px 12px; font:12px/1.2 ui-sans-serif,system-ui; color:#64748b; }}
</style>
</head>
<body>
  <div class="serial">Board: <strong>{serial}</strong></div>

  <div class="toolbar">
    <button id="penBtn_{serial}">✏️ Lápiz</button>
    <button id="eraserBtn_{serial}">🧹 Borrador</button>
    <label>Color <input id="color_{serial}" type="color" value="#0f172a"></label>
    <label>Grosor <input id="size_{serial}" type="range" min="1" max="50" value="8"></label>
    <button id="undoBtn_{serial}">↩️ Undo</button>
    <button id="redoBtn_{serial}">↪️ Redo</button>
    <button id="clearBtn_{serial}">🗑️ Limpiar</button>
    <button id="downloadBtn_{serial}">⬇️ Descargar PNG</button>
  </div>

  <!-- (INTERNO oculto) para rehidratar el canvas y seguir editando -->
  <div id="{CONTAINER_ID}" style="display:none">
    <img id="{IMG_ID}" src="{initial_data_url or ''}" />
  </div>

  <!-- 🔥 NUEVO: contenedor con scroll -->
  <div class="board-wrap">
    <canvas id="board_{serial}"></canvas>
  </div>

  {js_code}
</body>
</html>
"""

    # Bloque externo invisible (igual que tu versión)
    snapshot_html = f"""
    <div id="{CONTAINER_ID}" aria-hidden="true"
         style="position:fixed; left:-9999px; top:-9999px; width:1px; height:1px; opacity:0; overflow:hidden; padding:0; margin:0; border:0; user-select:none; pointer-events:none;">
      <div style="font:0/0; height:0; overflow:hidden">Último dibujo (persistente)</div>
      <img id="{IMG_ID}" src="{initial_data_url or ''}" alt="persisted snapshot" style="width:1px; height:1px; border:0; display:block" />
    </div>
    """
    if serial not in _SNAPSHOT_HANDLES:
        _SNAPSHOT_HANDLES[serial] = display(HTML(snapshot_html), display_id=True)
    else:
        _SNAPSHOT_HANDLES[serial].update(HTML(snapshot_html))

    display(HTML(html))

