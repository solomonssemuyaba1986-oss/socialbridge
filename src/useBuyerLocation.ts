import { useCallback, useEffect, useRef, useState } from 'react'
import { notify } from './notifications'
import { haversineKm } from './geo'
import {
  clearBuyerArea,
  geocodeArea,
  getSavedBuyerArea,
  reverseGeocode,
  saveBuyerArea,
  type BuyerArea,
} from './place'

export type BuyerLocationStatus = 'idle' | 'locating' | 'ready'

interface GeolocationPermissionApi {
  query: (descriptor: { name: string }) => Promise<{ state: string }>
}

/** The Permissions API isn't everywhere (older Safari), so treat unknown as "not granted". */
async function isGeolocationGranted(): Promise<boolean> {
  try {
    const perms = (navigator as unknown as { permissions?: GeolocationPermissionApi }).permissions
    if (!perms || typeof perms.query !== 'function') return false
    const status = await perms.query({ name: 'geolocation' })
    return status?.state === 'granted'
  } catch {
    return false
  }
}

/**
 * The buyer's rough area, used to answer "how far is this seller?".
 *
 * 1. Restores the area they used last time — kept on their device, never in the database.
 * 2. If they already granted location permission, refreshes silently: no tap, no prompt.
 * 3. Otherwise it stays quiet until they tap "Use my location" or type an area.
 */
export function useBuyerLocation() {
  const [area, setAreaState] = useState<BuyerArea | null>(() => getSavedBuyerArea())
  const [status, setStatus] = useState<BuyerLocationStatus>(() =>
    getSavedBuyerArea() ? 'ready' : 'idle',
  )
  const [error, setError] = useState('')
  const cancelledRef = useRef(false)
  // The area known at mount — lets a silent refresh skip re-geocoding when the
  // buyer hasn't actually moved neighbourhoods.
  const savedRef = useRef<BuyerArea | null>(area)

  useEffect(() => {
    cancelledRef.current = false
    const saved = savedRef.current

    const refreshSilently = async () => {
      if (!navigator.geolocation) return
      const granted = await isGeolocationGranted()
      if (!granted || cancelledRef.current) return
      if (!saved) setStatus('locating')
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelledRef.current) return
          const point = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          // Still in the same neighbourhood as last time? Keep the label we already
          // have — saves a geocoding round-trip on every page visit.
          if (saved && haversineKm(saved.lat, saved.lng, point.lat, point.lng) < 2) {
            const same: BuyerArea = { ...saved, lat: point.lat, lng: point.lng, source: 'gps' }
            setAreaState(same)
            saveBuyerArea(same)
            setStatus('ready')
            return
          }
          const hit = await reverseGeocode(point)
          if (cancelledRef.current) return
          const next: BuyerArea = {
            ...point,
            place: hit?.place || null,
            label: hit?.label || '',
            source: 'gps',
          }
          setAreaState(next)
          saveBuyerArea(next)
          setStatus('ready')
        },
        () => {
          if (!cancelledRef.current) setStatus(saved ? 'ready' : 'idle')
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
      )
    }
    refreshSilently()

    return () => {
      cancelledRef.current = true
    }
  }, [])

  /** One tap → GPS → "Kampala, Nakawa". */
  const detect = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser. Type your area instead.')
      return
    }
    setStatus('locating')
    setError('')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        const hit = await reverseGeocode(point)
        const next: BuyerArea = {
          ...point,
          place: hit?.place || null,
          label: hit?.label || '',
          source: 'gps',
        }
        setAreaState(next)
        saveBuyerArea(next)
        setStatus('ready')
      },
      (err) => {
        setStatus(area ? 'ready' : 'idle')
        setError(err.code === 1 ? notify.geolocationDenied : notify.geolocationUnavailable)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    )
  }, [area])

  /** Type an area instead — "Kampala, Uganda". */
  const setManualArea = useCallback(
    async (text: string) => {
      const q = text.trim()
      if (!q) {
        setError('Enter a city or area first.')
        return
      }
      setStatus('locating')
      setError('')
      const hit = await geocodeArea(q)
      if (!hit) {
        setStatus(area ? 'ready' : 'idle')
        setError('Could not find that place. Try "Kampala, Uganda".')
        return
      }
      const next: BuyerArea = {
        lat: hit.point.lat,
        lng: hit.point.lng,
        place: hit.place,
        label: hit.label || q,
        source: 'manual',
      }
      setAreaState(next)
      saveBuyerArea(next)
      setStatus('ready')
    },
    [area],
  )

  const clear = useCallback(() => {
    clearBuyerArea()
    setAreaState(null)
    setStatus('idle')
    setError('')
  }, [])

  return {
    area,
    label: area?.label || '',
    place: area?.place || null,
    status,
    error,
    detect,
    setManualArea,
    clear,
  }
}
