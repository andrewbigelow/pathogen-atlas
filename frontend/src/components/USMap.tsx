import { useMemo } from 'react'
import * as d3 from 'd3'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import statesTopo from 'us-atlas/states-10m.json'
import { NAME_TO_ABBR, useWidth } from '../lib'
import type { TipContent } from './Tooltip'

const topo = statesTopo as unknown as Topology<{ states: GeometryCollection<{ name: string }> }>
const fc = feature(topo, topo.objects.states)
const features = fc.features.filter((f) => NAME_TO_ABBR[f.properties.name])

interface Props {
  value: (abbr: string) => number | null | undefined
  color: (v: number) => string
  flagged?: Set<string>
  selected?: string[]
  onClick?: (abbr: string, e: React.MouseEvent) => void
  tip: (abbr: string) => TipContent
  showTip: (e: React.MouseEvent, c: TipContent) => void
  hideTip: () => void
  height?: number
  /** pattern for states with too little data */
  insufficient?: (abbr: string) => boolean
}

export function USMap({ value, color, flagged, selected = [], onClick, tip, showTip, hideTip, height, insufficient }: Props) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const h = height ?? Math.round(w * 0.6)
  const path = useMemo(() => {
    const proj = d3.geoAlbersUsa().fitSize([w, h], fc)
    return d3.geoPath(proj)
  }, [w, h])

  // draw flagged / selected states last so their outlines are not covered
  const ordered = useMemo(() => {
    const rank = (a: string) => (selected.includes(a) ? 2 : flagged?.has(a) ? 1 : 0)
    return [...features].sort((a, b) => rank(NAME_TO_ABBR[a.properties.name]) - rank(NAME_TO_ABBR[b.properties.name]))
  }, [flagged, selected])

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={w} height={h} role="img" aria-label="Map of US states">
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--nodata)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--text-muted)" strokeWidth="1" opacity="0.5" />
          </pattern>
        </defs>
        {ordered.map((f) => {
          const a = NAME_TO_ABBR[f.properties.name]
          const v = value(a)
          const flag = flagged?.has(a)
          const fill = insufficient?.(a) ? 'url(#hatch)' : v == null || !isFinite(v) ? 'var(--nodata)' : color(v)
          return (
            <path
              key={a}
              d={path(f) ?? ''}
              fill={fill}
              stroke={flag ? 'var(--flag)' : 'var(--surface-1)'}
              strokeWidth={flag ? 2 : 0.75}
              style={{ cursor: onClick ? 'pointer' : 'default' }}
              onMouseMove={(e) => showTip(e, tip(a))}
              onMouseLeave={hideTip}
              onClick={(e) => onClick?.(a, e)}
            />
          )
        })}
        {/* selected states: labelled pin at the centroid (outline color would vanish on the blue ramp) */}
        {features.filter((f) => selected.includes(NAME_TO_ABBR[f.properties.name])).map((f) => {
          const a = NAME_TO_ABBR[f.properties.name]
          const [cx, cy] = path.centroid(f)
          if (!isFinite(cx)) return null
          return (
            <g key={'sel' + a} transform={`translate(${cx},${cy})`} style={{ pointerEvents: 'none' }}>
              <rect x={-14} y={-9} width={28} height={18} rx={9} fill="var(--surface-1)" stroke="var(--text-primary)" strokeWidth={1.5} />
              <text textAnchor="middle" y={4} style={{ fontWeight: 700, fill: 'var(--text-primary)', fontSize: 10.5 }}>{a}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Horizontal continuous color legend. */
export function ColorLegend({ scale, label, ticks = 5, format = d3.format('~s'), width = 240, marker, log }: {
  scale: d3.ScaleSequential<string> | d3.ScaleDiverging<string>
  log?: boolean
  label: string
  ticks?: number
  format?: (v: number) => string
  width?: number
  marker?: { value: number; label: string }
}) {
  const id = useMemo(() => 'lg' + Math.random().toString(36).slice(2), [])
  const [d0, d1] = [scale.domain()[0], scale.domain()[scale.domain().length - 1]]
  const x = (log ? d3.scaleLog() : d3.scaleLinear()).domain([d0, d1]).range([0, width])
  const stops = d3.range(0, 1.0001, 0.1).map((t) => x.invert(t * width))
  const tks = log ? x.ticks(ticks).filter((t) => /^1(0*|\.0*)$|^0\.0*1$/.test(String(t))) : x.ticks(ticks)
  return (
    <svg width={width + 20} height={44} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={id}>
          {stops.map((s, i) => (
            <stop key={i} offset={`${(i / (stops.length - 1)) * 100}%`} stopColor={scale(s)} />
          ))}
        </linearGradient>
      </defs>
      <text x={0} y={10} style={{ fontWeight: 600 }}>{label}</text>
      <rect x={0} y={15} width={width} height={9} rx={2} fill={`url(#${id})`} />
      {tks.map((t) => (
        <text key={t} x={x(t)} y={38} textAnchor="middle">{format(t)}</text>
      ))}
      {marker && marker.value >= d0 && marker.value <= d1 && (
        <g transform={`translate(${x(marker.value)},0)`}>
          <line y1={12} y2={27} stroke="var(--flag)" strokeWidth={2} />
        </g>
      )}
    </svg>
  )
}
