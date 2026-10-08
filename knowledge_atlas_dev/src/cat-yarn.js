const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Short hops through actual edges cost less than one giant leap. Replan after
// each landing so scrolling or closing a window cannot leave a stale route.
export function yarnNextHop(scene, rails, goal) {
  const points = rails.map((rail) => ({
    rail,
    x: clamp(goal.x, rail.left, rail.right),
    y: rail.y,
  }));
  const end = points.findIndex((p) => p.rail.id === goal.rail.id);
  if (end < 0) return goal;
  const costs = points.map((p) => distance(scene, p) ** 2 + 4000);
  const previous = points.map(() => -1),
    visited = new Set();
  while (visited.size < points.length) {
    let next = -1;
    for (let i = 0; i < points.length; i++)
      if (!visited.has(i) && (next < 0 || costs[i] < costs[next])) next = i;
    if (next === end) break;
    visited.add(next);
    for (let i = 0; i < points.length; i++) {
      if (visited.has(i)) continue;
      const cost = costs[next] + distance(points[next], points[i]) ** 2 + 4000;
      if (cost < costs[i]) {
        costs[i] = cost;
        previous[i] = next;
      }
    }
  }
  let next = end;
  while (previous[next] !== -1) next = previous[next];
  return points[next];
}

// One local toy, driven by the cat's paused clock. No requests or saved objects.
export class CatYarn {
  constructor(cat, landing) {
    this.cat = cat;
    this.landing = landing;
    this.enabled = true;
    this.ball = null;
  }

  target(point) {
    const c = this.cat;
    const { rail, point: p } = this.landing(
      { x: point.x - 47, y: point.y - 57 },
      c.rails,
      c.width,
      c.height,
    );
    if (!c.rails.some((r) => r.id === rail.id)) c.rails.push(rail);
    return { rail, x: p.x + 47, y: p.y + 57 };
  }

  spawn(point, now) {
    const c = this.cat;
    if (!this.enabled || c.reduced || !c.scene.visible) return false;
    if (["cling", "pounce"].includes(c.scene.pose)) c.returnToRail(now);
    c.pointer = null;
    c.placedUntil = 0;
    c.routine = [];
    this.ball = {
      x: clamp(point.x, 12, c.width - 12),
      y: clamp(point.y, 12, c.height - 15),
      phase: "fall",
      velocity: 0,
      rotation: 0,
      opacity: 1,
      scale: 1,
      round: 0,
      rounds: 2 + Math.floor(c.random() * 2),
      began: now,
    };
    this.destination = this.target(this.ball);
    this.lastTick = now;
    this.expires = now + 60000;
    if (!c.motion && !c.queued) c.enter("watch", now, 300);
    return true;
  }

  stop(now, settle = true) {
    if (!this.ball) return;
    this.ball = null;
    if (settle) this.cat.returnToRail(now);
  }

  setEnabled(enabled, now) {
    this.enabled = enabled;
    if (!enabled) this.stop(now);
  }

  sync(rails, now) {
    const b = this.ball;
    if (!b) return;
    // A resized viewport must not strand an airborne toy below its new floor.
    if (["fall", "toss"].includes(b.phase)) {
      b.x = clamp(b.x, 12, this.cat.width - 12);
      b.y = Math.min(b.y, this.cat.height - 15);
    }
    const old = this.destination.rail;
    const rail = rails.find((r) => r.id === old.id);
    if (
      !rail ||
      (["fall", "toss"].includes(b.phase) && rail.y + 57 < b.y - 2)
    ) {
      this.destination = this.target(b);
      b.phase = "fall";
      b.velocity = 0;
      b.bounced = false;
      b.began = now;
      return;
    }
    const dx = (rail.anchorX ?? rail.left) - (old.anchorX ?? old.left);
    const dy = rail.y - old.y;
    this.destination = {
      rail,
      x: clamp(this.destination.x + dx, rail.left + 47, rail.right + 47),
      y: rail.y + 57,
    };
    if (!["fall", "toss"].includes(b.phase)) {
      b.x = clamp(b.x + dx, rail.left + 47, rail.right + 47);
      b.y += dy;
    }
  }

