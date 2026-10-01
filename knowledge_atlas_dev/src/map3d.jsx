import React, { useEffect, useMemo } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import { pickMapNode3D } from "./map-picking-3d.js";
export default function Map3D({
  data,
  size,
  selected,
  onSelect,
  relations,
  graphRef,
}) {
  const graph = useMemo(
    () => ({
      nodes: data.nodes.map((n) => ({
        ...n,
        z: n.fz,
      })),
      links: data.links.map((l) => ({
        ...l,
        source: typeof l.source === "object" ? l.source.id : l.source,
        target: typeof l.target === "object" ? l.target.id : l.target,
      })),
    }),
    [data],
  );
  useEffect(() => {
    const controls = graphRef.current?.controls();
    if (!controls) return;
    const previous = controls.zoomSpeed;
    controls.zoomSpeed = previous * 1.25;
    return () => {
      controls.zoomSpeed = previous;
    };
  }, [graphRef]);
  const selectAtClick = (event) => {
    const instance = graphRef.current;
    if (!instance) return;
    const node = pickMapNode3D({
      scene: instance.scene(),
      camera: instance.camera(),
      rect: instance.renderer().domElement.getBoundingClientRect(),
      nodes: graph.nodes,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    onSelect(node, event);
  };
  return (
    <ForceGraph3D
      ref={graphRef}
      graphData={graph}
      width={size.width}
      height={size.height}
      backgroundColor="#11151c"
      showNavInfo={false}
      enableNodeDrag={false}
      cooldownTicks={0}
      nodeLabel={(n) => {
        const el = document.createElement("span");
        el.textContent = n.title;
        return el;
      }}
      onNodeClick={(_, event) => selectAtClick(event)}
      onLinkClick={(_, event) => selectAtClick(event)}
      onBackgroundClick={selectAtClick}
      showPointerCursor={(node) => !!node}
      nodeThreeObject={(n) => {
        const group = new THREE.Group();
        group.userData.atlasNodeId = n.id;
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(n.r, 24, 20),
          new THREE.MeshPhongMaterial({
            color: n.color,
            shininess: 70,
            emissive: n.color,
            emissiveIntensity: n.id === selected ? 0.5 : 0.14,
          }),
        );
        mesh.userData.atlasPart = "bubble";
        group.add(mesh);
        if (n.depth < 3 || n.id === selected) {
          const label = new SpriteText(n.title);
          label.color = n.id === selected ? "#ffffff" : "#c6cedb";
          label.textHeight = n.depth < 2 ? 18 : 14;
          label.backgroundColor = "#11151cdd";
          label.padding = 2;
          label.position.y = -n.r - 12;
          label.userData.atlasPart = "label";
          group.add(label);
        }
        if (n.id === selected) {
          const halo = new THREE.Mesh(
            new THREE.SphereGeometry(n.r + 4, 24, 20),
            new THREE.MeshBasicMaterial({
              color: n.color,
              wireframe: true,
              transparent: true,
              opacity: 0.16,
            }),
          );
          halo.raycast = () => {};
          group.add(halo);
        }
        return group;
      }}
      linkVisibility={(l) => relations || l.kind === "tree"}
      linkColor={(l) => (l.kind === "tree" ? l.color : "#72829c")}
      linkOpacity={0.4}
      linkWidth={(l) => (l.kind === "tree" ? 0.8 : 0.35)}
    />
  );
}
