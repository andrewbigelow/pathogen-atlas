import { useMemo, useState } from 'react'
import * as d3 from 'd3'
import { useApi, useWidth, aggregate, aggWord, fmtInt, fmtPct, SOURCES, SOURCE_VAR, STATE_NAMES } from '../lib'
import type { AggHow } from '../lib'
import { useStore } from '../store'
import { useTooltip } from '../components/Tooltip'
import type { TipContent } from '../components/Tooltip'
import { Seg, FilterCard, GeneField, geneText, PathogenField, MinCountField } from '../components/Controls'

type Show = (e: React.MouseEvent, c: TipContent) => void
interface GeneSrc {
  by_year: { year: number; source: string; n: number }[]
  subsources: { source: string; subsource: string; year: number; n: number }[]
  denominator: { year: number; source: string; n: number }[]
}

/** Combine each sub-source's yearly counts across the window with the chosen aggregation (zero-filled),
 *  and fold sub-sources below `minN` total isolates into "other <source>". */
function aggSubs<T extends { source: string; subsource: string; year: number; n: number }>(
  rows: T[], y0: number, y1: number, how: AggHow, minN: number,
): { source: string; subsource: string; n: number; total: number }[] {
  const years = d3.range(y0, y1 + 1)
  const groups = d3.groups(rows, (r) => r.source, (r) => r.subsource)
  const out: { source: string; subsource: string; n: number; total: number }[] = []
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
  const { f, gene, setGene } = useStore()
  const { show, hide, node } = useTooltip()
  const [minN, setMinN] = useState(25)
  const gs = useApi<GeneSrc>('gene_sources', { organism: f.organism, y0: f.y0, y1: f.y1, gene })
  const subs = useMemo(() => (gs.data ? aggSubs(gs.data.subsources, f.y0, f.y1, f.agg, minN) : []), [gs.data, f.y0, f.y1, f.agg, minN])
  const [mode, setMode] = useState<'share' | 'count' | 'carriage'>('share')
  const [focusSrc, setFocusSrc] = useState<string | null>(null)

  return (
    <div className="grid">
      <FilterCard>
        <GeneField value={gene} onChange={setGene} /><PathogenField />
        <MinCountField value={minN} onChange={setMinN} label="Min. isolates per sub-source" options={[0, 10, 25, 50, 100, 250, 500]} />
      </FilterCard>
      <div className="card" style={{ opacity: gs.loading ? 0.6 : 1 }}>
        <h2>Which sources carry <i>{geneText(gene)}</i>, and how is that shifting?</h2>
        <p className="sub">
          All US isolates with {geneText(gene)}, {f.y0}–{f.y1}, by isolation source. Click a band or legend entry to drill into its sub-sources.
        </p>
        <div className="controls">
          <Seg value={mode} onChange={setMode} options={[
            { v: 'share', label: 'Share of carriers' }, { v: 'count', label: 'Count' }, { v: 'carriage', label: '% of source carrying gene' }]} />
          <div className="legend">
            {SOURCES.map((s) => (
              <button key={s} className="chip" aria-pressed={focusSrc === s} onClick={() => setFocusSrc(focusSrc === s ? null : s)}>
                <span className="sw" style={{ background: SOURCE_VAR[s] }} />{s}
              </button>
            ))}
          </div>
        </div>
        {gs.data ? (
          <div className="grid g-2">
            <SourceTime data={gs.data} mode={mode} minN={minN} focus={focusSrc} setFocus={setFocusSrc} show={show} hide={hide} />
            <div>
              <div className="field-label" style={{ marginBottom: 4 }}>
                Sub-sources of {geneText(gene)} carriers {focusSrc ? `· ${focusSrc}` : '· all sources'} · {aggWord(f.agg).toLowerCase()} {f.agg === 'sum' ? 'count' : 'isolates per year'}
              </div>
              <Treemap items={subs.filter((s) => !focusSrc || s.source === focusSrc)} agg={f.agg}
                onPick={(s) => setFocusSrc(focusSrc === s ? null : s)} show={show} hide={hide} height={320} />
            </div>
          </div>
        ) : <div className="loading">Loading…</div>}
      </div>
      <StateCompare show={show} hide={hide} minN={minN} />
      {node}
    </div>
  )
}

