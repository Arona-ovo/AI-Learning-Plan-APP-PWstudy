// utils/dailylog.js - 每日收工：今天实际做了什么，和计划差在哪
//
// 为什么要有这一步：AI 排出来的是"预测"，人每天真正做的是"事实"。
// 只把专注总数喂回去，AI 分不清这两种情况 ——
//   A：今天安排 2 段专注背单词，结果 1 个都没做 → 任务太重 / 状态不行 → 该减量
//   B：今天没背单词，但把后面第 8 天的阅读提前做了 → 节奏变了 → 该把后面的往前提
// 两者该给的建议完全相反，光看时长永远分不出来。所以让用户在收工时花十几秒勾一遍，
// AI 拿着「计划 vs 实际」的差集去重排后面 —— 这才是真的"动态安排"。
//
// 数据落在 pwstore 的 daily[YYYY-MM-DD].log，跟着备份一起走。

import * as pw from './pwstore.js';

// 今天状态：AI 拿它区分"任务太重"和"今天就是不行"，后者不该顺延期限
export const MOODS = [
  { key: 'great', label: '状态很好' },
  { key: 'ok', label: '正常' },
  { key: 'tired', label: '有点累' },
  { key: 'busy', label: '被别的事占了' },
  { key: 'stuck', label: '卡住了做不动' }
];

function dayRec(date) {
  const st = pw.get();
  const key = date || pw.today();
  if (!st.daily[key]) st.daily[key] = { focusMin: 0, pomo: 0, byApp: {}, byHour: {} };
  const d = st.daily[key];
  if (!d.byHour) d.byHour = {};   // 老数据补字段
  return d;
}

export function logOf(date) {
  const d = pw.get().daily[date || pw.today()];
  return (d && d.log) || null;
}

/** 今天收工了没 */
export function doneToday() {
  return !!logOf(pw.today());
}

/** 收工表里"后面几天、但还没到日子"的任务（用户很可能提前做了） */
const AHEAD_DAYS = 7;

/** 一天最多贴几张成果图（多了既占空间也没人翻） */
export const MAX_PHOTOS = 9;

/**
 * 规范化图片路径列表：去空、去重、按上限截断。
 * 存的是**本地持久路径**（页面里选完要先 saveFile 转一次），
 * 临时路径会在 App 重启后失效 —— 那时缩略图就全白了。
 */
function normPhotos(v) {
  const arr = Array.isArray(v) ? v : [];
  const out = [];
  arr.forEach(x => {
    const s = String(x || '').trim();
    if (s && out.indexOf(s) < 0) out.push(s);
  });
  return out.slice(0, MAX_PHOTOS);
}

/**
 * 生成收工草稿：今天该做的（items）+ 后面几天可能被提前做的（ahead）。
 * actual 默认取任务已记的专注数，用户可以再改。
 */
export function buildDraft() {
  const today = pw.today();
  const seen = {};
  const items = pw.todayQueue(20).map(q => {
    seen[q.task.id] = 1;
    return {
      goalId: q.goal.id,
      taskId: q.task.id,
      title: q.task.title,
      goalTitle: q.goal.title,
      day: q.task.day,
      planned: q.task.pomos || 1,
      actual: Math.min(q.task.pomos || 1, q.task.donePomos || 0),
      // 真实记录的专注数：「按实际填」按钮的复位基准，也是判断"填报有没有虚增"的尺子
      done: q.task.donePomos || 0,
      // 前几天的欠账会被 todayQueue 一起带出来。标出来给收工表分组 ——
      // 混在"今天该做的"里，用户会以为今天必须把历史欠账全补完
      overdue: !!q.overdue,
      behind: q.overdue
        ? Math.max(1, (pw.dayDiff(pw.dateStr(new Date(q.goal.createdAt)), today) + 1) - q.task.day)
        : 0
    };
  });

  const ahead = [];
  pw.activeGoals().forEach(g => {
    const elapsed = pw.dayDiff(pw.dateStr(new Date(g.createdAt)), today) + 1;
    g.tasks
      .filter(t => t.status === 'todo' && t.day > elapsed && t.day <= elapsed + AHEAD_DAYS && !seen[t.id])
      .sort((a, b) => a.day - b.day)
      .forEach(t => {
        if (ahead.length >= 8) return;
        seen[t.id] = 1;
        ahead.push({
          goalId: g.id,
          taskId: t.id,
          title: t.title,
          goalTitle: g.title,
          day: t.day,
          planned: t.pomos || 1,
          actual: 0,
          done: t.donePomos || 0
        });
      });
  });

  const old = logOf(today);
  return {
    date: today,
    items: items,
    ahead: ahead,
    extras: old ? (old.extras || '') : '',
    facts: old ? (old.facts || []) : [],
    mood: old ? (old.mood || '') : '',
    note: old ? (old.note || '') : '',
    photos: old ? (old.photos || []) : []
  };
}

function clampActual(v, planned) {
  const n = Math.max(0, Math.floor(Number(v) || 0));
  return Math.min(n, Math.max(1, planned || 1));
}

