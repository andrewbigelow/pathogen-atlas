import { useMemo, useState } from 'react'
import * as d3 from 'd3'
import { useApi, useDark, useWidth, seqInterpolator, aggregate, aggWord, dodgeLabels, fmtInt, fmtPct, SOURCE_VAR, STATE_NAMES } from '../lib'
import type { AggHow, RateRow } from '../lib'
import { useSection } from '../store'
import { USMap, ColorLegend } from '../components/USMap'
import { useTooltip } from '../components/Tooltip'
import type { TipContent } from '../components/Tooltip'
import { YearOverlay } from '../components/Chart'
import {
  Seg, FilterPanel, FilterGroup, GeneField, geneText, PathogenField, HostField, ProductField, SourcesField, MinCountField, YearRange,
} from '../components/Controls'

type Show = (e: React.MouseEvent, c: TipContent) => void
type Mode = 'rel' | 'share' | 'count' | 'carriage'
interface GeneSrc {
  by_year: { year: number; source: string; n: number }[]
  subsources: { source: string; subsource: string; year: number; n: number }[]
  denominator: { year: number; source: string; n: number }[]
}
interface SubAgg { source: string; subsource: string; n: number; total: number }

const short = (s: string) => (s === 'Human clinical' ? 'Clinical' : s)

/** Combine each sub-source's yearly counts across the window with the chosen aggregation (zero-filled),
 *  and fold sub-sources below `minN` total isolates into "other <source>". */
function aggSubs<T extends { source: string; subsource: string; year: number; n: number }>(
  rows: T[], y0: number, y1: number, how: AggHow, minN: number,
): SubAgg[] {
  const years = d3.range(y0, y1 + 1)
  const groups = d3.groups(rows, (r) => r.source, (r) => r.subsource)
  const out: SubAgg[] = []
  for (const [src, subs] of groups) {
    const folded = new Map<string, Map<number, number>>()
    for (const [sub, rs] of subs) {
      const total = d3.sum(rs, (r) => r.n)
      const key = total >= minN ? sub ?? 'unspecified' : `other ${src.toLowerCase()}`
      const m = folded.get(key) ?? new Map<number, number>()
      rs.forEach((r) => m.set(r.year, (m.get(r.year) ?? 0) + r.n))
      folded.set(key, m)
    }
    for (const [sub, m] of folded) {
      const vals = years.map((y) => m.get(y) ?? 0)
      out.push({ source: src, subsource: sub, n: aggregate(vals, how) ?? 0, total: d3.sum(vals) })
    }
  }
  return out.filter((o) => o.n > 0)
}

export default function Sources() {
  const { f, setF, allowedSources, params } = useSection()
  const { show, hide, node } = useTooltip()
  const [minN, setMinN] = useState(25)
  const [mode, setMode] = useState<Mode>('rel')
  const gs = useApi<GeneSrc>('gene_sources', { organism: f.organism, y0: f.y0, y1: f.y1, gene: f.gene, host: f.host, product: f.product })
  const subs = useMemo(() => (gs.data ? aggSubs(gs.data.subsources, f.y0, f.y1, f.agg, minN) : []), [gs.data, f.y0, f.y1, f.agg, minN])
  const gene = geneText(f.gene)
  const toggleSrc = (s: string) => {
    const next = f.sources.includes(s) ? f.sources.filter((x) => x !== s) : [...f.sources, s]
    if (next.length) setF({ sources: allowedSources.filter((x) => next.includes(x)) })
  }

  return (
    <div className="grid">
      <FilterPanel>
        <FilterGroup label="Isolates"><PathogenField /><SourcesField /><HostField /><ProductField /></FilterGroup>
        <FilterGroup label="AMR"><GeneField /></FilterGroup>
        <FilterGroup label="Time"><YearRange /></FilterGroup>
        <FilterGroup label="Display">
          <MinCountField value={minN} onChange={setMinN} label="Min. isolates per sub-source" options={[0, 10, 25, 50, 100, 250, 500]} />
        </FilterGroup>
      </FilterPanel>

      <div className="card" style={{ opacity: gs.loading ? 0.6 : 1 }}>
        <div className="section-head">
          <h2>Which sources carry <i>{gene}</i>, and how is that shifting?</h2></div>
        <p className="sub">
          All US isolates with {gene}, {f.y0}–{f.y1}, by isolation source. Pick the sources to compare; each one is a line on the same
          zero baseline so rises and falls can be read directly.
        </p>
        <div className="controls">
          <div className="field">
            <span className="field-label">Compare sources</span>
            <div className="chips">
              {allowedSources.map((s) => (
                <button key={s} className="chip" aria-pressed={f.sources.includes(s)} onClick={() => toggleSrc(s)}>
                  <span className="sw" style={{ background: SOURCE_VAR[s] }} />{short(s)}
                </button>
              ))}
            </div>
          </div>
          <Seg label="Measure" value={mode} onChange={setMode} options={[
            { v: 'rel', label: 'Share among selected' }, { v: 'share', label: 'Share of all carriers' },
            { v: 'count', label: 'Count' }, { v: 'carriage', label: '% of source carrying gene' }]} />
        </div>
        {gs.data ? (
          <div className="grid g-2">
            <SourceLines data={gs.data} mode={mode} sources={f.sources} minN={minN} gene={gene} show={show} hide={hide} />
            <div>
              <div className="field-label" style={{ marginBottom: 4 }}>
                Sub-sources of {gene} carriers · {aggWord(f.agg).toLowerCase()} {f.agg === 'sum' ? 'count' : 'isolates per year'}
              </div>
              <Treemap items={subs.filter((s) => f.sources.includes(s.source))} agg={f.agg} show={show} hide={hide} height={320} />
            </div>
          </div>
        ) : <div className="loading">Loading…</div>}
      </div>

      <StateCompare params={params} show={show} hide={hide} minN={minN} />
      {node}
    </div>
  )
}

