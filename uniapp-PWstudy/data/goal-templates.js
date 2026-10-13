// data/goal-templates.js - 常见目标的起步模板
//
// 为什么需要：第一次打开 App 的人面对"输入一个远期目标"是懵的，
// 一句话模板能把门槛降到"点一下"。模板只给骨架（里程碑划分 + 关键任务示例），
// 真正的排期仍然交给 AI —— 避免模板变成死板的课程表。
//
// 每个模板：
//   title      目标标题（用户可改）
//   raw        喂给 AI 的补充说明（水平、约束、重点）
//   dailyMin   建议每天投入
//   spanDays   建议跨度（用来预填截止日期）
//   level      默认起点描述
//   milestones 里程碑骨架（给 AI 作参考，不是最终排期）
//   hints      给 AI 的重点提示（这门考试真正的坑）

export const TEMPLATES = [
  {
    key: 'fj_zsb_english',
    name: '福建专升本英语',
    icon: '升',
    title: '福建专升本英语考到 90 分',
    raw: '福建专升本公共课英语，目标 90 分。目前大概 60 分水平，词汇量薄弱，语法基本靠语感。',
    dailyMin: 90,
    spanDays: 180,
    level: '60 分左右，词汇弱',
    milestones: ['词汇打底', '语法梳理', '专项刷题', '真题冲刺'],
    hints: '专升本英语的核心是先堆词汇量再谈技巧；单选和完形吃词汇，阅读吃长难句。'
  },
  {
    key: 'cet4',
    name: '四级 500 分',
    icon: '四',
    title: '四级考到 500 分',
    raw: '大学英语四级，目标 500 分。听力是短板，阅读速度还行，写作没练过。',
    dailyMin: 60,
    spanDays: 90,
    level: '四级水平未知，听力弱',
    milestones: ['词汇与听力入门', '听力专项', '阅读提速', '写作翻译', '整套模考'],
    hints: '四级听力占比高且提分快，建议每天保证听力输入；写作背模板性价比最高。'
  },
  {
    key: 'cet6',
    name: '六级 550 分',
    icon: '六',
    title: '六级考到 550 分',
    raw: '大学英语六级，目标 550 分。已过四级 500 分，词汇量一般，阅读长难句吃力。',
    dailyMin: 60,
    spanDays: 120,
    level: '已过四级 500 分',
    milestones: ['词汇补强', '长难句突破', '听力精听', '真题与模考'],
    hints: '六级的分水岭在长难句和听力；精听（听写）比泛听有效得多。'
  },
  {
    key: 'kaoyan_eng2',
    name: '考研英语二',
    icon: '研',
    title: '考研英语二考到 70 分',
    raw: '考研英语二，目标 70 分。基础一般，作文没准备过，需要兼顾专业课。',
    dailyMin: 90,
    spanDays: 240,
    level: '基础一般，要兼顾专业课',
    milestones: ['词汇与长难句', '阅读精练', '写作模板', '真题模考', '查漏补缺'],
    hints: '英语二得阅读者得天下；作文要提前两个月开始背并默写，别拖到最后一周。'
  },
  {
    key: 'gaokao_english',
    name: '高考英语 130',
    icon: '高',
    title: '高考英语考到 130 分',
    raw: '高考英语，目标 130 分。现在 105 分左右，完形和作文丢分多。',
    dailyMin: 60,
    spanDays: 200,
    level: '105 分左右',
    milestones: ['词汇过关', '语法与完形', '阅读提速', '写作与改错', '模拟冲刺'],
    hints: '高考英语提分最快的通常是作文和阅读；词汇要过到看见能反应出意思的程度。'
  },
  {
    key: 'custom_skill',
    name: '一项技能',
    icon: '技',
    title: '三个月内把一项技能练到能用的水平',
    raw: '想把一项技能练到能独立做出东西的水平（比如剪辑、编程、画画），愿意每天固定投入。',
    dailyMin: 60,
    spanDays: 90,
    level: '零基础',
    milestones: ['入门与模仿', '拆件练习', '做一个完整作品', '复盘与迭代'],
    hints: '技能类目标必须尽早做完整作品，"一直练习不做东西"是最常见的坑。'
  }
];

export function templateOf(key) {
  for (let i = 0; i < TEMPLATES.length; i++) {
    if (TEMPLATES[i].key === key) return TEMPLATES[i];
  }
  return null;
}

/** 模板 → 规划输入（截止日期按 spanDays 从今天推） */
export function seedOf(tpl, todayStr) {
  const t = tpl || {};
  return {
    title: t.title || '',
    raw: [t.raw || '', t.hints ? '重点：' + t.hints : '', (t.milestones && t.milestones.length)
      ? '建议阶段划分：' + t.milestones.join(' / ') : ''].filter(Boolean).join(' '),
    dailyMin: t.dailyMin || 60,
    level: t.level || '',
    spanDays: t.spanDays || 90,
    today: todayStr || ''
  };
}
