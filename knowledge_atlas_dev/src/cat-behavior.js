import { CAT_PERSONALITIES, catRoutine } from "../shared/cat-personalities.js";
import { CatYarn } from "./cat-yarn.js";
import { stepPetPhysics } from "./cat-physics.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ease = (p) => p * p * (3 - 2 * p);

export const catReducedMotion = (mode = "full", systemReduced = false) =>
  mode === "still" || (mode === "system" && systemReduced);

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

// Prefer the first edge below the paws, never a closer edge above or beside them.
export function catLanding(scene, rails, width, height) {
  const below = rails.filter((r) => r.y >= scene.y);
  const center = scene.x + 47;
  const direct = below.filter(
    (r) =>
      center >= (r.supportLeft ?? r.left + 47) &&
      center <= (r.supportRight ?? r.right + 47),
  );
  const nearby = below.filter(
    (r) => Math.abs(clamp(scene.x, r.left, r.right) - scene.x) <= 48,
  );
  const rail = [...(direct.length ? direct : nearby)].sort(
    (a, b) =>
      a.y - b.y ||
      Math.abs(clamp(scene.x, a.left, a.right) - scene.x) -
        Math.abs(clamp(scene.x, b.left, b.right) - scene.x),
  )[0] || {
    id: "drop-floor",
    left: 0,
    right: Math.max(0, width - 94),
    y: Math.max(0, height - 72),
    anchorX: 0,
  };
  return {
    rail,
    point: {
      x: clamp(scene.x, rail.left, rail.right),
      y: Math.max(scene.y, rail.y),
    },
  };
}

// A narrow button can support the paws while the tail hangs over its edge.
export function catControlInterval(rect, width) {
  const edge = Math.max(0, width - 94);
  if (rect.right - rect.left < 94) {
    const x = clamp((rect.left + rect.right) / 2 - 47, 0, edge);
    return [x, x];
  }
  return [clamp(rect.left, 0, edge), clamp(rect.right - 94, 0, edge)];
}

// Time is supplied by the host so a hidden tab can pause the whole scene.
// Positions always describe the current frame, never the end of a CSS transition.
export class CatBehavior {
  constructor(random = Math.random, personality = "classic") {
    this.random = random;
    this.scene = { x: 0, y: 0, pose: "sit", direction: 1, visible: false };
    this.rails = [];
    this.deadline = Infinity;
    this.cooldown = 0;
    this.step = 0;
    this.width = 1024;
    this.height = 768;
    this.lastTick = 0;
    this.context = "workspace";
    this.contextKey = "";
    this.visited = [];
    this.workUntil = 0;
    this.activity = 0;
    this.yarn = new CatYarn(this, catLanding);
    this.setPersonality(personality, 0);
  }

  get profile() {
    return CAT_PERSONALITIES[this.personality];
  }

  idleDuration() {
    return this.profile.idle[0] + this.random() * this.profile.idle[1];
  }

  setPersonality(value, now) {
    const next = Object.hasOwn(CAT_PERSONALITIES, value) ? value : "classic";
    if (next === this.personality) return;
    this.personality = next;
    this.step = this.activity = 0;
    this.routine = catRoutine(next, this.context);
    this.pointer = null;
    this.cooldown = this.scene.visible ? now + 2000 : 0;
    this.relocate = this.scene.visible;
    if (["pounce", "cling"].includes(this.scene.pose)) this.returnToRail(now);
    else if (!this.motion && !this.queued && !this.held && !this.flight)
      this.enter("sit", now, this.reduced ? Infinity : 1000);
  }

  setContext(kind, key, now) {
    if (key === this.contextKey && kind === this.context) return false;
    const playing = !!this.yarn.ball;
    this.yarn.stop(now, false);
    this.context = kind;
    this.contextKey = key;
    this.routine = catRoutine(this.personality, kind);
    // A new window is interesting once, not on every resize or progress update.
    if (this.personality !== "classic")
      this.cooldown = Math.max(this.cooldown, now + 2500);
    return this.personality !== "classic" || playing;
  }

  preferred(rails, explore = false) {
    if (this.personality === "classic") return rails[0];
    const score = (rail) => {
      const rank = this.profile.surfaces.indexOf(rail.kind);
      return (
        (rank < 0 ? 0 : this.profile.surfaces.length - rank) * 10 +
        (explore && !this.visited.includes(rail.surface || rail.id) ? 80 : 0)
      );
    };
    return [...rails].sort((a, b) => score(b) - score(a))[0];
  }

  enter(pose, now, duration) {
    this.scene.pose = pose;
    this.deadline = now + duration;
    if (pose === "sit") this.point(this.pointer, now);
  }

