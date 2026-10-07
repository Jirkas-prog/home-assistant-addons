const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ease = (p) => p * p * (3 - 2 * p);

// Intervals contain the cat's left edge; subtract its width as well as the control.
export function catFreeIntervals(left, right, y, obstacles) {
  let intervals = right >= left ? [[left, right]] : [];
  for (const b of obstacles) {
    if (!b.width || b.bottom <= y + 4 || b.top >= y + 64) continue;
    const from = b.left - 100,
      to = b.right + 6;
    intervals = intervals.flatMap(([a, z]) =>
      to <= a || from >= z
        ? [[a, z]]
        : [
            [a, Math.min(z, from)],
            [Math.max(a, to), z],
          ].filter(([a, z]) => z >= a),
    );
  }
  return intervals;
}

// Time is supplied by the host so a hidden tab can pause the whole scene.
// Positions always describe the current frame, never the end of a CSS transition.
export class CatBehavior {
  constructor(random = Math.random) {
    this.random = random;
    this.scene = { x: 0, y: 0, pose: "sit", direction: 1, visible: false };
    this.rails = [];
    this.deadline = Infinity;
    this.cooldown = 0;
    this.step = 0;
    this.width = 1024;
    this.height = 768;
    this.lastTick = 0;
  }

  enter(pose, now, duration) {
    this.scene.pose = pose;
    this.deadline = now + duration;
    if (pose === "sit") this.point(this.pointer, now);
  }

  get animated() {
    return !!this.motion || this.scene.pose === "cling";
  }

  get hand() {
    return { x: this.scene.direction === 1 ? 56 : 38, y: 12 };
  }

  bound(point) {
    return {
      x: clamp(point.x, 0, Math.max(0, this.width - 94)),
      y: clamp(point.y, 0, Math.max(0, this.height - 72)),
    };
  }

  nearest() {
    return this.rails.reduce((best, rail) => {
      const point = {
        x: clamp(this.scene.x, rail.left, rail.right),
        y: rail.y,
      };
      const score = distance(point, this.scene);
      return !best || score < best.score ? { rail, point, score } : best;
    }, null);
  }

  setRails(rails, now, { width, height, priority = false } = {}) {
    this.width = width ?? this.width;
    this.height = height ?? this.height;
    this.rails = rails;
    if (!rails.length) return;
    if (!this.scene.visible) {
      const rail = rails[0];
      this.railId = rail.id;
      Object.assign(this.scene, { x: rail.right, y: rail.y, visible: true });
      this.enter("sit", now, 5000);
      return;
    }
    if (!priority && ["hunt", "pounce", "cling"].includes(this.scene.pose))
      return;
    const current = rails.find((r) => r.id === this.railId);
    const rail = priority ? rails[0] : current || this.nearest().rail;
    const target = this.motion?.target || this.queued?.target || this.scene;
    const x = clamp(target.x, rail.left, rail.right);
    if (
      priority ||
      !current ||
      Math.abs(target.y - rail.y) > 2 ||
      Math.abs(target.x - x) > 2
    ) {
      this.travel(rail, x, now, true);
    }
  }

  setReduced(reduced, now) {
    this.reduced = reduced;
    this.pointer = null;
    this.motion = this.queued = null;
    this.enter("sit", now, reduced ? Infinity : 5000);
    const closest = this.nearest();
    if (closest) {
      Object.assign(this.scene, closest.point);
      this.railId = closest.rail.id;
    }
  }

  travel(rail, x, now, urgent = false) {
    const target = this.bound({
      x: clamp(x, rail.left, rail.right),
      y: rail.y,
    });
    this.railId = rail.id;
    if (this.reduced) {
      Object.assign(this.scene, target);
      this.motion = this.queued = null;
      this.enter("sit", now, Infinity);
      return;
    }
    const length = distance(this.scene, target);
    if (length < 2) {
      this.motion = this.queued = null;
      this.enter("sit", now, 5000);
      return;
    }
    const kind =
      Math.abs(target.y - this.scene.y) > 8 || length > 230 ? "jump" : "walk";
    const duration =
      kind === "walk"
        ? clamp(length / 0.055, 600, urgent ? 1900 : 3000)
        : clamp(length * 1.5, 650, 1900);
    const move = { target, kind, duration, after: "land" };
    // A layout change retargets from this exact frame, without hiding or snapping.
    if (this.motion || this.scene.pose === "cling") this.start(move, now);
    else {
      this.queued = move;
      this.enter(kind === "walk" ? "rise" : "crouch", now, 300);
    }
  }