function SourceLines({ data, mode, sources, minN, gene, show, hide }: {
  data: GeneSrc; mode: Mode; sources: string[]; minN: number; gene: string; show: Show; hide: () => void
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hoverYear, setHoverYear] = useState<number | null>(null)
  const h = 320
  const m = { l: 48, r: 92, t: 12, b: 24 }
  const years = Array.from(new Set(data.by_year.map((d) => d.year))).sort((a, b) => a - b)
  const num = useMemo(() => { const mp = new Map(data.by_year.map((d) => [`${d.year}|${d.source}`, d.n])); return (y: number, s: string) => mp.get(`${y}|${s}`) ?? 0 }, [data])
  const den = useMemo(() => { const mp = new Map(data.denominator.map((d) => [`${d.year}|${d.source}`, d.n])); return (y: number, s: string) => mp.get(`${y}|${s}`) ?? 0 }, [data])
  if (years.length < 2) return <div ref={ref} className="muted">Too few years with this gene.</div>

  const allSrc = Array.from(new Set(data.by_year.map((d) => d.source)))
  const value = (y: number, s: string): number | null => {
    const n = num(y, s)
    if (mode === 'count') return n
    if (mode === 'carriage') { const d = den(y, s); return d >= Math.max(1, minN) ? n / d : null }
    const tot = d3.sum(mode === 'rel' ? sources : allSrc, (x) => num(y, x))
    return tot ? n / tot : null
  }
  const series = sources.map((s) => ({ s, pts: years.map((y) => ({ year: y, v: value(y, s) })) }))
  const ymax = d3.max(series.flatMap((d) => d.pts), (p) => p.v ?? 0) || 1
  const x = d3.scaleLinear().domain(d3.extent(years) as [number, number]).range([m.l, w - m.r])
  const y = d3.scaleLinear().domain([0, mode === 'count' ? ymax : Math.min(1, ymax * 1.05)]).nice().range([h - m.b, m.t])
  const fmt = mode === 'count' ? d3.format('~s') : d3.format('.0%')
  const line = d3.line<{ year: number; v: number | null }>().defined((p) => p.v != null).x((p) => x(p.year)).y((p) => y(p.v ?? 0))
  const ends = series.map((d) => { const last = [...d.pts].reverse().find((p) => p.v != null); return { d, last } }).filter((e) => e.last)
  const endY = ends.map((e) => y(e.last!.v!))
  const labelY = dodgeLabels(endY, 13, m.t + 4, h - m.b)
  const measure = mode === 'rel' ? 'share of carriers in the selected sources' : mode === 'share' ? 'share of all carriers'
    : mode === 'count' ? 'carriers' : `% of each source's isolates carrying ${gene}`

  return (
    <div ref={ref}>
      <div className="field-label" style={{ marginBottom: 4 }}>{measure} by year</div>
      <svg width={w} height={h} onMouseLeave={() => { setHoverYear(null); hide() }}>
        {y.ticks(5).map((t) => (<g key={t} className="grid"><line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} />
          <text x={m.l - 6} y={y(t) + 4} textAnchor="end">{fmt(t)}</text></g>))}
        {years.map((yr) => <text key={yr} x={x(yr)} y={h - 6} textAnchor="middle">{years.length > 14 && yr % 2 ? '' : `'${String(yr).slice(2)}`}</text>)}
        {series.map((d) => (
          <g key={d.s}>
            <path d={line(d.pts) ?? ''} fill="none" stroke={SOURCE_VAR[d.s]} strokeWidth={2.5} strokeLinejoin="round" />
            {d.pts.filter((p) => p.v != null).map((p) => (
              <circle key={p.year} cx={x(p.year)} cy={y(p.v!)} r={hoverYear === p.year ? 4.5 : 2.5} fill={SOURCE_VAR[d.s]} />
            ))}
          </g>
        ))}
        {ends.map((e, i) => {
          const lx = x(e.last!.year)
          return (
            <g key={e.d.s}>
              {Math.abs(labelY[i] - endY[i]) > 2 && <polyline points={`${lx + 4},${endY[i]} ${w - m.r + 2},${labelY[i]}`} fill="none" stroke={SOURCE_VAR[e.d.s]} strokeWidth={1} />}
              <text x={w - m.r + 5} y={labelY[i] + 4} style={{ fontWeight: 600, fill: 'var(--text-primary)' }}>{short(e.d.s)}</text>
            </g>
          )
        })}
        <YearOverlay years={years} x={x} top={m.t} bottom={h - m.b} hover={hoverYear}
          onHover={(yr, e) => {
            setHoverYear(yr)
            const tot = d3.sum(allSrc, (s) => num(yr, s))
            show(e, {
              title: `${yr} · ${fmtInt(tot)} carriers`,
              rows: series.map((d) => ({ d, v: value(yr, d.s) })).sort((a, b) => (b.v ?? -1) - (a.v ?? -1)).map(({ d, v }) => ({
                label: short(d.s),
                value: mode === 'count' ? fmtInt(v ?? 0)
                  : mode === 'carriage' ? `${fmtPct(v)} of ${fmtInt(den(yr, d.s))}`
                  : `${fmtPct(v)} (${fmtInt(num(yr, d.s))})`,
              })),
            })
          }} />
      </svg>
      {mode === 'carriage' && <div className="muted small">Points hidden for years where a source has fewer than {Math.max(1, minN)} isolates.</div>}
    </div>
  )
}

