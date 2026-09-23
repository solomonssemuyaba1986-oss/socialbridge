/**
 * The big "getting everything ready" banner is worth showing **once**, when the app genuinely has
 * nothing to draw yet. After that, flashing the whole screen every time somebody opens a page or
 * comes back from a store reads as the app being slow — even when it is working.
 *
 * Remembered per browser tab (`sessionStorage`), so a reload in the same tab doesn't bring the
 * banner back either, while a genuinely fresh visit still gets it.
 */
const KEY = 'rachett_full_loader_shown'

export function hasShownFullLoader(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    // Private mode / storage disabled: treat it as "already shown" rather than flashing a banner.
    return true
  }
}

export function markFullLoaderShown() {
  try {
    sessionStorage.setItem(KEY, '1')
  } catch {
    // ignore
  }
}
