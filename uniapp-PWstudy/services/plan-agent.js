// services/plan-agent.js - AI 远期规划与动态重排（复用统一 LLM 服务层）
//
// 纪律（与 page-agent 一致）：
//   · AI 只产出 JSON，绝不产出可执行代码
//   · 输出必须过 plan-schema 白名单校验 + 数值夹取，非法字段整条丢弃、合法字段兜默认
//   · 失败把上一轮报错回喂模型重试（最多 3 轮）；全部失败把人话错误抛给页面
//   · 规划是重资产：结果一律先给用户预览，确认后才由页面调 pwstore 落库
import { chatCompletion, LLMError } from './llm.js';
// 分项开关：关掉的那一项不再调模型（省 token）。默认全开，未登记的 key 也视为开启。
import { ensureFeature, featureOn } from './ai-gate.js';
import { isAIEnabled } from './config.js';
import * as holiday from '../utils/holiday.js';
import * as dailylog from '../utils/dailylog.js';
import * as pacing from '../utils/pacing.js';
import * as timeslot from '../utils/timeslot.js';

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
 * 覆盖全程（确定性兜底，不靠模型自觉）
 * 模型 / 本地模板排长目标时经常提前收工 —— 137 天的目标排到第 90 天就停，
 * 后面全是空白，用户看到的正是"你给我少规划了天数"。
 * 做法是按当前 maxDay 等比拉伸铺到截止日：等比变换保序，同一天多条任务的结构也不会散。
 * @return {number} 拉伸前的 maxDay；0 = 没拉伸（已经铺满或只有一条任务）
 */
function stretchToCover(tasks, totalDays) {
  let maxDay = 0;
  tasks.forEach(t => { if (t.day > maxDay) maxDay = t.day; });
  // 留 2 天缓冲：差一两天是凑整误差，重算整份排期反而徒增困惑
  if (maxDay <= 0 || maxDay >= totalDays - 2) return 0;
  const k = totalDays / maxDay;
  tasks.forEach(t => { t.day = Math.max(1, Math.min(totalDays, Math.round(t.day * k))); });
  return maxDay;
}

/**
 * 逐日铺满：从第 1 天到截止日，中间不许出现"这一天什么都没排"的空白。
 *
 * 为什么光有 stretchToCover 不够：等比拉伸只是把已有的几条任务摊开。
 * 而模型的输出有长度上限 —— 几十条基本封顶，137 天的目标拉开之后还是"学一天歇六天"，
 * 用户看到的正是"后面大半本是空的"。所以空白天必须确定性补齐。
 *
 * 补什么是有讲究的，不能拿"自由学习"糊过去：空白天插的是**滚动复习 / 重做不熟的 /
 * 自测 / 错题整理**，内容引用它前面最近的一条真任务 —— 遗忘曲线本来就该这样排
 * （第 1/2/4/7 天反复出现），补上去的不是水分，是原本就该有却被模型漏掉的复习排期。
 *
 * @return {{added:number, capped:boolean}} 补了几条 / 有没有因总量上限没补完
 */
