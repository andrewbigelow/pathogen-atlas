import { useEffect, useMemo, useState } from 'react'
import * as d3 from 'd3'
import { useApi, useDark, useWidth, seqInterpolator, magmaSeries, aggRate, aggWord, fmtInt, fmtRate, STATE_NAMES } from '../lib'
import type { RateRow } from '../lib'
import { useStore } from '../store'
import type { Pick } from '../store'
import { USMap, ColorLegend } from '../components/USMap'
import { useTooltip } from '../components/Tooltip'
import type { TipContent } from '../components/Tooltip'
import {
  Slider, Seg, FilterCard, NormFields, PathogenField, HostField, ProductField, SourcesField, MinCountField, normUnit,
} from '../components/Controls'

type Show = (e: React.MouseEvent, c: TipContent) => void
interface StateAgg { state: string; n: number; receipts_k: number; rate: number | null; ok: boolean }

export default function Geography() {
  const { params, f, meta, selectedStates, pickState } = useStore()
  const [minN, setMinN] = useState(0)
  const { data, loading } = useApi<{ rows: RateRow[]; years_without_receipts: number[]; commodities: string[] }>(
    'state_rates', { ...params, norm: f.norm, commodity: f.commodity })
  const dark = useDark()
  const { show, hide, node } = useTooltip()
  const unit = normUnit(f, meta)
  const unitShort = normUnit(f, meta, true)

  const agg = useMemo<StateAgg[]>(() => {
    if (!data) return []
    return d3.groups(data.rows, (d) => d.state).map(([state, v]) => {
      const n = d3.sum(v, (d) => d.n)
      return { state, n, receipts_k: d3.sum(v, (d) => d.receipts_k ?? 0), rate: aggRate(v, f.agg, f.norm), ok: n >= minN }
    })
  }, [data, f.agg, f.norm, minN])
  const byState = useMemo(() => new Map(agg.map((a) => [a.state, a])), [agg])

  // one log-scaled threshold serves the map, ranking and the per-year grid
  const rates = agg.filter((a) => a.ok).map((a) => a.rate).filter((r): r is number => r != null && r > 0)
  const yearRates = (data?.rows ?? []).map((r) => r.rate).filter((r): r is number => r != null && r > 0).sort(d3.ascending)
  const all = [...rates, ...yearRates].sort(d3.ascending)
  const hi = Math.max(d3.quantile(all, 0.98) ?? 1, 0.02)
  const lo = Math.min(Math.max(0.01, d3.quantile(all, 0.02) ?? 0.1), hi / 10)
  const sliderMax = Math.max(hi, d3.max(rates) ?? 1)
  const [threshold, setThreshold] = useState<number | null>(null)
  const thr = threshold ?? (d3.quantile([...rates].sort(d3.ascending), 0.75) ?? 0)
  useEffect(() => setThreshold(null), [f.commodity, f.organism, f.norm, f.host, f.product, f.agg, f.sources.join()])

  const color = useMemo(() => d3.scaleSequentialLog(seqInterpolator(dark)).domain([lo, hi]).clamp(true), [dark, lo, hi])
  const sl = d3.scaleLog().domain([lo, sliderMax]).range([0, 1000]).clamp(true)
  const ranked = agg.filter((a) => a.ok && a.rate != null).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
  const flagged = useMemo(() => new Set(ranked.filter((a) => (a.rate ?? 0) >= thr).map((a) => a.state)), [ranked, thr])
  const lineStates = selectedStates.length ? selectedStates : ranked[0] ? [ranked[0].state] : []

  const filters = (
    <FilterCard>
      <NormFields /><PathogenField /><HostField /><ProductField /><SourcesField />
      <MinCountField value={minN} onChange={setMinN} label="Min. isolates per state" />
    </FilterCard>
  )
  if (!data) return <div className="grid">{filters}<div className="loading">Loading state rates…</div></div>
  if (f.norm === 'species' && !data.commodities.length) {
    return (
      <div className="grid">{filters}
        <div className="card callout">No USDA commodity matches this host / product, so it can’t be normalized by species. Pick a
          livestock host or product (chicken, cattle, swine, turkey, fish) or switch “Normalize by” to economic output.</div>
      </div>
    )
  }
  const flaggedList = ranked.filter((a) => flagged.has(a.state))
  const measure = `${aggWord(f.agg)} ${unitShort}`
  const tip = (a: string): TipContent => {
    const s = byState.get(a)
    const selected = selectedStates.includes(a)
    return {
      title: STATE_NAMES[a],
      rows: [
        { label: `Isolates ${f.y0}–${f.y1}`, value: s ? fmtInt(s.n) : '—' },
        ...(f.norm !== 'none' ? [{ label: 'Cash receipts (total)', value: s ? '$' + d3.format('.3~s')(s.receipts_k * 1000).replace('G', 'B') : '—' }] : []),
        { label: measure, value: s?.ok ? fmtRate(s.rate) : '—' },
        { label: 'Rank', value: s?.ok && s.rate != null ? `${ranked.findIndex((r) => r.state === a) + 1} of ${ranked.length}` : '—' },
      ],
      note: s && !s.ok ? `Fewer than ${minN} isolates — not ranked` : flagged.has(a) ? 'Above threshold' + (selected ? ' · selected' : '') : selected ? 'Selected' : 'Click to select · Ctrl/⌘-click to add',
    }
  }

  return (
    <div className="grid" style={{ opacity: loading ? 0.6 : 1 }}>
      {filters}
      <div className="card">
        <div className="controls" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2>Where is detection high relative to {f.norm === 'none' ? 'other states' : 'agricultural output'}?</h2>
            <p className="sub">
              {aggWord(f.agg)} {unit}, {f.y0}–{f.y1}
              {f.agg !== 'sum' && ' (one value per year, then combined)'}. States at or above the threshold are outlined.
            </p>
          </div>
          <Slider label={`Threshold (${unitShort}, log scale)`} value={Math.round(sl(Math.max(lo, thr)))} min={0} max={1000} step={1}
            onChange={(v) => setThreshold(+sl.invert(v).toPrecision(3))} format={() => fmtRate(thr)} />
        </div>
        <div className="grid g-2">
          <div>
            <USMap
              value={(a) => (byState.get(a)?.ok ? byState.get(a)?.rate : null)}
              color={(v) => color(v)}
              flagged={flagged}
              selected={selectedStates}
              insufficient={(a) => { const s = byState.get(a); return !!s && s.n > 0 && !s.ok }}
              onClick={(a, e) => pickState(a, e)}
              showTip={show}
              hideTip={hide}
              tip={tip}
            />
            <div className="legend" style={{ marginTop: 4 }}>
              <ColorLegend log scale={color} label={`${measure} (log)`} format={fmtRate} marker={{ value: thr, label: 'threshold' }} />
              <span className="key"><span className="sw" style={{ border: '2px solid var(--flag)' }} />≥ threshold</span>
              <span className="key"><span style={{ border: '1.5px solid var(--text-primary)', borderRadius: 9, fontSize: 10, fontWeight: 700, padding: '0 5px' }}>CA</span>selected</span>
              {minN > 0 && <span className="key"><svg width={12} height={12}><rect width={12} height={12} fill="url(#hatch)" /></svg>fewer than {minN}</span>}
              <span className="key"><span className="sw" style={{ background: 'var(--nodata)' }} />no data</span>
            </div>
          </div>
          <RankBars ranked={ranked} thr={thr} onPick={pickState} selected={selectedStates} show={show} hide={hide} tip={tip} />
        </div>
        <div className="callout">
          <b>{flaggedList.length}</b> of {ranked.length} states are at or above {fmtRate(thr)}:{' '}
          {flaggedList.map((a) => a.state).join(', ') || 'none'}.
          {data.years_without_receipts.length > 0 && (
            <span className="muted"> USDA receipts are not yet published for {data.years_without_receipts.join(', ')}; those isolates are excluded.</span>
          )}
        </div>
      </div>

      <div className="card">
        <h2>In which years was each state above the threshold?</h2>
        <p className="sub">
          The same measure for each single year. Cells with a dot are at or above {fmtRate(thr)}. Selected states are listed first;
          click a row to plot it below, Ctrl/⌘-click to add it to the comparison.
        </p>
        <YearHeatmap rows={data.rows} order={ranked.map((r) => r.state)} color={color} thr={thr}
          selected={selectedStates} pick={pickState} y0={f.y0} y1={f.y1} show={show} hide={hide} />
        {lineStates.length > 0 && <FocusLines rows={data.rows} thr={thr} states={lineStates} dark={dark}
          unit={unitShort} isDefault={!selectedStates.length} pick={pickState} show={show} hide={hide} />}
      </div>
      {node}
    </div>
  )
}

