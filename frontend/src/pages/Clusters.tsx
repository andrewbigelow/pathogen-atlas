import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import { useApi, useDark, useWidth, divInterpolator, aggWord, pickWith, fmtInt, fmtRate, SOURCE_VAR } from '../lib'
import type { AggHow, ModKeys } from '../lib'
import type { ClusterRow, ApiParams } from '../lib'
import { useSection, useStore, MAX_CLUSTERS } from '../store'
import type { Pick } from '../store'
import { useTooltip } from '../components/Tooltip'
import type { TipContent } from '../components/Tooltip'
import { DragThreshold, HoverRule, tidy } from '../components/Chart'
import {
  Seg, Slider, Stepper, FilterPanel, FilterGroup, PathogenField, HostField, ProductField, SourcesField, GeneField, StateMultiSelect,
  YearRange, geneText, MinCountField,
} from '../components/Controls'

type Show = (e: { clientX: number; clientY: number }, c: TipContent) => void
type Net = { nodes: ClusterRow[]; edges: { source: string; target: string; corr: number }[] }
const SEGS: { key: keyof ClusterRow | 'other'; src: string }[] = [
  { key: 'n_clinical', src: 'Human clinical' }, { key: 'n_food', src: 'Food' },
  { key: 'n_animal', src: 'Animal' }, { key: 'n_env', src: 'Environment' }, { key: 'other', src: 'Unknown' },
]
const segVal = (c: ClusterRow, k: string) =>
  k === 'other' ? c.n - c.n_clinical - c.n_food - c.n_animal - c.n_env : (c[k as keyof ClusterRow] as number)
const dominant = (c: ClusterRow) => SEGS.reduce((best, s) => (segVal(c, s.key) > segVal(c, best.key) ? s : best)).src
// Full accession, unabbreviated: the bar chart reserves enough left margin for it.
const label = (c: ClusterRow) => `${c.serovar ?? c.organism} · ${c.cluster.split('.')[0]}`

function rateLabel(agg: AggHow) {
  return agg === 'sum' ? 'Isolates in window' : `${aggWord(agg)} isolates / yr`
}

function clusterRows(c: ClusterRow, years: number, agg: AggHow) {
  return [
    { label: 'Organism / serovar', value: `${c.organism}${c.serovar ? ' · ' + c.serovar : ''}` },
    { label: `Isolates (${years} yr window)`, value: fmtInt(c.n) },
    { label: rateLabel(agg), value: fmtRate(c.rate) },
    { label: 'Years seen', value: `${c.first_year}–${c.last_year}` },
    { label: 'States', value: String(c.n_states) },
    { label: 'Clinical / food / animal / env', value: `${c.n_clinical} / ${c.n_food} / ${c.n_animal} / ${c.n_env}` },
    { label: 'Median SNPs to nearest', value: c.med_minsame == null ? '—' : String(c.med_minsame) },
  ]
}

