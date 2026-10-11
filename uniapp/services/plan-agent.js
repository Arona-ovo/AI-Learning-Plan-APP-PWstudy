// services/plan-agent.js - AI 远期规划与动态重排（复用统一 LLM 服务层）
//
// 纪律（与 page-agent 一致）：
//   · AI 只产出 JSON，绝不产出可执行代码
//   · 输出必须过 plan-schema 白名单校验 + 数值夹取，非法字段整条丢弃、合法字段兜默认
//   · 失败把上一轮报错回喂模型重试（最多 3 轮）；全部失败把人话错误抛给页面
//   · 规划是重资产：结果一律先给用户预览，确认后才由页面调 pwstore 落库
import { chatCompletion, LLMError } from './llm.js';
import { isAIEnabled } from './config.js';
import * as holiday from '../utils/holiday.js';
import * as dailylog from '../utils/dailylog.js';

const PLAN_TIMEOUT = 60000;
const MAX_ROUNDS = 3;

/* ---------- JSON 提取：围栏 / 前后缀 / 尾逗号 / 截断 / 单引号 / 注释 ---------- */
// 修复思路借鉴 josdejong/jsonrepair（ISC）与 mangiucugna/json_repair（MIT）：
// 逐字符扫描、只在"字符串外"动手，避免把内容里的 // 或引号改坏。
const QUOTES = '"\'“”‘’';
function isQuote(c) { return QUOTES.indexOf(c) >= 0; }

