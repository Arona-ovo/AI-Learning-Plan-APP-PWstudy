// _tools/check-onboarding.js - 首次使用引导（新手引导）的接线校验
// 运行：node _tools/check-onboarding.js
//
// 这套引导最容易坏在"改了别处、引导静默失效"上：
//   1) 步骤表里混回背单词的内容（这版是给 PWstudy 用的，查词/背单词/词书一律不许有）
//   2) target 的 class / ref 被改名了 —— 量不到矩形，那一步会被"自动跳过"，
//      用户永远看不到，而且没有任何报错
//   3) 量不到时没有自动跳过（把用户卡死在遮罩里）
//   4) 硬控 / 返回键这些退出口没接
//   5) 步骤文案没配英文 —— 遮罩是 $t(step.title) 动态取键，check-i18n 扫不到
//
// 只读，不改源码。
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load.js');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const ONB = path.join(ROOT, 'utils', 'onboarding.js');
const HOME = path.join(ROOT, 'pages', 'home', 'home.vue');
const SETTINGS = path.join(ROOT, 'pkgManage', 'pages', 'settings', 'settings.vue');
const EN = path.join(ROOT, 'utils', 'i18n-en.js');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

const onbSrc = fs.readFileSync(ONB, 'utf8');
const homeSrc = fs.readFileSync(HOME, 'utf8');
const setSrc = fs.readFileSync(SETTINGS, 'utf8');
const enSrc = fs.readFileSync(EN, 'utf8');

/* ⚠️ 先剥注释再扫：本文件的说明里就写满了"背单词/查词"这些词，不剥会把自己命中 */
const onbCode = onbSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 切出某个方法的函数体（护栏正则别跨方法匹配 —— 会命中别处的同名代码，已踩过） */
// ⚠️ 生命周期钩子（onBackPress 等）是 2 空格缩进、methods 里的才是 4 空格 —— 两种都要认
function fnBody(src, name) {
  const m = new RegExp('^\\s{2,4}' + name + '\\s*\\(', 'm').exec(src);
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

/* ---------- 1. 推进逻辑（真跑一遍纯函数） ---------- */
console.log('== 1. 推进逻辑（把 utils/onboarding.js 真跑一遍）==');

const store = { onboarding: { done: false, v: 0, at: 0 } };
const settingsStub = {
  get() { return { onboarding: store.onboarding }; },
  set(patch) { if (patch && patch.onboarding) store.onboarding = patch.onboarding; }
};
let ob = null;
try {
  ob = load('utils/onboarding.js', { settings: settingsStub });
  ok('模块能加载（settings 用桩：不碰真实存储）');
} catch (e) {
  bad('模块加载失败：' + e.message);
}

if (ob) {
  const n = ob.count();
  assert(n > 0, '步骤数 > 0（' + n + ' 步）');
  assert(ob.stepAt(0) && ob.stepAt(0).target === null, '第一步是欢迎步（无高亮，整屏居中）');
  assert(ob.stepAt(n) === null, '越界的 stepAt 返回 null（调用方据此收尾）');

  // 从 0 一路推到底：必须终止，且正好走 n 步
  let i = 0, guard = 0, done = false;
  while (guard++ < 100) {
    const r = ob.advance(i, n);
    i = r.index;
    if (r.done) { done = true; break; }
  }
  assert(done && i === n, '一路点「下一步」能正常收尾（走了 ' + i + '/' + n + ' 步）');
  assert(guard < 100, '不会死循环');

  // 异常配置：步骤表空了也不能把人卡死
  assert(ob.advance(0, 0).done === true, '步骤数为 0 时直接判定完成（绝不卡死在遮罩里）');

  // 完成状态
  ob.finish();
  assert(store.onboarding.done === true, 'finish() 落盘 done=true');
  assert(ob.shouldShow() === false, '完成后不再放');
  ob.restart();
  assert(store.onboarding.done === false, 'restart() 清掉完成标记（设置页「重看」）');
  assert(ob.shouldShow() === true, '重看后又会再放一遍');
  ob.finish(); // 还原，避免影响别的用例
}

/* ---------- 2. 步骤表里不许有背单词内容 ---------- */
console.log('');
console.log('== 2. 步骤内容只讲 PWstudy（没有背单词遗留）==');
const VOCAB = ['查词', '背单词', '词书', '词库', '错题', '例句', '单词', '复习', 'AI 指令'];
VOCAB.forEach(w => {
  assert(onbCode.indexOf(w) < 0, '步骤表里没有「' + w + '」');
});

/* ---------- 3. 每一步的锚点都真实存在（最会静默失效的一处） ---------- */
console.log('');
console.log('== 3. 每一步的高亮目标在源码里真的找得到 ==');

// 从源码里抠出 target 行：{ sel: '.x' } / { ref: 'y', sel: '.z' } / null
const steps = [];
const stepRe = /id:\s*'([a-zA-Z0-9_]+)'[\s\S]*?target:\s*(\{[^}]*\}|null)/g;
let m;
while ((m = stepRe.exec(onbCode))) {
  const t = m[2];
  let target = null;
  if (t !== 'null') {
    const sel = /sel:\s*'([^']+)'/.exec(t);
    const ref = /ref:\s*'([^']+)'/.exec(t);
    target = { sel: sel ? sel[1] : '', ref: ref ? ref[1] : '' };
  }
  steps.push({ id: m[1], target: target });
}
assert(steps.length > 0, '抠出 ' + steps.length + ' 个步骤');

