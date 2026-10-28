// utils/leisure.js - 休闲 App 静默统计 + 多邻国式提醒
//
// 思路（详见对话里的链路图）：
//   · 读取能力白送：apptime.usageByPackage() 调 UsageStatsManager，能拿当天所有 App
//     前台分钟数，且复用「使用情况访问」权限（学习 App 页已经引导授过）。
//   · 本模块只负责：① 把「休闲关注」清单里的包挑出来存下来；
//     ② 判定要不要提醒（连续刷太久 / 当天零专注且累计太久 / 每日复盘）；
//     ③ 拼文案（含今日待做任务数）；④ 节流 + 静默时段；⑤ 调 notify.js 下发；
//     ⑥ 把这组数字喂给 AI 复盘；⑦ 把配置交给原生后台检测（关屏/退后台也能推）。
//
// 两条下发路径：
//   A 打开时提醒（纯 JS，最稳，本模块直接做）：App.vue onShow 跑 maybeNudgeOnOpen。
//   B 后台实时提醒（原生 LeisureGuard，UTS 插件）：用户在抖音刷太久时，即使 App 关着
//     也弹一条。见 utils/fgsvc.js 的 leisureArm / index.uts 的 LeisureGuard。
//   两条都受同一套 cfg（阈值 / 静默 / 上限）约束，原生那边会再核一遍。

import * as settings from './settings.js';
import * as pw from './pwstore.js';
import * as apptime from './apptime.js';
import * as notify from './notify.js';
import * as fgsvc from './fgsvc.js';

const NUDGE_KEY = 'fj_leisure_nudge_v1';   // { date:'YYYY-MM-DD', count, kinds:{} }
const QUIET = 'fj_leisure_quiet_v1';       // 仅调试/测试用，正常不落

function cfg() {
  try { return settings.get().leisure || {}; } catch (e) { return {}; }
}

export function supported() {
  return apptime.supported();
}

/** 休闲关注清单 [{pkg,name}]（空 = 功能等同关闭） */
export function leisurePkgs() {
  const list = cfg().pkgs || [];
  return Array.isArray(list) ? list.slice() : [];
}

/** 简单占位符替换（i18n 这套是字典查表，不带参数，动态部分手动填） */
function tpl(s, map) {
  return String(s || '').replace(/\{(\w+)\}/g, (m, k) => (map && map[k] != null ? map[k] : m));
}

// ---------- 采集：把休闲 App 当日分钟存进 daily.leisure ----------
/**
 * 读当天 UsageStats，过滤出休闲关注清单里的包，写进 pwstore。
 * @returns {Object} {pkg:min}（仅休闲包）或 null（无权限/失败）
 */
export function captureToday() {
  if (!supported()) return null;
  const pkgs = leisurePkgs();
  if (!pkgs.length) return null;
  if (!apptime.hasUsagePermission()) return null;
  const byApp = apptime.usageByPackage(dayStart(), Date.now());
  if (!byApp) return null;
  const keep = {};
  pkgs.forEach(a => { if (byApp[a.pkg]) keep[a.pkg] = byApp[a.pkg]; });
  if (Object.keys(keep).length) pw.setLeisureMinutes(pw.today(), keep);
  return keep;
}

function dayStart() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

// ---------- 节流 / 静默时段 ----------
function nudgeState() {
  try {
    const o = uni.getStorageSync(NUDGE_KEY);
    if (o && typeof o === 'object') return o;
  } catch (e) {}
  return { date: '', count: 0, kinds: {} };
}
function saveNudgeState(s) {
  try { uni.setStorageSync(NUDGE_KEY, s); } catch (e) {}
}
function newDayReset(s) {
  const t = pw.today();
  if (s.date !== t) { s.date = t; s.count = 0; s.kinds = {}; }
  return s;
}

/** 现在是否落在静默时段（跨午夜也支持）。hour 用本地时区 */
export function inQuietHours(now) {
  const c = cfg();
  let from = Number(c.quietFrom); let to = Number(c.quietTo);
  if (!(from >= 0 && from <= 23 && to >= 0 && to <= 23)) return false;
  const d = now || new Date();
  const mins = d.getHours() * 60 + d.getMinutes();
  const a = from * 60, b = to * 60;
  if (a === b) return false;
  if (a < b) return mins >= a && mins < b;          // 同日：22→08 不成立，走下面
  return mins >= a || mins < b;                       // 跨午夜：22→08
}

// ---------- 判定 ----------
/**
 * 纯判定（不下发），返回候选提醒数组，按优先级排：
 *   daily（零专注且累计超阈值）→ dwell（单 App 刷太久）→ digest（每日复盘到点）
 * 每条 {kind, title, text, min?}；空数组 = 现在不该提醒。
 */
