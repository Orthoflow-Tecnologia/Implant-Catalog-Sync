export type Category = 'implant' | 'graft'

export type Manufacturer = {
  name: string
  country: string
}

export type Registration = {
  number: string
  category: Category
  processNumber: string
  technicalName: string
  riskClass: string
  commercialName: string
  holderCnpj: string
  holderName: string
  manufacturers: Manufacturer[]
  publishedOn: string | null
  validUntil: string | null
}

export type ParsedRegistrations = {
  registrations: Registration[]
  rejected: number
}

export class AnvisaFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnvisaFormatError'
  }
}

export const columns = [
  'NUMERO_REGISTRO_CADASTRO',
  'NUMERO_PROCESSO',
  'NOME_TECNICO',
  'CLASSE_RISCO',
  'NOME_COMERCIAL',
  'CNPJ_DETENTOR_REGISTRO_CADASTRO',
  'DETENTOR_REGISTRO_CADASTRO',
  'NOME_FABRICANTE',
  'NOME_PAIS_FABRIC',
  'DT_PUB_REGISTRO_CADASTRO',
  'VALIDADE_REGISTRO_CADASTRO',
  'DT_ATUALIZACAO_DADO',
] as const

// "Enxertos" também cobre enxertos vasculares e patches cardíacos, por isso fica de fora.
const categoriesByTechnicalName: ReadonlyMap<string, Category> = new Map([
  ['implantes dentarios (osseointegravel)', 'implant'],
  ['enxerto para ossos e dispositivos associados', 'graft'],
  ['enxerto osseo', 'graft'],
  ['biomateriais para enxertos e preenchimentos', 'graft'],
])

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function technicalKey(value: string): string {
  return clean(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function isoDate(value: string): string | null | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  if (!match) return undefined
  const [, day, month, year] = match
  const iso = `${year}-${month}-${day}`
  const parsed = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? undefined : iso
}

type Row = Omit<Registration, 'manufacturers'> & { manufacturer: Manufacturer | null }

function rowFrom(fields: readonly string[], category: Category): Row | null {
  const [number, processNumber, technicalName, riskClass, commercialName, cnpj, holderName, manufacturer, country, published, validity] =
    fields.map(clean)
  if (!number || !/^\d{11}$/.test(number) || !commercialName || !holderName) return null

  const publishedOn = published ? isoDate(published) : null
  const validUntil = validity?.toUpperCase() === 'VIGENTE' ? null : isoDate(validity ?? '')
  if (publishedOn === undefined || validUntil === undefined) return null

  return {
    number,
    category,
    processNumber: processNumber ?? '',
    technicalName: technicalName ?? '',
    riskClass: riskClass ?? '',
    commercialName,
    holderCnpj: (cnpj ?? '').replace(/\D/g, ''),
    holderName,
    manufacturer: manufacturer ? { name: manufacturer, country: country ?? '' } : null,
    publishedOn,
    validUntil,
  }
}

function sameRegistration(a: Row, b: Row): boolean {
  return (
    a.category === b.category &&
    a.processNumber === b.processNumber &&
    a.technicalName === b.technicalName &&
    a.riskClass === b.riskClass &&
    a.commercialName === b.commercialName &&
    a.holderCnpj === b.holderCnpj &&
    a.holderName === b.holderName &&
    a.publishedOn === b.publishedOn &&
    a.validUntil === b.validUntil
  )
}

// A ANVISA repete o registro em uma linha por fabricante; linhas que divergem em outros campos não são fundidas.
export function parseRegistrations(payload: Buffer): ParsedRegistrations {
  const text = new TextDecoder('windows-1252').decode(payload).replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  const header = lines[0]?.split(';').map(clean) ?? []
  if (header.length !== columns.length || header.some((name, index) => name !== columns[index])) {
    throw new AnvisaFormatError(`Cabeçalho inesperado na base da ANVISA: ${header.join(';').slice(0, 300)}`)
  }

  const groups = new Map<string, Row[]>()
  let rejected = 0
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue
    const fields = line.split(';')
    const category = categoriesByTechnicalName.get(technicalKey(fields[2] ?? ''))
    if (category === undefined) continue
    const row = fields.length === columns.length ? rowFrom(fields, category) : null
    if (row === null) {
      rejected += 1
      continue
    }
    const group = groups.get(row.number)
    if (group) group.push(row)
    else groups.set(row.number, [row])
  }

  const registrations: Registration[] = []
  for (const rows of groups.values()) {
    const [first] = rows
    if (!first) continue
    if (!rows.every((row) => sameRegistration(first, row))) {
      rejected += rows.length
      continue
    }
    const manufacturers = new Map<string, Manufacturer>()
    for (const { manufacturer } of rows) {
      if (manufacturer) manufacturers.set(`${manufacturer.name}|${manufacturer.country}`, manufacturer)
    }
    const { manufacturer: _manufacturer, ...registration } = first
    registrations.push({
      ...registration,
      manufacturers: [...manufacturers.values()].sort((a, b) => a.name.localeCompare(b.name) || a.country.localeCompare(b.country)),
    })
  }

  registrations.sort((a, b) => a.number.localeCompare(b.number))
  return { registrations, rejected }
}
