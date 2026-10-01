import test from "node:test";
import assert from "node:assert/strict";
import {
  Scene,
  Group,
  Mesh,
  SphereGeometry,
  PlaneGeometry,
  MeshBasicMaterial,
  PerspectiveCamera,
  Vector3,
} from "three";
import { pickMapNode3D } from "../src/map-picking-3d.js";

const rect = { left: 120, top: 200, width: 800, height: 600 };
function fixture() {
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, rect.width / rect.height, 1, 3000);
  camera.position.z = 700;
  camera.updateMatrixWorld();
  const nodes = [
    { id: "root", depth: 0, x: 0, y: 100, r: 32 },
    { id: "branch", depth: 1, x: -180, y: 0, r: 20 },
    { id: "deep", depth: 8, x: 180, y: -80, r: 1 },
  ];
  const objects = nodes.map((node) => {
    const group = new Group();
    group.userData.atlasNodeId = node.id;
    group.position.set(node.x, node.y, 0);
    const sphere = new Mesh(
      new SphereGeometry(node.r),
      new MeshBasicMaterial(),
    );
    sphere.userData.atlasPart = "bubble";
    group.add(sphere);
    const label = new Mesh(new PlaneGeometry(100, 20), new MeshBasicMaterial());
    label.userData.atlasPart = "label";
    label.position.y = -node.r - 20;
    group.add(label);
    scene.add(group);
    return group;
  });
  function pointAt(object) {
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const point = object.getWorldPosition(new Vector3()).project(camera);
    return {
      clientX: rect.left + ((point.x + 1) * rect.width) / 2,
      clientY: rect.top + ((1 - point.y) * rect.height) / 2,
    };
  }
  const pick = (point, visibleNodes = nodes) =>
    pickMapNode3D({ scene, camera, rect, nodes: visibleNodes, ...point });
  return { scene, camera, nodes, objects, pointAt, pick };
}

test("3D clicks resolve their current coordinates across branches without waiting for hover", () => {
  const { objects, pointAt, pick } = fixture();
  for (const index of [2, 0, 1, 2, 1, 0]) {
    assert.equal(
      pick(pointAt(objects[index])).id,
      objects[index].userData.atlasNodeId,
    );
    assert.equal(
      pick(pointAt(objects[index].children[1])).id,
      objects[index].userData.atlasNodeId,
    );
  }
});

test("3D selection follows a rotated camera and keeps small nodes easy to hit", () => {
  const { camera, objects, pointAt, pick } = fixture();
  camera.position.set(500, 300, 1000);
  camera.lookAt(0, 0, 0);
  const point = pointAt(objects[2]);
  assert.equal(pick({ ...point, clientX: point.clientX + 10 }).id, "deep");
  assert.equal(pick({ ...point, clientX: point.clientX + 13 }), null);
  camera.position.set(-600, -150, 900);
  camera.lookAt(0, 0, 0);
  assert.equal(pick(pointAt(objects[0])).id, "root");
});

test("3D picking prioritizes a sphere over labels and ignores filtered or hidden nodes", () => {
  const { scene, nodes, objects, pointAt, pick } = fixture();
  const coveringLabel = objects[1].children[1];
  coveringLabel.position.set(180, (100 * 600) / 700, 100);
  const point = pointAt(objects[0]);
  assert.equal(pick(point).id, "root");
  coveringLabel.visible = false;
  // The picker receives only the records currently displayed in the map.
  assert.equal(pick(point, nodes.slice(1)), null);
  const hiddenParent = new Group();
  scene.add(hiddenParent);
  hiddenParent.add(objects[0]);
  hiddenParent.visible = false;
  assert.equal(pick(point), null);
  assert.equal(pick({ clientX: rect.left - 1, clientY: rect.top }), null);
  assert.equal(
    pick({ clientX: rect.left + rect.width + 1, clientY: rect.top }),
    null,
  );
});
