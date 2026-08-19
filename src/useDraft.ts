import { useEffect, useState } from 'react'

const PREFIX = 'rachett_draft_'

/** Read a saved draft (used by overviews to show "Draft" status without opening the chat). */
export function getDraft(key: string): string {
  try {
    return localStorage.getItem(PREFIX + key) || ''
  } catch {
    return ''
  }
}

/**
 * Auto-saving draft messages. Whatever you type is saved silently to
 * localStorage and restored when you come back — nothing gets lost.
 * Send (or clear) removes the draft.
 */
export function useDraft(key: string) {
  const storageKey = PREFIX + key

  const load = (k: string): string => {
    try {
      return localStorage.getItem(k) || ''
    } catch {
      return ''
    }
  }

  const [text, setText] = useState<string>(() => load(storageKey))
  const [currentKey, setCurrentKey] = useState(storageKey)

  // If the key changes (switching conversations/products), reload that draft
  if (currentKey !== storageKey) {
    setCurrentKey(storageKey)
    setText(load(storageKey))
  }

  const save = (value: string) => {
    try {
      if (value.trim()) {
        localStorage.setItem(currentKey, value)
      } else {
        localStorage.removeItem(currentKey)
      }
      window.dispatchEvent(new CustomEvent('rachett:draftchange'))
    } catch {
      // storage unavailable — ignore
    }
  }

  useEffect(() => {
    const t = setTimeout(() => save(text), 500)
    return () => {
      clearTimeout(t)
      save(text) // flush on unmount so a quick exit never loses the draft
    }
  }, [text, currentKey])

  const clearDraft = () => {
    setText('')
    save('')
  }

  const draft = text.trim().length > 0

  return { text, setText, draft, clearDraft }
}
