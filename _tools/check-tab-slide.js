// _tools/check-tab-slide.js - tab 切换的"内容左右滑动"校验
// 覆盖：方向判定、一次性消费、手势阈值与阻尼、边缘不越界、mixin 的复位与切页
const { load } = require('./lib/load');

// uni 要在 load 之前注入（load.js 的沙箱会把 global.uni 拷进上下文）
const navCalls = [];
global.uni = { switchTab: (o) => navCalls.push(o && o.url) };

const ts = load('utils/tab-slide.js');
const mixinFactory = load('utils/tab-slide-mixin.js', { tabSlide: ts });
const mixin = mixinFactory.default || mixinFactory;

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + b);
  else bad(label + ' 期望 ' + b + '，实际 ' + a);
}

// tab 次序的真身在 pages.json 的 tabBar（TABS 只是它的镜像）。
// 期望值一律从那里算 —— 以后换 tab（改名 / 加减）测试自动跟上，
// 不会再出现"改成 goals/stats 之后脚本还在找 library/review"这种假失败。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', 'uniapp');
const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages.json'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1'));
const KEYS = ((pj.tabBar && pj.tabBar.list) || [])
  .map(x => String(x.pagePath || '').split('/').slice(-1)[0]);
const K0 = KEYS[0], K1 = KEYS[1], K2 = KEYS[2], K3 = KEYS[3];

console.log('== 1. tab 次序是唯一来源 ==');
eq(ts.TABS.map(t => t.key).join(','), KEYS.join(','), 'tab 次序与 pages.json 的 tabBar 一致');
eq(ts.tabIndex(K1), 1, K1 + ' 下标');
eq(ts.tabIndex('nope'), -1, '未知 key');

console.log('== 2. 方向：按索引大小决定从左还是从右滑入 ==');
ts.clearPending();
eq(ts.markSwitch(K0, K2), 'right', '索引变大 → 从右滑入');
eq(ts.takeEnter(K2), 'right', K2 + ' 取到 right');
eq(ts.takeEnter(K2), '', '只能取一次（不会重复播）');
ts.clearPending();
eq(ts.markSwitch(K3, K0), 'left', '索引变小 → 从左滑入');
eq(ts.takeEnter(K0), 'left', K0 + ' 取到 left');
ts.clearPending();
eq(ts.markSwitch(K0, K0), '', '同一个 tab 不记方向');
eq(ts.takeEnter(K0), '', '没有意图时不播动画');

console.log('== 3. 非目标页 / 过期意图都不得播放 ==');
ts.clearPending();
ts.markSwitch(K0, K1);
eq(ts.takeEnter(K2), '', '不是目标页 → 不播');
ts.clearPending();
ts.markSwitch(K0, K2);
const realNow = Date.now;
Date.now = () => realNow() + 5000;      // 假装过了 5 秒
eq(ts.takeEnter(K2), '', '过期意图不播（避免误播）');
Date.now = realNow;

console.log('== 4. 手势：阻尼与阈值 ==');
eq(ts.dampOffset(60), 60, '阈值以内原样跟手');
eq(ts.dampOffset(-60), -60, '负方向同样跟手');
const damped = ts.dampOffset(300);
if (damped > 120 && damped < 200) ok('超出上限后加阻尼 = ' + damped);
else bad('阻尼异常：' + damped);
eq(Math.sign(ts.dampOffset(-300)), -1, '阻尼保持方向');
eq(ts.neighbor('home', -1), null, '首页再往左没有相邻页');
eq(ts.neighbor(K0, 1).key, K1, '首页往右是第 2 个 tab（' + K1 + '）');
eq(ts.neighbor(K3, 1), null, '末页再往右没有相邻页');

