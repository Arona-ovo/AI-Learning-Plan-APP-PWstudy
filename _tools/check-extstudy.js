// _tools/check-extstudy.js - 外部（已关联学习 App）学习数据的落库与"每日重新分析"
// 运行：node _tools/check-extstudy.js
//
// 真机反馈（2026-10-14）：「从单词 APP 获取的学习数据……包括完成的时间、完成的时间范围，
// 都要进行统计，存入用户本地，然后第二天或每日任务都完成以后都要重新结合分析」。
//
// 守四件事：
//   1) 落库：完成时刻 + **时间范围**都要真的存下来（只有分钟总数答不出"他几点在学"）
//   2) 不重复记账：分钟**总数**只认 byApp，ext[] 只是明细 —— 同一笔时长记两处早晚对不上
//   3) 时间范围的三个来源按可信度排序，且**绝不能给出一个离谱的范围**
//      （拿几小时前的出发时间去框，会把半天都算成"在学习"）
//   4) 分析要真的接上：重排（全部完成 / 跨天兜底）与收工对话两条路都带得上这份数据
//
// 只读，不改源码。
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./lib/load');

const PW = path.join(ROOT, 'utils', 'pwstore.js');
const LINK = path.join(ROOT, 'utils', 'link.js');
const PARTNER = path.join(ROOT, 'utils', 'partner.js');
const HARVEST = path.join(ROOT, 'utils', 'harvest.js');
const COACH = path.join(ROOT, 'utils', 'coach.js');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

const pwSrc = fs.readFileSync(PW, 'utf8');
const linkSrc = fs.readFileSync(LINK, 'utf8');
const partnerSrc = fs.readFileSync(PARTNER, 'utf8');
const harvestSrc = fs.readFileSync(HARVEST, 'utf8');
const coachSrc = fs.readFileSync(COACH, 'utf8');

/** 先剥注释（第 12 条硬约束） */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** 切函数体（第 22 / 25 条：不要有界窗口，两种形态顺序不能反） */
function fnBody(src, name) {
  let m = new RegExp('^[ \\t]*(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*' + name + '\\s*\\(', 'm').exec(src);
  if (!m) m = new RegExp('^[ \\t]{2,6}' + name + '\\s*\\(', 'm').exec(src);
  if (!m) return '';
  const j = src.indexOf('{', m.index + m[0].length);
  if (j < 0) return '';
  let d = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(j, k + 1); }
  }
  return src.slice(j);
}

/* ---------- 1. 数据层：明细真的存得下 ---------- */
console.log('== 1. pwstore：外部学习明细 ==');
['addExtStudy', 'extStudyOf', 'extStudySummary', 'spanText'].forEach(fn => {
  assert(new RegExp('export function ' + fn + '\\s*\\(').test(strip(pwSrc)), '导出 ' + fn + '()');
});
const aes = fnBody(strip(pwSrc), 'addExtStudy');
assert(/at: to/.test(aes) && /from: from/.test(aes) && /to: to/.test(aes),
  '一条明细同时存"完成时刻 at"与"时间范围 from→to"');
assert(/to - min \* 60000/.test(aes),
  '没给起点时由"完成时刻往前推时长"倒推（至少不会空着）');
assert(/if \(from > to\) from = to - min \* 60000/.test(aes),
  '起点晚于终点时退回倒推（不许框出一个比时长还长的空壳范围）');
assert(/d\.ext\.length > 80/.test(aes), '明细有上限（别让老数据无限长）');
assert(!/byApp/.test(aes),
  'addExtStudy 不碰 byApp —— 分钟总数只认一份，明细不是第二份总账');

const ess = fnBody(strip(pwSrc), 'extStudySummary');
assert(/byHour\[h\]/.test(ess) && /topHours/.test(ess),
  '摘要按时段摊开（回答"他通常几点在学"）');
assert(/avgMin/.test(ess), '摘要给出"平均每次多久"（决定一段该排多少量）');

/* ---------- 2. 协议与落库入口 ---------- */
console.log('== 2. link.js：收时间范围 + 记出发 ==');
assert(/from: link\.params\.from/.test(linkSrc) && /to: link\.params\.to/.test(linkSrc),
  'vocab-done 认得 from / to 两个可选字段');