export function decide(now) {
  const c = cfg();
  const t = now || new Date();
  const map = pw.getLeisureMinutes(pw.today());
  const total = Object.keys(map).reduce((s, k) => s + (Number(map[k]) || 0), 0);
  const hasFocus = pw.hasFocusToday();
  const remaining = pw.remainingFocusTasksToday();
  const nameOf = (pkg) => {
    const hit = leisurePkgs().filter(a => a.pkg === pkg)[0];
    return hit ? hit.name : pkg;
  };
  const out = [];

  // daily：当天零专注 且 休闲累计超阈值
  if (!hasFocus && total >= Number(c.dailyMin || 120) && total > 0) {
    out.push({
      kind: 'daily',
      title: tt('leisure_daily_title'),
      text: tpl(tt('leisure_daily_text'), { total: total, n: remaining })
    });
  }
  // dwell：单个休闲 App 当日累计超「连续阈值」（打开时只能拿到累计，真正的连续判定在原生）
  let topPkg = '', topMin = 0;
  Object.keys(map).forEach(p => { if ((Number(map[p]) || 0) > topMin) { topMin = Number(map[p]) || 0; topPkg = p; } });
  if (topPkg && topMin >= Number(c.dwellMin || 30)) {
    const tail = remaining > 0 ? tt('leisure_task_tail') : tt('leisure_rest_tail');
    out.push({
      kind: 'dwell',
      title: tt('leisure_dwell_title'),
      text: tpl(tt('leisure_dwell_text'), { app: nameOf(topPkg), min: topMin }) + tpl(tail, { n: remaining }),
      min: topMin
    });
  }
  // digest：复盘开关开 且 已过复盘时点 且 今日还有任务
  if (c.digest && remaining > 0) {
    const [dh, dm] = String(c.digestTime || '20:00').split(':').map(Number);
    const due = t.getHours() > dh || (t.getHours() === dh && t.getMinutes() >= (dm || 0));
    if (due) {
      out.push({
        kind: 'digest',
        title: tt('leisure_digest_title'),
        text: tpl(tt('leisure_digest_text'), { n: remaining })
      });
    }
  }
  return out;
}

// ---------- 下发 ----------
/**
 * 打开 App 时跑一次：采集 → 判定 → 节流/静默/去重 → 下发。
 * 返回 true = 真发了通知；false = 没发（条件不满足 / 静默 / 超限）。
 */
export function maybeNudgeOnOpen() {
  const c = cfg();
  if (!c.on) return false;
  if (!supported()) return false;
  if (!leisurePkgs().length) return false;
  if (!apptime.hasUsagePermission()) return false;
  const now = new Date();
  if (inQuietHours(now)) return false;
  captureToday();
  const cands = decide(now);
  if (!cands.length) return false;

  const st = newDayReset(nudgeState());
  if (st.count >= Number(c.maxPerDay || 3)) { saveNudgeState(st); return false; }

  // 今天该种已经发过就跳过（digest 每天一条；dwell/daily 去重避免反复弹同一条）
  for (let i = 0; i < cands.length; i++) {
    const cd = cands[i];
    if (st.kinds[cd.kind]) continue;
    const ok = notify.alert(cd.title, cd.text);   // 高优先，出声+震动
    if (ok) {
      st.count += 1;
      st.kinds[cd.kind] = 1;
      saveNudgeState(st);
      return true;
    }
  }
  saveNudgeState(st);
  return false;
}

// ---------- AI 复盘串接 ----------
/** 给 AI 的今日休闲/专注小结（中文，作为上下文塞进复盘 prompt） */
export function leisureSummaryForAI() {
  const c = cfg();
  if (!c.on || !leisurePkgs().length) return '';
  const map = pw.getLeisureMinutes(pw.today());
  const items = leisurePkgs().map(a => ({ name: a.name, min: Number(map[a.pkg]) || 0 })).filter(x => x.min > 0);
  const total = items.reduce((s, x) => s + x.min, 0);
  const hasFocus = pw.hasFocusToday();
  const remaining = pw.remainingFocusTasksToday();
  const parts = [];
  if (items.length) {
    parts.push('今日休闲 App 使用时长：' + items.map(x => x.name + ' ' + x.min + ' 分').join('、') + '（合计 ' + total + ' 分）');
  } else {
    parts.push('今日休闲 App 无使用记录');
  }
  parts.push('专注 ' + (hasFocus ? '有' : '无') + ' 进行；今日未完成专注任务 ' + remaining + ' 个');
  return parts.join('；');
}

