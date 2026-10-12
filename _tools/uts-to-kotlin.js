// _tools/uts-to-kotlin.js - 本地把 uni_modules 的 .uts 转成 Kotlin（不用等云打包）
//
// 为什么需要它：UTS 的类型坑（Number() / Int→Long / String(CharSequence) / 不存在的常量）
// **只有编译才暴露**，而云打包一轮要 3-30 分钟（失败也要 24s 才报错）。
// 这里直接调 HBuilderX 自带的那个编译器（plugins/uniapp-uts-v1 → @dcloudio/uts 的
// native binding），秒级拿到生成的 .kt，肉眼/正则就能看出问题。
//
// 用法：
//   node _tools/uts-to-kotlin.js                       # 转 pwstudy-focus，输出到 _tools/_scratch/_kt/
//   node _tools/uts-to-kotlin.js <输出路径>
//
// ⚠️ 必须用 **HBuilderX 自带的 node18** 跑（native binding 是按那个 ABI 编的），
//    用别的高版本 node 会直接 panic：
//    "C:/Users/33156/Documents/HBuilderX.5.26.2026091802/HBuilderX/plugins/node18/node.exe" _tools/uts-to-kotlin.js
//
// ⚠️ 它只做**转译**，不做 Kotlin 的类型检查。生成物对不对最终还得靠一次云打包确认；
//    但"Number( / String( / 常量赋给 long"这几类一眼就能看出来，能省掉绝大多数往返。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'uniapp');
const SRC = path.join(ROOT, 'uni_modules', 'pwstudy-focus', 'utssdk', 'app-android', 'index.uts');

// ---- 找 HBuilderX 自带的 UTS 编译器（装过多个版本就挑版本号最大的那个）----
function findCompiler() {
  const roots = [];
  ['C:/Users/33156/Documents', 'C:/Program Files', 'C:/', 'D:/'].forEach((base) => {
    if (!fs.existsSync(base)) return;
    try {
      fs.readdirSync(base).forEach((n) => {
        if (/^HBuilderX/i.test(n)) roots.push(path.join(base, n));
      });
    } catch (e) {}
  });
  const tail = ['plugins', 'uniapp-uts-v1', 'node_modules', '@dcloudio', 'uts', 'dist', 'api.js'];
  const hits = [];
  roots.forEach((r) => {
    // 两种布局都得试：`HBuilderX.5.26.../HBuilderX/plugins/...`（绿色版解压出来多一层）
    // 和 `.../HBuilderX/plugins/...`（直接就是安装目录）
    [r, path.join(r, 'HBuilderX')].forEach((base) => {
      const cand = path.join(base, ...tail);
      if (fs.existsSync(cand)) hits.push({ r: base, cand });
    });
  });
  if (!hits.length) return null;
  hits.sort((a, b) => (a.r < b.r ? 1 : -1));   // 目录名带版本号，字典序即版本序
  return hits[0];
}

const found = findCompiler();
if (!found) {
  console.error('✗ 没找到 HBuilderX 的 UTS 编译器（plugins/uniapp-uts-v1/.../@dcloudio/uts/dist/api.js）');
  process.exit(1);
}
const { toKotlinCode } = require(found.cand);

const OUT = process.argv[2] || path.join(__dirname, '_scratch', '_kt', 'index.kt');

(async () => {
  const res = await toKotlinCode({
    hbxVersion: path.basename(found.r),
    input: {
      root: ROOT,
      filename: SRC,
      // ⚠️ 两个坑（都是静默的，踩了只会得到一个空结果 / Rust panic）：
      //   ① toKotlinCode 走「给源码字符串」那条路，必须带 input.fileContent；
      //      只给 filename 的话内部 resolveCodeOptions 返回 undefined → 结果是 ''（看着像成功）
      //   ② 它**不复用** toKotlin 那套 normalize —— sourceMap 必须是字符串 ''，
      //      传 false 会让 native 那边反序列化失败（"invalid type: boolean, expected a string"）
      fileContent: fs.readFileSync(SRC, 'utf8'),
      paths: {}
    },
    output: {
      outDir: path.dirname(OUT),
      package: 'uts.sdk.modules.pwstudyFocus',
      extname: 'kt',
      sourceMap: '',
      imports: [],
      isApp: true,
      isPlugin: true,
      logFilename: false,
      noColor: true
    }
  });
  if (!res || res.error) {
    console.error('✗ 编译没出结果：', (res && res.error) || '(空)');
    process.exit(1);
  }
  const code = typeof res === 'string' ? res
    : (typeof res.code === 'string' ? res.code : null);
  if (code == null) {
    console.error('✗ 返回内容不是代码：' + JSON.stringify(res).slice(0, 400));
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, code);
  console.log('✓ ' + path.relative(process.cwd(), OUT) + '（' + code.length + ' 字节 / '
    + code.split('\n').length + ' 行）  ← ' + path.basename(found.r));

  // ---- 已知会炸的写法（与 _tools/check-uts.js 第 10 节同源，这里直接扫生成物）----
  const rules = [
    [/\bNumber\s*\(/, 'Number(x) = 实例化抽象类 java.lang.Number（用 (x as Number).toInt() 或改 Int 口径）'],
    [/\bString\s*\(\s*[a-zA-Z_]/, 'String(x)：Kotlin 的 String 只收 StringBuffer/StringBuilder/ByteArray/CharArray'],
    [/\bFLAG_DEFAULT\b/, "AccessibilityServiceInfo 里没有 FLAG_DEFAULT（叫 DEFAULT）"],
    [/Thread\.sleep\(\s*[A-Z][A-Z0-9_]*|notificationTimeout\s*=\s*[A-Z][A-Z0-9_]*/,
      'long 位置传了 UPPER_SNAKE 常量 —— Kotlin 只把**字面量**推断成 Long，Int 常量不放宽']
  ];
  let hits = 0;
  code.split('\n').forEach((l, i) => {
    rules.forEach(([re, why]) => {
      if (re.test(l)) {
        hits++;
        console.log('  ⚠ L' + (i + 1) + ': ' + l.trim().slice(0, 88) + '\n      ← ' + why);
      }
    });
  });
  console.log(hits ? '\n⚠ ' + hits + ' 处会编译失败（上面逐条列出了）'
    : '\n✓ 没扫到已知的 UTS 类型坑 —— 可以拿去云打包了');
  process.exitCode = hits ? 1 : 0;
})();
