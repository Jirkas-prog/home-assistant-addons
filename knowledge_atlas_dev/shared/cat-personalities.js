// Behavior policy, shared with settings validation. All durations are milliseconds.
export const CAT_PERSONALITIES = {
  classic: {
    idle: [4500, 1800],
    sleep: [18000, 14000],
    stride: [75, 55],
    speed: 1,
    cycle: ["walk", "groom", "explore", "peek", "sleep", "walk"],
    cursor: true,
    hunt: 650,
    cling: 3000,
    cooldown: 9000,
    reach: 100,
    surfaces: [],
    restAfter: Infinity,
  },
  quiet: {
    idle: [12000, 8000],
    sleep: [35000, 30000],
    stride: [30, 30],
    speed: 0.65,
    cycle: ["watch", "groom", "sleep", "walk", "watch", "sleep"],
    cursor: false,
    surfaces: ["frame", "reader", "writing"],
    restAfter: 4,
  },
  curious: {
    idle: [4000, 2200],
    sleep: [18000, 12000],
    stride: [65, 60],
    speed: 0.95,
    cycle: ["inspect", "walk", "watch", "explore", "groom", "sleep"],
    cursor: true,
    hunt: 850,
    cling: 2000,
    cooldown: 14000,
    reach: 85,
    surfaces: [
      "reader",
      "writing",
      "calendar",
      "checkpoint",
      "column",
      "frame",
    ],
    restAfter: 7,
  },
  playful: {
    idle: [2800, 1600],
    sleep: [16000, 12000],
    stride: [95, 65],
    speed: 1.2,
    cycle: ["hop", "paw", "explore", "watch", "hop", "groom", "sleep"],
    cursor: true,
    hunt: 450,
    cling: 2500,
    cooldown: 7500,
    reach: 120,
    surfaces: ["tabs", "column", "calendar", "reader", "writing", "frame"],
    restAfter: 8,
  },
};

const CURIOUS_ROUTINES = {
  task: ["inspect", "walk", "watch"],
  journal: ["watch", "groom", "sleep"],
  editor: ["inspect", "watch"],
  attachments: ["inspect", "paw", "peek"],
  document: ["inspect", "watch", "groom"],
  checkpoints: ["inspect", "watch", "paw"],
  comments: ["watch", "groom"],
  activity: ["watch", "walk"],
  calendar: ["walk", "watch", "inspect"],
  timeline: ["watch", "walk", "inspect"],
  board: ["explore", "inspect", "peek"],
  map: ["watch", "explore", "peek"],
  library: ["inspect", "walk", "groom"],
  inventory: ["inspect", "watch"],
  settings: ["watch", "groom"],
  backups: ["watch", "sleep"],
  transfer: ["watch", "sleep"],
};
const PLAYFUL_ROUTINES = {
  task: ["hop", "paw", "watch"],
  journal: ["peek", "groom", "watch"],
  editor: ["peek", "watch"],
  attachments: ["peek", "paw", "hop"],
  document: ["inspect", "paw", "watch"],
  checkpoints: ["paw", "watch", "hop"],
  comments: ["peek", "watch"],
  activity: ["watch", "groom"],
  calendar: ["walk", "paw", "hop"],
  timeline: ["walk", "watch", "hop"],
  board: ["hop", "peek", "explore"],
  map: ["explore", "watch", "hop"],
  library: ["peek", "walk", "inspect"],
  inventory: ["inspect", "paw"],
  settings: ["watch", "groom"],
  backups: ["watch", "groom", "sleep"],
  transfer: ["watch", "sleep"],
};

export function catRoutine(personality, context) {
  if (personality === "classic") return [];
  if (personality === "quiet")
    return ["journal", "document", "transfer", "backups"].includes(context)
      ? ["watch", "sleep"]
      : ["watch", "groom"];
  return [
    ...((personality === "playful" ? PLAYFUL_ROUTINES : CURIOUS_ROUTINES)[
      context
    ] || ["watch", "inspect"]),
  ];
}