export default function Clusters() {
  const { f, selectedStates } = useSection()
  const { selectedClusters, pickCluster, setSelectedClusters } = useStore()
  const { show, hide, node } = useTooltip()
  const [minN, setMinN] = useState(10)
  const [k, setK] = useState(20)
  const [rateThr, setRateThr] = useState<number | null>(null)
  const [netK, setNetK] = useState(80)
  const [minCorr, setMinCorr] = useState(0.7)
  const [gran, setGran] = useState<'year' | 'month'>('month')
  // clusters whose details are shown under the network (last clicked first)
  const [focus, setFocus] = useState<string[]>([])
  const base = {
    organism: f.organism, y0: f.y0, y1: f.y1, sources: f.sources.join(','),
    host: f.host, product: f.product, gene: f.gene, states: selectedStates.join(','),
  }
  const top = useApi<ClusterRow[]>('clusters/top', { ...base, k, agg: f.agg, min_n: minN })
  const net = useApi<Net>('clusters/network', { ...base, k: netK, min_corr: minCorr, granularity: gran, agg: f.agg, min_n: minN })
  const years = f.y1 - f.y0 + 1
  useEffect(() => setRateThr(null), [f.agg])

  const rows = top.data ?? []
  const thr = rateThr ?? tidy(d3.quantile(rows.map((r) => r.rate).sort(d3.ascending), 0.5) ?? 0)
  const above = rows.filter((r) => r.rate >= thr)
  const scopeTxt = selectedStates.length ? ` from ${selectedStates.join(', ')}` : ''
  const known = useMemo(() => new Map([...(net.data?.nodes ?? []), ...(top.data ?? [])].map((c) => [c.cluster, c])), [net.data, top.data])
  /** clicking a cluster anywhere: selects it for comparison and shows its details */
  const pick: Pick = (c, e) => {
    pickCluster(c, e)
    setFocus((old) => pickWith(old, c, e, MAX_CLUSTERS))
  }

  return (
    <div className="grid">
      <FilterPanel>
        <FilterGroup label="Isolates"><PathogenField /><SourcesField /><HostField /><ProductField /><StateMultiSelect /></FilterGroup>
        <FilterGroup label="AMR"><GeneField /></FilterGroup>
        <FilterGroup label="Time"><YearRange /></FilterGroup>
        <FilterGroup label="Ranking">
          <MinCountField value={minN} onChange={setMinN} label="Min. isolates per cluster" options={[1, 5, 10, 25, 50, 100, 250, 500, 1000]} />
        </FilterGroup>
      </FilterPanel>

      <div className="card" style={{ opacity: top.loading ? 0.6 : 1 }}>
        <div className="section-head">
          <h2>Top {k} SNP clusters by discovery rate, {f.y0}–{f.y1}{scopeTxt}</h2></div>
        <div className="controls" style={{ justifyContent: 'space-between' }}>
          <p className="sub" style={{ margin: 0, maxWidth: 760 }}>
            Ranked by {rateLabel(f.agg).toLowerCase()} {f.agg !== 'sum' && '(counted per year across the window, then combined) '}
            {f.gene.length > 0 && <>among isolates carrying {geneText(f.gene)} </>}· bars are split by isolation source.
            {' '}<b>{above.length}</b> of {rows.length} clusters are at or above {fmtRate(thr)} — drag the threshold line or its handle.
            Click a bar to compare it below · Ctrl/⌘-click to add.
          </p>
          <div className="controls" style={{ marginBottom: 0 }}>
            <Stepper label="Top-k clusters" value={k} min={1} max={100} onChange={setK} />
            {selectedClusters.length > 0 && <button className="btn" onClick={() => { setSelectedClusters([]); setFocus([]) }}>Clear {selectedClusters.length} selected</button>}
          </div>
        </div>
        <SourceLegend />
        {top.data ? <ClusterBars rows={rows} thr={thr} setThr={setRateThr} years={years} agg={f.agg} show={show} hide={hide}
          selected={selectedClusters} onPick={pick} /> : <div className="loading">Ranking clusters…</div>}
      </div>

      <div className="grid g-2e">
        <div className="card" style={{ opacity: net.loading ? 0.6 : 1 }}>
          <div className="section-head"><h2>Clusters with similar discovery curves</h2></div>
          <p className="sub">
            Nodes are the top {netK} clusters (size = isolates, colour = main source). Lines join clusters whose {gran}ly
            discovery counts correlate ≥ {minCorr.toFixed(2)}. Hover to see neighbours; click to select (Ctrl/⌘-click to add) and see
            details below. Drag to pan, Ctrl/⌘ + scroll to zoom.
          </p>
          <div className="controls">
            <Stepper label="Network size" value={netK} min={10} max={200} step={10} onChange={setNetK} />
            <Slider label="Min. correlation" value={minCorr} min={0.3} max={0.95} step={0.05} onChange={setMinCorr} format={(v) => v.toFixed(2)} />
            <Seg value={gran} onChange={setGran} label="Time step" options={[{ v: 'month', label: 'Month' }, { v: 'year', label: 'Year' }]} />
          </div>
          {net.data ? <Network data={net.data} selected={selectedClusters} focus={focus} onPick={pick} />
            : <div className="loading">Building network…</div>}
          <Details ids={focus} known={known} net={net.data} years={years} agg={f.agg} selected={selectedClusters} onPick={pick}
            onClose={(c) => setFocus((old) => old.filter((x) => x !== c))} />
        </div>
        <div className="card">
          <h2>Compare selected clusters</h2>
          <p className="sub">
            Each panel has its own y-axis so curve shape can be compared; the dot and dotted line mark each cluster's peak.
            Click a cluster name to show its details (Ctrl/⌘-click for several). The matrix shows pairwise Pearson correlation.
          </p>
          <Compare ids={selectedClusters} gran={gran} base={base} show={show} hide={hide} focus={focus}
            onFocus={(c, e) => setFocus((old) => pickWith(old, c, e, MAX_CLUSTERS))}
            onRemove={(c) => { pickCluster(c, { ctrlKey: true, metaKey: false, shiftKey: false }); setFocus((old) => old.filter((x) => x !== c)) }} />
        </div>
      </div>
      {node}
    </div>
  )
}

