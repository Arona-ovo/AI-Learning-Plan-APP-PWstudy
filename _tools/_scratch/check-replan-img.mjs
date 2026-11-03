// 重排带图链路的正向往返验证（2026-11-03）
//
//   node _tools/_scratch/check-replan-img.mjs
//
// ⚠️ 故意放在 _scratch 下、不叫 _tools/check-*.js：
//    run-all 是同进程 require，而这里要 stub globalThis.uni / plus / fetch，
//    会和后面几个护栏的桩互相污染（check-pwstudy 也塞自己的 uni 桩）。
//    单独跑，别往 run-all 里放。
//
// 验证什么：
//   A. 带图时 user content 变成 [{image_url},{text}]，且 goal.places 回灌进 prompt
//   B. 模型报"不支持图片"时自动去图重试，结果 imgIgnored=true（页面据此提示）
//   C. 不带图仍是纯字符串 content（老路径没变）
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(process.cwd(), 'uniapp-PWstudy')
const mem = new Map()
globalThis.uni = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => { mem.set(k, v) },
  removeStorageSync: (k) => { mem.delete(k) },
  showToast: () => {}, vibrateLong: () => {}
}
globalThis.fetch = async () => ({ blob: async () => ({}) })
// fileToDataUrl 先走 APP-PLUS 分支（条件编译在 node 里是普通注释，两段都会解析），
// 所以要么 stub plus，要么它一 ReferenceError 就被 catch 成 '' —— 图片根本到不了请求里
globalThis.plus = {
  io: {
    resolveLocalFileSystemURL(p, onOk) {
      onOk({ file(cb) { cb({ __fake: true }) } })
    },
    FileReader: class {
      readAsDataURL() {
        this.result = 'data:image/png;base64,AAAA'
        if (this.onloadend) this.onloadend({ target: { result: this.result } })
      }
    }
  }
}
globalThis.FileReader = class {
  readAsDataURL() {
    this.result = 'data:image/png;base64,AAAA'
    if (this.onload) this.onload({})
  }
}

const src = fs.readFileSync(path.join(ROOT, 'services', 'plan-agent.js'), 'utf8')
const stub = `
const __calls = [];
globalThis.__MODE__ = globalThis.__MODE__ || 'ok';
class LLMError extends Error {
  constructor(m, o) { super(m); this.name = 'LLMError'; Object.assign(this, o || {}) }
}
async function chatCompletion(messages, opts) {
  __calls.push(JSON.parse(JSON.stringify(messages)));
  // 模拟"这个模型不看图"：只有带图那次 400，去掉图之后就正常
  if (globalThis.__MODE__ === 'noimg' && messages.some(m => Array.isArray(m.content))) {
    throw new LLMError('400 invalid content type: image_url is not supported by this model');
  }
  return { content: JSON.stringify({
    summary: 'looked at the screenshot',
    ops: [{ op: 'note', level: 'strategy', text: 'keep going', headline: 'keep the pace' }],
    fixed: [{ name: '补习班', when: '周六 9:00-12:00' }]
  }) };
}
export function __seen() { return __calls }
`
const patched = src.replace(
  "import { chatCompletion, LLMError } from './llm.js';",
  stub
)
if (patched === src) throw new Error('llm stub 没替换成功')

const tmp = path.join(ROOT, 'services', '__tmp-replan.mjs')
fs.writeFileSync(tmp, patched)

const mod = await import(pathToFileURL(tmp).href + '?v=' + Date.now())
const results = []
const ok = (cond, label) => {
  results.push([!!cond, label])
  console.log((cond ? '  ✓ ' : '  ✗ ') + label)
}

const goal = {
  id: 'G1', title: '四级', deadline: '2026-12-20', dailyMin: 60,
  tasks: [{ id: 'T1', title: '背单词', day: 3, pomos: 1, status: 'todo' }],
  places: [{ name: '补习班', when: '周六 9:00-12:00', place: '城东校区' }]
}
const reality = { days: '30,20,0', overdue: 1, overdueIds: ['T1'], streak: 2 }
const opt = { maxDeferDays: 5 }

console.log('\n[A] 带图 + 模型支持视觉')
globalThis.__MODE__ = 'ok'
mod.__seen().length = 0
const a = await mod.replanGoal(goal, reality, opt, '', ['/tmp/a.png'])
const seenA = mod.__seen()
ok(seenA.length === 1, '一次请求就成功')
const ua = seenA[0].filter(m => m.role === 'user').pop()
ok(Array.isArray(ua.content), 'user content 是分段数组（多模态）')
ok(ua.content.some(p => p.type === 'image_url' && /^data:image\//.test(p.image_url.url)), '带上了 dataURL 图片段')
ok(ua.content.some(p => p.type === 'text' && /剩余任务/.test(p.text)), '文字段还在（图 + 文一起发）')
ok(a.imgIgnored === false, 'imgIgnored = false')
ok(a.fixed.length === 1 && a.fixed[0].name === '补习班', 'fixed 回传补习班')
const allText = seenA[0].map(m => typeof m.content === 'string' ? m.content : (m.content || []).map(p => p.text || '').join(' ')).join('\n')
ok(/固定安排/.test(allText) && /城东校区/.test(allText), '已填地点作为固定安排回灌给模型')
ok(/留通勤/.test(allText), 'prompt 明确要求留通勤时间')

console.log('\n[B] 带图 + 模型报"不支持图片"')
globalThis.__MODE__ = 'noimg'
mod.__seen().length = 0
const b = await mod.replanGoal(goal, reality, opt, '', ['/tmp/a.png'])
const seenB = mod.__seen()
ok(seenB.length === 2, '降级后重试了一次（共 2 次请求）')
const ub0 = seenB[0].filter(m => m.role === 'user').pop()
const ub1 = seenB[1].filter(m => m.role === 'user').pop()
ok(Array.isArray(ub0.content), '第一次仍带图')
ok(typeof ub1.content === 'string', '第二次去掉图，回到纯文本')
ok(b.imgIgnored === true, 'imgIgnored = true（页面据此提示）')
ok(b.fixed.length === 1, '降级后结果照常可用')

console.log('\n[C] 不带图')
mod.__seen().length = 0
globalThis.__MODE__ = 'ok'
const c = await mod.replanGoal(goal, reality, opt, '', [])
const uc = mod.__seen()[0].filter(m => m.role === 'user').pop()
ok(typeof uc.content === 'string', '不带图时 content 仍是字符串（老路径不变）')

fs.unlinkSync(tmp)
const bad = results.filter(r => !r[0])
console.log('\n' + (bad.length ? ('失败 ' + bad.length + ' 条') : ('全部通过 ' + results.length + ' 条')))
process.exit(bad.length ? 1 : 0)