/**
 * 规范化「对话里听出来的事实」列表。
 * 允许传字符串或数组，去重、去空，最多留 20 条（防止日志无限长）。
 */
function normFacts(v) {
  let arr = [];
  if (Array.isArray(v)) arr = v.slice();
  else if (typeof v === 'string') arr = v.split(/[；;]/);
  const out = [];
  arr.forEach(x => {
    const s = String(x || '').trim();
    if (s && out.indexOf(s) < 0) out.push(s);
  });
  return out.slice(-20);
}

/** 今日对话里记下的事实（给人看的一句话） */
export function factsText(log) {
  return ((log && log.facts) || []).join('；');
}

/** 存下这次收工，返回落库后的 log（drift 已算好） */
export function save(draft) {
  const d = dayRec(draft.date || pw.today());
  const old = d.log;
  const log = {
    at: Date.now(),
    // 补记专注要按"填报的那天"落账，不能一律记到今天（补填昨天的表会记错天）
    date: draft.date || pw.today(),
    items: (draft.items || []).map(i => ({
      goalId: i.goalId, taskId: i.taskId, title: i.title, goalTitle: i.goalTitle,
      day: i.day, planned: i.planned || 1, actual: clampActual(i.actual, i.planned)
    })),
    // 只留"确实做了"的那几条，没做的不用占地方
    ahead: (draft.ahead || [])
      .filter(i => clampActual(i.actual, i.planned) > 0)
      .map(i => ({
        goalId: i.goalId, taskId: i.taskId, title: i.title, goalTitle: i.goalTitle,
        day: i.day, planned: i.planned || 1, actual: clampActual(i.actual, i.planned)
      })),
    extras: String(draft.extras || '').trim(),
    // 对话里记的事实不经过收工表，保存时要原样带过去，别被覆盖掉
    facts: normFacts((draft.facts && draft.facts.length)
      ? draft.facts
      : ((old && old.facts) || [])),
    mood: String(draft.mood || ''),
    note: String(draft.note || '').trim(),
    photos: normPhotos(draft.photos)
  };
  log.drift = driftOf(log);
  d.log = log;
  // 把"实际做了几个"真正记到任务上：否则任务还是 0 专注，
  // AI 拿到的剩余任务里看不出他已经做过了，会让他重做一遍。
  credit(log);
  pw.touch();
  return log;
}

/**
 * 回填专注数。只增不减 —— 用户少填了不会把已有的进度抹掉。
 * 做满即自动完成（与 addPomoToTask 同一口径）。
 *
 * 走 pw.creditPomo 而不是直接改 task.donePomos：填报表里做的这几段专注
 * 也要进 sessions / daily.pomo / daily.focusMin，否则热力图、forecast
 * 和重排用的 reality.days 全都看不见它们 —— 等于白做。
 */
function credit(log) {
  (log.items || []).concat(log.ahead || []).forEach(i => {
    if (!(i.actual > 0)) return;
    pw.creditPomo(i.goalId, i.taskId, i.actual, { src: 'log', date: log.date });
  });
}

/**
 * 连续"没做完"的天数（含今天，最多回溯 14 天）。
 * 重排拿它决定"这次能不能顺延期限"：偶尔一天做不完不该动截止日，
 * 连续多天追不上才说明是计划本身排错了。
 *
 * 口径：某天算没做完，当且仅当
 *   - 有收工记录且里面存在 actual < planned 的项（他自己说没做完）；或
 *   - 那天一分没学（focusMin === 0）—— 没填表但也没学时，多半是真没做。
 * 有记录且全部做完 → 达标，链断。
 * 完全没有数据的日子不猜（链断）—— 新用户刚装 App 不该被算成"连续 14 天没做"。
 */
export function shortStreak(goalId) {
  const st = pw.get();
  let n = 0;
  for (let k = 0; k < 14; k++) {
    const d = st.daily[pw.addDays(pw.today(), -k)];
    if (!d) break;
    let bad;
    if (d.log && (d.log.items || []).length) {
      const items = goalId
        ? (d.log.items || []).filter(i => i.goalId === goalId)
        : (d.log.items || []);
      // 那天表里没这个目标的任务 → 不算他的账，链断
      if (!items.length) break;
      bad = items.some(i => (i.actual || 0) < (i.planned || 0));
    } else {
      bad = !(d.focusMin > 0);
    }
    if (!bad) break;
    n++;
  }
  return n;
}

/**
 * 有没有"和规定不一样"。
 * 三种都算偏：少做了、提前做了后面的、做了计划外的（手填的 extras）。
 * 完全照计划走完才是 false —— 那时没必要惊动 AI。
 *
 * 注意：对话里 AI 听出来的事实存在 facts 里，**不算偏差**。
 * 那多半是"我把第 3 天的 X 做完了"这种按计划汇报，专注已经由 creditPomos 真记上；
 * 它只是给 AI 的上下文，不该因此逼用户去重排。
 */
export function driftOf(log) {
  if (!log) return false;
  const short = (log.items || []).some(i => (i.actual || 0) < (i.planned || 0));
  if (short) return true;
  if ((log.ahead || []).length) return true;
  if (log.extras) return true;
  return false;
}