function SourceLegend({ vertical = false }: { vertical?: boolean }) {
  return (
    <div className={'legend' + (vertical ? ' vertical' : '')} style={{ marginBottom: 8 }}>
      {vertical && <span className="field-label">Main source</span>}
      {SEGS.map((s) => <span className="key" key={s.src}><span className="sw" style={{ background: SOURCE_VAR[s.src] }} />{s.src === 'Unknown' ? 'Unknown / other' : s.src}</span>)}
    </div>
  )
}

function ClusterBars({ rows, thr, setThr, years, agg, show, hide, selected, onPick }: {
  rows: ClusterRow[]; thr: number; setThr: (v: number) => void; years: number; agg: AggHow; show: Show; hide: () => void
  selected: string[]; onPick: Pick
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const rh = 20
  const sorted = [...rows].sort((a, b) => b.rate - a.rate)
  // Left margin sized to the longest label actually on screen (~6.4px per character
  // at 13px Inter) so full serovar + PDS accession fits without clipping.
  const longest = sorted.reduce((n, c) => Math.max(n, label(c).length), 0)
  const m = { l: Math.max(140, Math.min(Math.ceil(longest * 6.4) + 16, w * 0.42)), r: 60, t: 22 }
  const x = d3.scaleLinear().domain([0, d3.max(sorted, (r) => r.rate) || 1]).nice().range([m.l, w - m.r])
  const bottom = m.t + sorted.length * rh
  return (
    <div ref={ref}>
      <svg width={w} height={bottom + 4}>
        {x.ticks(6).map((t) => (<g key={t} className="grid"><line x1={x(t)} x2={x(t)} y1={m.t - 4} y2={bottom} />
          <text x={x(t)} y={10} textAnchor="middle">{fmtRate(t)}</text></g>))}
        {sorted.map((c, i) => {
          const a = c.rate >= thr
          const sel = selected.includes(c.cluster)
          let x0 = m.l
          return (
            <g key={c.cluster} className="bar-row" transform={`translate(0,${m.t + i * rh})`}
              onMouseMove={(e) => show(e, { title: c.cluster, rows: clusterRows(c, years, agg) })} onMouseLeave={hide} onClick={(e) => onPick(c.cluster, e)}>
              <rect className={'row-hl' + (sel ? ' sel' : '')} width={w} height={rh} rx={3} />
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
        <DragThreshold orient="v" at={x(Math.min(thr, x.domain()[1]))} from={m.t - 6} to={bottom} label={fmtRate(thr)}
          onChange={(px) => setThr(tidy(Math.max(0, Math.min(x.domain()[1], x.invert(px)))))} />
      </svg>
    </div>
  )
}

interface SimNode extends d3.SimulationNodeDatum { id: string; c: ClusterRow; r: number }
interface SimLink extends d3.SimulationLinkDatum<SimNode> { corr: number }

function Network({ data, selected, focus, onPick }: { data: Net; selected: string[]; focus: string[]; onPick: Pick }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const svgRef = useRef<SVGSVGElement>(null)
  const h = 440
  const pick = useRef(onPick); pick.current = onPick

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
    const baseOpacity = (d: SimLink) => 0.15 + 0.6 * (d.corr - 0.3)

    const link = g.append('g').selectAll('line').data(links).join('line')
      .attr('stroke', 'var(--text-muted)').attr('stroke-opacity', baseOpacity).attr('stroke-width', 1)
    const ring = g.append('g').attr('class', 'rings').style('pointer-events', 'none')
    const node = g.append('g').selectAll<SVGCircleElement, SimNode>('circle').data(nodes).join('circle')
      .attr('class', 'nd')
      .attr('r', (d) => d.r).attr('fill', (d) => SOURCE_VAR[dominant(d.c)])
      .attr('stroke', 'var(--surface-1)').attr('stroke-width', 2).style('cursor', 'pointer')
      .on('mouseenter', (_, d) => {
        const s = nbr.get(d.id)!
        node.attr('opacity', (n) => (s.has(n.id) ? 1 : 0.15))
        link.attr('stroke-opacity', (l) => ((l.source as SimNode).id === d.id || (l.target as SimNode).id === d.id ? 0.9 : 0.04))
      })
      .on('mouseleave', () => {
        node.attr('opacity', 1)
        link.attr('stroke-opacity', baseOpacity)
      })
      .on('click', (e: MouseEvent, d) => pick.current(d.id, e as ModKeys))
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
        ring.selectAll<SVGCircleElement, SimNode>('circle').attr('cx', (d) => d.x!).attr('cy', (d) => d.y!)
      })
    return () => { sim.stop() }
  }, [data, w])

  // selection = solid ring, details shown = dashed accent halo
  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    svg.selectAll<SVGCircleElement, SimNode>('circle.nd')
      .attr('stroke', (d) => (selected.includes(d.id) ? 'var(--focus)' : 'var(--surface-1)'))
      .attr('stroke-width', (d) => (selected.includes(d.id) ? 3 : 2))
    const focused = svg.selectAll<SVGCircleElement, SimNode>('circle.nd').data().filter((d) => focus.includes(d.id))
    svg.select('g.rings').selectAll<SVGCircleElement, SimNode>('circle').data(focused, (d) => d.id).join('circle')
      .attr('r', (d) => d.r + 6).attr('fill', 'none').attr('stroke', 'var(--accent)').attr('stroke-width', 2).attr('stroke-dasharray', '3 2')
      .attr('cx', (d) => d.x ?? 0).attr('cy', (d) => d.y ?? 0)
  }, [selected, focus, data, w])

  const isolated = data.nodes.length - new Set(data.edges.flatMap((e) => [e.source, e.target])).size
  return (
    <div className="net-wrap">
      <div ref={ref} style={{ minWidth: 0 }}>
        <svg ref={svgRef} width={w} height={h} style={{ background: 'var(--surface-2)', borderRadius: 8, display: 'block' }} />
        <div className="muted small" style={{ marginTop: 6 }}>{data.edges.length} links · {isolated} clusters with no similar partner</div>
      </div>
      <div>
        <SourceLegend vertical />
        <div className="legend vertical" style={{ marginTop: 12 }}>
          <span className="field-label">Marks</span>
          <span className="key"><svg width={14} height={14}><circle cx={7} cy={7} r={5} fill="var(--src-unknown)" stroke="var(--focus)" strokeWidth={2.5} /></svg>selected</span>
          <span className="key"><svg width={14} height={14}><circle cx={7} cy={7} r={5.5} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="3 2" /></svg>details shown</span>
        </div>
      </div>
    </div>
  )
}

