// check-scroll-lock.js - 浮层滚动穿透护栏
// 真机实测（2026-11-01，首页「管理」面板）：面板开着手指一划，底下的首页照样被拉走。
// 根因：首页是 uni-app 原生页面滚动，光给 body 设 overflow:hidden 在 App 端锁不住，
// 必须 document 级 non-passive touchmove → preventDefault。
// 这条护栏锁住两件事：① scroll-lock.js 真的挂了 document 级 non-passive 监听；
// ② 首页「管理」面板是纯点击面板（无 scroll-view）且走硬锁。

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { console.log('  ✗ ' + m); fail++; }

const lockSrc = fs.readFileSync(path.join(ROOT, 'uniapp-PWstudy/utils/scroll-lock.js'), 'utf8');
const homeSrc = fs.readFileSync(path.join(ROOT, 'uniapp-PWstudy/pages/home/home.vue'), 'utf8');

console.log('1) scroll-lock.js 挂了 document 级 non-passive touchmove 拦截');
{
  const hasAdd = /document\.addEventListener\('touchmove'/.test(lockSrc);
  // ⚠️ 必须用 { passive: false }：写成 addEventListener(.., false) 只设 capture:false，
  // touchmove 在 document 上默认 passive:true，preventDefault 被静默忽略，页面照滚。
  const hasPassiveFalse = /addEventListener\('touchmove',\s*\w+,\s*\{\s*passive:\s*false\s*\}\)/.test(lockSrc);
  const hasWrongFalse = /addEventListener\('touchmove',\s*\w+,\s*false\)/.test(lockSrc);
  const hasPrevent = /e\.preventDefault\(\)/.test(lockSrc);
  if (hasAdd && hasPassiveFalse && hasPrevent && !hasWrongFalse) ok('document 级 touchmove 用 { passive: false } 监听并 preventDefault');
  else bad('没用 { passive: false } 挂 document 级 touchmove 拦截（App 原生页面滚动锁不住）');
}

console.log('2) 硬锁按 key 切换（hardKeys 有增有减，关闭即摘监听）');
{
  if (/function ensureHard\(/.test(lockSrc) && /function dropHard\(/.test(lockSrc)) ok('有 ensureHard / dropHard 起停逻辑');
  else bad('硬锁没有起停逻辑（一直挂监听会误伤其它可滚浮层）');
  if (/Object\.keys\(hardKeys\)\.length === 0\) dropHard\(\)/.test(lockSrc)) ok('硬锁全部释放后摘掉 document 监听');
  else bad('硬锁释放后没摘 document 监听');
}

console.log('3) 首页「管理」面板是纯点击面板，不走 scroll-view');
{
  // 从管理面板的 <view v-if="manageOn" class="fs-mask" ...> 起到对应 </view> 这一段
  const m = /<view v-if="manageOn" class="fs-mask"[\s\S]*?<\/view>\s*<\/view>\s*<\/view>/.exec(homeSrc);
  const block = m ? m[0] : '';
  if (block && /class="fs-body"/.test(block) && !/scroll-view class="fs-body"/.test(block)) ok('管理面板 .fs-body 是普通 view（无 scroll-view，自己不滚）');
  else bad('管理面板还用 scroll-view（会自己滚 + 透传 touch）');
}

console.log('4) 管理面板走硬锁（scrollable:false）');
{
  if (/holdScroll\('home-manage',\s*\{\s*scrollable:\s*false\s*\}\)/.test(homeSrc)) ok("toggleManage 调用 holdScroll('home-manage', { scrollable: false })");
  else bad("管理面板没走硬锁（会穿透滚动到底层首页）");
}

console.log('');
console.log(fail === 0 ? '浮层滚动穿透护栏全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);
