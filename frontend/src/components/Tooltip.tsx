import { useCallback, useState } from 'react'
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

function Tip({ x, y, c }: { x: number; y: number; c: TipContent }) {
  const left = x + 14 + 300 > window.innerWidth ? x - 14 - 300 : x + 14
  const top = Math.min(y + 14, window.innerHeight - 140)
  return (
    <div className="tip" style={{ left: Math.max(4, left), top }}>
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
