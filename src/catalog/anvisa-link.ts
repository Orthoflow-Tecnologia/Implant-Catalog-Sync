import type { CatalogItem } from './items.js'

export type RegistrationName = {
  number: string
  category: 'implant' | 'graft'
  holderCnpj: string
  commercialName: string
}

type Key = { base: string; qualifier: number | null }

const noise = new Set([
  'implante',
  'implantes',
  'implant',
  'dentario',
  'dentarios',
  'odontologico',
  'odontologicos',
  'familia',
  'de',
  'do',
  'geistlich',
  'straumann',
  'neodent',
  'nobel',
  'biocare',
])

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[®™©@]/g, ' ')
    .split(/\s+/)
    .filter((word) => word !== '' && !noise.has(word))
    .join(' ')
}

// "Helix Short Acqua 4.0 mm" e "TiUltra 3.0" são registros de uma medida específica; o número final vira qualificador.
export function registrationKey(commercialName: string): Key {
  const normalized = normalizeName(commercialName)
  const match = /^(.+?)\s(?:ø\s*)?(\d+(?:[.,]\d+)?)\s*(?:mm)?$/.exec(normalized)
  if (!match?.[1] || !match[2]) return { base: normalized, qualifier: null }
  return { base: match[1], qualifier: Number(match[2].replace(',', '.')) }
}

export function createAnvisaLinker(registrations: readonly RegistrationName[]): (item: CatalogItem) => string | null {
  const keyed = registrations.map((registration) => ({ ...registration, key: registrationKey(registration.commercialName) }))

  return (item) => {
    const holders = new Set(item.anvisaHolders)
    const eligible = keyed.filter((registration) => registration.category === item.kind && holders.has(registration.holderCnpj))
    for (const name of item.anvisaNames) {
      const base = normalizeName(name)
      const candidates = eligible.filter((registration) => registration.key.base === base)
      if (candidates.length === 0) continue

      const qualified = candidates.filter((registration) => registration.key.qualifier !== null)
      if (item.kind === 'implant') {
        const byDiameter = qualified.filter((registration) => registration.key.qualifier === item.diameterMm)
        const byLength = qualified.filter((registration) => registration.key.qualifier === item.lengthMm)
        if (byLength.length > 0) return null
        if (byDiameter.length === 1) return byDiameter[0]?.number ?? null
        if (byDiameter.length > 1) return null
      }
      const plain = candidates.filter((registration) => registration.key.qualifier === null)
      return plain.length === 1 ? (plain[0]?.number ?? null) : null
    }
    return null
  }
}
