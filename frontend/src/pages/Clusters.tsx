import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import { useApi, useDark, useWidth, divInterpolator, aggWord, fmtInt, fmtRate, SOURCE_VAR } from '../lib'
import type { AggHow } from '../lib'
import type { ClusterRow, ApiParams } from '../lib'
import { useStore } from '../store'
import { useTooltip } from '../components/Tooltip'
import type { TipContent } from '../components/Tooltip'
import { Seg, Slider, FilterCard, PathogenField, HostField, ProductField, GeneField, geneText, MinCountField } from '../components/Controls'

type Show = (e: { clientX: number; clientY: number }, c: TipContent) => void
const SEGS: { key: keyof ClusterRow | 'other'; src: string }[] = [
  { key: 'n_clinical', src: 'Human clinical' }, { key: 'n_food', src: 'Food' },
  { key: 'n_animal', src: 'Animal' }, { key: 'n_env', src: 'Environment' }, { key: 'other', src: 'Unknown' },
]
const segVal = (c: ClusterRow, k: string) =>
  k === 'other' ? c.n - c.n_clinical - c.n_food - c.n_animal - c.n_env : (c[k as keyof ClusterRow] as number)
const dominant = (c: ClusterRow) => SEGS.reduce((best, s) => (segVal(c, s.key) > segVal(c, best.key) ? s : best)).src
const label = (c: ClusterRow) => `${c.serovar ?? c.organism} · ${c.cluster.split('.')[0].replace('PDS0000', 'PDS…')}`

function rateLabel(agg: AggHow) {
  return agg === 'sum' ? 'Isolates in window' : `${aggWord(agg)} isolates / yr`
}

function clusterTip(c: ClusterRow, years: number, agg: AggHow = 'mean'): TipContent {
  return {
    title: `${c.cluster}`,
    rows: [
      { label: 'Organism / serovar', value: `${c.organism}${c.serovar ? ' · ' + c.serovar : ''}` },
      { label: `Isolates (${years} yr window)`, value: fmtInt(c.n) },
      { label: rateLabel(agg), value: fmtRate(c.rate) },
      { label: 'Years seen', value: `${c.first_year}–${c.last_year}` },
      { label: 'States', value: String(c.n_states) },
      { label: 'Clinical / food / animal / env', value: `${c.n_clinical} / ${c.n_food} / ${c.n_animal} / ${c.n_env}` },
      { label: 'Median SNPs to nearest', value: c.med_minsame == null ? '—' : String(c.med_minsame) },
    ],
  }
}