function repairJSON(s) {
  let out = '';
  let inStr = false;
  let quote = '"';
  let esc = false;
  const stack = [];
  const n = s.length;
  let i = 0;
  const word = k => s.slice(i, i + k);
  const idEnd = k => !/[A-Za-z0-9_]/.test(s[i + k] || '');

  while (i < n) {
    const c = s[i];
    if (inStr) {
      if (esc) { out += c; esc = false; i++; continue; }
      if (c === '\\') { out += c; esc = true; i++; continue; }
      if (isQuote(c)) { inStr = false; out += '"'; i++; continue; }   // 单/弯引号统一成双引号
      if (c === '\n') { out += '\\n'; i++; continue; }               // 裸换行
      if (c === '\r') { i++; continue; }
      out += c; i++; continue;
    }
    // ---- 字符串外 ----
    if (c === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { i += 2; while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
    if (isQuote(c)) { inStr = true; quote = c; out += '"'; i++; continue; }
    if (c === '{' || c === '[') { stack.push(c); out += c; i++; continue; }
    if (c === '}' || c === ']') {
      const top = stack.length ? stack[stack.length - 1] : '';
      if (!top) { i++; continue; }                                   // 多余的闭括号 → 丢
      stack.pop();
      out += (top === '{' ? '}' : ']');                              // 括号类型以栈顶为准
      i++; continue;
    }
    if (c === ',') {                                                 // 尾逗号 → 丢
      let j = i + 1;
      while (j < n && /\s/.test(s[j])) j++;
      if (j >= n || s[j] === '}' || s[j] === ']') { i++; continue; }
      out += c; i++; continue;
    }
    if (word(4) === 'True' && idEnd(4)) { out += 'true'; i += 4; continue; }
    if (word(4) === 'None' && idEnd(4)) { out += 'null'; i += 4; continue; }
    if (word(5) === 'False' && idEnd(5)) { out += 'false'; i += 5; continue; }
    out += c; i++;
  }
  if (inStr) out += '"';                                             // 断在字符串中间
  while (stack.length) { const t = stack.pop(); out += (t === '{' ? '}' : ']'); }  // 断在半路
  return out;
}

export function extractJSON(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{');
  if (a < 0) throw new Error('回复里没有 JSON 对象');
  const b = s.lastIndexOf('}');
  s = (b > a) ? s.slice(a, b + 1) : s.slice(a);   // 没有收尾的 } = 输出被截断，交给修复兜
  try {
    return JSON.parse(s);
  } catch (e) {
    try {
      return JSON.parse(repairJSON(s));
    } catch (e2) {
      throw new Error('AI 返回的 JSON 无法解析（' + (e2 && e2.message ? e2.message : '格式错误') + '）');
    }
  }
}

/* ---------- 夹取工具（借鉴 page-schema：只有缺标题才整条判死） ---------- */
function clampStr(v, cap) {
  const s = String(v == null ? '' : v).trim();
  return s.slice(0, cap);
}
function clampInt(v, min, max, dft) {
  const n = Math.floor(Number(v));
  if (isNaN(n)) return dft;
  return Math.max(min, Math.min(max, n));
}

/**
 * 校验规划结果。
 * input: { title, deadline('YYYY-MM-DD'), dailyMin }
 * 返回 { strategy, risks, milestones:[{title,days}], tasks:[{title,ms,day,pomos,tags}] }
 * days = 任务建议第几天开始（1 = 今天）。
 */
export function normalizePlan(raw, input) {
  const o = raw || {};
  const totalDays = (() => {
    try {
      const p = String(input.deadline).split('-');
      const end = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
      const diff = Math.ceil((end - new Date()) / 86400000);
      return Math.max(3, Math.min(3650, diff));
    } catch (e) { return 90; }
  })();

  const strategy = clampStr(o.strategy, 500);
  const risks = Array.isArray(o.risks)
    ? o.risks.map(r => clampStr(r, 120)).filter(Boolean).slice(0, 4)
    : [];

  let milestones = Array.isArray(o.milestones)
    ? o.milestones.map(m => ({ title: clampStr(m && m.title, 40), days: clampInt(m && m.days, 0, 3650, 0) }))
        .filter(m => m.title)
        .slice(0, 8)
    : [];
  if (!milestones.length) milestones = [{ title: '起步与摸底', days: 0 }];

  const msCount = milestones.length;
  const seenTitles = {};
  const tasks = [];
  (Array.isArray(o.tasks) ? o.tasks : []).forEach(t => {
    const title = clampStr(t && t.title, 60);
    if (!title || seenTitles[title]) return;
    seenTitles[title] = 1;
    // res（资料建议）：可选增强，模型没给 / 给了非数组就静默落空，不影响任务本身
    const res = Array.isArray(t && t.res)
      ? t.res.map(x => clampStr(x, 40)).filter(Boolean).slice(0, 3)
      : [];
    tasks.push({
      title,
      // 提示词里写的是 milestone（模型照着写 milestone），早期版本读的是 ms ——
      // 两个 key 都认，否则模型按提示词输出时 ms 全兜底成 1，任务全被塞进"阶段 1"
      ms: clampInt((t && t.ms != null) ? t.ms : (t && t.milestone), 1, msCount, 1),
      day: clampInt(t && t.day, 1, totalDays, 1),
      pomos: clampInt(t && t.pomos, 1, 8, 2),
      tags: Array.isArray(t && t.tags) ? t.tags.map(x => clampStr(x, 10)).filter(Boolean).slice(0, 3) : [],
      res: res.length ? res : undefined
    });
  });
  if (!tasks.length) throw new Error('规划结果里没有可用任务');
  tasks.sort((a, b) => a.day - b.day);

  // 假期减量（确定性，不靠模型自觉）：模型就算被提示了也常把假期排满，
  // 所以落地前统一按 dayType 打折 —— 假期半量、周末八折，最少留 1 个番茄。
  const start = input.startDate || holiday.today();
  let cut = 0;
  tasks.forEach(t => {
    const date = holiday.addDays(start, t.day - 1);
    const f = holiday.factorOf(date);
    if (f >= 1) return;
    const before = t.pomos;
    const after = Math.max(1, Math.round(t.pomos * f));
    if (after < before) {
      t.pomos = after;
      t.light = holiday.holidayName(date) ? holiday.holidayName(date) : '周末';
      cut++;
    }
  });
  if (cut) {
    risks.push('已按假期/周末自动削减 ' + cut + ' 个任务的工作量（假期半量、周末八折）');
  }
  return { strategy, risks, milestones, tasks, totalDays };
}

function planSystemPrompt(input) {
  const totalDays = Math.max(3, Math.ceil((new Date(input.deadline) - new Date()) / 86400000) || 90);
  const dailyMin = input.dailyMin || 60;
  const pomoPerDay = Math.max(1, Math.round(dailyMin / 25));
  return [
    '你是学习规划专家。用户会给出一个远期学习目标，请把它拆解为可执行的日程计划。',
    '只输出一个 JSON 对象，不要任何解释、不要 markdown 围栏。格式：',
    '{"strategy":"总体策略，80字内","risks":["风险提示，最多3条"],"milestones":[{"title":"阶段名","days":该阶段跨越天数}],"tasks":[{"title":"任务名（动词开头，可执行）","milestone":阶段序号从1开始,"day":建议第几天开始,"pomos":预估番茄数1-8,"tags":["标签"]' +
      (input.resOn ? ',"res":["资料/工具建议"]' : '') + ']}',
    '约束：',
    '1. 里程碑 2-6 个，任务总数 6-30 个，day 在 1-' + totalDays + ' 之间且按时间排序；',
    '2. 每个番茄 25 分钟，用户每天约能投入 ' + dailyMin + ' 分钟（≈' + pomoPerDay + ' 个番茄），任务量要与总时间匹配，宁可留 20% 余量；',
    '3. 任务要具体可执行（如"做完 2019 年真题卷并整理错题"），不要"努力学习"这类空话；',
    '4. 用户当前水平：' + (input.level || '未提供，按零基础规划') + '；截止日期：' + input.deadline + '。',
    '5. 节假日（已核对国务院安排，务必照做）：' + holiday.summaryFor(holiday.today(), input.deadline) + '。'
  ]
    // res（资料建议）是可选增强，用户在设置里开了才下发这段
    .concat(input.resOn ? [
      '6. res：给这个任务配 1-3 条具体的学习资料 / 工具建议（如《考研真相阅读分册》、Anki、"扇贝考研真题小程序"）。' +
      '只写你确定真实存在的，**不要给任何网址**（你编不准 URL）；确实没有合适的就给空数组或不带该字段。'
    ] : [])
    .join('\n');
}

/**
 * 没有 AI 时的本地兜底：按天数和每天投入量，确定性地排一份计划。
 *
 * 为什么必须有：README 承诺"不配 AI 也能用"，而配 Key 是可选动作。
 * 没这条兜底时，未配置的用户点「直接开始规划」只会看到一句"请先配置 AI"，
 * 永远到不了预览页 —— 等于核心功能不可用。
 * 产出与 normalizePlan 同构（strategy/risks/milestones/tasks/totalDays），
 * 页面与落库逻辑完全不用区分。
 */
export function localPlan(input) {
  const deadline = String((input && input.deadline) || '');
  const msDeadline = new Date(deadline).getTime();
  const totalDays = Math.max(3, Math.min(3650,
    isNaN(msDeadline) ? 90 : Math.ceil((msDeadline - Date.now()) / 86400000)));
  const dailyMin = (input && input.dailyMin) || 60;
  const perDay = Math.max(1, Math.round(dailyMin / 25));
  const title = String((input && input.title) || '这个目标').trim();

  // 四个阶段按 20% / 30% / 30% / 20% 切，天数不够就合并成 2-3 个
  const cuts = totalDays >= 60 ? [0.2, 0.3, 0.3, 0.2] : (totalDays >= 21 ? [0.3, 0.4, 0.3] : [0.5, 0.5]);
  const names = ['摸底与打基础', '系统推进', '强化与查漏', '冲刺与复盘'];
  const milestones = [];
  let acc = 0;
  cuts.forEach((r, i) => {
    const days = Math.max(1, Math.round(totalDays * r));
    milestones.push({ title: names[i] || ('阶段 ' + (i + 1)), days: Math.min(days, totalDays - acc) });
    acc += days;
  });

  // 每个阶段的骨架任务：同一套动词模板，day 铺在该阶段的天数区间里
  const TPL = [
    ['梳理' + title + '的考纲与范围，列出清单', 1],
    ['做完一套摸底练习并统计正确率', 2],
    ['按清单啃第一节内容并做笔记', 2],
    ['刷对应章节的练习题并整理错题', 2],
    ['回顾本周错题，重做仍不会的', 2],
    ['做一套阶段自测并评分', 2]
  ];
  const tasks = [];
  let day = 1;
  milestones.forEach((m, mi) => {
    const span = Math.max(1, m.days);
    const per = Math.max(1, Math.round((span * perDay) / TPL.length));
    TPL.forEach((t, ti) => {
      if (tasks.length >= 30) return;
      tasks.push({
        title: (mi === 0 ? '' : '【' + m.title + '】') + t[0],
        ms: mi + 1,
        day: Math.min(totalDays, day),
        pomos: Math.max(1, Math.min(8, t[1] * per)),
        tags: [m.title]
      });
      day = Math.min(totalDays, day + Math.max(1, Math.round(span / TPL.length)));
    });
  });

  return {
    strategy: '未接入 AI，按' + totalDays + '天、每天' + dailyMin + '分钟排了一份通用计划：先摸底打基础，再系统推进，最后冲刺复盘。配好 AI 后会按你的具体情况重排。',
    risks: ['这是通用模板，颗粒度较粗，建议边做边改', '每天番茄数按 ' + perDay + ' 个估算，跟不上就及时收工填报让计划重排'],
    milestones,
    tasks,
    totalDays,
    local: true      // 页面拿它显示"本地模板，未用 AI"
  };
}

/**
 * 远景规划。成功返回 normalizePlan 结果；失败抛 Error（message 已是人话）。
 * AI 没配置时直接走本地兜底（localPlan），不再抛"请先配置 AI"。
 */
export async function planGoal(input) {
  if (!aiEnabled()) return localPlan(input);
  const sys = planSystemPrompt(input);
  const user = [
    '目标：' + input.title,
    input.raw && input.raw !== input.title ? '补充说明：' + input.raw : '',
    '截止日期：' + input.deadline + '；每天可投入：' + (input.dailyMin || 60) + ' 分钟。'
  ].filter(Boolean).join('\n');

  let lastErr = '';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const messages = [{ role: 'system', content: sys }];
    if (lastErr) {
      messages.push({ role: 'user', content: user });
      messages.push({ role: 'assistant', content: '（上一轮输出不合格：' + lastErr + '）' });
      messages.push({ role: 'user', content: '请严格按格式重新输出完整 JSON。' });
    } else {
      messages.push({ role: 'user', content: user });
    }
    try {
      const r = await chatCompletion(messages, { temperature: 0.4, timeout: PLAN_TIMEOUT });
      const raw = extractJSON(r.content);
      return normalizePlan(raw, input);
    } catch (e) {
      if (e instanceof LLMError) {
        // 配置中途失效（改了 Key / 关了开关）：不拦人，直接给本地模板
        if (e.notConfigured) return localPlan(input);
        if (!e.retryable) throw humanPlanError(e);   // 401/402/404 快速失败
        lastErr = e.message;                          // 超时 / 429 / 5xx → 回喂重试
      } else {
        lastErr = (e && e.message) || '输出解析失败';   // JSON 不合格 → 回喂重试
      }
    }
  }
  throw new Error('AI 连续 ' + MAX_ROUNDS + ' 轮都没能给出合格的规划（' + lastErr + '），请稍后再试或把目标描述得更具体一些');
}

function humanPlanError(e) {
  if (e.notConfigured) return new Error('请先到「我的 → 设置 → AI 服务」配置并启用 AI');
  return e;
}

/** AI 是不是真能用（没配 Key / 关掉开关 → false）。
 *  页面用它决定"要不要走追问"，planGoal 用它决定"要不要本地兜底"。 */
export function aiEnabled() {
  try {
    return !!isAIEnabled();
  } catch (e) {
    return false;
  }
}

/* ---------- 对话式收集需求（多轮追问） ---------- */

/* ---------- 图片：把本地图读成 dataURL，喂给支持视觉的模型 ---------- */

// 本地文件 → data:image/...;base64。失败返回 ''（临时文件可能已被系统清掉，那就当没这张图）
function fileToDataUrl(p) {
  return new Promise((resolve) => {
    try {
      // #ifdef APP-PLUS
      plus.io.resolveLocalFileSystemURL(p, (entry) => {
        entry.file((file) => {
          const reader = new plus.io.FileReader();
          reader.onloadend = (e) => {
            const r = e && e.target && e.target.result;
            resolve(typeof r === 'string' && r.indexOf('data:') === 0 ? r : '');
          };
          reader.onerror = () => resolve('');
          reader.readAsDataURL(file);
        }, () => resolve(''));
      }, () => resolve(''));
      // #endif
      // #ifndef APP-PLUS
      if (typeof fetch !== 'function' || typeof FileReader !== 'function') return resolve('');
      fetch(p).then((r) => r.blob()).then((b) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ''));
        fr.onerror = () => resolve('');
        fr.readAsDataURL(b);
      }).catch(() => resolve(''));
      // #endif
    } catch (e) {
      resolve('');
    }
  });
}

