// _tools/_scratch/neg-cover.js - _tools/check-cover.js 的反向测试
//
// 为什么必须有这个文件：封面这几条缺陷（圆圈偏一点 / 进度条空着 / 动画失效变白屏）
// **在开发机上全都看不出来**，只能靠静态护栏钉。而静态护栏最容易写错成假绿 ——
// 正则没命中时"没报错"和"检查通过"长得一模一样。所以每一条都要证明它真会红。
//
// 做法：把 cover.vue 改坏一处 → 跑 check-cover → 必须报错 → 还原，换下一处。
//
// ⚠️ 沙箱里 child_process.spawnSync 直接 EBUSY，且失败时 status/signal 都是 null、
//    stdout 为空 —— 会被误判成"全部抓到"（假绿）。必须同进程 require + 接管
//    process.exit，并且**两个信号都要读**（exitCode 与 bad 条数），
//    否则结尾只写 exitCode 的护栏永远读到 0。详见 MEMORY 硬约束 15/16。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'uniapp-PWstudy');
const P = path.join(ROOT, 'pages', 'cover', 'cover.vue');
const CHECK = path.join(__dirname, '..', 'check-cover.js');
const orig = fs.readFileSync(P, 'utf8');

let badCount = 0;
let exitCode = 0;
const realErr = console.error;
const realLog = console.log;
const realExit = process.exit;

process.exit = (c) => { exitCode = c === undefined ? 0 : c; };

function runCheck() {
  badCount = 0;
  exitCode = 0;
  console.error = (...a) => { badCount++; };
  console.log = () => {};
  try {
    delete require.cache[require.resolve(CHECK)];
    require(CHECK);
  } catch (e) {
    realErr('[neg] check-cover 抛异常：' + e.message);
  } finally {
    console.error = realErr;
    console.log = realLog;
  }
  // 两个信号都认：有的路径只写 exitCode，有的只调 bad()
  return badCount > 0 || exitCode !== 0;
}

// 每个 case：把 from 换成 to，改动后护栏必须变红。
// ⚠️ 定位方式：from 在文件里**常常不唯一**（比如 box-sizing:border-box 出现三次
//   —— .cover / .ring / .mascot-wrap 各一次），所以默认用 nth 指定第几次出现
//   （0-based），而不是靠 indexOf / lastIndexOf 猜。猜错的表现是"改的根本不是
//   想改的那个块"→ 护栏当然不红 → 被误判成假绿（这次就踩了）。
function nthIndex(s, sub, n) {
  let i = -1;
  for (let k = 0; k <= n; k++) {
    i = s.indexOf(sub, i + 1);
    if (i < 0) return -1;
  }
  return i;
}

const CASES = [
  { name: 'ring 去掉 margin:auto（改靠 abspos 静态位置居中）', from: 'margin: auto;', to: '', nth: 0 },
  { name: 'ring 改用 translate(-50%,-50%) 居中', from: 'margin: auto;', to: 'transform: translate(-50%, -50%);', nth: 0 },
  // box-sizing 出现顺序：.cover(0) / .ring(1) / .mascot-wrap(2)
  { name: 'ring 去掉 box-sizing:border-box', from: 'box-sizing: border-box;', to: '', nth: 1 },
  { name: 'mascot-wrap 去掉 box-sizing:border-box', from: 'box-sizing: border-box;', to: '', nth: 2 },
  { name: '进度条改回 width:0 起步', from: 'transform: scaleX(1);', to: 'width: 0;', nth: 0 },
  { name: '进度条改回 width 动画', from: 'from { transform: scaleX(0); }', to: 'from { width: 0; }', nth: 0 },
  { name: '进度条时长与 COVER_MS 脱钩', from: 'COVER_MS = 2400', to: 'COVER_MS = 3000', nth: 0 },
  { name: '.stage 写死 opacity:0（动画失效就白屏）', from: 'animation: stageIn', to: 'opacity: 0;\n  animation: stageIn', nth: 0 },
  { name: '.anim 写死 opacity:0（品牌文字消失）', from: '.anim { animation: fadeUp', to: '.anim { opacity: 0; animation: fadeUp', nth: 0 },
  { name: '去掉 prefers-reduced-motion 处理', from: '@media (prefers-reduced-motion: reduce)', to: '@media (min-resolution: 9999dpi)', nth: 0 },
  { name: '去掉实测高度兜底（只剩 100vh）', from: "this.minH = h + 'px'", to: '', nth: 0 },
  // 光删一处 .cover.compact 不够（后面还有），要删的是"收尺寸"那行
  { name: 'compact 档不收头像尺寸（只挂 class 等于没兜底）', from: 'width: 260rpx; height: 260rpx;', to: '', nth: 0 },
  { name: '圆容器宽高改不等（圈变椭圆）', from: 'width: 340rpx; height: 340rpx;\n  margin: auto;', to: 'width: 340rpx; height: 320rpx;\n  margin: auto;', nth: 0 }
];

let pass = 0;
let miss = 0;

CASES.forEach(c => {
  const i = nthIndex(orig, c.from, c.nth || 0);
  if (i < 0) {
    realErr('  ✗ [配置错] 「' + c.name + '」的锚点没找到：' + JSON.stringify(c.from));
    miss++;
    return;
  }
  fs.writeFileSync(P, orig.slice(0, i) + c.to + orig.slice(i + c.from.length));
  const caught = runCheck();
  if (caught) { pass++; realLog('  ✓ 改坏后被抓到：' + c.name); }
  else { miss++; realErr('  ✗ 改坏了却没报错（护栏是假绿）：' + c.name); }
});

// 还原：无论上面结果如何，源码必须回到原样
fs.writeFileSync(P, orig);
const restored = fs.readFileSync(P, 'utf8') === orig;
const greenAgain = runCheck();

process.exit = realExit;
realLog('\n反向测试：' + pass + ' 条被抓到 / ' + miss + ' 条漏网');
realLog(restored ? '源码已还原' : '✗ 源码还原失败 —— 请手动 git checkout');
realLog(greenAgain ? '✗ 还原后仍然是红的 —— check-cover 本身有问题' : '还原后恢复全绿');

process.exit(miss === 0 && restored && !greenAgain ? 0 : 1);