export default function Clusters() {
  const { f, selectedClusters, toggleCluster, setSelectedClusters, selectedStates } = useStore()
  const { show, hide, node } = useTooltip()
  const [allSources, setAllSources] = useState(true)
  const [scope, setScope] = useState<'all' | 'selected'>('all')
  const [cGene, setCGene] = useState<string[]>([])
  const [minN, setMinN] = useState(10)
  const [k, setK] = useState(20)
  const [rateThr, setRateThr] = useState<number | null>(null)
  const [netK, setNetK] = useState(80)
  const [minCorr, setMinCorr] = useState(0.7)
  const [gran, setGran] = useState<'year' | 'month'>('month')
  const base = {
    organism: f.organism, y0: f.y0, y1: f.y1, sources: allSources ? undefined : f.sources.join(','),
    host: f.host, product: f.product, gene: cGene, states: scope === 'selected' ? selectedStates.join(',') : '',
  }
  const top = useApi<ClusterRow[]>('clusters/top', { ...base, k, agg: f.agg, min_n: minN })
  const net = useApi<{ nodes: ClusterRow[]; edges: { source: string; target: string; corr: number }[] }>(
    'clusters/network', { ...base, k: netK, min_corr: minCorr, granularity: gran, agg: f.agg, min_n: minN })
  const years = f.y1 - f.y0 + 1
  useEffect(() => setRateThr(null), [f.agg])

  const rows = top.data ?? []
  const maxRate = d3.max(rows, (r) => r.rate) ?? 1
  const thr = rateThr ?? +(d3.quantile(rows.map((r) => r.rate).sort(d3.ascending), 0.5) ?? 0).toFixed(1)
  const above = rows.filter((r) => r.rate >= thr)
  const scopeTxt = scope === 'selected' && selectedStates.length ? ` from ${selectedStates.join(', ')}` : ''

  return (
    <div className="grid">
      <FilterCard>
        <PathogenField /><HostField /><ProductField />
        <GeneField value={cGene} onChange={setCGene} allowAny />
        <MinCountField value={minN} onChange={setMinN} label="Min. isolates per cluster" options={[1, 5, 10, 25, 50, 100, 250, 500, 1000]} />
        <Seg label="States" value={scope} onChange={setScope}
          options={[{ v: 'all', label: 'All states' }, { v: 'selected', label: `Selected (${selectedStates.length})` }]} />
        <Seg label="Isolates counted" value={allSources ? 'all' : 'filtered'} onChange={(v) => setAllSources(v === 'all')}
          options={[{ v: 'all', label: 'All sources incl. clinical' }, { v: 'filtered', label: `Source filter (${f.sources.length})` }]} />
      </FilterCard>
      <div className="card">
        <div className="controls" style={{ marginBottom: 0 }}>
          <Slider label="Top-k clusters" value={k} min={5} max={60} step={1} onChange={setK} />
          <Slider label={`Threshold (${rateLabel(f.agg).toLowerCase()})`} value={thr} min={0} max={Math.ceil(maxRate)} step={maxRate > 50 ? 1 : 0.1}
            onChange={setRateThr} format={fmtRate} />
          {selectedClusters.length > 0 && <button className="btn" onClick={() => setSelectedClusters([])}>Clear {selectedClusters.length} selected</button>}
        </div>
        {scope === 'selected' && !selectedStates.length && <div className="callout">No states selected — select states on any map to limit clusters to them.</div>}
      </div>

      <div className="card" style={{ opacity: top.loading ? 0.6 : 1 }}>
        <h2>Top {k} SNP clusters by discovery rate, {f.y0}–{f.y1}{scopeTxt}</h2>
        <p className="sub">
          Ranked by {rateLabel(f.agg).toLowerCase()} {f.agg !== 'sum' && '(counted per year across the window, then combined) '}
          {cGene.length > 0 && <>among isolates carrying {geneText(cGene)} </>}· bars are split by isolation source.
          {' '}{above.length} of {rows.length} clusters are at or above {fmtRate(thr)}. Click bars to compare clusters below (up to 8).
        </p>
        <SourceLegend />
        {top.data ? <ClusterBars rows={rows} thr={thr} years={years} agg={f.agg} show={show} hide={hide}
          selected={selectedClusters} onPick={toggleCluster} /> : <div className="loading">Ranking clusters…</div>}
      </div>

      <div className="grid g-2e">
        <div className="card" style={{ opacity: net.loading ? 0.6 : 1 }}>
          <h2>Clusters with similar discovery curves</h2>
          <p className="sub">
            Nodes are the top {netK} clusters (size = isolates, color = main source). Lines join clusters whose {gran}ly
            discovery counts correlate ≥ {minCorr.toFixed(2)}. Hover to see neighbors, click to select, drag to pan, Ctrl/⌘ + scroll to zoom.
          </p>
          <div className="controls">
            <Slider label="Network size" value={netK} min={20} max={200} step={10} onChange={setNetK} />
            <Slider label="Min. correlation" value={minCorr} min={0.3} max={0.95} step={0.05} onChange={setMinCorr} format={(v) => v.toFixed(2)} />
            <Seg value={gran} onChange={setGran} label="Time step" options={[{ v: 'month', label: 'Month' }, { v: 'year', label: 'Year' }]} />
          </div>
          {net.data ? <Network data={net.data} selected={selectedClusters} onPick={toggleCluster} show={show} hide={hide} years={years} agg={f.agg} />
            : <div className="loading">Building network…</div>}
        </div>
        <div className="card">
          <h2>Compare selected clusters</h2>
          <p className="sub">Each panel has its own y-axis so curve shape can be compared. The matrix shows pairwise Pearson correlation.</p>
          <Compare ids={selectedClusters} gran={gran} base={base} show={show} hide={hide} onRemove={toggleCluster} />
        </div>
      </div>
      {node}
    </div>
  )
}