function RankBars({ ranked, thr, onPick, selected, show, hide, tip }: {
  ranked: StateAgg[]; thr: number; onPick: Pick; selected: string[]; show: Show; hide: () => void; tip: (a: string) => TipContent
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  // top 25 plus any selected states outside it, so a selection is always visible here
  const top = ranked.slice(0, 25)
  const extra = ranked.filter((r, i) => i >= 25 && selected.includes(r.state))
  const rows = [...top, ...extra]
  const rowH = 17
  const gap = extra.length ? 10 : 0
  const m = { l: 34, r: 48, t: 18, b: 4 }
  const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.rate ?? 0) ?? 1]).nice().range([m.l, w - m.r])
  const yOf = (i: number) => m.t + i * rowH + (i >= top.length ? gap : 0)
  return (
    <div ref={ref}>
      <div className="field-label" style={{ marginBottom: 4 }}>Top 25 states{extra.length ? ' + selected' : ''}</div>
      <svg width={w} height={yOf(rows.length) + m.b}>
        {x.ticks(4).map((t) => (
          <g key={t} className="grid"><line x1={x(t)} x2={x(t)} y1={m.t - 4} y2={yOf(rows.length)} />
            <text x={x(t)} y={10} textAnchor="middle">{fmtRate(t)}</text></g>
        ))}
        {rows.map((r, i) => {
          const above = (r.rate ?? 0) >= thr
          const sel = selected.includes(r.state)
          return (
            <g key={r.state} transform={`translate(0,${yOf(i)})`} style={{ cursor: 'pointer' }} onClick={(e) => onPick(r.state, e)}
              onMouseMove={(e) => show(e, tip(r.state))} onMouseLeave={hide}>
              <rect x={0} y={0} width={w} height={rowH} rx={3} fill={sel ? 'var(--accent-soft)' : 'transparent'} />
              <text x={m.l - 6} y={rowH / 2 + 4} textAnchor="end"
                style={{ fontWeight: sel ? 700 : 400, fill: sel ? 'var(--text-primary)' : undefined }}>{r.state}</text>
              <rect x={m.l} y={3} height={rowH - 6} width={Math.max(1, x(r.rate ?? 0) - m.l)} rx={2}
                fill={above ? 'var(--accent)' : 'var(--src-unknown)'} />
              <text x={x(r.rate ?? 0) + 4} y={rowH / 2 + 4} className="tnum">{fmtRate(r.rate)}{i >= top.length ? `  (#${ranked.indexOf(r) + 1})` : ''}</text>
            </g>
          )
        })}
        <line x1={x(thr)} x2={x(thr)} y1={m.t - 4} y2={yOf(rows.length)} stroke="var(--flag)" strokeWidth={1.5} />
      </svg>
    </div>
  )
}

