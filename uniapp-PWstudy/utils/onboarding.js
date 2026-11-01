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
// 步骤内容只讲 PWstudy 自己的闭环（定目标 → 每天日程 → 专注计时 → 收工 → 重排），
// 老版本那套是背单词的（查词 / 开始背单词 / AI 指令），已随背单词一起挪走，别照抄回来。
//
// ★ 2026-11-01 重做：末步改成「填 API Key」。理由不是"多讲一条功能"，而是
//   不填就有一半功能是停着的（规划 / 对话 / 点评 / 识别学习 App 全走用户自己的
//   大模型账号），而设置里那个开关默认关、还折在四层折叠里。引导是用户一定会看的
//   那一屏，把这件事放这儿，并给一个「现在去填」的按钮。
//   `when` 让这一步在"已经配好"的人身上自动不出现 —— 别教老手怎么填密钥。

import * as settings from './settings.js'

const VERSION = 2

// target 的三种形态：
//   null                无高亮（欢迎步骤 / 收尾步骤，气泡居中显示）
//   { sel }             页面内元素：home.vue 用 createSelectorQuery().in(this) 测
//   { ref, sel }        子组件内元素：调 this.$refs[ref].rect(sel, cb) 测
//                       （小程序端页面的 query 选不进自定义组件内部，必须组件自己量）
// 任何目标都可能不存在（模块被收纳 / 结构改动 / 正在专注被硬控）：
// 测量失败一律自动跳过该步，绝不能把用户卡死在引导里。
//
// when: 可选的在场条件，入参是调用方给的纯布尔（本文件不 import 服务层，
//       免得护栏加载它时要拖进 settings → config 那条依赖链）。
//       home.vue 传 { aiReady }，已配好 AI 的人不会看到最后那步。
//
// action / actionText: 这一步除了「下一步」再给一个"真去做"的按钮（只给最后一步用）。
//       action 目前只有 'ai'，处理在 home.vue 的 guideAction()。
//
// 步数克制在 3-5 步（现在 5 步）：讲解的是"定目标 → 每天日程 → 专注计时 → 收工 → 重排"
// 这条主链路上最该先知道的操作点。多一步，用户"下一步"点到手酸就直接跳过了。
const STEPS = [
  {
    id: 'welcome',
    title: '欢迎使用 PWstudy',
    body: '它这么转起来：先定一个远期目标，AI 把它拆成每天的日程；专注时用它计时；收工时说一句今天的出入，明天的安排自己就重排好了。三步认完首页，最后一步是填 AI 的 Key —— 不填也能用，只是 AI 那几处会停。',
    target: null
  },
  {
    id: 'focus',
    title: '开始专注：点这个大圆',
    body: '圆里写着这一段多长、做哪件事。点一下直接起表；想改时长或调设置，点圆下面那行字进专注页。',
    target: { sel: '.focus-card' }
  },
  {
    id: 'task',
    title: '今日任务：今天要做什么',
    body: '目标拆到今天的这几项。点一整行直接开始专注，点左边的小圈就地勾掉。这里空着的话，先去底栏「目标」定一个远期目标。',
    target: { sel: '.task-card' }
  },
  {
    id: 'cta',
    title: '今日收工：说一句今天的出入',
    body: '做多了、做少了、临时换了别的 —— 花十几秒说完，明天的安排才排得准。填过就变成「改一下」。',
    target: { sel: '.home-cta' }
  },
  {
    id: 'ai',
    title: '最后一步：填一个 API Key',
    body: '定目标时 AI 拆日程、收工时那句对话点评、学习 App 的识别，都要用你自己的大模型账号。填一次就好，密钥只存在这台手机上。',
    target: null,
    when: (o) => !(o && o.aiReady),
    action: 'ai',
    actionText: '现在去填'
  }
]

/** 在场条件（没写 when 的一律在场） */
function alive(step, opts) {
  if (!step || typeof step.when !== 'function') return true
  try {
    return !!step.when(opts || {})
  } catch (e) {
    return true   // 条件写坏了就当它要在场：宁可多讲一步，也别静默吞掉
  }
}

function steps(opts) {
  return STEPS.filter(s => alive(s, opts))
}

function count(opts) {
  return steps(opts).length
}

/** 越界返回 null，调用方据此收尾 */
function stepAt(i, opts) {
  const list = steps(opts)
  return (i >= 0 && i < list.length) ? list[i] : null
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
    // ★ 为什么还比 v：这次把末步换成了"填 API"，步骤表变了。只判 done 的话，
    //   所有老用户都停在 v=1 的"看过了"上，新加的那步永远没人看见 ——
    //   而这一步正是这次改版的目的。抬版本号 = 让老用户再看一遍新的。
    return !!(ob && ob.done && ob.v >= VERSION)
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