function Treemap({ items, show, hide, height, agg }: {
  items: SubAgg[]; agg: AggHow; show: Show; hide: () => void; height: number
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const total = d3.sum(items, (i) => i.n)
  const leaves = useMemo(() => {
    type N = { name: string; source?: string; n?: number; total?: number; children?: N[] }
    const root: N = { name: 'root', children: d3.groups(items, (i) => i.source).map(([s, arr]) => ({
      name: s, children: arr.map((a) => ({ name: a.subsource, source: s, n: a.n, total: a.total })) })) }
    const h = d3.hierarchy(root).sum((d) => d.n ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    return d3.treemap<N>().size([w, height]).paddingInner(2).paddingOuter(0).round(true)(h).leaves()
  }, [items, w, height])
  if (!items.length) return <div ref={ref} className="muted" style={{ height }}>No isolates.</div>
  return (
    <div ref={ref}>
      <svg width={w} height={height}>
        {leaves.map((l) => {
          const bw = l.x1 - l.x0, bh = l.y1 - l.y0
          const src = l.data.source!
          const ink = src === 'Environment' || src === 'Unknown' ? '#0b0b0b' : '#fff'
          return (
            <g key={src + l.data.name} transform={`translate(${l.x0},${l.y0})`}
              onMouseMove={(e) => show(e, { title: l.data.name, rows: [
                { label: 'Source', value: src },
                ...(agg === 'sum' ? [] : [{ label: `${aggWord(agg)} isolates / yr`, value: d3.format(',.1f')(l.value ?? 0) }]),
                { label: 'Isolates (all years)', value: fmtInt(l.data.total ?? 0) }, { label: 'Share of tiles', value: fmtPct((l.value ?? 0) / total) }] })}
              onMouseLeave={hide}>
              <rect width={bw} height={bh} rx={3} fill={SOURCE_VAR[src]} opacity={0.9} />
              {bw > 52 && bh > 28 && (
                <>
                  <text x={6} y={15} style={{ fill: ink, fontWeight: 600, fontSize: 11.5 }}>{l.data.name.length * 6.5 > bw - 8 ? l.data.name.slice(0, Math.max(1, Math.floor((bw - 8) / 6.5) - 1)) + '…' : l.data.name}</text>
                  <text x={6} y={29} style={{ fill: ink, opacity: 0.85 }}>{fmtPct((l.value ?? 0) / total)}</text>
                </>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Pick states on the map, compare their sub-source treemaps side by side. */
function StateCompare({ params, show, hide, minN }: { params: Record<string, string | number>; show: Show; hide: () => void; minN: number }) {
  const { f, selectedStates, pickState, setSelectedStates } = useSection()
  const dark = useDark()
  const counts = useApi<{ rows: RateRow[] }>('state_rates', { ...params, norm: 'none' })
  const { data, loading } = useApi<{ by_year: { state: string; year: number; source: string; n: number }[]; subsources: { state: string; source: string; subsource: string; year: number; n: number }[] }>(
    selectedStates.length ? 'state_sources' : null, { ...params, states: selectedStates.join(',') })
  const [ref, w] = useWidth<HTMLDivElement>()
  const byState = useMemo(() => new Map(d3.rollups(counts.data?.rows ?? [], (v) => d3.sum(v, (r) => r.n), (r) => r.state)), [counts.data])
  const maxN = d3.max([...byState.values()]) || 1
  const color = d3.scaleSequentialLog(seqInterpolator(dark)).domain([1, maxN]).clamp(true)
  const cols = selectedStates.length <= 1 ? 1 : w > 900 ? Math.min(4, selectedStates.length) : w > 560 ? 2 : 1

  return (
    <div className="card" style={{ opacity: loading ? 0.6 : 1 }}>
      <div className="section-head">
        <h2>How does the mix of isolate sources compare between states?</h2></div>
      <p className="sub">
        Click states on the map to compare them (Ctrl/⌘-click to add). Each treemap shows the selected state's isolates by source and
        sub-source, {f.y0}–{f.y1}; change the window in the filters above to see how the mix shifts over time.
      </p>
      <div className="grid g-map">
        <div>
          <USMap value={(a) => byState.get(a) ?? null} color={(v) => (v > 0 ? color(v) : 'var(--nodata)')} selected={selectedStates}
            onClick={(a, e) => pickState(a, e)} showTip={show} hideTip={hide}
            tip={(a) => ({ title: STATE_NAMES[a], rows: [{ label: `Isolates ${f.y0}–${f.y1}`, value: fmtInt(byState.get(a) ?? 0) }],
              note: selectedStates.includes(a) ? 'Selected' : 'Click to select · Ctrl/⌘-click to add' })} />
          <div className="legend">
            <ColorLegend log scale={color} label="Isolates with a state (log)" format={d3.format('~s')} width={200} />
            {selectedStates.length > 0 && <button className="linklike" onClick={() => setSelectedStates([])}>Clear selection</button>}
          </div>
        </div>
        <div ref={ref}>
          <div className="legend" style={{ marginBottom: 8 }}>
            {f.sources.map((s) => <span className="key" key={s}><span className="sw" style={{ background: SOURCE_VAR[s] }} />{s}</span>)}
          </div>
          {!selectedStates.length && <div className="callout muted">Select states on the map to compare their source mix.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: 14 }}>
            {data && selectedStates.map((st) => {
              const items = aggSubs(data.subsources.filter((s) => s.state === st), f.y0, f.y1, f.agg, minN)
              const bySrc = d3.rollups(items, (v) => d3.sum(v, (i) => i.n), (i) => i.source).sort((a, b) => b[1] - a[1])
              const tot = d3.sum(bySrc, (b) => b[1])
              return (
                <div key={st} className="state-panel">
                  <div className="state-panel-head">
                    <b>{STATE_NAMES[st]}</b>
                    <span className="muted small">{fmtInt(d3.sum(items, (i) => i.total))} isolates</span>
                    <button className="icon-btn" aria-label={`Remove ${STATE_NAMES[st]}`} onClick={() => pickState(st, { ctrlKey: true, metaKey: false, shiftKey: false })}>✕</button>
                  </div>
                  <div className="muted small" style={{ marginBottom: 4 }}>
                    {bySrc.map(([s, n]) => `${short(s)} ${fmtPct(n / tot)}`).join(' · ') || 'No isolates'}
                  </div>
                  <Treemap items={items} agg={f.agg} show={show} hide={hide} height={cols > 2 ? 200 : 240} />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