  get animated() {
    return (
      !!this.flight ||
      !!this.motion ||
      this.scene.pose === "cling" ||
      (!!this.yarn.ball && this.yarn.ball.phase !== "held")
    );
  }

  grab(now) {
    this.held = true;
    this.flight = this.motion = this.queued = null;
    this.pointer = null;
    this.routine = [];
    this.yarn.pauseUntil = Infinity;
    this.enter("held", now, Infinity);
  }

  dragTo(point) {
    Object.assign(this.scene, this.bound(point));
  }

  release(velocity, now) {
    this.held = false;
    this.yarn.pauseUntil = now + 9000;
    this.cooldown = now + 10000;
    this.lastTick = now;
    if (this.reduced) return this.returnToRail(now);
    this.flight = { ...this.scene, ...velocity };
    this.enter("flight", now, Infinity);
  }

  shoo(now) {
    this.held = false;
    this.flight = this.motion = this.queued = null;
    this.pointer = null;
    this.routine = [];
    this.yarn.pauseUntil = now + 12000;
    this.placedUntil = now + 11000;
    this.cooldown = now + 13000;
    const choices = this.rails.flatMap((rail) =>
      [rail.left, rail.right].map((x) => ({ rail, x, y: rail.y })),
    );
    let away =
      choices
        .filter((p) => distance(p, this.scene) >= 160)
        .sort((a, b) => distance(a, this.scene) - distance(b, this.scene))[0] ||
      choices.sort(
        (a, b) => distance(b, this.scene) - distance(a, this.scene),
      )[0];
    if (!away || distance(away, this.scene) < 100) {
      const rail = {
        id: "drop-floor",
        left: 0,
        right: Math.max(0, this.width - 94),
        y: Math.max(0, this.height - 72),
        anchorX: 0,
      };
      const x = this.scene.x < rail.right / 2 ? rail.right : rail.left;
      away = { rail, x, y: rail.y };
      this.rails = [...this.rails.filter((r) => r.id !== rail.id), rail];
    }
    this.travel(away.rail, away.x, now, true);
    const move = this.queued || this.motion;
    if (move)
      this.start(
        {
          ...move,
          duration: clamp(distance(this.scene, move.target) * 2, 450, 1100),
        },
        now,
      );
  }

  get hand() {
    return { x: this.scene.direction === 1 ? 56 : 38, y: 12 };
  }

  get gaze() {
    if (
      this.reduced ||
      !this.pointer ||
      !["sit", "hunt", "peek", "watch", "inspect"].includes(this.scene.pose)
    )
      return { x: 0, y: 0 };
    const dx = this.pointer.x - (this.scene.x + 47);
    const dy = this.pointer.y - (this.scene.y + 30);
    if (Math.hypot(dx, dy) > 280) return { x: 0, y: 0 };
    return {
      x: clamp(dx / 65, -1.6, 1.6) * this.scene.direction,
      y: clamp(dy / 80, -1.2, 1.2),
    };
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
    priority ||= this.relocate;
    this.relocate = false;
    this.width = width ?? this.width;
    this.height = height ?? this.height;
    const previous = this.rails.find((r) => r.id === this.railId);
    if (
      this.railId === "drop-floor" ||
      (this.yarn.ball && this.yarn.destination.rail.id === "drop-floor")
    )
      rails = [
        ...rails,
        {
          id: "drop-floor",
          left: 0,
          right: Math.max(0, this.width - 94),
          y: Math.max(0, this.height - 72),
          anchorX: 0,
        },
      ];
    this.rails = rails;
    this.yarn.sync(rails, now);
    if (this.held || this.flight) {
      Object.assign(this.scene, this.bound(this.scene));
      return;
    }
    if (!rails.length) {
      if (this.motion?.kind === "fall") this.returnToRail(now);
      return;
    }
    if (!this.scene.visible) {
      const rail = this.preferred(rails);
      this.railId = rail.id;
      Object.assign(this.scene, { x: rail.right, y: rail.y, visible: true });
      this.enter("sit", now, this.personality === "classic" ? 5000 : 1200);
      return;
    }
    if (!priority && ["pounce", "cling"].includes(this.scene.pose)) return;
    let current = rails.find((r) => r.id === this.railId);
    // Adding a control can split an edge and renumber its free intervals.
    // Stay on the interval containing our destination, not its old array index.
    if (!priority && previous?.surface) {
      const target = this.motion?.target || this.queued?.target || this.scene;
      const containing = rails.find((r) => {
        const x = target.x + r.anchorX - previous.anchorX;
        return r.surface === previous.surface && x >= r.left && x <= r.right;
      });
      if (containing) current = containing;
    }
    if (
      !priority &&
      this.motion?.kind === "fall" &&
      (!current || current.y < this.scene.y)
    ) {
      this.returnToRail(now);
      return;
    }
    // A perch moving with its scroll container is not a new journey. Preserve
    // pose, deadlines and walking progress, including during a held scrollbar.
    if (!priority && current && previous) {
      this.railId = current.id;
      const dx =
        (current.anchorX ?? current.left) - (previous.anchorX ?? previous.left);
      const dy = current.y - previous.y;
      const move = this.motion || this.queued;
      if (move && ["jump", "fall"].includes(move.kind)) {
        // Keep takeoff fixed while following a moving landing edge.
        move.target.x = clamp(move.target.x + dx, current.left, current.right);
        move.target.y = current.y;
        return;
      }
      this.scene.x += dx;
      this.scene.y += dy;
      if (move) {
        move.target.x += dx;
        move.target.y = current.y;
        if (move.from) {
          move.from.x += dx;
          move.from.y += dy;
        }
      }
      const target = move?.target || this.scene;
      const x = clamp(target.x, current.left, current.right);
      if (Math.abs(target.x - x) > 2) this.travel(current, x, now, true);
      return;
    }
    const rail = priority
      ? this.preferred(rails)
      : current || this.nearest().rail;
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
    this.yarn.stop(now, false);
    this.reduced = reduced;
    this.pointer = null;
    this.motion = this.queued = null;
    this.held = false;
    this.flight = null;
    this.enter("sit", now, reduced ? Infinity : 5000);
    const closest = this.nearest();
    if (closest) {
      Object.assign(this.scene, closest.point);
      this.railId = closest.rail.id;
    }
  }

