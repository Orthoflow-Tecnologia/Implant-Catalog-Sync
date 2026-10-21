export function linksIn(html: string, baseUrl: string): string[] {
  const links = new Set<string>()
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      links.add(new URL((match[1] ?? '').replaceAll('&amp;', '&'), baseUrl).toString())
    } catch {
      // href inválido não aponta para catálogo nenhum
    }
  }
  return [...links]
}
