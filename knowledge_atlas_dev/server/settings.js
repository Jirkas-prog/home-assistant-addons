import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fail } from "./store.js";
import { historyDirectory } from "./file-safety.js";
import { validateLocationTree } from "../shared/locations.js";
import { TASK_VIEWS, CALENDAR_VIEWS } from "../shared/task-workflow.js";
import { CAT_PERSONALITIES } from "../shared/cat-personalities.js";
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export function locationId(resource) {
  return (
    resource.locationId ||
    (resource.url || /^https?:\/\//i.test(resource.path || "")
      ? "internet"
      : "pc")
  );
}
export class Settings {
  constructor(directory, ingress, documentRoot) {
    this.file = path.join(directory, "settings.json");
    this.defaults = {
      schema: 1,
      libraryId: randomUUID(),
      language: "en",
      languageSelectionCompleted: true,
      catEnabled: true,
      catMotion: "full",
      catPersonality: "classic",
      catYarnEnabled: true,
      taskDefaultView: "timeline",
      taskCalendarView: "month",
      documentRoot:
        documentRoot ||
        process.env.DOCUMENT_ROOT ||
        (ingress ? "/config/documents" : path.join(directory, "documents")),
      locations: [
        {
          id: "addon",
          name: "Add-on",
          kind: "addon",
          writable: true,
        },
        {
          id: "homeassistant",
          name: "Home Assistant",
          kind: "server",
          basePath: "/share",
          writable: false,
        },
        {
          id: "pc",
          name: "PC",
          kind: "device",
        },
        {
          id: "notebook",
          name: "Laptop",
          kind: "device",
        },
        {
          id: "phone",
          name: "Phone",
          kind: "device",
        },
        {
          id: "internet",
          name: "Internet",
          kind: "web",
        },
        {
          id: "kolej",
          name: "Dormitory",
          kind: "physical",
        },
        {
          id: "pokoj",
          name: "Room",
          kind: "physical",
        },
        {
          id: "dilna",
          name: "Workshop",
          kind: "physical",
        },
      ],
    };
  }
  async init() {
    // Only the new-install marker opts in. Old settings and old markers skip setup.
    let firstStart = false;
    try {
      const marker = JSON.parse(
        await fs.readFile(
          path.join(path.dirname(this.file), ".initialized"),
          "utf8",
        ),
      );
      firstStart =
        marker?.schema === 1 && marker.languageSelectionRequired === true;
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
    }
    try {
      await fs.writeFile(
        this.file,
        JSON.stringify(
          { ...this.defaults, languageSelectionCompleted: !firstStart },
          null,
          2,
        ) + "\n",
        {
          flag: "wx",
        },
      );
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  validate(value) {
    if (
      (value.taskDefaultView != null &&
        !TASK_VIEWS.includes(value.taskDefaultView)) ||
      (value.taskCalendarView != null &&
        !CALENDAR_VIEWS.includes(value.taskCalendarView))
    )
      fail("Invalid default task view.");
    if (
      value.catPersonality != null &&
      (typeof value.catPersonality !== "string" ||
        !Object.hasOwn(CAT_PERSONALITIES, value.catPersonality))
    )
      fail("Invalid cat companion preference.");
    if (value.catEnabled != null && typeof value.catEnabled !== "boolean")
      fail("Invalid cat companion preference.");
    if (
      value.catYarnEnabled != null &&
      typeof value.catYarnEnabled !== "boolean"
    )
      fail("Invalid cat companion preference.");
    if (
      value.catMotion != null &&
      !["full", "system", "still"].includes(value.catMotion)
    )
      fail("Invalid cat companion preference.");
    if (
      value.libraryId != null &&
      (typeof value.libraryId !== "string" ||
        !/^[a-f0-9-]{32,36}$/.test(value.libraryId))
    )
      fail("Invalid library identity.");
    if (
      value.languageSelectionCompleted != null &&
      typeof value.languageSelectionCompleted !== "boolean"
    )
      fail("Invalid language setup state.");
    if (value.language != null && !["en", "cs"].includes(value.language))
      fail("Unsupported interface language. Choose English or Czech.");
    if (
      value.schema !== 1 ||
      typeof value.documentRoot !== "string" ||
      !path.isAbsolute(value.documentRoot) ||
      value.documentRoot.includes("\0")
    )
      fail("The document root must be an absolute server path.");
    if (!Array.isArray(value.locations) || value.locations.length > 200)
      fail("Invalid location list.");
    const ids = new Set();
    for (const l of value.locations) {
      if (
        !l ||
        !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(l.id || "") ||
        ids.has(l.id)
      )
        fail("Locations must have unique IDs.");
      ids.add(l.id);
      if (typeof l.name !== "string" || !l.name.trim() || l.name.length > 100)
        fail("Enter a location name (up to 100 characters).");
      if (!["addon", "server", "device", "web", "physical"].includes(l.kind))
        fail("Invalid location kind.");
      if (l.writable != null && typeof l.writable !== "boolean")
        fail("Invalid write permission.");
      if (
        l.kind === "server" &&
        (typeof l.basePath !== "string" ||
          (!path.isAbsolute(l.basePath) &&
            !path.win32.isAbsolute(l.basePath)) ||
          l.basePath.includes("\0"))
      )
        fail("Server locations require an absolute base path.");
    }
    if (value.locations.filter((l) => l.kind === "addon").length > 1)
      fail("Only one Add-on location is allowed.");
    validateLocationTree(value.locations, fail);
    return {
      ...value,
      libraryId:
        value.libraryId ?? digest(path.resolve(this.file)).slice(0, 32),
      language: value.language ?? "en",
      catMotion: value.catMotion ?? "full",
      catPersonality: value.catPersonality ?? "classic",
      catYarnEnabled: value.catYarnEnabled ?? true,
      taskDefaultView: value.taskDefaultView ?? "timeline",
      taskCalendarView: value.taskCalendarView ?? "month",
      languageSelectionCompleted: value.languageSelectionCompleted ?? true,
    };
  }
  async read() {
    const raw = await fs.readFile(this.file, "utf8");
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      fail(
        "settings.json is not valid JSON. Repair it in the data directory.",
        409,
      );
    }
    return {
      ...this.validate(value),
      revision: digest(raw),
    };
  }
  async save(input, nodes) {
    const old = await this.read();
    if (input.revision !== old.revision)
      fail("The settings have changed. Close and reopen settings.", 409);
    const { revision, ...value } = input;
    this.validate(value);
    value.languageSelectionCompleted =
      old.languageSelectionCompleted ||
      value.languageSelectionCompleted === true;
    const ids = new Set(value.locations.map((l) => l.id));
    for (const n of nodes)
      for (const p of n.stock?.placements || [])
        if (
          !value.locations.some(
            (l) => l.id === p.locationId && l.kind === "physical",
          )
        )
          fail("Inventory placements require an existing physical place.");
    for (const n of nodes)
      for (const r of [...n.resources, ...(n.stock?.placements || [])])
        if (!ids.has(locationId(r)))
          fail(
            `Location is used by record “${n.title}”. Move its reference first.`,
            409,
          );
    const tmp = this.file + "." + randomUUID() + ".tmp";
    const history = await historyDirectory(
      path.dirname(this.file),
      ".history",
      "settings",
    );
    await fs.copyFile(
      this.file,
      path.join(history, `${Date.now()}-${randomUUID()}.json`),
    );
    await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", {
      flag: "wx",
    });
    try {
      if (digest(await fs.readFile(this.file)) !== old.revision)
        fail("The settings have changed. Close and reopen settings.", 409);
      await fs.rename(tmp, this.file);
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
    return this.read();
  }
}
