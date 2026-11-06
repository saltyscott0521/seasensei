import { Fragment } from "react";

/** "Live · Old Port Tampa · 0.5 km · 4 min ago" that wraps only between its parts, never inside a name, distance or age. */
export function Dotted({ text }: { text: string }) {
  return <>{text.split(" · ").map((part, i) => <Fragment key={i}>{i > 0 && " · "}<span className="whitespace-nowrap">{part}</span></Fragment>)}</>;
}