function SourceLegend() {
  return (
    <div className="legend" style={{ marginBottom: 8 }}>
      {SEGS.map((s) => <span className="key" key={s.src}><span className="sw" style={{ background: SOURCE_VAR[s.src] }} />{s.src === 'Unknown' ? 'Unknown / other' : s.src}</span>)}
    </div>
  )
}

function ClusterBars({ rows, thr, years, agg, show, hide, selected, onPick }: {
  rows: ClusterRow[]; thr: number; years: number; agg: AggHow; show: Show; hide: () => void; selected: string[]; onPick: (c: string) => void
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const rh = 20
  const m = { l: Math.min(260, w * 0.35), r: 60, t: 18 }
  const sorted = [...rows].sort((a, b) => b.rate - a.rate)
  const x = d3.scaleLinear().domain([0, d3.max(sorted, (r) => r.rate) ?? 1]).nice().range([m.l, w - m.r])
  return (
    <div ref={ref}>
      <svg width={w} height={m.t + sorted.length * rh + 4}>
        {x.ticks(6).map((t) => (<g key={t} className="grid"><line x1={x(t)} x2={x(t)} y1={m.t - 4} y2={m.t + sorted.length * rh} />
          <text x={x(t)} y={10} textAnchor="middle">{fmtRate(t)}</text></g>))}
        {sorted.map((c, i) => {
          const a = c.rate >= thr
          const sel = selected.includes(c.cluster)
          let x0 = m.l
          return (
            <g key={c.cluster} transform={`translate(0,${m.t + i * rh})`} style={{ cursor: 'pointer' }}
              onMouseMove={(e) => show(e, clusterTip(c, years, agg))} onMouseLeave={hide} onClick={() => onPick(c.cluster)}>
              <rect width={w} height={rh} fill={sel ? 'var(--accent-soft)' : 'transparent'} rx={3} />
              <text x={m.l - 8} y={rh / 2 + 4} textAnchor="end" style={{ fontWeight: sel ? 700 : 400, fill: sel ? 'var(--text-primary)' : undefined }}>{label(c)}</text>
              <g opacity={a ? 1 : 0.35}>
                {SEGS.map((s) => {
                  const v = segVal(c, s.key as string)
                  const wd = (x(c.rate) - m.l) * (v / c.n)
                  const r = <rect key={s.src} x={x0} y={4} width={Math.max(0, wd - 2)} height={rh - 8} fill={SOURCE_VAR[s.src]} rx={1.5} />
                  x0 += wd
                  return v > 0 ? r : null
                })}
              </g>
              <text x={x(c.rate) + 4} y={rh / 2 + 4} className="tnum">{fmtRate(c.rate)}</text>
            </g>
          )
        })}
        <line x1={x(thr)} x2={x(thr)} y1={m.t - 4} y2={m.t + sorted.length * rh} stroke="var(--flag)" strokeWidth={1.5} />
      </svg>
    </div>
  )
}

interface SimNode extends d3.SimulationNodeDatum { id: string; c: ClusterRow; r: number }
interface SimLink extends d3.SimulationLinkDatum<SimNode> { corr: number }

function Network({ data, selected, onPick, show, hide, years, agg }: {
  data: { nodes: ClusterRow[]; edges: { source: string; target: string; corr: number }[] }
  selected: string[]; onPick: (c: string) => void; show: Show; hide: () => void; years: number; agg: AggHow
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const svgRef = useRef<SVGSVGElement>(null)
  const h = 460
  const pick = useRef(onPick); pick.current = onPick
  const tip = useRef({ show, hide }); tip.current = { show, hide }

  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    svg.selectAll('*').remove()
    const g = svg.append('g')
    // wheel-zoom only with Ctrl/Cmd held so normal page scrolling never gets trapped
    svg.call(d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 6])
      .filter((e) => (e.type === 'wheel' ? e.ctrlKey || e.metaKey : !e.button))
      .on('zoom', (e) => g.attr('transform', e.transform)))
    const rs = d3.scaleSqrt().domain([0, d3.max(data.nodes, (n) => n.n) ?? 1]).range([3, 22])
    const nodes: SimNode[] = data.nodes.map((c) => ({ id: c.cluster, c, r: rs(c.n) }))
    const links: SimLink[] = data.edges.map((e) => ({ source: e.source, target: e.target, corr: e.corr }))
    const nbr = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set([n.id])]))
    data.edges.forEach((e) => { nbr.get(e.source)!.add(e.target); nbr.get(e.target)!.add(e.source) })

    const link = g.append('g').selectAll('line').data(links).join('line')
      .attr('stroke', 'var(--text-muted)').attr('stroke-opacity', (d) => 0.15 + 0.6 * (d.corr - 0.3)).attr('stroke-width', 1)
    const node = g.append('g').selectAll<SVGCircleElement, SimNode>('circle').data(nodes).join('circle')
      .attr('class', 'nd')
      .attr('r', (d) => d.r).attr('fill', (d) => SOURCE_VAR[dominant(d.c)])
      .attr('stroke', 'var(--surface-1)').attr('stroke-width', 2).style('cursor', 'pointer')
      .on('mousemove', (e, d) => {
        tip.current.show(e, { ...clusterTip(d.c, years, agg), note: `${nbr.get(d.id)!.size - 1} correlated clusters` })
        const s = nbr.get(d.id)!
        node.attr('opacity', (n) => (s.has(n.id) ? 1 : 0.15))
        link.attr('stroke-opacity', (l) => ((l.source as SimNode).id === d.id || (l.target as SimNode).id === d.id ? 0.9 : 0.04))
      })
      .on('mouseleave', () => {
        tip.current.hide()
        node.attr('opacity', 1)
        link.attr('stroke-opacity', (d) => 0.15 + 0.6 * (d.corr - 0.3))
      })
      .on('click', (_, d) => pick.current(d.id))
      .call(d3.drag<SVGCircleElement, SimNode>()
        .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y })
        .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null }))

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(40).strength((l) => (l.corr - 0.2) * 0.6))
      .force('charge', d3.forceManyBody().strength(-40))
      .force('collide', d3.forceCollide<SimNode>((d) => d.r + 2))
      .force('x', d3.forceX(w / 2).strength(0.06))
      .force('y', d3.forceY(h / 2).strength(0.08))
      .on('tick', () => {
        link.attr('x1', (d) => (d.source as SimNode).x!).attr('y1', (d) => (d.source as SimNode).y!)
          .attr('x2', (d) => (d.target as SimNode).x!).attr('y2', (d) => (d.target as SimNode).y!)
        node.attr('cx', (d) => d.x!).attr('cy', (d) => d.y!)
      })
    return () => { sim.stop() }
  }, [data, w, years, agg])

  useEffect(() => {
    d3.select(svgRef.current!).selectAll<SVGCircleElement, SimNode>('circle.nd')
      .attr('stroke', (d) => (selected.includes(d.id) ? 'var(--focus)' : 'var(--surface-1)'))
      .attr('stroke-width', (d) => (selected.includes(d.id) ? 3 : 2))
  }, [selected, data, w])

  const isolated = data.nodes.length - new Set(data.edges.flatMap((e) => [e.source, e.target])).size
  return (
    <div ref={ref}>
      <svg ref={svgRef} width={w} height={h} style={{ background: 'var(--surface-2)', borderRadius: 8 }} />
      <div className="legend" style={{ marginTop: 6 }}>
        <SourceLegend />
        <span className="muted">{data.edges.length} links · {isolated} clusters with no similar partner</span>
      </div>
    </div>
  )
}

