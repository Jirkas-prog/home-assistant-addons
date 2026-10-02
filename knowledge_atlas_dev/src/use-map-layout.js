import { useEffect, useMemo, useState } from "react";
import { layoutKey, MAP_LAYOUTS } from "./map-layout.js";

const memory = new Map();
const preferenceKey = () => `atlas-map-layout:${location.pathname}`;
export function readMapLayout() {
  try {
    const saved = localStorage.getItem(preferenceKey());
    if (MAP_LAYOUTS.includes(saved)) return saved;
  } catch {}
  return "classic";
}
export function saveMapLayout(layout) {
  try {
    localStorage.setItem(preferenceKey(), layout);
  } catch {}
}

async function cache(slot, value) {
  // Only eight geometry snapshots (four layouts in two dimensions), never bodies.
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("atlas-map-geometry", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("layouts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("layouts", value ? "readwrite" : "readonly");
      const store = tx.objectStore("layouts"),
        request = value ? store.put(value, slot) : store.get(slot);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function useMapLayout(nodes, layout, mode) {
  const dimensions = mode === "3d" ? 3 : 2;
  const key = useMemo(
    () => layoutKey(nodes, layout, dimensions),
    [nodes, layout, dimensions],
  );
  const slot = `${layout}:${dimensions}`;
  const [state, setState] = useState({ key: "", positions: [], error: "" });
  useEffect(() => {
    let stopped = false,
      worker;
    async function build() {
      let saved = memory.get(slot);
      if (saved?.key !== key) {
        try {
          saved = await cache(slot);
        } catch {}
      }
      if (stopped) return;
      if (
        saved?.key === key &&
        Array.isArray(saved.positions) &&
        saved.positions.length === nodes.length &&
        saved.positions.every((p) =>
          [p.x, p.y, p.z, p.r].every(Number.isFinite),
        )
      ) {
        setState({ ...saved, error: "" });
        return;
      }
      worker = new Worker(new URL("./map-layout-worker.js", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }) => {
        if (stopped) return;
        setState({
          key,
          positions: data.positions || [],
          error: data.error || "",
        });
        if (data.positions) {
          const value = { key, positions: data.positions };
          memory.set(slot, value);
          cache(slot, value).catch(() => {});
        }
        worker.terminate();
      };
      worker.onerror = () => {
        if (!stopped) setState({ key, positions: [], error: "layout" });
        worker.terminate();
      };
      const rows = JSON.parse(key)[3].map(([id, parent, type, importance]) => ({
        id,
        parent,
        type,
        importance,
      }));
      worker.postMessage({ nodes: rows, layout, dimensions });
    }
    build().catch(() => {
      if (!stopped) setState({ key, positions: [], error: "layout" });
    });
    return () => {
      stopped = true;
      worker?.terminate();
    };
  }, [key, slot]);
  const sameMode =
    state.key &&
    JSON.parse(state.key)[1] === layout &&
    JSON.parse(state.key)[2] === dimensions;
  return {
    positions: sameMode ? state.positions : [],
    building: state.key !== key,
    error: state.key === key ? state.error : "",
  };
}
