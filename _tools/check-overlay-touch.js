// _tools/check-overlay-touch.js - 「浮层必须在自己这层截断手势」校验（只读）
//
// 起因（2026-10-26 真机反馈）：首页右上角那颗键点开的「管理」面板，
// 在上面上下滑，背后的首页跟着一起滚 —— fixed 只是**视觉**上盖住了页面，
// 层级并没有断开：touchmove 会顺着 DOM 冒泡到页面根（切 tab 的手势就挂在那儿），
// 默认行为还会去滚背后的页面。
//
// 本脚本守住这套契约（三条，缺一条就会长出"穿过去了"或"里面滚不动"）：
//   1) 遮罩根节点（class 带 mask / gd-root）必须有 @touchmove.stop.prevent
//      —— stop 断冒泡（不然会被根容器的手势接走），prevent 吞默认滚动。
//   2) 若遮罩里含 scroll-view，卡片那一层必须有 @touchmove.stop 且**不能** prevent
//      —— 父级 preventDefault 会把子滚动一起取消掉，面板内容就再也划不动了。
//   3) 同上情形，滚动容器自身要写 overscroll-behavior: contain
//      —— stop 只断了冒泡，**默认的那条滚动链还在**：面板内容没占满时
//         手指一划照样能把背后的首页拉起来（scroll chaining）。
let fs = null;
let path = null;
try {
  fs = require('fs');
  path = require('path');
} catch (e) {
  // 被别的运行器 require 时的兜底
}

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

const walk = (dir, out) => {
  fs.readdirSync(dir).forEach((n) => {
    if (n === 'node_modules' || n === 'unpackage') return;
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (n.endsWith('.vue')) out.push(p);
  });
  return out;
};

// ⚠️ 硬约束：先剥注释再扫。注释里会讨论这些字节（"必须加 @touchmove.stop.prevent"
//    这类话就写在改动的注释里），不剥的话删掉真代码照样全绿 —— 假绿。
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));

/**
 * 取出 <template> 段。
 * ⚠️ 不能按 `<template[\s\S]*?>(\s\S]*?)<\/template>` 一块块配：SFC 里普遍写着
 *    嵌套的 <template v-if> / <template v-else>（apps.vue 就有两处），非贪婪匹配会在
 *    第一个内层 </template> 处收工 —— 那之后的半剥内容（编辑弹窗就在那儿）整段漏扫。
 *    人为把它删掉，护栏照样全绿（假绿，反向测试里有这一条盯着）。
 *    所以取"最外层那对"：第一个 <template> 开标签之后，到最后一个 </template>。
 */
function templateOf(src) {
  const openAt = src.indexOf('<template');
  if (openAt < 0) return '';
  const openEnd = src.indexOf('>', openAt);
  if (openEnd < 0) return '';
  const close = src.lastIndexOf('</template>');
  return close > openEnd ? src.slice(openEnd + 1, close) : '';
}
function styleOf(src) {
  const out = [];
  const openAt = src.indexOf('<style');
  if (openAt < 0) return '';
  const openEnd = src.indexOf('>', openAt);
  const close = src.lastIndexOf('</style>');
  if (openEnd < 0 || close <= openEnd) return '';
  return src.slice(openEnd + 1, close);
}

const files = walk(ROOT, []);
console.log('扫描 ' + files.length + ' 个 .vue：浮层手势截断');

// 遮罩层的识别：class 里带 mask（fs-mask / pop-mask / sheet-mask / egg-mask …）
// 例外 onboarding-mask 用的是 gd-root —— "全屏模态层"的意思，一并守。
const isMaskClass = (cls) => /mask|gd-root/.test(cls || '');

// 修饰符按 @touchmove 后面的点缀串提取（顺序不固定：.stop.prevent 和 .prevent.stop 等价）
const modsOf = (attrs) => {
  const m = /@touchmove((?:\.[A-Za-z0-9_]+)*)/.exec(attrs || '');
  return m ? m[1] : '';
};

let maskCount = 0;

// 取某条 CSS 规则的 body（Careers `.xx { ... }`，不含前缀相同的 `.xx-item`）
const cssRule = (css, cls) => {
  const re = new RegExp('\\.' + cls.replace(/[-[\]{}()*+?.\\^$|]/g, '\\$&') + '\\s*\\{[^}]*\\}');
  const m = re.exec(css);
  return m ? m[0] : '';
};

