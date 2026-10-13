// 临时校验：pages.json（HBuilderX 会写 JSON5 注释，先剥注释再 parse）
const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '..', 'uniapp-PWstudy', 'pages.json')
const raw = fs.readFileSync(file, 'utf8')
// ⚠️ 必须按 /\r?\n/ 断行：pages.json 是 CRLF，而 JS 的 `.` **不吃 \r**（它和 \n 一样算行终止符）。
//    按 '\n' 断行的话每行末尾都留一个 \r，`\/\/.*$` 里的 .* 停在 \r 前面、非 multiline 的
//    $ 又要匹配到字符串最末 → 整条落空，注释一行都没剥掉，JSON.parse 直接炸（已踩，
//    误报成 pages.json 写坏了，实际是剥注释这一步在 CRLF 上失效）。
const cleaned = raw
  .split(/\r?\n/)
  .map(line => line.replace(/\/\/.*$/, ''))
  .join('\n')
try {
  const o = JSON.parse(cleaned)
  console.log('pages.json OK  pages=' + o.pages.length)
  console.log('globalStyle   =', JSON.stringify(o.globalStyle))
  const bad = []
  o.pages.forEach(p => {
    if (!fs.existsSync(path.join(__dirname, '..', 'uniapp-PWstudy', p.path + '.vue'))) bad.push(p.path)
  })
  console.log('missing files =', bad.length ? bad.join(', ') : 'none')
} catch (e) {
  console.log('pages.json FAIL:', e.message)
  process.exitCode = 1
}
