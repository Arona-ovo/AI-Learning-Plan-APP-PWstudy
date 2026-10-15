// _tools/check-home-focus.js - 首页「专注设置」卡片（顶栏右上角胶囊 → 弹出卡片）静态校验（只读）
//
// 回归点（对应需求：拦截通知 / 强制模式 / 自动进休息 全部收进顶栏右上角胶囊点开的卡片，
//   不再单独留一个底部胶囊）：
//  1) 顶栏 float-navbar 暴露 focusBtn / focusOn 两个 prop，并 emit open-focus
//  2) 首页模板：float-navbar 接了 :focus-btn 与 @open-focus；弹出层有 fs-mask / fs-card
//  3) 首页脚本：toggleFocusSheet / tapForced / tapBlockNotif / tapAutoRest
//               / saveFocus / openOverlayHome 齐全；且 goto-notif 弹窗有出口
//  4) i18n：6 个新 key 全部落进英文表（漏译会在 check-i18n 第 5 节另外报错，这里顺手守一遍）
//  5) fgsvc 仍提供 notifGranted / openNotifSettings（拦截开关的授权判定与跳转依赖它们）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const home = R('pages/home/home.vue');
const navbar = R('components/float-navbar/float-navbar.vue');
const en = R('utils/i18n-en.js');
const fgsvc = R('utils/fgsvc.js');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

console.log('== 1. 顶栏 float-navbar 暴露「专注设置」入口 ==');
assert(/focusBtn:\s*\{/.test(navbar), 'float-navbar 有 prop focusBtn');
assert(/focusOn:\s*\{/.test(navbar), 'float-navbar 有 prop focusOn');
assert(/open-focus/.test(navbar), 'float-navbar emit 事件名 open-focus');
assert(/onFocusTap/.test(navbar), 'float-navbar 有 onFocusTap（发射 open-focus）');
assert(/fnb-side-focus/.test(navbar), 'float-navbar 渲染了专注设置入口槽位');
// 旧的内联拦截开关已退役：不能还留着，否则卡片与内联开关双重入口
assert(!/notifToggle/.test(navbar), 'float-navbar 已移除旧的 notifToggle');
assert(!/onNotifTap/.test(navbar), 'float-navbar 已移除旧的 onNotifTap');

console.log('== 2. 首页模板：顶栏接线 + 弹出卡片 ==');
assert(/:focus-btn="!locked"/.test(home), '首页把 !locked 传给顶栏 :focus-btn');
assert(/@open-focus="toggleFocusSheet"/.test(home), '首页接住 open-focus → toggleFocusSheet');
assert(/class="fs-mask"/.test(home), '首页有遮罩层 fs-mask');
assert(/class="fs-card"/.test(home), '首页有弹出卡片 fs-card');
assert(/focusSheet/.test(home), '首页有 focusSheet（卡片展开状态）');
assert(/tapForced/.test(home) && /tapBlockNotif/.test(home) && /tapAutoRest/.test(home),
  '卡片三行开关接 tapForced / tapBlockNotif / tapAutoRest');

console.log('== 3. 首页脚本：方法齐全 + goto-notif 有出口 ==');
[ 'toggleFocusSheet', 'tapForced', 'tapBlockNotif', 'tapAutoRest',
  'saveFocus', 'openOverlayHome' ].forEach(fn => {
  assert(new RegExp('\\b' + fn + '\\s*\\(').test(home), 'method ' + fn);
});
assert(!/onNotifToggle/.test(home), '首页已移除旧的内联 onNotifToggle');
assert(/act === 'goto-notif'/.test(home), 'onDlgYes 处理了 goto-notif（跳通知使用权设置）');
assert(/fgsvc\.openNotifSettings\(\)/.test(home), 'goto-notif 出口调用 fgsvc.openNotifSettings');

console.log('== 4. 新文案全部进入英文表（漏译会被 check-i18n 第 5 节抓，这里先守一遍） ==');
const newKeys = [
  '专注设置', '强制模式', '离开学习 App 立刻拉回',
  '专注时收起别家通知', '专注结束自动休息', '强制模式需开启「显示在其他应用上层」'
];
newKeys.forEach(k => assert(en.indexOf("'" + k + "'") >= 0, 'i18n-en 含 key「' + k + '」'));

console.log('== 5. fgsvc 仍提供拦截授权依赖 ==');
assert(/notifGranted/.test(fgsvc), 'fgsvc 提供 notifGranted（授权判定）');
assert(/openNotifSettings/.test(fgsvc), 'fgsvc 提供 openNotifSettings（跳设置页）');

console.log('');
console.log(fail === 0 ? '首页专注设置卡片校验全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
process.exit(fail === 0 ? 0 : 1);