/** 遮罩子树里的可滚区域：scroll-view 组件，或者 CSS 里写了 overflow-y: auto/scroll 的 view */
function scrollersIn(seg, css) {
  const out = [];
  const re = /<(scroll-view|view)([^<>]*)>/g;
  let m;
  while ((m = re.exec(seg))) {
    const c = /class="([^"]*)"/.exec(m[2]);
    if (!c) continue;
    const first = c[1].trim().split(/\s+/)[0];
    if (!first) continue;
    const rule = cssRule(css, first);
    const isScroll = m[1] === 'scroll-view' || /overflow-y:\s*(auto|scroll)/.test(rule);
    if (isScroll && !out.some((s) => s.cls === first)) out.push({ cls: first, rule: rule || '(scroll-view)' });
  }
  return out;
}

files.forEach((f) => {
  const raw = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const tpl = stripComments(templateOf(raw));
  if (!tpl.trim()) return;
  const css = stripComments(styleOf(raw));

  // 收集所有 view 开标签及其属性串（属性串里不可能出现 < >，够用）
  const tags = [];
  const re = /<view([^<>]*)>/g;
  let m;
  while ((m = re.exec(tpl))) {
    const attrs = m[1];
    const cls = /class="([^"]*)"/.exec(attrs);
    tags.push({ attrs, cls: cls ? cls[1] : '', index: m.index, end: m.index + m[0].length });
  }

  const masks = tags.filter((t) => isMaskClass(t.cls));
  masks.forEach((node, i) => {
    maskCount++;
    // 「势力范围」：本遮罩起点 → 下一个遮罩起点（或模板结尾）。
    // 用它判断遮罩子树里有没有可滚区域，够用了（遮罩彼此不嵌套）。
    const nxt = masks[i + 1];
    const seg = tpl.slice(node.index, nxt ? nxt.index : tpl.length);
    const cardSeg = tpl.slice(node.end, nxt ? nxt.index : tpl.length);
    const scrollers = scrollersIn(cardSeg, css);

    const mods = modsOf(node.attrs);
    assert(/@touchmove\b/.test(node.attrs),
      rel + ' 的 .' + node.cls.replace(/\s+/g, '.') + ' 上写了 @touchmove');
    assert(mods.indexOf('stop') >= 0,
      rel + ' 的遮罩 @touchmove 必须带 .stop（否则会被页面根的手势接走）：实际 ' + (mods || '无'));
    assert(mods.indexOf('prevent') >= 0,
      rel + ' 的遮罩 @touchmove 必须带 .prevent（否则默认滚动会去滚背后的页面）：实际 ' + (mods || '无'));

    if (!scrollers.length) return;

    // 子树里确实有可滚区域 → 卡片那一层必须只 stop、不 prevent
    const inner = tags.filter((t) => t.index >= node.end && t.index < (nxt ? nxt.index : tpl.length)
      && /@tap\.stop/.test(t.attrs));
    const card = inner[0];
    if (!card) {
      bad(rel + ' 的遮罩里有可滚区域（.' + scrollers[0].cls + '），却找不到带 @tap.stop 的卡片层');
      return;
    }
    const cardMods = modsOf(card.attrs);
    assert(cardMods.indexOf('stop') >= 0,
      rel + ' 的卡片层必须 @touchmove.stop（遮罩那层 prevent 会把子滚动一起取消）：实际 ' + (cardMods || '无'));
    // ⚠️ 卡片层必须**没有** prevent：有了它，父级 preventDefault 的活儿由卡片自己干了，
    //    内部 scroll-view 一样会滚不动。
    assert(cardMods.indexOf('prevent') < 0,
      rel + ' 的卡片层不许 prevent 自己的 touchmove（内部滚动会被一起锁死）：实际 ' + cardMods);

    // 滚动条自身：滚到头不许把余量传给背后的页面
    scrollers.forEach((s) => {
      assert(/overscroll-behavior:\s*contain/.test(s.rule),
        rel + ' 的 .' + s.cls + ' 写了 overscroll-behavior: contain（滚到头不把余量传给背后页面）');
    });
  });
});

console.log('');
assert(maskCount > 0, '至少扫到一个遮罩层（扫到 ' + maskCount + ' 个）');
console.log('');
if (fail) console.error('红 ' + fail + ' 条');
else console.log('全绿：' + maskCount + ' 个遮罩层都截断了自己的手势');
process.exit(fail ? 1 : 0);
