import { useCallback, useEffect, useState } from 'react'

import { useApi, fmtInt } from './lib'
import type { Meta } from './lib'
import { StoreProvider, useStore, Section } from './store'
import type { SectionId } from './store'
import { CoverageWidget, CoverageDrawer } from './components/CoverageDrawer'
import States from './pages/States'
import Clusters from './pages/Clusters'
import Sources from './pages/Sources'

const TABS = [
  { id: 'states', label: 'State surveillance' },
  { id: 'sources', label: 'Isolate sources' },
  { id: 'clusters', label: 'SNP clusters' },
  { id: 'about', label: 'About' },
] as const
type TabId = (typeof TABS)[number]['id']
const isTab = (h: string): h is TabId => TABS.some((t) => t.id === h)

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
  const { active, setActive } = useStore()
  const [tab, setTab] = useState<TabId>(() => { const h = location.hash.slice(1); return isTab(h) ? h : 'states' })
  const [coverageOpen, setCoverageOpen] = useState(false)
  const closeCoverage = useCallback(() => setCoverageOpen(false), [])
  const go = (t: TabId) => { setTab(t); history.replaceState(null, '', '#' + t); window.scrollTo(0, 0) }
  useEffect(() => {
    const f = () => { const h = location.hash.slice(1); if (isTab(h)) setTab(h) }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  // the coverage widget follows the page being viewed (About keeps the last one)
  useEffect(() => { if (tab !== 'about') setActive(tab as SectionId) }, [tab, setActive])
  const covId: SectionId = active ?? 'states'
  return (
    <>
      <header className="app-header">
        <div className="header-row">
          <div className="brand">
            <h1>Pathogen Atlas</h1>
            <span>NCBI Pathogen Detection × USDA farm cash receipts</span>
          </div>
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <div style={{ flex: 1 }} />
          <ThemeToggle />
          <CoverageWidget id={covId} onOpen={() => setCoverageOpen(true)} />
        </div>
      </header>
      <main>
        {tab === 'states' && <Section id="states"><States /></Section>}
        {tab === 'sources' && <Section id="sources"><Sources /></Section>}
        {tab === 'clusters' && <Section id="clusters"><Clusters /></Section>}
        {tab === 'about' && <About />}
      </main>
      {coverageOpen && <CoverageDrawer id={covId} onClose={closeCoverage} />}
    </>
  )
}

/** One-icon light/dark switch. Starts from the OS preference, then remembers
 *  the user's choice for this browser. */
function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('atlas-theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch { /* storage blocked; fall back to the OS preference */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('atlas-theme', theme) } catch { /* ignore */ }
  }, [theme])
  const dark = theme === 'dark'
  return (
    <button className="theme-toggle" onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
      {dark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  )
}

