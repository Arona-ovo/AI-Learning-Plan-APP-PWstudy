// utils/word-session.js - 「刷单词」模式的组牌逻辑（纯本地，不走 AI）
//
// 和「翻译练习」是两条互不干扰的链路，分工如下：
//   翻译练习 = 围绕句子出题（i+1 选词 → AI 造句 → 中英互译），考的是"会不会用这个词"
//   刷单词   = 直接对着词表和掌握度排优先级，考的是"认不认识这个词"
// 两者只有回写口径共用（engine.recordAnswer + iplus1.recordMastery），
// 这样首页的今日数据 / 连续天数 / 掌握度概览两种练法都算数，但统计不用改第二套。
//
// 组牌不发请求：排序、配干扰项、找例句都在本地算完，所以点进去就是第一题，
// 没有"正在生成例句…"的等待。

import * as wordbook from './wordbook.js';
import * as sentenceIndex from './sentence-index.js';

// 三种题目来源：
//   daily  日常：整本书按"该练程度"排队，新词优先、掌握度低的优先
//   review 复习：只取学过但还没掌握的词（m <= WEAK_M），期末一周刷的就是它
//   new    新词：只取完全没见过的词 —— 和首页「每日新词」目标天然对齐
export const SOURCES = ['daily', 'review', 'new'];

// 每组默认词量。固定值而不再加一个"每日刷词目标"：
// 已经有「每日新词」目标（按 fs 首见统计）在管节奏，这里只负责一次给多少词。
export const DECK_SIZE = { min: 5, max: 60, def: 20 };

const MASTERED_M = 4;
const WEAK_M = 2;
const MAX_OPTIONS = 4;

// 一个词"该练"的程度：越大越靠前。
// 三档 FedEx：①完全没见过排最前（不然新词永远轮不到，书背不完）
// ②掌握度越低越靠前（快要忘的先巩固）③练过很多次的往后排
// ——最后一条是关键：只按掌握度排的话，一批卡在 m=0 的硬骨头会把整组题占满，
//   其它词再也排不进来，用户感觉"怎么老是这几个词"。
function needScore(rec) {
  const jitter = Math.random();
  if (!rec) return 200 + jitter * 20;
  const m = Number(rec.m) || 0;
  const seen = Number(rec.seen) || 0;
  return 40 + (5 - Math.min(5, m)) * 30 - Math.min(24, seen) + jitter * 15;
}

export function statusKey(rec) {
  if (!rec) return 'new';
  const m = Number(rec.m) || 0;
  if (m >= MASTERED_M) return 'mastered';
  if (m >= WEAK_M + 1) return 'familiar';
  return 'learning';
}

/** 词书里的词按掌握情况分档计数（首页「刷单词」卡要用） */
export function counts(bookId) {
  const all = wordbook.bookWords(bookId) || [];
  const map = wordbook.masteryMap(bookId) || {};
  const out = { total: all.length, new: 0, learning: 0, familiar: 0, mastered: 0 };
  all.forEach(e => {
    out[statusKey(map[e.id] || null)]++;
  });
  return out;
}

/** 组牌：按来源筛一遍，再按 needScore 降序取前 n 个 */
export function pickWords(n, bookId, source) {
  const map = wordbook.masteryMap(bookId) || {};
  const rows = (wordbook.bookWords(bookId) || []).map(e => {
    const rec = map[e.id] || null;
    return { entry: e, rec: rec, need: needScore(rec) };
  });
  let pool = rows;
  if (source === 'new') {
    pool = rows.filter(x => !x.rec);
  } else if (source === 'review') {
    pool = rows.filter(x => x.rec && (Number(x.rec.m) || 0) <= WEAK_M);
  }
  pool.sort((a, b) => b.need - a.need);
  const want = Math.max(0, Math.min(DECK_SIZE.max, Number(n) || 0));
  return pool.slice(0, want).map(x => x.entry);
}

