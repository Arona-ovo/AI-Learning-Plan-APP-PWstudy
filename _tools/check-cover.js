// _tools/check-cover.js - 启动封面（pages/cover/cover.vue）的屏幕适配契约（只读）
//
// 为什么单独守一道：启动页是**每个用户每次打开都一定会看到**的那一屏，
// 而它出问题的方式很隐蔽 ——
//   · 用 vw / vh 定宽高 → 屏越宽元素越扁，圆变椭圆（这就是"启动画面被拉伸"的真正来源）
//   · 底部进度条 absolute 钉在 100vh → 矮屏上和品牌文字叠在一起，还被 overflow 裁掉
//   · 头像容器宽高不等 → 圆形头像框变椭圆，图跟着变形
//   · image 用 scaleToFill → 非正方图直接被拉扁
//   · 没有矮屏兜底 → 折叠屏展开 / 平板上整屏挤爆
// 这些在 16:9 的手机上全都看不出来，只在方屏 / 折叠屏 / 平板上现形。
//
// 结论先摆在这：**横向尺寸一律用 rpx（按屏宽等比），形状就不会变。**
// 真正需要适配的是垂直方向的"够不够放"，靠 compact 档解决。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }

const P = path.join(ROOT, 'pages', 'cover', 'cover.vue');
const raw = fs.existsSync(P) ? fs.readFileSync(P, 'utf8') : '';
if (!raw) { bad('pages/cover/cover.vue 不存在'); process.exit(1); }

// 剥注释后再匹配（说明性注释会被自己的正则命中，本项目已踩 4 次）
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
  .filter(l => !/^\s*(\*|\/\/)/.test(l))
  .join('\n');

// 只取 <style> 段（模板里的 :style 是 inline，不参与这里的单位检查）
const si = src.indexOf('<style');
const style = si >= 0 ? src.slice(si) : '';
// 统一去掉 \r：源文件是 CRLF，带 \n 的字面量与 $ 锚点会静默匹配不到（本项目已踩过）
const S = style.replace(/\r/g, '');
// 取某个选择器的**整条规则块**（行首锚定，避免命中 `.cover.compact .ring` 这类后代选择器）
const blk = (sel) => (S.match(new RegExp('^\\s*\\' + sel + '\\s*\\{[^}]*\\}', 'm')) || [''])[0];

console.log('== 1. 尺寸单位：宽高不许用 vw / vh（这是变形的唯一来源） ==');
// rpx = 屏宽等比，px 是绝对值，两者都不会随屏幕比例变形；
// vw/vh 会 —— 屏越宽 vw 越大而 vh 不变，宽高比一变形状就歪。
const vwvh = style.match(/^\s*(width|height|max-height|min-width|max-width)\s*:\s*[^;]*\d+(vw|vh)/gmi) || [];
if (vwvh.length === 0) ok('宽高没有用 vw / vh（全部走 rpx，形状不随屏幕比例变）');
else bad('这些尺寸用了 vw/vh，屏幕比例一变就会变形：\n      ' + vwvh.join('\n      '));

console.log('== 2. 圆形容器必须宽高相等 ==');
[['.stage', 340], ['.ring', 340], ['.mascot-wrap', 320]].forEach(([sel, expect]) => {
  const re = new RegExp('\\' + sel + '\\s*\\{[^}]*width:\\s*(\\d+)rpx;\\s*height:\\s*(\\d+)rpx', 'm');
  const m = style.match(re);
  if (m && m[1] === m[2]) ok(sel + ' 宽 = 高 = ' + m[1] + 'rpx（任何屏宽下都是正圆）');
  else bad(sel + ' 宽高不等或没写成 rpx —— 圆形会变椭圆（期望 ' + expect + '×' + expect + '）');
});

console.log('== 3. 头像图片的填充方式 ==');
if (/mode="aspectFill"/.test(src)) ok('image 用 mode="aspectFill"（保持比例，不拉伸）');
else bad('image 没用 aspectFill —— 换成 scaleToFill 会把图直接拉变形');
if (/scaleToFill/.test(src)) bad('出现了 scaleToFill（会拉伸变形）');
else ok('没有 scaleToFill');
// 源图是 512×512 正方，容器也是正方 —— 两者配套才既不变形也不裁切
{
  const dir = path.join(ROOT, 'static', 'mascot');
  let square = false;
  try {
    const f = fs.readdirSync(dir).filter(x => /\.jpg$/.test(x))[0];
    if (f) {
      const b = fs.readFileSync(path.join(dir, f));
      // JPEG SOF0 段里读宽高，省得为这张图引一个图像库
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xff) { i++; continue; }
        const mk = b[i + 1];
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
          const h = b.readUInt16BE(i + 5), w = b.readUInt16BE(i + 7);
          square = w === h;
          break;
        }
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch (e) {}
  if (square) ok('mascot 源图是正方形（512² 配 320² 容器：既不拉伸也不裁切）');
  else bad('mascot 源图不是正方形 —— 配正方容器会被裁掉一部分');
}

