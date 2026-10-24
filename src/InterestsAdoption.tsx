import { useInterests } from './useInterests'

/**
 * The silent half of the optional interests ask.
 *
 * A guest can answer on the onboarding screen and then sign in much later — at checkout, in the
 * Inbox, anywhere that has nothing to do with onboarding. Mounted once in `App`, this keeps
 * `useInterests` alive at that moment so the device answer is adopted onto the new account instead
 * of sitting on the phone forever.
 *
 * It renders nothing and gates nothing: interests are optional, so there is no wall here, only the
 * same one-time adoption the name and age answers get.
 */
export default function InterestsAdoption() {
  useInterests()
  return null
}