function SourceTime({ data, mode, minN, focus, setFocus, show, hide }: {
  data: GeneSrc; minN: number; mode: 'share' | 'count' | 'carriage'; focus: string | null; setFocus: (s: string | null) => void
  show: Show; hide: () => void
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const h = 320
  const m = { l: 48, r: 16, t: 12, b: 24 }
  const years = Array.from(new Set(data.by_year.map((d) => d.year))).sort()
  const get = (arr: { year: number; source: string; n: number }[]) => {
    const mp = new Map(arr.map((d) => [`${d.year}|${d.source}`, d.n]))
    return (y: number, s: string) => mp.get(`${y}|${s}`) ?? 0
  }
  const num = get(data.by_year)
  const den = get(data.denominator)
  const rows = years.map((y) => {
    const tot = d3.sum(SOURCES, (s) => num(y, s))
    const o: Record<string, number> = { year: y, total: tot }
    SOURCES.forEach((s) => {
      o[s] = mode === 'share' ? (tot ? num(y, s) / tot : 0) : mode === 'count' ? num(y, s) : den(y, s) ? num(y, s) / den(y, s) : NaN
      o['n_' + s] = num(y, s)
      o['d_' + s] = den(y, s)
    })
    return o
  })
  if (years.length < 2) return <div ref={ref} className="muted">Too few years with this gene.</div>
  const x = d3.scaleLinear().domain(d3.extent(years) as [number, number]).range([m.l, w - m.r])
  const stacked = d3.stack<Record<string, number>>().keys([...SOURCES]).order(d3.stackOrderNone)(rows)
  const ymax = mode === 'share' ? 1 : mode === 'count' ? d3.max(rows, (r) => r.total) ?? 1 : d3.max(rows, (r) => d3.max(SOURCES, (s) => r[s] || 0)) ?? 1
  const y = d3.scaleLinear().domain([0, ymax]).nice().range([h - m.b, m.t])
  const fmt = mode === 'count' ? d3.format('~s') : d3.format('.0%')
  const hover = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const yr = Math.round(x.invert(e.clientX - r.left))
    const row = rows.find((d) => d.year === yr)
    if (!row) return
    show(e, {
      title: `${yr} · ${fmtInt(row.total)} carriers`,
      rows: [...SOURCES].reverse().map((s) => ({
        label: s,
        value: mode === 'carriage' ? `${fmtPct(row[s])} of ${fmtInt(row['d_' + s])}` : `${fmtInt(row['n_' + s])} (${fmtPct(row.total ? row['n_' + s] / row.total : 0)})`,
      })),
    })
  }
  return (
    <div ref={ref}>
      <svg width={w} height={h} onMouseMove={hover} onMouseLeave={hide}>
        {y.ticks(5).map((t) => (<g key={t} className="grid"><line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} />
          <text x={m.l - 6} y={y(t) + 4} textAnchor="end">{fmt(t)}</text></g>))}
        {years.map((yr) => <text key={yr} x={x(yr)} y={h - 6} textAnchor="middle">{years.length > 14 && yr % 2 ? '' : `'${String(yr).slice(2)}`}</text>)}
        {mode === 'carriage'
          ? SOURCES.map((s) => (
              <path key={s} d={d3.line<Record<string, number>>().defined((d) => isFinite(d[s]) && d['d_' + s] >= Math.max(1, minN)).x((d) => x(d.year)).y((d) => y(d[s]))(rows) ?? ''}
                fill="none" stroke={SOURCE_VAR[s]} strokeWidth={focus === s ? 3 : 2} opacity={focus && focus !== s ? 0.2 : 1}
                style={{ cursor: 'pointer' }} onClick={() => setFocus(focus === s ? null : s)} />
            ))
          : stacked.map((layer) => (
              <path key={layer.key} d={d3.area<d3.SeriesPoint<Record<string, number>>>().x((d) => x(d.data.year)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX)(layer) ?? ''}
                fill={SOURCE_VAR[layer.key]} stroke="var(--surface-1)" strokeWidth={1}
                opacity={focus && focus !== layer.key ? 0.25 : 1} style={{ cursor: 'pointer' }}
                onClick={() => setFocus(focus === layer.key ? null : layer.key)} />
            ))}
      </svg>
      {mode === 'carriage' && <div className="muted small">Lines hidden for years where a source has fewer than {Math.max(1, minN)} isolates.</div>}
    </div>
  )
}

