import { useSyncExternalStore } from "react";

// prefers-reduced-motion for the map's imperative motion (camera moves, particles). Motion components already
// follow it through <MotionConfig reducedMotion="user">; this covers what MapLibre and the canvas draw.
const mq = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Whether the person asked for less motion, right now (for one-off decisions like flyTo vs jumpTo). */
export const prefersReducedMotion = () => mq.matches;

/** The same, as a hook that re-renders when the setting changes. */
export const useReducedMotion = () =>
  useSyncExternalStore((l) => (mq.addEventListener("change", l), () => mq.removeEventListener("change", l)), () => mq.matches);
