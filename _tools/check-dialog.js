// _tools/check-dialog.js - 「全 App 弹窗统一」校验（只读）
//
// 背景：App 里一度并存两套弹窗 —— 系统原生（uni.showModal / showActionSheet）与
// 各页面自绘的玻璃卡片，宽高圆角各不相同，且系统弹窗在 App 端 CSS 完全管不到。
// 统一收敛为 components/app-dialog/app-dialog.vue 之后，本脚本守住三条底线：
//   1) 页面不再直接调用系统弹窗
//   2) 弹窗视觉只在 App.vue 全局样式里定义一份（页面不许再各抄一份）
//   3) 组件自身三种模式（确认 / 菜单 / 输入）契约完整
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
// 主包 + 三个分包的页面目录（页面物理位置随 pages.json 的 subPackages）。
// ⚠️ pkgPlan 以前漏在这儿 —— 番茄专注 / 目标详情 / 规划向导三页的
//    uni.showModal 因此长期没被守到（2026-10-14「自定义时长那个框没适配」就是漏网的）。
const PAGES_DIRS = ['pages', 'pkgPlan/pages', 'pkgStudy/pages', 'pkgManage/pages'].map(d => path.join(ROOT, d));
const PAGES = PAGES_DIRS[0]; // 兼容下方少量单文件拼接（book-switch 在 pkgManage）
function walkPages(ext) {
  const out = [];
  PAGES_DIRS.forEach(d => { if (fs.existsSync(d)) walk(d, ext).forEach(f => out.push(f)); });
  return out;
}
const DIALOG = path.join(ROOT, 'components', 'app-dialog', 'app-dialog.vue');
const APPVUE = path.join(ROOT, 'App.vue');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
const eq = (a, b, label) => {
  if (a === b) ok(label + ' = ' + JSON.stringify(b));
  else bad(label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
};

const read = (p) => fs.readFileSync(p, 'utf8');
const walk = (dir, ext) => {
  const out = [];
  fs.readdirSync(dir).forEach((n) => {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (n.endsWith(ext)) out.push(p);
  });
  return out;
};

console.log('== 1. 统一弹窗组件存在 ==');
assert(fs.existsSync(DIALOG), 'components/app-dialog/app-dialog.vue 存在');
const dlg = read(DIALOG);

console.log('== 2. 三种模式齐备 ==');
assert(/mode:\s*\{[^}]*default:\s*'confirm'/.test(dlg), '默认模式 = confirm');
["mode === 'input'", "mode === 'sheet'"].forEach((s) =>
  assert(dlg.indexOf(s) >= 0, '模板按 mode 分支渲染：' + s));
assert(/props:\s*\{[\s\S]*items:/.test(dlg), 'sheet 模式需要 items 属性');
assert(/props:\s*\{[\s\S]*value:/.test(dlg) && /props:\s*\{[\s\S]*placeholder:/.test(dlg),
  'input 模式需要 value / placeholder 属性');

console.log('== 3. 事件契约 ==');
assert(/this\.\$emit\('confirm'/.test(dlg), 'emit confirm');
assert(/this\.\$emit\('cancel'/.test(dlg), 'emit cancel');
assert(/this\.\$emit\('input'/.test(dlg), 'emit input');
// 载荷随 mode 变化：sheet → 下标，input → 文本，confirm → true
assert(/mode === 'input' \? String\(this\.draft/.test(dlg), 'input 模式回传文本');
// 非多选菜单：点按即回传下标；多选菜单（multi）：点按只切换勾选，确认时回传下标数组
assert(/pick\(i\)[\s\S]{0,400}emit\('confirm', i\)/.test(dlg), 'sheet 模式回传下标');
assert(/multi:\s*\{\s*type:\s*Boolean/.test(dlg), '有 multi 属性（多选菜单形态）');
assert(/syncPicked/.test(dlg) && /checked/.test(dlg), '弹开时按 items[].checked 重置勾选态');
assert(/emit\('confirm', sel\)/.test(dlg), 'multi 确认回传选中下标数组');
assert(/mode === 'sheet' && !this\.multi/.test(dlg), '单选菜单仍保留"点按即回传"行为（multi 不劫持老用法）');

console.log('== 4. 弹出时同步输入框 ==');
// 组件用 v-if 挂载：从「菜单」直接切「输入框」不会重新挂载，
// 光靠 show 的 watch 同步不到 —— 必须有 seq 兜底
assert(/seq:\s*\{[^}]*Number/.test(dlg), '有 seq 数字属性');
assert(/watch:\s*\{[\s\S]*seq\(\)/.test(dlg), 'watch seq 时同步 draft');

console.log('== 5. 样式唯一来源：App.vue 全局 ==');
const app = read(APPVUE);
['.pop-mask', '.pop-card', '.dlg-title', '.dlg-input', '.dlg-err', '.dlg-btns', '.dlg-btn']
  .forEach((c) => assert(new RegExp('\\' + c + ' \\{').test(app), 'App.vue 定义 ' + c));
assert(/@supports not[\s\S]{0,200}\.pop-card/.test(app), 'pop-card 有 backdrop-filter 回退');

console.log('== 6. 页面不再各抄一份弹窗样式 ==');
walkPages('.vue').forEach((f) => {
  const s = read(f);
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  eq(/\n\.pop-mask \{/.test(s), false, rel + ' 未重复定义 .pop-mask');
  eq(/\n\.pop-card \{/.test(s), false, rel + ' 未重复定义 .pop-card');
  eq(/\n\.dlg-btn \{/.test(s), false, rel + ' 未重复定义 .dlg-btn');
});

console.log('== 7. 页面不再调用系统弹窗 ==');
// 先剥注释：说明性注释里常写着「不用 uni.showModal」，不剥会被当成真调用
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
walkPages('.vue').forEach((f) => {
  const s = strip(read(f));
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  eq(/uni\.showModal|uni\.showActionSheet/.test(s), false, rel + ' 未调用系统弹窗');
});

console.log('== 8. 危险操作用统一 danger 样式 ==');
assert(/\.dlg-btn\.danger/.test(app), 'App.vue 定义 .dlg-btn.danger');
assert(/background:\s*#e5484d/.test(app), '危险色沿用 #e5484d');

console.log('== 9. 页面弹窗派发（真实执行 goals.vue 的「归档目标」） ==');
// 原来跑的是 pkgManage/pages/book-switch（换词书页），那页随背单词一起退役了。
// 现在跑 pages/goals：同一个契约 —— 危险操作必须先弹统一弹窗，确认后才真的落库。
const { loadCode } = require('./lib/load');
const gRaw = read(path.join(ROOT, 'pages', 'goals', 'goals.vue'));
const gScript = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(gRaw) || [])[1] || '';

const archived = [];
const comp = loadCode(gScript, {
  pw: {
    get: () => ({ goals: [] }),
    archiveGoal: (id) => { archived.push(id) },
    goalOf: () => null,
    dayDiff: () => 0,
    today: () => '2026-10-10',
    todayQueue: () => [],
    goalProgress: () => ({ pct: 0, done: 0, total: 0 })
  },
  hideNativeTabBar: () => {}, syncTabbar: () => {},
  tabSlideMixin: () => ({}),
  FloatTabbar: { name: 'FloatTabbar' },
  FloatNavbar: { name: 'FloatNavbar' },
  AppDialog: { name: 'AppDialog' }
}, 'goals.vue').default;

const vm = Object.assign({}, comp.data ? comp.data() : {}, comp.methods || {});
assert(typeof comp.methods.ask === 'function', 'ask 存在');
assert(typeof comp.methods.onDlgYes === 'function', 'onDlgYes 存在');

comp.methods.confirmArchive.call(vm, { id: 'g-1', title: '三个月英语上 90' });
eq(vm.dlg.show, true, 'confirmArchive 弹出统一弹窗');
assert(/三个月英语上 90/.test(vm.dlg.content), '确认文案带上目标名');
eq(vm.dlg.action, 'archive', 'action = archive');
eq(archived.length, 0, '光弹窗不落库（要等确认）');

comp.methods.onDlgYes.call(vm);
eq(archived.join(','), 'g-1', '确认后才真的归档');
eq(vm.dlg.show, false, '确认后弹窗关闭');

// 取消：点遮罩/取消只关弹窗，什么都不做
archived.length = 0;
comp.methods.confirmArchive.call(vm, { id: 'g-2', title: '另一个目标' });
vm.dlg.show = false;
eq(archived.length, 0, '取消 → 不归档');

console.log('== 10. 尺寸 / 安全区适配 ==');
// 弹窗是唯一"浮在页面之上"的窗体，屏宽 / 横竖屏 / 手势条都得自己兜住：
// 竖屏看着没事的代码，横屏（rpx 跟着长边走）和平板上会把卡片拉成横幅、把按钮顶出屏幕。
const block = (src, sel) => (new RegExp('\\' + sel + ' \\{[\\s\\S]*?\\}').exec(src) || [])[0] || '';
const cardCss = block(app, '.pop-card');
const maskCss = block(app, '.pop-mask');
const sheetCss = block(dlg, '.dlg-sheet');
assert(/max-width:/.test(cardCss), '.pop-card 有宽度上限（横屏/平板不被拉成横幅）');
assert(/max-height:/.test(cardCss), '.pop-card 有高度上限（矮屏/横屏内容不顶出屏幕）');
assert(/overflow-y:\s*auto/.test(cardCss), '.pop-card 超高时自己滚');
assert(/safe-area-inset-bottom/.test(maskCss), '.pop-mask 留了底部安全区（手势条）');
assert(/var\(--safe-bottom/.test(maskCss),
  '.pop-mask 叠了 --safe-bottom（安卓 WebView 的 env 常为 0，只写 env 等于没写）');
assert(/max-height:/.test(sheetCss), '.dlg-sheet 有高度上限（菜单项多了不顶出屏幕）');
assert(/overflow-y:\s*auto/.test(sheetCss), '.dlg-sheet 项多了自己滚');

console.log('== 11. 番茄页「自定义时长」走统一弹窗（真实执行） ==');
// 以前这是 uni.showModal({ editable: true })：系统原生弹窗，CSS 一律管不到，
// 所以圆角 / 字号 / 按钮 / 暗色 / 屏宽全都跟 App 对不上。现在必须是 input 模式。
// ⚠️ focus.vue 只 import utils / components。utils 那批只有真正被调用的方法才需要，
//    这里只跑 customMinutes / onDlgYes / onDlgInput，碰不到 pw / focus / audio…；
//    components 是对象字面量里直接引用的标识符，不注入会 ReferenceError。
const fRaw = read(path.join(ROOT, 'pkgPlan', 'pages', 'focus', 'focus.vue'));
const fScript = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(fRaw) || [])[1] || '';
const fComp = loadCode(fScript, {
  FloatNavbar: { name: 'FloatNavbar' },
  AppDialog: { name: 'AppDialog' },
  // 弹窗按钮的缺省文案走 t('确定') / t('取消')，ask() 里要真调它
  t: (s) => s
}, 'focus.vue').default;
const fvm = Object.assign({}, fComp.data ? fComp.data() : {}, fComp.methods || {});

assert(typeof fComp.methods.customMinutes === 'function', 'customMinutes 存在');
fComp.methods.customMinutes.call(fvm);
eq(fvm.dlg.show, true, '点「自定义」弹出统一弹窗');
eq(fvm.dlg.mode, 'input', '是 input 模式（不是系统原生 showModal）');
eq(fvm.dlg.placeholder, '输入 10-120 的分钟数', '占位文案沿用原文案');

// 越界：不关弹窗、不落值、就地报错 —— 关掉再 toast 等于让人重填一遍
fComp.methods.onDlgYes.call(fvm, '7');
eq(fvm.dlg.show, true, '7 分钟越界 → 弹窗不关');
assert(/10-120/.test(fvm.dlg.error), '越界时 dlg.error 就地提示');
eq(fvm.minutes, 25, '越界不改 minutes');

// 重新输入要把红字清掉，不然报错会一直挂着
fComp.methods.onDlgInput.call(fvm, '50');
eq(fvm.dlg.error, '', '重新输入时清掉报错');

// 合法：落时长、进选项
fComp.methods.onDlgYes.call(fvm, '50');
eq(fvm.dlg.show, false, '50 分钟 → 弹窗关闭');
eq(fvm.minutes, 50, 'minutes = 50');
assert(fvm.minutesOptions.indexOf(50) >= 0, '50 进了时长选项（下次能直接选）');

console.log('');
console.log(fail === 0 ? '统一弹窗校验全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);
