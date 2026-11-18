import { useEffect } from 'react'
import * as d3 from 'd3'
import { useApi, useWidth, fmtInt, fmtPct, SOURCE_VAR } from '../lib'
import type { Completeness, CoverageCounts } from '../lib'
import { useSection } from '../store'
import type { SectionId } from '../store'
import { useTooltip } from './Tooltip'
import type { TipContent } from './Tooltip'

export const SECTION_LABEL: Record<SectionId, string> = {
  states: 'State surveillance', sources: 'Isolate sources', clusters: 'SNP clusters',
}

const COV_PARTS = [
  { key: 'both', label: 'Year + state', color: 'var(--accent)' },
  { key: 'date_only', label: 'Year only', color: 'var(--src-env)' },
  { key: 'state_only', label: 'State only', color: 'var(--src-animal)' },
  { key: 'neither', label: 'Neither', color: 'var(--src-unknown)' },
] as const

/** Coverage for a section's filters (pathogen, sources, host, product; all years). */
export function useCoverage(id: SectionId) {
  const { f } = useSection(id)
  return useApi<Completeness>('completeness', { organism: f.organism, sources: f.sources.join(','), host: f.host, product: f.product })
}

function PartsBar({ d, height = 10, onTip, hide }: {
  d: CoverageCounts; height?: number; onTip?: (e: React.MouseEvent, c: TipContent) => void; hide?: () => void
}) {
  return (
    <div className="cov-bar" style={{ height }}>
      {COV_PARTS.map((p) => d[p.key] > 0 && (
        <div key={p.key} style={{ width: `${(d[p.key] / Math.max(1, d.total)) * 100}%`, background: p.color }}
          onMouseMove={onTip && ((e) => onTip(e, { title: p.label, rows: [{ label: 'Isolates', value: fmtInt(d[p.key]) }, { label: 'Share', value: fmtPct(d[p.key] / d.total) }] }))}
          onMouseLeave={hide} />
      ))}
    </div>
  )
}

/** Always-visible header summary for the active page; opens the drawer. */
export function CoverageWidget({ id, onOpen }: { id: SectionId; onOpen: () => void }) {
  const { data } = useCoverage(id)
  if (!data) return <div className="coverage" />
  return (
    <button className="coverage" onClick={onOpen} aria-label="Open data coverage details">
      <span className="field-label">Usable metadata · {SECTION_LABEL[id]} filters</span>
      <PartsBar d={data} />
      <span className="txt"><b>{fmtPct(data.both / Math.max(1, data.total))}</b> of {fmtInt(data.total)} isolates have a year and a US state
        <span className="cov-more">Details →</span></span>
    </button>
  )
}

