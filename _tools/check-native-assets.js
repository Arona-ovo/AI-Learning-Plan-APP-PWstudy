// _tools/check-native-assets.js - 原生打包资源（桌面图标 / 启动图）配置校验（只读）
// 运行：node _tools/check-native-assets.js
//
// 为什么要这道闸（2026-10-12，从 AWword 移植 + 事故复盘）：
//   manifest.json 里图标配错一层级（写成 distribute.android.icons 而不是
//   distribute.icons.android）时，HBuilderX **不报错**、其它校验脚本也发现不了，
//   云端打包会**静默回退到 DCloud 默认图标**（绿色 H）。
//   而且启动界面默认「通用启动界面」= 应用图标 + 应用名 ——
//   于是开屏也是绿 H + 应用名：一次配置错误同时毁掉桌面图标和启动图。
//
//   ⚠️ PWstudy 实际踩过这条（2026-10-12 复查时才发现）：改之前 manifest 里
//      写的就是 distribute.android.icons。铁证是同一份成功打出来的 APK：
//        从 __UNI__53285BF__20261012104445.apk 里取出 res/drawable-xxhdpi/icon.png
//        = 144×144 / **890 字节** / 就是那个绿 H；
//        而我们的真图 uniapp-PWstudy/static/icons/icon-144.png = 144×144 / 32,599 字节。
//      （对照组 AWword 用的是正确层级，同一位置取出来是 33,662 字节的真图。）
//
// 校验项：
//   1) icons 必须挂在 app-plus.distribute.icons.android（不是 distribute.android.icons）
//   2) 图标文件存在、是 png、像素尺寸与官方要求一致（mdpi 48 / hdpi 72 / xhdpi 96 /
//      xxhdpi 144 / xxxhdpi 192）
//   3) 启动图必须是 .9.png（九宫格）、尺寸 = 官方内容尺寸 + 2（外圈 1px 黑线）、
//      黑线结构合法（上/左各一整段 = 全幅可拉伸；右/下拉满 = padding；四边其余透明）
//   4) app-plus.splashscreen 的关闭策略取值合法（等首帧渲染完再关、自定义启动图上不叠加载圈）
//   5) 启动图 ↔ cover 页首帧**颜色对得上**（从源码推导，见下），
//      且 cover 的圆框是**淡入**的 —— 这两条一起保证 splash → cover 是无缝的
//   6) static/splash 下不许留普通 png（会被打进 apk 白占体积，且说明有人手糊过图）
//
// 第 5 组为什么这么写：启动图里的颜色**不该是手抄的常量**，而是 cover 页首帧算出来的：
//   settings.js 出厂 accent=rose / background=sand
//     → theme.js  ACCENTS[rose].rgb = "228, 23, 61"、BACKGROUNDS[sand].solid = "#f0e4d2"
//     → cover.vue .cover 的 165deg 渐变：绯红 6% → 13% → 22%
//   把半透明渐变合成到实色底上，就是启动图该有的三个色标。
//   这里**独立地再算一遍**（不读 gen-splash.py 的产物），然后拿 .9.png 的真实像素去比 ——
//   谁改了封面配色/出厂主题色却忘了重新跑 _tools/gen-splash.py，这里就红。
//   （同 check-timeslot.js 让样本 AI 输出走一遍 normalizePlan 的思路：让两头对账。）
const fs = require('fs');
const path = require('path');
const png = require('./lib/png');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
// ⚠️ uniapp-PWstudy/** 在工作区里是 CRLF：任何带 \n 的字面量都会静默匹配不到（已踩过）
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let fail = 0, pass = 0;
const ok = (m) => { pass++; console.log('  ✓ ' + m); };
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

