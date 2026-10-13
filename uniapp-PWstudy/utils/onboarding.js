// utils/onboarding.js - 首次进入的新手引导（步骤定义 + 完成状态 + 推进逻辑）
//
// 职责切分：
//   本文件只管三件事 —— 步骤定义（挑最该先知道的几件事）、完成状态持久化、
//   步骤推进的纯逻辑 advance()。
//   测量目标位置在 pages/home/home.vue（页面才能拿到节点矩形），
//   遮罩与气泡渲染在 components/onboarding-mask/onboarding-mask.vue。
//
// 完成状态存在 settings.onboarding（独立字段，与学习进度无关）：
//   { done: false, v: 步骤版本, at: 完成时间 }
// done 为 false 时首页 onShow 会放一遍；看完/跳过置 done，设置页「关于」可「重看」。
//
// 步骤内容只讲 PWstudy 自己的闭环（定目标 → 每天日程 → 番茄计时 → 收工 → 重排），
// 老版本那套是背单词的（查词 / 开始背单词 / AI 指令），已随背单词一起挪走，别照抄回来。

import * as settings from './settings.js'

const VERSION = 1

// target 的三种形态：
//   null                无高亮（欢迎步骤，气泡居中显示）
//   { sel }             页面内元素：home.vue 用 createSelectorQuery().in(this) 测
//   { ref, sel }        子组件内元素：调 this.$refs[ref].rect(sel, cb) 测
//                       （小程序端页面的 query 选不进自定义组件内部，必须组件自己量）
// 任何目标都可能不存在（模块被收纳 / 结构改动 / 正在专注被硬控）：
// 测量失败一律自动跳过该步，绝不能把用户卡死在引导里。
const STEPS = [
  {
    id: 'welcome',
    title: '欢迎使用 PWstudy',
    body: '它这么转起来：先定一个远期目标，AI 把它拆成每天的日程；专注的时候用它计时，收工时说一句今天的出入，明天的安排自己就重排好了。下面几步带你认一下首页，随时可以跳过。',
    target: null
  },
  {
    id: 'focus',
    title: '番茄钟：计时从这里开始',
    body: '点这张卡进专注页（改时长、调设置），点右边的「开始」才直接起表 —— 只有那一个按钮会开始计时。',
    target: { sel: '.focus-card' }
  },
  {
    id: 'task',
    title: '今日任务：今天要做什么',
    body: '目标拆到今天的这几项。点一整行直接开始专注，点左边的小圈就地勾掉。这里空着的话，去底栏「目标」定一个远期目标。',
    target: { sel: '.task-card' }
  },
  {
    id: 'cta',
    title: '今日收工：说一句今天的出入',
    body: '做多了、做少了、临时加了别的 —— 花十几秒说完，明天的安排才排得准。填过就变成「改一下」。',
    target: { sel: '.home-cta' }
  },
  {
    id: 'edit',
    title: '编辑首页：卡片自己排',
    body: '点「编辑首页」可以把卡片拖成你想要的顺序、把不想要的那张收纳起来，之后从「＋ 添加组件」随时加回来。',
    target: { sel: '.foot-link' }
  },
  {
    id: 'tabbar',
    title: '底部导航：另外三个页',
    body: '目标（定目标、看进度）、统计（用时与走势）、我的（设置与 AI 配置）。首页左右滑动也能切页。',
    target: { ref: 'tabbar', sel: '.ftb' }
  }
]

function steps() {
  return STEPS.slice()
}

function count() {
  return STEPS.length
}

/** 越界返回 null，调用方据此收尾 */
function stepAt(i) {
  return (i >= 0 && i < STEPS.length) ? STEPS[i] : null
}

/**
 * 推进一步：返回 { index, done }。
 * done 为 true 表示已经走完（调用方应当结束引导并落盘）。
 * 纯函数放这里，方便校验脚本直接测推进逻辑，不依赖页面实例。
 */
function advance(i, total) {
  const n = (typeof i === 'number' && i >= 0 ? i : -1) + 1
  // 异常配置（total<=0）：视为已完成，绝不把用户卡死在引导里
  if (typeof total === 'number' && total <= 0) return { index: n, done: true }
  return { index: n, done: n >= (total || STEPS.length) }
}

// ---------- 完成状态 ----------

function isDone() {
  try {
    const ob = settings.get().onboarding
    return !!(ob && ob.done)
  } catch (e) {
    return true // 读不了设置就别打扰用户（宁可不再弹）
  }
}

function shouldShow() {
  return !isDone()
}

function finish() {
  try {
    settings.set({ onboarding: { done: true, v: VERSION, at: Date.now() } })
  } catch (e) { /* 落盘失败不阻塞界面 */ }
}

/** 设置页「重看引导」用：清掉完成标记，回到首页 onShow 会重新放一遍 */
function restart() {
  try {
    settings.set({ onboarding: { done: false, v: VERSION, at: 0 } })
  } catch (e) { /* 同上 */ }
}

export {
  VERSION,
  steps, count, stepAt, advance,
  isDone, shouldShow, finish, restart
}
