import { Raycaster, Vector2, Vector3 } from "three";

// Resolve the current click, never the renderer's throttled hover result.
export function pickMapNode3D({
  scene,
  camera,
  rect,
  nodes,
  clientX,
  clientY,
}) {
  if (!rect.width || !rect.height) return null;
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
  const records = new Map(nodes.map((node) => [node.id, node]));
  const objects = [];
  scene.traverseVisible((object) => {
    if (records.has(object.userData.atlasNodeId)) objects.push(object);
  });
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(
    new Vector2((x / rect.width) * 2 - 1, 1 - (y / rect.height) * 2),
    camera,
  );
  const hits = raycaster
    .intersectObjects(objects, true)
    .filter(({ object }) => {
      for (let current = object; current; current = current.parent) {
        if (!current.visible) return false;
      }
      return true;
    });
  // A label or decorative halo must not block another visible sphere.
  const hit =
    hits.find(({ object }) => object.userData.atlasPart === "bubble") ||
    hits.find(({ object }) => object.userData.atlasPart === "label");
  if (hit) {
    let object = hit.object;
    while (object && !records.has(object.userData.atlasNodeId))
      object = object.parent;
    if (object) return records.get(object.userData.atlasNodeId);
  }
  // Small distant spheres retain a minimum 24-pixel target as the camera moves.
  let nearest = null;
  let distance = Infinity;
  for (const object of objects) {
    const point = object.getWorldPosition(new Vector3()).project(camera);
    if (point.z < -1 || point.z > 1) continue;
    const dx = ((point.x + 1) * rect.width) / 2 - x;
    const dy = ((1 - point.y) * rect.height) / 2 - y;
    const pixels = Math.hypot(dx, dy);
    if (pixels <= 12 && pixels < distance) {
      distance = pixels;
      nearest = records.get(object.userData.atlasNodeId);
    }
  }
  return nearest;
}
