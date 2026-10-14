// 反向测试：故意把「版本号 / 发布脚本」改坏，确认 check-version-egg.js 真的会红（防假绿）。
// 结束（或中途出错）一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 坑 1：**require(CHECK) 拿不到护栏的 promise**。check-version-egg.js 是个 async IIFE
//    `(async () => {...})()`，但它的返回值没有导出 —— require 拿到的是 module.exports
//    （空对象），IIFE 的 promise 根本收不到。所以只能把 `process.exit` 当成"跑完了"的信号。
// ⚠️ 坑 2：护栏用 `await import(file://.../data/build-info.js)` 读快照，而 **Node 的 ESM 缓存
//    按 URL、同进程内没法清** —— 实测第二次 import 拿的还是旧值（加 ?x=1 才破得了）。
//    于是"改坏 build-info.js 再跑一遍"这条用例**整份文件只能生效一次**（第一次加载）。
//    格式那组因此改成抠出护栏的正则逐个验（见最后一节），并保留一条真跑的兜底。
// ⚠️ 坑 3：这个沙箱里 spawnSync 直接 EBUSY，起不了子进程（第 23 条硬约束周边），
//    所以避不开坑 2 —— 否则每个用例起一个进程就都干净了。
// ⚠️ 别跟 run-all 并发跑：本脚本会临时改坏源码（第 23 条硬约束）。
// ⚠️ 注入一律用**正则**：String.replace 的 from 里 \r\n 是字面量不是换行（第 24 条）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CHECK = path.join(ROOT, '_tools', 'check-version-egg.js');
const BUILD_INFO = path.join(ROOT, 'uniapp-PWstudy', 'data', 'build-info.js');
const MANIFEST = path.join(ROOT, 'uniapp-PWstudy', 'manifest.json');
const PW = path.join(ROOT, '_tools', 'publish-wgt.js');

const FILES = [BUILD_INFO, MANIFEST, PW];
const backup = {};
FILES.forEach(f => { backup[f] = fs.readFileSync(f); });          // 用 Buffer 备份，保住 CRLF
function restore() { Object.keys(backup).forEach(f => fs.writeFileSync(f, backup[f])); }

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  const buf = [];
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (code, crash) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      process.exit = realExit;
      console.log = realLog;
      console.error = realErr;
      resolve({ code, buf, crash: crash || null });
    };
    // 不抛错 —— process.exit 就是 IIFE 的最后一句，让它自然结束最干净
    process.exit = (c) => finish(c == null ? 0 : c, null);
    try {
      require(CHECK);
    } catch (e) {
      if (!e || !e.__exit) finish(99, e);
    }
    // 保险：万一 await 卡死，别把整个反向测试挂在这
    timer = setTimeout(() => finish(-1, new Error('护栏没跑到 process.exit（await 卡住了？）')), 20000);
  });
}

async function shouldCatch(label, mutate, expect) {
  restore();
  const cur = {};
  FILES.forEach(f => { cur[f] = fs.readFileSync(f, 'utf8'); });
  try {
    mutate(cur);
  } catch (e) {
    bad(label + ' —— 注入失败：' + e.message);
    restore();
    return;
  }
  FILES.forEach(f => fs.writeFileSync(f, cur[f]));
  let r;
  try {
    r = await runCheck();
  } finally {
    restore();
  }
  const reds = r.buf.filter(l => l.indexOf('✗') >= 0);
  const joined = r.buf.join('\n');
  const hit = r.code !== 0 && reds.length > 0 && (!expect || joined.indexOf(expect) >= 0);
  if (hit) ok(label + '（红 ' + reds.length + ' 条）');
  else bad(label + ' —— 没被抓到：code=' + r.code + ' 红条=' + reds.length
    + (expect ? ' 期望看到「' + expect + '」' : '')
    + (r.crash ? ' 崩溃=' + r.crash.message : '')
    + (reds.length === 0 ? ' 输出尾巴：' + joined.slice(-200) : ''));
}

/** 按正则替换；替换**没有发生**就抛错（锚点失效 = 这条用例没测到东西） */
function sub(cur, file, re, to) {
  const before = cur[file];
  const after = before.replace(re, to);
  if (after === before) throw new Error('锚点没命中：' + re + ' @ ' + path.basename(file));
  cur[file] = after;
}

