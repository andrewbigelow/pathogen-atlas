import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

// ------------------------------------------------------------------ API
const cache = new Map<string, Promise<unknown>>()

export function api<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') qs.set(k, String(v))
  })
  const url = `/api/${path}?${qs}`
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${url}`)
        return r.json()
      }),
    )
  }
  return cache.get(url) as Promise<T>
}

export type ApiParams = Record<string, string | number | string[] | undefined>

export function useApi<T>(path: string | null, raw: ApiParams = {}) {
  const params: Record<string, string | number | undefined> = {}
  for (const [k, v] of Object.entries(raw)) params[k] = Array.isArray(v) ? v.join(',') : v
  const key = path ? path + JSON.stringify(params) : null
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({
    key: null, data: null, error: null,
  })
  useEffect(() => {
    if (!path) return
    let live = true
    api<T>(path, params)
      .then((data) => live && setState({ key, data, error: null }))
      .catch((e) => live && setState({ key, data: null, error: String(e) }))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  // keep showing the previous data while the next request loads (no flashing)
  return { data: state.data, loading: state.key !== key, error: state.error }
}

// ------------------------------------------------------------------ sizing
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver((e) => setW(Math.max(200, Math.floor(e[0].contentRect.width))))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function useDark() {
  const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
  const [dark, setDark] = useState(mq?.matches ?? false)
  useEffect(() => {
    if (!mq) return
    const f = (e: MediaQueryListEvent) => setDark(e.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [mq])
  return dark
}

// ------------------------------------------------------------------ color
/** Sequential ramp: magma. Light mode runs pale yellow -> deep purple (low recedes into the light
 *  surface); dark mode runs deep purple -> bright yellow. Both ends are trimmed so no value is
 *  surface-coloured (near-white / near-black). */
export function seqInterpolator(dark: boolean) {
  return dark
    ? (t: number) => d3.interpolateMagma(0.14 + 0.84 * t)
    : (t: number) => d3.interpolateMagma(0.96 - 0.82 * t)
}

/** n distinct line colours sampled from magma, avoiding the ends that vanish on the surface. */
export function magmaSeries(n: number, dark: boolean): string[] {
  const [a, b] = dark ? [0.48, 0.95] : [0.12, 0.8]
  if (n <= 1) return [d3.interpolateMagma(dark ? 0.7 : 0.5)]
  return d3.range(n).map((i) => d3.interpolateMagma(a + ((b - a) * i) / (n - 1)))
}

export function divInterpolator(dark: boolean) {
  return dark
    ? d3.interpolateRgbBasis(['#3987e5', '#383835', '#e66767'])
    : d3.interpolateRgbBasis(['#2a78d6', '#f0efec', '#e34948'])
}

export const SOURCES = ['Human clinical', 'Food', 'Animal', 'Environment', 'Unknown'] as const
export type Source = (typeof SOURCES)[number]
export const SOURCE_VAR: Record<string, string> = {
  'Human clinical': 'var(--src-clinical)',
  Food: 'var(--src-food)',
  Animal: 'var(--src-animal)',
  Environment: 'var(--src-env)',
  Unknown: 'var(--src-unknown)',
}

// ------------------------------------------------------------------ format
export const fmtInt = d3.format(',')
export const fmtPct = (v: number | null | undefined) => (v == null ? '—' : d3.format('.1%')(v))
export const fmtRate = (v: number | null | undefined) =>
  v == null || !isFinite(v) ? '—' : v >= 100 ? d3.format(',.0f')(v) : v >= 10 ? d3.format('.1f')(v) : d3.format('.2f')(v)

/** Wilson score interval for a binomial proportion. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0]
  const p = k / n
  const den = 1 + (z * z) / n
  const c = p + (z * z) / (2 * n)
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [Math.max(0, (c - m) / den), Math.min(1, (c + m) / den)]
}

export const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming',
}
export const NAME_TO_ABBR = Object.fromEntries(Object.entries(STATE_NAMES).map(([a, n]) => [n, a]))

// ------------------------------------------------------------------ types
export interface Meta {
  organisms: { organism: string; n: number }[]
  hosts: { key: string; label: string; n: number; commodities: string[] }[]
  products: { product: string; n: number; host: string | null }[]
  commodities: { key: string; label: string }[]
  sources: string[]
  year_min: number
  year_max: number
  default_years: [number, number]
}
export interface RateRow { state: string; year: number; n: number; receipts_k: number | null; rate: number | null }
export interface PrevRow {
  state: string; year: number; n: number; n_gene: number; receipts_k: number | null; rate: number | null
}
export interface PrevState {
  state: string; n: number; n_gene: number; prevalence: number | null; receipts_k: number | null; rate: number | null
}
export interface ClusterRow {
  cluster: string; organism: string; serovar: string | null; n: number; rate: number
  first_year: number; last_year: number; n_states: number
  n_clinical: number; n_food: number; n_animal: number; n_env: number; med_minsame: number | null
}
export interface Completeness {
  total: number; both: number; date_only: number; state_only: number; neither: number
  from_food_origin: number; from_geo: number
  by_year: { year: number; n: number; with_state: number }[]
}

// ------------------------------------------------------------------ aggregation across years
export type AggHow = 'sum' | 'mean' | 'median' | 'min' | 'max'
export const AGG_OPTIONS: { v: AggHow; label: string }[] = [
  { v: 'sum', label: 'Sum' }, { v: 'mean', label: 'Mean' }, { v: 'median', label: 'Median' },
  { v: 'min', label: 'Min' }, { v: 'max', label: 'Max' },
]

/** Combine yearly values. `pooled` is what "sum" means for a ratio (Σnumerator / Σdenominator). */
export function aggregate(vals: number[], how: AggHow, pooled?: number | null): number | null {
  const v = vals.filter((x) => x != null && isFinite(x))
  if (how === 'sum') return pooled !== undefined ? pooled : v.length ? d3.sum(v) : null
  if (!v.length) return null
  return (how === 'mean' ? d3.mean(v) : how === 'median' ? d3.median(v) : how === 'min' ? d3.min(v) : d3.max(v)) ?? null
}

/** Aggregate a state's yearly normalised rates; "sum" pools counts over receipts. */
export function aggRate(rows: { n: number; receipts_k: number | null; rate: number | null }[], how: AggHow, norm: string) {
  const withDen = rows.filter((r) => r.rate != null)
  const n = d3.sum(withDen, (r) => r.n)
  const rec = d3.sum(withDen, (r) => r.receipts_k ?? 0)
  const pooled = norm === 'none' ? (withDen.length ? n : null) : rec > 0 ? n / (rec / 1e6) : null
  return aggregate(withDen.map((r) => r.rate as number), how, pooled)
}

export function aggWord(how: AggHow) {
  return how === 'sum' ? 'Pooled' : how === 'mean' ? 'Mean yearly' : how === 'median' ? 'Median yearly' : how === 'min' ? 'Lowest yearly' : 'Highest yearly'
}
