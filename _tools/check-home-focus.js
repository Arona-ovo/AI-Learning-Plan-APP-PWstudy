// _tools/check-home-focus.js - 首页「专注设置」胶囊（顶栏拦截开关 + 底部胶囊面板）静态校验（只读）
//
// 回归点（对应需求：拦截通知开关进首页顶部胶囊；强制模式 + 其余专注设置收进底部胶囊）：
//  1) 顶栏 float-navbar 暴露 notifToggle / notifOn 两个 prop，并 emit toggle-notif
//  2) 首页模板：float-navbar 接了 :notif-on 与 @toggle-notif；底部有 focus-cap 胶囊 + 面板
//  3) 首页脚本：onNotifToggle / toggleFocusSheet / tapForced / tapBlockNotif / tapAutoRest
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

console.log('== 1. 顶栏 float-navbar 暴露拦截通知开关 ==');
assert(/notifToggle:\s*\{/.test(navbar), 'float-navbar 有 prop notifToggle');
assert(/notifOn:\s*\{/.test(navbar), 'float-navbar 有 prop notifOn');
assert(/toggle-notif/.test(navbar), 'float-navbar emit 事件名 toggle-notif');
assert(/onNotifTap/.test(navbar), 'float-navbar 有 onNotifTap（发射 toggle-notif）');
assert(/fnb-side-notif/.test(navbar), 'float-navbar 渲染了拦截开关槽位');

console.log('== 2. 首页模板：顶栏接线 + 底部专注胶囊 ==');
assert(/:notif-on="blockNotifOn"/.test(home), '首页把 blockNotifOn 传给顶栏 :notif-on');
assert(/@toggle-notif="onNotifToggle"/.test(home), '首页接住 toggle-notif → onNotifToggle');
assert(/class="focus-cap"/.test(home), '首页有底部专注胶囊 focus-cap');
assert(/focusSheet/.test(home), '首页有 focusSheet（面板展开状态）');
assert(/fc-panel/.test(home), '首页胶囊展开面板 fc-panel 存在');
assert(/tapForced/.test(home) && /tapBlockNotif/.test(home) && /tapAutoRest/.test(home),
  '面板三行开关接 tapForced / tapBlockNotif / tapAutoRest');

console.log('== 3. 首页脚本：方法齐全 + goto-notif 有出口 ==');
[ 'onNotifToggle', 'toggleFocusSheet', 'tapForced', 'tapBlockNotif', 'tapAutoRest',
  'saveFocus', 'openOverlayHome' ].forEach(fn => {
  assert(new RegExp('\\b' + fn + '\\s*\\(').test(home), 'method ' + fn);
});
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
console.log(fail === 0 ? '首页专注胶囊校验全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
process.exit(fail === 0 ? 0 : 1);