export function ensureFullCover(tasks, totalDays) {
  const have = {};
  tasks.forEach(t => { have[t.day] = 1; });
  // 素材：只引用真人排出来的任务。带 auto 标记的补位任务不参与再生成 ——
  // 否则会出现"复习：滚动复习：xxx"这种俄罗斯套娃
  const src = tasks.filter(t => t.auto !== 'review').sort((a, b) => a.day - b.day);
  if (!src.length || totalDays < 1) return { added: 0, capped: false };

  // ---- 第 1 遍：按间隔安排在每条真任务之后 —— 这才是复习该有的样子 ----
  // 只用轮转的话（每个空天复习下一条）会把同一内容拉到几十天后才再见一次，
  // 那不叫间隔重复，那叫失忆后重学。REVIEW_GAPS 与遗忘曲线同形：先密后疏。
  const REVIEW_GAPS = [1, 3, 7, 15, 26];
  const MAX_EACH = 4;                      // 同一条内容最多复习 4 次，多了是水
  const perSrc = {};
  let seq = 0;                             // 说法轮转：同一个内容复习多次时换个讲法
  const add = [];

  /** 生成一条复习任务。pre = 排在第一条真任务之前（还没东西可复习 → 做开工准备） */
  function mkReview(s, d, pre) {
    const base = shortTitle(s.title, 34);
    const forms = pre ? PREP_FORMS : REVIEW_FORMS;
    return {
      title: clampStr(forms[seq++ % forms.length](base), 56),
      ms: clampInt(s.ms, 1, 999, 1),
      day: d,
      pomos: Math.max(1, Math.min(2, Math.round((Number(s.pomos) || 1) / 2))),
      tags: ['复习'],
      res: (s.res && s.res.length) ? s.res.slice(0, 2) : undefined,
      auto: 'review'                                        // 标出来：UI 与 AI 都知道这是补位
    };
  }

  for (let si = 0; si < src.length; si++) {
    const s = src[si];
    for (let k = 0; k < REVIEW_GAPS.length; k++) {
      if ((perSrc[s.title] || 0) >= MAX_EACH) break;
      const target = s.day + REVIEW_GAPS[k];
      if (target > totalDays) break;
      // 目标那天已经被别的任务占了 → 往后挪两格找最近的空位；找不到就放弃这条间隔
      let hit = 0;
      for (let off = 0; off <= 2 && !hit; off++) {
        const d = target + off;
        if (d <= totalDays && !have[d]) hit = d;
      }
      if (!hit) continue;
      have[hit] = 1;
      add.push(mkReview(s, hit, false));
      perSrc[s.title] = (perSrc[s.title] || 0) + 1;
    }
  }
  // ---- 第 2 遍：还剩空天（模型排得太稀，间隔复习也填不满）→ 复习最近学过的那条 ----
  const src2 = src;
  for (let d = 1; d <= totalDays; d++) {
    if (have[d]) continue;
    if (tasks.length + add.length >= MAX_PLAN_TASKS) {
      tasks.push.apply(tasks, add);
      return { added: add.length, capped: true };
    }
    let s = null;
    for (let i = 0; i < src2.length; i++) {
      if (src2[i].day <= d) s = src2[i]; else break;         // src 已按 day 升序
    }
    if (!s) s = src2[0];                                     // 还在第一条任务之前
    have[d] = 1;
    add.push(mkReview(s, d, s.day > d));
  }
  tasks.push.apply(tasks, add);
  return { added: add.length, capped: false };
}

// 补位任务的几种说法（轮着用，避免连着几天都叫"滚动复习：xxx"）
const REVIEW_FORMS = [
  t => '滚动复习：' + t,
  t => '重做不熟的部分：' + t,
  t => '自测：' + t,
  t => '错题整理：' + t
];
// 排在第一条任务之前的日子：还没东西可复习，做的是开工前的准备
const PREP_FORMS = [
  t => '开工准备：收集资料，把「' + t + '」要用的东西备齐',
  t => '定节奏：排出每天固定的学习时段，贴一张每周清单',
  t => '列范围：圈出这次要覆盖的内容清单，标出最难的那部分',
  t => '摸底：做一份摸底小测，看看起点在哪儿'
];
// 单份计划的任务总数上限。目标设十年（3650 天）时不铺到失控，
// 超出部分在 risks 里明说，而不是悄悄留白。
const MAX_PLAN_TASKS = 600;

/** 素材标题去噪：去掉模板加的【阶段】前缀，超长截断 */
function shortTitle(s, cap) {
  const t = String(s == null ? '' : s).trim().replace(/^【[^】]*】/, '');
  return t.length > cap ? t.slice(0, cap - 1) + '…' : t;
}