/**
 * 补记事实：把"AI 从对话里听出来的事实"写进今日收工记录的 facts 字段。
 *
 * 为什么单独一个字段、不写 extras：extras 参与 driftOf，只要非空就会被判成
 * "和计划有出入"。而对话里提炼出的多半是"我把第 3 天的 X 做完了"这种**按计划汇报**，
 * 专注已经由 creditPomos() 真记到任务上了；把它算成偏差，会让"今天明明照计划走完"
 * 的用户每次都被推去点一遍 AI 重排。
 *
 * facts 只作为重排时的上下文（summaryFor 会给 AI 看），不触发强制重排。
 * 真做了计划外的事，是用户在收工表里手填 extras —— 那条才算偏差。
 * 他说"今天按计划做完了"时 Coach 不会调这里 —— 那时没有事实可记。
 */
export function appendFacts(date, facts) {
  const list = normFacts(facts);
  if (!list.length) return null;
  const d = dayRec(date || pw.today());
  if (!d.log) {
    // 还没填过收工表：建一条只带事实的壳子（items 为空 = 今天没有逐项填报）
    d.log = { at: Date.now(), items: [], ahead: [], extras: '', facts: list, mood: '', note: '', photos: [] };
  } else {
    d.log.facts = normFacts((d.log.facts || []).concat(list));
  }
  d.log.at = Date.now();
  d.log.drift = driftOf(d.log);
  pw.touch();
  return d.log;
}

/**
 * 对话里"我把 X 做完了" → 真的把专注记到任务上。
 *
 * 为什么必须记：不记的话任务还是 0 专注，AI 下次重排时看到的仍是"没做过"，
 * 会让他重做一遍 —— 这和收工填报的 credit() 是同一个坑，只是入口换成了自然语言。
 * 口径与 credit() 一致：只增不减，做满即自动完成。
 * list: [{ taskId, add }]，add = 这次新做的专注数（不是累计）。
 */
export function creditPomos(list) {
  let n = 0;
  (list || []).forEach(i => {
    if (!i || !i.taskId) return;
    const add = Math.floor(Number(i.add) || 0);
    if (add <= 0) return;
    // 顺带找出任务属于哪个目标（creditPomo 需要 goalId 才能落到统计里）
    const gs = pw.get().goals;
    let gid = '';
    for (let k = 0; k < gs.length; k++) {
      const hit = (gs[k].tasks || []).filter(x => x.id === i.taskId)[0];
      if (hit) { gid = gs[k].id; break; }
    }
    if (!gid) return;
    // 同样走统计口径：对话里说过的话要变成热力图和 forecast 认的账
    if (pw.creditPomo(gid, i.taskId, add, { src: 'chat' }) > 0) n++;
  });
  return n;
}

export function moodLabel(key) {
  const m = MOODS.filter(x => x.key === key)[0];
  return m ? m.label : '';
}

/** 偏差的一句话概括（首页提示条用） */
export function driftText(log) {
  if (!log) return '';
  const bits = [];
  const miss = (log.items || []).filter(i => (i.actual || 0) < (i.planned || 0)).length;
  if (miss) bits.push(miss + ' 项没做完');
  if ((log.ahead || []).length) bits.push('提前做了 ' + log.ahead.length + ' 项后面的');
  if (log.extras) bits.push('还做了计划外的事');
  return bits.join(' · ');
}

/**
 * 给 AI 看的那段「计划 vs 实际」。
 * 写成自然语言而不是 JSON：模型的指令遵循在"看得懂的事实"上更稳，
 * 而这一段的重点恰恰是让它自己判断该怎么调。
 */
export function summaryFor(log) {
  if (!log) return '';
  const lines = [];
  lines.push('【今日收工填报：计划 vs 实际】');
  (log.items || []).forEach(i => {
    const p = i.planned || 1;
    const a = i.actual || 0;
    const tag = a >= p ? '完成' : (a > 0 ? '做了一部分（' + a + '/' + p + '）' : '完全没做');
    lines.push('- 第' + i.day + '天「' + i.title + '」计划 ' + p + ' 专注，实际 ' + a + ' → ' + tag);
  });
  (log.ahead || []).forEach(i => {
    lines.push('- 提前做了后面第' + i.day + '天的「' + i.title + '」' + (i.actual || 0) + ' 段专注');
  });
  if (log.extras) lines.push('- 计划之外还做了：' + log.extras);
  if ((log.facts || []).length) lines.push('- 本人今天补充说：' + factsText(log) + '（已核对任务进度，不必因此调整）');
  if (log.mood) lines.push('- 今天状态：' + moodLabel(log.mood));
  if (log.note) lines.push('- 本人备注：' + log.note);
  // 图只给本人回看（模型看不懂二进制），但条数是个信号：愿意贴图说明今天真做了事
  if ((log.photos || []).length) lines.push('- 本人还贴了 ' + log.photos.length + ' 张今天的成果图');
  return lines.join('\n');
}
