// 反向测试：故意把浮层的手势截断拆掉，确认 check-overlay-touch.js 真的会红（防假绿）。
//
// ⚠️ 六条老规矩里这几条在这里最容易踩：
//   ① 护栏结尾是同步 process.exit → require() 拿不到 promise，把 exit 桩当"跑完了"的信号；
//   ③ 断言"必须是真的红"（✗ 条数 > 0），否则护栏崩了会被当成抓到（假绿）；
//   ④ expect 别贴着断言里的 `**` 写；
//   ⑤ 还原必须写在 finally 里。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const U = (rel) => path.join(ROOT, 'uniapp-PWstudy', rel);
const CHECK = path.join(ROOT, '_tools', 'check-overlay-touch.js');
const HOME = U('pages/home/home.vue');
const DLG = U('components/app-dialog/app-dialog.vue');
const APPS = U('pkgPlan/pages/apps/apps.vue');
const FCSCS = U('components/focus-calc/focus-calc.vue');
const FILES = [CHECK, HOME, DLG, APPS, FCSCS];

const backup = {};
FILES.forEach((f) => { backup[f] = fs.readFileSync(f); });
function restore() { Object.keys(backup).forEach((f) => fs.writeFileSync(f, backup[f])); }

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  const buf = [];
  let code = 0;
  process.exitCode = 0;
  process.exit = (c) => { code = (c == null ? 0 : c); const e = new Error('__exit'); e.__exit = true; throw e; };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  try { require(CHECK); } catch (e) { if (!e || !e.__exit) throw e; }
  process.exit = realExit;
  console.log = realLog;
  console.error = realErr;
  const c = code || process.exitCode || 0;
  process.exitCode = 0;
  return { code: c, buf };
}

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };

function shouldCatch(label, mutate, expect) {
  restore();
  const cur = {};
  FILES.forEach((f) => { cur[f] = fs.readFileSync(f, 'utf8'); });
  try {
    mutate(cur);
  } catch (e) {
    bad(label + ' —— 注入失败：' + e.message);
    restore();
    return;
  }
  FILES.forEach((f) => fs.writeFileSync(f, cur[f]));
  let r;
  try {
    r = runCheck();
  } catch (e) {
    restore();
    bad(label + ' —— 护栏崩了：' + e.message);
    return;
  }
  const reds = r.buf.filter((l) => l.indexOf('✗') >= 0);
  const hit = r.code !== 0 && reds.length > 0 && (!expect || r.buf.join('\n').indexOf(expect) >= 0);
  if (hit) ok(label + '（红 ' + reds.length + ' 条）');
  else bad(label + ' —— 没被抓到：code=' + r.code + ' 红条=' + reds.length
    + (expect ? ' 期望看到「' + expect + '」' : '')
    + (reds.length === 0 ? '\n      输出尾巴：' + r.buf.slice(-4).join(' | ') : ''));
  restore();
}

/** 反向的反向：把某些素材改成"看起来差不多但其实安全"的样子，护栏必须**不**报警 */
function shouldPass(label, mutate) {
  restore();
  const cur = {};
  FILES.forEach((f) => { cur[f] = fs.readFileSync(f, 'utf8'); });
  try {
    mutate(cur);
  } catch (e) {
    bad(label + ' —— 注入失败：' + e.message);
    restore();
    return;
  }
  FILES.forEach((f) => fs.writeFileSync(f, cur[f]));
  let r;
  try {
    r = runCheck();
  } catch (e) {
    restore();
    bad(label + ' —— 护栏崩了：' + e.message);
    return;
  }
  if (r.code === 0) ok(label);
  else bad(label + ' —— 不该报红却红了：' + r.buf.filter((l) => l.indexOf('✗') >= 0).slice(0, 2).join(' | '));
  restore();
}

/** 元测试：把护栏的某个承重条件拆掉后，"坏代码"必须**看不见**了（证明那一条件是承重墙） */
function shouldMiss(label, mutate) {
  restore();
  const cur = {};
  FILES.forEach((f) => { cur[f] = fs.readFileSync(f, 'utf8'); });
  try {
    mutate(cur);
  } catch (e) {
    bad(label + ' —— 注入失败：' + e.message);
    restore();
    return;
  }
  FILES.forEach((f) => fs.writeFileSync(f, cur[f]));
  let r;
  try {
    r = runCheck();
  } catch (e) {
    restore();
    bad(label + ' —— 护栏崩了：' + e.message);
    return;
  }
  if (r.code === 0) ok(label + ' —— 拆掉后确实查不出来（这条是承重墙）');
  else bad(label + ' —— 拆了居然还能抓到：' + r.buf.filter((l) => l.indexOf('✗') >= 0).slice(0, 2).join(' | '));
  restore();
}

/**
 * 锚点替换：换了必须真的生效，否则抛错。
 * ⚠️ 工作区里混着 CRLF 与 LF —— 多行锚点写死 \n 会在 CRLF 上全部落空（已踩过），
 *    所以按目标文件当前的换行自动转换。
 */