/** 这份排期实际覆盖了多少天（任务落在第几天，去重计数） */
export function coveredDays(tasks, totalDays) {
  const have = {};
  tasks.forEach(t => {
    if (t.auto === 'review') return;                 // 补位的不算数 —— 那不是模型排出来的
    if (t.day >= 1 && t.day <= totalDays) have[t.day] = 1;
  });
  return Object.keys(have).length;
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
    const row = {
      title,
      // 提示词里写的是 milestone（模型照着写 milestone），早期版本读的是 ms ——
      // 两个 key 都认，否则模型按提示词输出时 ms 全兜底成 1，任务全被塞进"阶段 1"
      ms: clampInt((t && t.ms != null) ? t.ms : (t && t.milestone), 1, msCount, 1),
      day: clampInt(t && t.day, 1, totalDays, 1),
      pomos: clampInt(t && t.pomos, 1, 8, 2),
      tags: Array.isArray(t && t.tags) ? t.tags.map(x => clampStr(x, 10)).filter(Boolean).slice(0, 3) : [],
      res: res.length ? res : undefined
    };
    // 时段（早/中/晚）：关掉开关时这个字段根本不出现 —— 回退成纯任务规划，
    // 落库与重排看到的还是原来那套字段，不需要任何分支判断
    if (input.slotOn) row.slot = timeslot.normalize(t && t.slot);
    tasks.push(row);
  });
  if (!tasks.length) throw new Error('规划结果里没有可用任务');
  tasks.sort((a, b) => a.day - b.day);
  // 覆盖全程（确定性，不靠模型自觉）：模型排长目标时经常提前收工 ——
  // 137 天的目标排到第 90 天就停，后面全是空白，用户看到的就是"少规划了天数"
  const fromDay = stretchToCover(tasks, totalDays);
  if (fromDay) {
    risks.push('原计划只排到第 ' + fromDay + ' 天，已等比拉伸铺满整个 ' + totalDays + ' 天（截止 ' + input.deadline + '）');
  }
  // 逐日铺满：拉伸只保证"最后一件事落在截止日"，中间的空白天还得补。
  // 模型输出有长度上限，几十条就封顶 —— 不补的话长目标必然是学一天歇好几天。
  // 必须在 timeslot.spread 之前补：补出来的日子也要分到早/中/晚。
  const cover = ensureFullCover(tasks, totalDays);
  if (cover.added) {
    tasks.sort((a, b) => a.day - b.day);
    risks.push('从今天到截止日共 ' + totalDays + ' 天，已排到每天都有安排' +
      (cover.capped ? '（目标跨度太长，超出 ' + MAX_PLAN_TASKS + ' 条的部分没再往下排）' : '') +
      '；其中 ' + cover.added + ' 天是补上的复习/自测，跟不上就在收工填报里说出来，别硬扛');
  }
   // 模型漏给 slot 是常态（任务一多就漏），这里按可用时段轮转补齐：
  // 结果页要按早/中/晚三组排布，缺一组就成了两组的怪样子
  if (input.slotOn) timeslot.spread(tasks, input.slots);

  // 假期减量（确定性，不靠模型自觉）：模型就算被提示了也常把假期排满，
  // 所以落地前统一按 dayType 打折 —— 假期半量、周末八折，最少留 1 段专注。
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
  // covered = 模型自己排到了多少天；filled = 我们补了几条。
  // 页面拿它说清"每天都有安排"是排出来的还是补出来的 —— AI 排得稀，用户有权知道。
  return {
    strategy, risks, milestones, tasks, totalDays,
    covered: coveredDays(tasks, totalDays),
    filled: cover.added
  };
}