// history → wire messages：带图的用户消息转成 [{type:'image_url'},{type:'text'}] 分段 content
async function historyToWire(history) {
  const out = [];
  for (const m of (history || [])) {
    if (m && m.role === 'user' && Array.isArray(m.images) && m.images.length) {
      const parts = [];
      for (const p of m.images) {
        const url = await fileToDataUrl(p);
        if (url) parts.push({ type: 'image_url', image_url: { url } });
      }
      parts.push({ type: 'text', text: String(m.content || '') });
      out.push({ role: 'user', content: parts });
    } else {
      out.push(m);
    }
  }
  return out;
}

/**
 * 一轮追问。
 * seed: { title, deadline, dailyMin, level }
 * history: [{role:'user'|'assistant', content, images?}]  已经聊过的（不含本次）
 * 返回 { reply, enough, summary, missing }
 */
export async function askRound(seed, history) {
  const round = (history || []).filter(m => m.role === 'assistant').length;
  const sys = [
    '你是学习规划顾问，正在和用户确认一个远期学习目标的细节。',
    '已掌握的信息：目标="' + seed.title + '"；截止=' + seed.deadline + '；每天可投入=' + (seed.dailyMin || 60) + '分钟；当前水平="' + (seed.level || '未提供') + '"。',
    '规则：',
    '1. 每轮只问 1-2 个最关键的缺口，用口语问，不要列编号清单；',
    '2. 关键缺口通常包括：当前起点水平、每天/每周的真实可用时段与节奏、目标是否可量化（分数/证书/产出）、约束（在职还是在校）、偏好（刷题优先还是系统学）；',
    '3. 已经聊了 ' + round + ' 轮；信息够规划了就把 enough 置 true，并写一段需求摘要；**问满 4 轮无论如何结束追问**；',
    '4. 只输出 JSON：{"reply":"给用户看的话","enough":true|false,"summary":"需求摘要","missing":["还缺什么"]}'
  ].join('\n');
  const messages = [{ role: 'system', content: sys }]
    .concat(await historyToWire(history))
    .concat([{ role: 'user', content: '（该你说了）' }]);

  let lastErr = '';
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const msgs = messages.slice();
    if (lastErr) {
      msgs.push({ role: 'assistant', content: '（上一轮输出不合格：' + lastErr + '）' });
      msgs.push({ role: 'user', content: '请严格按格式重新输出 JSON。' });
    }
    try {
      const r = await chatCompletion(msgs, { temperature: 0.6, timeout: PLAN_TIMEOUT });
      const o = extractJSON(r.content);
      const reply = clampStr(o.reply, 300) || '还有一点想确认：你目前的基础大概是什么水平？';
      const enough = !!o.enough || round >= 3;
      return {
        reply,
        enough,
        summary: clampStr(o.summary, 600),
        missing: Array.isArray(o.missing) ? o.missing.map(x => clampStr(x, 40)).filter(Boolean).slice(0, 4) : []
      };
    } catch (e) {
      if (e instanceof LLMError) { if (e.notConfigured || !e.retryable) throw humanPlanError(e); lastErr = e.message; }
      else lastErr = (e && e.message) || '输出解析失败';
    }
  }
  throw new Error('AI 连续几轮都没能给出合格的回复（' + lastErr + '），可以先点「直接开始规划」跳过追问');
}

