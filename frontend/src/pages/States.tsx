import { useEffect, useMemo, useState } from 'react'
import * as d3 from 'd3'
import {
  useApi, useDark, useWidth, seqInterpolator, magmaSeries, aggregate, aggRate, aggWord, dodgeLabels,
  fmtInt, fmtPct, fmtRate, fmtYears, wilson, STATE_NAMES,
} from '../lib'
import type { PrevRow } from '../lib'
import { useSection } from '../store'
import type { Pick } from '../store'
import { USMap, ColorLegend } from '../components/USMap'
import { useTooltip } from '../components/Tooltip'
import type { TipContent } from '../components/Tooltip'
import { DragThreshold, YearOverlay, tidy } from '../components/Chart'
import {
  Slider, Seg, Select, FilterPanel, FilterGroup, NormFields, PathogenField, HostField, ProductField, SourcesField,
  GeneField, MinCountField, YearRange, normUnit, geneText,
} from '../components/Controls'

interface Resp { gene: string; rows: PrevRow[]; trend: { year: number; n: number; n_gene: number }[] }
type Show = (e: React.MouseEvent, c: TipContent) => void
type ColorBy = 'rate' | 'prev' | 'disc'
interface Row {
  state: string; n: number; n_gene: number; ok: boolean
  rate: number | null; prevalence: number | null; receipts_k: number
  yearsAbove: number[]; d: number | null
}

const COLOR_BY: { v: ColorBy; label: string }[] = [
  { v: 'rate', label: 'Detection rate' },
  { v: 'prev', label: 'AMR gene prevalence' },
  { v: 'disc', label: 'Discrepancy' },
]
const discColor = (d: number | null | undefined, thr: number) =>
  d == null ? 'var(--nodata)' : d >= thr ? 'var(--div-pos)' : d <= -thr ? 'var(--div-neg)' : 'var(--src-unknown)'