const swapAll = (cur, file, from, to) => {
  const before = cur[file];
  let f = from;
  let t = to;
  if (before.indexOf('\r\n') >= 0) {
    f = from.split('\n').join('\r\n');
    t = to.split('\n').join('\r\n');
  }
  const next = before.split(f).join(t);
  if (next === before) throw new Error('锚点没命中：' + JSON.stringify(from.slice(0, 70)));
  cur[file] = next;
};

console.log('反向测试：check-overlay-touch.js 应该抓到下面这些拆法');
console.log('');

const FS_MANAGE = '<view v-if="manageOn" class="fs-mask" @tap="toggleManage" @touchmove.stop.prevent="noop">';
const FS_FOCUS = '<view v-if="focusSheet" class="fs-mask" @tap="toggleFocusSheet" @touchmove.stop.prevent="noop">';
const SHEET = '<view v-if="sheetShow" class="sheet-mask" @tap="closeSheet" @touchmove.stop.prevent="noop">';

// ---- 1. 遮罩上的 touchmove 整条删掉（最原始的"穿过去了"）----
shouldCatch('管理面板遮罩删掉 @touchmove（背后首页跟着滚）', (c) => {
  swapAll(c, HOME, FS_MANAGE, '<view v-if="manageOn" class="fs-mask" @tap="toggleManage">');
}, 'home.vue 的 .fs-mask 上写了 @touchmove');

shouldCatch('管理面板遮罩的 @touchmove 改成 @touchstart（同款失效）', (c) => {
  swapAll(c, HOME, FS_MANAGE, '<view v-if="manageOn" class="fs-mask" @tap="toggleManage" @touchstart.stop.prevent="noop">');
}, '上写了 @touchmove');

shouldCatch('专注设置遮罩删掉 @touchmove', (c) => {
  swapAll(c, HOME, FS_FOCUS, '<view v-if="focusSheet" class="fs-mask" @tap="toggleFocusSheet">');
}, '上写了 @touchmove');

shouldCatch('添加组件抽屉遮罩删掉 @touchmove', (c) => {
  swapAll(c, HOME, SHEET, '<view v-if="sheetShow" class="sheet-mask" @tap="closeSheet">');
}, '上写了 @touchmove');

// ---- 2. 只 stop 不 prevent / 只 prevent 不 stop ----
shouldCatch('管理面板遮罩只写 .stop（默认滚动照样去滚背后页面）', (c) => {
  swapAll(c, HOME, FS_MANAGE, '<view v-if="manageOn" class="fs-mask" @tap="toggleManage" @touchmove.stop="noop">');
}, '必须带 .prevent');

shouldCatch('管理面板遮罩只写 .prevent（冒泡照样被页面根的手势接走）', (c) => {
  swapAll(c, HOME, FS_MANAGE, '<view v-if="manageOn" class="fs-mask" @tap="toggleManage" @touchmove.prevent="noop">');
}, '必须带 .stop');

// ---- 3. 卡片层的处理：含 scroll-view 时必须只 stop、不 prevent ----
shouldCatch('管理面板卡片删掉 @touchmove.stop（内部滚动被父级 prevent 一起取消）', (c) => {
  swapAll(c, HOME, '      <view class="fs-card" @tap.stop @touchmove.stop>\n        <view class="fs-head">\n          <text class="fs-title">{{ $t(\'管理\') }}</text>',
    '      <view class="fs-card" @tap.stop>\n        <view class="fs-head">\n          <text class="fs-title">{{ $t(\'管理\') }}</text>');
}, '卡片层必须 @touchmove.stop');

shouldCatch('管理面板卡片误写成 @touchmove.stop.prevent（内部滚动被锁死）', (c) => {
  swapAll(c, HOME, '      <view class="fs-card" @tap.stop @touchmove.stop>\n        <view class="fs-head">\n          <text class="fs-title">{{ $t(\'管理\') }}</text>',
    '      <view class="fs-card" @tap.stop @touchmove.stop.prevent>\n        <view class="fs-head">\n          <text class="fs-title">{{ $t(\'管理\') }}</text>');
}, '不许 prevent 自己的 touchmove');

// ---- 4. overscroll-behavior 掉了 ----
shouldCatch('.fs-body 去掉 overscroll-behavior（滚到头把余量传给背后页面）', (c) => {
  swapAll(c, HOME, '  max-height: 62vh;\n  padding-bottom: 8rpx;\n  overscroll-behavior: contain;',
    '  max-height: 62vh;\n  padding-bottom: 8rpx;');
}, 'overscroll-behavior');

shouldCatch('.sheet-body 去掉 overscroll-behavior', (c) => {
  swapAll(c, HOME, '  max-height: 54vh;\n  overscroll-behavior: contain;', '  max-height: 54vh;');
}, 'overscroll-behavior');

shouldCatch('.dlg-sheet 去掉 overscroll-behavior', (c) => {
  swapAll(c, DLG, '  overflow-y: auto;\n  overscroll-behavior: contain;', '  overflow-y: auto;');
}, 'overscroll-behavior');

