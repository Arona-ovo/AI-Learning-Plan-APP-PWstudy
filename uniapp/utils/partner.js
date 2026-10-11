// utils/partner.js - 与「伙伴 App」（背单词 App）的关联状态
//
// 完整设计见 uniapp/docs/partner-link.md（里面还有给背单词 App 侧的改造清单）。
//
// 定位一句话：**PWstudy 是学习 App 之一，不是唯一背单词入口。**
// 这里的「关联」只是一种**本地意愿记录** —— 关联了就在两者之间跳转并交换数据；
// 不关联时 PWstudy 的功能一条不少，dock 里登记的第三方背单词 App 照常统计。
//
// 因此这个文件里每个函数都必须是"不关联也能活"的：
// 没装 / 没关联 / 没权限 / 非 App 端，任何一种情况都只是返回 false 或 0，
// 绝不抛错 —— 一个可选的增强，不该有能力拖垮主流程。

import * as settings from './settings.js'
import * as pw from './pwstore.js'

// 协议版本。收到不认识的版本按 v1 处理 —— 两个 App 都在快速迭代，
// 版本号用来"知道对方更旧"，不是用来"拒绝服务"。
export const PROTOCOL_V = 1

// 自动询问的上限与间隔（防骚扰，见文档 5.1）
export const ASK_MAX = 3
export const ASK_GAP_MS = 2 * 24 * 3600 * 1000

/**
 * 伙伴注册表。
 *
 * 现在只有 AWword，但按"可以有多个"来组织：将来接入第三方背单词 / 学习 App，
 * 只需要在这里加一项 —— 调用方拿的是 id，不是写死的包名。
 * 用户明确说过 PWstudy 不是唯一的背单词选项，所以 AWword 不该享受硬编码的特殊待遇。
 */
export const PARTNERS = {
  awword: {
    id: 'awword',
    name: 'AWword',
    pkg: 'com.AWword',        // Android 包名：检测安装 + UsageStats 归类
    scheme: 'awword',         // 它自己的 scheme
    key: 'app:awword'         // 在 PWstudy 统计里的归属 key（与 utils/link.js 一致）
  }
}

export const DEFAULT_ID = 'awword'

export function partnerOf(id) {
  return PARTNERS[id || DEFAULT_ID] || PARTNERS[DEFAULT_ID]
}

/* ==================== 状态读写 ==================== */

function blank() {
  return {
    v: PROTOCOL_V, state: 'undecided',
    askedCount: 0, lastAskAt: 0, linkedAt: 0, lastSyncAt: 0, lastWords: 0
  }
}

export function state() {
  try {
    const p = settings.get().partner
    if (p && p.state) return p
  } catch (e) {}
  return blank()
}

function write(patch) {
  try {
    settings.set({ partner: patch })
  } catch (e) {}
  return state()
}

export function isLinked() {
  return state().state === 'linked'
}

/* ==================== 检测对方装没装 ==================== */

/**
 * 伙伴 App 是否已安装。
 * 只支持 App 端 —— H5 / 小程序压根没有"检测已安装应用"这回事，直接 false。
 *
 * ⚠️ Android 11+ 的包可见性限制：targetSdk >= 30 的应用必须在 manifest 里声明
 *    <queries> 才看得到别的包。本项目 targetSdk = 28，当前不受影响；
 *    将来升 targetSdk 时别漏了那条声明（文档 11.2）。
 */
export function installed() {
  // #ifdef APP-PLUS
  try {
    if (plus.runtime && typeof plus.runtime.isApplicationExist === 'function') {
      return !!plus.runtime.isApplicationExist({ pname: partnerOf().pkg })
    }
  } catch (e) {}
  // #endif
  return false
}

/* ==================== 该不该自动问 ==================== */

/**
 * 是否该弹首次询问。条件缺一不可（文档 5.1）：
 *   已安装 + 状态仍是 undecided + 没问够 3 次 + 距上次 ≥ 2 天 + 不在专注中
 *
 * focusing 由调用方传：番茄正在跑的时候**绝不弹窗**，这是硬规矩。
 * 一个可选的关联提示，不配打断一次专注。
 */
export function shouldAsk(opt) {
  const o = opt || {}
  if (!o.installed) return false
  if (o.focusing) return false
  const p = state()
  if (p.state !== 'undecided') return false
  if ((p.askedCount || 0) >= ASK_MAX) return false
  if (p.lastAskAt && Date.now() - p.lastAskAt < ASK_GAP_MS) return false
  return true
}

/** 点了「以后再说」：计数 +1。还能再问，但最多 3 次 */
export function markAsked() {
  const p = state()
  return write({ askedCount: (p.askedCount || 0) + 1, lastAskAt: Date.now() })
}

/** 点了「关联」，或设置页点「重新关联」 */
export function link() {
  const p = state()
  return write({ state: 'linked', linkedAt: p.linkedAt || Date.now(), lastAskAt: Date.now() })
}

/**
 * 取消关联。
 *
 * ⚠️ 落在 declined，不退回 undecided —— 否则下次启动又会重新弹一次首次提示。
 *    用户刚明确取消、转头又被问，是最招人烦的一种设计。
 * ⚠️ 只改意愿，**不碰任何已记录的数据**：daily 里那些时长与词数是真实发生过的学习，
 *    不能因为用户取消了一个关联就被抹掉（文档 9.2）。
 */
export function unlink() {
  return write({ state: 'declined', lastAskAt: Date.now() })
}

/* ==================== 同步结果的记录与展示 ==================== */

/**
 * 收到对方回传时调用：记下"上次真正同步到东西"的时间。
 * 为什么要单记这个：用户看不到数据流，只显示"已关联"的话，链接坏了也发现不了。
 */
export function noteSync(min, words) {
  const patch = { lastSyncAt: Date.now() }
  const w = Math.round(Number(words) || 0)
  if (w > 0) patch.lastWords = w
  return write(patch)
}

/** 今日从伙伴 App 背了多少词（daily[].vocabWords，只有对方回传才拿得到） */
export function todayWords() {
  try { return pw.vocabWords() } catch (e) { return 0 }
}

/** 今日在伙伴 App 上花了多少分钟（byApp 同一张表，与 dock 里其它学习 App 同口径） */
export function todayMin() {
  try {
    const d = pw.get().daily[pw.today()]
    if (!d || !d.byApp) return 0
    return Math.round(Number(d.byApp[partnerOf().key]) || 0)
  } catch (e) {
    return 0
  }
}

/**
 * 上次同步距今多久：{ unit, n }
 * unit = 'never' | 'min' | 'hour' | 'day'，由页面拿去套 $t（文案不写死在这里）。
 */
export function syncAgo() {
  const p = state()
  if (!p.lastSyncAt) return { unit: 'never', n: 0 }
  const min = Math.floor((Date.now() - p.lastSyncAt) / 60000)
  if (min < 1) return { unit: 'min', n: 0 }
  if (min < 60) return { unit: 'min', n: min }
  const h = Math.floor(min / 60)
  if (h < 24) return { unit: 'hour', n: h }
  return { unit: 'day', n: Math.floor(h / 24) }
}
