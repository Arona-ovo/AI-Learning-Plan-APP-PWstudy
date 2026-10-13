// utils/plan-task.js - AI 规划的后台任务（对话式收集需求 + 生成计划）
//
// 为什么单独一个模块：
//   · 规划的两次 AI 调用（追问 / 生成）都要几十秒，页面退出后不能跟着消失；
//   · 用户可能中途暂停、改两句话再继续生成，状态要能跨页面存活。
// 做法：状态放模块级变量 + 落盘（storage key fj_pw_plan_v1），跑在模块里不依赖页面生命周期；
// 页面 onShow 时 snapshot() 一次就把进度/消息/结果全部拿回来。
// 取消沿用项目纪律：显式 shouldStop()，不靠抛异常。
import * as agent from '../services/plan-agent.js';
import * as settings from './settings.js';
import * as timeslot from './timeslot.js';

const KEY = 'fj_pw_plan_v1';
export const CHANGE_EVENT = 'plan:task-change';

let st = null;
let stopFlag = false;
let busy = 0;          // 正在跑几个（防重入）

function blank() {
  return {
    stage: 'idle',        // idle|ask|plan|done|error
    seed: null,           // {title, deadline, dailyMin, level}
    messages: [],         // [{role:'user'|'assistant', content}]
    enough: false,
    summary: '',
    plan: null,           // 生成的规划（normalizePlan 产物）
    error: '',
    // 运行态
    running: false,       // 后台正在跑
    runningWhat: '',      // '追问' | '规划'
    paused: false,        // 用户暂停：当前这一步跑完就停，不再继续
    pendingText: '',      // 暂停时用户改过的输入，恢复时用这条
    updatedAt: 0
  };
}

function load() {
  try {
    const v = uni.getStorageSync(KEY);
    if (v && typeof v === 'object' && v.stage) {
      // 进程被杀后重启：把"运行中"收敛成"未运行 + 提示"，避免界面永远转圈
      const s = Object.assign(blank(), v);
      s.running = false;
      s.paused = !!s.paused;
      return s;
    }
  } catch (e) {}
  return blank();
}

export function init() {
  if (!st) st = load();
  return st;
}

export function get() {
  if (!st) st = load();
  return st;
}

function persist() {
  st.updatedAt = Date.now();
  try { uni.setStorageSync(KEY, st); } catch (e) {}
}

function emit() {
  try { uni.$emit(CHANGE_EVENT, st); } catch (e) {}
}

function set(patch) {
  Object.assign(st, patch || {});
  persist();
  emit();
}

export function snapshot() {
  const s = get();
  return {
    stage: s.stage, seed: s.seed, messages: s.messages.slice(),
    enough: s.enough, summary: s.summary, plan: s.plan, error: s.error,
    running: s.running, runningWhat: s.runningWhat, paused: s.paused,
    pendingText: s.pendingText
  };
}

export function reset() {
  st = blank();
  stopFlag = false;
  busy = 0;
  persist();
  emit();
  return st;
}

/** 起一个会话：seed = {title, deadline, dailyMin, level} */
export function startSession(seed) {
  init();
  st = blank();
  st.seed = Object.assign({}, seed);
  st.stage = 'ask';
  stopFlag = false;
  persist();
  emit();
  return st;
}

/** 修改 seed（比如在暂停时把截止日期往后挪） */
export function setSeed(patch) {
  init();
  st.seed = Object.assign({}, st.seed || {}, patch || {});
  persist();
  emit();
}

export function shouldStop() {
  return stopFlag;
}

/** 暂停：当前这一步跑完就停（不硬中断网络请求） */
export function pause() {
  stopFlag = true;
  set({ paused: true });
}

/** 恢复：清掉暂停标记，把 pendingText 作为新的用户输入继续 */
export function resume(text) {
  stopFlag = false;
  set({ paused: false, pendingText: '' });
  if (text && String(text).trim()) {
    return send(String(text).trim());
  }
  // 没有新输入：从上次中断处继续（追问继续问、规划阶段重新生成）
  if (get().stage === 'plan') return generate();
  return send('（继续）');
}

function pushMsg(role, content, images) {
  const m = { role, content, at: Date.now() };
  // 图片只存本地临时路径（几十字符），base64 不落库 —— 转换在 plan-agent 组包时做
  if (images && images.length) m.images = images.slice();
  st.messages.push(m);
}

