from pathlib import Path
p=Path('src/StorePage.tsx')
s=p.read_text(encoding='utf-8', errors='replace')
old = "<button onClick={onOrder}\n                  style={{ width: '100%', padding: '10px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>\n                  Order Now\n                </button>"
if old in s:
    new = "<div>\n                <button onClick={onOrder}\n                  style={{ width: '100%', padding: '10px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>\n                  Order Now\n                </button>\n                <button onClick={handleShare}\n                  style={{ width: '100%', padding: '8px', marginTop: '8px', background: 'transparent', border: '1px solid #333', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>\n                  Share\n                </button>\n              </div>"
    s=s.replace(old,new)
    p.write_text(s, encoding='utf-8')
    print('patched order block')
else:
    print('order block not found')
