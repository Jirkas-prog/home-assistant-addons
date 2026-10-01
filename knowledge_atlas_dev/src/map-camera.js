// Restore the view without selecting a record, changing scope or refitting the graph.
export function preserveMapCamera(graph, mode) {
  if (!graph) return () => {};
  if (mode === "2d") {
    const zoom = graph.zoom(),
      center = graph.centerAt();
    return () => {
      graph.zoom(zoom, 0);
      graph.centerAt(center.x, center.y, 0);
    };
  }
  const camera = graph.camera(),
    controls = graph.controls();
  const position = camera.position.clone(),
    up = camera.up.clone(),
    quaternion = camera.quaternion.clone();
  const target = controls.target?.clone();
  const enabled = controls.enabled;
  // Clear residual trackball motion before suspending input behind the document.
  const staticMoving = controls.staticMoving;
  controls.staticMoving = true;
  controls.update?.();
  controls.enabled = false;
  const restore = () => {
    camera.position.copy(position);
    camera.up.copy(up);
    camera.quaternion.copy(quaternion);
    if (target) controls.target.copy(target);
    camera.updateMatrixWorld();
  };
  restore();
  return () => {
    restore();
    controls.staticMoving = staticMoving;
    controls.enabled = enabled;
  };
}