console.log('== 4. 底部进度条不许 absolute（矮屏重叠这条踩过） ==');
if (!/\.footer\s*\{[^}]*position:\s*absolute/m.test(style)) ok('.footer 留在 flex 流里（屏不够高时跟着内容走，不重叠）');
else bad('.footer 又是 absolute —— 矮屏上会钉在 100vh 底部、和品牌文字叠在一起');
if (/margin-top:\s*auto/.test(style)) ok('用 margin-top:auto 推到底部（屏够高就贴底，不够也不重叠）');
else bad('没用 margin-top:auto —— footer 位置会随内容漂移');

console.log('== 5. 矮屏兜底 ==');
if (/compact\s*[:=]/.test(src) && /\.cover\.compact/.test(style)) ok('有 compact 紧凑档（折叠屏展开 / 平板自动收一档）');
else bad('缺 compact 兜底 —— 高宽比掉到 1.2 以下时整屏会挤爆');
// "加了 compact class" ≠ "真的收了一档"。只挂 class 却没改尺寸，等于没兜底 ——
// 原来的断言只要文件里出现过 .cover.compact 就放行，删掉尺寸覆盖照样绿。
if (/\.cover\.compact[^{]*\{[^}]*padding/.test(S)) ok('compact 档收了纵向 padding');
else bad('compact 档没改 padding —— 挂着 class 但纵向没真的收');
{
  // compact 档里某个选择器对应的尺寸（选择器可能写成 `.cover.compact .stage,\n.cover.compact .ring`，
  // 所以要允许中间隔着另一条选择器）
  const cmpOf = (sel) => {
    const b = (S.match(new RegExp('\\.cover\\.compact[^{]*\\' + sel + '[^{]*\\{[^}]*\\}')) || [''])[0];
    return Number((b.match(/width:\s*(\d+)rpx/) || [])[1] || 0);
  };
  const detail = [];
  let all = true;
  ['.ring', '.mascot-wrap'].forEach(sel => {
    const base = Number((blk(sel).match(/width:\s*(\d+)rpx/) || [])[1] || 0);
    const cmp = cmpOf(sel);
    detail.push(sel + ' ' + base + '→' + cmp + 'rpx');
    if (!(base > 0 && cmp > 0 && cmp < base)) all = false;
  });
  if (all) ok('compact 档每个圆形容器都真的收小了（' + detail.join('，') + '）');
  else bad('compact 档有容器没收小 —— 只挂 class 等于没兜底（' + detail.join('，') + '）');
}
if (/windowHeight|screenHeight/.test(src) && /windowWidth|screenWidth/.test(src)) ok('按高宽比判定（读 windowHeight / windowWidth）');
else bad('没读屏幕高宽 —— 判不出该不该切紧凑档');
// 阈值写死在脚本里没意义，但"必须有个 1 附近的数"值得钉住：
// 主流手机 ≥1.7，方屏 1.0，所以阈值必须落在 1.0~1.7 之间
{
  const m = src.match(/h\s*\/\s*w\s*<\s*([\d.]+)/);
  const v = m ? Number(m[1]) : -1;
  if (v > 1.0 && v < 1.7) ok('紧凑档阈值 ' + v + ' 落在合理区间（主流手机 ≥1.7 不触发，方屏 1.0 触发）');
  else bad('紧凑档阈值 ' + v + ' 不合理 —— 应在 1.0 ~ 1.7 之间');
}

console.log('== 6. 背景不许用位图（渐变不会变形，位图会被 background-size 拉伸） ==');
if (!/background-image\s*:\s*url/.test(style) && !/background:\s*url/.test(style)) ok('背景是渐变，不是位图（无需 background-size，不存在拉伸）');
else bad('背景用了位图 —— 不同比例屏幕上会被 background-size 拉伸变形');

console.log('== 7. 竖屏锁定（横屏启动必然溢出，靠系统这一层兜住） ==');
// 为什么必须显式写：uni-app 默认就是竖屏，所以"没写"时行为也对 ——
// 但这行一旦被谁删掉，横屏启动会立刻现形（100vh 只剩约 350rpx，封面整屏被裁），
// 而在竖屏手机上完全测不出来。写在这里是为了让"意图"可校验。
{
  const mf = fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8');
  if (/"screenOrientation"\s*:\s*\[[^\]]*"portrait/s.test(mf)) ok('manifest 显式声明了竖屏（横屏启动由系统拦掉）');
  else bad('manifest 没有显式竖屏声明 —— 横屏启动时 100vh 只有约 350rpx，封面必被裁');
}

// 下面三组是"圆圈不对称 / 换台手机就出问题"这一类缺陷的回归闸。

console.log('== 8. 圆的对称性（换渲染引擎也不能偏一点） ==');
{
  const ring = blk('.ring');
  // abspos 不写 left/top 时，静态位置由父级 flex 的 justify/align 决定 —— CSS 规范如此，
  // 但不是每个渲染引擎都照做（部分 webview / 小程序层会把它放到包含块左上角）。
  // 偏的正是 border 那几 rpx，肉眼能看出"圈不圆/偏一边"，开发机上却完全正常。
  const centered = /left:\s*0/.test(ring) && /right:\s*0/.test(ring)
    && /top:\s*0/.test(ring) && /bottom:\s*0/.test(ring) && /margin:\s*auto/.test(ring);
  if (centered) ok('.ring 四边归零 + margin:auto 居中（不依赖 abspos 静态位置）');
  else bad('.ring 没有显式居中 —— 某些渲染引擎不按 flex 静态位置放，圆圈会偏');
  // translate(-50%,-50%) 是另一种居中写法，但 ringPulse 要用 transform 缩放，
  // 动画的 transform 会整条覆盖定位用的 transform → 圆跳到左上角
  if (!/translate\(\s*-50%/.test(ring)) ok('.ring 不用 translate(-50%,-50%) 定位（不跟 ringPulse 抢 transform）');
  else bad('.ring 用 translate(-50%,-50%) 居中 —— 会被 ringPulse 的 transform 覆盖，圆会跳位');
  // content-box 下 border 会把实际外框撑大（340+3×2=346），圈与头像的间距对不上；
  // 更糟的是 border 在部分引擎按整数 px 取整，左右/上下可能各差 1px
  ['.ring', '.mascot-wrap'].forEach(sel => {
    if (/box-sizing:\s*border-box/.test(blk(sel))) ok(sel + ' 是 border-box（声明尺寸 = 外框，圈与脸的间隙恒定）');
    else bad(sel + ' 没写 box-sizing:border-box —— border 会撑大外框，圈与脸的间距随引擎取整漂移');
  });
}

console.log('== 9. 进度条：不碰布局 + 动画失效时不能是空的 ==');
{
  const fill = blk('.load-fill');
  if (!/width:\s*0/.test(fill)) ok('.load-fill 不以 width:0 起步（动画不执行时进度条不会永远空着）');
  else bad('.load-fill 以 width:0 起步 —— 动效关闭 / 动画不执行时进度条永远空，用户以为卡死');
  if (/transform:\s*scaleX\(1\)/.test(fill) && /transform-origin:\s*left/.test(fill)) {
    ok('.load-fill 用 scaleX + 左原点（走合成层，不每帧重排布局）');
  } else {
    bad('.load-fill 没用 scaleX(+transform-origin:left) —— width 动画每帧重排，低端机上正好卡在初始化');
  }
  const ki = S.indexOf('@keyframes load');
  const kf = ki >= 0 ? S.slice(ki, ki + 200) : '';
  if (/scaleX\(0\)/.test(kf) && !/\bwidth\s*:/.test(kf)) ok('@keyframes load 走 scaleX（不触发重排）');
  else bad('@keyframes load 还在动 width —— 每帧重排，且两端状态对不上会闪');
  // 两者写死不同值就会错位：进度条没走满就跳走，或走满了还干等
  const ms = (src.match(/COVER_MS\s*=\s*(\d+)/) || [])[1];
  const dur = (S.match(/animation:\s*load\s+([\d.]+)s/) || [])[1];
  if (ms && dur && Math.abs(Number(ms) / 1000 - Number(dur)) < 0.001) {
    ok('进度条时长 ' + dur + 's = COVER_MS ' + ms + 'ms（跳转与进度条同步）');
  } else {
    bad('进度条时长(' + dur + 's) 与 COVER_MS(' + ms + 'ms) 不一致 —— 会没走满就跳走或干等');
  }
}

console.log('== 10. 动画降级安全（省电模式 / ROM 限动画时不能变白屏） ==');
// 靠 opacity:0 + forwards 起步的写法：动画一旦不执行，opacity 永远是 0 —— 启动页
// 变成一张空渐变（圆、品牌名、进度条全没了）。backwards 的降级结果是"没有淡入"。
if (!/\.stage\s*\{[^}]*opacity:\s*0/.test(S)) ok('.stage 不靠 opacity:0 起步（动画失效也要看得见圆）');
else bad('.stage 写了 opacity:0 —— 动画不执行时圆框永远不出现，启动页变白屏');
if (!/^\s*\.anim\s*\{[^}]*opacity:\s*0/m.test(S)) ok('.anim 不靠 opacity:0 起步（品牌文字与提示不能消失）');
else bad('.anim 写了 opacity:0 —— 动画不执行时品牌名/进度条全空，只剩一个圈');
if (/prefers-reduced-motion/.test(S)) ok('响应系统「减少动效」（只停装饰动画，淡入与进度条保留）');
else bad('没有 prefers-reduced-motion 处理 —— 开了减少动效的手机上装饰动画照跑');
// 100vh 在有导航栏 / 挖孔屏的机型上不等于可视高度，偏大时底部进度条被顶出屏幕。
// 只查有没有 minHeight 不够 —— 变量声明留着、赋值删了也一样命中，必须钉"赋值"那行。
if (/this\.minH\s*=\s*h/.test(src) && /minHeight/.test(src)) ok('封面高度有实测 windowHeight 兜底（100vh 在部分机型不等于可视高度）');
else bad('只靠 min-height:100vh —— 导航栏机型上底部进度条会被顶出屏幕');

console.log(fail ? ('\n启动封面巡检：' + fail + ' 项待处理') : '\n启动封面巡检全部通过');
process.exit(fail ? 1 : 0);
