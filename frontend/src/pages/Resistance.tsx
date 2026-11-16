import { useMemo, useState } from 'react'
import * as d3 from 'd3'
import {
  useApi, useDark, useWidth, seqInterpolator, divInterpolator, magmaSeries, aggregate, aggRate, aggWord,
  fmtInt, fmtPct, fmtRate, wilson, STATE_NAMES,
} from '../lib'
import type { PrevRow, PrevState } from '../lib'
import { useStore } from '../store'
import type { Pick } from '../store'
import { USMap, ColorLegend } from '../components/USMap'
import { useTooltip } from '../components/Tooltip'
import type { TipContent } from '../components/Tooltip'
import {
  Slider, FilterCard, GeneField, NormFields, PathogenField, HostField, ProductField, SourcesField, MinCountField, normUnit,
  geneText,
} from '../components/Controls'

interface Resp { gene: string; rows: PrevRow[]; trend: { year: number; n: number; n_gene: number }[] }
type Show = (e: React.MouseEvent, c: TipContent) => void
type Row = PrevState & { ok: boolean; years: number }

export default function Resistance() {
  const { params, gene, setGene, f, meta, selectedStates, pickState } = useStore()
  const [minN, setMinN] = useState(25)
  const { data, loading } = useApi<Resp>('gene_prevalence', { ...params, gene, norm: f.norm, commodity: f.commodity })
  const dark = useDark()
  const { show, hide, node } = useTooltip()
  const [dThr, setDThr] = useState(0.4)
  const unitShort = normUnit(f, meta, true)
  const pooled = f.agg === 'sum'

  const states = useMemo<Row[]>(() => {
    if (!data) return []
    return d3.groups(data.rows, (r) => r.state).map(([state, v]) => {
      const n = d3.sum(v, (r) => r.n), n_gene = d3.sum(v, (r) => r.n_gene)
      const yearly = v.filter((r) => r.n > 0)
      return {
        state, n, n_gene, years: yearly.length, ok: n >= Math.max(1, minN),
        prevalence: aggregate(yearly.map((r) => r.n_gene / r.n), f.agg, n ? n_gene / n : null),
        receipts_k: d3.sum(v, (r) => r.receipts_k ?? 0),
        rate: aggRate(v, f.agg, f.norm),
      }
    })
  }, [data, minN, f.agg, f.norm])
  const valid = states.filter((s) => s.ok && s.prevalence != null)
  const byState = new Map(states.map((s) => [s.state, s]))
  const maxPrev = d3.max(valid, (s) => s.prevalence ?? 0) || 0.01
  const color = useMemo(() => d3.scaleSequential(seqInterpolator(dark)).domain([0, maxPrev]), [dark, maxPrev])

  // discrepancy = percentile rank of prevalence − percentile rank of normalised detection rate
  const disc = useMemo(() => {
    const v = valid.filter((s) => s.rate != null && s.rate > 0)
    const pr = (arr: number[], x: number) => (arr.filter((a) => a < x).length + 0.5 * (arr.filter((a) => a === x).length - 1)) / Math.max(1, arr.length - 1)
    const prevs = v.map((s) => s.prevalence!)
    const rates = v.map((s) => s.rate!)
    return v.map((s) => ({ ...s, d: pr(prevs, s.prevalence!) - pr(rates, s.rate!) }))
  }, [valid])
  const discBy = new Map(disc.map((d) => [d.state, d.d]))

  const filters = (
    <FilterCard>
      <GeneField value={gene} onChange={setGene} />
      <PathogenField /><HostField /><ProductField /><NormFields /><SourcesField />
      <MinCountField value={minN} onChange={setMinN} label="Min. isolates per state" options={[1, 5, 10, 25, 50, 100, 250, 500]} />
    </FilterCard>
  )
  if (!data) return <div className="grid">{filters}<div className="loading">Loading prevalence…</div></div>
  const ranked = [...valid].sort((a, b) => (b.prevalence ?? 0) - (a.prevalence ?? 0))
  const prevLabel = `${aggWord(f.agg)} share with ${geneText(gene)}`
  const tipFor = (a: string): TipContent => {
    const s = byState.get(a)
    if (!s || s.n === 0) return { title: STATE_NAMES[a], note: 'No isolates with state + year' }
    const [lo, hi] = wilson(s.n_gene, s.n)
    return {
      title: STATE_NAMES[a],
      rows: [
        { label: `Isolates with ${geneText(gene)}`, value: `${fmtInt(s.n_gene)} / ${fmtInt(s.n)}` },
        { label: prevLabel, value: fmtPct(s.prevalence) },
        { label: 'Pooled 95% CI', value: `${fmtPct(lo)} – ${fmtPct(hi)}` },
        { label: `${aggWord(f.agg)} ${unitShort}`, value: fmtRate(s.rate) },
        ...(discBy.has(a) ? [{ label: 'Discrepancy', value: discBy.get(a)!.toFixed(2) }] : []),
      ],
      note: s.ok ? (selectedStates.includes(a) ? 'Selected' : 'Click to select · Ctrl/⌘-click to add') : `Fewer than ${minN} isolates — not ranked`,
    }
  }
  const sel = selectedStates.map((s) => byState.get(s)).filter((s): s is Row => !!s)

  return (
    <div className="grid" style={{ opacity: loading ? 0.6 : 1 }}>
      {filters}
      <div className="card">
        <h2>Which states have the highest share of isolates carrying <i>{geneText(gene)}</i>?</h2>
        <p className="sub">
          {aggWord(f.agg)} share of {f.sources.join(' + ').toLowerCase()} isolates with {geneText(gene)}, {f.y0}–{f.y1}
          {pooled ? ' (all years pooled)' : ' (share computed per year, then combined)'}. Hatched states have fewer than {minN} isolates.
        </p>
        <div className="grid g-2">
          <div>
            <USMap value={(a) => (byState.get(a)?.ok ? byState.get(a)?.prevalence : null)} color={(v) => color(v)}
              insufficient={(a) => { const s = byState.get(a); return !!s && s.n > 0 && !s.ok }}
              selected={selectedStates} onClick={(a, e) => pickState(a, e)} tip={tipFor} showTip={show} hideTip={hide} />
            <div className="legend">
              <ColorLegend scale={color} label={prevLabel} format={d3.format('.0%')} />
              <span className="key"><svg width={12} height={12}><rect width={12} height={12} fill="url(#hatch)" /></svg>too few isolates</span>
            </div>
          </div>
          <PrevDots rows={ranked} show={show} hide={hide} tipFor={tipFor} selected={selectedStates} onPick={pickState} pooled={pooled} />
        </div>
        <SelectedTable rows={sel} gene={geneText(gene)} unit={unitShort} disc={discBy} onPick={pickState} minN={minN} />
        <Trend trend={data.trend} rows={data.rows} states={selectedStates} gene={geneText(gene)} dark={dark} show={show} hide={hide} />
      </div>

      <div className="card">
        <div className="controls" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2>Where does resistance prevalence diverge from sampling intensity?</h2>
            <p className="sub">
              Each dot is a state. x = {aggWord(f.agg).toLowerCase()} {unitShort} (log), y = {prevLabel.toLowerCase()}.
              Discrepancy = percentile rank of prevalence − percentile rank of detection rate. States beyond ±{dThr.toFixed(2)} and
              selected states are labelled.
            </p>
          </div>
          <Slider label="Discrepancy threshold" value={dThr} min={0} max={1} step={0.05} onChange={setDThr} format={(v) => '±' + v.toFixed(2)} />
        </div>
        <div className="grid g-2">
          <Scatter rows={disc} dThr={dThr} dark={dark} show={show} hide={hide} tipFor={tipFor} selected={selectedStates} onPick={pickState}
            gene={geneText(gene)} xLabel={`${aggWord(f.agg)} ${unitShort} (log scale) →`} />
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>Flagged states ({disc.filter((d) => Math.abs(d.d) >= dThr).length})</div>
            <table className="data">
              <thead><tr><th>State</th><th>Prevalence</th><th>Rate</th><th>Discrepancy</th></tr></thead>
              <tbody>
                {[...disc].filter((d) => Math.abs(d.d) >= dThr).sort((a, b) => b.d - a.d).map((d) => (
                  <tr key={d.state} className={selectedStates.includes(d.state) ? 'sel' : ''} onClick={(e) => pickState(d.state, e)}>
                    <td>{STATE_NAMES[d.state]}</td><td>{fmtPct(d.prevalence)}</td><td>{fmtRate(d.rate)}</td>
                    <td style={{ color: d.d > 0 ? 'var(--div-pos)' : 'var(--div-neg)', fontWeight: 600 }}>
                      {d.d > 0 ? '▲ ' : '▼ '}{d.d.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">▲ resistance more common than the state's sampling intensity would rank it. ▼ heavily sampled but low prevalence.</p>
          </div>
        </div>
      </div>
      {node}
    </div>
  )
}

function SelectedTable({ rows, gene, unit, disc, onPick, minN }: {
  rows: Row[]; gene: string; unit: string; disc: Map<string, number>; onPick: Pick; minN: number
}) {
  if (!rows.length) return <div className="callout muted">Select states on the map or list to compare them here and in the trend chart.</div>
  return (
    <div style={{ marginTop: 12 }}>
      <div className="field-label" style={{ marginBottom: 4 }}>Selected states</div>
      <table className="data">
        <thead><tr><th>State</th><th>Isolates</th><th>With {gene}</th><th>Prevalence</th><th>Pooled 95% CI</th><th>{unit}</th><th>Discrepancy</th></tr></thead>
        <tbody>
          {rows.map((s) => {
            const [lo, hi] = wilson(s.n_gene, s.n)
            const d = disc.get(s.state)
            return (
              <tr key={s.state} onClick={(e) => onPick(s.state, e)}>
                <td><b>{STATE_NAMES[s.state]}</b></td><td>{fmtInt(s.n)}</td><td>{fmtInt(s.n_gene)}</td>
                <td>{s.ok ? fmtPct(s.prevalence) : <span className="muted">&lt; {minN} isolates</span>}</td>
                <td>{s.n ? `${fmtPct(lo)} – ${fmtPct(hi)}` : '—'}</td><td>{fmtRate(s.rate)}</td>
                <td>{d == null ? '—' : <span style={{ color: d > 0 ? 'var(--div-pos)' : 'var(--div-neg)', fontWeight: 600 }}>{d > 0 ? '▲ ' : '▼ '}{d.toFixed(2)}</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PrevDots({ rows, show, hide, tipFor, selected, onPick, pooled }: {
  rows: Row[]; show: Show; hide: () => void; tipFor: (a: string) => TipContent; selected: string[]; onPick: Pick; pooled: boolean
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const top = rows.slice(0, 25)
  const extra = rows.filter((r, i) => i >= 25 && selected.includes(r.state))
  const list = [...top, ...extra]
  const rh = 17
  const m = { l: 34, r: 16, t: 18 }
  const yOf = (i: number) => m.t + i * rh + (i >= top.length ? 10 : 0)
  const ci = list.map((r) => wilson(r.n_gene, r.n))
  const x = d3.scaleLinear().domain([0, Math.max(d3.max(list, (r) => r.prevalence ?? 0) ?? 0, pooled ? d3.max(ci, (c) => c[1]) ?? 0 : 0) || 1]).nice().range([m.l, w - m.r])
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
            <g key={r.state} transform={`translate(0,${yOf(i)})`} onMouseMove={(e) => show(e, tipFor(r.state))} onMouseLeave={hide}
              onClick={(e) => onPick(r.state, e)} style={{ cursor: 'pointer' }}>
              <rect width={w} height={rh} rx={3} fill={sel ? 'var(--accent-soft)' : 'transparent'} />
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
  const h = 220
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
  if (nat.length < 2) return null
  const years = [...new Set(series.flatMap((s) => s.pts.map((p) => p.year)))].sort((a, b) => a - b)
  const x = d3.scaleLinear().domain(d3.extent(years) as [number, number]).range([m.l, w - m.r])
  const y = d3.scaleLinear().domain([0, d3.max(series.flatMap((s) => s.pts), (d) => d.p) || 0.01]).nice().range([h - m.b, m.t])
  const step = years.length > 1 ? x(years[1]) - x(years[0]) : w
  return (
    <div ref={ref} style={{ marginTop: 16 }}>
      <div className="field-label">Share of isolates with {gene} by year · selected states vs national</div>
      <div className="legend" style={{ margin: '6px 0' }}>
        {series.map((s) => (
          <span key={s.key} className="key">
            <svg width={18} height={6}><line x1={0} x2={18} y1={3} y2={3} stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dash} /></svg>{s.label}
          </span>
        ))}
        <span className="muted small">State points need ≥ 5 isolates that year.</span>
      </div>
      <svg width={w} height={h} onMouseLeave={hide}>
        {y.ticks(4).map((t) => (<g key={t} className="grid"><line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} />
          <text x={m.l - 6} y={y(t) + 4} textAnchor="end">{d3.format('.0%')(t)}</text></g>))}
        {years.map((yr) => <text key={yr} x={x(yr)} y={h - 6} textAnchor="middle">{years.length > 14 && yr % 2 ? '' : yr}</text>)}
        {series.map((s) => (
          <g key={s.key}>
            <path d={d3.line<{ year: number; p: number }>().x((d) => x(d.year)).y((d) => y(d.p))(s.pts) ?? ''}
              fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} />
            {s.key !== 'US' && s.pts.map((p) => <circle key={p.year} cx={x(p.year)} cy={y(p.p)} r={3} fill={s.color} />)}
            {s.key !== 'US' && s.pts.length > 0 && (
              <text x={x(s.pts[s.pts.length - 1].year) + 6} y={y(s.pts[s.pts.length - 1].p) + 4} style={{ fontWeight: 600, fill: 'var(--text-primary)' }}>{s.key}</text>
            )}
          </g>
        ))}
        {years.map((yr) => (
          <rect key={yr} x={x(yr) - step / 2} y={m.t} width={step} height={h - m.t - m.b} fill="transparent"
            onMouseMove={(e) => show(e, {
              title: String(yr),
              rows: series.map((s) => {
                const p = s.pts.find((q) => q.year === yr)
                return { label: s.key === 'US' ? 'National' : s.key, value: p ? `${fmtPct(p.p)} (${fmtInt(p.n_gene)} / ${fmtInt(p.n)})` : '—' }
              }),
            })} />
        ))}
      </svg>
    </div>
  )
}

function Scatter({ rows, dThr, dark, show, hide, tipFor, selected, onPick, gene, xLabel }: {
  rows: (Row & { d: number })[]; dThr: number; dark: boolean; show: Show; hide: () => void
  tipFor: (a: string) => TipContent; selected: string[]; onPick: Pick; gene: string; xLabel: string
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const h = 380
  const m = { l: 48, r: 20, t: 16, b: 40 }
  if (rows.length < 3) return <div ref={ref} className="muted">Not enough states with data.</div>
  const x = d3.scaleLog().domain(d3.extent(rows, (r) => r.rate!) as [number, number]).nice().range([m.l, w - m.r])
  const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.prevalence!) ?? 1]).nice().range([h - m.b, m.t])
  const c = d3.scaleDiverging(divInterpolator(dark)).domain([-1, 0, 1])
  const sorted = [...rows].sort((a, b) => Number(selected.includes(a.state)) - Number(selected.includes(b.state)) || Math.abs(a.d) - Math.abs(b.d))
  return (
    <div ref={ref}>
      <svg width={w} height={h}>
        {y.ticks(5).map((t) => (<g key={t} className="grid"><line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} />
          <text x={m.l - 6} y={y(t) + 4} textAnchor="end">{d3.format('.0%')(t)}</text></g>))}
        {x.ticks(5).filter((t) => /^[13]/.test(String(t))).map((t) => (<g key={t} className="grid"><line x1={x(t)} x2={x(t)} y1={m.t} y2={h - m.b} />
          <text x={x(t)} y={h - m.b + 14} textAnchor="middle">{fmtRate(t)}</text></g>))}
        <text x={(m.l + w - m.r) / 2} y={h - 4} textAnchor="middle">{xLabel}</text>
        <text transform={`translate(12,${(m.t + h - m.b) / 2}) rotate(-90)`} textAnchor="middle">Share with {gene} →</text>
        {sorted.map((r) => {
          const flag = Math.abs(r.d) >= dThr
          const sel = selected.includes(r.state)
          return (
            <g key={r.state} transform={`translate(${x(r.rate!)},${y(r.prevalence!)})`} style={{ cursor: 'pointer' }}
              onMouseMove={(e) => show(e, tipFor(r.state))} onMouseLeave={hide} onClick={(e) => onPick(r.state, e)}>
              <circle r={12} fill="transparent" />
              {sel && <circle r={10} fill="none" stroke="var(--text-primary)" strokeWidth={1.5} />}
              <circle r={flag ? 6.5 : 4.5} fill={flag ? c(r.d) : 'var(--src-unknown)'} stroke="var(--surface-1)" strokeWidth={2} />
              {(flag || sel) && <text x={12} y={4} style={{ fontWeight: sel ? 700 : 600, fill: 'var(--text-primary)' }}>{r.state}</text>}
            </g>
          )
        })}
      </svg>
      <div className="legend">
        <span className="key"><span className="sw" style={{ background: c(0.8), borderRadius: 6 }} />prevalence ranks higher than detection</span>
        <span className="key"><span className="sw" style={{ background: c(-0.8), borderRadius: 6 }} />detection ranks higher than prevalence</span>
        <span className="key"><span className="sw" style={{ background: 'var(--src-unknown)', borderRadius: 6 }} />within threshold</span>
        <span className="key"><svg width={12} height={12}><circle cx={6} cy={6} r={5} fill="none" stroke="var(--text-primary)" strokeWidth={1.5} /></svg>selected</span>
      </div>
    </div>
  )
}