function planSystemPrompt(input) {
  const totalDays = Math.max(3, Math.ceil((new Date(input.deadline) - new Date()) / 86400000) || 90);
  const dailyMin = input.dailyMin || 60;
  // 任务数跟着天数走（长目标还按"6-30 个"排，中间必然整段空白）。
  // 上限压在 120：再多模型自己会截断成半个 JSON，反而连原本能给的都拿不到 ——
  // 剩下的空白由 ensureFullCover 确定性补齐，比赌模型输出更长稳。
  const taskCap = Math.min(120, Math.max(15, Math.round(totalDays * 0.9)));
  // 可选增强（时段 / 资料）按需续号：两条都开时不能都叫"第 9 条"
  const extras = [];
  if (input.slotOn) {
    extras.push(
      '**时段安排**：每个任务给一个 slot —— "am" = 早上（6-12 点）、"noon" = 中午（12-18 点）、' +
      '"pm" = 晚上（18-24 点）。用户能学的时段是：**' + timeslot.namesOf(input.slots) + '**。' +
      '只在这个范围内排，用上的每个时段都要分到任务，不要把活儿全堆在晚上；' +
      '要整块时间的（刷卷子、写作文）尽量放用户说得出的那个长时段，碎片任务（背单词、复习）放短时段。' +
      '注意 slot 只是这条任务建议放在哪个时段，它不改变 day —— 一个 day 里出现多条不同 slot 的任务很正常。'
    );
  }
  if (input.resOn) {
    extras.push(
      'res：给这个任务配 1-3 条具体的学习资料 / 工具建议（如《考研真相阅读分册》、Anki、"扇贝考研真题小程序"）。' +
      '只写你确定真实存在的，**不要给任何网址**（你编不准 URL）；确实没有合适的就给空数组或不带该字段。'
    );
  }
  return [
    '你是学习规划专家。用户会给出一个远期学习目标，请把它拆解为可执行的日程计划。',
    '只输出一个 JSON 对象，不要任何解释、不要 markdown 围栏。格式：',
    '{"strategy":"总体策略，80字内","risks":["风险提示，最多3条"],"milestones":[{"title":"阶段名","days":该阶段跨越天数}],"tasks":[{"title":"任务名（动词开头，可执行）","milestone":阶段序号从1开始,"day":建议第几天开始,"pomos":预估专注数1-8' +
      (input.slotOn ? ',"slot":"am|noon|pm"' : '') +
      ',"tags":["标签"]' + (input.resOn ? ',"res":["资料/工具建议"]' : '') + ']}',
    '约束：',
    '1. 里程碑 2-6 个；',
    // 规划单位必须是「天」：早/中/晚是天内的时段，不是日程单位 ——
    // 按时段排会把长目标切碎、排不满，AI 也就"规划不了那么多"
    '2. **任务以「天」为单位**：day = 建议第几天开始（1 = 今天）。早/中/晚只是天内的时段，' +
      '不是独立的日程单位 —— 一天里可以排多条任务（不同时段或不同内容），不要按"每天早/中/晚各一条"去铺；',
    // 铺满全程是硬要求：不许 100 天的目标只排 60 天。**逐日**铺满，不是"最后一条落在截止日"
    // （模型输出有长度上限，排不满是常态 → normalizePlan 会补 AND 会在差太多时回喂重排）
    '3. **一天不落地排满第 1-' + totalDays + ' 天**：day 从 1 递增到 ' + totalDays + '，' +
      '**中间不许出现任何一天空着**。排之前先算一遍：任务数明显少于天数，中间一定留白了。' +
      '每天至少 1 条任务；当天没有新内容可排，就排复习 / 自测 / 错题整理 / 重做不熟的部分' +
      '（背诵记忆类尤其必须安排复习，否则等于白学），不要因为"这天没啥好排"就跳过它；' +
      '同一天排 2-3 条也没关系（比如"上午新内容 + 晚上复习"）。' +
      '最后一条要落在第 ' + Math.max(1, totalDays - 1) + '-' + totalDays + ' 天，不许提前收工。' +
      '任务总数参考 ' + taskCap + ' 个：长目标靠间隔复习 / 阶段自测 / 分批推进把中间的天填上；',
    '4. 每段专注 25 分钟。',
    // 排期按"能力"而不是"意愿"：完不成的计划从第一天起就是假的，后面全部跟着错位
    '5. **每日任务量以下面这条画像为准**：' + pacing.promptText(dailyMin),
    '6. **认知负荷上限**：一天新学内容不超过 ' + pacing.DAILY_CAP +
      ' 段专注，超过就拆阶段 / 砍范围，不要靠"今天多学一会"硬扛 —— 长期日均超过 4 小时的计划没有人能维持；',
    '7. **遗忘曲线 / 间隔重复**：背诵记忆类内容（单词、公式、概念、法条等）第一次学完后，' +
      '必须安排轻量复习任务（如"重背第 1-3 批不熟的词"，1-2 段专注），在第 1/2/4/7/15 天反复出现，' +
      '间隔逐次拉长、单次专注数递减 —— 没有复习排期的背诵计划等于白背；',
    '8. 任务要具体可执行（如"做完 2019 年真题卷并整理错题"），不要"努力学习"这类空话；',
    '9. 用户当前水平：' + (input.level || '未提供，按零基础规划') + '；截止日期：' + input.deadline + '。',
    '10. 节假日（已核对国务院安排，务必照做）：' + holiday.summaryFor(holiday.today(), input.deadline) + '。'
  ]
    // 时段安排 / 资料建议都是可选增强，用户在设置里开了才下发这段
    .concat(extras.map((t, i) => (11 + i) + '. ' + t))
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
  // 按画像排期：有历史用真实容量，没有才退回意愿时长折算。
  // 意愿 240 分钟 ≠ 能力 240 分钟，第一天的计划就该按"能做到的"来
  const perDay = pacing.profile().capacity || pacing.capacityOf(dailyMin);
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

  // 每个阶段的骨架任务：同一套动词模板，day 铺在该阶段的天数区间里。
  // 最后一条是间隔复习：背诵类内容没有复习排期等于白背（遗忘曲线：24h 内掉得最快）
  const TPL = [
    ['梳理' + title + '的考纲与范围，列出清单', 1],
    ['做完一套摸底练习并统计正确率', 2],
    ['按清单啃第一节内容并做笔记', 2],
    ['刷对应章节的练习题并整理错题', 2],
    ['间隔复习：重背前面批次记不牢的内容（1/2/4/7 天节奏）', 1],
    ['做一套阶段自测并评分', 2]
  ];
  const tasks = [];
  let day = 1;
  milestones.forEach((m, mi) => {
    const span = Math.max(1, m.days);
    const per = Math.max(1, Math.round((span * perDay) / TPL.length));
    TPL.forEach((t, ti) => {
      if (tasks.length >= 30) return;
      const row = {
        title: (mi === 0 ? '' : '【' + m.title + '】') + t[0],
        ms: mi + 1,
        day: Math.min(totalDays, day),
        pomos: Math.max(1, Math.min(8, t[1] * per)),
        tags: [m.title]
      };
      // 没接 AI 也要准时段：模板排出来的是"第几天"，用户还得自己想"几点做"
      if (input && input.slotOn) row.slot = '';
      tasks.push(row);
      day = Math.min(totalDays, day + Math.max(1, Math.round(span / TPL.length)));
    });
  });
  // 模板一天天往后推着排，四舍五入后尾巴常常差几天到不了截止日
  // （实测 100 天差 6 天、365 天差 16 天）—— 跟 AI 结果同一个口径：铺满全程
  stretchToCover(tasks, totalDays);
  // 模板也要逐日铺满：模板一轮只有几十条任务，137 天的目标照样大部分是空白。
  // 与 AI 结果同一个口径 —— 从今天到截止日，每天都有安排。
  const cover = ensureFullCover(tasks, totalDays);
  if (cover.added) tasks.sort((a, b) => a.day - b.day);
  // 模板没有时段信息，按用户勾选的可用时段轮转摊开（与 normalizePlan 同一套规则）
  if (input && input.slotOn) timeslot.spread(tasks, input.slots);

  return {
    strategy: '未接入 AI，按' + totalDays + '天、每天' + dailyMin + '分钟排了一份通用计划：预排了阶段骨架，中间的空白天用复习与自测补齐，每天都有安排。配好 AI 后会按你的具体情况重排。',
    risks: ['这是通用模板，颗粒度较粗，建议边做边改', '每天专注数按 ' + perDay + ' 个估算，跟不上就及时收工填报让计划重排']
      .concat(cover.added ? ['中间 ' + cover.added + ' 天是通用复习/自测，接上 AI 后会换成贴合内容的具体安排'] : []),
    milestones,
    tasks,
    totalDays,
    covered: coveredDays(tasks, totalDays),
    filled: cover.added,
    local: true      // 页面拿它显示"本地模板，未用 AI"
  };
}

