import json
import requests
from google.colab import output

API_DEFAULT_BASE = "https://gpt-proxy-github-619255898589.us-central1.run.app"
API_INFER_PATH = "/infer"

_COLAB_CALLBACK_REGISTERED = False


def _register_describe_callback(api_base=API_DEFAULT_BASE):
    """
    Registra el callback 'describe_component_images' una sola vez.
    Nunca lanza excepción hacia Colab: siempre devuelve un dict JSON-safe.
    """
    global _COLAB_CALLBACK_REGISTERED
    if _COLAB_CALLBACK_REGISTERED:
        return

    def describe_component_images(entries):
        """
        entries: lista de objetos {assetKey, image_b64}
        """
        try:
            # Validación básica
            if not isinstance(entries, list):
                return {
                    "ok": False,
                    "error": "entries_not_list",
                    "detail": str(type(entries)),
                }

            images = []
            asset_keys = []
            for e in entries:
                if not isinstance(e, dict):
                    continue
                ak = e.get("assetKey")
                b64 = e.get("image_b64")
                if not ak or not b64:
                    continue
                asset_keys.append(ak)
                images.append({
                    "image_b64": b64,
                    "mime": "image/png",  # ajusta si usas otro formato
                })

            if not images:
                return {
                    "ok": False,
                    "error": "no_valid_images",
                }

            prompt = (
                "Eres un experto en robótica industrial. Para cada imagen de componente, "
                "devuelve una descripción corta, directa y técnica del componente: "
                "qué es, función principal, cómo se monta o conecta. "
                "NO empieces con frases como 'La imagen muestra' ni 'La pieza es'."
            )

            payload = {
                "text": prompt,
                "images": images,
            }

            # Llamada a tu proxy / modelo
            url = api_base.rstrip("/") + API_INFER_PATH
            resp = requests.post(url, json=payload, timeout=90)
            resp.raise_for_status()

            data = resp.json()

            # Aquí asumo que tu API devuelve algo tipo:
            # { "descriptions": ["...", "...", ...] }
            descs = data.get("descriptions") or data.get("choices") or None

            if not descs:
                # No rompemos: devolvemos info cruda para debug
                return {
                    "ok": False,
                    "error": "no_descriptions_in_response",
                    "raw": data,
                }

            # Mapear assetKey -> descripción (alineado al orden de entries/imágenes)
            mapping = {}
            for i, ak in enumerate(asset_keys):
                if i < len(descs):
                    mapping[ak] = str(descs[i]).strip()

            return {
                "ok": True,
                "descriptions": mapping,
            }

        except Exception as e:
            # MUY IMPORTANTE: nunca dejamos que la excepción salga hacia Colab.
            # Así evitamos el "Falla del entorno de ejecución".
            return {
                "ok": False,
                "error": f"{type(e).__name__}",
                "detail": str(e),
            }

    output.register_callback("describe_component_images", describe_component_images)
    _COLAB_CALLBACK_REGISTERED = True


def URDF_Render(
    folder_path,
    select_mode="link",
    background=0xffffff,
    repo="Arthemioxz/AutoMindCloudExperimental",
    branch="main",
    api_base=API_DEFAULT_BASE,
):
    """
    Render del viewer + registro del callback IA.
    Mantén el resto de tu HTML/JS como lo tienes, solo asegúrate
    de llamar a _register_describe_callback(api_base) antes del display(HTML(...))
    """
    _register_describe_callback(api_base)

    # ... aquí va TODO tu HTML del viewer, sin tocar la lógica vieja de ventana ...
    # Asegúrate de que en el JS llames a:
    # google.colab.kernel.invokeFunction("describe_component_images", [entries], {});
    #
    # No pongo todo tu HTML para no pisarte nada, solo este hook es crítico.
    #
    # display(HTML(html_code_generado))
