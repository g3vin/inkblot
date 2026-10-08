/**
 * The Stats tab's pictures, drawn as SVG so they scale with the inspector: goal
 * rings, the activity bars, the streak calendar, the hour-of-week grid, and a
 * deadline's burndown (GoalViews.swift, InsightsView.swift, StatsPanelView.swift).
 *
 * One hue throughout — the accent — with grey for what is not the point (deleted
 * words, empty days); a hover names the day or hour under the pointer in the
 * caption, so nothing depends on colour alone.
 */
import { useMemo, useState } from 'react'
import Icon from '../../ui/Icon.jsx'
import { classifyDay, goalFor, METRIC_INFO } from '../../stats/goals.js'
import { dayDate, dayKey, addDays, formatDuration, formatNumber, hourRange, orderedWeekdays, weekdayName, weekdayOf } from '../../stats/day.js'
import { compact, mediumDate, shortDate } from './statsText.js'

/* ---------------- goal rings ---------------- */

export function GoalRings({ status }) {
  const radius = 20
  const circumference = 2 * Math.PI * radius
  return (
    <div className="stats-rings">
      {status.targets.map((target) => (
        <div
          key={target.target.id}
          className="stats-ring"
          data-met={target.met}
          role="img"
          aria-label={`${METRIC_INFO[target.target.metric].title}: ${Math.floor(target.value)} of ${target.target.amount} ${METRIC_INFO[target.target.metric].unit}`}
        >
          <span className="stats-ring-dial">
            <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
              <circle cx="24" cy="24" r={radius} className="stats-ring-track" />
              <circle
                cx="24" cy="24" r={radius} className="stats-ring-fill"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - target.fraction)}
                transform="rotate(-90 24 24)"
              />
            </svg>
            <Icon name={target.met ? 'check' : METRIC_INFO[target.target.metric].icon} />
          </span>
          <span className="stats-ring-value">{formatNumber(Math.floor(target.value))} / {formatNumber(target.target.amount)}</span>
          <span className="stats-ring-label">{METRIC_INFO[target.target.metric].title}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------------- activity ---------------- */

/** Up to the next 1, 2 or 5 × 10ⁿ, so the axis reads in round numbers. */
function niceCeiling(value) {
  const power = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 5, 10].find((multiple) => multiple * power >= value) ?? 10
  return step * power
}

/**
 * One measure a day. Words shows two series — written above the baseline in the
 * accent, deleted below it in grey — named in a legend; the others are one series.
 */
export function ActivityChart({ days, metric }) {
  const [hovered, setHovered] = useState(null)
  const width = 280
  const height = 140
  const top = 8
  const left = 30
  const plotWidth = width - left
  const value = (day) => (metric === 'words' ? day.written : metric === 'typing' ? day.activeSecs / 60 : day.openSecs / 60)
  const below = (day) => (metric === 'words' ? day.deleted : 0)
  const maxUp = niceCeiling(Math.max(1, ...days.map(value)))
  const maxDown = metric === 'words' ? Math.max(0, ...days.map(below)) : 0
  const scale = (height - top - 14) / (maxUp + maxDown)
  const baseline = top + maxUp * scale
  const slot = plotWidth / Math.max(1, days.length)
  const bar = Math.max(1, Math.min(14, slot * 0.7))
  const empty = days.every((day) => !day.written && !day.deleted && !day.activeSecs && !day.openSecs)
  const ticks = [maxUp, maxUp / 2]
  const label = (n) => (metric === 'words' ? compact(Math.abs(n)) : `${Math.round(n)}m`)
  const labelEvery = Math.ceil(days.length / 4)
  const shown = hovered != null ? days[hovered] : null

  return (
    <div className="stats-chart">
      {metric === 'words' ? (
        <div className="stats-legend">
          <span><i className="stats-swatch" data-series="written" />Written</span>
          <span><i className="stats-swatch" data-series="deleted" />Deleted</span>
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="stats-activity"
        role="img"
        aria-label={`Activity over ${days.length} days`}
        onPointerLeave={() => setHovered(null)}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const x = ((event.clientX - rect.left) / rect.width) * width - left
          const index = Math.floor(x / slot)
          setHovered(index >= 0 && index < days.length ? index : null)
        }}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width} y1={baseline - tick * scale} y2={baseline - tick * scale} className="stats-grid-line" />
            <text x={left - 4} y={baseline - tick * scale + 3} className="stats-axis" textAnchor="end">{label(tick)}</text>
          </g>
        ))}
        <line x1={left} x2={width} y1={baseline} y2={baseline} className="stats-baseline" />
        {days.map((day, index) => {
          const x = left + index * slot + (slot - bar) / 2
          const up = value(day) * scale
          const down = below(day) * scale
          return (
            <g key={day.id} data-hovered={hovered === index}>
              {up > 0 ? <rect x={x} y={baseline - up} width={bar} height={up} rx={Math.min(3, bar / 3)} className="stats-bar" /> : null}
              {down > 0 ? <rect x={x} y={baseline} width={bar} height={down} rx={Math.min(3, bar / 3)} className="stats-bar-deleted" /> : null}
              {index % labelEvery === 0 ? (
                <text x={x + bar / 2} y={height - 2} className="stats-axis" textAnchor="middle">{shortDate(day.date)}</text>
              ) : null}
            </g>
          )
        })}
      </svg>
      <p className="stats-caption">
        {empty ? 'Nothing written in this range yet.'
          : shown ? `${mediumDate(shown.date)}: ${
            metric === 'words' ? `${formatNumber(shown.written)} written, ${formatNumber(shown.deleted)} deleted`
              : metric === 'typing' ? `${formatDuration(shown.activeSecs)} typing` : `${formatDuration(shown.openSecs)} open`}`
            : ' '}
      </p>
    </div>
  )
}

