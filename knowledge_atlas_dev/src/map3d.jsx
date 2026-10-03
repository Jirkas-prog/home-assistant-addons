import React, { useCallback, useEffect, useMemo, useRef } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import { pickMapNode3D, prioritizeMapLabel } from "./map-picking-3d.js";
import { labelEligible, declutterLabels } from "./map-labels.js";

export default function Map3D({
  data,
  size,
  selected,
  onSelect,
  relations,
  graphRef,
  onDrag,
  onDragEnd,
  dragDisabled,
}) {
  const objects = useRef(new Map()),
    hover = useRef(null),
    fitted = useRef(false);
  const textMeasure = useMemo(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = "13px Arial";
    return ctx;
  }, []);
  const sphere = useMemo(() => new THREE.SphereGeometry(1, 12, 8), []);
  const graph = useMemo(
    () => ({
      nodes: data.nodes.map((n) => ({ ...n, z: n.fz })),
      links: data.links.map((l) => ({
        ...l,
        source: typeof l.source === "object" ? l.source.id : l.source,
        target: typeof l.target === "object" ? l.target.id : l.target,
      })),
    }),
    [data],
  );
  useEffect(() => () => sphere.dispose(), [sphere]);
  useEffect(() => {
    const controls = graphRef.current?.controls();
    if (!controls) return;
    const previous = controls.zoomSpeed;
    controls.zoomSpeed = previous * 1.25;
    return () => {
      controls.zoomSpeed = previous;
    };
  }, [graphRef]);
  const nodeObject = useCallback(
    (n) => {
      const group = new THREE.Group();
      group.userData.atlasNodeId = n.id;
      const bubble = new THREE.Mesh(
        sphere,
        new THREE.MeshPhongMaterial({
          color: n.color,
          shininess: 70,
          emissive: n.color,
          emissiveIntensity: 0.14,
          transparent: true,
        }),
      );
      bubble.scale.setScalar(n.r);
      bubble.userData.atlasPart = "bubble";
      group.add(bubble);
      objects.current.set(n.id, { group, bubble, label: null });
      return group;
    },
    [sphere],
  );

  useEffect(() => {
    let frame;
    const liveIds = new Set(graph.nodes.map((n) => n.id));
    for (const id of objects.current.keys())
      if (!liveIds.has(id)) objects.current.delete(id);
    const world = new THREE.Vector3(),
      view = new THREE.Vector3(),
      offset = new THREE.Vector3();
    const update = () => {
      const instance = graphRef.current;
      if (instance) {
        const camera = instance.camera();
        if (!fitted.current && graph.nodes.length && objects.current.size) {
          instance.cameraPosition(
            { x: 500, y: 350, z: 850 },
            { x: 0, y: 0, z: 0 },
            0,
          );
          instance.zoomToFit(0, 45);
          fitted.current = true;
        }
        camera.updateMatrixWorld();
        const candidates = [],
          pixels = new Map();
        for (const n of graph.nodes) {
          const object = objects.current.get(n.id);
          if (!object?.group.parent) continue;
          world.set(n.x, n.y, n.z);
          view.copy(world).applyMatrix4(camera.matrixWorldInverse);
          const scale =
            size.height /
            (2 *
              Math.max(0.001, -view.z) *
              Math.tan((camera.fov * Math.PI) / 360));
          pixels.set(n.id, scale);
          object.bubble.scale.setScalar(Math.max(n.r, 0.8 / scale));
          object.bubble.material.opacity = n.context
            ? 0.25
            : n.r * scale > 80 && n.id !== selected && n.id !== hover.current
              ? 0.18
              : 1;
          object.bubble.material.color.set(n.color);
          object.bubble.material.emissive.set(n.color);
          object.bubble.material.emissiveIntensity =
            n.id === selected ? 0.6 : 0.14;
          const projected = world.clone().project(camera);
          if (
            view.z >= 0 ||
            projected.z < -1 ||
            projected.z > 1 ||
            !labelEligible(n, scale, selected, hover.current)
          )
            continue;
          const title =
            n.title.length > 32 ? n.title.slice(0, 30) + "…" : n.title;
          const width = textMeasure.measureText(title).width + 12;
          candidates.push({
            node: n,
            box: [
              ((projected.x + 1) * size.width) / 2 - width / 2,
              ((1 - projected.y) * size.height) / 2 + n.r * scale + 6,
              width,
              20,
            ],
          });
        }
        const labels = declutterLabels(
          candidates,
          size.width,
          size.height,
          selected,
          hover.current,
        );
        for (const n of graph.nodes) {
          const object = objects.current.get(n.id);
          if (!object) continue;
          const visible = labels.has(n.id),
            scale = pixels.get(n.id);
          if (visible && !object.label) {
            const label = new SpriteText(
              n.title.length > 32 ? n.title.slice(0, 30) + "…" : n.title,
              13,
              "#e6eaf2",
            );
            label.backgroundColor = "#11151ce8";
            label.padding = [4, 2];
            label.material.depthTest = false;
            label.userData.atlasPart = "label";
            prioritizeMapLabel(label);
            object.label = label;
            object.labelScale = label.scale.clone();
            object.group.add(label);
          }
          if (object.label) {
            const title =
              n.title.length > 32 ? n.title.slice(0, 30) + "…" : n.title;
            if (object.label.text !== title) {
              object.label.text = title;
              object.labelScale = object.label.scale.clone();
            }
            object.label.visible = visible;
            if (visible && scale) {
              // Transform the sprite without regenerating its text texture on zoom.
              object.label.scale
                .copy(object.labelScale)
                .multiplyScalar(1 / scale);
              offset
                .set(0, -n.r - 16 / scale, 0)
                .applyQuaternion(camera.quaternion);
              object.label.position.copy(offset);
            }
          }
        }
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [graph, graphRef, selected, size]);

  const selectAtClick = (event) => {
    const instance = graphRef.current;
    if (!instance) return;
    onSelect(
      pickMapNode3D({
        scene: instance.scene(),
        camera: instance.camera(),
        rect: instance.renderer().domElement.getBoundingClientRect(),
        nodes: graph.nodes,
        clientX: event.clientX,
        clientY: event.clientY,
      }),
      event,
    );
  };
  return (
    <ForceGraph3D
      ref={graphRef}
      graphData={graph}
      width={size.width}
      height={size.height}
      backgroundColor="#11151c"
      showNavInfo={false}
      enableNodeDrag={!dragDisabled}
      onNodeDrag={(node) => {
        onDrag(node, graph.nodes);
        for (const n of graph.nodes)
          objects.current.get(n.id)?.group.position.set(n.x, n.y, n.z);
      }}
      onNodeDragEnd={(node) => onDragEnd(node, graph.nodes)}
      cooldownTicks={0}
      nodeLabel={(n) => {
        const el = document.createElement("span");
        el.textContent = n.title;
        return el;
      }}
      onNodeClick={(_, event) => selectAtClick(event)}
      onLinkClick={(_, event) => selectAtClick(event)}
      onBackgroundClick={selectAtClick}
      onNodeHover={(n) => {
        hover.current = n?.id;
      }}
      showPointerCursor={(node) => !!node}
      nodeThreeObject={nodeObject}
      linkVisibility={(l) => relations || l.kind === "tree"}
      linkColor={(l) => (l.kind === "tree" ? l.color : "#72829c")}
      linkOpacity={0.25}
      linkWidth={0}
    />
  );
}
