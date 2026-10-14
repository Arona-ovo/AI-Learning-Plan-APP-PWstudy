// services/ai-gate.js - AI 功能的分项开关
//
// 为什么要有这一层：AI 是按 token 计费的，而 App 里这些能力的调用频次天差地别 ——
// "AI 生成学习计划"一次几千 token，"AI 教练对话"是持续消耗，"AI 猜 App 用途"一次也就几十。
// 以前只有「总开关」，用户想省钱就只能整个关掉，连最便宜的那几项也一起没了。
// 这里把每个**独立的 AI 消耗点**登记成一项，用户在设置里逐项开关，用到哪开哪。
//
// ⚠️ 表里只登记 PWstudy **真的会调模型**的地方。原来那张表是从背单词 App 一起过来的
// （查词 / AI 例句 / 翻译点评 / 薄弱点专练 / AI 生成词书 / 对话陪练 / 首页 AI 指令 /
// 生成配图），这些功能在 PWstudy 里要么整簇随背单词挪走了、要么压根没做过 ——
// 留着它们，用户关了一个永远不会被调用的开关，还以为自己在省钱。
//
// 设计约束：
//   1. 默认全开，且**未登记的 key 视为开启**（`!== false`）。这样以后新增功能时，
//      老用户不会被静默降级 —— 要么他明确关过，要么就是开的。
//   2. 守卫只放在**真正花钱的出口**（去模型的那一步），尤其不挡缓存读取：
//      缓存命中不花 token，关了也该让用户看到之前拿到的结果。
//   3. 一律抛**可降级错误**，调用方已有的 try/catch 与本地兜底全部复用，不用改。
import * as settings from '../utils/settings.js'
import { ServiceError } from './http.js'

// key 是稳定标识（写进存储，改名会导致用户设置失效）
// level 是相对开销，帮用户判断"关哪个最省"
// 顺序 = 设置页里的显示顺序：按"花钱从多到少"排，想省钱的人从上往下关就行。
export const AI_FEATURES = [
  {
    key: 'plan',
    name: 'AI 生成学习计划',
    desc: '把目标拆成每天的任务。关掉后改用本地模板排 —— 结构照旧，少些个性化',
    level: 'max', levelLabel: '极高'
  },
  {
    key: 'replan',
    name: 'AI 重排',
    desc: '收工跟计划有出入时，让 AI 重排后面的任务。关掉后重排页不再给建议，只能自己手动挪',
    level: 'mid', levelLabel: '中'
  },
  {
    key: 'coach',
    name: 'AI 教练对话',
    desc: '首页教练框的一问一答：帮你记专注、把说出口的改动落到计划上。关掉后教练框不再回复',
    level: 'mid', levelLabel: '中'
  },
  {
    key: 'review',
    name: 'AI 周回顾',
    desc: '统计页里那一周的 AI 小结。关掉后这一块不再生成',
    level: 'low', levelLabel: '低'
  },
  {
    key: 'harvest',
    name: 'AI 记额外收获',
    desc: '完成一项任务后，把你说的"额外收获"总结成一句带时间的记录存下来，供后面重排参考。关掉后改为原话直存，不调模型',
    level: 'low', levelLabel: '低'
  },
  {
    key: 'guide',
    name: 'AI 讲任务',
    desc: '说清某个任务为什么这么排、具体怎么做。关掉后不再生成新的，之前看过的还在',
    level: 'low', levelLabel: '低'
  },
  {
    key: 'appguess',
    name: 'AI 猜 App 用途',
    desc: '判断某个 App 是不是用来学习的，好把它的时长算进统计。关掉后新 App 一律按非学习处理',
    level: 'low', levelLabel: '低'
  }
]

const KEYS = AI_FEATURES.map((f) => f.key)

// AI 朗读（TTS）用的是 voice 下的独立开关，不在本表 —— 它是"要不要更自然的人声"，
// 跟这里的"要不要调大模型生成内容"不是一回事，混在一个列表里反而看不懂。
export function featureKeys() {
  return KEYS.slice()
}

export function featureMap() {
  const f = (settings.get().ai || {}).features || {}
  return f
}

export function featureOn(key) {
  return featureMap()[key] !== false
}

export function setFeature(key, on) {
  if (KEYS.indexOf(key) < 0) return false
  const next = Object.assign({}, featureMap())
  if (on) delete next[key]      // 还原成"未登记"，省得存一堆 true
  else next[key] = false
  settings.set({ ai: { features: next } })
  return true
}

export function offCount() {
  const f = featureMap()
  return KEYS.filter((k) => f[k] === false).length
}

export function allOn() {
  return offCount() === 0
}

export function setAll(on) {
  const f = featureMap()
  const next = {}
  if (!on) KEYS.forEach((k) => { next[k] = false })
  else KEYS.forEach((k) => { if (f[k] === false) next[k] = true })
  settings.set({ ai: { features: next } })
}

const NAME_OF = {}
AI_FEATURES.forEach((f) => { NAME_OF[f.key] = f.name })

// 出口守卫：功能被关时抛**可降级**错误，调用方已有的兜底链路原样生效
export function ensureFeature(key) {
  if (featureOn(key)) return
  const n = NAME_OF[key] || key
  throw new ServiceError('「' + n + '」已在设置里关闭', {
    degradable: true,
    notConfigured: true,
    featureOff: true
  })
}

// 给人看的： toast / 占位提示用，不算错误
export function offHint(key) {
  const n = NAME_OF[key] || key
  return '「' + n + '」当前是关闭的，可在「设置 › AI › AI 功能」里打开'
}
