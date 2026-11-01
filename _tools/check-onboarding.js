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
// 末步「填 API」的行动按钮：遮罩要抛 action，首页要接住并真的跳转 ——
// 只加文案、不接线的话，那一步就是一段说明文字，白占一个步骤位
assert(/@action="guideAction"/.test(homeSrc), '遮罩的 action 事件接上了 guideAction');
const gAction = fnBody(homeSrc, 'guideAction');
assert(gAction.length > 0 && /ai-setup/.test(homeSrc),
  'guideAction() 会跳到填 API 的页面');
assert(/gdAiReady/.test(homeSrc), '引导开场会记下"AI 配没配"（决定末步在不在场）');
assert(/guideOpts\(\)/.test(homeSrc), '步骤表现场条件由 guideOpts() 供给');

const measure = fnBody(homeSrc, 'measureStep');
assert(measure.length > 0, '能切到 measureStep() 的函数体');
// ⚠️ 量不到时的出口集中在 guideMiss()：别在 measureStep 里泛泛找 guideAdvance，
//    那个函数体里还有别的分支（ref 拿不到组件），跨分支命中会假绿（已踩过）。
const missFn = fnBody(homeSrc, 'guideMiss');
assert(missFn.length > 0, '能切到 guideMiss() 的函数体（量不到目标时的唯一出口）');
assert(/guideAdvance\(\)/.test(missFn), '没图可画的时候自动跳到下一步（不把用户卡死）');
assert(/gdBox = rect[\s\S]{0,200}?gdStep = step/.test(fnBody(homeSrc, 'guideShow')),
  'guideShow() 一处写 gdBox + gdStep（挖洞态与居中态共用，别各写一遍）');
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

// 行动按钮上的字也是界面文案（遮罩里是 $t(step.actionText)，同样是动态取键）
const act = /actionText:\s*'([^']*)'/.exec(onbCode);
assert(!!act, '末步的按钮文案写在步骤表里（actionText）');
assert(act && enSrc.indexOf("'" + act[1] + "'") >= 0, '「' + (act ? act[1] : '') + '」有英文译文');

/* ---------- 7. 屏幕尺寸 / 横竖屏适配（真跑布局计算，不只看有没有那行代码） ---------- */
console.log('');
console.log('== 7. 屏幕尺寸与横竖屏适配 ==');

const MASK = path.join(ROOT, 'components', 'onboarding-mask', 'onboarding-mask.vue');
const maskSrc = fs.readFileSync(MASK, 'utf8');
const maskCode = maskSrc.replace(/<!--[\s\S]*?-->/g, '');
// 步骤数：用户明确要求 3-5 步，多了没人点得下去
assert(steps.length >= 3 && steps.length <= 5,
  '步骤数在 3-5 步之间（实际 ' + steps.length + ' 步）');

