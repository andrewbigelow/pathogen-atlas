import { useRef } from 'react'
import * as d3 from 'd3'

/** Threshold line that can be dragged by the line itself or by its round handle.
 *  `orient="v"`: vertical line at x = `at` from y `from`..`to` (handle on top).
 *  `orient="h"`: horizontal line at y = `at` from x `from`..`to` (handle on the right). */
export function DragThreshold({ orient, at, from, to, onChange, label }: {
  orient: 'v' | 'h'; at: number; from: number; to: number; onChange: (px: number) => void; label?: string
}) {
  const dragging = useRef(false)
  const move = (e: React.PointerEvent<SVGGElement>) => {
    if (!dragging.current) return
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    const [px, py] = d3.pointer(e.nativeEvent, svg)
    onChange(orient === 'v' ? px : py)
  }
  const v = orient === 'v'
  const [x1, y1, x2, y2] = v ? [at, from, at, to] : [from, at, to, at]
  const hx = v ? at : to, hy = v ? from : at
  return (
    <g className="drag-thr" style={{ cursor: v ? 'ew-resize' : 'ns-resize', touchAction: 'none' }}
      onPointerDown={(e) => { e.stopPropagation(); dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); move(e) }}
      onPointerMove={move}
      onPointerUp={(e) => { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId) }}
      onClick={(e) => e.stopPropagation()}
      role="slider" aria-label={label ?? 'Threshold'} aria-orientation={v ? 'horizontal' : 'vertical'}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--flag)" strokeWidth={2} strokeDasharray={v ? undefined : '5 3'} />
      <circle className="handle" cx={hx} cy={hy} r={7} fill="var(--surface-1)" stroke="var(--flag)" strokeWidth={2} />
      {label && (v
        ? <text x={hx + 10} y={hy + 4} className="thr-label">{label}</text>
        : <text x={hx - 10} y={hy - 9} textAnchor="end" className="thr-label">{label}</text>)}
    </g>
  )
}

/** Transparent per-year hover bands plus a vertical rule at the hovered year. */
export function YearOverlay({ years, x, top, bottom, hover, onHover, onLeave }: {
  years: number[]; x: (y: number) => number; top: number; bottom: number
  hover: number | null; onHover: (year: number, e: React.MouseEvent) => void; onLeave?: () => void
}) {
  const step = years.length > 1 ? x(years[1]) - x(years[0]) : 40
  return (
    <g onMouseLeave={onLeave}>
      {hover != null && <HoverRule x={x(hover)} top={top} bottom={bottom} />}
      {years.map((yr) => (
        <rect key={yr} x={x(yr) - step / 2} y={top} width={step} height={bottom - top} fill="transparent"
          onMouseMove={(e) => onHover(yr, e)} />
      ))}
    </g>
  )
}

export function HoverRule({ x, top, bottom }: { x: number; top: number; bottom: number }) {
  return <line x1={x} x2={x} y1={top} y2={bottom} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="3 3" style={{ pointerEvents: 'none' }} />
}

/** Round to 3 significant figures for a tidy threshold readout. */
export const tidy = (v: number) => (v > 0 ? +v.toPrecision(3) : 0)
