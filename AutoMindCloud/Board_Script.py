from IPython.display import HTML, display
from google.colab import output
import re, base64, os

_SNAPSHOT_HANDLES = {}          # serial -> DisplayHandle (bloque oculto/externo con display_id)
_REGISTERED_CALLBACKS = set()   # callbacks registrados

def _sanitize_serial(s: str) -> str:
    s = (s or "board").strip()
    s = re.sub(r'[^A-Za-z0-9_]+', '_', s)
    return s or "board"

def _make_snapshot_callback(serial: str):
    container_id = f"amc_persisted_snapshot_container_{serial}"
    img_id = f"amc_persisted_snapshot_{serial}"
    png_path = f"/content/pizarra_cell_{serial}.png"

    def _cb(data_url_png: str):
        m = re.match(r'^data:image/png;base64,(.*)$', data_url_png or '')
        if m:
            try:
                with open(png_path, "wb") as f:
                    f.write(base64.b64decode(m.group(1)))
            except Exception:
                pass

        html = f"""
        <div id="{container_id}" aria-hidden="true"
             style="position:fixed; left:-9999px; top:-9999px; width:1px; height:1px; opacity:0; overflow:hidden; padding:0; margin:0; border:0; user-select:none; pointer-events:none;">
          <div style="font:0/0; height:0; overflow:hidden">Último dibujo (persistente)</div>
          <img id="{img_id}" src="{data_url_png}" alt="persisted snapshot" style="width:1px; height:1px; border:0; display:block" />
        </div>
        """
        handle = _SNAPSHOT_HANDLES.get(serial)
        if handle is None:
            _SNAPSHOT_HANDLES[serial] = display(HTML(html), display_id=True)
        else:
            handle.update(HTML(html))

        try:
            from google.colab import _message
            _message.blocking_request('notebook.save', {})
        except Exception:
            pass

        return {"ok": True}

    return _cb

def _ensure_callback_registered(serial: str):
    name = f"persist.pushSnapshot.{serial}"
    if name not in _REGISTERED_CALLBACKS:
        output.register_callback(name, _make_snapshot_callback(serial))
        _REGISTERED_CALLBACKS.add(name)
    return name

def _file_to_dataurl(path: str) -> str:
    if not os.path.exists(path):
        return ""
    try:
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        return "data:image/png;base64," + b64
    except Exception:
        return ""

def _extract_snapshot_from_ipynb(serial: str) -> str:
    try:
        from google.colab import _message
        nbwrap = _message.blocking_request('get_ipynb', {}) or {}
        nb = nbwrap.get('ipynb', nbwrap) or {}
        ids = [
            f"amc_persisted_snapshot_{serial}",
            f"amc_persisted_snapshot_ext_{serial}",
            f"amc_persisted_snapshot_int_{serial}",
        ]
        pat = re.compile(
            r'id=["\'](' + '|'.join(map(re.escape, ids)) + r')["\']\s+[^>]*src=["\'](data:image/[^"\']+)["\']',
            re.IGNORECASE
        )
        for cell in reversed(nb.get('cells', [])):
            for out in reversed(cell.get('outputs', [])):
                data = out.get('data', {})
                html = None
                if 'text/html' in data:
                    v = data['text/html']
                    html = ''.join(v) if isinstance(v, list) else (v or '')
                elif 'text' in data:
                    v = data['text']
                    html = ''.join(v) if isinstance(v, list) else (v or '')
                if html:
                    m = None
                    for m in pat.finditer(html):
                        pass
                    if m:
                        src = m.group(2)
                        if src.startswith('data:image/'):
                            return src
        return ""
    except Exception:
        return ""

# --------------------
# NEW: Button-pressed callback registration
# --------------------
def _make_button_pressed_callback(serial: str):
    """
    This callback will be registered in the kernel and, when invoked from the front-end,
    will print "button pressed" in the notebook output area.
    """
   
