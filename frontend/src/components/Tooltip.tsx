import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface TipRow { label: string; value: string }
export interface TipContent { title: string; rows?: TipRow[]; note?: string }

export function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; c: TipContent } | null>(null)
  const show = useCallback((e: { clientX: number; clientY: number }, c: TipContent) => {
    setTip({ x: e.clientX, y: e.clientY, c })
  }, [])
  const hide = useCallback(() => setTip(null), [])
  const node: ReactNode = tip ? <Tip {...tip} /> : null
  return { show, hide, node }
}

const GAP = 14

/** Placed from its measured size, so when it flips to the left of the cursor it still hugs the cursor. */
function Tip({ x, y, c }: { x: number; y: number; c: TipContent }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    const left = x + GAP + width > vw - 4 ? x - GAP - width : x + GAP
    const top = y + GAP + height > vh - 4 ? y - GAP - height : y + GAP
    setPos({ left: Math.max(4, left), top: Math.max(4, top) })
  }, [x, y, c])
  return (
    <div ref={ref} className="tip" style={{ left: pos?.left ?? x + GAP, top: pos?.top ?? y + GAP, visibility: pos ? 'visible' : 'hidden' }}>
      <div className="t">{c.title}</div>
      {c.rows?.map((r) => (
        <div className="r" key={r.label}>
          <span>{r.label}</span>
          <span>{r.value}</span>
        </div>
      ))}
      {c.note && <div className="muted small" style={{ marginTop: 4 }}>{c.note}</div>}
    </div>
  )
}