function YearHeatmap({ rows, order, color, thr, selected, pick, y0, y1, show, hide }: {
  rows: RateRow[]; order: string[]; color: (v: number) => string; thr: number; selected: string[]
  pick: Pick; y0: number; y1: number; show: Show; hide: () => void
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [onlyAbove, setOnlyAbove] = useState(false)
  const years = d3.range(y0, y1 + 1).filter((y) => rows.some((r) => r.year === y))
  const cell = new Map(rows.map((r) => [`${r.state}|${r.year}`, r]))
  const base = onlyAbove ? order.filter((s) => years.some((y) => (cell.get(`${s}|${y}`)?.rate ?? 0) >= thr)) : order
  const states = [...selected.filter((s) => order.includes(s)), ...base.filter((s) => !selected.includes(s))]
  const m = { l: 34, t: 20, r: 60 }
  const cw = Math.max(10, (w - m.l - m.r) / Math.max(1, years.length))
  const ch = 13
  const nSel = selected.filter((s) => order.includes(s)).length
  const sepY = (i: number) => (nSel && i >= nSel ? 6 : 0)
  return (
    <div ref={ref}>
      <label className="small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <input type="checkbox" checked={onlyAbove} onChange={(e) => setOnlyAbove(e.target.checked)} />
        Only states with at least one year above threshold ({base.length})
      </label>
      <svg width={w} height={m.t + states.length * ch + 10}>
        {years.map((y, j) => (
          <text key={y} x={m.l + j * cw + cw / 2} y={12} textAnchor="middle">{years.length > 14 && j % 2 ? '' : `'${String(y).slice(2)}`}</text>
        ))}
        {states.map((s, i) => {
          const nAbove = years.filter((y) => (cell.get(`${s}|${y}`)?.rate ?? 0) >= thr).length
          const sel = selected.includes(s)
          return (
            <g key={s} transform={`translate(0,${m.t + i * ch + sepY(i)})`}>
              {sel && <rect x={0} y={0} width={m.l - 2} height={ch} rx={2} fill="var(--accent-soft)" />}
              <text x={m.l - 6} y={ch - 3} textAnchor="end" style={{ cursor: 'pointer', fontWeight: sel ? 700 : 400, fill: sel ? 'var(--text-primary)' : undefined }}
                onClick={(e) => pick(s, e)}>{s}</text>
              {years.map((y, j) => {
                const r = cell.get(`${s}|${y}`)
                const v = r?.rate
                const above = (v ?? 0) >= thr
                return (
                  <g key={y} onMouseMove={(e) => show(e, {
                    title: `${STATE_NAMES[s]}, ${y}`,
                    rows: [
                      { label: 'Isolates', value: r ? fmtInt(r.n) : '—' },
                      { label: 'Value', value: fmtRate(v) },
                      { label: 'Threshold', value: above ? 'above' : 'below' },
                    ],
                  })} onMouseLeave={hide} onClick={(e) => pick(s, e)} style={{ cursor: 'pointer' }}>
                    <rect x={m.l + j * cw + 1} y={1} width={cw - 2} height={ch - 2} rx={2}
                      fill={v == null ? 'var(--nodata)' : v === 0 ? 'var(--surface-2)' : color(v)} />
                    {above && <circle cx={m.l + j * cw + cw / 2} cy={ch / 2} r={2.2} fill="var(--surface-1)" stroke="var(--flag)" strokeWidth={1.2} />}
                  </g>
                )
              })}
              <text x={m.l + years.length * cw + 6} y={ch - 3} className="tnum">{nAbove} yr</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function FocusLines({ rows, thr, states, dark, unit, isDefault, pick, show, hide }: {
  rows: RateRow[]; thr: number; states: string[]; dark: boolean; unit: string; isDefault: boolean
  pick: Pick; show: Show; hide: () => void
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [scale, setScale] = useState<'linear' | 'log'>('linear')
  const [hoverYear, setHoverYear] = useState<number | null>(null)
  const h = 260
  const m = { l: 48, r: 44, t: 16, b: 24 }
  const colors = magmaSeries(states.length, dark)
  const series = states.map((s, i) => {
    const all = rows.filter((r) => r.state === s)
    return {
      state: s, color: colors[i],
      pts: all.filter((r) => r.rate != null && (scale === 'linear' || (r.rate ?? 0) > 0)).sort((a, b) => a.year - b.year),
    }
  })
  const allPts = series.flatMap((d) => d.pts)
  const years = [...new Set(allPts.map((p) => p.year))].sort((a, b) => a - b)
  if (!years.length) return <div className="muted small" style={{ marginTop: 16 }}>No yearly data for the selected states.</div>
  const x = d3.scaleLinear().domain(d3.extent(years) as [number, number]).range([m.l, w - m.r])
  const ymax = Math.max(thr * 1.15, d3.max(allPts, (d) => d.rate ?? 0) ?? 1)
  const ymin = Math.max(0.01, Math.min(thr / 1.5, d3.min(allPts, (d) => d.rate ?? 0) ?? 0.1))
  const y = scale === 'log'
    ? d3.scaleLog().domain([ymin, ymax]).nice().range([h - m.b, m.t])
    : d3.scaleLinear().domain([0, ymax]).nice().range([h - m.b, m.t])
  const yTicks = scale === 'log' ? y.ticks(5).filter((t) => /^[125]/.test(String(t))) : y.ticks(5)
  const line = d3.line<RateRow>().x((d) => x(d.year)).y((d) => y(d.rate ?? 0))
  const step = years.length > 1 ? x(years[1]) - x(years[0]) : w
  const ends = series.filter((d) => d.pts.length).map((d) => ({ d, y: y(d.pts[d.pts.length - 1].rate ?? 0) })).sort((a, b) => a.y - b.y)
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12

  return (
    <div ref={ref} style={{ marginTop: 16 }}>
      <div className="controls" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontWeight: 600 }}>{unit[0].toUpperCase() + unit.slice(1)} by year{isDefault ? ' · top-ranked state (select states to compare)' : ''}</div>
          <div className="legend" style={{ marginTop: 6 }}>
            {series.map((d) => {
              const above = d.pts.filter((p) => (p.rate ?? 0) >= thr).length
              return (
                <span key={d.state} className="chip static" style={{ gap: 6 }} title={`${above} year${above === 1 ? '' : 's'} above threshold`}>
                  <span style={{ width: 14, height: 3, borderRadius: 2, background: d.color }} />
                  {STATE_NAMES[d.state]} <span className="muted tnum">{above} yr ≥ thr</span>
                  {!isDefault && <button aria-label={`Remove ${d.state}`} onClick={() => pick(d.state, { ctrlKey: true, metaKey: false, shiftKey: false })}>✕</button>}
                </span>
              )
            })}
          </div>
        </div>
        <Seg label="Y axis" value={scale} onChange={setScale} options={[{ v: 'linear', label: 'Linear' }, { v: 'log', label: 'Log' }]} />
      </div>
      <svg width={w} height={h} onMouseLeave={() => { setHoverYear(null); hide() }}>
        {yTicks.map((t) => (
          <g key={t} className="grid"><line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} />
            <text x={m.l - 6} y={y(t) + 4} textAnchor="end">{fmtRate(t)}</text></g>
        ))}
        {years.map((yr) => <text key={yr} x={x(yr)} y={h - 6} textAnchor="middle">{years.length > 14 && yr % 2 ? '' : yr}</text>)}
        <line x1={m.l} x2={w - m.r} y1={y(thr)} y2={y(thr)} stroke="var(--flag)" strokeWidth={1} strokeDasharray="4 3" />
        <text x={m.l + 4} y={y(thr) - 4}>threshold {fmtRate(thr)}</text>
        {hoverYear != null && <line x1={x(hoverYear)} x2={x(hoverYear)} y1={m.t} y2={h - m.b} stroke="var(--text-muted)" strokeWidth={1} />}
        {series.map((d) => (
          <g key={d.state}>
            <path d={line(d.pts) ?? ''} fill="none" stroke={d.color} strokeWidth={2} strokeLinejoin="round" />
            {d.pts.map((p) => {
              const a = (p.rate ?? 0) >= thr
              return <circle key={p.year} cx={x(p.year)} cy={y(p.rate ?? 0)} r={hoverYear === p.year ? 5 : a ? 4 : 3}
                fill={a ? d.color : 'var(--surface-1)'} stroke={a ? 'var(--surface-1)' : d.color} strokeWidth={a ? 1.5 : 2} />
            })}
          </g>
        ))}
        {ends.map(({ d, y: ly }) => <text key={d.state} x={w - m.r + 6} y={ly + 4} style={{ fontWeight: 600, fill: 'var(--text-primary)' }}>{d.state}</text>)}
        {years.map((yr) => (
          <rect key={yr} x={x(yr) - step / 2} y={m.t} width={step} height={h - m.t - m.b} fill="transparent"
            onMouseMove={(e) => {
              setHoverYear(yr)
              show(e, {
                title: String(yr),
                rows: series.map((d) => ({ d, p: d.pts.find((p) => p.year === yr) }))
                  .sort((a, b) => (b.p?.rate ?? -1) - (a.p?.rate ?? -1))
                  .map(({ d, p }) => ({
                    label: `${d.state}${p && (p.rate ?? 0) >= thr ? ' ▲' : ''}`,
                    value: p ? `${fmtRate(p.rate)} (${fmtInt(p.n)} isolates)` : '—',
                  })),
              })
            }} />
        ))}
      </svg>
      <div className="muted small">▲ = at or above threshold. Filled points mark years above threshold.</div>
    </div>
  )
}
