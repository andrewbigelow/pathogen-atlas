import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useApi, fmtInt, AGG_OPTIONS, SOURCES, SOURCE_VAR, STATE_NAMES } from '../lib'
import type { Meta } from '../lib'
import { useStore, MAX_STATES } from '../store'
import type { Filters, Agg, Norm } from '../store'

export function Slider({ label, value, min, max, step, onChange, format = String, hint }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; format?: (v: number) => string; hint?: string
}) {
  return (
    <div className="slider">
      <span className="field-label">{label}</span>
      <div className="row">
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(+e.target.value)} aria-label={label} />
        <output>{format(value)}</output>
      </div>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  )
}

export function Seg<T extends string>({ value, options, onChange, label }: {
  value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label?: string
}) {
  return (
    <div className="field">
      {label && <span className="field-label">{label}</span>}
      <div className="seg" role="group">
        {options.map((o) => (
          <button key={o.v} aria-pressed={o.v === value} onClick={() => onChange(o.v)}>{o.label}</button>
        ))}
      </div>
    </div>
  )
}

export function Select({ label, value, onChange, options, width, id }: {
  label: string; value: string | number; onChange: (v: string) => void
  options: { v: string | number; label: string; disabled?: boolean }[]; width?: number; id: string
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} style={{ width }}>
        {options.map((o) => <option key={o.v} value={o.v} disabled={o.disabled}>{o.label}</option>)}
      </select>
    </div>
  )
}

// ---------------------------------------------------------------- year range + aggregation (header)