function Treemap({ items, onPick, show, hide, height, agg }: {
  items: { source: string; subsource: string; n: number; total: number }[]; agg: AggHow; onPick: (s: string) => void; show: Show; hide: () => void; height: number
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
          return (
            <g key={src + l.data.name} transform={`translate(${l.x0},${l.y0})`} style={{ cursor: 'pointer' }}
              onClick={() => onPick(src)}
              onMouseMove={(e) => show(e, { title: l.data.name, rows: [
                { label: 'Source', value: src },
                ...(agg === 'sum' ? [] : [{ label: `${aggWord(agg)} isolates / yr`, value: d3.format(',.1f')(l.value ?? 0) }]),
                { label: 'Isolates (all years)', value: fmtInt(l.data.total ?? 0) }, { label: 'Share of tiles', value: fmtPct((l.value ?? 0) / total) }] })}
              onMouseLeave={hide}>
              <rect width={bw} height={bh} rx={3} fill={SOURCE_VAR[src]} opacity={0.9} />
              {bw > 60 && bh > 28 && (() => { const ink = src === 'Environment' || src === 'Unknown' ? '#0b0b0b' : '#fff'; return (
                <>
                  <text x={6} y={15} style={{ fill: ink, fontWeight: 600, fontSize: 11.5 }}>{l.data.name.length * 6.5 > bw ? l.data.name.slice(0, Math.floor(bw / 6.5) - 1) + '…' : l.data.name}</text>
                  <text x={6} y={29} style={{ fill: ink, opacity: 0.85 }}>{fmtPct((l.value ?? 0) / total)}</text>
                </>
              ) })()}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function StateCompare({ show, hide, minN }: { show: Show; hide: () => void; minN: number }) {
  const { f, selectedStates } = useStore()
  const [inc, setInc] = useState<'all' | 'filtered'>('all')
  const { data, loading } = useApi<{ by_year: { state: string; year: number; source: string; n: number }[]; subsources: { state: string; source: string; subsource: string; year: number; n: number }[] }>(
    selectedStates.length ? 'state_sources' : null,
    { organism: f.organism, y0: f.y0, y1: f.y1, states: selectedStates.join(','), sources: inc === 'all' ? SOURCES.join(',') : f.sources.join(',') })
  const [drill, setDrill] = useState<string | null>(null)
  const [ref, w] = useWidth<HTMLDivElement>()
  const cols = w > 900 ? 4 : w > 600 ? 2 : 1
  const pw = (w - (cols - 1) * 16) / cols
  const years = d3.range(f.y0, f.y1 + 1)
  const drillState = drill && selectedStates.includes(drill) ? drill : selectedStates[0]

  return (
    <div className="card" style={{ opacity: loading ? 0.6 : 1 }}>
      <h2>How do isolate sources compare across states over time?</h2>
      <p className="sub">Each panel is one of the selected states (change them in the bar at the top); bars show the share of isolates per year by source. Click a panel for its sub-source breakdown.</p>
      <div className="controls">
        <Seg value={inc} onChange={setInc} label="Isolates counted" options={[{ v: 'all', label: 'All sources' }, { v: 'filtered', label: `Source filter (${f.sources.length})` }]} />
      </div>
      <div className="legend" style={{ marginBottom: 8 }}>
        {SOURCES.map((s) => <span className="key" key={s}><span className="sw" style={{ background: SOURCE_VAR[s] }} />{s}</span>)}
      </div>
      <div ref={ref} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: 16 }}>
        {data && selectedStates.map((st) => {
          const rows = data.by_year.filter((d) => d.state === st)
          const total = d3.sum(rows, (r) => r.n)
          const ph = 150, m = { l: 30, b: 18, t: 4 }
          const x = d3.scaleBand<number>().domain(years).range([m.l, pw]).padding(0.12)
          const y = d3.scaleLinear().domain([0, 1]).range([ph - m.b, m.t])
          return (
            <div key={st} onClick={() => setDrill(st)} style={{ cursor: 'pointer', borderRadius: 8, padding: 6,
              outline: st === drillState ? '2px solid var(--accent)' : '1px solid var(--grid)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <b>{STATE_NAMES[st]}</b><span className="muted small">{fmtInt(total)} isolates</span>
              </div>
              <svg width={pw - 12} height={ph}>
                {[0, 0.5, 1].map((t) => <text key={t} x={m.l - 4} y={y(t) + 4} textAnchor="end">{d3.format('.0%')(t)}</text>)}
                {years.map((yr) => {
                  const yrRows = rows.filter((r) => r.year === yr)
                  const tot = d3.sum(yrRows, (r) => r.n)
                  let acc = 0
                  return (
                    <g key={yr} onMouseMove={(e) => show(e, { title: `${st} ${yr} · ${fmtInt(tot)} isolates`,
                      rows: [...SOURCES].reverse().map((s) => { const n = yrRows.find((r) => r.source === s)?.n ?? 0; return { label: s, value: `${fmtInt(n)} (${fmtPct(tot ? n / tot : 0)})` } }) })}
                      onMouseLeave={hide}>
                      <rect x={x(yr)} y={m.t} width={x.bandwidth()} height={ph - m.b - m.t} fill="transparent" />
                      {tot > 0 && SOURCES.map((s) => {
                        const n = yrRows.find((r) => r.source === s)?.n ?? 0
                        if (!n) return null
                        const y0 = y(acc), y1 = y(acc + n / tot)
                        acc += n / tot
                        return <rect key={s} x={x(yr)} width={x.bandwidth()} y={y1} height={Math.max(0, y0 - y1 - 1)} fill={SOURCE_VAR[s]} />
                      })}
                      {tot === 0 && <rect x={x(yr)} width={x.bandwidth()} y={ph - m.b - 2} height={2} fill="var(--nodata)" />}
                    </g>
                  )
                })}
                {years.filter((_, i) => i % Math.ceil(years.length / 5) === 0).map((yr) => (
                  <text key={yr} x={(x(yr) ?? 0) + x.bandwidth() / 2} y={ph - 4} textAnchor="middle">{yr}</text>
                ))}
              </svg>
            </div>
          )
        })}
      </div>
      {!selectedStates.length && <div className="muted" style={{ padding: 20 }}>Select states on any map, or use “+ add state” at the top, to compare them here.</div>}
      {data && drillState && (
        <div style={{ marginTop: 16 }}>
          <div className="field-label" style={{ marginBottom: 4 }}>{STATE_NAMES[drillState]} · sub-sources, {f.y0}–{f.y1} · {aggWord(f.agg).toLowerCase()} {f.agg === 'sum' ? 'count' : 'isolates per year'}</div>
          <Treemap items={aggSubs(data.subsources.filter((s) => s.state === drillState), f.y0, f.y1, f.agg, minN)} agg={f.agg} onPick={() => {}} show={show} hide={hide} height={240} />
        </div>
      )}
    </div>
  )
}
