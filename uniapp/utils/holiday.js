// utils/holiday.js - 日期性质判定（法定假 / 调休补班 / 周末 / 工作日）
//
// 给两个地方用：
//   1) AI 规划/重排的 prompt —— 把"这段时间里有哪几天是假期"告诉模型，让它别排满；
//   2) 排期后的确定性减量 —— 模型说了不算，假期上的任务统一按规则削（见 plan-agent）。
import { HOLIDAYS, MAKEUP, LAST_YEAR } from '../data/holidays.js';

const DAY = 86400000;

export function pad(n) { return n < 10 ? '0' + n : '' + n; }

export function toStr(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function today() {
  return toStr(new Date());
}

export function toDate(s) {
  const p = String(s || '').split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

export function addDays(s, n) {
  const d = toDate(s);
  d.setDate(d.getDate() + Number(n || 0));
  return toStr(d);
}

export function diffDays(a, b) {
  return Math.round((toDate(b) - toDate(a)) / DAY);
}

function listOf(year) {
  return (HOLIDAYS && HOLIDAYS[year]) || [];
}

function makeupOf(year) {
  return (MAKEUP && MAKEUP[year]) || [];
}

/**
 * 某天是什么性质：
 *   'holiday' 法定假期（含调休拼出来的连休）
 *   'makeup'  调休补班（周末但要上班 → 当工作日排）
 *   'weekend' 普通周末
 *   'normal'  工作日
 *   'unknown' 超出内置数据年份且非周末 → 只能当工作日
 */
export function dayType(dateStr) {
  const s = String(dateStr || '').slice(0, 10);
  const year = Number(s.slice(0, 4)) || 0;
  const list = listOf(year);
  for (let i = 0; i < list.length; i++) {
    if (s >= list[i].from && s <= list[i].to) return 'holiday';
  }
  if (makeupOf(year).indexOf(s) >= 0) return 'makeup';
  const w = toDate(s).getDay();
  if (w === 0 || w === 6) return 'weekend';
  return year > LAST_YEAR ? 'unknown' : 'normal';
}

/** 假期名（不是假期返回 ''） */
export function holidayName(dateStr) {
  const s = String(dateStr || '').slice(0, 10);
  const list = listOf(Number(s.slice(0, 4)) || 0);
  for (let i = 0; i < list.length; i++) {
    if (s >= list[i].from && s <= list[i].to) return list[i].name;
  }
  return '';
}

export function isRestDay(dateStr) {
  const t = dayType(dateStr);
  return t === 'holiday' || t === 'weekend';
}

/** 这天该打几折：假期 0.5（减半）、周末 0.8、其余 1 */
export function factorOf(dateStr) {
  const t = dayType(dateStr);
  if (t === 'holiday') return 0.5;
  if (t === 'weekend') return 0.8;
  return 1;
}

/**
 * 一段区间里的假期清单（给 prompt 用）。
 * 返回 [{name, from, to, days}]，按开始日排序；超出内置数据年份就没有。
 */
export function holidaysIn(from, to, limit) {
  const cap = limit || 12;
  const out = [];
  const a = String(from || '').slice(0, 10);
  const b = String(to || '').slice(0, 10);
  const y0 = Number(a.slice(0, 4)) || 0;
  const y1 = Number(b.slice(0, 4)) || 0;
  for (let y = y0; y <= y1; y++) {
    listOf(y).forEach(h => {
      if (h.to < a || h.from > b) return;
      const s = h.from < a ? a : h.from;
      const e = h.to > b ? b : h.to;
      out.push({ name: h.name, from: s, to: e, days: diffDays(s, e) + 1 });
    });
  }
  out.sort((x, y) => (x.from < y.from ? -1 : 1));
  return out.slice(0, cap);
}

/** 区间内的调休补班日 */
export function makeupIn(from, to) {
  const a = String(from || '').slice(0, 10);
  const b = String(to || '').slice(0, 10);
  const out = [];
  const y0 = Number(a.slice(0, 4)) || 0;
  const y1 = Number(b.slice(0, 4)) || 0;
  for (let y = y0; y <= y1; y++) {
    makeupOf(y).forEach(d => { if (d >= a && d <= b) out.push(d); });
  }
  return out.sort();
}

/**
 * 给 AI 看的一段话。没有内置数据也要说清楚"我只知道周末"，别让模型以为没有假期。
 */
export function summaryFor(from, to) {
  const hs = holidaysIn(from, to);
  const mk = makeupIn(from, to);
  const y1 = Number(String(to || '').slice(0, 4)) || 0;
  const lines = [];
  if (hs.length) {
    lines.push('法定假期：' + hs.map(h => h.name + ' ' + h.from + '~' + h.to + '（' + h.days + ' 天）').join('；'));
  } else {
    lines.push('法定假期：这段时间没有法定长假（周末照常休息）');
  }
  if (mk.length) lines.push('调休补班（要上班/上课，按工作日排）：' + mk.join('、'));
  if (y1 > LAST_YEAR) {
    lines.push('注意：' + (LAST_YEAR + 1) + ' 年及以后的法定假期我还没有数据，请只按周末规律估计。');
  }
  lines.push('排期要求：假期和周末的每日任务量要相应下调，不要排满；别把关键任务压在长假第一天。');
  return lines.join('；');
}