/** Two-thumb year slider; commits after the thumb settles so dragging doesn't flood the API. */
export function YearRange() {
  const { meta, f, setF } = useStore()
  const [v, setV] = useState<[number, number]>([f.y0, f.y1])
  useEffect(() => setV([f.y0, f.y1]), [f.y0, f.y1])
  const t = useRef<number | undefined>(undefined)
  const commit = (next: [number, number]) => {
    setV(next)
    window.clearTimeout(t.current)
    t.current = window.setTimeout(() => setF({ y0: next[0], y1: next[1] }), 250)
  }
  const lo = meta.year_min, hi = meta.year_max
  const pct = (y: number) => ((y - lo) / (hi - lo)) * 100
  return (
    <div className="field year-range">
      <span className="field-label">Collection years <b className="tnum">{v[0]}–{v[1]}</b></span>
      <div className="range2">
        <div className="track" />
        <div className="track fill" style={{ left: `${pct(v[0])}%`, right: `${100 - pct(v[1])}%` }} />
        <input type="range" min={lo} max={hi} step={1} value={v[0]} aria-label="From year"
          onChange={(e) => commit([Math.min(+e.target.value, v[1]), v[1]])} />
        <input type="range" min={lo} max={hi} step={1} value={v[1]} aria-label="To year"
          onChange={(e) => commit([v[0], Math.max(+e.target.value, v[0])])} />
      </div>
      <div className="range-ticks"><span>{lo}</span><span>{hi}</span></div>
      <div className="agg-row">
        <span className="field-label">Combine years by</span>
        <div className="seg" role="group" aria-label="Combine years by">
          {AGG_OPTIONS.map((o) => (
            <button key={o.v} aria-pressed={f.agg === o.v} onClick={() => setF({ agg: o.v as Agg })}>{o.label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- selected states bar

export function SelectionBar() {
  const { selectedStates, toggleState, setSelectedStates } = useStore()
  return (
    <div className="selection-bar">
      <span className="field-label">Selected states</span>
      <div className="chips">
        {selectedStates.map((s) => (
          <span key={s} className="chip static sel">{STATE_NAMES[s]}
            <button aria-label={`Remove ${s}`} onClick={() => toggleState(s)}>✕</button></span>
        ))}
        {selectedStates.length < MAX_STATES && (
          <select value="" aria-label="Add state" onChange={(e) => e.target.value && toggleState(e.target.value)} style={{ height: 28 }}>
            <option value="">+ add state</option>
            {Object.entries(STATE_NAMES).filter(([a]) => !selectedStates.includes(a)).map(([a, n]) => <option key={a} value={a}>{n}</option>)}
          </select>
        )}
        {selectedStates.length > 0 && <button className="linklike" onClick={() => setSelectedStates([])}>Clear</button>}
      </div>
      <span className="muted small">Click a state on any chart to select it alone · Ctrl/⌘-click to add or remove</span>
    </div>
  )
}

// ---------------------------------------------------------------- per-page filter fields

export function FilterCard({ children }: { children: ReactNode }) {
  return <div className="card filter-card"><div className="controls" style={{ marginBottom: 0 }}>{children}</div></div>
}

export function commodityLabel(meta: Meta, key: string) {
  return meta.commodities.find((c) => c.key === key)?.label ?? key
}

/** Human-readable unit for the current normalisation. */
export function normUnit(f: Filters, meta: Meta, short = false) {
  if (f.norm === 'none') return 'isolates'
  if (f.norm === 'species') return short ? 'isolates per $1B (matching species)' : "isolates per $1B of each host species' own cash receipts"
  return short ? 'isolates per $1B' : `isolates per $1B of ${commodityLabel(meta, f.commodity).toLowerCase()} cash receipts`
}

export function NormFields() {
  const { meta, f, setF } = useStore()
  return (
    <>
      <Select id="norm" label="Normalize by" value={f.norm} onChange={(v) => setF({ norm: v as Norm })} options={[
        { v: 'economic', label: 'Economic output (cash receipts)' },
        { v: 'species', label: "Species (matching animal's receipts)" },
        { v: 'none', label: 'None (raw isolate count)' },
      ]} />
      {f.norm === 'economic' && (
        <Select id="com" label="Commodity" value={f.commodity} onChange={(v) => setF({ commodity: v })}
          options={meta.commodities.map((c) => ({ v: c.key, label: c.label }))} />
      )}
    </>
  )
}

// ---------------------------------------------------------------- checkbox multi-select

export interface MsOption { v: string; label: string; n?: number; group?: string; disabled?: boolean }

/** Dropdown of checkboxes. Nothing checked means "all" (unless `required`, which keeps at least one). */
export function MultiSelect({ label, values, onChange, options, allLabel, required = false, search = false, width }: {
  label: string; values: string[]; onChange: (v: string[]) => void; options: MsOption[]
  allLabel: string; required?: boolean; search?: boolean; width?: number
}) {
  const [open, setOpen] = useState(false)
  const [qText, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const name = (v: string) => options.find((o) => o.v === v)?.label ?? v
  const summary = values.length === 0 ? allLabel
    : values.length <= 2 ? values.map(name).join(', ') : `${name(values[0])} + ${values.length - 1} more`
  const toggle = (v: string) => {
    const next = values.includes(v) ? values.filter((x) => x !== v) : [...values, v]
    if (required && next.length === 0) return
    onChange(options.map((o) => o.v).filter((x) => next.includes(x)).concat(next.filter((x) => !options.some((o) => o.v === x))))
  }
  const shown = qText ? options.filter((o) => o.label.toLowerCase().includes(qText.toLowerCase()) || values.includes(o.v)) : options
  let lastGroup: string | undefined
  return (
    <div className="field ms" ref={ref}>
      <span className="field-label">{label}</span>
      <button type="button" className={'ms-btn' + (values.length ? ' active' : '')} style={{ width }}
        aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{summary}</span>
      </button>
      {open && (
        <div className="ms-pop" role="listbox" aria-multiselectable>
          {search && <input type="search" autoFocus placeholder="Search…" value={qText} onChange={(e) => setQ(e.target.value)} />}
          <div className="ms-list">
            {shown.map((o) => {
              const head = o.group && o.group !== lastGroup ? <div className="grp">{o.group}</div> : null
              lastGroup = o.group
              return (
                <div key={o.v}>
                  {head}
                  <label className={o.disabled ? 'dis' : ''}>
                    <input type="checkbox" checked={values.includes(o.v)} disabled={o.disabled} onChange={() => toggle(o.v)} />
                    {o.label}{o.n != null && <span className="n">{fmtInt(o.n)}</span>}
                  </label>
                </div>
              )
            })}
            {!shown.length && <div className="muted small" style={{ padding: 6 }}>No matches</div>}
          </div>
          <div className="ms-foot">
            {required
              ? <span className="muted">At least one required</span>
              : <button className="linklike" onClick={() => onChange([])}>Clear all</button>}
            <button className="linklike" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function PathogenField() {
  const { meta, f, setF } = useStore()
  return (
    <MultiSelect label="Pathogen species" values={f.organism} onChange={(v) => setF({ organism: v })} allLabel="All pathogens"
      options={meta.organisms.map((o) => ({ v: o.organism, label: o.organism, n: o.n }))} />
  )
}

export function HostField() {
  const { meta, f, setF } = useStore()
  const species = f.norm === 'species'
  return (
    <MultiSelect label="Host species" values={f.host} allLabel="All hosts"
      onChange={(v) => {
        // drop checked food products that no longer belong to a checked host
        const keep = f.product.filter((p) => !v.length || v.includes(meta.products.find((x) => x.product === p)?.host ?? ''))
        setF({ host: v, product: keep })
      }}
      options={meta.hosts.map((h) => ({
        v: h.key, n: h.n, label: `${h.label}${species && !h.commodities.length ? ' (no USDA match)' : ''}`,
      }))} />
  )
}

export function ProductField() {
  const { meta, f, setF } = useStore()
  const hostLabel = (k: string | null) => meta.hosts.find((h) => h.key === k)?.label ?? 'Other foods'
  const list = meta.products
    .filter((p) => !f.host.length || (p.host && f.host.includes(p.host)))
    .map((p) => ({ v: p.product, label: p.product[0].toUpperCase() + p.product.slice(1), n: p.n, group: hostLabel(p.host) }))
    .sort((a, b) => a.group.localeCompare(b.group) || (b.n ?? 0) - (a.n ?? 0))
  return (
    <MultiSelect label="Food product" values={f.product} onChange={(v) => setF({ product: v })} search
      allLabel={f.host.length ? 'All products of these hosts' : 'All food products'} options={list} />
  )
}

export function SourcesField() {
  const { f, setF } = useStore()
  const restricted = !!(f.host.length || f.product.length)
  const toggle = (s: string) => {
    const next = f.sources.includes(s) ? f.sources.filter((x) => x !== s) : [...f.sources, s]
    if (next.length) setF({ sources: SOURCES.filter((x) => next.includes(x)) })
  }
  return (
    <div className="field">
      <span className="field-label">Isolate sources{restricted ? ' (host/product → food & animal only)' : ''}</span>
      <div className="chips">
        {SOURCES.map((s) => (
          <button key={s} className="chip" aria-pressed={f.sources.includes(s)} onClick={() => toggle(s)}
            disabled={restricted && s !== 'Food' && s !== 'Animal'} style={{ opacity: restricted && s !== 'Food' && s !== 'Animal' ? 0.4 : 1 }}>
            <span className="sw" style={{ background: SOURCE_VAR[s] }} />{s === 'Human clinical' ? 'Clinical' : s}
          </button>
        ))}
      </div>
    </div>
  )
}

export function MinCountField({ value, onChange, label = 'Min. isolates', options = [0, 5, 10, 25, 50, 100, 250, 500, 1000] }: {
  value: number; onChange: (v: number) => void; label?: string; options?: number[]
}) {
  return (
    <Select id={'min-' + label} label={label} value={value} onChange={(v) => onChange(+v)} width={140}
      options={options.map((o) => ({ v: o, label: o === 0 ? 'No minimum' : `≥ ${fmtInt(o)}` }))} />
  )
}

/** AMR gene checkboxes, ordered by how many isolates carry it under the current filters.
 *  Several genes = isolates carrying any of them. */
export function GeneField({ value, onChange, allowAny = false }: { value: string[]; onChange: (g: string[]) => void; allowAny?: boolean }) {
  const { params } = useStore()
  const { data } = useApi<{ gene: string; n: number }[]>('genes', { ...params, limit: 300 })
  const opts = useMemo(() => {
    const list: MsOption[] = (data ?? []).map((g) => ({ v: g.gene, label: g.gene, n: g.n }))
    for (const g of value) if (!list.some((o) => o.v === g)) list.unshift({ v: g, label: `${g} (not found)` })
    return list
  }, [data, value])
  return <MultiSelect label="AMR gene(s)" values={value} onChange={onChange} options={opts} search
    required={!allowAny} allLabel={allowAny ? 'Any (no gene filter)' : 'Pick a gene'} width={200} />
}

/** "tet(A)" / "tet(A) or tet(B)" / "any of 4 genes" */
export function geneText(g: string[]) {
  return g.length <= 2 ? g.join(' or ') : `any of ${g.length} genes`
}
