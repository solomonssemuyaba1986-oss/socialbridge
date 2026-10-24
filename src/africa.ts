/**
 * Where "phone-first" is the default, and where email is enough.
 *
 * A phone number is the strongest identity rachett can offer in the markets we are built for:
 * it receives the code, it anchors account recovery, it earns the real-seller badge, and it is
 * the number mobile money is attached to. Outside those markets an email-only account is a
 * perfectly good account, so the nine-day reminder must not follow somebody in London or Toronto.
 *
 * There is no reliable server-side "where is this person" for a Google-only account. The best
 * honest signals the browser has are:
 *   - a verified phone number, when there is one (its dial code is exact);
 *   - the device's IANA time zone (`Africa/Kampala`);
 *   - the browser locale's region (`en-UG`).
 *
 * Pure, so `_account_strength_check.cjs` can prove the geography without a browser.
 */

/** Every African country calling code, normalised to digits by `digitsOf`. */
export const AFRICAN_DIAL_CODES = [
  '+20',  // Egypt
  '+27',  // South Africa
  '+211', // South Sudan
  '+212', // Morocco
  '+213', // Algeria
  '+216', // Tunisia
  '+218', // Libya
  '+220', // Gambia
  '+221', // Senegal
  '+222', // Mauritania
  '+223', // Mali
  '+224', // Guinea
  '+225', // Côte d'Ivoire
  '+226', // Burkina Faso
  '+227', // Niger
  '+228', // Togo
  '+229', // Benin
  '+230', // Mauritius
  '+231', // Liberia
  '+232', // Sierra Leone
  '+233', // Ghana
  '+234', // Nigeria
  '+235', // Chad
  '+236', // Central African Republic
  '+237', // Cameroon
  '+238', // Cabo Verde
  '+239', // São Tomé and Príncipe
  '+240', // Equatorial Guinea
  '+241', // Gabon
  '+242', // Congo
  '+243', // DR Congo
  '+244', // Angola
  '+245', // Guinea-Bissau
  '+246', // British Indian Ocean Territory
  '+247', // Ascension Island
  '+248', // Seychelles
  '+249', // Sudan
  '+250', // Rwanda
  '+251', // Ethiopia
  '+252', // Somalia
  '+253', // Djibouti
  '+254', // Kenya
  '+255', // Tanzania
  '+256', // Uganda
  '+257', // Burundi
  '+258', // Mozambique
  '+260', // Zambia
  '+261', // Madagascar
  '+262', // Réunion / Mayotte
  '+263', // Zimbabwe
  '+264', // Namibia
  '+265', // Malawi
  '+266', // Lesotho
  '+267', // Botswana
  '+268', // Eswatini
  '+269', // Comoros
  '+290', // Saint Helena
  '+291', // Eritrea
] as const

/** ISO regions that are African, used when the browser's locale carries a region. */
export const AFRICAN_REGIONS = new Set([
  'AO', 'BF', 'BI', 'BJ', 'BW', 'CD', 'CF', 'CG', 'CI', 'CM', 'CV', 'DJ', 'DZ', 'EG', 'EH',
  'ER', 'ET', 'GA', 'GH', 'GM', 'GN', 'GQ', 'GW', 'KE', 'KM', 'LR', 'LS', 'LY', 'MA', 'MG',
  'ML', 'MR', 'MU', 'MW', 'MZ', 'NA', 'NE', 'NG', 'RE', 'RW', 'SC', 'SD', 'SH', 'SL', 'SN',
  'SO', 'SS', 'ST', 'SZ', 'TD', 'TG', 'TN', 'TZ', 'UG', 'YT', 'ZA', 'ZM', 'ZW',
])

/**
 * IANA zones that sit on the continent but not under `Africa/` — the Indian Ocean islands and
 * the Atlantic islands. `Africa/` covers the rest.
 */
const AFRICAN_TIME_ZONES = new Set([
  'Atlantic/Cape_Verde',
  'Atlantic/St_Helena',
  'Indian/Antananarivo',
  'Indian/Comoros',
  'Indian/Mayotte',
  'Indian/Reunion',
  'Indian/Mauritius',
])

function digitsOf(value: string): string {
  return String(value || '').replace(/\D/g, '')
}

/** The African dial code a full E.164 number starts with, or '' when it starts with none. */
export function africanDialCodeFor(phone: string): string {
  const digits = digitsOf(phone)
  if (!digits) return ''
  let found = ''
  for (const dial of AFRICAN_DIAL_CODES) {
    const country = digitsOf(dial)
    if (country && digits.startsWith(country) && country.length > found.length) found = dial
  }
  return found
}

/** Is this a full international number from an African country? */
export function isAfricanPhone(phone: string | null | undefined): boolean {
  return Boolean(africanDialCodeFor(String(phone || '')))
}

/** The region part of `en-UG`, `en_UG` or `zh-Hant-TW`, uppercased; '' when there is none. */
export function localeRegion(locale: string | null | undefined): string {
  const parts = String(locale || '').replace(/_/g, '-').split('-').filter(Boolean)
  const last = parts[parts.length - 1] || ''
  return /^[a-z]{2}$/i.test(last) ? last.toUpperCase() : ''
}

export function isAfricanLocale(locale: string | null | undefined): boolean {
  return AFRICAN_REGIONS.has(localeRegion(locale))
}

export function isAfricanTimeZone(timeZone: string | null | undefined): boolean {
  const zone = String(timeZone || '').trim()
  return zone.startsWith('Africa/') || AFRICAN_TIME_ZONES.has(zone)
}

/**
 * Is this account in the phone-first part of the world?
 *
 * A verified number answers exactly. Without one, the device's zone/locale is the most honest
 * signal available; when neither is African, we treat the account as outside the reminder area.
 * That errs on the side of silence, which is the right error for a nag.
 */
export function isAfricanAccount(input: {
  phoneNumber?: string | null
  timeZone?: string | null
  language?: string | null
}): boolean {
  if (input.phoneNumber) return isAfricanPhone(input.phoneNumber)
  return isAfricanTimeZone(input.timeZone) || isAfricanLocale(input.language)
}
