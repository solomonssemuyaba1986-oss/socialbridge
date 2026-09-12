/**
 * One-off: give existing stores real coordinates so they show up on Nearby.
 *
 *   cd functions
 *   node backfill-locations.js            # dry run — prints what would change
 *   node backfill-locations.js --write    # saves the changes
 *
 * Credentials: point GOOGLE_APPLICATION_CREDENTIALS at a service-account JSON,
 * or run `firebase login` first so application default credentials are used.
 *
 * Geocoding is OpenStreetMap Nominatim (free, no key). Their usage policy allows
 * roughly one request per second, so the calls are paced — budget about a minute
 * per 60 stores.
 */
const admin = require('firebase-admin')

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'socialbridge-93ee1'
const WRITE = process.argv.includes('--write')
const NOMINATIM = 'https://nominatim.openstreetmap.org'
const USER_AGENT = 'rachett-location-backfill/1.0'

admin.initializeApp({ projectId: PROJECT_ID })
const db = admin.firestore()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const clean = (value) => (typeof value === 'string' ? value.trim() : '')

function parsePlace(address, displayName = '') {
  const a = address || {}
  const area =
    a.suburb || a.city_district || a.neighbourhood || a.quarter || a.village || a.hamlet || ''
  const city =
    a.city || a.town || a.municipality || a.county || a.state_district || a.state || ''
  const country = a.country || ''

  if (!city && !area && displayName) {
    return { city: displayName.split(',')[0].trim(), area: '', region: '', country }
  }
  return { city, area, region: a.state || a.region || '', country }
}

function placeLabel(place) {
  if (!place) return ''
  const { city, area } = place
  if (city && area && area.toLowerCase() !== city.toLowerCase()) return `${city}, ${area}`
  return city || area || ''
}

async function nominatim(path) {
  const res = await fetch(`${NOMINATIM}${path}`, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`Nominatim responded ${res.status}`)
  return res.json()
}

async function reverseGeocode(lat, lng) {
  const data = await nominatim(`/reverse?format=json&lat=${lat}&lon=${lng}`)
  if (!data || !data.display_name) return null
  const place = parsePlace(data.address, data.display_name)
  return { place, label: placeLabel(place) || String(data.display_name).split(',')[0].trim() }
}

async function geocodeArea(text) {
  const data = await nominatim(
    `/search?format=json&q=${encodeURIComponent(text)}&limit=1&addressdetails=1`,
  )
  const hit = Array.isArray(data) ? data[0] : null
  if (!hit) return null
  const point = { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) }
  if (!isFinite(point.lat) || !isFinite(point.lng)) return null
  const place = parsePlace(hit.address, hit.display_name || '')
  return { point, place, label: placeLabel(place) || text }
}

async function main() {
  const snap = await db.collection('sellers').get()
  console.log(
    `${snap.size} stores found. ${WRITE ? 'WRITING changes.' : 'DRY RUN — nothing will be written.'}`,
  )

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {}
    const name = data.businessName || docSnap.id
    const locationText = clean(data.location)

    try {
      let update = null

      if (data.geo && !data.place) {
        // Already has coordinates, just missing the "Kampala, Nakawa" label.
        const hit = await reverseGeocode(data.geo.lat, data.geo.lng)
        await sleep(1100)
        if (hit) {
          update = {
            place: hit.place,
            location: placeLabel(hit.place) || locationText,
            geoSource: data.geoSource || 'gps',
          }
        }
      } else if (!data.geo && locationText) {
        // Typed an area but never dropped a pin — this is the common case.
        const hit = await geocodeArea(locationText)
        await sleep(1100)
        if (hit) {
          update = {
            geo: hit.point,
            place: hit.place,
            geoSource: 'area',
            location: hit.label || locationText,
          }
        }
      }

      if (!update) {
        skipped++
        continue
      }

      const coords = update.geo ? ` [${update.geo.lat.toFixed(4)}, ${update.geo.lng.toFixed(4)}]` : ''
      console.log(`${WRITE ? '→' : '·'} ${name}: "${locationText}" → ${update.location}${coords}`)
      if (WRITE) await docSnap.ref.update(update)
      updated++
    } catch (err) {
      failed++
      console.warn(`! ${name}: ${err.message}`)
    }
  }

  console.log(
    `\nDone. ${updated} ${WRITE ? 'updated' : 'would be updated'}, ${skipped} skipped, ${failed} failed.`,
  )
  if (!WRITE) console.log('Re-run with --write to save these changes.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
