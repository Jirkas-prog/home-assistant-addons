import identity from "../release.json" with { type: "json" };
import pkg from "../package.json" with { type: "json" };

// Product identity stays fixed while only the package version changes.
export const release = Object.freeze({ ...identity, version: pkg.version });