function Compare({ ids, gran, base, show, hide, onRemove }: {
  ids: string[]; gran: 'year' | 'month'; base: ApiParams
  show: Show; hide: () => void; onRemove: (c: string) => void
}) {
  const dark = useDark()
  const [ref, w] = useWidth<HTMLDivElement>()
  const { data } = useApi<{ periods: (string | number)[]; series: { cluster: string; values: number[] }[]; corr: (number | null)[][] }>(
    ids.length ? 'clusters/series' : null, { ...base, ids: ids.join(','), granularity: gran })
  const c = useMemo(() => d3.scaleDiverging(divInterpolator(dark)).domain([-1, 0, 1]), [dark])
  if (!ids.length) return <div className="muted" style={{ padding: 24 }}>Select clusters from the bar chart or the network to compare their discovery curves.</div>
  if (!data) return <div className="loading">Loading…</div>
  const series = data.series.filter((s) => ids.includes(s.cluster))
  const ph = 58
  const m = { l: 36, r: 8 }
  const parse = (p: string | number) => (typeof p === 'number' ? new Date(p, 6, 1) : new Date(p))
  const x = d3.scaleTime().domain(d3.extent(data.periods.map(parse)) as [Date, Date]).range([m.l, w - m.r])
  const cell = Math.min(34, (w - 120) / Math.max(1, series.length))
  return (
    <div ref={ref}>
      {series.map((s) => {
        const y = d3.scaleLinear().domain([0, d3.max(s.values) || 1]).range([ph - 6, 16])
        const area = d3.area<number>().x((_, i) => x(parse(data.periods[i]))).y0(ph - 6).y1((v) => y(v)).curve(d3.curveMonotoneX)
        const line = d3.line<number>().x((_, i) => x(parse(data.periods[i]))).y((v) => y(v)).curve(d3.curveMonotoneX)
        const peak = d3.maxIndex(s.values)
        return (
          <div key={s.cluster} style={{ borderBottom: '1px solid var(--grid)' }}>
            <svg width={w} height={ph}
              onMouseMove={(e) => {
                const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
                const t = x.invert(e.clientX - r.left)
                const i = d3.minIndex(data.periods, (p) => Math.abs(+parse(p) - +t))
                show(e, { title: s.cluster, rows: [{ label: String(data.periods[i]).slice(0, 7), value: `${s.values[i]} isolates` }] })
              }} onMouseLeave={hide}>
              <text x={m.l} y={11} style={{ fontWeight: 600, fill: 'var(--text-primary)' }}>{s.cluster}</text>
              <text x={w - m.r} y={11} textAnchor="end" style={{ cursor: 'pointer' }} onClick={() => onRemove(s.cluster)}>remove ✕</text>
              <text x={m.l - 4} y={y(d3.max(s.values) || 1) + 4} textAnchor="end">{d3.max(s.values)}</text>
              <path d={area(s.values) ?? ''} fill="var(--accent)" opacity={0.15} />
              <path d={line(s.values) ?? ''} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
              <text x={x(parse(data.periods[peak]))} y={y(s.values[peak]) - 3} textAnchor="middle" className="small">peak</text>
            </svg>
          </div>
        )
      })}
      <svg width={w} height={18}>
        {x.ticks(6).map((t) => <text key={+t} x={x(t)} y={12} textAnchor="middle">{d3.timeFormat('%Y')(t)}</text>)}
      </svg>
      {series.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <div className="field-label">Correlation of discovery curves</div>
          <svg width={w} height={30 + series.length * cell}>
            {series.map((a, i) => (
              <g key={a.cluster}>
                <text x={110} y={24 + i * cell + cell / 2 + 4} textAnchor="end">{a.cluster.split('.')[0].slice(-6)}</text>
                <text x={114 + i * cell + cell / 2} y={16} textAnchor="middle">{a.cluster.split('.')[0].slice(-4)}</text>
                {series.map((b, j) => {
                  const v = data.corr[data.series.indexOf(a)]?.[data.series.indexOf(b)]
                  return (
                    <g key={b.cluster} onMouseMove={(e) => show(e, { title: 'Correlation', rows: [{ label: `${a.cluster} × ${b.cluster}`, value: v == null ? '—' : v.toFixed(2) }] })} onMouseLeave={hide}>
                      <rect x={114 + j * cell + 1} y={22 + i * cell + 1} width={cell - 2} height={cell - 2} rx={2} fill={v == null ? 'var(--nodata)' : c(v)} />
                      {cell > 26 && v != null && <text x={114 + j * cell + cell / 2} y={22 + i * cell + cell / 2 + 4} textAnchor="middle"
                        style={{ fill: Math.abs(v) > 0.6 ? '#fff' : 'var(--text-primary)', fontSize: 10 }}>{v.toFixed(1)}</text>}
                    </g>
                  )
                })}
              </g>
            ))}
          </svg>
        </div>
      )}
    </div>
  )
}
