import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRobotsPolicy, isAllowed, rulesFor } from '../src/http/robots.js'

const robots = `
User-agent: AhrefsBot
Disallow: /

User-agent: *
Disallow: /content/dam/*.mp4$
Disallow: /private/
Allow: /private/catalogo.pdf
`

function allowed(path: string, text = robots, token = 'implant-catalog-sync'): boolean {
  return isAllowed({ rules: rulesFor(text, token) }, new URL(`https://site.example${path}`))
}

test('aplica o grupo do nosso token ou o de "*", com a regra mais específica vencendo', () => {
  assert.equal(allowed('/catalogo.pdf'), true)
  assert.equal(allowed('/private/lista.pdf'), false)
  assert.equal(allowed('/private/catalogo.pdf'), true)
  assert.equal(allowed('/content/dam/video.mp4'), false)
  assert.equal(allowed('/content/dam/video.mp4?x=1'), true)
  assert.equal(allowed('/catalogo.pdf', robots, 'ahrefsbot'), false)
  assert.equal(allowed('/catalogo.pdf', `${robots}\nUser-agent: implant-catalog-sync\nDisallow: /catalogo`), false)
})

test('consulta o robots.txt uma vez por origem e trata 4xx como liberado e 5xx como bloqueado', async () => {
  const requested: string[] = []
  const responses: Record<string, Response> = {
    'https://a.example/robots.txt': new Response('User-agent: *\nDisallow: /b', { status: 200 }),
    'https://b.example/robots.txt': new Response('', { status: 404 }),
    'https://c.example/robots.txt': new Response('', { status: 503 }),
  }
  const policy = createRobotsPolicy({
    timeoutMs: 1000,
    fetch: async (url) => {
      requested.push(url)
      const response = responses[url]
      if (!response) throw new Error(`inesperado: ${url}`)
      return response
    },
  })

  assert.equal(await policy(new URL('https://a.example/a.pdf')), true)
  assert.equal(await policy(new URL('https://a.example/b.pdf')), false)
  assert.equal(await policy(new URL('https://b.example/qualquer')), true)
  assert.equal(await policy(new URL('https://c.example/qualquer')), false)
  assert.deepEqual(requested, ['https://a.example/robots.txt', 'https://b.example/robots.txt', 'https://c.example/robots.txt'])
})
