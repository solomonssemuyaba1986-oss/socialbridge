const fs = require('fs')

const target = 'src/AnalyticsPage.tsx'
const newBlock = fs.readFileSync('scripts/_newblock.txt', 'utf8').replace(/\/\/ ====REST====/g, '').trimEnd()

let s = fs.readFileSync(target, 'utf8')
const startMarker = '  useEffect(() => {'
const start = s.indexOf(startMarker)
const endMarker = '  }, [navigate])'
const end = s.indexOf(endMarker, start)
if (start === -1 || end === -1) {
  console.error('markers not found', start, end)
  process.exit(1)
}
const before = s.slice(0, start)
const after = s.slice(end + endMarker.length)
fs.writeFileSync(target, before + newBlock + '\n' + after, 'utf8')
console.log('Spliced OK. Removed block chars:', end + endMarker.length - start, '| New block chars:', newBlock.length)
