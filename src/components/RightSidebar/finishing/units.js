/**
 * units.js — lengths in the Finishing tabs. Stored in millimetres always; shown in the
 * author's unit (inkblot.pageUnits), as LengthUnit.swift had it.
 */
import { getPreference, setPreference } from '../../../lib/preferences'

export const UNITS_KEY = 'inkblot.pageUnits'

export const UNITS = {
  in: { label: 'Inches', perMm: 1 / 25.4, digits: 3 },
  mm: { label: 'Millimeters', perMm: 1, digits: 1 },
  cm: { label: 'Centimeters', perMm: 0.1, digits: 2 },
  pt: { label: 'Points', perMm: 72 / 25.4, digits: 1 },
}

/** Inches where the paper is Letter, millimetres everywhere else. */
export const defaultUnit = () => {
  const locale = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
  return /-(US|LR|MM)$/i.test(locale) ? 'in' : 'mm'
}

export const readUnit = () => {
  const stored = getPreference(UNITS_KEY)
  return UNITS[stored] ? stored : defaultUnit()
}

export const writeUnit = (unit) => {
  if (UNITS[unit]) setPreference(UNITS_KEY, unit)
  window.dispatchEvent(new CustomEvent('inkblot:page-units'))
}

export const fromMm = (mm, unit) => mm * UNITS[unit].perMm
export const toMm = (value, unit) => value / UNITS[unit].perMm

export const roundTo = (value, digits) => {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

export const describeLength = (mm, unit, digits = UNITS[unit].digits) => `${roundTo(fromMm(mm, unit), digits)} ${unit}`
