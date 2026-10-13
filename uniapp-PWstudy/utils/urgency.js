// utils/urgency.js - 今日紧迫度：把"还剩多少活 / 还剩多少时间 / 有多赶"算成几个可视量
//
// 为什么单独一个模块：首页那张紧迫度卡要做到**几乎没有文字**，
// 靠环的填充、呼吸的快慢、方块的数量、时间条的占位这四个图形说话 ——
// 那就必须先把"紧迫"这件模糊的事算成确定的数字，而且可以单测。
//
// 三个维度（用户要的三件事）：
//   · 剩余时间  availMin —— 今天到 24:00 还剩多少分钟能拿来学
//   · 完成难度  difficulty —— 剩下的活相对"这个人日常能吃的量"有多重
//   · 紧迫性    score —— 时间够不够 + 有没有超期 + 期限还远不远，合成 0-100
//
// 计算全部走确定性规则，不调 AI：首页每次 onShow 都要算，不能等网络。

import * as pw from './pwstore.js';
import * as pacing from './pacing.js';

// 可用时间下限：夜里 11 点 55 分算出来只剩 5 分钟，会把分数顶到爆表 ——
// 那种时候真正的信号是"今天来不及了"，而不是"还差一点点"，所以夹一下。
const MIN_AVAIL = 30;
// 一天的总分钟（时间条按 24h 画，现在时刻与"需要的时长"都落在这一条上）
const DAY_MIN = 1440;
// 方块最多画几个（再多卡片就挤了，超出的折进 overflow）
const MAX_BLOCKS = 12;

/** 档位色：从容 → 正常 → 紧张 → 告急（红=危险，与项目其它警示色一致） */
const LV_COLOR = ['#3b6d11', '#F79009', '#E5484D', '#bb1332'];
/** 同色的淡底：档位胶囊要用"淡底 + 同色字"，模板里拿不到 color 的 alpha 版本 */
const LV_SOFT = [
  'rgba(59, 109, 17, 0.12)',
  'rgba(247, 144, 9, 0.14)',
  'rgba(229, 72, 77, 0.13)',
  'rgba(187, 19, 50, 0.14)'
];

function clamp(n, lo, hi) {
  const v = Number(n) || 0;
  return v < lo ? lo : (v > hi ? hi : v);
}

/** 两个 'YYYY-MM-DD' 之间差几天（b - a） */
function dayDiff(a, b) {
  const x = new Date(String(a) + 'T00:00:00').getTime();
  const y = new Date(String(b) + 'T00:00:00').getTime();
  if (isNaN(x) || isNaN(y)) return -1;
  return Math.round((y - x) / 86400000);
}

/**
 * 期限压力 0-1：越近越紧。
 * 没有 deadline（-1）不算压力 —— 不知道就不瞎紧张。
 */
function deadlinePressure(days) {
  if (days < 0) return 0;
  if (days <= 0) return 1;
  if (days <= 3) return 0.8;
  if (days <= 7) return 0.5;
  if (days <= 14) return 0.25;
  return 0.1;
}

/**
 * 算一次紧迫度。
 * @param {number} [now] 时间戳，默认当前（传值是为了可测）
 */
