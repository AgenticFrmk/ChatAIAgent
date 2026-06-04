const SERVICES = [
  { name: 'ChatAIAgent',      url: process.env.E2E_BASE_URL      ?? 'http://localhost:3001' },
  { name: 'RegistryService',  url: process.env.E2E_REGISTRY_URL  ?? 'http://localhost:8001/health' },
  { name: 'AuthService',      url: process.env.E2E_AUTH_URL      ?? 'http://localhost:9000/health' },
  { name: 'SLMPlatform',      url: (process.env.E2E_SLM_URL      ?? 'http://localhost:8002') + '/health' },
]

const TIMEOUT_MS = parseInt(process.env.E2E_TIMEOUT_MS ?? '60000', 10)
const INTERVAL_MS = 2000

async function waitFor(name: string, url: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status < 500) {
        console.log(`[e2e] ${name} ready at ${url}`)
        return
      }
    } catch (err) {
      lastError = err
    }
    await new Promise(r => setTimeout(r, INTERVAL_MS))
  }
  throw new Error(`${name} not ready after ${TIMEOUT_MS / 1000}s at ${url}\n${lastError}`)
}

export default async function globalSetup(): Promise<void> {
  await Promise.all(SERVICES.map(s => waitFor(s.name, s.url)))
}
