/**
 * MapTimeline.jsx — the story's clock at the foot of a map.
 *
 * Scrub to any day and every traveller is where they would be; press play and the
 * journeys run. On a star system the planets turn with it. Red ticks mark conflicts —
 * click one in the inspector to jump there. The date is written in the project's
 * calendar.
 */
import { useEffect, useRef, useState } from 'react'
import SFIcon from '../components/SFIcon'
import { formatDay } from '../lib/map/calendar'

/** Days of story per second of playback. */
const SPEEDS = [
  { value: 1 / 24, label: '1 hour/s' },
  { value: 0.25, label: '6 hours/s' },
  { value: 1, label: '1 day/s' },
  { value: 7, label: '1 week/s' },
  { value: 30, label: '1 month/s' },
  { value: 365.25, label: '1 year/s' },
]

export default function MapTimeline({ day, onDay, extent, calendar, conflicts, isSystem, inspectorOpen }) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(isSystem ? 30 : 1)
  const dayRef = useRef(day)
  const onDayRef = useRef(onDay)

  useEffect(() => {
    dayRef.current = day
    onDayRef.current = onDay
  }, [day, onDay])

  // The track reaches a little past both ends, and always includes the day shown.
  const span = Math.max(1, extent.to - extent.from)
  const min = Math.floor(Math.min(extent.from - span * 0.05, day))
  const max = Math.ceil(Math.max(extent.to + span * 0.05, day, min + 1))

  useEffect(() => {
    if (!playing) return undefined
    let frame = 0
    let last = performance.now()
    const tick = (now) => {
      const next = dayRef.current + ((now - last) / 1000) * speed
      last = now
      // A journey plays through once and stops at its end; a star system turns forever.
      if (!isSystem && next >= max) {
        onDayRef.current(max)
        setPlaying(false)
        return
      }
      onDayRef.current(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isSystem, max, playing, speed])

  const togglePlay = () => {
    if (!playing && !isSystem && day >= max - 1e-6) onDay(min)
    setPlaying((current) => !current)
  }

  const ticks = conflicts.filter((conflict) => Number.isFinite(conflict.from))
  // An hour at a time: fine enough to place a traveller mid-journey.
  const step = 1 / 24

  return (
    <div
      className="map-floating map-timeline"
      style={inspectorOpen ? { left: 'calc(50% - 146px)' } : undefined}
      aria-label="Story timeline"
    >
      <div className="map-timeline-row">
        <button type="button" className="map-tool" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'}>
          <SFIcon name={playing ? 'pause' : 'play'} size={16} />
        </button>
        <span className="map-timeline-date">{formatDay(calendar, day, { withTime: day % 1 !== 0 })}</span>
        <div className="map-timeline-track">
          {ticks.map((conflict, index) => (
            <span
              key={`${conflict.kind}-${index}`}
              className="map-timeline-tick"
              style={{ left: `${((Math.min(max, Math.max(min, conflict.from)) - min) / (max - min)) * 100}%` }}
              title={conflict.kind}
            />
          ))}
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={Math.min(max, Math.max(min, day))}
            onChange={(event) => onDay(Number(event.target.value))}
            aria-label="Story day"
          />
        </div>
        <select className="map-timeline-speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="Playback speed">
          {SPEEDS.map((option) => (
            <option key={option.label} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
