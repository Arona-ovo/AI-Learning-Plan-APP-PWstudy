// utils/mascot.js - 看板娘 plana 的表情调度（多邻国式：状态决定表情）
//
// 表情不是随机换的：由「今天做没做 + 最近摆没摆 + 截止日紧不紧」三条确定性规则决定，
// 优先级从高到低（命中最上面的就停）：
//   0. 没有进行中的目标                     → plana    默认脸（捂嘴打招呼）
//   1. 截止日已过、还有任务没做完           → sad      委屈：拖过期了
//   2. 截止日剩 ≤3 天、今天还没做完         → shock    震惊：要来不及了
//   3. 今天一个番茄都没有：
//      · 连续 ≥4 天没学（且目标立了 ≥4 天） → angry    真生气了
//      · 连续 ≥2 天没学（且目标立了 ≥2 天） → sad
//      · 超期任务 ≥3 个                     → surprise 诶？堆了这么多？
//   4. 今天全部做完                         → 连续学 ≥3 天 → tongue 得意，否则 happy
//   5. 一个没做：上午 calm / 下午 nervous / 晚上 sad（一天还长 → 开始慌 → 该收工了）
//   6. 做了一部分：超期的比剩下的多 → nervous，否则 calm
//   7. 兜底                                 → plana
//
// 纯读不写：所有输入都来自 pwstore 的公开 API，不碰 storage、不起定时器。
// 页面只在 onShow 时调一次 pick() 就够 —— 表情跟着"打开 App 那一刻"的状态走。

import * as pw from './pwstore.js';

export const FACES = {
  plana: '/static/mascot/plana.jpg',       // 捂嘴（默认脸，头像 / 图标同源）
  calm: '/static/mascot/calm.jpg',         // 平静
  happy: '/static/mascot/happy.jpg',       // 开心笑
  tongue: '/static/mascot/tongue.jpg',     // 吐舌得意
  surprise: '/static/mascot/surprise.jpg', // 惊讶 o 嘴
  shock: '/static/mascot/shock.jpg',       // 震惊
  nervous: '/static/mascot/nervous.jpg',   // 紧张波浪嘴
  sad: '/static/mascot/sad.jpg',           // 委屈扁嘴
  angry: '/static/mascot/angry.jpg'        // 生气
};

export function srcOf(key) {
  return FACES[key] || FACES.plana;
}

/** 今天该做的任务（day <= 已过天数）：共几件、完成几件、超期几件 */
function todayStats() {
  const t0 = pw.today();
  let total = 0;
  let done = 0;
  let overdue = 0;
  const gs = pw.activeGoals();
  for (let i = 0; i < gs.length; i++) {
    const g = gs[i];
    const elapsed = pw.dayDiff(pw.dateStr(new Date(g.createdAt)), t0) + 1;
    const tasks = g.tasks || [];
    for (let j = 0; j < tasks.length; j++) {
      const t = tasks[j];
      if ((t.day || 1) > elapsed) continue;
      total++;
      if (t.status === 'done' || (t.donePomos || 0) >= (t.pomos || 1)) done++;
      else if (t.day < elapsed) overdue++;
    }
  }
  return { total, done, overdue, left: total - done };
}

/** 从昨天往前数，连续几天一个番茄都没有（不含今天） */
function idleDays() {
  const days = pw.recentDays(9);   // 旧 → 新，最后一个是今天
  let n = 0;
  for (let i = days.length - 2; i >= 0; i--) {
    if ((days[i].pomo || 0) > 0) break;
    n++;
  }
  return n;
}

/** 从昨天往前数，连续几天有番茄（不含今天）——决定 happy 还是 tongue */
function streakDays() {
  const days = pw.recentDays(9);
  let n = 0;
  for (let i = days.length - 2; i >= 0; i--) {
    if ((days[i].pomo || 0) > 0) n++;
    else break;
  }
  return n;
}

/** 最早的 active 目标立了多少天（新用户不翻旧账：立目标当天不存在"摆烂"） */
function goalAgeDays(goals) {
  let first = '';
  for (let i = 0; i < goals.length; i++) {
    const d = pw.dateStr(new Date(goals[i].createdAt));
    if (!first || d < first) first = d;
  }
  return first ? pw.dayDiff(first, pw.today()) : 0;
}

/**
 * 挑一个表情。now 可传时间戳 / Date（测试用），缺省取当前时间。
 * 返回 { key, src }。
 */
export function pick(now) {
  const d = now ? new Date(now) : new Date();
  const goals = pw.activeGoals();
  if (!goals.length) return { key: 'plana', src: FACES.plana };

  const s = todayStats();
  const todayPomo = pw.overview().pomo;
  const notFinished = s.total > 0 && s.left > 0;

  // 1. 截止日已过还有活没干完 → 委屈
  if (notFinished) {
    const expired = goals.some(g => pw.dayDiff(pw.today(), g.deadline) < 0);
    if (expired) return { key: 'sad', src: FACES.sad };
  }

  // 2. 截止日迫近（≤3 天）且今天还没做完 → 震惊
  if (notFinished) {
    const urgent = goals.some(g => {
      const left = pw.dayDiff(pw.today(), g.deadline);
      return left >= 0 && left <= 3;
    });
    if (urgent) return { key: 'shock', src: FACES.shock };
  }

  // 3. 今天还没动静：先看摆烂，再看超期堆积（新用户不翻旧账）
  if (todayPomo === 0) {
    const age = goalAgeDays(goals);
    const idle = idleDays();
    if (idle >= 4 && age >= 4) return { key: 'angry', src: FACES.angry };
    if (idle >= 2 && age >= 2) return { key: 'sad', src: FACES.sad };
    if (s.overdue >= 3) return { key: 'surprise', src: FACES.surprise };
  }

  // 4. 今天全做完：老学员得意吐舌，今天刚完成开心笑
  if (s.total > 0 && s.left === 0) {
    const key = streakDays() >= 3 ? 'tongue' : 'happy';
    return { key, src: FACES[key] };
  }

  // 5. 一个没做：看时段（一天还长 → 开始慌 → 该收工了）
  if (s.done === 0) {
    const h = d.getHours();
    const key = h < 12 ? 'calm' : (h < 18 ? 'nervous' : 'sad');
    return { key, src: FACES[key] };
  }

  // 6. 做了一部分：超期的比剩下的多，压力大于成就感
  const key = s.overdue > (s.total - s.overdue) ? 'nervous' : 'calm';
  return { key, src: FACES[key] };
}
