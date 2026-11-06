/**
 * SeaSensei UI primitives ("night sea"). Import from here: `import { Card, Chip, VerdictPill } from "./ui";`
 *
 * RULES OF THE ROAD
 * - Chrome is neutral; colour is data. Use the tokens (src/styles/theme.css) through Tailwind utilities:
 *     surfaces  bg-ink · bg-surface-1 (glass) · bg-surface-2 (cards) · bg-surface-3 (hover/selected)
 *     lines     border-line · border-line-strong (also ring-line, ring-line-strong)
 *     text      text-fg · text-fg-2 · text-fg-3 (the faintest text allowed; ≥ 5:1 on every surface)
 *     accent    text-accent · bg-accent-soft · ring-accent (selection, links, focus, "now")
 *     verdicts  go · soon · off · strong · wrongdir (bg-go/14, text-go, fill-go …). Always with a word or glyph.
 *               `off` is too dark for text: put text-fg-2 on it.
 *     radii     rounded-sm 10 · rounded-md 14 · rounded-lg 18 (cards) · rounded-xl 24 (panels) · rounded-sheet 28
 *     type      text-micro 11 · text-caption 12 · text-label 13 · text-body 15 · text-title 17 · text-heading 20
 *               · text-headline 24 · text-display 56–72 (600, -0.04em). Nothing under 11 px except chart ticks (10).
 *     numbers   className="num" = Geist with tabular figures (not mono). Wrap units smaller in fg-3.
 *     shadows   shadow-float (map chrome) · shadow-raised (thumbs, popovers)   easing  ease-ui
 *   No new text-white/NN, bg-white/NN or inline rgb() for chrome (wind-scale and chart data colours excepted).
 *   In SVG prefer classes (fill-fg-3, stroke-line) over attributes; var(--color-…) works in CSS too.
 * - `.glass` only for chrome floating over the map; cards inside a panel are flat <Card>. Never glass on glass.
 * - Focus: every focusable element gets a 2px accent ring with 2px offset from the base layer. Don't remove it
 *   (outline-none) unless you draw an equally visible one.
 * - Touch: ≥ 44 × 44 on phones, ≥ 32 on desktop. IconButton/Segmented/Button handle it; for one-offs use
 *   max-md:h-11, or an invisible `before:-inset-1` halo on a `relative` button.
 * - Motion (src/lib/motion.ts): `spring`, `duration`, `ease`, `turn` (critically damped, for rotations),
 *   `stagger(i)`, `useUnwrappedAngle(deg)` (shortest-path rotation). Opacity/transform only.
 * - Tests: names are contracts (see the audit's testLocks). Keep "7 days", "Models", "Spot settings", "Forecast model"
 *   unique; never put a spot name in a second heading; never say "… knots from …" in an aria-label.
 *
 * THE PIECES (each file has JSDoc and examples; each exports a `…Class()` helper for motion.* elements)
 *
 *   <Card>…</Card>                                   flat surface-2 card, 14 px padding, 18 px radius
 *   <Card interactive onClick={open}>…</Card>        a <button>: hover/press, named by its text (spot list cards)
 *   <Card selected padding="sm">…</Card>             raised (surface-3) / 12 px padding / padding="none"
 *   cardClass({ interactive: true })                 for <motion.button>
 *
 *   <Chip>15–30 kn</Chip>                            neutral label; sizes sm (20 px) · md (24 px) · lg (32 px)
 *   <Chip tone="accent" size="sm">NOW</Chip>         tones: neutral accent go soon off strong wrongdir
 *   <Chip tone="soon" icon={<Clock3 />}>Later</Chip> leading icon, auto-sized, aria-hidden
 *   chipClass("go", "sm")                            for <motion.span title="HRRR"> window chips
 *
 *   <VerdictPill state="on" label="On now" />                     on · today · upcoming · none · strong · wrongdir
 *   <VerdictPill state="today" label="On at 1 PM" size="lg" />    glyph + word on the verdict colour (today = go outline)
 *     The colour contract: on = go solid · today = go outline + clock · upcoming = neutral + calendar · none = off ·
 *     too strong = strong · wrong direction = wrongdir + glyph. Amber (soon) only for marginal hours and lower
 *     confidence. Words (RIBBON_WORDS): rideable · marginal · too light · too strong · wrong direction.
 *
 *   <ConfidenceDots level="high" label="Models agree · 3 kn spread" />  ●●● / ●●○ / ●○○ in neutral ink, role=img with that label
 *   <ConfidenceDots level="low" showLabel />                      also prints the label (11 px fg-3)
 *
 *   <IconButton aria-label="Back to spots" onClick={back}><ArrowLeft /></IconButton>   ghost, 40 px, 44 px hit on phones
 *   <IconButton aria-label="Spot settings" pressed={editing} onClick={toggle}><Settings2 /></IconButton>  toggle
 *   <IconButton aria-label="Add a spot" variant="glass" size="sm">…</IconButton>       map chrome; tonal for quiet fill
 *
 *   <Button variant="primary">Save spot</Button>     primary · secondary (default) · ghost · danger; md 44 px · sm 32 px
 *
 *   <Segmented id="range-pill" value={range} onChange={setRange}
 *     options={[["24h", "Past 24 h"], ["48h", "48 h"], ["7d", "7 days"]]} />
 *     `id` is the thumb's layoutId: unique per on-screen instance (the full-screen copy passes idSuffix "-x").
 *
 *   <SectionHeader title="Sessions" aside={<ConfidenceDots level="mid" />} />           h3 by default (`as`)
 *
 *   <Ribbon cells={[{ state: "off", title: "7 AM · 9 kn" }, { state: "go", title: "1 PM · 18 kn SW" }]} nowIndex={3}
 *     label="Rideable 1–5 PM" />      go soon off strong wrongdir none; wrongdir is hatched; role=img + summary
 *
 *   <Stat value={<Knots value={18} />} unit="kn" label="Live · Old Port Tampa" size="display" />  md · lg · display
 *
 *   <ScrollFade />                                   a fade at a scrolling panel's bottom edge (last child of a view)
 *
 * Still in ../bits: WindArrow (shortest-path, CSS-eased), Dial (arc={spot} draws the rideable arc), Knots,
 * RideBadge (a VerdictPill), Skeleton, Sparkline, ModelPicker (native select "Forecast model").
 */
export { Button, buttonClass, type ButtonProps, type ButtonSize, type ButtonVariant } from "./Button";
export { Card, cardClass, type CardPadding, type CardProps } from "./Card";
export { Chip, chipClass, type ChipProps, type ChipSize, type Tone } from "./Chip";
export { ConfidenceDots, type ConfidenceDotsProps, type ConfidenceLevel } from "./ConfidenceDots";
export { IconButton, iconButtonClass, type IconButtonProps, type IconButtonSize, type IconButtonVariant } from "./IconButton";
export { Ribbon, RIBBON_WORDS, ribbonSummary, type RibbonCell, type RibbonProps, type RibbonState } from "./Ribbon";
export { ScrollFade } from "./ScrollFade";
export { SectionHeader, type SectionHeaderProps } from "./SectionHeader";
export { Segmented, type SegmentedProps } from "./Segmented";
export { Stat, type StatProps, type StatSize } from "./Stat";
export { VERDICT_TONE, VerdictPill, type VerdictPillProps, type VerdictState } from "./VerdictPill";