// ---- 5. 别处同样跟风 ----
shouldCatch('app-dialog 遮罩删掉 @touchmove', (c) => {
  swapAll(c, DLG, '<view class="pop-mask" v-if="show" @tap="onMaskTap" @touchmove.stop.prevent="noop">',
    '<view class="pop-mask" v-if="show" @tap="onMaskTap">');
}, '上写了 @touchmove');

shouldCatch('apps.vue 编辑弹窗遮罩删掉 @touchmove', (c) => {
  swapAll(c, APPS, '<view v-if="editor.show" class="pop-mask" @tap="closeEditor" @touchmove.stop.prevent="noop">',
    '<view v-if="editor.show" class="pop-mask" @tap="closeEditor">');
}, '上写了 @touchmove');

shouldCatch('focus-calc 遮罩删掉 @touchmove', (c) => {
  swapAll(c, FCSCS, '<view class="fc-mask" v-if="show" @tap="close" @touchmove.stop.prevent="noop">',
    '<view class="fc-mask" v-if="show" @tap="close">');
}, '上写了 @touchmove');

// ---- 6. 元测试：护栏被掏空时必须看得出来（假绿防御）----
shouldCatch('护栏自身 —— 遮罩识别条件被掏空（一个遮罩都扫不到）', (c) => {
  swapAll(c, CHECK, 'const isMaskClass = (cls) => /mask|gd-root/.test(cls || \'\');',
    'const isMaskClass = (cls) => false;');
}, '至少扫到一个遮罩层');

// 护栏自己也踩过的坑：template 段被"逐块正则"切过一次，apps.vue 里嵌套的
// <template v-if> 让它后半段（编辑弹窗就住在那儿）整段漏扫 —— 那时护栏是全绿的。
shouldMiss('护栏自身 —— template 退回逐块正则 + apps 编辑弹窗拆掉 @touchmove', (c) => {
  swapAll(c, CHECK,
    '  const close = src.lastIndexOf(\'</template>\');\n  return close > openEnd ? src.slice(openEnd + 1, close) : \'\';',
    [ '  const out = [];',
      '  const re = /<template[\\s\\S]*?>([\\s\\S]*?)<\\/template>/g;',
      '  let mm;',
      '  while ((mm = re.exec(src))) out.push(mm[1]);',
      '  return out.join(\'\\n\');'
    ].join('\n'));
  swapAll(c, APPS, '<view v-if="editor.show" class="pop-mask" @tap="closeEditor" @touchmove.stop.prevent="noop">',
    '<view v-if="editor.show" class="pop-mask" @tap="closeEditor">');
});

// 模板注释也必须先剥：剥离一旦失效，注释里出现一片 <view class="fs-mask" ...>
// 就会被当成真标签（"劝君加上 @touchmove"这类话写在注释里 —— 本项目就是这么写的），
// 于是删掉真东西也看不见。这一条证明 stripComments 是承重墙。
shouldCatch('护栏自身 —— 注释没剥：comment 里留个不合规标签会被当成真的', (c) => {
  swapAll(c, CHECK,
    "  s.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').replace(/<!--[\\s\\S]*?-->/g, (m) => m.replace(/[^\\n]/g, ' '));",
    '  s;');
  swapAll(c, HOME, '    <!-- ===== 顶栏那颗键点开的「管理」面板 =====',
    '    <!-- <view v-if="fake" class="fs-mask" @tap="x"> ===== 顶栏那颗键点开的「管理」面板 =====');
}, 'home.vue 的 .fs-mask 上写了 @touchmove');

console.log('');
console.log('反向的反向：这些不影响体验，不该报红');

shouldPass('修饰符顺序反过来（.prevent.stop 等价）', (c) => {
  swapAll(c, HOME, FS_MANAGE, '<view v-if="manageOn" class="fs-mask" @tap="toggleManage" @touchmove.prevent.stop="noop">');
});

shouldPass('卡片层写成 @touchmove.stop="noop"（带 handler 也行）', (c) => {
  swapAll(c, HOME, '      <view class="fs-card" @tap.stop @touchmove.stop>\n        <view class="fs-head">\n          <text class="fs-title">{{ $t(\'管理\') }}</text>',
    '      <view class="fs-card" @tap.stop @touchmove.stop="noop">\n        <view class="fs-head">\n          <text class="fs-title">{{ $t(\'管理\') }}</text>');
});

shouldPass('.fs-body 多带一条 touch-action（多余但无害）', (c) => {
  swapAll(c, HOME, '  max-height: 62vh;\n  padding-bottom: 8rpx;\n  overscroll-behavior: contain;',
    '  max-height: 62vh;\n  padding-bottom: 8rpx;\n  overscroll-behavior: contain;\n  touch-action: pan-y;');
});

restore();
console.log('');
console.log(fail ? ('反向测试红 ' + fail + ' 条 —— 护栏是假的') : '反向测试全绿：护栏真的会叫');
process.exit(fail ? 1 : 0);
