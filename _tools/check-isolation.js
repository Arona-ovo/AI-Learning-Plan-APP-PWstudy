// _tools/check-isolation.js - PWstudy 与老 App（AWword 背单词）的隔离度巡检
//
// 背景：PWstudy 是从同一个 uni-app 工程原地转过来的（2026-10-09），不是新仓库。
// 所以"有没有隔离干净"不是看目录名字，而是看三件事：
//   ① 身份：appid / Android 包名 / scheme / 存储 key 会不会跟老 App 撞车
//   ② 代码：编译产物里还有没有老 App 的模块（尤其会把上百 KB 语料拖进包的那条链）
//   ③ 文案：界面上还有没有拿老 App 当主语的话
//
// 用法：node _tools/check-isolation.js
// 出口：有违反项就非 0（这是"待办清单"，不是回归类型 —— 清理到 0 之前它会一直红）
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', 'uniapp');
const P = (...a) => path.join(ROOT, ...a);

let bad = 0;
const report = (title, lines, hint) => {
  if (!lines.length) { console.log('  ✓ ' + title); return; }
  bad += lines.length;
  console.error('  ✗ ' + title + '（' + lines.length + ' 处）');
  lines.forEach(l => console.error('      ' + l));
  if (hint) console.error('      → ' + hint);
};

/* ---------------- 依赖图 ---------------- */
const IMPORT_RE = /(?:from|import)\s*['"]([^'"]+)['"]/g;
function resolve(from, spec) {
  const t = (p) => [p, p + '.vue', p + '.js', p + '.ts', path.join(p, 'index.js')]
    .find(c => fs.existsSync(c) && fs.statSync(c).isFile());
  if (spec.startsWith('.')) return t(path.resolve(path.dirname(from), spec)) || null;
  if (spec.startsWith('@/')) return t(path.resolve(ROOT, spec.slice(2))) || null;
  return null;
}
const srcOf = new Map();
function read(f) {
  if (!srcOf.has(f)) srcOf.set(f, fs.readFileSync(f, 'utf8'));
  return srcOf.get(f);
}
function closure(entry) {
  const set = new Set();
  const q = [P(entry)];
  while (q.length) {
    const f = q.pop();
    if (!f || set.has(f) || !fs.existsSync(f)) continue;
    set.add(f);
    let m; IMPORT_RE.lastIndex = 0;
    const src = read(f);
    while ((m = IMPORT_RE.exec(src))) {
      const r = resolve(f, m[1]);
      if (r && !set.has(r)) q.push(r);
    }
  }
  return set;
}
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const kb = (arr) => arr.reduce((s, f) => s + fs.statSync(f).size, 0) / 1024;

// 老 App 模块指纹
const OLD_MOD = /^(data\/(words|lexicon|lexicon-data|bookdata|sentences|wordbooks|common-words)\.js|utils\/(store|engine|wordbook|wordbook-task|session|judge|dict|lemma|sentence-index|iplus1|importer|word-session)\.js)$/;
// 语料四件套：只要它们被带进任何一个页面的闭包，体积问题就跑不掉
const CORPUS = /^data\/(lexicon-data|words|sentences|bookdata)\.js$/;

