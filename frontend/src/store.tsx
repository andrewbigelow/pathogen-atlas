import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { pickWith, SOURCES } from './lib'
import type { Meta, ModKeys } from './lib'

export type Agg = 'sum' | 'mean' | 'median' | 'min' | 'max'
export type Norm = 'economic' | 'species' | 'none'
export type SectionId = 'states' | 'sources' | 'clusters'

export interface Filters {
  organism: string[] // pathogen species ([] = all)
  y0: number
  y1: number
  agg: Agg // how yearly values are combined across the year range
  norm: Norm
  commodity: string // used when norm = economic
  host: string[] // host animal species ([] = all)
  product: string[] // food products ([] = all)
  sources: string[]
  gene: string[] // AMR genes ([] = any AMR gene)
}

/** Modifier-aware click: plain click selects only this item, Ctrl/⌘/Shift-click adds or removes it. */
export type Pick = (s: string, e?: ModKeys) => void

export const MAX_STATES = 8
export const MAX_CLUSTERS = 8

/** Source categories each section offers. The state views are about food / environmental isolates. */
export const SECTION_SOURCES: Record<SectionId, readonly string[]> = {
  states: ['Food', 'Environment'],
  sources: SOURCES,
  clusters: SOURCES,
}

function defaults(meta: Meta, id: SectionId): Filters {
  return {
    organism: [],
    y0: meta.default_years[0],
    y1: meta.default_years[1],
    agg: 'sum',
    norm: 'economic',
    commodity: 'animals',
    host: [],
    product: [],
    sources: [...SECTION_SOURCES[id]],
    gene: id === 'clusters' ? [] : ['tet(A)'],
  }
}

const DEFAULT_STATES: Record<SectionId, string[]> = { states: ['CA', 'GA', 'IA', 'TX'], sources: ['CA', 'GA', 'IA', 'TX'], clusters: [] }

interface SectionState { f: Filters; selectedStates: string[] }

interface Store {
  meta: Meta
  sections: Record<SectionId, SectionState>
  setF: (id: SectionId, p: Partial<Filters>) => void
  resetF: (id: SectionId) => void
  setSelectedStates: (id: SectionId, fn: (old: string[]) => string[]) => void
  active: SectionId | null
  setActive: (id: SectionId | null) => void
  selectedClusters: string[]
  pickCluster: Pick
  setSelectedClusters: (c: string[]) => void
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ meta, children }: { meta: Meta; children: ReactNode }) {
  const [sections, setSections] = useState<Record<SectionId, SectionState>>(() => ({
    states: { f: defaults(meta, 'states'), selectedStates: DEFAULT_STATES.states },
    sources: { f: defaults(meta, 'sources'), selectedStates: DEFAULT_STATES.sources },
    clusters: { f: defaults(meta, 'clusters'), selectedStates: DEFAULT_STATES.clusters },
  }))
  const [active, setActive] = useState<SectionId | null>('states')
  const [selectedClusters, setSelectedClusters] = useState<string[]>([])

  const store = useMemo<Store>(() => {
    const patch = (id: SectionId, fn: (s: SectionState) => SectionState) => setSections((old) => ({ ...old, [id]: fn(old[id]) }))
    return {
      meta,
      sections,
      setF: (id, p) => patch(id, (s) => ({ ...s, f: { ...s.f, ...p } })),
      resetF: (id) => patch(id, (s) => ({ ...s, f: defaults(meta, id) })),
      setSelectedStates: (id, fn) => patch(id, (s) => ({ ...s, selectedStates: fn(s.selectedStates) })),
      active,
      setActive,
      selectedClusters,
      pickCluster: (c, e) => setSelectedClusters((old) => pickWith(old, c, e, MAX_CLUSTERS)),
      setSelectedClusters,
    }
  }, [meta, sections, active, selectedClusters])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('no store')
  return s
}

// ---------------------------------------------------------------- section scope

const SectionCtx = createContext<SectionId>('states')

/** Everything inside reads and writes this section's filters only. */
export function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  return <SectionCtx.Provider value={id}>{children}</SectionCtx.Provider>
}

/** Filters, state selection and API params for the enclosing <Section> (or an explicit id). */
export function useSection(explicit?: SectionId) {
  const ctxId = useContext(SectionCtx)
  const id = explicit ?? ctxId
  const store = useStore()
  const { f, selectedStates } = store.sections[id]
  return {
    id,
    meta: store.meta,
    f,
    setF: (p: Partial<Filters>) => store.setF(id, p),
    reset: () => store.resetF(id),
    allowedSources: SECTION_SOURCES[id],
    selectedStates,
    pickState: ((s, e) => store.setSelectedStates(id, (old) => pickWith(old, s, e, MAX_STATES))) as Pick,
    setSelectedStates: (s: string[]) => store.setSelectedStates(id, () => s),
    /** params for API calls that use this section's filters */
    params: {
      organism: f.organism.join(','),
      y0: f.y0,
      y1: f.y1,
      sources: f.sources.join(','),
      host: f.host.join(','),
      product: f.product.join(','),
    } as Record<string, string | number>,
  }
}