console.log('== 5. mixin：进场方向与复位 ==');
function ctxOf(key) {
  const m = mixin(key);
  const ctx = Object.assign({}, m.data(), m.methods);
  ctx.onShow = m.onShow;
  ctx.onHide = m.onHide;
  Object.defineProperty(ctx, 'slideCls', { get: () => m.computed.slideCls.call(ctx), configurable: true });
  Object.defineProperty(ctx, 'slideStyle', { get: () => m.computed.slideStyle.call(ctx), configurable: true });
  return ctx;
}
ts.clearPending();
ts.markSwitch(K0, K2);
const review = ctxOf(K2);
review.onShow();
eq(review.slideEnter, 'right', K2 + ' 进场方向 = right');
eq(review.slideCls.join(','), 'slide-in-right', 'class = slide-in-right');
review.onHide();                      // 手动收尾（测试里不等 320ms）
review.slideEnter = '';
review.onShow();
eq(review.slideEnter, '', '没有意图时不播进场动画');

console.log('== 6. 手势：内容跟手 ==');
const home = ctxOf('home');
home.onShow();
home.onSlideStart({ touches: [{ clientX: 200, clientY: 300 }] });
home.onSlideMove({ touches: [{ clientX: 150, clientY: 305 }] });   // 往左 50px
eq(home.slideDrag, true, '判定为横向拖拽');
eq(home.slideDx, -50, '内容跟手位移 = -50px');
eq(home.slideCls.join(','), 'dragging', '跟手时挂 dragging（关掉过渡）');
eq(home.slideStyle.transform, 'translateX(-50px)', 'inline transform');

console.log('== 7. 纵向为主时不抢滚动 ==');
const home2 = ctxOf('home');
home2.onShow();
home2.onSlideStart({ touches: [{ clientX: 200, clientY: 300 }] });
home2.onSlideMove({ touches: [{ clientX: 195, clientY: 380 }] });
eq(home2.slideDrag, false, '纵向手势不触发横滑');

console.log('== 8. 松手：没过阈值弹回，过了阈值才切页 ==');
navCalls.length = 0;
home.onSlideEnd();
eq(home.slideDrag, false, '50px < 60px 阈值 → 松手');
eq(home.slideDx, 0, '位移归零（靠 CSS 过渡弹回）');
eq(navCalls.length, 0, '未切页');
ts.clearPending();
const home3 = ctxOf('home');
home3.onShow();
home3.onSlideStart({ touches: [{ clientX: 300, clientY: 300 }] });
home3.onSlideMove({ touches: [{ clientX: 220, clientY: 302 }] });  // 往左 80px
home3.onSlideEnd();
eq(navCalls.length, 1, '超过阈值触发切页');
eq(navCalls[0], ts.TABS[1].path, '往左拖 → 下一个 tab（' + K1 + '）');
eq(ts.takeEnter(K1), 'right', '目标页从右滑入（与手势方向一致）');

console.log('== 9. 边缘：首尾页不越界 ==');
navCalls.length = 0;
const home4 = ctxOf('home');
home4.onShow();
home4.onSlideStart({ touches: [{ clientX: 100, clientY: 300 }] });
home4.onSlideMove({ touches: [{ clientX: 300, clientY: 302 }] });  // 往右 200px（首页左边没有页）
if (Math.abs(home4.slideDx) < 60) ok('边缘只给一点位移 = ' + home4.slideDx + 'px');
else bad('边缘位移过大：' + home4.slideDx);
home4.onSlideEnd();
eq(navCalls.length, 0, '边缘不切页');

console.log('== 10. 拖到一半切走再回来：位移必须复位 ==');
const home5 = ctxOf('home');
home5.onShow();
home5.onSlideStart({ touches: [{ clientX: 300, clientY: 300 }] });
home5.onSlideMove({ touches: [{ clientX: 200, clientY: 300 }] });
home5.onSlideEnd();                    // 切走（位移故意不复位）
ts.clearPending();
home5.onShow();                        // 再次回到本页
eq(home5.slideDrag, false, '拖拽态已复位');
eq(home5.slideDx, 0, '位移已复位（不会残留偏移）');

console.log('');
console.log(fail === 0 ? 'tab 滑动全部通过' : '失败 ' + fail + ' 项');
process.exitCode = fail ? 1 : 0;