// 视口尺寸不能只在 created 里读一次：转屏 / 分屏 / 折叠屏展开都会改
// ⚠️ 判据要认"订阅动作"而不是"方法名"：方法名还出现在 typeof 的可用性判断里，
//    只测名字的话，把订阅那行删掉照样绿（反向测试第 12/13 条专门盯这个）
// 行动按钮（末步「现在去填」）：点的是 onAction，不是 onNext。
// 也别写成 v-else-if="step.action" —— 与 v-if 同条件，第二个分支永远不成立，
// 主按钮直接消失，静态看着还挺像对的。
assert(/@tap\.stop="onAction"/.test(maskCode), '行动按钮绑的是 onAction（不是 onNext）');
assert(!/v-else-if="step\.action"/.test(maskCode), '没有 v-else-if="step.action" 这种自相矛盾的分支');
assert(/actionText/.test(maskCode), '按钮上的字取 step.actionText');
assert(/uni\.onWindowResize\(/.test(maskCode), '遮罩订阅了窗口尺寸变化（转屏后重排）');
assert(/uni\.offWindowResize\(/.test(maskCode), '遮罩在卸载时解绑尺寸监听');
const mUnmount = fnBody(maskSrc, 'unmounted');
assert(/offWindowResize/.test(mUnmount), '解绑写在 unmounted 里（页面走了就停，别越积越多）');
assert(/'resize'/.test(maskSrc), '遮罩会回抛 resize 事件');
assert(/@resize="guideResize"/.test(homeSrc), '首页接了 resize 并重测当前步');
const gResize = fnBody(homeSrc, 'guideResize');
assert(gResize.length > 0 && /measureStep\(\)/.test(gResize), 'guideResize() 真的会重新量目标矩形');

// 目标滚出视口：算 scrollTop 滚进去再量一次，别整步吞掉
const mFirst = fnBody(homeSrc, '_measureFirst');
assert(mFirst.length > 0, '能切到 _measureFirst()（依次量主锚点 / 兜底锚点）');
assert(/measureStep\(true\)/.test(mFirst), '重测只做一次（retried 防来回滚死循环）');
assert(/sels/.test(mFirst) && /i \+ 1/.test(mFirst), '主锚点量不到会换下一个候选（兜底锚点）');
const mScroll = fnBody(homeSrc, '_scrollTo');
assert(/pageScrollTo/.test(mScroll), '目标不在视口里会先滚进视口再量');
assert(/scrollTop/.test(mScroll), '自己算 scrollTop（只丢 selector 给 App 端不一定认）');
const mInView = fnBody(homeSrc, '_inView');
assert(/0\.6/.test(mInView), '判"看得见"允许被压住一截（太严会把底部那步退成纯文字）');
assert(/vh - 72|vh-72/.test(mInView), '判"看得见"给悬浮底栏留出位置');
// 指示箭头
assert(/class="gd-arrow"/.test(maskCode), '气泡带指示箭头（指向高亮）');
assert(/gd-arrow-below/.test(maskCode) && /gd-arrow-above/.test(maskCode),
  '箭头有朝上 / 朝下两态（气泡在目标上方 / 下方）');

// ---- 真跑一遍组件的 layout()：把 <script> 抽出来实例化 ----
const scriptBlock = /<script>([\s\S]*?)<\/script>/.exec(maskSrc);
let mask = null;
try {
  const body = scriptBlock[1].replace('export default', 'return ');
  const factory = new Function('uni', body);
  mask = factory({
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667 }),
    onWindowResize: () => {},
    offWindowResize: () => {}
  });
  ok('能实例化遮罩组件的 script（uni 用桩）');
} catch (e) {
  bad('抽不出遮罩的 script：' + e.message);
}

if (mask) {
  /** 造一个组件实例：data + computed(getter) + methods 都绑到同一个 this 上 */
  function inst(sw, sh, box, extra) {
    const o = Object.assign({}, mask.data(), { sw: sw, sh: sh }, extra || {});
    Object.keys(mask.computed || {}).forEach(k => {
      Object.defineProperty(o, k, { get: mask.computed[k].bind(o), configurable: true });
    });
    Object.keys(mask.methods || {}).forEach(k => { o[k] = mask.methods[k].bind(o); });
    o.box = box;
    return o;
  }
  /** 从 'left:12px;top:34px;width:320px;' 里抠数字 */
  function num(style, key) {
    const m = new RegExp(key + ':(-?\\d+(?:\\.\\d+)?)px').exec(style || '');
    return m ? Number(m[1]) : NaN;
  }

  // ① 竖屏：目标在中部 → 气泡贴下方，且不超出屏底
  let v = inst(375, 667, { left: 20, top: 100, width: 335, height: 120 });
  let L = v.layout;
  assert(L.side === 'below', '竖屏目标在中部 → 气泡贴目标下方');
  assert(num(L.tip, 'top') + v.estTipH <= 667, '竖屏气泡不超出屏底（估算高 ' + v.estTipH + '）');

  // ② 竖屏：目标贴底 → 翻到上方
  v = inst(375, 667, { left: 20, top: 560, width: 335, height: 100 });
  L = v.layout;
  assert(L.side === 'above', '竖屏目标贴底 → 气泡翻到目标上方');
  assert(num(L.tip, 'top') >= 0, '翻到上方后气泡顶不穿屏幕（top=' + num(L.tip, 'top') + '）');

  // ③ 横屏：目标占了大半屏，上下都塞不下 → 居中兜底
  v = inst(667, 375, { left: 20, top: 60, width: 627, height: 300 });
  L = v.layout;
  assert(L.side === 'center', '横屏上下都放不下 → 气泡居中兜底');
  const cTop = num(L.tip, 'top');
  assert(cTop >= 0 && cTop + v.estTipH <= 375, '居中气泡整体在视口内（' + cTop + ' ~ ' + (cTop + v.estTipH) + '）');
  assert(v.estTipH < 190, '横屏时气泡估算高度收紧（' + v.estTipH + ' < 190），别照搬竖屏');

  // ④ 目标半露在屏幕外 → 挖洞夹回视口（不夹就是"一整片黑、不知道在看哪"）
  v = inst(375, 667, { left: -50, top: -30, width: 400, height: 200 });
  L = v.layout;
  const hl = num(L.hole, 'left'), ht = num(L.hole, 'top');
  const hw = num(L.hole, 'width'), hh = num(L.hole, 'height');
  assert(hl >= 0 && ht >= 0, '挖洞被夹回视口左上角（left=' + hl + ' top=' + ht + '）');
  assert(hl + hw <= 375 && ht + hh <= 667, '挖洞右下角不超出视口');

  // ⑤ 箭头：水平对齐挖洞中心，且夹在气泡内（不露到气泡外）
  v = inst(375, 667, { left: 20, top: 100, width: 335, height: 120 });
  L = v.layout;
  const ax = num(L.arrow, 'left');
  const tw = num(L.tip, 'width');
  assert(ax >= 0 && ax <= tw - 26, '箭头夹在气泡内（left=' + ax + ' 宽 ' + tw + '）');
  const holeCx = num(L.hole, 'left') + num(L.hole, 'width') / 2;
  assert(Math.abs((num(L.tip, 'left') + ax + 8) - holeCx) <= 2,
    '箭头指向挖洞中心（偏差 ' + Math.round(Math.abs((num(L.tip, 'left') + ax + 8) - holeCx)) + 'px）');
}

