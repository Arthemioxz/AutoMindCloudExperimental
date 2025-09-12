"""
cadview_panel.py

Jupyter widget panel to cycle orthographic views of a STEP file using CadQuery.

Usage example (run in a Jupyter notebook cell):

from cadview_panel import create_panel_from_step
create_panel_from_step("Sketch")   # returns an HTML widget; put it as the last expression in a cell to display once
# or:
panel = create_panel_from_step("Sketch")
display(panel)

Requirements:
- cadquery
- ipywidgets
- IPython.display

Behavior:
- Generates orthographic SVGs (Front, Top, Right, Bottom).
- Returns an ipywidgets.HTML widget containing a small panel: a teal "Next view" button,
  a LaTeX-rendered title and a boxed SVG display.
- If a file named "click_sound.mp3" exists in the current directory when this module runs,
  the MP3 is embedded (base64) into the generated HTML and played entirely client-side
  when the "Next view" button is clicked (no visible audio controls).
- The implementation is client-side: the SVG swapping and audio playback happen in the browser.
"""
import os
import re
import json
import uuid
import base64
import cadquery as cq
from cadquery import exporters
import ipywidgets as widgets
from IPython.display import HTML  # used if users want to display manually


def _generate_orthographic_svgs(result):
    """
    Given a CadQuery result (Workplane/Object with .val()), return a list of (title, svg_str).
    Views are produced in this order: Front, Top, Right, Bottom.
    """
    views = [
        ("Front View", (1, 0, 0), 0),
        ("Top View", (1, 0, 0), 90),
        ("Right Side View", (0, 1, 0), 90),
        ("Bottom View", (1, 0, 0), -90),
    ]

    svgs = []
    for title, axis, angle in views:
        try:
            rotated = result.rotate((0, 0, 0), axis, angle)
            shape = rotated.val() if hasattr(rotated, "val") else rotated
            svg_str = exporters.getSVG(shape, opts={"showAxes": False})
            svgs.append((title, svg_str))
        except Exception as e:
            err_svg = (
                "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='200'>"
                f"<text x='10' y='20' fill='red'>Error generating {title}: {e}</text></svg>"
            )
            svgs.append((title, err_svg))
    return svgs


def _latex_escape(text: str) -> str:
    """
    Escape a subset of LaTeX special characters so the title renders without errors.
    """
    replacements = {
        "\\": r"\textbackslash{}",
        "{": r"\{",
        "}": r"\}",
        "_": r"\_",
        "%": r"\%",
        "&": r"\&",
        "$": r"\$",
        "#": r"\#",
        "^": r"\^{}",
        "~": r"\~{}",
    }
    escaped = text
    for k, v in replacements.items():
        escaped = escaped.replace(k, v)
    return escaped


def _strip_background_rects(svg: str) -> str:
    """
    Remove large/full-size <rect> elements often inserted as background rectangles by exporters.
    Conservative removal: only remove rects that include width/height/fill attributes.
    Also remove XML declarations.
    """
    if not svg:
        return svg
    svg = re.sub(r"<\?xml[^>]*\?>", "", svg, flags=re.IGNORECASE).strip()
    svg = re.sub(
        r'<rect\b[^>]*(?:width\s*=\s*"[^\"]*"|height\s*=\s*"[^\"]*"|fill\s*=\s*"[^\"]*")[^>]*\/?>',
        "",
        svg,
        flags=re.IGNORECASE,
    )
    svg = re.sub(r"</rect\s*>", "", svg, flags=re.IGNORECASE)
    return svg


