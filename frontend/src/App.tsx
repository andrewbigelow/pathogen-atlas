import { useEffect, useState } from 'react'
import * as d3 from 'd3'
import { useApi, useWidth, fmtInt, fmtPct, SOURCES, SOURCE_VAR } from './lib'
import { YearRange, SelectionBar, FilterCard, PathogenField, SourcesField } from './components/Controls'
import type { Meta, Completeness } from './lib'
import { StoreProvider, useStore } from './store'
import { useTooltip } from './components/Tooltip'
import Geography from './pages/Geography'
import Resistance from './pages/Resistance'
import Clusters from './pages/Clusters'
import Sources from './pages/Sources'

const TABS = [
  { id: 'geo', label: 'Geography' },
  { id: 'amr', label: 'Resistance' },
  { id: 'clusters', label: 'SNP clusters' },
  { id: 'sources', label: 'Sources' },
  { id: 'coverage', label: 'Data coverage' },
  { id: 'about', label: 'About' },
] as const
type TabId = (typeof TABS)[number]['id']

export default function App() {
  const { data: meta, error } = useApi<Meta>('meta')
  if (error) return <div className="loading">Could not reach the API ({error}). Is the backend running on port 8000?</div>
  if (!meta) return <div className="loading">Loading Pathogen Atlas…</div>
  return (
    <StoreProvider meta={meta}>
      <Shell />
    </StoreProvider>
  )
}

function Shell() {
  const [tab, setTab] = useState<TabId>(() => (location.hash.slice(1) as TabId) || 'geo')
  const go = (t: TabId) => { setTab(t); history.replaceState(null, '', '#' + t); window.scrollTo(0, 0) }
  useEffect(() => {
    const f = () => { const h = location.hash.slice(1) as TabId; if (TABS.some((t) => t.id === h)) setTab(h) }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return (
    <>
      <header className="app-header">
        <div className="header-row">
          <div className="brand">
            <h1>Pathogen Atlas</h1>
            <span>NCBI Pathogen Detection × USDA farm cash receipts</span>
          </div>
          <YearRange />
          <div style={{ flex: 1 }} />
          <CoverageWidget onOpen={() => go('coverage')} />
        </div>
        {tab !== 'coverage' && tab !== 'about' && <SelectionBar />}
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'geo' && <Geography />}
        {tab === 'amr' && <Resistance />}
        {tab === 'clusters' && <Clusters />}
        {tab === 'sources' && <Sources />}
        {tab === 'coverage' && <Coverage />}
        {tab === 'about' && <About />}
      </main>
    </>
  )
}

const COV_PARTS = [
  { key: 'both', label: 'Year + state', color: 'var(--accent)' },
  { key: 'date_only', label: 'Year only', color: 'var(--src-env)' },
  { key: 'state_only', label: 'State only', color: 'var(--src-animal)' },
  { key: 'neither', label: 'Neither', color: 'var(--src-unknown)' },
] as const

/** Always visible; linked to the pathogen + source filters. */
function CoverageWidget({ onOpen }: { onOpen: () => void }) {
  const { f } = useStore()
  const { data } = useApi<Completeness>('completeness', { organism: f.organism, sources: f.sources.join(','), host: f.host, product: f.product })
  const { show, hide, node } = useTooltip()
  if (!data) return <div className="coverage" />
  return (
    <div className="coverage" style={{ cursor: 'pointer' }} onClick={onOpen}
      onMouseMove={(e) => show(e, {
        title: 'Metadata usable for these views',
        rows: COV_PARTS.map((p) => ({ label: p.label, value: `${fmtInt(data[p.key])} (${fmtPct(data[p.key] / data.total)})` })),
        note: 'Click for the full coverage breakdown',
      })} onMouseLeave={hide}>
      <span className="field-label">Usable metadata</span>
      <div className="bar">
        {COV_PARTS.map((p) => data[p.key] > 0 && <div key={p.key} style={{ width: `${(data[p.key] / data.total) * 100}%`, background: p.color }} />)}
      </div>
      <div className="txt"><b>{fmtPct(data.both / data.total)}</b> of {fmtInt(data.total)} isolates have both a collection year and a US state</div>
      {node}
    </div>
  )
}

function Coverage() {
  const { f } = useStore()
  const { show, hide, node } = useTooltip()
  const per = SOURCES.map((s) => ({ s, q: useApi<Completeness>('completeness', { organism: f.organism, sources: s }) })) // eslint-disable-line react-hooks/rules-of-hooks
  const all = useApi<Completeness>('completeness', { organism: f.organism, sources: f.sources.join(',') })
  const [ref, w] = useWidth<HTMLDivElement>()
  const d = all.data
  return (
    <div className="grid">
      <FilterCard><PathogenField /><SourcesField /></FilterCard>
      <div className="card">
        <h2>How much of the data can be placed on the map and timeline?</h2>
        <p className="sub">Share of US isolates ({f.organism.length ? f.organism.join(', ') : 'all pathogens'}) with a usable collection year and a US state, by isolation source. Every view above only uses isolates with both.</p>
        <div className="legend" style={{ marginBottom: 10 }}>
          {COV_PARTS.map((p) => <span key={p.key} className="key"><span className="sw" style={{ background: p.color }} />{p.label}</span>)}
        </div>
        {per.map(({ s, q }) => q.data && (
          <div key={s} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 150px', gap: 12, alignItems: 'center', marginBottom: 8 }}>
            <span><span className="sw" style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: SOURCE_VAR[s], marginRight: 6 }} />{s}</span>
            <div style={{ display: 'flex', gap: 2, height: 18 }}>
              {COV_PARTS.map((p) => q.data![p.key] > 0 && (
                <div key={p.key} style={{ width: `${(q.data![p.key] / q.data!.total) * 100}%`, background: p.color, borderRadius: 2 }}
                  onMouseMove={(e) => show(e, { title: `${s} · ${p.label}`, rows: [{ label: 'Isolates', value: fmtInt(q.data![p.key]) }, { label: 'Share', value: fmtPct(q.data![p.key] / q.data!.total) }] })}
                  onMouseLeave={hide} />
              ))}
            </div>
            <span className="tnum small"><b>{fmtPct(q.data.both / q.data.total)}</b> usable of {fmtInt(q.data.total)}</span>
          </div>
        ))}
        <div className="callout">
          Clinical isolates usually report only “USA” for privacy, so they rarely have a state and are excluded from the
          state-level views by default. State comes from <b>food_origin</b> where present
          {d && <> ({fmtPct(d.from_food_origin / Math.max(1, d.from_food_origin + d.from_geo))} of located isolates in the current filter)</>},
          otherwise from <b>geo_loc_name</b>.
        </div>
      </div>
      <div className="card">
        <h2>Isolates with a state, by collection year</h2>
        <p className="sub">Sources counted: {f.sources.join(', ')}. Dark = has state; light = year only.</p>
        <div ref={ref}>
          {d && (() => {
            const h = 220, m = { l: 48, r: 10, t: 10, b: 22 }
            const x = d3.scaleBand<number>().domain(d.by_year.map((r) => r.year)).range([m.l, w - m.r]).padding(0.15)
            const y = d3.scaleLinear().domain([0, d3.max(d.by_year, (r) => r.n) ?? 1]).nice().range([h - m.b, m.t])
            return (
              <svg width={w} height={h}>
                {y.ticks(4).map((t) => <g key={t} className="grid"><line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} /><text x={m.l - 6} y={y(t) + 4} textAnchor="end">{d3.format('~s')(t)}</text></g>)}
                {d.by_year.map((r) => (
                  <g key={r.year} onMouseMove={(e) => show(e, { title: String(r.year), rows: [
                    { label: 'Isolates', value: fmtInt(r.n) }, { label: 'With state', value: `${fmtInt(r.with_state)} (${fmtPct(r.with_state / r.n)})` }] })} onMouseLeave={hide}>
                    <rect x={x(r.year)} width={x.bandwidth()} y={y(r.n)} height={y(r.with_state) - y(r.n)} fill="var(--accent)" opacity={0.3} rx={2} />
                    <rect x={x(r.year)} width={x.bandwidth()} y={y(r.with_state)} height={h - m.b - y(r.with_state)} fill="var(--accent)" rx={2} />
                    {(r.year % 5 === 0) && <text x={(x(r.year) ?? 0) + x.bandwidth() / 2} y={h - 6} textAnchor="middle">{r.year}</text>}
                  </g>
                ))}
              </svg>
            )
          })()}
        </div>
      </div>
      {node}
    </div>
  )
}

