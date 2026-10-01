// Keep the visible labels and the canvas picking layer in the same coordinates.
export function mapNodeGeometry(node, ctx, scale, selected, hover) {
  const active = node.id === selected;
  const hovered = node.id === hover;
  const hitRadius = Math.max(node.r + 4 / scale, 12 / scale);
  let label = null;
  if (node.depth <= 1 || node.matched || scale > 0.85 || active || hovered) {
    const fontSize = (active ? 14 : 12) / scale;
    const font = `${active || node.depth < 2 ? "600" : "400"} ${fontSize}px Inter, Segoe UI, sans-serif`;
    ctx.font = font;
    const title =
      node.title.length > 30 ? node.title.slice(0, 28) + "…" : node.title;
    const width = ctx.measureText(title).width;
    const side = node.depth === 1 ? (node.x >= 0 ? 1 : -1) : 0;
    const x = node.x + side * (node.r + 9 / scale);
    const y = side ? node.y - fontSize / 2 : node.y + node.r + 9;
    const left = side > 0 ? x : side < 0 ? x - width : x - width / 2;
    label = {
      title,
      font,
      x,
      y,
      align: side > 0 ? "left" : side < 0 ? "right" : "center",
      box: [
        left - 4 / scale,
        y - 2 / scale,
        width + 8 / scale,
        fontSize + 4 / scale,
      ],
    };
  }
  return { active, hovered, hitRadius, label };
}

export function paintMapNodePointer(node, color, ctx, scale, selected, hover) {
  ctx.save();
  const geometry = mapNodeGeometry(node, ctx, scale, selected, hover);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(node.x, node.y, geometry.hitRadius, 0, 2 * Math.PI);
  ctx.fill();
  if (geometry.label) ctx.fillRect(...geometry.label.box);
  ctx.restore();
}

export function pickMapNode2D(nodes, ctx, scale, point, selected, hover) {
  const ranked = nodes
    .map((node) => ({
      node,
      distance: Math.hypot(point.x - node.x, point.y - node.y),
    }))
    .sort((a, b) => a.distance - b.distance);
  // Enlarged targets and labels must never mask another bubble's visible body.
  const body = ranked.find(({ node, distance }) => distance <= node.r);
  if (body) return body.node;
  ctx.save();
  try {
    for (const node of [...nodes].reverse()) {
      const { label } = mapNodeGeometry(node, ctx, scale, selected, hover);
      if (!label) continue;
      const [x, y, width, height] = label.box;
      if (
        point.x >= x &&
        point.x <= x + width &&
        point.y >= y &&
        point.y <= y + height
      )
        return node;
    }
    return (
      ranked.find(
        ({ node, distance }) =>
          distance <= Math.max(node.r + 4 / scale, 12 / scale),
      )?.node || null
    );
  } finally {
    ctx.restore();
  }
}