// PNG 真实像素尺寸（读 IHDR，不依赖任何图像库）
function pngSize(buf) {
  if (buf.slice(1, 4).toString('latin1') !== 'PNG') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

let mf;
try {
  mf = JSON.parse(R('manifest.json'));
} catch (e) {
  console.error('  ✗ manifest.json 不是严格 JSON：' + e.message);
  process.exit(1);
}
const ap = mf['app-plus'] || {};
const dist = ap.distribute || {};

// ---------- 1. 图标配置层级 ----------
console.log('== 1. 图标配置层级 ==');
assert(!(dist.android && dist.android.icons),
  'distribute.android 下没有 icons（错层级：打包会静默忽略，回退到 DCloud 绿 H）');
const icons = dist.icons || {};
const androidIcons = icons.android || {};
assert(Object.keys(androidIcons).length > 0, '图标挂在 distribute.icons.android（正确层级）');

// ---------- 2. 图标文件与尺寸 ----------
console.log('== 2. 图标文件 ==');
const ICON_PX = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
Object.keys(ICON_PX).forEach(k => {
  const rel = androidIcons[k];
  if (!rel) { bad('缺少 ' + k + ' 图标配置'); return; }
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { bad(k + ' 图标文件不存在：' + rel); return; }
  const buf = fs.readFileSync(p);
  const size = pngSize(buf);
  if (!size) { bad(k + ' 不是合法 png：' + rel); return; }
  // 体积兜底：DCloud 默认图在那个尺寸下只有几百字节，我们的真图都是几 KB 起
  assert(size.w === ICON_PX[k] && size.h === ICON_PX[k] && buf.length > 1024,
    k + ' 图标 ' + size.w + 'x' + size.h + ' / ' + buf.length + ' 字节（要求 ' + ICON_PX[k] + ' 且非默认图）');
});

// ---------- 3. 启动图必须是合法 .9.png ----------
console.log('== 3. 启动图（.9.png 九宫格）==');
const spl = dist.splashscreen || {};
const style = spl.androidStyle;
assert(style === undefined || style === 'common' || style === 'default',
  'androidStyle 取值合法（' + (style || '未设置=通用启动界面') + '）');

// 各档「内容区」尺寸，取自 uni-app 官方 manifest 说明；落盘文件各方向 +2px 放黑线
const CONTENT = { hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [1080, 1920] };
const targets = (style === 'default') ? (spl.android || {}) : {};
if (style === 'default') {
  Object.keys(CONTENT).forEach(k => {
    const rel = targets[k];
    if (!rel) { bad(k + ' 启动图未配置（三档都要给，缺档的设备会回退到通用启动界面）'); return; }
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { bad(k + ' 启动图文件不存在：' + rel); return; }
    if (!/\.9\.png$/.test(rel)) { bad(k + ' 启动图不是 .9.png（普通 png 会被铺满整屏拉伸变形）：' + rel); return; }
    const buf = fs.readFileSync(p);
    const size = pngSize(buf);
    if (!size) { bad(k + ' 启动图不是 png（jpg 改名会在打包时报错）：' + rel); return; }
    const w = CONTENT[k];
    assert(size.w === w[0] + 2 && size.h === w[1] + 2,
      k + ' 启动图 ' + size.w + 'x' + size.h + '（应为内容 ' + w[0] + 'x' + w[1] + ' + 2px 黑线）');

    // ---- 黑线结构：这是「拉伸不变形」的唯一保证，必须逐像素看
    let img;
    try { img = png.decode(buf); } catch (e) { bad(k + ' 启动图解码失败：' + e.message); return; }
    const top = png.blackRuns(img, 'top');       // 可水平拉伸的列
    const left = png.blackRuns(img, 'left');     // 可垂直拉伸的行
    const right = png.blackRuns(img, 'right');   // padding
    const bottom = png.blackRuns(img, 'bottom');

    // 右、下要"拉满"（官方：不拉满部分设备会显示灰色区域）
    assert(right.length === 1 && bottom.length === 1 &&
      right[0][0] === 0 && right[0][1] === size.h - 2 &&
      bottom[0][0] === 0 && bottom[0][1] === size.w - 2,
      k + ' 右边/下边黑线拉满（否则部分设备显示灰边）');

    // 上边/左边黑线必须是**一整段**（全幅可拉伸）：启动图只画渐变背景，
    // 画面里没有任何不可拉伸的图案（图案全交给 cover 页淡入，见第 5 组）。
    // 整幅可拉伸 + 平滑渐变 = 任意屏幕比例都无感；往启动图上加回图案，这里会红。
    assert(top.length === 1 && top[0][0] === 0 && top[0][1] === size.w - 2,
      k + ' 上边黑线一整段（纯渐变背景全幅可拉伸），实际 ' + top.length + ' 段');
    assert(left.length === 1 && left[0][0] === 0 && left[0][1] === size.h - 2,
      k + ' 左边黑线一整段（纯渐变背景全幅可拉伸），实际 ' + left.length + ' 段');

    // 四条边除黑线外必须透明，否则 aapt 认不出黑线
    ['top', 'left', 'right', 'bottom'].forEach(edge => {
      assert(png.restTransparent(img, edge), k + ' ' + edge + ' 边非黑线的像素全透明（aapt 靠这个认黑线）');
    });
  });
} else {
  ok('未启用自定义启动图 → 走「通用启动界面」（应用图标 + 应用名 + 加载圈）');
}

// ---------- 4. 启动界面关闭策略 ----------
console.log('== 4. 启动界面关闭策略 ==');
const spCfg = ap.splashscreen || {};
// ⚠️ HBuilderX 的 manifest 可视化编辑器在改动「模块配置」时会顺手把这一项写回 false
// （实测：取消勾选某个原生模块之后它变成了 false）。这里是**故意**设成 true 的 ——
// 我们启用了自定义启动图（复现 cover 首帧的底色），必须让它撑到首页首帧渲染完再撤，
// 否则中间会闪一帧白底。看到这条红，直接把 manifest 改回 true，别改断言。
assert(spCfg.alwaysShowBeforeRender === true,
  'alwaysShowBeforeRender=true（等首页渲染完再关启动图，避免闪白；HBuilderX 改模块时会写回 false，改回来即可）');
assert(spCfg.autoclose === true, 'autoclose=true（自动关闭）');
assert(typeof spCfg.delay === 'number', 'delay 是数字（' + spCfg.delay + '）');
if (spCfg.waiting === false) ok('waiting=false（自定义启动图上不再叠 DCloud 的加载圈）');
else if (typeof spCfg.waiting === 'boolean') ok('waiting=' + spCfg.waiting + '（自定义启动图上会多一个加载圈，观感自行确认）');

// ---------- 5. 启动图 ↔ cover 首帧：颜色 + 淡入 ----------
console.log('== 5. 与 cover 首帧的衔接 ==');
{
  // 5.1 从源码推导 cover 首帧的底色（推导链见文件头）
  const settings = R('utils/settings.js');
  const theme = R('utils/theme.js');
  const cover = R('pages/cover/cover.vue');
  let accent = null, bgkey = null, brand = null, base = null, angle = 0, stops = null;

  const mAcc = settings.match(/\baccent:\s*'([A-Za-z0-9_]+)'/);
  const mBg = settings.match(/\bbackground:\s*'([A-Za-z0-9_]+)'/);
  const mBrand = theme.match(new RegExp("\\{\\s*key:\\s*'" + (mAcc ? mAcc[1] : '') + "'[\\s\\S]{0,240}?rgb:\\s*'([\\d\\s,]+)'"));
  const mSolid = theme.match(new RegExp("\\{\\s*key:\\s*'" + (mBg ? mBg[1] : '') + "'[\\s\\S]{0,420}?solid:\\s*'(#[0-9a-fA-F]{6})'"));
  // cover 的品牌渐变：三档都要用 --brand-rgb（深色那条中间一档是 rgba(8,10,9,.6)，自然被排除）
  const stopRe = /rgba\(var\(--brand-rgb[^)]*\)\s*,\s*([\d.]+)\)\s*([\d.]+)%/g;
  const gradRe = /linear-gradient\((\d+)deg,([^;]*)\)/g;
  let g;
  while ((g = gradRe.exec(cover))) {
    const found = [];
    let s;
    stopRe.lastIndex = 0;
    while ((s = stopRe.exec(g[2]))) found.push([parseFloat(s[1]), parseFloat(s[2])]);
    if (found.length === 3 && found[0][1] === 0 && found[2][1] === 100) {
      angle = parseInt(g[1], 10);
      stops = found.map(([a, pos]) => [pos / 100, a]);
      break;
    }
  }

  if (!mAcc || !mBg || !mBrand || !mSolid || !stops) {
    bad('推导 cover 首帧底色的链子断了（settings.js / theme.js / cover.vue 有一处改了写法），'
      + ' 需要同步更新本脚本与 _tools/gen-splash.py');
  } else {
    accent = mAcc[1]; bgkey = mBg[1];
    brand = mBrand[1].split(',').map(x => parseInt(x.trim(), 10));
    const h = mSolid[1].slice(1);
    base = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    // 半透明渐变合成到实色底上：c = base·(1-a) + brand·a
    const want = stops.map(([pos, a]) => [pos,
      [0, 1, 2].map(i => Math.round(base[i] * (1 - a) + brand[i] * a))]);
    const hex = (c) => '#' + c.map(v => ('0' + v.toString(16)).slice(-2)).join('');
    ok('推导出首帧色标 ' + want.map(([p, c]) => hex(c) + '@' + Math.round(p * 100) + '%').join(' → ')
      + '（出厂 ' + accent + ' / ' + bgkey + '）');

    // 5.2 拿启动图的真实像素对账（三档都查角点 + 中心）
    const gradAt = (t) => {
      t = Math.max(0, Math.min(1, t));
      for (let i = 0; i < want.length - 1; i++) {
        const [t0, c0] = want[i], [t1, c1] = want[i + 1];
        if (t >= t0 && t <= t1) {
          const k = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
          return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
        }
      }
      return want[want.length - 1][1];
    };
    const rad = angle * Math.PI / 180;
    const dx = Math.sin(rad), dy = -Math.cos(rad);   // CSS 0deg = to top，顺时针为正

    Object.keys(CONTENT).forEach(k => {
      const rel = targets[k];
      if (!rel) return;
      const p = path.join(ROOT, rel);
      if (!fs.existsSync(p)) return;
      let img;
      try { img = png.decode(fs.readFileSync(p)); } catch (e) { return; }
      const CW = CONTENT[k][0], CH = CONTENT[k][1];
      if (img.w !== CW + 2 || img.h !== CH + 2) return;      // 尺寸已在第 3 组报过
      const projs = [];
      [0, CW - 1].forEach(x => [0, CH - 1].forEach(y => projs.push(x * dx + y * dy)));
      const lo = Math.min.apply(null, projs), hi = Math.max.apply(null, projs);
      const span = (hi - lo) || 1;
      const pts = [[0, 0, '左上'], [CW - 1, 0, '右上'], [0, CH - 1, '左下'],
        [CW - 1, CH - 1, '右下'], [Math.floor(CW / 2), Math.floor(CH / 2), '中心']];
      let worst = 0;
      pts.forEach(([x, y]) => {
        const got = png.pixel(img, x + 1, y + 1);            // +1 = 跳过黑线边框
        const exp = gradAt(((x * dx + y * dy) - lo) / span);
        const d = Math.max(Math.abs(got[0] - exp[0]), Math.abs(got[1] - exp[1]), Math.abs(got[2] - exp[2]));
        if (d > worst) worst = d;
      });
      // 容差 8：渐变很平（1080px 上总共才 25 个色阶），8bit 取整 + 放大插值的误差远小于它；
      // 而配色一旦真改了（换主题色 / 换底色），角点差值是几十。
      assert(worst <= 8,
        k + ' 启动图颜色与 cover 首帧一致（最大通道差 ' + worst + ' ≤ 8）'
        + (worst > 8 ? ' —— 封面配色变了但没重新跑 _tools/gen-splash.py' : ''));
    });

    // 5.3 cover 的圆框必须淡入：启动图只画背景，图案若"啪"地出现就还是一次硬切。
    //
    // ⚠️ 这里钉的是**意图**不是写法。早期版本钉的是 `opacity:0` 这个字面量，
    //    结果把"动画失效就白屏"的写法给保护起来了 —— 省电模式 / ROM 限制后台动画 /
    //    webview 差异下 animation 不执行，opacity:0 会一直生效，启动页只剩一张空渐变，
    //    而开发机上永远测不出来。
    //    正确写法是 opacity 交给 stageIn 的 from 帧 + backwards（延迟期套用 from，
    //    动画结束后回到元素自身 = 可见）。降级结果必须是"没有淡入"，不是"没有圆"。
    const si = cover.indexOf('<style');
    const stylePart = si >= 0 ? cover.slice(si) : '';
    const stageBlk = (stylePart.match(/\.stage\s*\{[^}]*\}/) || [''])[0];
    const stageInBlk = (stylePart.match(/@keyframes\s+stageIn\s*\{[\s\S]*?\}\s*\}/) || [''])[0];
    assert(/animation:\s*stageIn/.test(stageBlk),
      'cover 的 .stage 走 stageIn 淡入（接得住纯渐变启动图）');
    assert(/from\s*\{[^}]*opacity:\s*0/.test(stageInBlk),
      'stageIn 的 from 帧是透明的（圆框确实是"浮"出来的，不是硬切）');
    assert(!/opacity:\s*0\s*;/.test(stageBlk),
      '.stage 不许写死 opacity:0 —— 动画一旦不执行圆框就永远不出现（改用 backwards）');
    // 同理：品牌文字与底部提示（.anim）也不能靠 opacity:0 起步，否则整屏只剩一个圈
    const animBlk = (stylePart.match(/^\.anim\s*\{[^}]*\}/m) || [''])[0];
    assert(/animation:\s*fadeUp/.test(animBlk) && !/opacity:\s*0\s*;/.test(animBlk),
      '.anim 用 fadeUp 淡入且不写死 opacity:0（动画失效时文字照常显示）');
  }
}