const rawPj = fs.readFileSync(P('pages.json'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1');
const pj = JSON.parse(rawPj);
const pages = pj.pages.map(p => p.path + '.vue')
  .concat((pj.subPackages || []).flatMap(sp => sp.pages.map(p => sp.root + '/' + p.path + '.vue')));

console.log('== 1. 编译产物里的老 App 模块 ==');
{
  const all = new Set();
  pages.forEach(p => closure(p).forEach(f => all.add(f)));
  closure('App.vue').forEach(f => all.add(f));
  const old = [...all].filter(f => OLD_MOD.test(rel(f)));
  report('没有老 App 模块被编译进去',
    old.map(f => rel(f) + ' (' + (fs.statSync(f).size / 1024).toFixed(0) + ' KB)').sort(),
    '死代码就直接删；还打算以后和老 App 联动的，挪到工作区根的 _removed_vocab/ 里，别留在 uniapp/ 编译范围');
}

console.log('== 2. 谁把语料拖进了自己的闭包 ==');
{
  const rows = [];
  for (const p of pages) {
    const set = closure(p);
    const hit = [...set].filter(f => CORPUS.test(rel(f)));
    if (hit.length) rows.push(p + '  拉进 ' + hit.length + ' 个语料文件 / ' + kb(hit).toFixed(0) + ' KB');
  }
  report('没有页面把词书语料拉进自己的分包', rows,
    'settings 页的注释已经写明"分包里别引语料"；chat 页是漏网的那条链 —— ' +
    'chat.vue → utils/wordbook.js → data/lexicon.js → data/lexicon-data.js');
}

console.log('== 3. App 身份是否会跟老 App 撞车 ==');
{
  const mf = JSON.parse(fs.readFileSync(P('manifest.json'), 'utf8'));
  const droid = (mf['app-plus'] && mf['app-plus'].distribute && mf['app-plus'].distribute.android) || {};
  const rows = [];
  // ⚠️ 字段名是全小写的 packagename，不是 packageName（驼峰）。
  //    这里以前写成驼峰，而 manifest 里当时也写的是驼峰 —— 两边都错，于是"假绿"：
  //    护栏看着存在就放行，uni-app 却根本不认，打包一直走默认包名 com.PWstudy。
  //    2026-10-12 用 aapt2 dump badging 才对照出来。两边都改对了。
  if (/packageName/.test(JSON.stringify(droid))) {
    rows.push('manifest 里出现了驼峰的 packageName —— uni-app 只认全小写的 packagename，驼峰那行不生效，打出来会变成默认包名 com.<App名>');
  }
  if (!droid.packagename) rows.push('manifest 里没有 android.packagename（全小写）—— 云打包会走默认值 com.<App名>，App 改名就跟着漂');
  else if (droid.packagename !== 'com.PWstudy') rows.push('包名写成 ' + droid.packagename + '（当前实测是 com.PWstudy；改包名会让已装的 App 变成另一个应用，且 AWword 侧检测会静默失效，两边文档必须同一天改）');
  if (mf.name !== 'PWstudy') rows.push('manifest.name = ' + mf.name + '（应为 PWstudy）');
  const schemes = (mf['app-plus'] && mf['app-plus'].schemes) || [];
  if (schemes.indexOf('pwstudy') < 0) rows.push('未声明 pwstudy:// scheme');

  // 全仓库扫"包名分叉"。分叉过两次，两次都很疼：
  //   ① 驼峰 packageName 不生效 → 打出来是默认的 com.PWstudy，声明与实际对不上
  //   ② 清理时把 com.PWstudy 手滑写成 com.PWStudy（大写 S）→ 又造出第二种写法
  // 后果是实打实的：adb uninstall 敲错就是空操作，对面 App 按文档检测更是直接静默失效。
  // 历史日志（.workbuddy/memory）是记录不是声明，不参与。
  const CANON = 'com.PWstudy';
  const stale = [];
  (function scan(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'unpackage', '.git', '_removed_vocab', '.workbuddy', 'fujian-english-trainer'].indexOf(e.name) >= 0) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { scan(p); continue; }
      if (!/\.(vue|js|ts|json|md)$/.test(e.name)) continue;
      read(p).split('\n').forEach((l, i) => {
        // 只抓"看起来像包名声明"的写法：com.pwstudy.app，或 com.PWStudy 这类大小写变体
        const m = l.match(/com\.(?:pwstudy\.app|PWStudy|PWstudy)/g) || [];
        m.forEach(hit => { if (hit !== CANON) stale.push(path.relative(ROOT, p) + ':' + (i + 1) + ' ' + hit); });
      });
    }
  })(ROOT);
  if (stale.length) rows.push('还有 ' + stale.length + ' 处包名写法与实测不一致：' + stale.slice(0, 6).join(' / '));

  report('App 身份与 scheme 已独立', rows,
    '包名要显式写（当前 ' + CANON + '，字段全小写 packagename）；全仓库不许出现别的写法（含大小写变体）；storage key 也别和 AWword 复用同一个前缀');
}