// 干扰项：优先同词性的其它词 —— 四个选项都是名词时才有迷惑性，
// 混一个动词进去一眼就看出来了，那种"假难度"没有训练价值。
// 词书太小凑不满时降级到任意词性的其它词。
function distractors(entry, pool) {
  const own = String(entry.w || '').toLowerCase();
  const pos = String(entry.pos || '');
  const used = {};
  const answer = String(entry.m || '').trim();
  used[answer] = true;
  const same = [];
  const other = [];
  (pool || []).forEach(p => {
    if (!p || !p.m) return;
    if (String(p.w || '').toLowerCase() === own) return;
    const mean = String(p.m || '').trim();
    if (!mean || used[mean]) return;
    used[mean] = true;
    if (String(p.pos || '') === pos) same.push(mean);
    else other.push(mean);
  });
  return { same: same, other: other };
}

// 打乱后放回：正确答案必须跟着换位，否则 answerIndex 会指到别人身上
function pack(raw, answer) {
  const arr = raw.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return { options: arr, answerIndex: Math.max(0, arr.indexOf(answer)) };
}

// 例句优先级：导入词自带的例句 > 本地语料反查。
// 语料里同一个词可能有好几句，取难度最接近、句子最短的那条 ——
// 短句更容易和单词本身绑定记忆。
function pickExample(entry) {
  const own = String(entry.exampleEn || '').trim();
  if (own) return { en: own, zh: String(entry.exampleZh || '').trim() };
  let list = [];
  try {
    list = sentenceIndex.candidates(entry.w) || [];
  } catch (e) {
    list = [];
  }
  if (!list.length) return null;
  const elv = Number(entry.lv) || 0;
  let best = list[0];
  for (let i = 1; i < list.length; i++) {
    const s = list[i];
    const gap = Math.abs((Number(s.lv) || 0) - elv);
    const cur = Math.abs((Number(best.lv) || 0) - elv);
    if (gap < cur) best = s;
    else if (gap === cur && String(s.en || '').length < String(best.en || '').length) best = s;
  }
  return { en: String(best.en || ''), zh: String(best.zh || '') };
}

/**
 * 把词表里的一个词变成一道"刷单词"的题。
 * 返回体刻意带上 words / wordIds —— 回写要喂给 iplus1.recordMastery 与
 * engine.recordAnswer，两者都靠 q.words[].id 认词；少了它掌握度会一笔不写。
 */
export function toItem(entry, pool, bookId) {
  const map = wordbook.masteryMap(bookId) || {};
  const rec = map[entry.id] || null;
  const answer = String(entry.m || '').trim();
  const d = distractors(entry, pool);
  const bag = d.same.concat(d.other);
  const raw = [answer].concat(bag.slice(0, MAX_OPTIONS - 1));
  const packed = pack(raw, answer);
  const example = pickExample(entry);
  return {
    id: entry.id,
    w: entry.w,
    pos: entry.pos || '',
    m: entry.m || '',
    lv: entry.lv || 1,
    custom: !!entry.custom,
    options: packed.options,
    answerIndex: packed.answerIndex,
    exampleEn: example ? example.en : '',
    exampleZh: example ? example.zh : '',
    mastery: rec ? (Number(rec.m) || 0) : 0,
    seen: rec ? (Number(rec.seen) || 0) : 0,
    status: statusKey(rec),
    wordIds: [entry.id],
    words: [{ id: entry.id, w: entry.w, pos: entry.pos, m: entry.m }]
  };
}

/**
 * 组一组题。
 * 每组的干扰项候选池是「整本书」，不是「这组词」—— 只从 20 个词里找干扰项的话，
 * 四个选项会因为全都做过多轮往返而显得眼熟，等于变相提示。
 */
export function buildDeck(n, bookId, source) {
  const words = pickWords(n, bookId, source);
  const pool = wordbook.bookWords(bookId) || [];
  return words.map(e => toItem(e, pool, bookId));
}