// ---------- 原生后台检测（关屏/退后台也能推） ----------
/**
 * 把配置交给 UTS 插件的 LeisureGuard，由它在后台周期检测 + 到点复盘。
 * 没装自定义基座（插件不可用）/ 关着 / 没选 App → 静默返回 false（A 路径仍工作）。
 * 文案里今日任务数用「当前」值预渲染（App 常被打开，足够新）。
 */
export function armGuard() {
  const c = cfg();
  if (!c.on || !leisurePkgs().length) { disarmGuard(); return false; }
  if (!fgsvc.available()) return false;
  if (!apptime.hasUsagePermission()) return false;
  const remaining = pw.remainingFocusTasksToday();
  // 复盘时点：JS 侧就折算成「小时*60+分钟」，原生只做整数比较。
  // （原生那边不能写 Number('20') —— 生成的 Kotlin 会实例化抽象类 java.lang.Number）
  const dparts = String(c.digestTime || '20:00').split(':');
  const dh = parseInt(dparts[0], 10) || 0;
  const dm = parseInt(dparts[1], 10) || 0;
  const digestHm = dh * 60 + dm;
  // 把"模板 + 阈值 + 静默 + 复盘 + 今日任务数"整段交给原生；
  // 原生每次醒来用「当前」前台 + 当日累计重新渲染文案（App 关着时拿不到 pwstore，
  // 所以 dwell 的 {app}/{min} 必须在原生侧按真实读数填）。
  const payload = JSON.stringify({
    on: true,
    pkgs: leisurePkgs().map(a => a.pkg),
    names: leisurePkgs().map(a => a.name),
    dwellMin: Number(c.dwellMin || 30),
    dailyMin: Number(c.dailyMin || 120),
    quietFrom: Number(c.quietFrom || 22),
    quietTo: Number(c.quietTo || 8),
    maxPerDay: Number(c.maxPerDay || 3),
    digest: !!c.digest,
    digestTime: String(c.digestTime || '20:00'),
    digestHm: digestHm,
    remaining: remaining,
    dwellTitle: tt('leisure_dwell_title'),
    dwellMsg: tt('leisure_dwell_text'),
    dwellTail: remaining > 0 ? tt('leisure_task_tail') : tt('leisure_rest_tail'),
    dailyTitle: tt('leisure_daily_title'),
    dailyMsg: tt('leisure_daily_text'),
    digestTitle: tt('leisure_digest_title'),
    digestMsg: tt('leisure_digest_text')
  });
  try { return !!fgsvc.leisureArm(payload); } catch (e) { return false; }
}

/** 撤掉后台检测（关功能 / 清空清单时调） */
export function disarmGuard() {
  if (!fgsvc.available()) return false;
  try { return !!fgsvc.leisureDisarm(); } catch (e) { return false; }
}

/** 记一次"今天专注过"（原生 daily 规则据此判零专注；专注完成时调） */
export function markFocusDone() {
  if (!fgsvc.available()) return false;
  try { return !!fgsvc.leisureMarkFocus(); } catch (e) { return false; }
}

// ---------- 文案（i18n 字典查表；动态数字/名称手动填） ----------
function tt(key) {
  try { return uni.getLocale && uni.getLocale() === 'en' && EN[key] ? EN[key] : (ZH[key] || key); } catch (e) { return ZH[key] || key; }
}
const ZH = {
  leisure_dwell_title: '该回来专注了',
  leisure_dwell_text: '你今天在 {app} 上已经 {min} 分钟了。',
  leisure_task_tail: '今日还有 {n} 个任务没做，现在开一段？',
  leisure_rest_tail: '休息一下也好，记得回来继续学～',
  leisure_daily_title: '今天还没专注哦',
  leisure_daily_text: '你今天在休闲 App 上花了 {total} 分钟，却一段专注都没做。今日还有 {n} 个任务，开一段吧？',
  leisure_digest_title: '今日待办提醒',
  leisure_digest_text: '今天还有 {n} 个专注任务没完成。现在开始一段，今晚就能安心休息～'
};
const EN = {
  leisure_dwell_title: "Time to focus",
  leisure_dwell_text: "You have spent {min} minutes on {app} today.",
  leisure_task_tail: "You still have {n} tasks left today — start a focus session?",
  leisure_rest_tail: "A break is fine, just remember to come back.",
  leisure_daily_title: "No focus yet today",
  leisure_daily_text: "You have spent {total} minutes on leisure apps but finished zero focus sessions. You have {n} tasks left — start one?",
  leisure_digest_title: "Today's to-do",
  leisure_digest_text: "You still have {n} focus tasks unfinished. Start one now and rest easy tonight."
};
