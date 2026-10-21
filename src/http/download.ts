export type FetchFunction = (url: string, init: RequestInit) => Promise<Response>

export type DownloadRequest = {
  url: string
  allowedHosts: readonly string[]
  contentTypes: readonly string[]
  etag: string | null
  lastModified: string | null
}

export type Downloaded = {
  status: 'downloaded'
  url: string
  body: Buffer
  etag: string | null
  lastModified: string | null
  contentType: string | null
}

export type DownloadResult = { status: 'not-modified' } | Downloaded

export type Downloader = (request: DownloadRequest) => Promise<DownloadResult>

export type DownloaderOptions = {
  timeoutMs: number
  maxBytes: number
  attempts: number
  fetch?: FetchFunction
  sleep?: (ms: number) => Promise<void>
}

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'DownloadError'
  }
}

const maxRedirects = 3

export function assertAllowedUrl(raw: string, allowedHosts: readonly string[]): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new DownloadError(`URL inválida: ${raw}`, false)
  }
  if (url.protocol !== 'https:') throw new DownloadError(`Somente HTTPS é permitido: ${url.origin}`, false)
  if (url.username !== '' || url.password !== '') throw new DownloadError('URL com credenciais não é permitida.', false)
  if (url.port !== '' && url.port !== '443') throw new DownloadError(`Porta não permitida: ${url.port}`, false)
  if (!allowedHosts.includes(url.hostname)) throw new DownloadError(`Host fora da lista permitida: ${url.hostname}`, false)
  return url
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new DownloadError(`Resposta de ${declared} bytes excede o limite de ${maxBytes}.`, false)
  }
  if (response.body === null) return Buffer.alloc(0)

  const chunks: Uint8Array[] = []
  let total = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new DownloadError(`Resposta excede o limite de ${maxBytes} bytes.`, false)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

function mediaType(contentType: string | null): string | null {
  return contentType?.split(';')[0]?.trim().toLowerCase() ?? null
}

async function attempt(request: DownloadRequest, options: Required<DownloaderOptions>): Promise<DownloadResult> {
  const headers: Record<string, string> = { 'user-agent': 'implant-catalog-sync/0.1 (+https://github.com/Orthoflow-Tecnologia/Implant-Catalog-Sync)' }
  if (request.etag) headers['if-none-match'] = request.etag
  if (request.lastModified) headers['if-modified-since'] = request.lastModified

  let url = assertAllowedUrl(request.url, request.allowedHosts)
  for (let redirects = 0; ; redirects += 1) {
    let response: Response
    try {
      response = await options.fetch(url.href, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs),
      })
    } catch (error) {
      throw new DownloadError(`Falha de rede em ${url.hostname}: ${error instanceof Error ? error.message : String(error)}`, true)
    }

    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const location = response.headers.get('location')
      if (location === null || redirects >= maxRedirects) {
        throw new DownloadError(`Redirecionamento inválido a partir de ${url.hostname}.`, false)
      }
      url = assertAllowedUrl(new URL(location, url).href, request.allowedHosts)
      continue
    }
    if (response.status === 304) return { status: 'not-modified' }
    if (response.status === 429 || response.status >= 500) {
      throw new DownloadError(`HTTP ${response.status} em ${url.hostname}.`, true)
    }
    if (response.status !== 200) throw new DownloadError(`HTTP ${response.status} em ${url.hostname}.`, false)

    const contentType = response.headers.get('content-type')
    const type = mediaType(contentType)
    if (type === null || !request.contentTypes.includes(type)) {
      throw new DownloadError(`Content-Type não aceito: ${contentType ?? 'ausente'}.`, false)
    }

    return {
      status: 'downloaded',
      url: url.href,
      body: await readLimited(response, options.maxBytes),
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      contentType,
    }
  }
}

export function createDownloader(options: DownloaderOptions): Downloader {
  const resolved: Required<DownloaderOptions> = {
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...options,
  }
  return async (request) => {
    for (let tries = 1; ; tries += 1) {
      try {
        return await attempt(request, resolved)
      } catch (error) {
        if (!(error instanceof DownloadError) || !error.retryable || tries >= resolved.attempts) throw error
        await resolved.sleep(1000 * 2 ** (tries - 1) + Math.floor(Math.random() * 250))
      }
    }
  }
}