  travel(rail, x, now, urgent = false, hop = false) {
    const target = this.bound({
      x: clamp(x, rail.left, rail.right),
      y: rail.y,
    });
    this.railId = rail.id;
    const surface = rail.surface || rail.id;
    this.visited = [
      ...this.visited.filter((id) => id !== surface),
      surface,
    ].slice(-4);
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
      hop || Math.abs(target.y - this.scene.y) > 8 || length > 230
        ? "jump"
        : "walk";
    const duration =
      kind === "walk"
        ? clamp(
            length / (0.055 * this.profile.speed),
            600,
            urgent
              ? 1900
              : this.personality === "classic"
                ? 3000
                : 4000 / this.profile.speed,
          )
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
    if (!["pounce", "fall"].includes(move.kind))
      this.scene.direction = move.target.x >= from.x ? 1 : -1;
    this.motion = { ...move, from, began: now };
    this.enter(move.kind, now, move.duration);
  }

  point(point, now) {
    this.pointer = point;
    if (
      !point ||
      this.yarn.ball ||
      this.reduced ||
      !this.scene.visible ||
      now < this.cooldown ||
      !this.profile.cursor ||
      now < this.workUntil ||
      (this.personality !== "classic" &&
        ["transfer", "backups"].includes(this.context))
    )
      return;
    if (!["sit", "groom", "peek", "watch", "inspect"].includes(this.scene.pose))
      return;
    const center = this.scene.x + 47;
    const above = this.scene.y + 20 - point.y;
    if (
      Math.abs(point.x - center) <= this.profile.reach &&
      above >= 10 &&
      above <= 135
    ) {
      this.scene.direction = point.x >= center ? 1 : -1;
      this.enter("hunt", now, this.profile.hunt);
    }
  }

  // Let typing, selection and dragging take priority over the cursor game.
  yieldPointer(now, { typing = false } = {}) {
    if (typing) this.yarn.stop(now);
    this.pointer = null;
    this.cooldown = Math.max(this.cooldown, now + 2000);
    if (typing && !this.reduced && this.personality !== "classic") {
      this.workUntil = now + (this.personality === "quiet" ? 12000 : 6000);
      this.routine = [];
      if (
        !this.motion &&
        !this.queued &&
        !["sleep", "cling", "pounce"].includes(this.scene.pose)
      )
        this.enter("watch", now, this.workUntil - now);
    }
    if (this.scene.pose === "hunt") this.enter("sit", now, 5000);
    else if (["pounce", "cling"].includes(this.scene.pose))
      this.returnToRail(now);
  }

  returnToRail(now) {
    this.held = false;
    this.flight = null;
    this.motion = this.queued = null;
    this.cooldown = now + (this.profile.cooldown || 9000);
    const landing =
      this.findLanding?.() ||
      catLanding(this.scene, this.rails, this.width, this.height);
    this.railId = landing.rail.id;
    // Keep a newly selected control until the host's next geometry refresh.
    this.rails = [
      ...this.rails.filter((r) => r.id !== landing.rail.id),
      landing.rail,
    ];
    this.routine = [];
    this.placedUntil = now + 8000;
    this.lastTick = now;
    this.cooldown = Math.max(this.cooldown, this.placedUntil + 1000);
    if (this.reduced) {
      Object.assign(this.scene, landing.point);
      this.enter("sit", now, Infinity);
    } else
      this.start(
        {
          target: landing.point,
          kind: "fall",
          duration: 1000,
          after: "place",
          velocity: 0,
        },
        now,
      );
  }

