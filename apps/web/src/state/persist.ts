/**
 * Local persistence. Analysis results and history live in this browser's
 * IndexedDB (via idb-keyval); small UI preferences live in localStorage.
 * Every call is wrapped: private windows, blocked storage or quota errors
 * must never break the app, they only mean nothing is remembered.
 */
import { clear, createStore, del, get, set } from 'idb-keyval'
import type { UseStore } from 'idb-keyval'

let store: UseStore | null | undefined

function idb(): UseStore | null {
  if (store !== undefined) return store
  try {
    store = typeof indexedDB === 'undefined' ? null : createStore('interlock', 'workspace')
  } catch {
    store = null
  }
  return store
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const s = idb()
  if (!s) return undefined
  try {
    return await get<T>(key, s)
  } catch {
    return undefined
  }
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  const s = idb()
  if (!s) return false
  try {
    await set(key, value, s)
    return true
  } catch {
    return false
  }
}

export async function idbDel(key: string): Promise<void> {
  const s = idb()
  if (!s) return
  try {
    await del(key, s)
  } catch {
    /* nothing stored */
  }
}

export async function idbClear(): Promise<boolean> {
  const s = idb()
  if (!s) return false
  try {
    await clear(s)
    return true
  } catch {
    return false
  }
}

/** Probes whether IndexedDB actually accepts writes here. */
export async function idbAvailable(): Promise<boolean> {
  const ok = await idbSet('interlock.probe', 1)
  if (ok) await idbDel('interlock.probe')
  return ok
}

export function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function lsSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* storage unavailable */
  }
}

export function lsRemove(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* storage unavailable */
  }
}