/**
 * 远景规划。成功返回 normalizePlan 结果；失败抛 Error（message 已是人话）。
 * AI 没配置时直接走本地兜底（localPlan），不再抛"请先配置 AI"。
 */
export async function planGoal(input) {
  // AI 没配好、或「AI 生成学习计划」这项被关掉 → 都走本地模板：不拦人，也不报错
  if (!aiEnabled() || !featureOn('plan')) return localPlan(input);
  const sys = planSystemPrompt(input);
  const user = [
    '目标：' + input.title,
    input.raw && input.raw !== input.title ? '补充说明：' + input.raw : '',
    '截止日期：' + input.deadline + '；每天可投入：' + (input.dailyMin || 60) + ' 分钟。'
  ].filter(Boolean).join('\n');

  let lastErr = '';
  // 见过的最优解：为了"排得更满"去重排时，不能把已经拿到手的合格结果弄丢 ——
  // 第二轮超时的话，用户本该拿到第一轮那份，而不是一句"重试失败"。
  let best = null;
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
      const res = normalizePlan(raw, input);
      if (!best || res.covered > best.covered) best = res;
      // AI 排得太稀（连一半天数都没覆盖到）时回喂重排一轮 —— 补位任务虽能兜住不留空白，
      // 但"大半本都是复习"不是用户要的规划。最后一轮不挑了，先给结果。
      if (res.filled > 0 && res.covered < res.totalDays * 0.5 && round < MAX_ROUNDS - 1) {
        lastErr = '你只排到了 ' + res.covered + '/' + res.totalDays + ' 天，中间大量日子是空的。' +
          '请为每一天都安排任务（没新内容就排复习/自测），再从第 1 天重新输出完整 JSON。';
        continue;
      }
      return res;
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
  // 全都不是"完美"的一次，但好歹有一份能用的 → 交给用户预览，别让他白等
  if (best) return best;
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
  ensureFeature('plan');
  const round = (history || []).filter(m => m.role === 'assistant').length;
  const rules = [
    '1. 每轮只问 1-2 个最关键的缺口，用口语问，不要列编号清单；',
    '2. 关键缺口通常包括：当前起点水平、每天/每周的真实可用时段与节奏、目标是否可量化（分数/证书/产出）、约束（在职还是在校）、偏好（刷题优先还是系统学）；',
    '3. 已经聊了 ' + round + ' 轮；信息够规划了就把 enough 置 true，并写一段需求摘要；**问满 4 轮无论如何结束追问**；'
  ];
  // 报班 / 补习是必问项：这类固定安排直接吃掉每天可投入的时间，
  // 不问出来，排出来的计划第一天就撞车（用户还能发课程表截图，模型看得见图）
  rules.push(
    '4. **固定安排是必问项**：只要还没问出"有没有报班 / 补习 / 上课这类每周固定占用时间的安排"，这一轮就问它；' +
    '问的时候顺带提一句"有课表的话可以点输入框旁的「图片」发截图，我能看着图排"；' +
    '用户答了（含发了图）就别再追着问，把结论写进 summary（如"周六全天补习班，周日半天"）'
  );
  let n = 5;
  // 时段安排开着的时候，"希望什么时候做"升级成必问项：
  // 大概说（"晚上"）和详细说（"工作日晚上 8-10 点，周末上午"）都要接得住 ——
  // 追问是给人台阶，不是逼人填表，所以提示词里必须把"两种都行"说出口。
  if (seed.slotOn) {
    rules.push(
      n + '. **执行时段是必问项**：只要还没问出"一般什么时段能学"，这一轮就问它；' +
      '问的时候要带一句"大概说就行（比如『晚上』），想细说也行（比如『工作日晚上 8-10 点，周末上午』），两种我都听得懂"；' +
      '用户答了就别再追着时段问，把他说的原话写进 summary（不要自己改写成时段代号）'
    );
    n++;
  }
  rules.push(
    n + '. 只输出 JSON：{"reply":"给用户看的话","enough":true|false,"summary":"需求摘要","missing":["还缺什么"]}'
  );
  const sys = [
    '你是学习规划顾问，正在和用户确认一个远期学习目标的细节。',
    '已掌握的信息：目标="' + seed.title + '"；截止=' + seed.deadline + '；每天可投入=' + (seed.dailyMin || 60) + '分钟；当前水平="' + (seed.level || '未提供') + '"' +
      (seed.slotOn ? '；用户勾选的可用时段="' + timeslot.namesOf(seed.slots) + '"' : '') + '。',
    '规则：'
  ].concat(rules).join('\n');
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
    reply: reply || '没太听明白，能再说具体点吗？比如「今天背单词只做了 1 段专注，跑去刷阅读了」。',
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
  ensureFeature('coach');
  const c = ctx || {};
  const goalIds = Array.isArray(c.goalIds) ? c.goalIds : [];
  const taskIds = Array.isArray(c.taskIds) ? c.taskIds : [];
  const sys = [
    '你是学习教练。用户会用一句大白话告诉你他今天实际做了什么 —— 可能和 AI 排的计划不一样，也可能只是想聊聊。',
    '你要做三件事：①把他说的**事实**提炼出来；②判断这和今天的计划算不算不一致；③给一条今天就照做的建议。',
    '只输出一个 JSON 对象：{"reply":"回给用户的话","facts":["事实1","事实2"],"drift":true|false,"goalId":"涉及的目标id","credits":[{"taskId":"任务id","add":这次新做的专注数}]}',
    '要求：',
    '1. reply 150 字内，说人话，像朋友复盘不像老师评语；先接住他说的事实再给建议，不要复述原话、不要列编号；',
    '2. facts 每条 20 字内，只写事实（做了什么 / 没做什么 / 做了多少），不写评价；听不出事实就给空数组；',
    '3. drift 只在**他说的和今日计划确实不一致**时置 true：少做了、提前做了后面的、做了计划外的；',
    '   照计划完成、纯提问 / 闲聊 / 只要建议 → false。别把"感觉累""想调整"当成偏差；',
    '4. goalId 从给定的目标 id 里挑最相关的一个，都不相关就给空字符串；',
    '5. 今天根本没有计划时，drift 一律 false —— 没有计划就谈不上偏离；',
    '6. 他说得含糊（比如"没怎么学"）就用一句话追问清楚，drift 保持 false，别猜；',
    '7. credits：他明确说做完了 / 做了一部分某个可记功任务时才给，add 是**这次新做的**专注数',
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
  ensureFeature('review');
  const p = payload || {};
  const sys = [
    '你是学习教练。下面是学习者这一周的真实数据，请给出一份简短、说人话的复盘。',
    '只输出一个 JSON 对象：{"summary":"一句总评，60字内","good":"做得好的一点，40字内","bad":"最该改的一点，40字内","next":["下周建议1","下周建议2","下周建议3"],"focus":"下周最重要的一件事"}',
    '要求：',
    '1. 只基于给的数据说话，不要编造；数据少就直说"样本太少"；',
    '2. bad 只挑一条最该改的，别列一筐让人无从下手；',
    '3. next 要具体到能照做（如"每天先做 2 段专注的真题阅读"），不要"继续保持"；',
    '4. 语气像朋友复盘，不像老师评语。'
  ].join('\n');
  const days = (p.days || []).map(d => d.date.slice(5) + ' ' + d.focusMin + '分/' + d.pomo + '个').join('，') || '没有记录';
  const goals = (p.goals || []).map(g => g.title + '（' + g.done + '/' + g.total + ' 专注，' + g.pct + '%' +
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
  ensureFeature('guide');
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
    '这个任务安排了 ' + (t.pomos || 1) + ' 段专注（每个 25 分钟）。'
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
 * 额外收获：把用户完成任务后随口说的那几句，总结成**一条带时间的记录**。
 *
 * 为什么不直接存原话：三个月后回看"今天那个 reading 有点赶"，谁也不知道
 * 那是什么、说明了什么。而重排真正用得上的其实是两样东西 ——
 *   ① 一句"发生了什么"（含日期与时刻，才知道是哪一次、和哪天的计划对照）
 *   ② 几个可复用的标签（"晚上效率高" / "阅读偏慢"），后面排量时直接拿来对齐
 * 所以让模型做一次压缩，原话另存 raw 备查（模型总结错了也不丢东西）。
 *
 * 抛出可降级错误由调用方兜底（关掉这项 / 没配 AI / 网络不通 → 原话直存）。
 *
 * @param {{taskTitle:string, goalTitle:string, pomos:number, date:string, atText:string, texts:string[]}} ctx
 * @returns {Promise<{summary:string, tags:string[]}>}
 */
export async function summarizeHarvest(ctx) {
  ensureFeature('harvest');
  const c = ctx || {};
  const texts = (c.texts || []).map(s => String(s || '').trim()).filter(Boolean);
  if (!texts.length) throw new Error('没有可总结的内容');
  const sys = [
    '你是学习记录的整理者。学习者刚完成一项任务，说了一段自己的感受/收获。',
    '把它压缩成一句可长期回看的记录。只输出一个 JSON 对象：',
    '{"summary":"一句话记录（40 字内，必须点明这件事对**后面怎么排**有什么用）","tags":["标签","标签"]}',
    '要求：',
    '1. summary 用第三人称或无人称陈述，写"事实 + 含义"，不要写"用户说"；',
    '2. summary 里不要重复日期与时刻（调用方会另外存），只写发生了什么、说明什么；',
    '3. 只总结他**真的说了**的，没说的不要脑补；他说"没有"就如实记为没有额外收获；',
    '4. tags 0-3 个，每个 6 字内，是可复用的信号（如"晚上效率高""阅读偏慢""需要例题"），'
    + '不要写"收获""反馈"这种没有信息量的词；',
    '5. 他的原话口语化、有错别字、跑题都没关系，抓主干即可；跑题到与学习无关的闲聊时 tags 给空数组。'
  ].join('\n');
  const user = [
    '任务：' + (c.taskTitle || ''),
    '所属目标：' + (c.goalTitle || ''),
    '这项任务安排了 ' + (c.pomos || 1) + ' 段专注，完成于 ' + (c.date || '') + ' ' + (c.atText || '') + '。',
    '他的原话：' + texts.join(' / ')
  ].join('\n');

  let lastErr = '';
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const msgs = [{ role: 'system', content: sys }, { role: 'user', content: user }];
    if (lastErr) {
      msgs.push({ role: 'assistant', content: '（上一轮输出不合格：' + lastErr + '）' });
      msgs.push({ role: 'user', content: '请严格按格式重新输出 JSON。' });
    }
    try {
      const r = await chatCompletion(msgs, { temperature: 0.4, timeout: 30000 });
      const o = extractJSON(r.content);
      const summary = clampStr(o.summary, 80);
      const tags = Array.isArray(o.tags)
        ? o.tags.map(s => clampStr(s, 12)).filter(Boolean).slice(0, 3)
        : [];
      if (!summary) throw new Error('总结是空的');
      return { summary: summary, tags: tags };
    } catch (e) {
      if (e instanceof LLMError) { if (e.notConfigured || !e.retryable) throw humanPlanError(e); lastErr = e.message; }
      else lastErr = (e && e.message) || '输出解析失败';
    }
  }
  throw new Error('AI 连续几轮都没给出合格的收获总结（' + lastErr + '）');
}

/**
 * 动态重排：传入目标 + 近期真实投入（recentDays 的摘要），返回 diff 预览。
 * 只给建议不落库 —— 用户逐条确认后由页面应用（强制预览纪律）。
 *
 * @param {string} [extra] 追加给模型的上下文块（本人最新意见 / 历史反馈 / 上次重排结果）。
 *   自动重排（utils/harvest.js）靠这一段把"反馈 → 重排 → 再反馈"串成闭环 ——
 *   没有它，模型每次看到的都是同一份冷冰冰的进度，改完也不知道自己上次改了什么。
 */
export function replanGoal(goal, reality, opt, extra) {
  return runReplan(goal, reality, '', opt, extra);
}

/**
 * 收工重排：在 replanGoal 的基础上，把「今天计划 vs 实际」的差集一起喂给模型。
 *
 * 这是"动态安排"真正落地的一步：光有专注总数，模型分不清
 *   A：今天一个都没做（任务太重 / 状态不行 → 减量）
 *   B：今天提前把后面第 8 天的活干了（节奏变了 → 往前提）
 * 这两种情况该给的 op 完全相反。拿到填报之后它才判断得出来。
 */
export function replanFromToday(goal, log, reality, opt, extra) {
  return runReplan(goal, reality, dailylog.summaryFor(log), opt, extra);
}

async function runReplan(goal, reality, todayBlock, opt, extra) {
  ensureFeature('replan');
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
  // 逐日铺满后一份计划能有几百条任务 —— 全塞进 prompt 又慢又占脑子，
  // 而重排真正要动的是"最近这段"。按第几天排序取前 120 条，够它看清节奏了。
  const REPLAN_VIEW = 120;
  pending.sort((a, b) => a.day - b.day);
  const view = pending.slice(0, REPLAN_VIEW);
  const maxDefer = Math.max(0, Math.min(90, (opt && typeof opt.maxDeferDays === 'number') ? Math.floor(opt.maxDeferDays) : 30));
  const sys = [
    '你是学习规划专家。根据学习者的真实执行情况，对剩余任务提出调整建议。',
    '只输出一个 JSON 对象：{"summary":"总体判断，60字内","ops":[{"op":"move|resize|drop|defer|note","level":"strategy|content|time","taskId":"任务id","day":新建议第几天,"pomos":新专注数,"days":顺延天数,"reason":"一句话理由","text":note类建议的正文}]}',
    '规则：',
    '1. 只调整未完成任务；已完成/已放弃的任务不要动；',
    '2. **调整优先级（必须严格遵守）**：① strategy 调策略（换个学法、调顺序、调配比——不动任务量与期限）',
    '   ② content 调内容（砍掉低价值任务、减量、合并）③ time 调时间（顺延任务日期/阶段，最后手段）；',
    '3. 有任务超期时：先想能不能用策略或内容解决（比如换成更省时的学法、砍掉次要任务），',
    '   只有当真实速度确实追不上时才用 time 顺延；超期严重且内容已无可砍，才允许 move 大幅后移；',
    '4. op 只能是 move（改时间）/ resize（改专注数）/ drop（砍掉）/ note（给学习者的建议文字，level 一律 strategy）' +
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
    ].join('\n') : '',
    // 只有自动重排（带 extra）时下发：它带来的是"本人最新意见"和"上次你改了什么"，
    // 这两样都比历史进度优先级高 —— 不听他的最新意见，闭环就断在这一步
    extra ? [
      '10. **下面若给了【本人最新意见】，它是最高优先级**：他刚亲口说过该怎么排，',
      '    与你的判断冲突时按他说的来，并在 reason 里说明你是怎么兼顾的；',
      '11. 【上次重排结果】是你自己上次的产出 —— 不要重复提已经做过的调整，',
      '    也不要在没新证据的情况下把它改回去（来回横跳最伤信任）。'
    ].join('\n') : ''
  ].filter(Boolean).join('\n');
  const user = [
    '目标：' + goal.title + '（截止 ' + goal.deadline + '）',
    '近期每天实际专注（分钟）：' + rd.days,
    rd.overdue ? '当前超期未完成任务：' + rd.overdue + ' 个' : '',
    // 连续少做天数：模型自己数不出来，而它正是"能不能顺延期限"的唯一凭据
    '连续没做完的天数（含今天）：' + streak + ' 天',
    // 能力画像：调量时要对齐"这个人真能吃多少"，而不是他的意愿
    '学习者画像：' + pacing.promptText(goal.dailyMin || 60),
    todayBlock || '',
    // 本人最新意见 / 历史反馈 / 上次重排结果（自动重排时由 utils/harvest.js 拼好）
    extra || '',
    '剩余任务（按第几天排序，JSON）：' + JSON.stringify(view) +
      (pending.length > view.length
        ? '\n（未完成任务共 ' + pending.length + ' 个，这里给的是最近的 ' + view.length + ' 个；' +
          '你可以对这些之外的任务给建议，但优先动排在最前面的）'
        : '')
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