  start(move, now) {
    const from = { x: this.scene.x, y: this.scene.y };
    this.queued = null;
    if (move.kind !== "pounce")
      this.scene.direction = move.target.x >= from.x ? 1 : -1;
    this.motion = { ...move, from, began: now };
    this.enter(move.kind, now, move.duration);
  }

  point(point, now) {
    this.pointer = point;
    if (!point || this.reduced || !this.scene.visible || now < this.cooldown)
      return;
    if (!["sit", "groom", "peek"].includes(this.scene.pose)) return;
    const center = this.scene.x + 47;
    const above = this.scene.y + 20 - point.y;
    if (Math.abs(point.x - center) <= 100 && above >= 10 && above <= 135) {
      this.scene.direction = point.x >= center ? 1 : -1;
      this.enter("hunt", now, 650);
    }
  }

  returnToRail(now) {
    this.motion = this.queued = null;
    this.cooldown = now + 9000;
    const closest = this.nearest();
    if (closest && closest.score > 2)
      this.travel(closest.rail, closest.point.x, now, true);
    else this.enter("land", now, 450);
  }

  tick(now) {
    const dt = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    if (!this.scene.visible || this.reduced) return this.scene;
    if (this.motion) {
      const m = this.motion;
      const p = clamp((now - m.began) / m.duration, 0, 1);
      const t = ease(p);
      const arc =
        m.kind === "walk"
          ? 0
          : Math.min(
              90,
              28 + distance(m.from, m.target) * 0.12,
              Math.max(0, Math.min(m.from.y, m.target.y)),
            );
      this.scene.x = m.from.x + (m.target.x - m.from.x) * t;
      this.scene.y =
        m.from.y + (m.target.y - m.from.y) * t - Math.sin(Math.PI * p) * arc;
      if (p < 1) return this.scene;
      Object.assign(this.scene, m.target);
      this.motion = null;
      if (m.after === "catch") {
        const hand = {
          x: this.scene.x + this.hand.x,
          y: this.scene.y + this.hand.y,
        };
        if (this.pointer && distance(hand, this.pointer) < 24)
          this.enter("cling", now, 3000);
        else this.returnToRail(now);
      } else this.enter("land", now, 400);
      return this.scene;
    }
    if (this.scene.pose === "cling") {
      if (!this.pointer || now >= this.deadline) this.returnToRail(now);
      else {
        const target = this.bound({
          x: this.pointer.x - this.hand.x,
          y: this.pointer.y - this.hand.y,
        });
        const follow = 1 - Math.exp(-dt / 55);
        this.scene.x += (target.x - this.scene.x) * follow;
        this.scene.y += (target.y - this.scene.y) * follow;
      }
      return this.scene;
    }
    if (now < this.deadline) return this.scene;
    if (this.queued) this.start(this.queued, now);
    else if (this.scene.pose === "hunt") {
      const pointer = this.pointer;
      if (
        !pointer ||
        distance(pointer, { x: this.scene.x + 47, y: this.scene.y + 20 }) > 180
      ) {
        this.cooldown = now + 4000;
        this.enter("sit", now, 5000);
      } else {
        // Lock the destination at takeoff: an escaping cursor must really escape.
        const target = this.bound({
          x: pointer.x - this.hand.x,
          y: pointer.y - this.hand.y,
        });
        this.start(
          { target, kind: "pounce", duration: 650, after: "catch" },
          now,
        );
      }
    } else if (this.scene.pose === "sleep") this.enter("wake", now, 1800);
    else if (this.scene.pose !== "sit")
      this.enter("sit", now, 4500 + this.random() * 1800);
    else {
      const action = ["walk", "groom", "explore", "peek", "sleep", "walk"][
        this.step++ % 6
      ];
      if (action === "sleep")
        this.enter("sleep", now, 18000 + this.random() * 14000);
      else if (action === "groom") this.enter("groom", now, 4500);
      else if (action === "peek") this.enter("peek", now, 3500);
      else {
        const nearest = this.nearest();
        const others = this.rails.filter((r) => r.id !== this.railId);
        const rail =
          action === "explore" && others.length
            ? others[Math.floor(this.random() * others.length)]
            : nearest?.rail;
        if (!rail) this.enter("sit", now, 5000);
        else {
          const stride = 75 + this.random() * 55;
          let x = this.scene.x + (this.random() > 0.5 ? 1 : -1) * stride;
          if (x > rail.right || x < rail.left)
            x = this.scene.x + (x > rail.right ? -1 : 1) * stride;
          x = clamp(x, rail.left, rail.right);
          if (distance(this.scene, { x, y: rail.y }) < 5)
            this.enter("groom", now, 4500);
          else this.travel(rail, x, now);
        }
      }
    }
    return this.scene;
  }
}
