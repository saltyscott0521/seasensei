import clsx from "clsx";
import { RotateCw, X } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui";

// After a deploy the server no longer has the previous build's hashed chunks (missing files 404 by design, see
// server.mjs), so a tab left open across a deploy fails the first time it lazy-loads a view it hadn't fetched yet. And
// once a dynamic import has failed (a prefetch on a flaky connection), the browser keeps that failure for the page's
// life. These boundaries catch it where the view is needed: one guarded reload onto the current build (the layer is in
// the URL, so the reload lands where the rider was), then, if it fails again, "SeaSensei was updated — Reload". One
// failed chunk never blanks the whole app.

/** A failed dynamic import: the build this page came from has been replaced. */
export const isChunkError = (e: unknown) =>
  e instanceof Error && /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch|ChunkLoadError/i.test(`${e.name} ${e.message}`);

const RELOADED = "seasensei:chunk-reload";
/** No reload of this kind in the last minute (so a chunk that is truly broken can't reload in a loop), and storage to guard it. */
const mayReload = () => {
  try { return Date.now() - Number(sessionStorage.getItem(RELOADED) || 0) >= 60_000; } catch { return false; }
};
/** Reload once onto the current build; false if that can't be done without risking a loop. */
export function reloadOnce() {
  if (!mayReload()) return false;
  try { sessionStorage.setItem(RELOADED, String(Date.now())); } catch { return false; }
  location.reload();
  return true;
}

type Variant = "screen" | "inline" | "overlay" | "quiet";
type Props = {
  children: ReactNode; variant?: Variant; className?: string;
  /** The layer this guards (the discussion) is open. Closed, a caught error shows nothing; opened again, it shows again. */
  open?: boolean;
  /** Offers Close next to Reload (closes the layer). */
  onClose?: () => void;
};

/**
 * Catches a render error below it and offers a reload. `screen` fills the app (the root), `inline` sits in the
 * panel or sheet where the failed view was, `overlay` floats a card over the page (a dialog's place), `quiet` keeps
 * the plain ink background (the map's place) with a small card. A missing chunk reloads once by itself first (online).
 */
export class UpdateBoundary extends Component<Props, { error: unknown; reloading: boolean }> {
  state = { error: null as unknown, reloading: false };
  static getDerivedStateFromError(error: unknown) {
    return { error, reloading: isChunkError(error) && navigator.onLine && mayReload() };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
    if (this.state.reloading && !reloadOnce()) this.setState({ reloading: false });
  }
  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    if (reloading || this.props.open === false) return null;
    return <UpdateNotice variant={this.props.variant ?? "inline"} updated={isChunkError(error)} className={this.props.className} onClose={this.props.onClose} />;
  }
}

function UpdateNotice({ variant, updated, className, onClose }: { variant: Variant; updated: boolean; className?: string; onClose?: () => void }) {
  const offline = updated && !navigator.onLine;
  const card = (
    <div role="alert" className={clsx("flex flex-col items-start gap-3 rounded-lg p-4 text-left",
      variant === "inline" ? "border border-line bg-surface-2" : "glass max-w-[22rem]")}>
      <div>
        <p className="text-title font-semibold tracking-tight text-fg">{offline ? "You're offline" : updated ? "SeaSensei was updated" : "Something went wrong"}</p>
        <p className="mt-1 text-label text-fg-2">
          {offline ? "Reload once you have signal. Your spots are saved on this device."
            : updated ? "Reload to get the new version. Your spots are saved on this device."
            : "Reloading usually fixes it. Your spots are saved on this device."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => location.reload()}><RotateCw aria-hidden />Reload</Button>
        {onClose && <Button onClick={onClose}><X aria-hidden />Close</Button>}
      </div>
    </div>
  );
  if (variant === "inline") return <div className={className}>{card}</div>;
  const box = (
    <div className={clsx(variant === "screen" ? "fixed inset-0 bg-ink" : variant === "overlay" ? "fixed inset-0 z-50 bg-ink/75" : "absolute inset-0",
      "grid place-items-center p-4", className)}>
      {card}
    </div>
  );
  // A dialog's place is above everything, the phone's bottom sheet included (it is portalled to <body> too).
  return variant === "overlay" ? createPortal(box, document.body) : box;
}