// ---------- 6. static/splash 目录卫生 ----------
console.log('== 6. 启动图目录卫生 ==');
{
  const dir = path.join(ROOT, 'static', 'splash');
  if (!fs.existsSync(dir)) {
    bad('static/splash 不存在 —— 启动图没了？跑 _tools/gen-splash.py 重新生成');
  } else {
    // 精确比对清单：static/ 下的文件会**全部**打进 apk，
    // 多一个普通 png 就是白占体积；少一个说明 manifest 指了不存在的档。
    // 顺带兜住"反向测试留下的坏图忘了删"（那些也是 .9.png，只查后缀是查不出来的）。
    const want = Object.keys(CONTENT).map(k => (targets[k] || '').split('/').pop()).filter(Boolean).sort();
    const got = fs.readdirSync(dir).sort();
    assert(JSON.stringify(got) === JSON.stringify(want),
      'static/splash 内容与 manifest 一一对应：[' + got.join(', ') + ']'
      + (JSON.stringify(got) === JSON.stringify(want) ? '' : ' ≠ 期望 [' + want.join(', ') + ']'));
  }
  // 生成脚本还在，改设计可复现
  assert(fs.existsSync(path.join(__dirname, 'gen-splash.py')), '保留下 gen-splash.py 生成脚本（可复现）');
}

console.log('\n' + (fail ? '✗ FAIL ' + fail : '✓ ALL PASS ' + pass + ' 项'));
process.exitCode = fail ? 1 : 0;
