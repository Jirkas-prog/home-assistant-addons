import { CAT_PERSONALITIES, catRoutine } from "../shared/cat-personalities.js";

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
    else if (!this.motion && !this.queued)
      this.enter("sit", now, this.reduced ? Infinity : 1000);
  }

  setContext(kind, key, now) {
    if (key === this.contextKey && kind === this.context) return false;
    this.context = kind;
    this.contextKey = key;
    this.routine = catRoutine(this.personality, kind);
    // A new window is interesting once, not on every resize or progress update.
    if (this.personality !== "classic")
      this.cooldown = Math.max(this.cooldown, now + 2500);
    return this.personality !== "classic";
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
    return !!this.motion || this.scene.pose === "cling";
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
    this.rails = rails;
    if (!rails.length) return;
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
    // A perch moving with its scroll container is not a new journey. Preserve
    // pose, deadlines and walking progress, including during a held scrollbar.
    if (!priority && current && previous) {
      this.railId = current.id;
      const dx =
        (current.anchorX ?? current.left) - (previous.anchorX ?? previous.left);
      const dy = current.y - previous.y;
      const move = this.motion || this.queued;
      if (move && move.kind === "jump") {
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
    if (move.kind !== "pounce")
      this.scene.direction = move.target.x >= from.x ? 1 : -1;
    this.motion = { ...move, from, began: now };
    this.enter(move.kind, now, move.duration);
  }

  point(point, now) {
    this.pointer = point;
    if (
      !point ||
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
    this.motion = this.queued = null;
    this.cooldown = now + (this.profile.cooldown || 9000);
    const closest = this.nearest();
    if (closest && closest.score > 2)
      this.travel(closest.rail, closest.point.x, now, true);
    else this.enter("land", now, 450);
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
