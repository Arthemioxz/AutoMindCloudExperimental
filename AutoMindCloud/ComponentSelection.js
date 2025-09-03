<div id="app" style="width:100%; height:100vh;"></div>
<script>
  // Load THREE + OrbitControls + STLLoader + ColladaLoader before this
  const viewer = URDFViewer.render({
    container: document.getElementById('app'),
    urdfContent: myURDFString,
    meshDB: myMeshDB,
    uiMount: 'body', // (default) forces the button on the body overlay so it's always visible
    // descriptions: { "link_name_here": "Custom text..." }
  });
// viewer.openGallery(); // optional: open programmatically
</script>