function About() {
  const { meta } = useStore()
  return (
    <div className="card" style={{ maxWidth: 860 }}>
      <h2>About this tool</h2>
      <p>
        Pathogen Atlas links US isolates from <a href="https://www.ncbi.nlm.nih.gov/pathogens/">NCBI Pathogen Detection</a> (isolate
        metadata, AMRFinderPlus genotypes and SNP cluster membership) to the USDA ERS{' '}
        <a href="https://www.ers.usda.gov/data-products/farm-income-and-wealth-statistics">Farm Income and Wealth Statistics</a>{' '}
        annual cash receipts by commodity and state.
      </p>
      <p><b>Organism groups loaded:</b> {meta.organisms.map((o) => `${o.organism} (${fmtInt(o.n)})`).join(', ')}.</p>
      <h3>Key definitions</h3>
      <ul>
        <li><b>State</b>: from <code>food_origin</code> (e.g. USA:CA) where reported, else <code>geo_loc_name</code>.</li>
        <li><b>Year</b>: first four digits of <code>collection_date</code>. Upload date is not used.</li>
        <li><b>Source</b>: Human clinical / Food / Animal / Environment from <code>epi_type</code>, <code>source_type</code> and the IFSAC category;
          records without those are classified from free-text <code>isolation_source</code> and <code>host</code> (e.g. “comminuted chicken” → Food · chicken).</li>
        <li><b>Normalize by economic output</b>: isolates ÷ cash receipts of the chosen commodity ($ billions), same state and year.</li>
        <li><b>Normalize by species</b>: food and animal isolates of each host species ÷ that species’ own receipts (chicken → broilers, eggs → chicken eggs,
          cattle/beef → cattle, dairy → dairy products, swine/pork → hogs, turkey → turkeys, fish/shellfish → aquaculture). Hosts without a USDA
          commodity (companion animals, wildlife, sheep/goat) are excluded in this mode.</li>
        <li><b>Combine years by</b>: each measure is computed per year, then combined across the year range. “Sum” pools the years
          (Σ isolates ÷ Σ receipts for rates, Σ carriers ÷ Σ isolates for prevalence); mean, median, min and max summarise the yearly values.</li>
        <li><b>Prevalence</b>: share of isolates in which AMRFinderPlus reported the gene (partial hits included).</li>
        <li><b>Cluster discovery rate</b>: isolates collected per year within the window, combined across years as above (sum = all isolates in the window).</li>
      </ul>
      <p className="muted small">
        Data: NCBI Pathogen Detection (no restrictions on use; please acknowledge NCBI and the submitting agencies) and USDA ERS (public domain).
        Isolates are not linked to identifiable patients.
      </p>
    </div>
  )
}