/* ---------------- the streak calendar ---------------- */

/** Columns of seven days, oldest week first, ending with the week of today. */
function calendarColumns(today, weeks) {
  const end = dayDate(today)
  if (!end) return []
  const order = orderedWeekdays()
  const offset = order.indexOf(weekdayOf(end))
  const lastWeekStart = addDays(end, -offset)
  const start = addDays(lastWeekStart, -7 * (weeks - 1))
  return Array.from({ length: weeks }, (_, week) => Array.from({ length: 7 }, (_, day) => {
    const date = addDays(start, week * 7 + day)
    return date <= end ? dayKey(date) : null
  }))
}

/** Quartiles of the days with any words, so shades spread across this writer's own range. */
function wordLevels(history) {
  const counts = Object.values(history).map((p) => p.words).filter((w) => w > 0).sort((a, b) => a - b)
  if (!counts.length) return []
  return [0.25, 0.5, 0.75].map((q) => counts[Math.min(counts.length - 1, Math.floor(counts.length * q))])
}

export function StreakHeatmap({ history, plan, today, weeks, shading }) {
  const [hovered, setHovered] = useState(null)
  const columns = useMemo(() => calendarColumns(today, weeks), [today, weeks])
  const levels = useMemo(() => wordLevels(history), [history])
  const cell = 10
  const gap = 2
  const width = weeks * (cell + gap) - gap
  const height = 7 * (cell + gap) - gap

  const shade = (day) => {
    const progress = history[day] ?? { words: 0 }
    if (shading === 'words') {
      if (!progress.words) return { level: 'empty' }
      return { level: String(levels.filter((level) => progress.words > level).length) }
    }
    if (goalFor(plan, day).rest) return { level: 'rest' }
    if (classifyDay(day, history[day] ?? { words: 0, netWords: 0, typingSecs: 0, openSecs: 0, sessions: 0, sprints: 0 }, plan) === 'counts') return { level: 'met' }
    return { level: progress.words > 0 ? 'some' : 'empty' }
  }

  let caption = shading === 'words' ? 'Darker days, more words.' : 'Filled: goal met. Pale: some writing. Outlined: rest day.'
  if (hovered) {
    const progress = history[hovered] ?? { words: 0, typingSecs: 0 }
    caption = `${mediumDate(dayDate(hovered))}: ${formatNumber(progress.words)} words`
    if (progress.typingSecs > 0) caption += `, ${formatDuration(progress.typingSecs)} typing`
  }

  return (
    <div className="stats-chart">
      <svg viewBox={`0 0 ${width} ${height}`} className="stats-heatmap" role="img" aria-label={`Writing calendar, ${weeks} weeks`} onPointerLeave={() => setHovered(null)}>
        {columns.map((week, column) => week.map((day, row) => (day ? (
          <rect
            key={day}
            x={column * (cell + gap)} y={row * (cell + gap)} width={cell} height={cell} rx={2}
            className="stats-heat-cell"
            data-level={shade(day).level}
            data-hovered={hovered === day}
            onPointerEnter={() => setHovered(day)}
          />
        ) : null)))}
      </svg>
      <p className="stats-caption">{caption}</p>
    </div>
  )
}

