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

console.log(fail ? ('\n启动封面巡检：' + fail + ' 项待处理') : '\n启动封面巡检全部通过');
process.exit(fail ? 1 : 0);
