// The rider's wind colour scale: kept in localStorage `windScale`, applied to lib/wind.ts at import (before the first
// render, main.tsx imports this first) and on every change. Components that draw with the scale call useWindScale(),
// so they re-render (memoised ones too) when it changes; anything that caches colours keys its cache on the value.
import { useSyncExternalStore } from "react";
import { DEFAULT_WIND_SCALE, isWindScale, setWindScale, type WindScale } from "./wind";

const KEY = "windScale";
const read = (): WindScale => {
  try { const v = localStorage.getItem(KEY); return isWindScale(v) ? v : DEFAULT_WIND_SCALE; } catch { return DEFAULT_WIND_SCALE; }
};

let current = read();
setWindScale(current);
const listeners = new Set<() => void>();

export function chooseWindScale(id: WindScale) {
  if (id === current) return;
  current = id;
  setWindScale(id);
  try { localStorage.setItem(KEY, id); } catch { /* private mode: the choice lasts this visit */ }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
/** The scale in use; subscribing re-renders the caller when the rider picks another. */
export const useWindScale = () => useSyncExternalStore(subscribe, () => current, () => current);