/* ---------- 首页对话：把"今天到底做了什么"直接说给 AI 听 ---------- */

/**
 * 校验对话结果。
 * 返回 { reply, facts:[], drift, goalId }；goalId 必须在给定目标里，否则置空。
 */
export function normalizeChat(raw, goalIds, taskIds) {
  const o = raw || {};
  const ids = Array.isArray(goalIds) ? goalIds : [];
  const tids = Array.isArray(taskIds) ? taskIds : [];
  const reply = clampStr(o.reply, 400);
  const facts = Array.isArray(o.facts)
    ? o.facts.map(x => clampStr(x, 40)).filter(Boolean).slice(0, 4)
    : [];
  const gid = clampStr(o.goalId, 40);
  // 记功：taskId 必须真在可记功的清单里，数量夹到 1-8 —— 模型编不出不存在的任务
  const credits = [];
  (Array.isArray(o.credits) ? o.credits : []).forEach(c => {
    if (!c || typeof c !== 'object') return;
    const id = clampStr(c.taskId, 40);
    if (!id || tids.indexOf(id) < 0) return;
    const add = clampInt(c.add, 1, 8, 1);
    if (credits.filter(x => x.taskId === id).length) return;   // 同一任务只记一次
    credits.push({ taskId: id, add });
  });
  return {
    reply: reply || '没太听明白，能再说具体点吗？比如「今天背单词只做了 1 个番茄，跑去刷阅读了」。',
    facts,
    drift: !!o.drift,
    goalId: ids.indexOf(gid) >= 0 ? gid : '',
    credits: credits.slice(0, 5)
  };
}

