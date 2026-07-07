// Build-time flags for the static (GitHub Pages) build. NEXT_PUBLIC_* vars are
// inlined by Next at build time, so these are constants in the bundle.
export const IS_STATIC = process.env.NEXT_PUBLIC_STATIC === '1';
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const LOCAL_STORAGE_KEY = 'vinyl-influence-graph';

/** Prefix root-relative asset paths (e.g. "/covers/x.jpg") with the base path. */
export function asset(path: string): string {
  return path.startsWith('/') ? BASE_PATH + path : path;
}
