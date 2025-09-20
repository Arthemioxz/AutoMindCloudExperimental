import sympy  # requested import
import gdown
import cascadio
import trimesh
import base64
from IPython.display import display, HTML
import os

def Download_Step(Drive_Link, Output_Name):
    """
    Downloads a STEP file from Google Drive using the full Drive link.
    Saves it as Output_Name.step in /content.
    """
    root_dir = "/content"
    file_id = Drive_Link.split('/d/')[1].split('/')[0]  # Extract ID from full link
    url = f"https://drive.google.com/uc?id={file_id}"
    output_step = os.path.join(root_dir, Output_Name + ".step")
    gdown.download(url, output_step, quiet=True)

def Step_Render(Step_Name):
    output_step = Step_Name + ".step"
    output_glb = Step_Name + ".glb"
    output_glb_scaled = Step_Name + "_scaled.glb"

    # STEP → GLB
    _ = cascadio.step_to_glb(output_step, output_glb)

    # Scale GLB to ~2.0 units
    mesh = trimesh.load(output_glb)
    TARGET_SIZE = 2.0
    current_size = max(mesh.extents) if hasattr(mesh, "extents") else 1.0
    if current_size <= 0: current_size = 1.0
    mesh.apply_scale(TARGET_SIZE / current_size)
    mesh.export(output_glb_scaled)

    # Embed GLB as base64
    with open(output_glb_scaled, "rb") as f:
        glb_base64 = base64.b64encode(f.read()).decode("utf-8")

    html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{Step_Name} 3D Viewer</title>
<style>
  body {{ margin:0; overflow:hidden; background:#fff; }}
  canvas {{ display:block; width:100vw; height:100vh; }}
  .badge {{
    position:absolute; bottom:12px; right:14px; z-index:10;
    user-select:none; pointer-events:none;
  }}
  .badge img {{ max-height:40px; display:block; }}
</style>
</head>
<body>
  <div class="badge">
    <img src="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png" alt="badge">
  </div>

  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/GLTFLoader.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js"></script>
  <script>
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.01, 10000);
    camera.position.set(0,0,3);

    const renderer = new THREE.WebGLRenderer({antialias:true});
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = false; // start with NO SHADOWS
    document.body.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.06;

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0xeeeeee, 0.7);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.05);
    dirLight.position.set(3,4,2);
    dirLight.castShadow = false; // no shadows initially
    scene.add(hemi); scene.add(dirLight);

    // Base64 → ArrayBuffer
    function base64ToArrayBuffer(base64) {{
      const bin = atob(base64); const len = bin.length; const bytes = new Uint8Array(len);
      for (let i=0;i<len;i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    }}

    const glbBase64 = "{glb_base64}";
    const loader = new THREE.GLTFLoader();
    loader.parse(base64ToArrayBuffer(glbBase64), '', function(gltf){{
      const model = gltf.scene;
      model.traverse(n=>{{ if(n.isMesh) n.material.side=THREE.DoubleSide; }});
      scene.add(model);

      // Center and zoom (factor = 1.9)
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);

      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x,size.y,size.z)||1;
      const dist = maxDim * 1.9;
      camera.position.set(dist, dist*0.9, dist);
      controls.target.set(0,0,0);
      controls.update();
    }});

    function animate(){{
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene,camera);
    }}
    animate();

    window.addEventListener('resize', () => {{
      camera.aspect = window.innerWidth/window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }});
  </script>
</body>
</html>
"""
    display(HTML(html))
