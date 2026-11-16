import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Meta } from './lib'

export type Agg = 'sum' | 'mean' | 'median' | 'min' | 'max'
export type Norm = 'economic' | 'species' | 'none'

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
}

/** Modifier-aware click: plain click selects only this item, Ctrl/⌘/Shift-click adds or removes it. */
export type Pick = (s: string, e?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void

interface Store {
  meta: Meta
  f: Filters
  setF: (p: Partial<Filters>) => void
  selectedStates: string[]
  pickState: Pick
  toggleState: (s: string) => void
  setSelectedStates: (s: string[]) => void
  gene: string[]
  setGene: (g: string[]) => void
  selectedClusters: string[]
  toggleCluster: (c: string) => void
  setSelectedClusters: (c: string[]) => void
  /** params for API calls that use the shared filters */
  params: Record<string, string | number>
}

const Ctx = createContext<Store | null>(null)
export const MAX_STATES = 8

export function StoreProvider({ meta, children }: { meta: Meta; children: ReactNode }) {
  const [f, setFState] = useState<Filters>({
    organism: [],
    y0: meta.default_years[0],
    y1: meta.default_years[1],
    agg: 'sum',
    norm: 'economic',
    commodity: 'animals',
    host: [],
    product: [],
    sources: ['Food', 'Animal', 'Environment'],
  })
  const [selectedStates, setSelectedStates] = useState<string[]>(['CA', 'GA', 'IA', 'TX'])
  const [gene, setGene] = useState<string[]>(['tet(A)'])
  const [selectedClusters, setSelectedClusters] = useState<string[]>([])

  const store = useMemo<Store>(() => ({
    meta,
    f,
    setF: (p) => setFState((old) => ({ ...old, ...p })),
    selectedStates,
    pickState: (s, e) => {
      const multi = !!e && (e.ctrlKey || e.metaKey || e.shiftKey)
      setSelectedStates((old) => {
        if (!multi) return old.length === 1 && old[0] === s ? [] : [s]
        return old.includes(s) ? old.filter((x) => x !== s) : [...old, s].slice(-MAX_STATES)
      })
    },
    toggleState: (s) =>
      setSelectedStates((old) => (old.includes(s) ? old.filter((x) => x !== s) : [...old, s].slice(-MAX_STATES))),
    setSelectedStates,
    gene,
    setGene,
    selectedClusters,
    toggleCluster: (c) =>
      setSelectedClusters((old) => (old.includes(c) ? old.filter((x) => x !== c) : [...old, c].slice(-8))),
    setSelectedClusters,
    params: {
      organism: f.organism.join(','),
      y0: f.y0,
      y1: f.y1,
      sources: f.sources.join(','),
      host: f.host.join(','),
      product: f.product.join(','),
    },
  }), [meta, f, selectedStates, gene, selectedClusters])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('no store')
  return s
}