function About() {
  const { meta } = useStore()
  return (
    <div className="card about-card">
      <h2>About this tool</h2>
      <p>
        Pathogen Atlas links US isolates from <a href="https://www.ncbi.nlm.nih.gov/pathogens/">NCBI Pathogen Detection</a> (isolate
        metadata, AMRFinderPlus genotypes and SNP cluster membership) to the USDA ERS{' '}
        <a href="https://www.ers.usda.gov/data-products/farm-income-and-wealth-statistics">Farm Income and Wealth Statistics</a>{' '}
        annual cash receipts by commodity and state.
      </p>
      <p><b>Organism groups loaded:</b> {meta.organisms.map((o) => `${o.organism} (${fmtInt(o.n)})`).join(', ')}.</p>

      <h3>How to best use this tool</h3>
      <p>
        Sequencing volume measures <i>surveillance effort</i>, not disease burden: a state that sequences more isolates will look worse
        than one that sequences none. This tool exists to separate those two things by dividing isolate counts by the cash value of the
        commodity they came from, so that a poultry isolate in Georgia is judged against the size of Georgia's poultry industry. Read every
        number here as “detections relative to production”, never as an infection rate.
      </p>
      <div className="about-steps">
        <div className="about-step">
          <h4>1 · Start on State surveillance</h4>
          <p>Pick a pathogen, a resistance gene and a commodity, then drag the threshold to see which states sit above it and in how many
            separate years. One year above the line is noise; several years running is a pattern worth investigating.</p>
        </div>
        <div className="about-step">
          <h4>2 · Ask why a state stands out</h4>
          <p>The discrepancy scatter separates states where resistance is common but detection is low (▲) from the reverse (▼). The first
            group is where surveillance is most likely to be missing something.</p>
        </div>
        <div className="about-step">
          <h4>3 · Trace it to a source</h4>
          <p>Isolate sources shows which foods and animals carry the gene and how that mix differs between states, so a state-level signal
            can be tied to a specific commodity rather than left as a map colour.</p>
        </div>
        <div className="about-step">
          <h4>4 · Check whether it is one outbreak</h4>
          <p>SNP clusters groups near-identical genomes. A state signal driven by a single large cluster is one outbreak; one spread across
            many clusters suggests something endemic.</p>
        </div>
        <div className="about-step">
          <h4>5 · Check the data before you believe it</h4>
          <p>The coverage figure in the header is live for the filters you have set. Open it before drawing a conclusion — if most isolates
            in your selection lack a state or a year, the pattern you are looking at may be a reporting artefact.</p>
        </div>
      </div>
      <p className="muted small">
        <b>Known limitation worth stating out loud:</b> states with very little agriculture have tiny denominators, so their rates are
        unstable and can top the ranking on a few dozen isolates. Treat the leaders of any normalized ranking with suspicion until you have
        checked the underlying isolate count in the summary table.
      </p>

      <h3>Key definitions</h3>
      <ul className="about-defs">
        <li><b>State</b>: from <code>food_origin</code> (e.g. USA:CA) where reported, else <code>geo_loc_name</code>.</li>
        <li><b>Year</b>: first four digits of <code>collection_date</code>. Upload date is not used.</li>
        <li><b>Source</b>: Human clinical / Food / Animal / Environment from <code>epi_type</code>, <code>source_type</code> and the IFSAC category;
          records without those are classified from free-text <code>isolation_source</code> and <code>host</code> (e.g. “comminuted chicken” → Food · chicken).</li>
        <li><b>Normalize by economic output</b>: isolates ÷ cash receipts of the chosen commodity ($ billions), same state and year.</li>
        <li><b>Normalize by species</b>: food and animal isolates of each host species ÷ that species’ own receipts (chicken → broilers, eggs → chicken eggs,
          cattle/beef → cattle, dairy → dairy products, swine/pork → hogs, turkey → turkeys, fish/shellfish → aquaculture). Hosts without a USDA
          commodity (companion animals, wildlife, sheep/goat) are excluded in this mode.</li>
        <li><b>Companion animal</b>: a non-food animal kept as a pet — dogs, cats, horses, rabbits, reptiles, birds and similar. Isolates are
          assigned here when the <code>host</code> field names such an animal, and under <i>Food</i> when the sample is pet food or a pet treat
          rather than the animal itself. USDA cash receipts cover commodities raised for sale, so companion animals have no denominator and are
          excluded whenever you normalize by species.</li>
        <li><b>Combine years by</b>: each measure is computed per year, then combined across the year range. “Sum” pools the years
          (Σ isolates ÷ Σ receipts for rates, Σ carriers ÷ Σ isolates for prevalence); mean, median, min and max summarise the yearly values.</li>
        <li><b>Filters</b>: each page keeps its own filters, year window and state selection, so changing one page never changes another.
          The data-coverage summary in the header (click it for details) always reflects the filters of the page you are on.</li>
        <li><b>Discrepancy</b>: percentile rank of a state's gene prevalence minus the percentile rank of its normalized detection rate
          (−1 to 1). Red = resistance ranks higher than detection, blue = lower.</li>
        <li><b>Prevalence</b>: share of isolates in which AMRFinderPlus reported the gene (partial hits included). With no gene picked, any AMR gene counts.</li>
        <li><b>Cluster discovery rate</b>: isolates collected per year within the window, combined across years as above (sum = all isolates in the window).</li>
      </ul>
      <p className="muted small">
        Data: NCBI Pathogen Detection (no restrictions on use; please acknowledge NCBI and the submitting agencies) and USDA ERS (public domain).
        Isolates are not linked to identifiable patients.
      </p>
    </div>
  )
}
