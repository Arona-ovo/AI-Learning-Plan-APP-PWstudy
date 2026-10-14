// utils/pacing.js - 学习能力画像：从历史数据推断"这个人一天真能吃多少专注"
//
// 为什么要有它：AI 排期过去只看用户填的 dailyMin —— 那是**意愿**，不是**能力**。
// 意愿 240 分钟、实际每天只完成 2 段专注的计划，第一天起就是假的，
// 后面全部跟着错位。排期必须按事实走：近期真实完成的专注数、收工填报的完成率。
//
// 消费方：
//   · plan-agent（AI 提示词 + 本地兜底排期）—— 容量与完成率
//   · replan 提示词 —— 判断"追不追得上"
//   · 专注页 —— 任务剩余量折算预计时长
//
// 学习科学口径（写死在这里，不靠模型自觉）：
//   · 认知负荷上限：成人高效专注约 4 小时/天 ≈ 8 段专注，超过就拆阶段，不是硬扛
//   · 遗忘曲线：新记忆 24h 内掉得最快 → 复习任务安排在第 1/2/4/7/15 天，间隔递增
//   · 间隔重复：复习任务必须"轻"（1-2 段专注），它维持记忆而不是制造新负荷
import * as pw from './pwstore.js';
import * as dailylog from './dailylog.js';

/** 每日新学内容上限（专注数）。≈ 200 分钟纯专注，是多数人能长期维持的量 */
export const DAILY_CAP = 8;

/** 单段专注的分钟数（跟随设置，兜底 25） */
export function focusLen() {
  const c = pw.get().pomoCfg || {};
  const n = Number(c.focus) || 0;
  return n > 0 ? n : 25;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * 学习画像。
 *
 * 样本口径：
 *   · 能量 —— 近 14 天 daily.pomo（只有跑完的专注才计数，中断/补记口径已统一）
 *   · 完成率 —— 近 7 天收工填报 sum(actual)/sum(planned)。填报页已按真实专注预填，
 *     不会虚增；没填过的日子不进样本（不猜）
 *   · 完全没有数据（samples < 3）= 新用户，capacity 返回 0，由调用方按 dailyMin 兜底
 */
export function profile() {
  const st = pw.get();
  const pomos = [];
  let planned = 0;
  let actual = 0;
  for (let k = 0; k < 14; k++) {
    const d = st.daily[pw.addDays(pw.today(), -k)];
    if (!d) continue;
    if (d.pomo > 0) pomos.push(d.pomo);
    const log = d.log;
    if (log && (log.items || []).length && k < 7) {
      (log.items || []).forEach(i => {
        planned += (i.planned || 0);
        actual += Math.min(i.actual || 0, i.planned || 0);
      });
    }
  }
  const isNew = pomos.length < 3;
  const med = median(pomos);
  const sum = pomos.reduce((a, b) => a + b, 0);
  // 中位数抗单日爆发（昨天冲刺 10 个不代表今天也是 10 个）；
  // ×1.2 给一点"比舒适区略高"的上探空间 —— 略高于现状才会进步，高太多只会崩
  const capacity = isNew ? 0 : Math.max(2, Math.min(DAILY_CAP, Math.ceil(med * 1.2)));
  return {
    samples: pomos.length,        // 有真实学习记录的天数
    med: med,                     // 中位数专注/天
    avg: pomos.length ? Math.round((sum / pomos.length) * 10) / 10 : 0,
    capacity: capacity,           // 排期用的每日专注容量（0 = 样本不足）
    completeRate: planned > 0 ? Math.round((actual / planned) * 100) / 100 : null,
    streak: dailylog.shortStreak(''),
    isNew: isNew
  };
}

/** 没有历史时的兜底容量：按用户填的目标时长折算，同样夹在上限内 */
export function capacityOf(dailyMin) {
  return Math.max(1, Math.min(DAILY_CAP, Math.round((Number(dailyMin) || 60) / 25)));
}

/** 给 AI 看的一段画像文字（plan 与 replan 共用） */
export function promptText(dailyMin) {
  const p = profile();
  if (p.isNew) {
    return '暂无足够历史（新用户或刚启用），按每天 ' + capacityOf(dailyMin) +
      ' 段专注估算，前几天排轻一点（约 60-70% 容量）帮用户建立节奏。';
  }
  let t = '近 ' + p.samples + ' 个学习日日均 ' + p.avg + ' 段专注（中位数 ' + p.med +
    '），**排期容量按每天不超过 ' + p.capacity + ' 段专注**，宁可留 20% 余量。';
  if (p.completeRate != null) {
    t += '近 7 天填报完成率 ' + Math.round(p.completeRate * 100) + '%' +
      (p.completeRate < 0.7 ? '（偏低：说明此前排太重了，这次要明显减量）' : '（健康）') + '。';
  }
  if (p.streak >= 2) {
    t += '已连续 ' + p.streak + ' 天没做完：这不是偷懒，是计划超出了能力，本次排期要比历史容量再保守 10-20%。';
  }
  return t;
}
