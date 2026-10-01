import React, { useMemo } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
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
      onNodeClick={onSelect}
      nodeThreeObject={(n) => {
        const group = new THREE.Group();
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(n.r, 24, 20),
          new THREE.MeshPhongMaterial({
            color: n.color,
            shininess: 70,
            emissive: n.color,
            emissiveIntensity: n.id === selected ? 0.5 : 0.14,
          }),
        );
        group.add(mesh);
        if (n.depth < 3 || n.id === selected) {
          const label = new SpriteText(n.title);
          label.color = n.id === selected ? "#ffffff" : "#c6cedb";
          label.textHeight = n.depth < 2 ? 18 : 14;
          label.backgroundColor = "#11151cdd";
          label.padding = 2;
          label.position.y = -n.r - 12;
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