/** One page with a shared map + selection, then the detection, prevalence and discrepancy sections. */
export default function States() {
  const { params, f, meta, selectedStates, pickState, setSelectedStates } = useSection()
  const [minN, setMinN] = useState(10)
  const [colorBy, setColorBy] = useState<ColorBy>('rate')
  const [threshold, setThreshold] = useState<number | null>(null)
  const [dThr, setDThr] = useState(0.4)
  const { data, loading } = useApi<Resp>('gene_prevalence', { ...params, gene: f.gene, norm: f.norm, commodity: f.commodity })
  const dark = useDark()
  const { show, hide, node } = useTooltip()
  const unitShort = normUnit(f, meta, true)
  useEffect(() => setThreshold(null), [f.commodity, f.organism, f.norm, f.host, f.product, f.agg, f.sources])

  // per-state aggregates across the year window
  const base = useMemo(() => {
    if (!data) return []
    return d3.groups(data.rows, (r) => r.state).map(([state, v]) => {
      const n = d3.sum(v, (r) => r.n), n_gene = d3.sum(v, (r) => r.n_gene)
      const yearly = v.filter((r) => r.n > 0)
      return {
        state, n, n_gene, ok: n >= Math.max(1, minN),
        rate: aggRate(v, f.agg, f.norm),
        prevalence: aggregate(yearly.map((r) => r.n_gene / r.n), f.agg, n ? n_gene / n : null),
        receipts_k: d3.sum(v, (r) => r.receipts_k ?? 0),
      }
    })
  }, [data, minN, f.agg, f.norm])

  const okRates = base.filter((s) => s.ok && s.rate != null).map((s) => s.rate!).sort(d3.ascending)
  const thr = threshold ?? tidy(d3.quantile(okRates, 0.75) ?? 0)

  // discrepancy = percentile rank of prevalence − percentile rank of normalised detection rate
  const rows = useMemo<Row[]>(() => {
    const v = base.filter((s) => s.ok && s.prevalence != null && s.rate != null && s.rate > 0)
    const pr = (arr: number[], x: number) => (arr.filter((a) => a < x).length + 0.5 * (arr.filter((a) => a === x).length - 1)) / Math.max(1, arr.length - 1)
    const prevs = v.map((s) => s.prevalence!), rates = v.map((s) => s.rate!)
    const disc = new Map(v.map((s) => [s.state, pr(prevs, s.prevalence!) - pr(rates, s.rate!)]))
    const yearRows = d3.group(data?.rows ?? [], (r) => r.state)
    return base.map((s) => ({
      ...s,
      d: disc.get(s.state) ?? null,
      yearsAbove: (yearRows.get(s.state) ?? []).filter((r) => r.rate != null && r.rate >= thr && thr > 0).map((r) => r.year),
    }))
  }, [base, data, thr])
  const byState = useMemo(() => new Map(rows.map((r) => [r.state, r])), [rows])
  const ranked = rows.filter((s) => s.ok && s.rate != null).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))

  const filters = (
    <FilterPanel note="These filters apply to the State surveillance page only. Clinical isolates rarely report a state, so this page uses food and environmental isolates.">
      <FilterGroup label="Isolates"><PathogenField /><SourcesField /><HostField /><ProductField /></FilterGroup>
      <FilterGroup label="AMR"><GeneField /></FilterGroup>
      <FilterGroup label="Measure">
        <NormFields />
        <MinCountField value={minN} onChange={setMinN} label="Min. isolates per state" options={[1, 5, 10, 25, 50, 100, 250, 500]} />
      </FilterGroup>
    </FilterPanel>
  )
  if (!data) return <div className="grid">{filters}<div className="loading">Loading state data…</div></div>

  const gene = geneText(f.gene)
  const rateLabel = `${aggWord(f.agg)} ${unitShort}`
  const prevLabel = `${aggWord(f.agg)} share with ${gene}`
  const flagged = new Set(ranked.filter((r) => (r.rate ?? 0) >= thr).map((r) => r.state))
  const discRows = rows.filter((r) => r.d != null)

  // map colouring
  const rates = ranked.map((r) => r.rate!).filter((r) => r > 0).sort(d3.ascending)
  const hi = Math.max(d3.quantile(rates, 0.98) ?? 1, 0.02)
  const lo = Math.min(Math.max(0.01, d3.quantile(rates, 0.02) ?? 0.1), hi / 10)
  const rateColor = d3.scaleSequentialLog(seqInterpolator(dark)).domain([lo, hi]).clamp(true)
  const maxPrev = d3.max(rows.filter((r) => r.ok), (r) => r.prevalence ?? 0) || 0.01
  const prevColor = d3.scaleSequential(seqInterpolator(dark)).domain([0, maxPrev])
  const mapValue = (a: string) => {
    const s = byState.get(a)
    if (!s?.ok) return null
    return colorBy === 'rate' ? s.rate : colorBy === 'prev' ? s.prevalence : s.d
  }
  const mapColor = (v: number) => (colorBy === 'rate' ? rateColor(v) : colorBy === 'prev' ? prevColor(v) : discColor(v, dThr))

  const tip = (a: string): TipContent => {
    const s = byState.get(a)
    if (!s || s.n === 0) return { title: STATE_NAMES[a], note: 'No isolates with state + year' }
    const [cl, ch] = wilson(s.n_gene, s.n)
    const sel = selectedStates.includes(a)
    return {
      title: STATE_NAMES[a],
      rows: [
        { label: `Isolates ${f.y0}–${f.y1}`, value: fmtInt(s.n) },
        { label: rateLabel, value: s.ok ? fmtRate(s.rate) : '—' },
        { label: 'Rate rank', value: s.ok && s.rate != null ? `${ranked.findIndex((r) => r.state === a) + 1} of ${ranked.length}` : '—' },
        { label: `Years ≥ ${fmtRate(thr)}`, value: s.yearsAbove.length ? fmtYears(s.yearsAbove) : 'none' },
        { label: `With ${gene}`, value: `${fmtInt(s.n_gene)} (${s.ok ? fmtPct(s.prevalence) : '—'})` },
        { label: 'Pooled 95% CI', value: `${fmtPct(cl)} – ${fmtPct(ch)}` },
        ...(s.d != null ? [{ label: 'Discrepancy', value: s.d.toFixed(2) }] : []),
      ],
      note: !s.ok ? `Fewer than ${minN} isolates — not ranked` : sel ? 'Selected · click to deselect' : 'Click to select · Ctrl/⌘-click to add',
    }
  }
  const lineStates = selectedStates.length ? selectedStates : ranked.slice(0, 3).map((r) => r.state)
  const colorLink = (v: ColorBy) => colorBy === v
    ? <span className="map-tag">Shown on map</span>
    : <button className="linklike" onClick={() => { setColorBy(v); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Colour map by this ↑</button>

  return (
    <div className="grid" style={{ opacity: loading ? 0.6 : 1 }}>
      {filters}

      <div className="card">
        <div className="grid g-2e">
          <div>
            <div className="controls" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <div>
                <h2>States of interest</h2>
                <p className="sub" style={{ margin: 0 }}>Click a state to select it · Ctrl/⌘-click to add or remove. The selection drives every section below.</p>
              </div>
              <Select id="colorby" label="Colour map by" value={colorBy} onChange={(v) => setColorBy(v as ColorBy)} options={COLOR_BY} />
            </div>
            <USMap
              value={mapValue}
              color={mapColor}
              flagged={colorBy === 'rate' ? flagged : undefined}
              selected={selectedStates}
              insufficient={(a) => { const s = byState.get(a); return !!s && s.n > 0 && !s.ok }}
              onClick={(a, e) => pickState(a, e)}
              showTip={show} hideTip={hide} tip={tip}
            />
            <div className="legend" style={{ marginTop: 4 }}>
              {colorBy === 'rate' && <>
                <ColorLegend log scale={rateColor} label={`${rateLabel} (log)`} format={fmtRate} marker={{ value: thr, label: 'threshold' }} />
                <span className="key" title="States whose detection rate is at or above the threshold are outlined on the map.">
                  <span className="sw" style={{ border: '2px solid var(--flag)' }} />
                  outlined = at or above threshold ({fmtRate(thr)})
                </span>
              </>}
              {colorBy === 'prev' && <ColorLegend scale={prevColor} label={prevLabel} format={d3.format('.0%')} />}
              {colorBy === 'disc' && <DiscLegend thr={dThr} />}
              <span className="key"><svg width={12} height={12}><rect width={12} height={12} fill="url(#hatch)" /></svg>fewer than {minN}</span>
              <span className="key"><span className="sw" style={{ background: 'var(--nodata)' }} />no data</span>
            </div>
            <YearRange />
          </div>
          <SummaryTable rows={selectedStates.map((s) => byState.get(s)).filter((s): s is Row => !!s)} gene={gene}
            rateLabel={rateLabel} thr={thr} minN={minN} pick={pickState} clear={() => setSelectedStates([])} />
        </div>
      </div>

      <div className="card">
        <div className="section-head">
          <h2>Where and when is detection high relative to {f.norm === 'none' ? 'other states' : 'agricultural output'}?</h2>
          {colorLink('rate')}
        </div>
        <p className="sub">
          {rateLabel}, {f.y0}–{f.y1}{f.agg !== 'sum' && ' (one value per year, then combined)'}. Drag the threshold line (or its handle) on
          either chart. <b>{flagged.size}</b> of {ranked.length} states are at or above {fmtRate(thr)}.
        </p>
        <div className="grid g-2e">
          <RankBars ranked={ranked} thr={thr} setThr={setThreshold} onPick={pickState} selected={selectedStates} show={show} hide={hide} tip={tip} />
          <FocusLines rows={data.rows} thr={thr} setThr={setThreshold} states={lineStates} dark={dark} unit={unitShort}
            isDefault={!selectedStates.length} pick={pickState} show={show} hide={hide} />
        </div>
      </div>

      <div className="card">
        <div className="section-head">
          <h2>Which states have the highest share of isolates carrying <i>{gene}</i>?</h2>
          {colorLink('prev')}
        </div>
        <p className="sub">
          {aggWord(f.agg)} share of {f.sources.join(' + ').toLowerCase()} isolates with {gene}, {f.y0}–{f.y1}
          {f.agg === 'sum' ? ' (all years pooled)' : ' (share computed per year, then combined)'}.
        </p>
        <div className="grid g-2e">
          <PrevDots rows={rows.filter((r) => r.ok && r.prevalence != null).sort((a, b) => (b.prevalence ?? 0) - (a.prevalence ?? 0))}
            show={show} hide={hide} tip={tip} selected={selectedStates} onPick={pickState} pooled={f.agg === 'sum'} />
          <Trend trend={data.trend} rows={data.rows} states={selectedStates} gene={gene} dark={dark} show={show} hide={hide} />
        </div>
      </div>

      <div className="card">
        <div className="section-head">
          <h2>Where does resistance prevalence diverge from detection rate?</h2>
          {colorLink('disc')}
        </div>
        <div className="controls" style={{ justifyContent: 'space-between' }}>
          <p className="sub" style={{ margin: 0, maxWidth: 720 }}>
            Each dot is a state. x = {rateLabel.toLowerCase()} (log), y = {prevLabel.toLowerCase()}.
            Discrepancy = percentile rank of prevalence − percentile rank of detection rate. States beyond ±{dThr.toFixed(2)} are coloured and labelled.
          </p>
          <Slider label="Discrepancy threshold" value={dThr} min={0} max={1} step={0.05} onChange={setDThr} format={(v) => '±' + v.toFixed(2)} />
        </div>
        <div className="grid g-2">
          <Scatter rows={discRows} dThr={dThr} show={show} hide={hide} tip={tip} selected={selectedStates} onPick={pickState}
            gene={gene} xLabel={`${rateLabel} (log scale) →`} />
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>Flagged states ({discRows.filter((d) => Math.abs(d.d!) >= dThr).length})</div>
            <table className="data">
              <thead><tr><th>State</th><th>Prevalence</th><th>Rate</th><th>Discrepancy</th></tr></thead>
              <tbody>
                {discRows.filter((d) => Math.abs(d.d!) >= dThr).sort((a, b) => b.d! - a.d!).map((d) => (
                  <tr key={d.state} className={selectedStates.includes(d.state) ? 'sel' : ''} onClick={(e) => pickState(d.state, e)}>
                    <td>{STATE_NAMES[d.state]}</td><td>{fmtPct(d.prevalence)}</td><td>{fmtRate(d.rate)}</td>
                    <td><DiscCell d={d.d!} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">▲ resistance more common than the state's detection rate would rank it. ▼ high detection but low prevalence.</p>
          </div>
        </div>
      </div>
      {node}
    </div>
  )
}

function DiscCell({ d }: { d: number }) {
  return <span style={{ color: d > 0 ? 'var(--div-pos)' : 'var(--div-neg)', fontWeight: 600 }}>{d > 0 ? '▲ ' : '▼ '}{d.toFixed(2)}</span>
}

function DiscLegend({ thr }: { thr: number }) {
  return (
    <>
      <span className="key"><span className="sw" style={{ background: 'var(--div-pos)', borderRadius: 6 }} />prevalence ranks higher (≥ +{thr.toFixed(2)})</span>
      <span className="key"><span className="sw" style={{ background: 'var(--div-neg)', borderRadius: 6 }} />detection ranks higher (≤ −{thr.toFixed(2)})</span>
      <span className="key"><span className="sw" style={{ background: 'var(--src-unknown)', borderRadius: 6 }} />within threshold</span>
    </>
  )
}

function SummaryTable({ rows, gene, rateLabel, thr, minN, pick, clear }: {
  rows: Row[]; gene: string; rateLabel: string; thr: number; minN: number; pick: Pick; clear: () => void
}) {
  return (
    <div>
      <div className="controls" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <div className="field-label">Selected states ({rows.length})</div>
        {rows.length > 0 && <button className="linklike" onClick={clear}>Clear selection</button>}
      </div>
      {!rows.length
        ? <div className="callout muted">Click states on the map, bars or scatter to compare them here. Ctrl/⌘-click adds more.</div>
        : (
          <table className="data summary">
            <thead><tr>
              <th>State</th><th title={rateLabel}>Rate</th><th>Years ≥ {fmtRate(thr)}</th>
              <th>With {gene}</th><th>Prevalence (95% CI)</th><th>Discrepancy</th><th />
            </tr></thead>
            <tbody>
              {rows.map((s) => {
                const [lo, hi] = wilson(s.n_gene, s.n)
                return (
                  <tr key={s.state}>
                    <td><b>{STATE_NAMES[s.state]}</b><div className="muted small">{fmtInt(s.n)} isolates</div></td>
                    <td>{s.ok ? fmtRate(s.rate) : '—'}</td>
                    <td>{s.yearsAbove.length}<div className="muted small">{fmtYears(s.yearsAbove) || 'none'}</div></td>
                    <td>{fmtInt(s.n_gene)}</td>
                    <td>{s.ok ? fmtPct(s.prevalence) : <span className="muted">&lt; {minN} isolates</span>}
                      <div className="muted small">{s.n ? `${fmtPct(lo)} – ${fmtPct(hi)}` : '—'}</div></td>
                    <td>{s.d == null ? '—' : <DiscCell d={s.d} />}</td>
                    <td><button className="icon-btn" aria-label={`Remove ${STATE_NAMES[s.state]}`}
                      onClick={() => pick(s.state, { ctrlKey: true, metaKey: false, shiftKey: false })}>✕</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      <p className="muted small" style={{ marginTop: 8 }}>Rate = {rateLabel}. Years are counted one at a time against the detection-rate threshold.</p>
    </div>
  )
}

function RankBars({ ranked, thr, setThr, onPick, selected, show, hide, tip }: {
  ranked: Row[]; thr: number; setThr: (v: number) => void; onPick: Pick; selected: string[]; show: Show; hide: () => void; tip: (a: string) => TipContent
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  // top 25 plus any selected states outside it, so a selection is always visible here
  const top = ranked.slice(0, 25)
  const extra = ranked.filter((r, i) => i >= 25 && selected.includes(r.state))
  const rows = [...top, ...extra]
  const rowH = 17
  const gap = extra.length ? 10 : 0
  const m = { l: 34, r: 48, t: 22, b: 4 }
  const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.rate ?? 0) || 1]).nice().range([m.l, w - m.r])
  const yOf = (i: number) => m.t + i * rowH + (i >= top.length ? gap : 0)
  const bottom = yOf(rows.length)
  return (
    <div ref={ref}>
      <div className="field-label" style={{ marginBottom: 4 }}>Top 25 states{extra.length ? ' + selected' : ''} · linear scale</div>
      <svg width={w} height={bottom + m.b}>
        {x.ticks(4).map((t) => (
          <g key={t} className="grid"><line x1={x(t)} x2={x(t)} y1={m.t - 4} y2={bottom} />
            <text x={x(t)} y={10} textAnchor="middle">{fmtRate(t)}</text></g>
        ))}
        {rows.map((r, i) => {
          const above = (r.rate ?? 0) >= thr
          const sel = selected.includes(r.state)
          return (
            <g key={r.state} className="bar-row" transform={`translate(0,${yOf(i)})`} onClick={(e) => onPick(r.state, e)}
              onMouseMove={(e) => show(e, tip(r.state))} onMouseLeave={hide}>
              <rect className={'row-hl' + (sel ? ' sel' : '')} x={0} y={0} width={w} height={rowH} rx={3} />
              <text x={m.l - 6} y={rowH / 2 + 4} textAnchor="end"
                style={{ fontWeight: sel ? 700 : 400, fill: sel ? 'var(--text-primary)' : undefined }}>{r.state}</text>
              <rect x={m.l} y={3} height={rowH - 6} width={Math.max(1, x(r.rate ?? 0) - m.l)} rx={2}
                fill={above ? 'var(--accent)' : 'var(--src-unknown)'} />
              <text x={x(r.rate ?? 0) + 4} y={rowH / 2 + 4} className="tnum">{fmtRate(r.rate)}{i >= top.length ? `  (#${ranked.indexOf(r) + 1})` : ''}</text>
            </g>
          )
        })}
        <DragThreshold orient="v" at={x(Math.min(thr, x.domain()[1]))} from={m.t - 6} to={bottom} label={fmtRate(thr)}
          onChange={(px) => setThr(tidy(Math.max(0, Math.min(x.domain()[1], x.invert(px)))))} />
      </svg>
    </div>
  )
}

function FocusLines({ rows, thr, setThr, states, dark, unit, isDefault, pick, show, hide }: {
  rows: PrevRow[]; thr: number; setThr: (v: number) => void; states: string[]; dark: boolean; unit: string; isDefault: boolean
  pick: Pick; show: Show; hide: () => void
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [scale, setScale] = useState<'linear' | 'log'>('linear')
  const [hoverYear, setHoverYear] = useState<number | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const h = 320
  const m = { l: 48, r: 46, t: 16, b: 24 }
  const colors = magmaSeries(states.length, dark)
  const series = states.map((s, i) => ({
    state: s, color: colors[i],
    pts: rows.filter((r) => r.state === s && r.rate != null && (scale === 'linear' || (r.rate ?? 0) > 0)).sort((a, b) => a.year - b.year),
  }))
  const allPts = series.flatMap((d) => d.pts)
  const years = [...new Set(allPts.map((p) => p.year))].sort((a, b) => a - b)
  const header = (
    <div className="controls" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 }}>
      <div>
        <div className="field-label">{unit} by year{isDefault ? ' · top 3 states (select states to compare)' : ' · selected states'}</div>
        <div className="legend" style={{ marginTop: 6 }}>
          {series.map((d) => {
            const above = d.pts.filter((p) => (p.rate ?? 0) >= thr).length
            return (
              <span key={d.state} className="chip static" style={{ gap: 6 }} onMouseEnter={() => setFocus(d.state)} onMouseLeave={() => setFocus(null)}>
                <span style={{ width: 14, height: 3, borderRadius: 2, background: d.color }} />
                {d.state} <span className="muted tnum">{above} yr ≥ thr</span>
                {!isDefault && <button aria-label={`Remove ${d.state}`} onClick={() => pick(d.state, { ctrlKey: true, metaKey: false, shiftKey: false })}>✕</button>}
              </span>
            )
          })}
        </div>
      </div>
      <Seg label="Y axis" value={scale} onChange={setScale} options={[{ v: 'linear', label: 'Linear' }, { v: 'log', label: 'Log' }]} />
    </div>
  )
  if (!years.length) return <div ref={ref}>{header}<div className="muted small">No yearly data for these states.</div></div>
  const x = d3.scaleLinear().domain(d3.extent(years) as [number, number]).range([m.l, w - m.r])
  const ymax = Math.max(thr * 1.15, d3.max(allPts, (d) => d.rate ?? 0) ?? 1)
  const ymin = Math.max(0.01, Math.min(thr > 0 ? thr / 1.5 : Infinity, d3.min(allPts, (d) => d.rate ?? 0) ?? 0.1))
  // Lines are position-encoded, not length-encoded, so the linear axis starts at the
  // lowest plotted value (less a margin) rather than at zero. This keeps the series
  // and the threshold readable instead of squashing them into the top of the panel.
  // The floor is kept at 0 when the data nearly reaches it, so nothing looks clipped.
  const lo = Math.min(thr, d3.min(allPts, (d) => d.rate ?? 0) ?? 0)
  const linFloor = lo <= ymax * 0.15 ? 0 : Math.max(0, lo - (ymax - lo) * 0.1)
  const y = scale === 'log'
    ? d3.scaleLog().domain([ymin, ymax]).nice().range([h - m.b, m.t])
    : d3.scaleLinear().domain([linFloor, ymax]).nice().range([h - m.b, m.t])
  const yTicks = scale === 'log' ? y.ticks(5).filter((t) => /^[125]/.test(String(t))) : y.ticks(5)
  const line = d3.line<PrevRow>().x((d) => x(d.year)).y((d) => y(d.rate ?? 0))
  const withPts = series.filter((d) => d.pts.length)
  const endY = withPts.map((d) => y(d.pts[d.pts.length - 1].rate ?? 0))
  const labelY = dodgeLabels(endY, 13, m.t + 4, h - m.b)
  const thrY = y(Math.max(thr, y.domain()[0]))
  const dim = (s: string) => (focus && focus !== s ? 0.15 : 1)

  return (
    <div ref={ref}>
      {header}
      <svg width={w} height={h} onMouseLeave={() => { setHoverYear(null); hide() }}>
        <rect x={m.l} y={m.t} width={w - m.l - m.r} height={Math.max(0, thrY - m.t)} fill="var(--accent-soft)" opacity={0.45} />
        {yTicks.map((t) => (
          <g key={t} className="grid"><line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} />
            <text x={m.l - 6} y={y(t) + 4} textAnchor="end">{fmtRate(t)}</text></g>
        ))}
        {years.map((yr) => <text key={yr} x={x(yr)} y={h - 6} textAnchor="middle">{years.length > 14 && yr % 2 ? '' : yr}</text>)}
        {series.map((d) => (
          <g key={d.state} opacity={dim(d.state)}>
            <path d={line(d.pts) ?? ''} fill="none" stroke={d.color} strokeWidth={focus === d.state ? 3 : 2} strokeLinejoin="round" />
            {d.pts.map((p) => {
              const a = (p.rate ?? 0) >= thr
              return <circle key={p.year} cx={x(p.year)} cy={y(p.rate ?? 0)} r={hoverYear === p.year ? 5 : a ? 4 : 3}
                fill={a ? d.color : 'var(--surface-1)'} stroke={a ? 'var(--surface-1)' : d.color} strokeWidth={a ? 1.5 : 2} />
            })}
          </g>
        ))}
        {withPts.map((d, i) => {
          const last = d.pts[d.pts.length - 1]
          const lx = x(last.year)
          return (
            <g key={d.state} opacity={dim(d.state)}>
              {Math.abs(labelY[i] - endY[i]) > 2 && (
                <polyline points={`${lx + 5},${endY[i]} ${w - m.r + 2},${labelY[i]}`} fill="none" stroke={d.color} strokeWidth={1} />
              )}
              <text x={w - m.r + 5} y={labelY[i] + 4} style={{ fontWeight: 600, fill: d.color }}>{d.state}</text>
            </g>
          )
        })}
        <YearOverlay years={years} x={x} top={m.t} bottom={h - m.b} hover={hoverYear}
          onHover={(yr, e) => {
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
        <DragThreshold orient="h" at={thrY} from={m.l} to={w - m.r} label={`threshold ${fmtRate(thr)}`}
          onChange={(py) => setThr(tidy(Math.max(scale === 'log' ? y.domain()[0] : 0, Math.min(y.domain()[1], y.invert(py)))))} />
      </svg>
      <div className="muted small">Shaded = above threshold; filled points mark years above it; ▲ in the hover = above threshold. Hover a legend chip to isolate a state.</div>
    </div>
  )
}

function PrevDots({ rows, show, hide, tip, selected, onPick, pooled }: {
  rows: Row[]; show: Show; hide: () => void; tip: (a: string) => TipContent; selected: string[]; onPick: Pick; pooled: boolean
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const top = rows.slice(0, 25)
  const extra = rows.filter((r, i) => i >= 25 && selected.includes(r.state))
  const list = [...top, ...extra]
  const rh = 17
  const m = { l: 34, r: 16, t: 18 }
  const yOf = (i: number) => m.t + i * rh + (i >= top.length ? 10 : 0)
  const ci = list.map((r) => wilson(r.n_gene, r.n))
  // Dot plot with intervals: points, not bars, so the axis may start above zero.
  // It is tightened to the span of the plotted intervals to make the differences
  // between states visible, and falls back to zero when the data runs close to it.
  const hiX = Math.max(d3.max(list, (r) => r.prevalence ?? 0) ?? 0, pooled ? d3.max(ci, (c) => c[1]) ?? 0 : 0) || 1
  const loX = Math.min(d3.min(list, (r) => r.prevalence ?? Infinity) ?? 0, pooled ? d3.min(ci, (c) => c[0]) ?? 0 : Infinity)
  const x = d3.scaleLinear()
    .domain([loX <= hiX * 0.15 ? 0 : Math.max(0, loX - (hiX - loX) * 0.08), hiX])
    .nice().range([m.l, w - m.r])
  return (
    <div ref={ref}>
      <div className="field-label" style={{ marginBottom: 4 }}>Top 25 states{extra.length ? ' + selected' : ''} · prevalence{pooled ? ' with 95% CI' : ''}</div>
      <svg width={w} height={yOf(list.length) + 4}>
        {x.ticks(5).map((t) => (
          <g key={t} className="grid"><line x1={x(t)} x2={x(t)} y1={m.t - 4} y2={yOf(list.length)} />
            <text x={x(t)} y={10} textAnchor="middle">{d3.format('.0%')(t)}</text></g>
        ))}
        {list.map((r, i) => {
          const sel = selected.includes(r.state)
          return (
            <g key={r.state} className="bar-row" transform={`translate(0,${yOf(i)})`} onMouseMove={(e) => show(e, tip(r.state))} onMouseLeave={hide}
              onClick={(e) => onPick(r.state, e)}>
              <rect className={'row-hl' + (sel ? ' sel' : '')} width={w} height={rh} rx={3} />
              <text x={m.l - 6} y={rh / 2 + 4} textAnchor="end" style={{ fontWeight: sel ? 700 : 400, fill: sel ? 'var(--text-primary)' : undefined }}>{r.state}</text>
              {pooled && <line x1={x(ci[i][0])} x2={x(ci[i][1])} y1={rh / 2} y2={rh / 2} stroke="var(--text-muted)" strokeWidth={1.5} />}
              <circle cx={x(r.prevalence ?? 0)} cy={rh / 2} r={4.5} fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={2} />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function Trend({ trend, rows, states, gene, dark, show, hide }: {
  trend: Resp['trend']; rows: PrevRow[]; states: string[]; gene: string; dark: boolean; show: Show; hide: () => void
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hoverYear, setHoverYear] = useState<number | null>(null)
  const h = 300
  const m = { l: 44, r: 40, t: 16, b: 22 }
  const nat = trend.filter((t) => t.n > 0).map((t) => ({ year: t.year, n: t.n, n_gene: t.n_gene, p: t.n_gene / t.n }))
  const colors = magmaSeries(states.length, dark)
  const series = [
    { key: 'US', label: 'National', color: 'var(--text-muted)', pts: nat, dash: '5 3' as string | undefined },
    ...states.map((s, i) => ({
      key: s, label: STATE_NAMES[s], color: colors[i], dash: undefined as string | undefined,
      pts: rows.filter((r) => r.state === s && r.n >= 5).sort((a, b) => a.year - b.year).map((r) => ({ year: r.year, n: r.n, n_gene: r.n_gene, p: r.n_gene / r.n })),
    })),
  ]
  if (nat.length < 2) return <div ref={ref} className="muted small">Too few years with data for a trend.</div>
  const years = [...new Set(series.flatMap((s) => s.pts.map((p) => p.year)))].sort((a, b) => a - b)
  const x = d3.scaleLinear().domain(d3.extent(years) as [number, number]).range([m.l, w - m.r])
  // Trend lines: track the plotted range rather than always anchoring at zero, so a
  // single tall spike cannot flatten every other series against the baseline.
  const ps = series.flatMap((s) => s.pts).map((d) => d.p)
  const pHi = d3.max(ps) || 0.01
  const pLo = d3.min(ps) ?? 0
  const y = d3.scaleLinear()
    .domain([pLo <= pHi * 0.15 ? 0 : Math.max(0, pLo - (pHi - pLo) * 0.1), pHi])
    .nice().range([h - m.b, m.t])
  const ends = series.filter((s) => s.key !== 'US' && s.pts.length)
  const endY = ends.map((s) => y(s.pts[s.pts.length - 1].p))
  const labelY = dodgeLabels(endY, 13, m.t + 4, h - m.b)
  return (
    <div ref={ref}>
      <div className="field-label">Share of isolates with {gene} by year · {states.length ? 'selected states vs national' : 'national (select states to compare)'}</div>
      <div className="legend" style={{ margin: '6px 0' }}>
        {series.map((s) => (
          <span key={s.key} className="key">
            <svg width={18} height={6}><line x1={0} x2={18} y1={3} y2={3} stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dash} /></svg>{s.label}
          </span>
        ))}
        <span className="muted small">State points need ≥ 5 isolates that year.</span>
      </div>
      <svg width={w} height={h} onMouseLeave={() => { setHoverYear(null); hide() }}>
        {y.ticks(4).map((t) => (<g key={t} className="grid"><line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} />
          <text x={m.l - 6} y={y(t) + 4} textAnchor="end">{d3.format('.0%')(t)}</text></g>))}
        {years.map((yr) => <text key={yr} x={x(yr)} y={h - 6} textAnchor="middle">{years.length > 14 && yr % 2 ? '' : yr}</text>)}
        {series.map((s) => (
          <g key={s.key}>
            <path d={d3.line<{ year: number; p: number }>().x((d) => x(d.year)).y((d) => y(d.p))(s.pts) ?? ''}
              fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} />
            {s.key !== 'US' && s.pts.map((p) => <circle key={p.year} cx={x(p.year)} cy={y(p.p)} r={hoverYear === p.year ? 4.5 : 3} fill={s.color} />)}
          </g>
        ))}
        {ends.map((s, i) => {
          const lx = x(s.pts[s.pts.length - 1].year)
          return (
            <g key={s.key}>
              {Math.abs(labelY[i] - endY[i]) > 2 && <polyline points={`${lx + 4},${endY[i]} ${w - m.r + 2},${labelY[i]}`} fill="none" stroke={s.color} strokeWidth={1} />}
              <text x={w - m.r + 5} y={labelY[i] + 4} style={{ fontWeight: 600, fill: s.color }}>{s.key}</text>
            </g>
          )
        })}
        <YearOverlay years={years} x={x} top={m.t} bottom={h - m.b} hover={hoverYear}
          onHover={(yr, e) => {
            setHoverYear(yr)
            show(e, {
              title: String(yr),
              rows: series.map((s) => {
                const p = s.pts.find((q) => q.year === yr)
                return { label: s.key === 'US' ? 'National' : s.key, value: p ? `${fmtPct(p.p)} (${fmtInt(p.n_gene)} / ${fmtInt(p.n)})` : '—' }
              }),
            })
          }} />
      </svg>
    </div>
  )
}

function Scatter({ rows, dThr, show, hide, tip, selected, onPick, gene, xLabel }: {
  rows: Row[]; dThr: number; show: Show; hide: () => void
  tip: (a: string) => TipContent; selected: string[]; onPick: Pick; gene: string; xLabel: string
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const h = 380
  const m = { l: 48, r: 20, t: 16, b: 40 }
  if (rows.length < 3) return <div ref={ref} className="muted">Not enough states with data.</div>
  // Fit both axes to the plotted values (with a little padding) so the dots spread across the plot
  // instead of pooling in a corner of a domain rounded out to whole decades / starting at 0.
  const [rLo, rHi] = d3.extent(rows.filter((r) => r.rate! > 0), (r) => r.rate!) as [number, number]
  const lr = rHi > rLo ? Math.log10(rHi / rLo) * 0.06 : 0.15 // pad in log space
  const x = d3.scaleLog().domain([rLo / 10 ** lr, rHi * 10 ** lr]).range([m.l, w - m.r])
  const [pLo, pHi] = d3.extent(rows, (r) => r.prevalence!) as [number, number]
  const pp = pHi > pLo ? (pHi - pLo) * 0.08 : 0.02
  const y = d3.scaleLinear().domain([Math.max(0, pLo - pp), Math.min(1, pHi + pp)]).range([h - m.b, m.t])
  // log ticks: prefer 1-2-5 mantissas; fall back to every tick if the range is too narrow for those
  const allX = x.ticks(8)
  const niceX = allX.filter((t) => /^[125]$/.test(t.toExponential().charAt(0)))
  const xTicks = (niceX.length >= 3 ? niceX : allX).filter((_, i, a) => a.length <= 7 || i % Math.ceil(a.length / 6) === 0)
  const pctFmt = d3.format(pHi - pLo < 0.05 ? '.1%' : '.0%')
  const sorted = [...rows].sort((a, b) => Number(selected.includes(a.state)) - Number(selected.includes(b.state)) || Math.abs(a.d!) - Math.abs(b.d!))
  return (
    <div ref={ref}>
      <svg width={w} height={h}>
        {y.ticks(5).map((t) => (<g key={t} className="grid"><line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} />
          <text x={m.l - 6} y={y(t) + 4} textAnchor="end">{pctFmt(t)}</text></g>))}
        {xTicks.map((t) => (<g key={t} className="grid"><line x1={x(t)} x2={x(t)} y1={m.t} y2={h - m.b} />
          <text x={x(t)} y={h - m.b + 14} textAnchor="middle">{fmtRate(t)}</text></g>))}
        <text x={(m.l + w - m.r) / 2} y={h - 4} textAnchor="middle">{xLabel}</text>
        <text transform={`translate(12,${(m.t + h - m.b) / 2}) rotate(-90)`} textAnchor="middle">Share with {gene} →</text>
        {sorted.map((r) => {
          const flag = Math.abs(r.d!) >= dThr
          const sel = selected.includes(r.state)
          return (
            <g key={r.state} transform={`translate(${x(r.rate!)},${y(r.prevalence!)})`} style={{ cursor: 'pointer' }}
              onMouseMove={(e) => show(e, tip(r.state))} onMouseLeave={hide} onClick={(e) => onPick(r.state, e)}>
              <circle r={12} fill="transparent" />
              {sel && <circle r={10} fill="none" stroke="var(--text-primary)" strokeWidth={1.5} />}
              <circle r={flag ? 6.5 : 4.5} fill={discColor(r.d, dThr)} stroke="var(--surface-1)" strokeWidth={2} />
              {(flag || sel) && <text x={12} y={4} style={{ fontWeight: sel ? 700 : 600, fill: 'var(--text-primary)' }}>{r.state}</text>}
            </g>
          )
        })}
      </svg>
      <div className="legend">
        <DiscLegend thr={dThr} />
        <span className="key"><svg width={12} height={12}><circle cx={6} cy={6} r={5} fill="none" stroke="var(--text-primary)" strokeWidth={1.5} /></svg>selected</span>
      </div>
    </div>
  )
}