def _embed_audio_b64(filename="click_sound.mp3"):
    """
    If the given audio file exists, return a data URL string (data:audio/mpeg;base64,...),
    otherwise return None.
    """
    if not os.path.exists(filename):
        return None
    try:
        with open(filename, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        return f"data:audio/mpeg;base64,{b64}"
    except Exception:
        return None


def _make_client_side_html(svgs, audio_dataurl=None):
    """
    Build an HTML/JS blob that manages the view index, renders the SVG inside
    a small bordered box, renders the title using MathJax if available, and
    plays the embedded audio client-side when the Next button is clicked.

    Returns the HTML string.
    """
    uid = "cadview_" + uuid.uuid4().hex[:8]

    # Clean svgs removing background rects and prepare JSON arrays for JS side
    titles = []
    clean_svgs = []
    for title, svg in svgs:
        titles.append(_latex_escape(title))
        clean_svg = _strip_background_rects(svg)
        clean_svgs.append(clean_svg)

    titles_js = json.dumps(titles)       # safe JS string array
    svgs_js = json.dumps(clean_svgs)     # safe JS string array

    audio_js = json.dumps(audio_dataurl) if audio_dataurl else "null"

    # Teal button styling; small boxed svg container; title area styled.
    html = f"""
<div id="{uid}" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; color:#0f172a;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
    <button id="{uid}_btn" style="background:#009688;color:white;border:0;padding:8px 12px;border-radius:6px;cursor:pointer;">
      Next view
    </button>
    <div id="{uid}_title" style="font-size:16px;color:#0f172a;"></div>
  </div>
  <div id="{uid}_svgbox" style="display:inline-block;border:1px solid #666;padding:8px;line-height:0;background:#fff;border-radius:4px;max-width:100%;box-shadow:0 0 0 0 rgba(0,0,0,0);">
  </div>
</div>

<script>
(function(){{
  const titles = {titles_js};
  const svgs = {svgs_js};
  const AUDIO_DATA_URL = {audio_js};
  const container = document.getElementById("{uid}");
  const btn = document.getElementById("{uid}_btn");
  const titleEl = document.getElementById("{uid}_title");
  const svgBox = document.getElementById("{uid}_svgbox");

  let idx = 0;
  let clickAudio = null;
  if (AUDIO_DATA_URL) {{
    try {{
      clickAudio = new Audio(AUDIO_DATA_URL);
      clickAudio.preload = 'auto';
      clickAudio.loop = false;
      clickAudio.volume = 1.0;
    }} catch(e) {{
      console.warn('audio create failed', e);
      clickAudio = null;
    }}
  }}

  function render() {{
    // title: attempt to render with MathJax if present, otherwise show plain text
    const t = titles[idx] || "";
    // put the title inside display-math so MathJax renders in display mode
    if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {{
      titleEl.innerHTML = "$$\\\\displaystyle \\\\text{{" + t + "}}$$";
      // request MathJax typesetting on the title element only
      try {{
        window.MathJax.typesetPromise([titleEl]).catch(()=>{{/* ignore */}});
      }} catch(e) {{/* ignore */}}
    }} else {{
      // fallback plain text
      titleEl.textContent = t;
    }}

    // Put the SVG into the box (already cleaned)
    svgBox.innerHTML = svgs[idx] || "";
  }}

  btn.addEventListener('click', function(e) {{
    // Play audio client-side (no kernel round-trip)
    try {{
      if (clickAudio) {{
        clickAudio.pause();
        try {{ clickAudio.currentTime = 0; }} catch(e){{}}
        const p = clickAudio.play();
        if (p && typeof p.catch === 'function') p.catch(()=>{{/* ignore promise rejections (autoplay) */}});
      }}
    }} catch(e) {{ console.warn('play failed', e); }}

    // advance view
    idx = (idx + 1) % svgs.length;
    render();
  }});

  // initial render
  render();

}})();
</script>
"""
    return html


def Step_Orthographic_Render(sketch_name_or_path, audio_filename="click_sound.mp3"):
    """
    Import the STEP file and create the cycling orthographic-view panel.

    Returns an ipywidgets.HTML widget. This function does NOT call display()
    internally to avoid double-rendering in Jupyter. Use it as the last expression
    in a cell or call display(...) yourself.

    sketch_name_or_path : str
      Either the path to the STEP file (with .step) or the base name without extension
      (e.g. "Sketch" or "path/to/Sketch.step").
    """
    # Ensure filename has .step
    if not sketch_name_or_path.lower().endswith(".step"):
        sketch_path = sketch_name_or_path + ".step"
    else:
        sketch_path = sketch_name_or_path

    if not os.path.exists(sketch_path):
        raise FileNotFoundError(f"STEP file not found: {sketch_path}")

    # Import STEP using CadQuery importers
    result = cq.importers.importStep(sketch_path)
    svgs = _generate_orthographic_svgs(result)

    # Attempt to embed audio if available
    audio_dataurl = _embed_audio_b64(audio_filename)

    html_blob = _make_client_side_html(svgs, audio_dataurl=audio_dataurl)
    widget = widgets.HTML(value=html_blob)
    return widget