  tick(now) {
    const b = this.ball,
      c = this.cat;
    if (!b) return;
    const dt = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    if (now > this.expires) {
      this.stop(now);
      return;
    }
    const target = this.destination;
    if (b.phase === "fall") {
      b.y += b.velocity * dt + 0.0015 * dt * dt;
      b.velocity += 0.003 * dt;
      b.x += (target.x - b.x) * (1 - Math.exp(-dt / 100));
      b.rotation += dt * 0.18;
      if (b.y >= target.y) {
        b.y = target.y;
        if (!b.bounced && b.velocity > 0.2) {
          b.bounced = true;
          b.velocity = -Math.min(0.3, b.velocity * 0.3);
        } else {
          b.x = target.x;
          b.phase = "chase";
        }
      }
    } else if (b.phase === "toss") {
      const p = clamp((now - b.began) / b.duration, 0, 1);
      b.x = b.from.x + (target.x - b.from.x) * p;
      b.y = b.from.y + (target.y - b.from.y) * p - Math.sin(p * Math.PI) * 32;
      b.rotation += dt * 0.6;
      if (p === 1) b.phase = "chase";
    } else if (b.phase === "paw") {
      const age = now - b.began;
      b.x = target.x + Math.sin(age / 170) * 3;
      b.rotation = Math.sin(age / 170) * 22;
      if (age >= 1800) {
        b.x = target.x;
        if (b.round++ < b.rounds) {
          // A bat sends it across the edge, then down to another real surface.
          let direction = c.scene.direction;
          if (
            b.x + direction * 150 < 20 ||
            b.x + direction * 150 > c.width - 20
          )
            direction *= -1;
          const point = {
            x: clamp(
              b.x + direction * (130 + c.random() * 110),
              12,
              c.width - 12,
            ),
            y: b.y,
          };
          this.destination = this.target(point);
          b.from = { x: b.x, y: b.y };
          b.began = now;
          b.duration = clamp(distance(b.from, this.destination) * 2, 600, 1200);
          b.phase = "toss";
          c.enter("paw", now, 400);
        } else {
          b.phase = c.random() < 0.5 ? "hide" : "bury";
          b.from = { x: b.x, y: b.y };
          b.began = now;
          c.enter(b.phase === "bury" ? "dig" : "inspect", now, 2000);
        }
      }
    } else if (["hide", "bury"].includes(b.phase)) {
      const p = clamp((now - b.began) / 2000, 0, 1);
      b.x =
        b.from.x +
        (c.scene.x + (c.scene.direction === 1 ? 24 : 70) - b.from.x) * p;
      b.y = target.y + (b.phase === "bury" ? p * 13 : 0);
      b.rotation += dt * 0.15;
      b.scale = 1 - p * 0.7;
      b.opacity = 1 - Math.max(0, (p - 0.35) / 0.65);
      if (p === 1) {
        this.ball = null;
        c.cooldown = now + 4000;
        c.enter("sit", now, 5000);
      }
    }
    if (
      !this.ball ||
      !["chase", "toss"].includes(b.phase) ||
      c.motion ||
      c.queued ||
      now < c.deadline
    )
      return;
    const rail = this.destination.rail;
    const x = clamp(
      this.destination.x - (c.scene.x + 47 <= this.destination.x ? 70 : 24),
      rail.left,
      rail.right,
    );
    if (distance(c.scene, { x, y: rail.y }) > 5) {
      const hop = yarnNextHop(c.scene, c.rails, { rail, x, y: rail.y });
      c.travel(hop.rail, hop.x, now, true);
      // The explicit toy game has its own pace, even for the quiet personality.
      const move = c.motion || c.queued;
      if (move)
        move.duration = clamp(distance(c.scene, move.target) * 2.5, 450, 1400);
    } else if (b.phase === "chase") {
      c.scene.direction = this.destination.x >= c.scene.x + 47 ? 1 : -1;
      b.phase = "paw";
      b.began = now;
      c.enter("paw", now, 1800);
    }
  }
}
