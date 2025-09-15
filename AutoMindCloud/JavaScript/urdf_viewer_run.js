/* urdf_viewer_run.js
   Requires:
     - THREE (global)
     - THREE.OrbitControls
     - THREE.STLLoader
     - THREE.ColladaLoader
     - URDFLoader (global)
     - window.URDFViewer (from urdf_viewer_lib.js)
*/

(function(){
  // Create/find a container
  const container = document.getElementById('urdf-viewer') || (() => {
    const d = document.createElement('div');
    d.id = 'urdf-viewer';
    Object.assign(d.style, {
      width: '100%',
      height: '540px',
      position: 'relative',
      border: '1px solid #e5e7eb',
      borderRadius: '14px',
      overflow: 'hidden'
    });
    document.body.appendChild(d);
    return d;
  })();

  // Provide your URDF string and (optionally) meshDB with base64 assets
  const urdfContent = window.AMC_URDF || `<?xml version="1.0"?>
<robot name="demo">
  <link name="base"/>
  <joint name="j1" type="revolute">
    <parent link="base"/>
    <child link="arm"/>
    <origin rpy="0 0 0" xyz="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-1.57" upper="1.57" effort="1" velocity="1"/>
  </joint>
  <link name="arm"/>
</robot>`;

  // If you have base64 meshes, expose them here, e.g.:
  // window.AMC_MESH_DB = {
  //   "package://robot/meshes/arm.dae": "<base64>",
  //   "robot/meshes/arm.stl": "<base64>",
  // };

  const viewer = window.URDFViewer.render({
    container,
    urdfContent,
    meshDB: window.AMC_MESH_DB || {},
    background: 0xf0f0f0,
    selectMode: 'link',
    hover: { enabled:true, color:0x9e9e9e, opacity:0.35, throttleMs:16 },
    descriptions: window.AMC_DESCRIPTIONS || {}
  });

  // Expose for debugging
  window.__urdf_viewer = viewer;
})();