export function compute(now) {
  const t = now ? new Date(now) : new Date();
  const focus = pacing.focusLen();

  // ---- ① 今天还没做完的活 ----
  const queue = pw.todayQueue(50);
  let leftPomos = 0, totalPomos = 0, overdue = 0;
  for (let i = 0; i < queue.length; i++) {
    const task = queue[i].task || {};
    const total = Math.max(0, Number(task.pomos) || 0);
    const done = clamp(task.donePomos, 0, total);
    totalPomos += total;
    leftPomos += total - done;
    if (queue[i].overdue) overdue += 1;
  }
  const donePomos = Math.max(0, totalPomos - leftPomos);
  const needMin = leftPomos * focus;

  // ---- ② 今天还剩多少时间 ----
  const midnight = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, 0, 0, 0).getTime();
  const availMin = Math.max(MIN_AVAIL, Math.round((midnight - t.getTime()) / 60000));
  const passedMin = clamp(DAY_MIN - availMin, 0, DAY_MIN);

  // ---- ③ 日常负荷基准（难度按"这个人平时吃多少"衡量，不按绝对值） ----
  let dailyMin = 0;
  const gs = pw.activeGoals();
  for (let i = 0; i < gs.length; i++) {
    const d = Number(gs[i].dailyMin) || 0;
    if (d > dailyMin) dailyMin = d;
  }
  if (!dailyMin) dailyMin = 60;

  // ---- ④ 最近的 deadline ----
  let days = -1;
  for (let i = 0; i < gs.length; i++) {
    if (!gs[i].deadline) continue;
    const d = dayDiff(pw.today(), gs[i].deadline);
    if (d >= 0 && (days < 0 || d < days)) days = d;
  }

  // ---- ⑤ 合成紧迫性 ----
  const ratio = needMin / availMin;                       // >1 = 时间不够
  let score = Math.min(1, ratio) * 55                     // 时间压力 0-55
    + (Math.min(3, overdue) / 3) * 20                     // 超期 0-20
    + deadlinePressure(days) * 25;                        // 期限 0-25
  // 时间已经不够了，就不该再显示为"从容"：至少顶到紧张档
  if (ratio > 1) score = Math.max(score, 60);
  score = Math.round(clamp(score, 0, 100));

  const level = score < 25 ? 0 : (score < 50 ? 1 : (score < 75 ? 2 : 3));

  // ---- ⑥ 难度：剩下的活相对日常负荷 ----
  let difficulty = (needMin / Math.max(30, dailyMin)) * 60 + Math.min(3, overdue) * 5;
  difficulty = Math.round(clamp(difficulty, 0, 100));

  return {
    score: score,
    level: level,
    color: LV_COLOR[level],
    soft: LV_SOFT[level],
    // 呼吸周期：越急跳得越快（从容 3.2s → 告急 0.8s）
    beatMs: Math.round(3200 - score * 24),
    needMin: needMin,
    availMin: availMin,
    ratio: ratio,
    over: ratio > 1,          // 时间不够 → 时间条顶满并闪
    leftPomos: leftPomos,
    totalPomos: totalPomos,
    donePomos: donePomos,
    overdue: overdue,
    days: days,               // -1 = 没设期限
    difficulty: difficulty,
    // 时间条：整条 = 24 小时；这三个都是百分比，模板直接写进 style
    passedPct: Math.round(passedMin / DAY_MIN * 1000) / 10,
    nowPct: Math.round(clamp(passedMin, 0, DAY_MIN) / DAY_MIN * 1000) / 10,
    fillPct: Math.round(clamp(needMin / DAY_MIN, 0, 1) * 1000) / 10,
    blocks: blocksOf(donePomos, leftPomos),
    overflow: totalPomos > MAX_BLOCKS,
    empty: totalPomos === 0
  };
}

/**
 * 番茄方块：done 个空心 + left 个实心，总数封顶。
 * 超过上限时从**已完成**那头开始砍 —— 用户关心的是还剩几个，不是做了几个。
 */
function blocksOf(done, left) {
  const total = done + left;
  if (total <= MAX_BLOCKS) {
    const out = [];
    for (let i = 0; i < done; i++) out.push('done');
    for (let i = 0; i < left; i++) out.push('left');
    return out;
  }
  const out = [];
  const keepDone = Math.max(0, MAX_BLOCKS - left);
  for (let i = 0; i < keepDone; i++) out.push('done');
  for (let i = 0; i < Math.min(left, MAX_BLOCKS - keepDone); i++) out.push('left');
  return out;
}

/** 给界面看的四档名字（只有点开说明弹窗才用得到，卡片本身不显示文字） */
export function levelName(level) {
  return ['从容', '正常', '紧张', '告急'][clamp(level, 0, 3)] || '正常';
}

export { MAX_BLOCKS, LV_COLOR, LV_SOFT };