/**
 * 用户说一句话（或点"继续"）。后台跑一轮追问。
 * images: 可选，本轮附带的本地图（uni.chooseImage 的 tempFilePaths）。
 * 返回 Promise，但不要求页面 await —— 任务自己会广播进度。
 */
export async function send(text, images) {
  init();
  if (!st.seed) return st;
  if (busy > 0) return st;              // 防重入：一轮没跑完不接受下一句
  stopFlag = false;
  pushMsg('user', text, images);
  set({ running: true, runningWhat: '追问', error: '', paused: false });
  busy++;
  try {
    // 追问阶段要不要问"你一般什么时段能学"，看的是**当下**的开关 ——
    // 用户在对话中途回设置关掉，这一轮起就不再追着问了
    const seed = Object.assign({}, st.seed, { slotOn: timeslot.enabled() });
    const r = await agent.askRound(seed, st.messages.filter(m => m.role !== 'system'));
    if (stopFlag) { set({ running: false, paused: true }); return st; }
    pushMsg('assistant', r.reply);
    // 停在 ask 阶段等用户点「开始规划」，不自动进 plan（强制预览纪律）
    set({ running: false, enough: !!r.enough, summary: r.summary || st.summary, stage: 'ask' });
    return st;
  } catch (e) {
    set({ running: false, error: (e && e.message) || '追问失败，请稍后再试' });
    return st;
  } finally {
    busy--;
  }
}

/**
 * 生成最终规划。跑之前会先把 seed 的要点拼进上下文，
 * 让模型看到对话里补充的细节（水平、节奏、约束等）。
 */
export async function generate() {
  init();
  if (!st.seed) return st;
  if (busy > 0) return st;              // 防重入：上一轮还没结束
  stopFlag = false;
  set({ stage: 'plan', running: true, runningWhat: '生成计划', error: '', paused: false });
  busy++;
  try {
    const input = Object.assign({}, st.seed);
    if (st.summary) input.raw = st.summary;   // 需求摘要作为补充描述喂给规划器
    // 资料建议（res）：设置里开了才让模型顺手带（默认关，见 settings.plan.res）
    try {
      input.resOn = !!(settings.get().plan && settings.get().plan.res);
    } catch (e) {}
    // 时段安排（早/中/晚）：默认开。关掉后 input.slots 不再下发，规划就是原来的纯任务模式
    input.slotOn = timeslot.enabled();
    input.slots = (st.seed && st.seed.slots) || [];
    const plan = await agent.planGoal(input);
    if (stopFlag) { set({ running: false, paused: true }); return st; }
    set({ stage: 'done', running: false, plan });
    return st;
  } catch (e) {
    set({ stage: 'error', running: false, error: (e && e.message) || '规划失败，请稍后再试' });
    return st;
  } finally {
    busy--;
  }
}

/**
 * 重跑一次生成（结果不满意）。
 *
 * plan 与 stage 必须一次 set 掉：分两次会先广播一个"plan 已清空、stage 还是 done"
 * 的中间态，页面按它判定就会闪回第一步表单，然后才跳回对话页 —— 一闪一闪很难看。
 */
export function regenerate() {
  init();
  if (!st.seed) return Promise.resolve(st);
  set({ plan: null, error: '', stage: 'plan' });
  return generate();
}

/**
 * 从结果页回对话补充信息。
 *
 * 用户看到生成的计划觉得"AI 对我的了解有偏差"时，正确动作是回去把偏差说出来
 * 再重新生成，而不是拿同一份上下文原样重roll —— 那只会得到差不多的另一份。
 * plan 先保留着（用户中途反悔直接落地也行），再生成时会被覆盖。
 * stage 回 ask：对话可以继续，"开始规划"按钮也随之回来。
 */
export function backToChat() {
  init();
  set({ stage: 'ask', error: '' });
  return st;
}

/**
 * 放弃这次规划会话，回到初始状态。
 * 页面用它做"重新填表"：残留会话（问了一半 / 生成失败）以前没有出口，
 * 用户只能杀进程重进。
 */
export function abandon() {
  init();
  return reset();
}

/** 落地：把 plan 写进 pwstore，然后收尾（会话保留到用户下次进来前） */
export function consume() {
  const p = get().plan;
  reset();
  return p;
}
