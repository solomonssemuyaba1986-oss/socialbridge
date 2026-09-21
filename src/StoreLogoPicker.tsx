import { useRef, useState } from 'react'
import { avatarColor, initialOf } from './avatar'
import { uploadSquareImageToCloudinary } from './uploadImage'
import { trackEvent } from './analytics'

/**
 * "Give your shop a face" — the one control that sets a shop's logo.
 *
 * Shared by Setup Store (step 1, optional and never blocking) and Edit Store, so the two
 * can never drift apart — Edit Store used to hide this behind a raw `<input type="file">`
 * at the bottom of a long form, which is why phone-only sellers stayed faceless.
 *
 * Three things make this work where a bare file input did not:
 *  1. the preview is never empty — before any upload it is the shop name's initial on a
 *     colour derived from that name (see `avatar.ts`), so the seller sees *their* shop
 *     taking shape the moment they type the name;
 *  2. the upload happens on pick, in place, with its own progress and failure message —
 *     nothing is deferred to a Save button they may never reach;
 *  3. it never blocks: "Not required — you can add it later", and the form moves on
 *     without it.
 */

const SURFACE = { setup: 'setup_store', edit: 'edit_store' } as const

interface StoreLogoPickerProps {
  /** The shop name — the letter tile is drawn from it. */
  businessName: string
  /** The chosen logo URL ('' = nothing chosen). */
  value: string
  /** An account photo to show while nothing has been chosen (Google · Apple · Facebook). */
  fallbackUrl?: string
  /** Where this instance lives — carried on the `store_logo_added` event. */
  source: 'setup' | 'edit'
  onChange: (url: string) => void
  /** Edit Store already labels the field — drop the setup headline there. */
  compact?: boolean
}

function StoreLogoPicker({
  businessName,
  value,
  fallbackUrl = '',
  source,
  onChange,
  compact = false,
}: StoreLogoPickerProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const cameraRef = useRef<HTMLInputElement | null>(null)
  const galleryRef = useRef<HTMLInputElement | null>(null)

  const size = compact ? 56 : 64
  const shown = value || fallbackUrl
  const tile = avatarColor(businessName)
  /** The account brought a photo and the seller hasn't chosen one — say so instead of hiding it. */
  const fromAccount = !value && !!fallbackUrl

  const handleFile = async (file?: File | null) => {
    if (!file) return
    setError('')
    setUploading(true)
    try {
      const url = await uploadSquareImageToCloudinary(file)
      onChange(url)
      trackEvent('store_logo_added', { source, surface: SURFACE[source], failed: false })
    } catch (err) {
      console.error('Logo upload failed', err)
      setError('That photo did not upload. Check your connection and try again — you can also skip this.')
      trackEvent('store_logo_added', { source, surface: SURFACE[source], failed: true })
    } finally {
      setUploading(false)
      // Allow picking the same file again (the change event would otherwise stay silent).
      if (cameraRef.current) cameraRef.current.value = ''
      if (galleryRef.current) galleryRef.current.value = ''
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        {shown ? (
          <img
            src={shown}
            alt={`${businessName || 'Your shop'} logo`}
            style={{ width: size, height: size, minWidth: size, borderRadius: '50%', objectFit: 'cover', background: '#f5f5f5', display: 'block' }}
          />
        ) : (
          <div
            aria-hidden="true"
            style={{
              width: size, height: size, minWidth: size, borderRadius: '50%',
              background: tile.bg, color: tile.fg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: '800', fontSize: compact ? 22 : 26, lineHeight: 1,
            }}
          >
            {initialOf(businessName)}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: '13px', fontWeight: '700', color: '#333', margin: '0 0 8px', lineHeight: 1.4 }}>
            {fromAccount
              ? 'We used your account photo — change it to a shop photo if you like.'
              : 'Buyers see this next to your name.'}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={uploading}
              style={{ padding: '9px 14px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '13px', cursor: uploading ? 'not-allowed' : 'pointer' }}
            >
              📷 Take a photo
            </button>
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              disabled={uploading}
              style={{ padding: '9px 14px', background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: '8px', fontWeight: '700', fontSize: '13px', cursor: uploading ? 'not-allowed' : 'pointer' }}
            >
              🖼️ Choose photo
            </button>
            {value && !uploading && (
              <button
                type="button"
                onClick={() => { onChange(''); setError('') }}
                style={{ background: 'none', border: 'none', padding: 0, color: '#888', fontSize: '12px', textDecoration: 'underline', cursor: 'pointer' }}
              >
                Remove
              </button>
            )}
          </div>

          {uploading && <p style={{ fontSize: '12px', color: '#888', margin: '8px 0 0' }}>Uploading…</p>}
          {!uploading && error && <p style={{ fontSize: '12px', color: '#c33', margin: '8px 0 0', lineHeight: 1.5 }}>{error}</p>}
          {!uploading && !error && value && <p style={{ fontSize: '12px', color: '#4a4', margin: '8px 0 0' }}>✓ Looking good</p>}
          {!uploading && !error && !value && (
            <p style={{ fontSize: '12px', color: '#888', margin: '8px 0 0' }}>
              {source === 'setup'
                ? 'Not required — you can add it later in Edit Store.'
                : 'No photo yet — your shop shows this letter instead.'}
            </p>
          )}
        </div>
      </div>

      {/* Two inputs on purpose: `capture` opens the camera straight away on a phone,
          while the plain one lets a seller pick a photo they already have. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
        onChange={e => void handleFile(e.target.files && e.target.files[0])} />
      <input ref={galleryRef} type="file" accept="image/*" hidden
        onChange={e => void handleFile(e.target.files && e.target.files[0])} />
    </div>
  )
}

export default StoreLogoPicker

