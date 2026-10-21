import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertAllowedUrl, createDownloader, DownloadError, type DownloadRequest, type FetchFunction } from '../src/http/download.js'

const request: DownloadRequest = {
  url: 'https://dados.example/arquivo.csv',
  allowedHosts: ['dados.example'],
  contentTypes: ['text/csv'],
  etag: '"abc"',
  lastModified: null,
}

function downloader(fetch: FetchFunction, maxBytes = 1024) {
  return createDownloader({ timeoutMs: 1000, maxBytes, attempts: 3, fetch, sleep: async () => {} })
}

test('aceita apenas HTTPS em host permitido, sem credenciais nem porta alternativa', () => {
  assert.equal(assertAllowedUrl('https://dados.example/a.csv', ['dados.example']).hostname, 'dados.example')
  for (const url of [
    'http://dados.example/a.csv',
    'https://outro.example/a.csv',
    'https://user:pass@dados.example/a.csv',
    'https://dados.example:8443/a.csv',
    'https://169.254.169.254/latest/meta-data',
  ]) {
    assert.throws(() => assertAllowedUrl(url, ['dados.example']), DownloadError, url)
  }
})

test('envia cabeçalhos condicionais e devolve not-modified em 304', async () => {
  let headers = new Headers()
  const result = await downloader(async (_url, init) => {
    headers = new Headers(init.headers)
    return new Response(null, { status: 304 })
  })(request)
  assert.deepEqual(result, { status: 'not-modified' })
  assert.equal(headers.get('if-none-match'), '"abc"')
})

test('recusa redirecionamento para host fora da lista', async () => {
  const download = downloader(async () => new Response(null, { status: 302, headers: { location: 'https://interno.local/x' } }))
  await assert.rejects(download(request), /Host fora da lista/)
})

test('repete em erro 5xx e desiste em erro 4xx', async () => {
  let calls = 0
  const flaky = downloader(async () => {
    calls += 1
    return calls < 3
      ? new Response('erro', { status: 503 })
      : new Response('a;b', { status: 200, headers: { 'content-type': 'text/csv; charset=ISO-8859-1' } })
  })
  const result = await flaky(request)
  assert.equal(result.status, 'downloaded')
  assert.equal(calls, 3)

  calls = 0
  const notFound = downloader(async () => {
    calls += 1
    return new Response('nada', { status: 404 })
  })
  await assert.rejects(notFound(request), /HTTP 404/)
  assert.equal(calls, 1)
})

test('recusa Content-Type inesperado e corpo acima do limite', async () => {
  const html = downloader(async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }))
  await assert.rejects(html(request), /Content-Type não aceito/)

  const big = downloader(
    async () => new Response('x'.repeat(2048), { status: 200, headers: { 'content-type': 'text/csv' } }),
    1024,
  )
  await assert.rejects(big(request), /excede o limite/)
})
