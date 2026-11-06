// The last deleted spot, so the board can offer "Deleted Skyway · Undo" in its own reading order (one Tab after the
// "Today" heading that focus lands on) until the rider moves on. The toast offers the same, for pointers, from any view.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { spotStore } from "../../lib/data";
import type { Spot } from "../../lib/wind";

export type Deleted = { spot: Spot; index: number; toastId?: string | number };
let last: Deleted | null = null;
const listeners = new Set<() => void>();
const set = (v: Deleted | null) => { last = v; listeners.forEach((l) => l()); };

/** Put a deleted spot back where it was (once: a spot already back is left alone), close its toast, drop its board row. */
function restore(d: Deleted) {
  spotStore.restore(d.spot, d.index);
  if (d.toastId != null) toast.dismiss(d.toastId);
  if (last?.spot.id === d.spot.id) set(null);
}

export const undoDelete = {
  /** Remember a delete for the board's row (spotStore.remove's index puts it back in the same place). */
  remember: (d: Deleted) => set(d),
  /** The toast's Undo: restores what it captured, whatever the board's row is doing (the board may be gone). */
  restore,
  /** The board's Undo: restores the delete it shows. */
  undo: () => { if (last) restore(last); },
  /** The rider moved on: the board's row goes (the toast keeps its own offer until it runs its course). */
  forget: () => { if (last) set(null); },
};

export const useLastDeleted = () =>
  useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => last);
