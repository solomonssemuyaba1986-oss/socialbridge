/**
 * Location helpers — turns coordinates into human place names ("Kampala, Nakawa")
 * and turns a typed area ("Mukono") into coordinates.
 *
 * Powered by OpenStreetMap's Nominatim — free, no API key, no billing.
 * Nominatim's usage policy asks for max ~1 request/second, so we only call it
 * when a value is actually missing (never in a loop).
 *
 * Used by:
 *  - SetupStore / EditStore → saves `place` + `geo` + `geoSource` for every seller
 *  - NearbyPage / useBuyerLocation → buyer area label + "1.2 km away" distances
 */

export interface GeoPoint {
  lat: number
  lng: number
}

/** Structured place, kept separate from the free-text `location` string. */
export interface Place {
  city: string
  area: string
  region: string
  country: string
}

/** Where the coordinates came from — 'gps' is a real pin, 'area' is a whole town. */
export type GeoSource = 'gps' | 'area'

const NOMINATIM = 'https://nominatim.openstreetmap.org'

// ─── Parsing ────────────────────────────────────────────────────────────────

/**
 * Pull a "city, area" pair out of Nominatim's `address` object.
 * `area` is the neighbourhood/division (e.g. Nakawa) — the bit Jiji-style
 * listings show next to the city. We keep the first one that exists.
 */
export function parseAddress(
  address: Record<string, string | undefined> | null | undefined,
  displayName = '',
): Place {
  const a = address || {}
  const area =
    a.suburb || a.city_district || a.neighbourhood || a.quarter || a.village || a.hamlet || ''
  const city =
    a.city || a.town || a.municipality || a.county || a.state_district || a.state || ''
  const region = a.state || a.region || ''
  const country = a.country || ''

  if (!city && !area && displayName) {
    return { city: displayName.split(',')[0]?.trim() || '', area: '', region, country }
  }
  return { city, area, region, country }
}

/** "Kampala, Nakawa" — the short label shown on cards. */
export function placeLabel(place?: Place | null): string {
  if (!place) return ''
  const { city, area } = place
  if (city && area && area.toLowerCase() !== city.toLowerCase()) return `${city}, ${area}`
  return city || area || ''
}

/** "Kampala, Nakawa, Uganda" — the long label, e.g. for the store page. */
export function fullPlaceLabel(place?: Place | null): string {
  if (!place) return ''
  return [place.city, place.area, place.country].filter(Boolean).join(', ')
}

// ─── Geocoding ──────────────────────────────────────────────────────────────

/** Coordinates → place ("Kampala, Nakawa"). */
export async function reverseGeocode(
  point: GeoPoint,
): Promise<{ place: Place; label: string } | null> {
  try {
    const res = await fetch(`${NOMINATIM}/reverse?format=json&lat=${point.lat}&lon=${point.lng}`)
    if (!res.ok) return null
    const data = await res.json()
    if (!data || !data.display_name) return null
    const place = parseAddress(data.address, data.display_name)
    const fallback = String(data.display_name).split(',')[0]?.trim() || ''
    return { place, label: placeLabel(place) || fallback }
  } catch {
    return null
  }
}

/** "Mukono" → coordinates + place. This is what makes typed sellers show up on Nearby. */
export async function geocodeArea(
  text: string,
): Promise<{ point: GeoPoint; place: Place; label: string } | null> {
  const q = text.trim()
  if (!q) return null
  try {
    const res = await fetch(
      `${NOMINATIM}/search?format=json&q=${encodeURIComponent(q)}&limit=1&addressdetails=1`,
    )
    if (!res.ok) return null
    const data = await res.json()
    const hit = Array.isArray(data) ? data[0] : null
    if (!hit) return null
    const point = { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) }
    if (!isFinite(point.lat) || !isFinite(point.lng)) return null
    const place = parseAddress(hit.address, hit.display_name || '')
    return { point, place, label: placeLabel(place) || q }
  } catch {
    return null
  }
}

/**
 * Best-effort fill-in before a seller's store is saved. Only geocodes when we
 * must — a seller who never tapped "Detect" but typed "Mukono" gets real
 * coordinates, so they stop being invisible on Nearby.
 */
export async function resolveSellerLocation(opts: {
  locationText: string
  geo: GeoPoint | null
  place: Place | null
  geoSource: GeoSource | null
}): Promise<{ geo: GeoPoint | null; place: Place | null; geoSource: GeoSource | null; label: string }> {
  const text = opts.locationText.trim()

  // Already has coordinates — only fill in a missing structured place name.
  if (opts.geo) {
    const place = opts.place || (await reverseGeocode(opts.geo))?.place || null
    return {
      geo: opts.geo,
      place,
      geoSource: opts.geoSource || 'gps',
      label: placeLabel(place) || text,
    }
  }

  // No coordinates at all → geocode the typed area so the store can appear on Nearby.
  if (!text) return { geo: null, place: null, geoSource: null, label: '' }
  const hit = await geocodeArea(text)
  if (!hit) return { geo: null, place: null, geoSource: null, label: text }
  return { geo: hit.point, place: hit.place, geoSource: 'area', label: hit.label || text }
}

// ─── Distance ───────────────────────────────────────────────────────────────

/**
 * "350 m" / "1.2 km" / "24 km".
 * When the seller's point is only a town (not a GPS pin) we mark it approximate,
 * e.g. "≈ 3 km (area)" — so we never state a precision we don't have.
 */
export function formatDistance(km: number, opts: { approximate?: boolean } = {}): string {
  if (!isFinite(km) || km < 0) return ''
  let value: string
  if (km < 1) value = `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`
  else if (km < 10) value = `${km.toFixed(1)} km`
  else value = `${Math.round(km)} km`
  return opts.approximate ? `≈ ${value} (area)` : value
}

/** True when the seller's point came from a typed area rather than a GPS pin. */
export function isApproximatePin(geoSource?: GeoSource | null): boolean {
  return geoSource !== 'gps'
}

// ─── Buyer area memory (kept on the buyer's device only — never in the database) ──

const BUYER_AREA_KEY = 'rachett_buyer_area'

export interface BuyerArea {
  lat: number
  lng: number
  place: Place | null
  label: string
  source: GeoSource | 'manual'
}

export function getSavedBuyerArea(): BuyerArea | null {
  try {
    const raw = localStorage.getItem(BUYER_AREA_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BuyerArea
    if (typeof parsed?.lat !== 'number' || typeof parsed?.lng !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

export function saveBuyerArea(area: BuyerArea): void {
  try {
    localStorage.setItem(BUYER_AREA_KEY, JSON.stringify(area))
  } catch {
    // ignore storage errors
  }
}

export function clearBuyerArea(): void {
  try {
    localStorage.removeItem(BUYER_AREA_KEY)
  } catch {
    // ignore storage errors
  }
}