/**
 * 一句话汇报今天（多半和计划不一样），AI 听懂 + 判断要不要惊动后面的计划。
 *
 * 与重排的分工：这里是"听 + 判断"，不产出任何 op；
 * 真要改日程由 replan 页走 replanFromToday —— 那边还有强制预览兜着。
 * 用户说"今天按计划做完了"时 drift=false，什么都不会发生（不该为改而改）。
 *
 * ctx:    coach.context() 的产物 { text, goalIds }
 * history: 今天已经聊过的 [{role, content}]
 */
export async function chatToday(text, ctx, history) {
  const c = ctx || {};
  const goalIds = Array.isArray(c.goalIds) ? c.goalIds : [];
  const taskIds = Array.isArray(c.taskIds) ? c.taskIds : [];
  const sys = [
    '你是学习教练。用户会用一句大白话告诉你他今天实际做了什么 —— 可能和 AI 排的计划不一样，也可能只是想聊聊。',
    '你要做三件事：①把他说的**事实**提炼出来；②判断这和今天的计划算不算不一致；③给一条今天就照做的建议。',
    '只输出一个 JSON 对象：{"reply":"回给用户的话","facts":["事实1","事实2"],"drift":true|false,"goalId":"涉及的目标id","credits":[{"taskId":"任务id","add":这次新做的番茄数}]}',
    '要求：',
    '1. reply 150 字内，说人话，像朋友复盘不像老师评语；先接住他说的事实再给建议，不要复述原话、不要列编号；',
    '2. facts 每条 20 字内，只写事实（做了什么 / 没做什么 / 做了多少），不写评价；听不出事实就给空数组；',
    '3. drift 只在**他说的和今日计划确实不一致**时置 true：少做了、提前做了后面的、做了计划外的；',
    '   照计划完成、纯提问 / 闲聊 / 只要建议 → false。别把"感觉累""想调整"当成偏差；',
    '4. goalId 从给定的目标 id 里挑最相关的一个，都不相关就给空字符串；',
    '5. 今天根本没有计划时，drift 一律 false —— 没有计划就谈不上偏离；',
    '6. 他说得含糊（比如"没怎么学"）就用一句话追问清楚，drift 保持 false，别猜；',
    '7. credits：他明确说做完了 / 做了一部分某个可记功任务时才给，add 是**这次新做的**番茄数',
    '   （说"做完了"按该任务剩余量记，没说数量就给 1，最多 8）；只是抱怨、提问、闲聊就给空数组。',
    '   别替他总结："今天学了不少"这种没有指名任务的，一律不记。'
  ].join('\n');
  const base = [{ role: 'system', content: sys }]
    .concat((history || [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
      .slice(-8)
      .map(m => ({ role: m.role, content: String(m.content || '') })))
    .concat([{
      role: 'user',
      content: (c.text || '（今天没有安排）') +
        '\n\n目标 id 列表：' + (goalIds.join(',') || '（无）') +
        '\n\n用户说：' + String(text || '')
    }]);

  let lastErr = '';
  // 对话要快：两轮就够，第三轮的等待比答错更烦人
  for (let i = 0; i < 2; i++) {
    const msgs = base.slice();
    if (lastErr) {
      msgs.push({ role: 'assistant', content: '（上一轮输出不合格：' + lastErr + '）' });
      msgs.push({ role: 'user', content: '请严格按格式重新输出 JSON。' });
    }
    try {
      const r = await chatCompletion(msgs, { temperature: 0.5, timeout: 30000 });
      return normalizeChat(extractJSON(r.content), goalIds, taskIds);
    } catch (e) {
      if (e instanceof LLMError) { if (e.notConfigured || !e.retryable) throw humanPlanError(e); lastErr = e.message; }
      else lastErr = (e && e.message) || '输出解析失败';
    }
  }
  throw new Error('AI 连续两轮都没给出合格的回复（' + lastErr + '），可以换个说法再试');
}

/* ---------- 动态重排 ---------- */

/**
 * 校验重排 diff。tasks = 该目标现有任务（id 索引）。
 * opt: { maxDeferDays } —— 这次最多允许往后顺延几天（0 = 不允许，defer 一律丢弃）。
 * 返回 { summary, ops:[{op,taskId,day?,pomos?,days?,reason?,text?}] }，非法 op 丢弃。
 */
export function normalizeReplan(raw, tasks, opt) {
  const o = raw || {};
  const byId = {};
  tasks.forEach(t => { byId[t.id] = t; });
  const summary = clampStr(o.summary, 300);
  const ops = [];
  // 顺延上限：页面按"还剩多少天"算好传进来，避免模型一次把期限推到半年后。
  // 没传就按 30 天兜底；显式传 0 = 这次不许顺延（连续少做不够久时不给这个选项）。
  const hasCap = !!(opt && typeof opt.maxDeferDays === 'number');
  const maxDefer = Math.max(0, Math.min(90, hasCap ? Math.floor(opt.maxDeferDays) : 30));
  // 调整档位：策略 > 内容 > 时间（AI 没给就按 op 类型兜一个）
  const LEVELS = ['strategy', 'content', 'time'];
  const levelOf = (op, kind) => {
    const lv = clampStr(op && op.level, 10);
    if (LEVELS.indexOf(lv) >= 0) return lv;
    return kind === 'note' ? 'strategy' : (kind === 'move' ? 'time' : 'content');
  };
  let deferred = false;
  (Array.isArray(o.ops) ? o.ops : []).forEach(op => {
    if (!op || typeof op !== 'object') return;
    const kind = clampStr(op.op, 10);
    const lv = levelOf(op, kind);
    if (kind === 'note') {
      const text = clampStr(op.text || op.reason, 200);
      if (text) ops.push({ op: 'note', level: lv, text });
      return;
    }
    // defer 动的是整个目标的截止日期，本来就没有 taskId ——
    // 必须放在下面的 byId 判定之前，否则会被"找不到任务"直接丢掉。
    if (kind === 'defer') {
      if (deferred) return;                 // 只认第一条：多条顺延叠加没有意义
      if (!maxDefer) return;                // 这次不许顺延
      const days = clampInt(op.days != null ? op.days : op.day, 1, maxDefer, 0);
      if (!days) return;
      deferred = true;
      // 顺延期限恒为 time 档（最后手段），不接受模型自称的 level
      ops.push({ op: 'defer', level: 'time', days: days, reason: clampStr(op.reason, 120) });
      return;
    }
    const t = byId[op.taskId];
    if (!t) return;
    if (kind === 'move') {
      const day = clampInt(op.day, 1, 3650, 0);
      if (!day || day === t.day) return;
      ops.push({ op: 'move', level: lv, taskId: t.id, day, reason: clampStr(op.reason, 120) });
    } else if (kind === 'resize') {
      const pomos = clampInt(op.pomos, 1, 16, 0);
      if (!pomos || pomos === t.pomos) return;
      ops.push({ op: 'resize', level: lv, taskId: t.id, pomos, reason: clampStr(op.reason, 120) });
    } else if (kind === 'drop') {
      if (t.status === 'dropped' || t.status === 'done') return;
      ops.push({ op: 'drop', level: lv, taskId: t.id, reason: clampStr(op.reason, 120) });
    }
  });
  // 展示顺序：先策略、再内容、最后时间，与"优先调整策略"的口径一致
  const rank = { strategy: 0, content: 1, time: 2 };
  // 注意：strategy 的 rank 是 0，不能用 `|| 1` 兜底（0 是假值会把策略档降成内容档）
  const rk = lv => (typeof rank[lv] === 'number' ? rank[lv] : 1);
  ops.sort((a, b) => rk(a.level) - rk(b.level));
  if (!summary && !ops.length) throw new Error('AI 没有给出可执行的重排建议');
  return { summary, ops };
}

/* ---------- 周复盘 / 每日复盘 ---------- */

/**
 * 周报：把这一周的真实投入摊给 AI，让它说人话。
 * payload: { goals:[{title,done,total,pct,remainDays}], days:[{date,focusMin,pomo}], overdue, holidayText }
 * 返回 { summary, good, bad, next:[], focus }
 */
export async function reviewWeek(payload) {
  const p = payload || {};
  const sys = [
    '你是学习教练。下面是学习者这一周的真实数据，请给出一份简短、说人话的复盘。',
    '只输出一个 JSON 对象：{"summary":"一句总评，60字内","good":"做得好的一点，40字内","bad":"最该改的一点，40字内","next":["下周建议1","下周建议2","下周建议3"],"focus":"下周最重要的一件事"}',
    '要求：',
    '1. 只基于给的数据说话，不要编造；数据少就直说"样本太少"；',
    '2. bad 只挑一条最该改的，别列一筐让人无从下手；',
    '3. next 要具体到能照做（如"每天先做 2 个番茄的真题阅读"），不要"继续保持"；',
    '4. 语气像朋友复盘，不像老师评语。'
  ].join('\n');
  const days = (p.days || []).map(d => d.date.slice(5) + ' ' + d.focusMin + '分/' + d.pomo + '个').join('，') || '没有记录';
  const goals = (p.goals || []).map(g => g.title + '（' + g.done + '/' + g.total + ' 番茄，' + g.pct + '%' +
    (typeof g.remainDays === 'number' ? '，剩 ' + g.remainDays + ' 天' : '') + '）').join('；') || '没有进行中的目标';
  const user = [
    '近 7 天每天：' + days,
    '目标进度：' + goals,
    '当前超期未完成任务：' + (p.overdue || 0) + ' 个',
    p.holidayText ? '节假日情况：' + p.holidayText : ''
  ].filter(Boolean).join('\n');

  let lastErr = '';
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const msgs = [{ role: 'system', content: sys }, { role: 'user', content: user }];
    if (lastErr) {
      msgs.push({ role: 'assistant', content: '（上一轮输出不合格：' + lastErr + '）' });
      msgs.push({ role: 'user', content: '请严格按格式重新输出 JSON。' });
    }
    try {
      const r = await chatCompletion(msgs, { temperature: 0.6, timeout: PLAN_TIMEOUT });
      const o = extractJSON(r.content);
      const next = Array.isArray(o.next) ? o.next.map(s => clampStr(s, 60)).filter(Boolean).slice(0, 4) : [];
      const summary = clampStr(o.summary, 120);
      if (!summary && !next.length) throw new Error('复盘内容是空的');
      return {
        summary: summary || '这一周的数据太少，先做起来再谈复盘',
        good: clampStr(o.good, 60),
        bad: clampStr(o.bad, 60),
        next,
        focus: clampStr(o.focus, 60)
      };
    } catch (e) {
      if (e instanceof LLMError) { if (e.notConfigured || !e.retryable) throw humanPlanError(e); lastErr = e.message; }
      else lastErr = (e && e.message) || '输出解析失败';
    }
  }
  throw new Error('AI 连续几轮都没给出合格的复盘（' + lastErr + '）');
}

/* ---------- 任务级学习要点（点一个任务，告诉你"学什么 / 怎么学 / 怎么自查"） ---------- */

/**
 * 给单个任务出学习要点。
 * 借鉴 Anirudh0465/Study-helper 的 Guide：计划负责"什么时候做"，
 * 要点负责"到底怎么做" —— 这才是学习规划 App 该有的那一下。
 *
 * 返回 { summary, steps:[], check, minutes }
 */
export async function explainTask(task, goal) {
  const t = task || {};
  const sys = [
    '你是学科教练。用户给你一个具体的学习任务，请告诉他这个任务到底怎么完成。',
    '只输出一个 JSON 对象：{"summary":"一句话说清这个任务要达成什么","steps":["步骤1","步骤2","步骤3"],"check":"怎么判断自己真的学会了（可自测的标准）","minutes":建议分钟数}',
    '要求：',
    '1. summary 一句话，40 字内，说"达成标准"而不是"去学习"；',
    '2. steps 3-5 步，每步 30 字内，动词开头，能照着做；',
    '3. check 必须是可自测的硬标准（如"合上书写出 3 个条件 + 能做对 5 道题"），不要"感觉掌握了"；',
    '4. 语言贴合任务，别讲空泛方法论。'
  ].join('\n');
  const user = [
    '任务：' + (t.title || ''),
    '所属目标：' + ((goal && goal.title) || '未指定'),
    (goal && goal.level) ? '学习者当前水平：' + goal.level : '',
    '这个任务安排了 ' + (t.pomos || 1) + ' 个番茄（每个 25 分钟）。'
  ].filter(Boolean).join('\n');

  let lastErr = '';
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const msgs = [
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ];
    if (lastErr) {
      msgs.push({ role: 'assistant', content: '（上一轮输出不合格：' + lastErr + '）' });
      msgs.push({ role: 'user', content: '请严格按格式重新输出 JSON。' });
    }
    try {
      const r = await chatCompletion(msgs, { temperature: 0.5, timeout: PLAN_TIMEOUT });
      const o = extractJSON(r.content);
      const steps = Array.isArray(o.steps)
        ? o.steps.map(s => clampStr(s, 60)).filter(Boolean).slice(0, 5)
        : [];
      const summary = clampStr(o.summary, 80);
      const check = clampStr(o.check, 120);
      if (!summary && !steps.length) throw new Error('要点是空的');
      return {
        summary: summary || (t.title || '这个任务'),
        steps,
        check: check || '合上书能复述一遍，并做对对应的题',
        minutes: clampInt(o.minutes, 5, 240, (t.pomos || 1) * 25)
      };
    } catch (e) {
      if (e instanceof LLMError) { if (e.notConfigured || !e.retryable) throw humanPlanError(e); lastErr = e.message; }
      else lastErr = (e && e.message) || '输出解析失败';
    }
  }
  throw new Error('AI 连续几轮都没给出合格的学习要点（' + lastErr + '）');
}