// ref → 组件文件：从模板里找 <tag ... ref="x">，再从 import 里找同名的组件路径
function componentOf(ref) {
  const tagRe = new RegExp('<([a-zA-Z][\\w-]*)[^>]*\\bref="' + ref + '"');
  const mt = tagRe.exec(homeSrc);
  if (!mt) return null;
  const tag = mt[1];
  const pascal = tag.replace(/-([a-z])/g, (s, c) => c.toUpperCase()).replace(/^./, (c) => c.toUpperCase());
  const impRe = /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/g;
  let mi;
  while ((mi = impRe.exec(homeSrc))) {
    if (mi[1].toLowerCase() === pascal.toLowerCase()) {
      return path.resolve(path.dirname(HOME), mi[2]);
    }
  }
  return null;
}

steps.forEach((s) => {
  if (!s.target) return; // 欢迎步：没有目标，不需要锚点
  const { sel, ref } = s.target;
  assert(/^\./.test(sel), '「' + s.id + '」的 sel 是 class 选择器（' + sel + '）');
  const cls = sel.replace(/^\./, '');
  if (ref) {
    assert(new RegExp('\\bref="' + ref + '"').test(homeSrc), '「' + s.id + '」在首页上有 ref="' + ref + '"');
    const file = componentOf(ref);
    if (!file || !fs.existsSync(file)) {
      bad('「' + s.id + '」找不到 ref="' + ref + '" 对应的组件文件');
      return;
    }
    const src = fs.readFileSync(file, 'utf8');
    assert(new RegExp('class="[^"]*\\b' + cls + '\\b').test(src),
      '「' + s.id + '」在 ' + path.basename(file) + ' 里有 .' + cls);
    // 组件内部元素页面的 query 选不进去，必须靠组件自己的 rect()
    assert(/rect\s*\(\s*sel/.test(src), '「' + s.id + '」的组件自带 rect(sel, cb)（否则量不到）');
  } else {
    assert(new RegExp('class="[^"]*\\b' + cls + '\\b').test(homeSrc),
      '「' + s.id + '」在首页里有 .' + cls);
  }
});

/* ---------- 4. 首页接线 ---------- */
console.log('');
console.log('== 4. 首页真的接了引导（含量不到就自动跳过）==');
assert(/import\s+\*\s+as\s+onboarding\s+from/.test(homeSrc), '首页 import 了 utils/onboarding.js');
assert(/<onboarding-mask/.test(homeSrc), '首页渲染了 onboarding-mask');
['step', 'index', 'total', 'box', 'dark'].forEach(p => {
  assert(new RegExp(':' + p + '="gd').test(homeSrc), '遮罩接了 :' + p);
});
assert(/@next="guideNext"/.test(homeSrc) && /@skip="guideSkip"/.test(homeSrc), '遮罩的 next / skip 都接了');
assert(/maybeGuide\(\)/.test(homeSrc), 'onShow 里会尝试放引导');

const measure = fnBody(homeSrc, 'measureStep');
assert(measure.length > 0, '能切到 measureStep() 的函数体');
// ⚠️ 只认"拿到空矩形"那一个分支里的跳过：别处（ref 拿不到组件 / query 抛错）也有
//    guideAdvance()，在函数体里泛泛地找会跨分支命中 —— 真把跳过删了也还是绿（已踩过）
const got = /const got = \(rect\) => \{([\s\S]*?)\n {6}\}/.exec(measure);
assert(!!got, '能切到 measureStep 里的 got(rect) 回调');
assert(got && /guideAdvance\(\)/.test(got[1]), '量到的矩形是空的时候自动跳到下一步（不把用户卡死）');
const endGuide = fnBody(homeSrc, 'endGuide');
const stopGuide = fnBody(homeSrc, 'stopGuide');
assert(/onboarding\.finish\(\)/.test(endGuide), 'endGuide() 落盘"看过了"（下次不再放）');
assert(stopGuide.length > 0 && !/finish\(\)/.test(stopGuide), 'stopGuide() 只收起、不记完成（硬控顶掉时下次再放）');
const back = fnBody(homeSrc, 'onBackPress');
assert(/gdOn/.test(back), '返回键先收引导（否则按返回会退出 App）');

/* ---------- 5. 设置页「重看」 ---------- */
console.log('');
console.log('== 5. 设置页有「重看引导」入口 ==');
assert(/import\s+\*\s+as\s+onboarding\s+from/.test(setSrc), '设置页 import 了 utils/onboarding.js');
assert(/replayGuide/.test(setSrc), '有 replayGuide 入口');
const replay = fnBody(setSrc, 'replayGuide');
assert(replay.length > 0, '能切到 replayGuide() 的函数体');
assert(/onboarding\.restart\(\)/.test(replay), 'replayGuide 调了 restart()');
assert(/switchTab/.test(replay), 'replayGuide 直接跳回首页（点了当场就能看到）');

/* ---------- 6. 步骤文案都有英文（遮罩是动态 $t，check-i18n 扫不到） ---------- */
console.log('');
console.log('== 6. 步骤文案都有英文译文 ==');
const texts = [];
const reT = /title:\s*'([^']*)'/g;
const reB = /body:\s*'([^']*)'/g;
while ((m = reT.exec(onbCode))) texts.push(m[1]);
while ((m = reB.exec(onbCode))) texts.push(m[1]);
assert(texts.length === steps.length * 2, '抠出 ' + texts.length + ' 条文案（' + steps.length + ' 步 × 标题+正文）');
const miss = texts.filter(t => enSrc.indexOf("'" + t + "'") < 0);
assert(miss.length === 0, miss.length === 0
  ? '每条文案在 i18n-en.js 里都有译文'
  : '缺英文：' + miss.slice(0, 3).join(' / '));

console.log('');
console.log(fail === 0 ? '新手引导校验全部通过' : '失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);