/* ---------------- the hour grid ---------------- */

/** Seven rows of 24 hours, shaded by time typing. */
export function HourGrid({ grid }) {
  const [hovered, setHovered] = useState(null)
  const weekdays = orderedWeekdays()
  const peak = Math.max(1, ...Object.values(grid).flat())
  const cell = 9
  const gap = 1.5
  const labelWidth = 16
  const width = labelWidth + 24 * (cell + gap) - gap
  const height = 7 * (cell + gap) - gap
  let caption = 'Midnight on the left, the evening on the right.'
  if (hovered) {
    const secs = grid[hovered.weekday]?.[hovered.hour] ?? 0
    caption = `${weekdayName(hovered.weekday)}s, ${hourRange(hovered.hour)}: ${formatDuration(secs)} typing`
  }
  return (
    <div className="stats-chart">
      <svg viewBox={`0 0 ${width} ${height}`} className="stats-hours" role="img" aria-label="Time typing by hour and weekday" onPointerLeave={() => setHovered(null)}>
        {weekdays.map((weekday, row) => (
          <g key={weekday}>
            <text x={0} y={row * (cell + gap) + cell - 1} className="stats-axis">{weekdayName(weekday, 'narrow')}</text>
            {Array.from({ length: 24 }, (_, hour) => {
              const value = grid[weekday]?.[hour] ?? 0
              return (
                <rect
                  key={hour}
                  x={labelWidth + hour * (cell + gap)} y={row * (cell + gap)} width={cell} height={cell} rx={1.5}
                  className="stats-hour-cell"
                  data-empty={value === 0}
                  data-hovered={hovered?.weekday === weekday && hovered?.hour === hour}
                  style={value ? { fillOpacity: 0.2 + 0.8 * (value / peak) } : undefined}
                  onPointerEnter={() => setHovered({ weekday, hour })}
                />
              )
            })}
          </g>
        ))}
      </svg>
      <p className="stats-caption">{caption}</p>
    </div>
  )
}

/* ---------------- a deadline's burndown ---------------- */

/** Words left each day since the deadline was set, against the straight line to the due date. */
export function Burndown({ points, due }) {
  const dueDate = dayDate(due)
  if (points.length < 2 || !dueDate) return null
  const width = 280
  const height = 100
  const left = 30
  const start = points[0].date.getTime()
  const end = Math.max(dueDate.getTime(), points.at(-1).date.getTime())
  const peak = Math.max(1, ...points.map((p) => p.remaining))
  const x = (date) => left + ((date.getTime() - start) / Math.max(1, end - start)) * (width - left - 4)
  const y = (remaining) => 6 + (1 - remaining / peak) * (height - 22)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.remaining).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="stats-burndown" role="img" aria-label="Burndown: words left each day, against the planned line">
      <line x1={left} x2={width} y1={y(0)} y2={y(0)} className="stats-baseline" />
      <text x={left - 4} y={y(peak) + 3} className="stats-axis" textAnchor="end">{compact(peak)}</text>
      <text x={left - 4} y={y(0) + 3} className="stats-axis" textAnchor="end">0</text>
      <line x1={x(points[0].date)} y1={y(points[0].remaining)} x2={x(dueDate)} y2={y(0)} className="stats-planned" />
      <path d={line} className="stats-burn" />
      <text x={left} y={height - 2} className="stats-axis">{shortDate(points[0].date)}</text>
      <text x={width - 4} y={height - 2} className="stats-axis" textAnchor="end">{shortDate(dueDate)}</text>
    </svg>
  )
}
