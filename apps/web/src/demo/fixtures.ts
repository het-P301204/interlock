/**
 * Lazy access to the synthetic fixture files in /fixtures (repo root), keyed
 * by their path relative to /fixtures (e.g. "l5x/baseline-safe.L5X").
 * import.meta.glob resolves at build time; a missing fixture is simply absent
 * from the map, so the UI can say so instead of failing the build. Fixture
 * text is fetched on demand as a same-origin chunk.
 */
const FILES = import.meta.glob<string>(['../../../../fixtures/l5x/*.{L5X,l5x}', '../../../../fixtures/manifests/*.json'], {
  query: '?raw',
  import: 'default',
})

const PREFIX = '../../../../fixtures/'
const byPath = new Map<string, () => Promise<string>>()
for (const [path, load] of Object.entries(FILES)) byPath.set(path.startsWith(PREFIX) ? path.slice(PREFIX.length) : path, load)

export function hasFixture(path: string): boolean {
  return byPath.has(path)
}

export async function loadFixtureText(path: string): Promise<string> {
  const load = byPath.get(path)
  if (!load) throw new Error(`Fixture ${path} is not part of this build.`)
  return load()
}

export async function loadFixtureFile(path: string): Promise<File> {
  const text = await loadFixtureText(path)
  return new File([text], path.slice(path.lastIndexOf('/') + 1), { type: 'application/xml' })
}

export const hasManifest = hasFixture
export const loadManifestText = loadFixtureText
