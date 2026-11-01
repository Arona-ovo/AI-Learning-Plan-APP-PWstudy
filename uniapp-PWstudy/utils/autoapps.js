// utils/autoapps.js - 自动发现「没登记、但今天确实在用」的 App
//
// 为什么要有它：使用情况访问本来就能读到整机每个 App 的前台时长，但统计只认
// 「学习 App / 休闲 App」两份清单 —— 用户没手动登记的那些，数据白读一遍，
// 提醒也永远不会为它们触发。用户的原话是"理论上它也能统计其他 App 吧，
// 那 AI 或者 App 可以自己添加自己统计"。
//
// 这里只做"发现"，不写任何设置（谁调谁落库）：
//   · detect() 读 UsageStats，按今天的真实用时挑出没归类的
//   · 归类（学习 / 休闲 / 跳过）交给 services/ai-app-guess.js 的 classifyApps()
//   · 页面拿结果给用户过一眼（或开了「自动补全」后直接落库）
//
// 纯读取 + 纯过滤，不依赖 DOM，方便护栏直接跑。

import * as apptime from './apptime.js'

// 这些包永远不进候选：系统壳 / 桌面 / 输入法 / 商店 / 自己的宿主
const SKIP_PREFIX = [
  'com.android.',
  'android',
  'com.google.android.',
  'com.miui.',
  'com.xiaomi.',
  'com.coloros.',
  'com.oplus.',
  'com.heytap.',
  'com.oppo.',
  'com.bbk.',
  'com.vivo.',
  'com.huawei.',
  'com.hihonor.',
  'com.samsung.android.',
  'com.sec.android.',
  'com.lenovo.',
  'com.oneplus.',
  // 应用商店 / 装包器：装 App 不是消遣，别拿来提醒
  'com.tencent.android.qqdownloader',
  'com.xiaomi.market',
  'com.huawei.appmarket'
]

// 包名里带这些词的也不进（输入法 / 桌面 / 系统界面 / 设置 / 商店）
const SKIP_WORD = [
  'launcher', 'inputmethod', 'ime', 'systemui', 'settings',
  'packageinstaller', 'permissioncontroller', 'provider', 'installer'
]

/** 是不是"系统那类"，这类 App 加进清单毫无意义（还会把统计搅浑） */
function looksSystem(pkg, selfPkg) {
  if (!pkg) return true
  if (selfPkg && pkg === selfPkg) return true
  try {
    if (typeof apptime.isHomePkg === 'function' && apptime.isHomePkg(pkg)) return true
  } catch (e) { /* 判断不了就按包的规则来 */ }
  for (let i = 0; i < SKIP_PREFIX.length; i++) {
    if (pkg.indexOf(SKIP_PREFIX[i]) === 0) return true
  }
  const low = pkg.toLowerCase()
  for (let i = 0; i < SKIP_WORD.length; i++) {
    if (low.indexOf(SKIP_WORD[i]) >= 0) return true
  }
  return false
}

function dayStart() {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()
}

/** 包名 → 显示名（优先已装列表里的真名，取不到就退回包名） */
function nameMap() {
  const names = {}
  try {
    (apptime.installedAppsCached() || []).forEach(a => {
      if (a && a.pkg) names[a.pkg] = a.name || a.pkg
    })
  } catch (e) { /* 读不到就让调用方退包名 */ }
  return names
}

/**
 * 挑出"今天用过、但三份名单里都没有"的 App。
 *
 * @param {Object} opts
 *   dock:    [{pkg}]      已登记的学习 App
 *   leisure: [{pkg}]      已登记的休闲 App
 *   skipped: [pkg]        用户点过「不用管」的
 *   minMin:  number       今日最少用几分钟才算（默认 5）
 *   limit:   number       最多返回几个（默认 12）
 * @returns {{pkg:string,name:string,min:number}[]} 按用时从多到少；读不到就空数组
 */
export function detect(opts) {
  const o = opts || {}
  const minMin = Number(o.minMin) >= 0 ? Number(o.minMin) : 5
  const limit = Number(o.limit) > 0 ? Number(o.limit) : 12
  let byApp = null
  try {
    if (!apptime.supported() || !apptime.hasUsagePermission()) return []
    byApp = apptime.usageByPackage(dayStart(), Date.now())
  } catch (e) { byApp = null }
  if (!byApp) return []

  const have = {}
  const mark = (list) => {
    (Array.isArray(list) ? list : []).forEach(a => {
      const pkg = typeof a === 'string' ? a : (a && a.pkg)
      if (pkg) have[pkg] = 1
    })
  }
  mark(o.dock)
  mark(o.leisure)
  mark(o.skipped)

  let selfPkg = ''
  try { selfPkg = apptime.selfPkg() || '' } catch (e) { selfPkg = '' }
  const names = nameMap()

  const out = []
  Object.keys(byApp).forEach(pkg => {
    if (have[pkg]) return
    const min = Number(byApp[pkg]) || 0
    if (min < minMin) return
    if (looksSystem(pkg, selfPkg)) return
    out.push({ pkg: pkg, name: names[pkg] || pkg, min: min })
  })
  out.sort((a, b) => b.min - a.min)
  return out.slice(0, limit)
}

export { looksSystem }
