import { useSyncExternalStore } from "react";
import { catReducedMotion } from "./cat-behavior.js";

const query = matchMedia("(prefers-reduced-motion: reduce)");
const subscribe = (notify) => {
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const snapshot = () => query.matches;

export function useCatMotion(mode) {
  return catReducedMotion(mode, useSyncExternalStore(subscribe, snapshot));
}
