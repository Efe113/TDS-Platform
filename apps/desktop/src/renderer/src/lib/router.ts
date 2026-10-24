import { useEffect, useState } from 'react'

export interface Route {
  path: string
  query: URLSearchParams
}

/** `#/discover?map=cradle&q=boss` - the query is part of the hash, so it survives reloads. */
export function currentRoute(): Route {
  const raw = window.location.hash.replace(/^#/, '')
  const mark = raw.indexOf('?')
  const pathname = mark === -1 ? raw : raw.slice(0, mark)
  const search = mark === -1 ? '' : raw.slice(mark + 1)
  return {
    path: pathname.startsWith('/') ? pathname : '/',
    query: new URLSearchParams(search)
  }
}

export function currentPath(): string {
  return currentRoute().path
}

/**
 * `replace` exists because filter changes should not fill the back stack one keystroke at a time,
 * while real navigation should stay undoable.
 */
export function navigate(path: string, query?: URLSearchParams, opts: { replace?: boolean } = {}): void {
  const next = path.startsWith('/') ? path : `/${path}`
  const hash = `#${next}${query && query.toString().length > 0 ? `?${query.toString()}` : ''}`
  if (window.location.hash === hash || (query === undefined && window.location.hash === `#${next}`)) return

  if (opts.replace) {
    const url = `${window.location.pathname}${window.location.search}${hash}`
    window.history.replaceState(null, '', url)
    // replaceState does not fire hashchange, so subscribers have to be told by hand.
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return
  }
  window.location.hash = hash
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute)
  useEffect(() => {
    const sync = () => setRoute(currentRoute())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  return route
}

export function useRoutePath(): string {
  return useRoute().path
}

export function routeSegments(path: string): string[] {
  return path.split('/').filter(Boolean)
}
