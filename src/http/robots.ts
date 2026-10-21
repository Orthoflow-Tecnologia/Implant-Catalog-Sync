import type { FetchFunction } from './download.js'

export const productToken = 'implant-catalog-sync'
export const userAgent = `${productToken}/0.2 (+https://github.com/Orthoflow-Tecnologia/Implant-Catalog-Sync)`

type Rule = { allow: boolean; pattern: string }

export type RobotsRules = { rules: Rule[] } | 'allow-all' | 'disallow-all'

// Grupos do robots.txt (RFC 9309): vale o grupo do nosso token; sem ele, o de "*".
export function parseRobots(text: string): { agents: string[]; rules: Rule[] }[] {
  const groups: { agents: string[]; rules: Rule[] }[] = []
  let current: { agents: string[]; rules: Rule[] } | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const separator = line.indexOf(':')
    if (separator < 0) continue
    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (field === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
    } else if ((field === 'allow' || field === 'disallow') && current) {
      if (value !== '') current.rules.push({ allow: field === 'allow', pattern: value })
    }
  }
  return groups
}

export function rulesFor(text: string, token: string): Rule[] {
  const groups = parseRobots(text)
  const own = groups.filter((group) => group.agents.includes(token))
  const chosen = own.length > 0 ? own : groups.filter((group) => group.agents.includes('*'))
  return chosen.flatMap((group) => group.rules)
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const regex = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${regex}${anchored ? '$' : ''}`).test(path)
}

// A regra mais específica (padrão mais longo) decide; em empate, Allow prevalece.
export function isAllowed(rules: RobotsRules, url: URL): boolean {
  if (rules === 'allow-all') return true
  if (rules === 'disallow-all') return false
  const path = `${url.pathname}${url.search}`
  let decision: Rule | null = null
  for (const rule of rules.rules) {
    if (!matches(rule.pattern, path)) continue
    if (!decision || rule.pattern.length > decision.pattern.length || (rule.pattern.length === decision.pattern.length && rule.allow)) {
      decision = rule
    }
  }
  return decision?.allow ?? true
}

export type RobotsPolicy = (url: URL) => Promise<boolean>

export function createRobotsPolicy(options: { fetch: FetchFunction; timeoutMs: number }): RobotsPolicy {
  const cache = new Map<string, Promise<RobotsRules>>()

  async function load(origin: string): Promise<RobotsRules> {
    let response: Response
    try {
      response = await options.fetch(`${origin}/robots.txt`, {
        headers: { 'user-agent': userAgent },
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeoutMs),
      })
    } catch {
      return 'disallow-all'
    }
    // RFC 9309: 4xx equivale a ausência de restrições; 5xx ou rede indisponível, a bloqueio total.
    if (response.status >= 400 && response.status < 500) return 'allow-all'
    if (response.status !== 200) return 'disallow-all'
    return { rules: rulesFor(await response.text(), productToken) }
  }

  return async (url) => {
    let rules = cache.get(url.origin)
    if (!rules) {
      rules = load(url.origin)
      cache.set(url.origin, rules)
    }
    return isAllowed(await rules, url)
  }
}