(async () => {
  console.log('== 反向：版本号格式（真跑，受 ESM 缓存限制只有首次生效） ==');
  await shouldCatch('build-info 的版本号退回带后缀的两段式 1.3beta', (cur) => {
    sub(cur, BUILD_INFO, /version: '[^']*'/, "version: '1.3beta'");
  }, '严格三段式');

  console.log('\n== 反向：manifest 侧（走 fs 读，不受缓存影响） ==');
  await shouldCatch('manifest versionName 被改成另一个三段式（与快照脱节）', (cur) => {
    sub(cur, MANIFEST, /"versionName"\s*:\s*"[^"]*"/, '"versionName" : "1.4.0"');
  }, 'versionName 与快照一致');

  await shouldCatch('manifest versionName 退回 beta 后缀', (cur) => {
    sub(cur, MANIFEST, /"versionName"\s*:\s*"[^"]*"/, '"versionName" : "1.3beta"');
  }, 'versionName 与快照一致');

  await shouldCatch('manifest versionName 写成两段式', (cur) => {
    sub(cur, MANIFEST, /"versionName"\s*:\s*"[^"]*"/, '"versionName" : "1.3"');
  }, 'versionName 与快照一致');

  console.log('\n== 反向：publish-wgt 不许替版本号做主（静态扫描，不受缓存影响） ==');
  await shouldCatch('--bump 又静默回退到宽松解析', (cur) => {
    sub(cur, PW, /const cur = parseVer\(from\);/, 'const cur = parseVer(from) || looseVer(from);');
  }, '版本来源只有严格的 parseVer');

  await shouldCatch('--bump 直接用 looseVer 的猜测当当前版本', (cur) => {
    sub(cur, PW, /const cur = parseVer\(from\);/, 'const cur = looseVer(from);');
  }, '不拿 looseVer 猜出来的数当当前版本');

  await shouldCatch('--bump 认不出来时不 fail，改用猜测值继续', (cur) => {
    sub(cur, PW, /fail\('版本号「' \+ from \+ '」不是 x\.y\.z/, 'ver = strVer(looseVer(from)); //');
  }, 'looseVer 的结果不会写进目标版本号');

  await shouldCatch('把 looseVer 的结果拼进目标版本号', (cur) => {
    sub(cur, PW, /ver = strVer\(\{ a: cur\.a, b: cur\.b, c: cur\.c \+ 1 \}\);/, 'ver = strVer(looseVer(from));');
  }, '目标版本号');

  await shouldCatch('wgt 文件名规则被改掉', (cur) => {
    sub(cur, PW, /'PWstudy-' \+ ver \+ '-n' \+ nativeCode \+ '\.wgt'/, "'PWstudy-' + ver + '.wgt'");
  }, 'wgt 文件名仍');

  console.log('\n== 反向：那条格式正则本身挡得住各种坏写法 ==');
  // 前面 build-info 那一组只能生效一次（ESM 缓存），这里把第 1 组依赖的正则抠出来，
  // 逐个验它会拒绝什么 / 会放行什么 —— 覆盖面不受缓存影响。
  const raw = fs.readFileSync(CHECK, 'utf8');
  const src = (raw.match(/assert\(\/(\^[^/]*\$)\/\.test\(String\(info\.version/) || [])[1];
  if (!src) {
    bad('抠不到第 1 组的格式正则（护栏结构变了？）');
  } else {
    ok('抠到第 1 组的格式正则：/' + src + '/');
    const fmt = new RegExp(src);
    ['1.3', '1.3beta', '1.3 Beta', '1.3.1-beta', '1.3.1 RC2', 'v1.3.1', '1.3.', '1.3.1.2', '', 'beta']
      .forEach(s => {
        const pass = fmt.test(s);
        if (pass) bad('坏版本号没被挡住：' + JSON.stringify(s));
        else ok('挡住了 ' + JSON.stringify(s));
      });
    ['1.3.1', '1.0.0', '12.34.56'].forEach(s => {
      if (!fmt.test(s)) bad('正常三段式被误判：' + s);
      else ok('放行了 ' + s);
    });
  }

  console.log('');
  if (fail === 0) console.log('反向测试全部通过：每一条都被 check-version-egg.js 抓住了 ✓');
  else console.log('反向测试失败 ' + fail + ' 项 ✗');
  process.exit(fail === 0 ? 0 : 1);
})();
