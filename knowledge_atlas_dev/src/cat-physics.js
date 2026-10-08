const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// Keep the grab offset and estimate a throw from only the last part of a gesture.
// A long pause before release must produce a drop, not replay an old swipe.
export class PetDrag {
  constructor(pointer, body, now) {
    this.start = { x: pointer.x, y: pointer.y };
    this.offset = { x: body.x - pointer.x, y: body.y - pointer.y };
    this.samples = [{ ...this.start, time: now }];
    this.dragged = false;
  }

  move(point, now) {
    this.dragged ||=
      Math.hypot(point.x - this.start.x, point.y - this.start.y) > 6;
    this.samples.push({ x: point.x, y: point.y, time: now });
    this.samples = this.samples.filter((p) => now - p.time <= 100).slice(-24);
    return { x: point.x + this.offset.x, y: point.y + this.offset.y };
  }

  velocity(now) {
    const recent = this.samples.filter((p) => now - p.time <= 100);
    const first = recent[0],
      last = recent.at(-1);
    if (!this.dragged || !first || last.time - first.time < 8)
      return { vx: 0, vy: 0 };
    const elapsed = Math.max(16, now - first.time);
    const vx = (last.x - first.x) / elapsed,
      vy = (last.y - first.y) / elapsed;
    const scale = Math.min(1, 2.8 / Math.hypot(vx, vy));
    return { vx: vx * scale, vy: vy * scale };
  }
}

// Shared, bounded physics for explicit throws. Cat positions are top-left;
// yarn positions are centres. Rails use the existing cat-perch coordinates.
export function stepPetPhysics(
  body,
  elapsed,
  rails,
  { width, height, yarn = false },
) {
  const minX = yarn ? 12 : 0,
    maxX = Math.max(minX, width - (yarn ? 12 : 94));
  const minY = yarn ? 12 : 0,
    maxY = Math.max(minY, height - (yarn ? 15 : 72));
  const offsetY = yarn ? 57 : 0,
    centerX = yarn ? 0 : 47;
  const floor = {
    id: "drop-floor",
    left: 0,
    right: Math.max(0, width - 94),
    y: Math.max(0, height - 72),
    anchorX: 0,
    supportLeft: 0,
    supportRight: width,
  };
  const edges = [...rails.filter((r) => r.id !== "drop-floor"), floor];
  const supports = (rail, x) =>
    x + centerX >= (rail.supportLeft ?? rail.left + 47) - 1 &&
    x + centerX <= (rail.supportRight ?? rail.right + 47) + 1;
  body.x = clamp(body.x, minX, maxX);
  body.y = clamp(body.y, minY, maxY);
  // Small substeps prevent tunnelling through narrow controls at high velocity.
  let remaining = Math.min(64, Math.max(0, elapsed));
  while (remaining > 0) {
    const dt = Math.min(8, remaining);
    remaining -= dt;
    const oldX = body.x,
      oldY = body.y;
    body.x += body.vx * dt;
    body.y += body.vy * dt + ((yarn ? 0.003 : 0.0025) * dt * dt) / 2;
    body.vy += (yarn ? 0.003 : 0.0025) * dt;
    body.vx *= Math.exp(-dt / 4000);
    if (body.x < minX || body.x > maxX) {
      body.x = clamp(body.x, minX, maxX);
      body.vx *= -0.55;
    }
    if (body.y < minY) {
      body.y = minY;
      body.vy = Math.abs(body.vy) * 0.35;
    }
    const hit =
      body.vy >= 0 &&
      edges
        .filter((r) => {
          const y = r.y + offsetY;
          if (y < minY || y > maxY || oldY > y + 0.1 || body.y < y)
            return false;
          const crossing = clamp((y - oldY) / (body.y - oldY || 1), 0, 1);
          return supports(r, oldX + (body.x - oldX) * crossing);
        })
        .sort((a, b) => a.y - b.y)[0];
    if (hit) {
      body.y = hit.y + offsetY;
      body.vy =
        body.vy > (yarn ? 0.18 : 0.32) ? -body.vy * (yarn ? 0.48 : 0.16) : 0;
      body.vx *= Math.exp(-dt / (yarn ? 260 : 90));
      if (!body.vy && Math.abs(body.vx) < 0.025 && supports(hit, body.x)) {
        body.vx = 0;
        // Centre the paws on a narrow button without moving the ball sideways.
        if (!yarn) body.x = clamp(body.x, hit.left, hit.right);
        return hit;
      }
    }
    if (yarn) body.rotation += ((body.x - oldX) * 180) / (Math.PI * 12);
  }
  return null;
}