export function CoverageDrawer({ id, onClose }: { id: SectionId; onClose: () => void }) {
  const { f } = useSection(id)
  const { data, loading } = useCoverage(id)
  const { show, hide, node } = useTooltip()
  const [ref, w] = useWidth<HTMLDivElement>()
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  const d = data
  const located = d ? d.from_food_origin + d.from_geo : 0
  const withYear = d ? d.both + d.date_only : 0
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Data coverage" style={{ opacity: loading ? 0.7 : 1 }}>
        <div className="drawer-head">
          <div>
            <h2>Data coverage</h2>
            <p className="sub" style={{ margin: 0 }}>
              For the <b>{SECTION_LABEL[id]}</b> filters: {f.organism.length ? f.organism.join(', ') : 'all pathogens'} ·{' '}
              {f.sources.join(', ')}{f.host.length ? ` · hosts: ${f.host.join(', ')}` : ''}{f.product.length ? ` · products: ${f.product.join(', ')}` : ''}.
              All collection years are counted, since a missing year is part of what is measured.
            </p>
          </div>
          <button className="icon-btn big" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body" ref={ref}>
          {d && (<>
            <section>
              <div className="field-label">Collection year and US state</div>
              <div className="big-num"><b>{fmtPct(d.both / Math.max(1, d.total))}</b> of {fmtInt(d.total)} isolates can be placed on the map and timeline</div>
              <PartsBar d={d} height={16} onTip={show} hide={hide} />
              <div className="legend" style={{ marginTop: 6 }}>
                {COV_PARTS.map((p) => <span key={p.key} className="key"><span className="sw" style={{ background: p.color }} />{p.label} {fmtPct(d[p.key] / Math.max(1, d.total))}</span>)}
              </div>
            </section>

            <section>
              <div className="field-label">By isolation source</div>
              {[...d.by_source].sort((a, b) => b.total - a.total).map((s) => (
                <div key={s.source} className="cov-row">
                  <span><span className="sw" style={{ background: SOURCE_VAR[s.source] }} />{s.source}</span>
                  <PartsBar d={s} height={14} onTip={(e, c) => show(e, { ...c, title: `${s.source} · ${c.title}` })} hide={hide} />
                  <span className="tnum small"><b>{fmtPct(s.both / Math.max(1, s.total))}</b> of {fmtInt(s.total)}</span>
                </div>
              ))}
              <p className="muted small">Clinical isolates usually report only “USA” for privacy, so they rarely have a state.</p>
            </section>

            <section>
              <div className="field-label">Where the state comes from</div>
              <div className="kv">
                <div><span>food_origin (e.g. USA:CA)</span><span>{fmtInt(d.from_food_origin)} ({fmtPct(d.from_food_origin / Math.max(1, located))})</span></div>
                <div><span>geo_loc_name</span><span>{fmtInt(d.from_geo)} ({fmtPct(d.from_geo / Math.max(1, located))})</span></div>
              </div>
            </section>

            <section>
              <div className="field-label">Date precision</div>
              <div className="kv">
                <div><span>Has a collection year</span><span>{fmtInt(withYear)} ({fmtPct(withYear / Math.max(1, d.total))})</span></div>
                <div><span>Has a month (used for monthly cluster curves)</span><span>{fmtInt(d.with_month)} ({fmtPct(d.with_month / Math.max(1, d.total))})</span></div>
              </div>
            </section>

            <section>
              <div className="field-label">Isolates by collection year · dark = has a state</div>
              <YearBars rows={d.by_year} w={w} show={show} hide={hide} />
            </section>
          </>)}
        </div>
        {node}
      </aside>
    </>
  )
}

function YearBars({ rows, w, show, hide }: {
  rows: Completeness['by_year']; w: number; show: (e: React.MouseEvent, c: TipContent) => void; hide: () => void
}) {
  const h = 200, m = { l: 44, r: 6, t: 8, b: 22 }
  const x = d3.scaleBand<number>().domain(rows.map((r) => r.year)).range([m.l, w - m.r]).padding(0.15)
  const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.n) ?? 1]).nice().range([h - m.b, m.t])
  const step = x.step()
  return (
    <svg width={w} height={h}>
      {y.ticks(4).map((t) => <g key={t} className="grid"><line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} /><text x={m.l - 6} y={y(t) + 4} textAnchor="end">{d3.format('~s')(t)}</text></g>)}
      {rows.map((r) => (
        <g key={r.year} className="bar-col" onMouseMove={(e) => show(e, { title: String(r.year), rows: [
          { label: 'Isolates', value: fmtInt(r.n) }, { label: 'With state', value: `${fmtInt(r.with_state)} (${fmtPct(r.with_state / r.n)})` }] })} onMouseLeave={hide}>
          <rect className="row-hl" x={(x(r.year) ?? 0) - (step - x.bandwidth()) / 2} width={step} y={m.t} height={h - m.b - m.t} />
          <rect x={x(r.year)} width={x.bandwidth()} y={y(r.n)} height={y(r.with_state) - y(r.n)} fill="var(--accent)" opacity={0.3} rx={2} />
          <rect x={x(r.year)} width={x.bandwidth()} y={y(r.with_state)} height={h - m.b - y(r.with_state)} fill="var(--accent)" rx={2} />
          {(r.year % 5 === 0) && <text x={(x(r.year) ?? 0) + x.bandwidth() / 2} y={h - 6} textAnchor="middle">{r.year}</text>}
        </g>
      ))}
    </svg>
  )
}
