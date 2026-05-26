from pathlib import Path
p=Path('src/StorePage.tsx')
s=p.read_text(encoding='utf-8', errors='replace')
old_sig = "function ProductCard({ p, isOwner, sellerId, onOrder, onRefresh }: any) {"
if old_sig in s:
    s=s.replace(old_sig, "function ProductCard({ p, isOwner, sellerId, sellerSlug, sellerName, onOrder, onRefresh }: any) {")

old_toggle = "  const toggleOutOfStock = async () => {\n    const newStatus = !isOutOfStock\n    const { updateDoc, doc } = await import('firebase/firestore')\n    await updateDoc(doc(db, 'sellers', sellerId, 'products', p.id), { outOfStock: newStatus })\n    setIsOutOfStock(newStatus)\n  }"
if old_toggle in s:
    share_fn = """

  const handleShare = async () => {
    try {
      const storeUrl = `${window.location.origin}/store/${sellerSlug}`
      const shareText = `${p.name} — UGX ${p.price}\nBuy from ${sellerName}\n${storeUrl}`

      if (navigator.share) {
        try {
          const res = await fetch(p.imageUrl || '')
          const blob = await res.blob()
          const file = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' })
          if ((navigator as any).canShare && (navigator as any).canShare({ files: [file] })) {
            await (navigator as any).share({ title: p.name, text: p.description || '', files: [file], url: storeUrl })
            return
          }
        } catch (err) {
          // ignore image share errors
        }
        await navigator.share({ title: p.name, text: shareText, url: storeUrl })
        return
      }

      await navigator.clipboard.writeText(storeUrl)
      alert('Store link copied to clipboard')
    } catch (err) {
      console.error('Share failed', err)
      try:
        await navigator.clipboard.writeText(f"{window.location.origin}/store/{sellerSlug}")
      except:
        pass
      alert('Could not share — link copied instead')
    }
  }
"""
    s=s.replace(old_toggle, old_toggle+share_fn)

p.write_text(s, encoding='utf-8')
print('done')