/* ---------- 8. 每一步都有画面，且能回退 ---------- */
console.log('');
console.log('== 8. 每步都有画面（不再是一张纯文字卡）+ 能回退 ==');
// 8.1 每个步骤都配 art：量不到目标时退成居中，总得有一张图，不然就是一屏干文字
const artCount = (onbCode.match(/\bart:\s*'/g) || []).length;
assert(artCount === steps.length, '每个步骤都配了 art（' + artCount + '/' + steps.length + '）');
const arts = [];
const reArt = /art:\s*'([a-z]+)'/g;
let ma;
while ((ma = reArt.exec(onbCode))) arts.push(ma[1]);
// 8.2 遮罩真的画得出这些图（步骤表里写了 art，组件没这分支 = 白配）
assert(/class="gd-art"/.test(maskCode), '遮罩里有示意图容器 .gd-art');
assert(/'gd-art-' \+ step\.art/.test(maskCode), '示意图按 step.art 分型');
arts.forEach(a => {
  assert(maskCode.indexOf('step.art === \'' + a + '\'') >= 0, '遮罩画得出「' + a + '」这种示意图');
});
assert(/v-if="step\.art"/.test(maskCode), '示意图只在没有高亮时才出现（有挖洞就不必再画）');
// 8.3 气泡模板只留一份：以前挖洞态 / 居中态各抄一遍，改文案必漏一处
assert((maskCode.match(/class="gd-title"/g) || []).length === 1,
  '标题只渲染一处（没有第二份复制粘贴的气泡）');
assert((maskCode.match(/class="gd-body"/g) || []).length === 1, '正文也只渲染一处');
// 8.4 上一步：误点「下一步」不至于没得救
assert(/@tap\.stop="onPrev"/.test(maskCode), '气泡里有「上一步」按钮');
assert(/emits:\s*\[[^\]]*'prev'/.test(maskCode), '遮罩声明了 prev 事件');
assert(/onPrev\(\)\s*\{[\s\S]{0,80}\$emit\('prev'\)/.test(maskCode), 'onPrev 把事件抛回页面');
assert(/v-if="index > 0"/.test(maskCode), '第 1 步不显示「上一步」');
assert(/@prev="guidePrev"/.test(homeSrc), '首页接了 prev');
const gPrev = fnBody(homeSrc, 'guidePrev');
assert(gPrev.length > 0, '能切到 guidePrev() 的函数体');
assert(/gdIndex -= 1|gdIndex = this\.gdIndex - 1/.test(gPrev), 'guidePrev() 真的退一步');
assert(/measureStep\(\)/.test(gPrev), '退回去后重新量目标（上一步可能已经滚出视口）');
// 8.5 贴卡片底部的目标必须有兜底锚点（收工键被底栏压住是常态）
assert(/fallback:\s*'\./.test(onbCode), '「今日收工」那步配了兜底锚点（贴底部的目标易被压住）');
assert(/sels\.push\(step\.fallback\)/.test(fnBody(homeSrc, 'measureStep')),
  '首页真的会把兜底锚点加进候选');

console.log('');
console.log(fail === 0 ? '新手引导校验全部通过' : '失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);
