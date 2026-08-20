import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './firebase'

/**
 * Shared realtime seller overview — the single source of truth for the live
 * badges shown in the Inbox shortcut row and every seller page's navigation.
 * One set of listeners feeds all surfaces, so numbers stay perfectly in sync
 * (e.g. confirm an order on /orders and every "Orders" badge drops together).
 */
export interface SellerLiveValue {
  isSeller: boolean
  /** Strictly pending orders (status missing or 'pending'). */
  pendingOrdersCount: number
  productsCount: number
  unreadMessages: number
  unreadSellerConvo: number
  unreadBuyerConvo: number
}

const SellerLiveContext = createContext<SellerLiveValue | null>(null)

export function SellerLiveProvider({ children }: { children: ReactNode }) {
  const [isSeller, setIsSeller] = useState(false)
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0)
  const [productsCount, setProductsCount] = useState(0)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [unreadSellerConvo, setUnreadSellerConvo] = useState(0)
  const [unreadBuyerConvo, setUnreadBuyerConvo] = useState(0)

  useEffect(() => {
    let unsubs: Array<() => void> = []

    const authUnsub = onAuthStateChanged(auth, (user) => {
      unsubs.forEach(u => { try { u() } catch { /* noop */ } })
      unsubs = []

      if (!user) {
        setIsSeller(false)
        setPendingOrdersCount(0)
        setProductsCount(0)
        setUnreadMessages(0)
        setUnreadSellerConvo(0)
        setUnreadBuyerConvo(0)
        return
      }
      const uid = user.uid

      // Seller existence (drives isSeller gating in the Inbox)
      const sellerUnsub = onSnapshot(doc(db, 'sellers', uid), snap => {
        setIsSeller(snap.exists())
      }, err => console.warn('sellerLive: seller doc', err))
      unsubs.push(sellerUnsub)

      // Orders — strictly pending badge count
      const ordersUnsub = onSnapshot(collection(db, 'sellers', uid, 'orders'), snap => {
        let pending = 0
        snap.forEach(d => {
          const status = d.data().status
          if (status === 'pending' || !status) pending++
        })
        setPendingOrdersCount(pending)
      }, err => console.warn('sellerLive: orders', err))
      unsubs.push(ordersUnsub)

      // Products count
      const productsUnsub = onSnapshot(collection(db, 'sellers', uid, 'products'), snap => {
        setProductsCount(snap.size)
      }, err => console.warn('sellerLive: products', err))
      unsubs.push(productsUnsub)

      // Guest/direct messages unread
      const messagesUnsub = onSnapshot(collection(db, 'sellers', uid, 'messages'), snap => {
        let unread = 0
        snap.forEach(d => { if (d.data().read !== true) unread++ })
        setUnreadMessages(unread)
      }, err => console.warn('sellerLive: messages', err))
      unsubs.push(messagesUnsub)

      // Conversations where I am the seller
      const sellerConvoUnsub = onSnapshot(
        query(collection(db, 'conversations'), where('sellerId', '==', uid)),
        snap => {
          let count = 0
          snap.forEach(d => { if (d.data().unreadBySeller) count++ })
          setUnreadSellerConvo(count)
        },
        err => console.warn('sellerLive: seller convos', err)
      )
      unsubs.push(sellerConvoUnsub)

      // Conversations where I am the buyer
      const buyerConvoUnsub = onSnapshot(
        query(collection(db, 'conversations'), where('buyerId', '==', uid)),
        snap => {
          let count = 0
          snap.forEach(d => { if (d.data().unreadByBuyer) count++ })
          setUnreadBuyerConvo(count)
        },
        err => console.warn('sellerLive: buyer convos', err)
      )
      unsubs.push(buyerConvoUnsub)
    })

    return () => {
      authUnsub()
      unsubs.forEach(u => { try { u() } catch { /* noop */ } })
    }
  }, [])

  const value = useMemo<SellerLiveValue>(() => ({
    isSeller,
    pendingOrdersCount,
    productsCount,
    unreadMessages,
    unreadSellerConvo,
    unreadBuyerConvo,
  }), [isSeller, pendingOrdersCount, productsCount, unreadMessages, unreadSellerConvo, unreadBuyerConvo])

  return <SellerLiveContext.Provider value={value}>{children}</SellerLiveContext.Provider>
}

export function useSellerLive(): SellerLiveValue {
  const ctx = useContext(SellerLiveContext)
  if (!ctx) throw new Error('useSellerLive must be used within SellerLiveProvider')
  return ctx
}