console.log('== 4. 存储 key 命名空间 ==');
{
  const keys = [];
  function scan(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'unpackage') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) scan(p);
      else if (/\.(js|ts|vue)$/.test(e.name)) {
        read(p).split('\n').forEach((l, i) => {
          const m = l.match(/const\s+KEY\s*=\s*'([^']+)'/);
          if (m) keys.push({ key: m[1], at: rel(p) + ':' + (i + 1) });
        });
      }
    }
  }
  scan(ROOT);
  // fj_eng_state_v1 是老 AWword 的状态键：留着就是为了给升级用户清旧数据，
  // 一旦确认两个 App 是分开安装的，它连同 utils/store.js 就该走人
  const oldKey = keys.filter(k => k.key === 'fj_eng_state_v1');
  console.log('  当前用到的 storage key:');
  keys.sort((a, b) => a.key.localeCompare(b.key)).forEach(k => console.log('      ' + k.key + '   ' + k.at));
  report('不存在老 App 的存储键', oldKey.map(k => k.key + '  ' + k.at),
    'PWstudy 自己的键统一 fj_pw_* / fj_app_*；fj_eng_state_v1 属于老 App');
}

console.log('== 5. 界面文案里还有没有拿老 App 当主语 ==');
{
  // 允许例外：link.js（跳背单词 App 的联动）、goal-templates（福建专升本属于考试主题，不是 App 名）
  // 白名单：跨 App 联动（link.js / goal-detail 的「用背单词 App 学」）、考试主题词
  // （福建专升本是考试名，不是 App 名）、以及还没清的词典条目。
  // ⚠️ 后面这几个是 2026-10-12 加进来的"伙伴 App 可选关联"：
  //    utils/partner.js 里存的是对方的包名/名字，pages/home/home.vue 里是首次询问的文案 ——
  //    它们提「背单词 App」指的是**另一款 App**，正是这条检查要放行的那一类，不是拿老 App 当主语。
  //    措辞上必须保持"伙伴/另一款 App"的口径，不能让人以为 PWstudy 自己在教背单词。
  const ALLOW = ['utils/link.js', 'data/goal-templates.js', 'data/wordbooks.js', 'data/sentences.js',
    'utils/i18n-en.js', 'utils/onboarding.js', 'pkgManage/pages/settings/settings.vue',
    'pkgPlan/pages/apps/apps.vue', 'pkgPlan/pages/wizard/wizard.vue', 'utils/dict.js',
    'pkgPlan/pages/goal-detail/goal-detail.vue',
    'utils/partner.js', 'pages/home/home.vue'];
  const HIT = /(AWword|AWord|背单词软件|背单词 App|看板娘)/;
  const rows = [];
  function scan(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'unpackage' || e.name === 'docs') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) scan(p);
      else if (/\.(vue|js|ts)$/.test(e.name)) {
        const r = rel(p);
        read(p).split('\n').forEach((l, i) => {
          if (/^\s*(\/\/|\*)/.test(l)) return;
          if (HIT.test(l)) rows.push(r + ':' + (i + 1) + '  ' + l.trim().slice(0, 60));
        });
      }
    }
  }
  scan(ROOT);
  report('界面上没有以 AWword 为主语的文案', rows.filter(r => {
    const f = r.split(':')[0];
    return ALLOW.indexOf(f) < 0;
  }), '白名单里的是"跨 App 联动"或"考试主题"的合理提及；其余应改成 PWstudy 口径');
}

console.log(bad ? ('\n隔离巡检：' + bad + ' 项待处理') : '\n隔离巡检全部通过');
process.exit(bad ? 1 : 0);