assert(/at: link\.params\.at/.test(linkSrc), '也认得 at（只给完成时刻的情况）');
assert(/partner\.takeLaunch\(min\)/.test(linkSrc), '落库时取"这一趟的出发时刻"当起点');
const op = fnBody(strip(linkSrc), 'openPartner');
assert(/partner\.noteLaunch\(/.test(op), '呼出去之前记下出发时刻');
assert(linkSrc.indexOf('partner.noteLaunch(') < linkSrc.indexOf('plus.runtime.openURL(url)'),
  '出发时刻记在 openURL **之前**（跳过去以后本进程随时可能被回收）');
const re = fnBody(strip(linkSrc), 'recordExternal');
assert(/pw\.addExtStudy\(/.test(re), 'recordExternal 落明细（不是只加一个总数）');

/* ---------- 3. 出发时刻的保鲜期（不给离谱的范围） ---------- */
console.log('== 3. partner：出发时刻有保鲜期 ==');
assert(/export function noteLaunch/.test(partnerSrc) && /export function takeLaunch/.test(partnerSrc),
  '导出 noteLaunch / takeLaunch');
const tl = fnBody(strip(partnerSrc), 'takeLaunch');
assert(/write\(\{ launch: null \}\)/.test(tl), '取走即作废（一笔出发只配一次回传）');
assert(/Date\.now\(\) - Number\(l\.at\) > budget/.test(tl), '超出保鲜期就返回 null');
assert(/\+ 60\) \* 60000/.test(tl), '保鲜期 = 建议时长 + 60 分钟（不是"当天之内"这种大框）');

/* ---------- 4. 分析要真的接上 ---------- */
console.log('== 4. 两条分析链路都带得上这份数据 ==');
const eb = fnBody(strip(harvestSrc), 'extraBlock');
assert(/externalBlock\(\)/.test(eb), '重排的 extraBlock 拼进了外部学习数据');
// extraBlock 是两条自动重排主线的唯一入口（全部完成 / 跨天兜底都走 runReplanOnce）
assert(/runReplanOnce[\s\S]*?extraBlock\(\)/.test(harvestSrc), '两条主线共用 extraBlock（都吃得到）');
assert(/extStudySummary/.test(coachSrc), '收工对话的底稿里也有（"第二天"来填报时看得到）');
const extBlk = fnBody(strip(harvestSrc), 'externalBlock');
assert(/pw\.spanText\(sp\.from, sp\.to\)/.test(extBlk), '给 AI 的是**时间范围**不是只有总数');
assert(/move 把任务挪开/.test(extBlk), '明说"冲突用 move 挪开"（别硬塞）');

/* ---------- 5. 真跑：落库口径 ---------- */
console.log('== 5. 真跑落库 ==');
const mem = {};
global.uni = Object.assign(global.uni || {}, {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
});

{
  const pw = load('utils/pwstore.js', {});
  pw.init();
  const day = pw.today();

  // ① 最简回传（只有 min / words）：起点由完成时刻倒推
  const launchUsed = { n: 0 };
  const partnerMock = {
    takeLaunch: () => { launchUsed.n++; return null; },
    noteSync: () => {},
    noteLaunch: () => true
  };
  const link = load('utils/link.js', { pw: pw, partner: partnerMock });
  const okRec = link.recordExternal(25, { words: 30, task: 't1' });
  assert(okRec === true, 'recordExternal 接受回传');
  const d = pw.get().daily[day];
  assert(d.byApp['app:awword'] === 25, '分钟进了 byApp（首页/统计页口径，实际 ' + d.byApp['app:awword'] + '）');
  assert(pw.vocabWords(day) === 30, '词数进了 vocabWords');
  assert(d.ext && d.ext.length === 1, '落了一条明细');
  const it = d.ext[0];
  assert(it.min === 25 && it.words === 30 && it.taskId === 't1', '明细带上了分钟 / 词数 / 任务');
  assert(it.to === it.at && it.to > 0, '明细记录了完成时刻');
  assert(it.from === it.to - 25 * 60000, '没给起点 → 由完成时刻倒推出范围（' + pw.spanText(it.from, it.to) + '）');

  // ② 对方给了 from / to：以对方为准
  const A = it.to + 3600000;
  const B = A + 20 * 60000;
  link.recordExternal(20, { words: 0, from: A, to: B });
  const it2 = pw.get().daily[day].ext[1];
  assert(it2.from === A && it2.to === B, '对方给了 from/to → 原样采用（不倒推）');
  assert(pw.get().daily[day].byApp['app:awword'] === 45, '两次的分钟累加进同一份总数（45）');

  // ③ 我们自己记的出发时刻：比倒推更准，用它当起点
  // 出发时刻必须在**过去**且在保鲜期内（建议 25 分钟 + 60 分钟）
  const launchAt = Date.now() - 25 * 60000;
  // ⚠️ 假 partner 也要"取走即作废"：不消费的话第二次回传还会拿到同一个出发时刻，
  //    于是"只有词数"那条会凭空多出一段范围 —— 假数据把真逻辑带偏。
  let launchBox = { at: launchAt, minutes: 25 };
  const partnerMock2 = {
    takeLaunch: () => { const l = launchBox; launchBox = null; return l; },
    noteSync: () => {},
    noteLaunch: () => true
  };
  const link2 = load('utils/link.js', { pw: pw, partner: partnerMock2 });
  link2.recordExternal(25, { words: 10 });
  const it3 = pw.get().daily[day].ext[2];
  assert(it3.from === launchAt, '有出发时刻 → 用它当起点（比倒推准）');
  assert(it3.to - it3.from >= 25 * 60000, '起点到完成时刻 ≈ 这一趟的真实长度');

  // ③b 出发时刻离谱（在未来）：不许拿它当起点，退回倒推
  const partnerMock3 = {
    takeLaunch: () => ({ at: Date.now() + 7200000, minutes: 25 }),
    noteSync: () => {},
    noteLaunch: () => true
  };
  const link3 = load('utils/link.js', { pw: pw, partner: partnerMock3 });
  link3.recordExternal(15, { words: 1 });
  const it3b = pw.get().daily[day].ext[pw.get().daily[day].ext.length - 1];
  assert(it3b.from === it3b.to - 15 * 60000, '出发时刻离谱时退回倒推（不框出离谱的范围）');

  // ④ 只有词数没有时长也要留痕（背单词 App 可能只回传词数）
  const before = pw.get().daily[day].ext.length;
  link2.recordExternal(0, { words: 12 });
  assert(pw.get().daily[day].ext.length === before + 1, '只有词数也记一条明细（时长 0 不是"没学过"）');

  // ⑤ 摘要：时段 / 次数 / 平均（5 条：25 / 20 / 25 / 15 / 0 分钟）
  const s = pw.extStudySummary(day, 1);
  assert(s && s.times === 5, '摘要统计出 5 次（实际 ' + (s && s.times) + '）');
  assert(s && s.min === 85, '摘要的分钟 = 25+20+25+15+0 = 85（实际 ' + (s && s.min) + '）');
  assert(s && s.words === 53, '摘要的词数 = 30+0+10+1+12 = 53（实际 ' + (s && s.words) + '）');
  assert(s && s.topHours.length >= 1 && s.byHour[s.topHours[0]] > 0, '算得出"集中在几点"');
  // 5 条里有 4 条带时长 → 4 段范围；只有词数那条（时长 0）没有范围，
  // 这正是对的：0 分钟不该凭空框出一段"在学习"的时间
  assert(s && s.spans.length === 4, '摘要带时间范围（' + (s && s.spans.length) + ' 段）');
  assert(s && s.avgMin === Math.round(85 / 5), '平均每次 = 17 分钟（实际 ' + (s && s.avgMin) + '）');
  assert(pw.spanText(A, B).indexOf('-') > 0, 'spanText 给出"起-止"（' + pw.spanText(A, B) + '）');
  assert(pw.spanText(A, 0).indexOf('起') > 0, '只有起点时说"几点起"（' + pw.spanText(A, 0) + '）');

  // ⑥ 空数据不炸
  assert(pw.extStudySummary('1999-01-01', 3) === null, '没数据时摘要返回 null（不是空壳）');
  assert(pw.extStudyOf('1999-01-01').length === 0, '没数据时明细是空数组');
  assert(pw.addExtStudy(day, { min: 0, words: 0 }) === null, '既没时长也没词数 → 不落库');
}

console.log('');
console.log(fail === 0 ? '外部学习数据校验全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);