/**
 * 动态重排：传入目标 + 近期真实投入（recentDays 的摘要），返回 diff 预览。
 * 只给建议不落库 —— 用户逐条确认后由页面应用（强制预览纪律）。
 */
export function replanGoal(goal, reality, opt) {
  return runReplan(goal, reality, '', opt);
}

/**
 * 收工重排：在 replanGoal 的基础上，把「今天计划 vs 实际」的差集一起喂给模型。
 *
 * 这是"动态安排"真正落地的一步：光有番茄总数，模型分不清
 *   A：今天一个都没做（任务太重 / 状态不行 → 减量）
 *   B：今天提前把后面第 8 天的活干了（节奏变了 → 往前提）
 * 这两种情况该给的 op 完全相反。拿到填报之后它才判断得出来。
 */
export function replanFromToday(goal, log, reality, opt) {
  return runReplan(goal, reality, dailylog.summaryFor(log), opt);
}

async function runReplan(goal, reality, todayBlock, opt) {
  // reality 可以是对象（推荐）或老的字符串："近期每天分钟数"
  const rd = (typeof reality === 'string')
    ? { days: reality, overdue: 0 }
    : { days: (reality && reality.days) || '0', overdue: (reality && reality.overdue) || 0 };
  // 连续少做天数由页面算好传进来：模型数不出来，而这正是"能不能顺延期限"的唯一凭据
  const streak = Math.max(0, Math.floor(Number(rd.streak != null ? rd.streak : (reality && reality.streak)) || 0));
  const pending = (goal.tasks || []).filter(t => t.status === 'todo').map(t => ({
    id: t.id, title: t.title, day: t.day, pomos: t.pomos, donePomos: t.donePomos || 0,
    overdue: !!(reality && reality.overdueIds && reality.overdueIds.indexOf(t.id) >= 0)
  }));
  const maxDefer = Math.max(0, Math.min(90, (opt && typeof opt.maxDeferDays === 'number') ? Math.floor(opt.maxDeferDays) : 30));
  const sys = [
    '你是学习规划专家。根据学习者的真实执行情况，对剩余任务提出调整建议。',
    '只输出一个 JSON 对象：{"summary":"总体判断，60字内","ops":[{"op":"move|resize|drop|defer|note","level":"strategy|content|time","taskId":"任务id","day":新建议第几天,"pomos":新番茄数,"days":顺延天数,"reason":"一句话理由","text":note类建议的正文}]}',
    '规则：',
    '1. 只调整未完成任务；已完成/已放弃的任务不要动；',
    '2. **调整优先级（必须严格遵守）**：① strategy 调策略（换个学法、调顺序、调配比——不动任务量与期限）',
    '   ② content 调内容（砍掉低价值任务、减量、合并）③ time 调时间（顺延任务日期/阶段，最后手段）；',
    '3. 有任务超期时：先想能不能用策略或内容解决（比如换成更省时的学法、砍掉次要任务），',
    '   只有当真实速度确实追不上时才用 time 顺延；超期严重且内容已无可砍，才允许 move 大幅后移；',
    '4. op 只能是 move（改时间）/ resize（改番茄数）/ drop（砍掉）/ note（给学习者的建议文字，level 一律 strategy）' +
      (maxDefer ? '/ defer（顺延整个目标的截止日期，days = 往后几天，最多 ' + maxDefer + ' 天，level 一律 time）' : ''),
    maxDefer
      ? '5. **defer 是最后中的最后**：它改的是目标截止日，代价最大。只有在"连续好几天都做不完、' +
        '状态也正常、且策略和减量都救不回来"时才给；一次只顺延够用的天数，别一上来就顶格。'
      : '5. 本次**不允许** defer（顺延截止日期）：他还没有连续多天做不完，先用策略和内容解决。',
    '6. 一次给 3-8 条，挑影响最大的说，不要为改而改。',
    '7. 节假日：' + holiday.summaryFor(holiday.today(), goal.deadline) +
      ' —— 撞上假期的任务优先"减量/换轻松学法"，别一股脑往后顺延。',
    // 只有带收工填报时才下发这段；没有填报就别用不存在的东西去约束模型
    todayBlock ? [
      '8. **今天做了什么和计划不一样时，按这个顺序判断**（优先级高于第 3 条）：',
      '   a. 他提前做了后面某天的任务 → 说明节奏比计划快：用 move 把那项提前，',
      '      并考虑把同阶段后面的任务顺势前移，别再让他重复做；',
      '   b. 他做了计划之外的事（比如临时改练阅读）→ 这是真实需求在说话：',
      '      优先用 strategy 把后面的安排往这个方向靠，而不是硬拉回原计划；',
      '   c. 他少做了 → 先看"今天状态"：状态差（累/被占/卡住）多半是一次性的，',
      '      用 content 减量或给个更省时的学法就够了，不要动期限；',
      '      只有连续多天都做不完、且状态正常，才说明是任务太重，再考虑 time 顺延' +
        (maxDefer ? '，必要时才用 defer 动截止日' : '') + '；',
      '   d. 完全按计划完成 → 只在有更优解时给一条 strategy note，不要为改而改。',
      '9. 收工填报里的信息以"事实"对待，但判断权在你：一天的数据不足以推翻整个计划。'
    ].join('\n') : ''
  ].filter(Boolean).join('\n');
  const user = [
    '目标：' + goal.title + '（截止 ' + goal.deadline + '）',
    '近期每天实际专注（分钟）：' + rd.days,
    rd.overdue ? '当前超期未完成任务：' + rd.overdue + ' 个' : '',
    // 连续少做天数：模型自己数不出来，而它正是"能不能顺延期限"的唯一凭据
    '连续没做完的天数（含今天）：' + streak + ' 天',
    todayBlock || '',
    '剩余任务（JSON）：' + JSON.stringify(pending)
  ].filter(Boolean).join('\n');

  let lastErr = '';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const messages = [{ role: 'system', content: sys }];
    if (lastErr) {
      messages.push({ role: 'user', content: user });
      messages.push({ role: 'assistant', content: '（上一轮输出不合格：' + lastErr + '）' });
      messages.push({ role: 'user', content: '请严格按格式重新输出完整 JSON。' });
    } else {
      messages.push({ role: 'user', content: user });
    }
    try {
      const r = await chatCompletion(messages, { temperature: 0.3, timeout: PLAN_TIMEOUT });
      const raw = extractJSON(r.content);
      return normalizeReplan(raw, goal.tasks || [], opt);
    } catch (e) {
      if (e instanceof LLMError) throw humanPlanError(e);
      lastErr = (e && e.message) || '输出解析失败';
    }
  }
  throw new Error('AI 连续 ' + MAX_ROUNDS + ' 轮都没能给出合格的重排建议（' + lastErr + '），请稍后再试');
}