  act(action, now) {
    if (
      this.personality !== "classic" &&
      ["journal", "editor", "comments", "settings"].includes(this.context) &&
      ["hop", "explore"].includes(action)
    )
      action = "watch";
    if (
      this.personality !== "classic" &&
      ["transfer", "backups"].includes(this.context) &&
      !["watch", "groom", "sleep"].includes(action)
    )
      action = "sleep";
    if (action === "sleep") {
      this.activity = 0;
      this.enter(
        "sleep",
        now,
        this.profile.sleep[0] + this.random() * this.profile.sleep[1],
      );
    } else if (["groom", "peek", "inspect", "paw", "watch"].includes(action)) {
      const duration = {
        groom: 4500,
        peek: 3500,
        inspect: 3200,
        paw: 2200,
        watch: this.personality === "quiet" ? 14000 : 5000,
      }[action];
      this.activity++;
      this.enter(action, now, duration);
    } else {
      this.activity++;
      const nearest = this.nearest();
      const others = this.rails.filter((r) => r.id !== this.railId);
      const exploring = ["explore", "hop"].includes(action) && others.length;
      const rail = exploring
        ? this.personality === "classic"
          ? others[Math.floor(this.random() * others.length)]
          : this.preferred(others, true)
        : nearest?.rail;
      if (!rail) this.enter("sit", now, 5000);
      else {
        const stride =
          this.profile.stride[0] + this.random() * this.profile.stride[1];
        let x = this.scene.x + (this.random() > 0.5 ? 1 : -1) * stride;
        if (x > rail.right || x < rail.left)
          x = this.scene.x + (x > rail.right ? -1 : 1) * stride;
        x = clamp(x, rail.left, rail.right);
        if (distance(this.scene, { x, y: rail.y }) < 5)
          this.enter("groom", now, 4500);
        else this.travel(rail, x, now, false, action === "hop");
      }
    }
  }

  tick(now) {
    const dt = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    if (!this.scene.visible || this.reduced) return this.scene;
    this.yarn.tick(now);
    if (this.held) return this.scene;
    if (this.flight) {
      const f = this.flight;
      const rail = stepPetPhysics(f, dt, this.rails, {
        width: this.width,
        height: this.height,
      });
      this.scene.x = f.x;
      this.scene.y = f.y;
      if (Math.abs(f.vx) > 0.1) this.scene.direction = f.vx > 0 ? 1 : -1;
      if (rail) {
        this.flight = null;
        this.railId = rail.id;
        if (!this.rails.some((r) => r.id === rail.id)) this.rails.push(rail);
        this.placedUntil = now + 8000;
        this.cooldown = now + 10000;
        this.yarn.pauseUntil = this.placedUntil;
        this.enter("land", now, 400);
      }
      return this.scene;
    }
    if (this.motion) {
      const m = this.motion;
      if (m.kind === "fall") {
        // Gravity keeps progressing when scrolling retargets a moving landing edge.
        const gravity = 0.0025;
        this.scene.y = Math.min(
          m.target.y,
          this.scene.y + m.velocity * dt + (gravity * dt * dt) / 2,
        );
        m.velocity += gravity * dt;
        this.scene.x += (m.target.x - this.scene.x) * (1 - Math.exp(-dt / 55));
        if (
          this.scene.y < m.target.y ||
          Math.abs(this.scene.x - m.target.x) > 0.5
        )
          return this.scene;
        Object.assign(this.scene, m.target);
        this.motion = null;
        this.enter("land", now, 450);
        return this.scene;
      }
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
          this.enter("cling", now, this.profile.cling);
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
    else if (now < this.placedUntil) {
      this.enter("sit", now, this.placedUntil - now);
    } else if (this.yarn.ball) return this.scene;
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
    } else if (this.personality !== "classic" && now < this.workUntil) {
      this.enter("watch", now, this.workUntil - now);
    } else if (this.scene.pose === "sleep") this.enter("wake", now, 1800);
    else if (this.scene.pose !== "sit") {
      if (this.routine.length && this.activity < this.profile.restAfter)
        this.act(this.routine.shift(), now);
      else this.enter("sit", now, this.idleDuration());
    } else {
      const action =
        this.activity >= this.profile.restAfter
          ? "sleep"
          : this.routine.shift() ||
            this.profile.cycle[this.step++ % this.profile.cycle.length];
      this.act(action, now);
    }
    return this.scene;
  }
}