function Details({ ids, known, net, years, agg, selected, onPick, onClose }: {
  ids: string[]; known: Map<string, ClusterRow>; net: Net | null; years: number; agg: AggHow
  selected: string[]; onPick: Pick; onClose: (c: string) => void
}) {
  if (!ids.length) return <div className="callout muted">Click a cluster in the network or bar chart to see its details here.</div>
  return (
    <div className="details">
      {[...ids].reverse().map((id) => {
        const c = known.get(id)
        const nbrs = (net?.edges ?? []).filter((e) => e.source === id || e.target === id)
          .map((e) => ({ id: e.source === id ? e.target : e.source, corr: e.corr })).sort((a, b) => b.corr - a.corr)
        return (
          <div key={id} className="detail-card">
            <div className="detail-head">
              <b>{id}</b>
              {c && <span className="sw" style={{ background: SOURCE_VAR[dominant(c)] }} />}
              <span style={{ flex: 1 }} />
              <button className="icon-btn" aria-label={`Hide details for ${id}`} onClick={() => onClose(id)}>✕</button>
            </div>
            {c ? (
              <div className="kv">{clusterRows(c, years, agg).map((r) => <div key={r.label}><span>{r.label}</span><span>{r.value}</span></div>)}</div>
            ) : <div className="muted small">Not in the current ranking.</div>}
            {nbrs.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <span className="field-label">Similar curves ({nbrs.length})</span>
                <div className="chips" style={{ marginTop: 4 }}>
                  {nbrs.slice(0, 12).map((n) => (
                    <button key={n.id} className="chip" aria-pressed={selected.includes(n.id)} title="Ctrl/⌘-click adds it to the comparison"
                      onClick={(e) => onPick(n.id, e)}>{n.id.split('.')[0].replace('PDS0000', 'PDS…')} <span className="muted tnum">r={n.corr.toFixed(2)}</span></button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Compare({ ids, gran, base, show, hide, focus, onFocus, onRemove }: {
  ids: string[]; gran: 'year' | 'month'; base: ApiParams
  show: Show; hide: () => void; focus: string[]; onFocus: Pick; onRemove: (c: string) => void
}) {
  const dark = useDark()
  const [ref, w0] = useWidth<HTMLDivElement>()
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const { data } = useApi<{ periods: (string | number)[]; series: { cluster: string; values: number[] }[]; corr: (number | null)[][] }>(
    ids.length ? 'clusters/series' : null, { ...base, ids: ids.join(','), granularity: gran })
  const c = useMemo(() => d3.scaleDiverging(divInterpolator(dark)).domain([-1, 0, 1]), [dark])
  if (!ids.length) return <div ref={ref} className="muted" style={{ padding: 24 }}>Select clusters from the bar chart or the network to compare their discovery curves.</div>
  if (!data) return <div ref={ref} className="loading">Loading…</div>
  const series = data.series.filter((s) => ids.includes(s.cluster))
  const gutter = 40
  const w = w0 - gutter
  const ph = 62
  const m = { l: 36, r: 8, t: 18, b: 6 }
  const parse = (p: string | number) => (typeof p === 'number' ? new Date(p, 6, 1) : new Date(p))
  const x = d3.scaleTime().domain(d3.extent(data.periods.map(parse)) as [Date, Date]).range([m.l, w - m.r])
  const cell = Math.min(34, (w0 - 120) / Math.max(1, series.length))
  const periodLabel = (i: number) => (gran === 'year' ? String(data.periods[i]) : d3.timeFormat('%b %Y')(parse(data.periods[i])))
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const t = x.invert(e.clientX - r.left)
    const i = d3.minIndex(data.periods, (p) => Math.abs(+parse(p) - +t))
    setHoverIdx(i)
    show(e, { title: periodLabel(i), rows: series.map((s) => ({ label: s.cluster, value: `${s.values[i]} isolates` })) })
  }
  return (
    <div ref={ref} onMouseLeave={() => { setHoverIdx(null); hide() }}>
      {series.map((s) => {
        const max = d3.max(s.values) || 1
        const y = d3.scaleLinear().domain([0, max]).range([ph - m.b, m.t])
        const area = d3.area<number>().x((_, i) => x(parse(data.periods[i]))).y0(ph - m.b).y1((v) => y(v)).curve(d3.curveMonotoneX)
        const line = d3.line<number>().x((_, i) => x(parse(data.periods[i]))).y((v) => y(v)).curve(d3.curveMonotoneX)
        const peak = d3.maxIndex(s.values)
        const px = x(parse(data.periods[peak]))
        const isFocus = focus.includes(s.cluster)
        return (
          <div key={s.cluster} className="cmp-row">
            <svg width={w} height={ph} onMouseMove={onMove}>
              <text x={m.l} y={12} className={'cmp-title' + (isFocus ? ' on' : '')} onClick={(e) => onFocus(s.cluster, e)}>{s.cluster}</text>
              <text x={m.l - 4} y={y(max) + 4} textAnchor="end">{max}</text>
              <line x1={m.l} x2={w - m.r} y1={ph - m.b} y2={ph - m.b} stroke="var(--grid)" />
              <path d={area(s.values) ?? ''} fill="var(--accent)" opacity={0.15} />
              <path d={line(s.values) ?? ''} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
              <line x1={px} x2={px} y1={y(s.values[peak])} y2={ph - m.b} stroke="var(--text-secondary)" strokeWidth={1} strokeDasharray="2 2" />
              <circle cx={px} cy={y(s.values[peak])} r={3.5} fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={1.5}>
                <title>Peak: {s.values[peak]} isolates, {periodLabel(peak)}</title>
              </circle>
              {hoverIdx != null && (
                <>
                  <HoverRule x={x(parse(data.periods[hoverIdx]))} top={m.t} bottom={ph - m.b} />
                  <circle cx={x(parse(data.periods[hoverIdx]))} cy={y(s.values[hoverIdx])} r={3} fill="var(--text-primary)" />
                </>
              )}
            </svg>
            <button className="remove-btn" aria-label={`Remove ${s.cluster} from comparison`} title="Remove from comparison" onClick={() => onRemove(s.cluster)}>✕</button>
          </div>
        )
      })}
      <svg width={w} height={18}>
        {x.ticks(6).map((t) => <text key={+t} x={x(t)} y={12} textAnchor="middle">{d3.timeFormat('%Y')(t)}</text>)}
      </svg>
      {series.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <div className="field-label">Correlation of discovery curves</div>
          <svg width={w0} height={30 + series.length * cell}>
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
