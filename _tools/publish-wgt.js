#!/usr/bin/env node
// _tools/publish-wgt.js - 打 wgt 热更新包（发版用）
//
// 场景：只改了前端（页面 / 样式 / JS 逻辑）时，发一个几百 KB 的 wgt，
// 用户装完自动重启即可 —— 不用再传 20MB 的 APK，也不用用户点系统安装界面。
// **动了原生（权限 / 图标 / 启动图 / UTS 插件 / AppID）就必须发 APK**，
// wgt 改不了那些，硬装只会白屏。
//
// 用法（在仓库根）：
//   node _tools/publish-wgt.js                 # 用 manifest 的 versionName 打包
//   node _tools/publish-wgt.js --ver 1.0.1     # 指定版本号
//   node _tools/publish-wgt.js --bump          # 自动抬一个 patch 版本（1.0.0 → 1.0.1）
//                                              #   并同步 manifest.json / build-info.js
//                                              #   / _vocab/build.js 三处
//   node _tools/publish-wgt.js --dry           # 只打印计划，不落文件
//   node _tools/publish-wgt.js --upload        # 打完用 gh 上传（需要装了 gh 且登录过）
//   node _tools/publish-wgt.js --ver 1.1.1 --no-sync
//                                              # 打 1.1.1 的包，但**不**把源码三处
//                                              # 版本抬成 1.1.1（见下）
//
// 产物：uniapp-PWstudy/unpackage/release/wgt/PWstudy-<版本>-n<原生基线>.wgt
//   例：PWstudy-1.0.1-n101.wgt —— n101 = 这个包要求原生基座 versionCode ≥ 101。
//   客户端（utils/updater.js）读不到这么新的基座就直接引导去下完整包。
//
// ⚠️ 为什么版本号必须是 x.y.z：客户端靠它算大小（x*10000+y*100+z）来比新旧。
//    '1.0 Beta' 这种带字母的也能解析（取前两段），但**没法往下抬**，
//    所以第一次打包请显式 --ver 或 --bump。
//
// ⚠️ --no-sync 用在哪：APK 与 wgt **不在同一条编号线上**时。
//    首发的整包叫 beta（1.1beta，云打包界面也填它），热更包却走正式编号 1.1.1
//    —— 装了 beta 包的人开机就会被提示热更，正好把"红点 + 首页弹窗"这条链路
//    在真机上跑一遍；不然整包和热更包同号，客户端判定已是最新，永远测不到。
//    这种时候脚本要是顺手把 manifest 抬成 1.1.1，就跟打包界面填的 1.1beta
//    对不上了（源码版本 ≠ 实际发行的版本）。所以给它 --no-sync。

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const U = (rel) => path.join(ROOT, 'uniapp-PWstudy', rel);
const MANIFEST = U('manifest.json');
const BUILD_INFO = U('data/build-info.js');
const VOCAB_BUILD = path.join(ROOT, '_vocab', 'build.js');
const SRC = U('unpackage/dist/build/app-plus');
const OUT_DIR = U('unpackage/release/wgt');
const RELEASE_URL = 'https://github.com/Arona-ovo/AI-Learning-Plan-APP-PWstudy/releases/tag/PWstudy';

const args = process.argv.slice(2);
const has = (f) => args.indexOf(f) >= 0;
function val(f) {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] && args[i + 1].charAt(0) !== '-' ? args[i + 1] : '';
}

/* ---------------- 版本号 ---------------- */

function parseVer(s) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(s || '').trim());
  if (!m) return null;
  return { a: Number(m[1]), b: Number(m[2]), c: Number(m[3] || 0) };
}
/**
 * 宽松解析：`1.1beta` / '1.0 Beta' 也读得出来（不锚首尾、取前两段）。
 *
 * ⚠️ --bump 必须拿它兜底：manifest 里现在写的是 `1.1beta`，用 parseVer 会返回
 *    null。**绝不能静默回退到 1.0.0** —— 那会打出 1.0.1 这种比当前还旧的包，
 *    客户端判定"已是最新"，用户永远收不到更新，而且看日志还一切正常。
 */
function looseVer(s) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(s || ''));
  if (!m) return null;
  return { a: Number(m[1]), b: Number(m[2]), c: Number(m[3] || 0) };
}
const strVer = (v) => v.a + '.' + v.b + '.' + v.c;

/* ---------------- zip（自己写，不引第三方、不起子进程） ---------------- */
// 为什么不用系统的 zip / PowerShell：本仓库零 npm 依赖，且子进程在部分环境下
// 直接 EBUSY 不可用。wgt 本质就是个 zip（manifest.json 必须在根），
// store + deflate 两种都支持，几十行就能写完。

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function writeZip(outPath, entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  entries.forEach((e) => {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = e.data;
    const comp = zlib.deflateRawSync(raw, { level: 9 });
    // 压不动（图片、已经压过的字体）就原样存 —— 强压只会更慢更大
    const useComp = comp.length < raw.length;
    const body = useComp ? comp : raw;
    const method = useComp ? 8 : 0;
    const crc = crc32(raw);

    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    nameBuf.copy(lh, 30);

    const ch = Buffer.alloc(46 + nameBuf.length);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);   // 对应 local header 的偏移
    nameBuf.copy(ch, 46);

    parts.push(lh, body);
    central.push(ch);
    offset += lh.length + body.length;
  });
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  fs.writeFileSync(outPath, Buffer.concat(parts.concat(central, [eocd])));
}

/**
 * 打完自己验一遍。
 * 为什么要：zip 写坏了也能存盘，用户装的时候才炸 —— 那时候已经发出去了。
 */
function verifyZip(p, n) {
  const b = fs.readFileSync(p);
  if (b.readUInt32LE(0) !== 0x04034b50) return '文件头不是 zip';
  let i = b.length - 22;
  while (i >= 0 && b.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) return '找不到 zip 结尾（包被写坏了）';
  const cnt = b.readUInt16LE(i + 10);
  if (cnt !== n) return '条目数对不上（写了 ' + n + '、读回 ' + cnt + '）';
  return '';
}

/**
 * 把包内 manifest.json 的版本改成目标版本（**只改内存里这一条，不落盘**）。
 *
 * 为什么必须改：产物 `app-plus/manifest.json` 里的 version 是**发行那一刻**的值，
 * 跟文件名没有关系。改了源码版本号却没重新发行，包里就还是旧版本 ——
 * 装完 `plus.runtime.getProperty` 报旧版本，客户端拿它跟文件名里的版本一比，
 * 以为没装上，**每次启动都再提示一遍更新（死循环）**。文件名说什么，包里就得是什么。
 *
 * `version.code` 也要跟着走：它是装完之后运行时报的 versionCode，
 * 客户端拿它跟 `-n<基线>` 比，写成旧值会让"基座太老"永远成立，同样死循环。
 */
function alignInnerVersion(entries, ver, code) {
  const hit = entries.filter(e => e.name === 'manifest.json')[0];
  if (!hit) return null;
  const m = JSON.parse(hit.data.toString('utf8'));
  const old = (m && m.version && m.version.name) || '(没有)';
  m.version = { name: ver, code: String(code) };
  hit.data = Buffer.from(JSON.stringify(m), 'utf8');
  return old;
}

/** 从刚写好的 zip 里读一条出来（自验用：确认包内版本真的写进去了） */
function readZipEntry(p, want) {
  const b = fs.readFileSync(p);
  let i = 0;
  while (i + 30 <= b.length && b.readUInt32LE(i) === 0x04034b50) {
    const method = b.readUInt16LE(i + 8);
    const csize = b.readUInt32LE(i + 18);
    const nlen = b.readUInt16LE(i + 26);
    const elen = b.readUInt16LE(i + 28);
    const name = b.toString('utf8', i + 30, i + 30 + nlen);
    const body = b.slice(i + 30 + nlen + elen, i + 30 + nlen + elen + csize);
    if (name === want) return method === 8 ? zlib.inflateRawSync(body) : body;
    i += 30 + nlen + elen + csize;
  }
  return null;
}

function walk(dir, base, out) {
  fs.readdirSync(dir).forEach((n) => {
    if (n === '.' || n === '..') return;
    // 调试产物不打进包：白占体积还可能带本机路径
    if (/\.map$/i.test(n) || n === '.DS_Store') return;
    const full = path.join(dir, n);
    const rel = base ? base + '/' + n : n;
    if (fs.statSync(full).isDirectory()) walk(full, rel, out);
    else out.push({ name: rel, data: fs.readFileSync(full) });
  });
  return out;
}

/* ---------------- 主流程 ---------------- */

function fail(msg) {
  console.error('\n✗ ' + msg);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const nativeCode = Number(manifest.versionCode) || 0;
if (!nativeCode) fail('manifest.json 里读不到 versionCode');

let ver = val('--ver');
if (ver && !parseVer(ver)) fail('版本号要写成 x.y.z，例如 1.0.1（收到：' + ver + '）');

if (has('--bump')) {
  const from = ver || manifest.versionName;
  const cur = parseVer(from) || looseVer(from);
  if (!cur) {
    fail('认不出版本号「' + from + '」，--bump 没法往下抬 —— 请显式给 --ver 1.1.1');
  }
  ver = strVer({ a: cur.a, b: cur.b, c: cur.c + 1 });
  console.log('抬版本：' + from + ' → ' + ver);
}
if (!ver) {
  if (!parseVer(manifest.versionName)) {
    fail('manifest 的 versionName 是「' + manifest.versionName +
      '」，不是 x.y.z —— 没法往下抬，请显式给 --ver 1.0.1（或加 --bump）');
  }
  ver = strVer(parseVer(manifest.versionName));
}

// 源目录：HBuilderX「发行 → wgt」或者直接跑过的 app-plus 产物
if (!fs.existsSync(SRC)) {
  fail('找不到打包产物 ' + path.relative(ROOT, SRC) +
    '\n  先在 HBuilderX 里跑一次「运行/发行 → 原生 App（含 wgt）」，或者直接给它一个目录。');
}
if (!fs.existsSync(path.join(SRC, 'manifest.json'))) {
  fail('产物目录里没有 manifest.json —— wgt 的根必须是它，打包会失败。');
}

const file = 'PWstudy-' + ver + '-n' + nativeCode + '.wgt';
const outPath = path.join(OUT_DIR, file);

console.log('\n打 wgt：');
console.log('  源    ' + path.relative(ROOT, SRC));
console.log('  版本  ' + ver + '（原生基线 n' + nativeCode + '）');
console.log('  产物  ' + path.relative(ROOT, outPath));

if (has('--dry')) {
  console.log('\n--dry：没落文件。');
  process.exit(0);
}

// 版本写回三处（manifest / build-info / _vocab 的生成常量），
// 少改一处下次生成语料就会把版本退回去（check-version-egg.js 会红）
if (!has('--no-sync') && (has('--bump') || val('--ver'))) {
  const cur = String(manifest.versionName || '');
  if (cur !== ver) {
    fs.writeFileSync(MANIFEST, fs.readFileSync(MANIFEST, 'utf8').replace(
      /"versionName"\s*:\s*"[^"]*"/, '"versionName" : "' + ver + '"'), 'utf8');
    console.log('  同步  manifest.json versionName ' + cur + ' → ' + ver);
  }
  const bi = fs.readFileSync(BUILD_INFO, 'utf8');
  if (bi.indexOf("version: '" + ver + "'") < 0) {
    fs.writeFileSync(BUILD_INFO, bi.replace(/version:\s*'[^']*'/, "version: '" + ver + "'"), 'utf8');
    console.log('  同步  data/build-info.js version → ' + ver);
  }
  if (fs.existsSync(VOCAB_BUILD)) {
    const vb = fs.readFileSync(VOCAB_BUILD, 'utf8');
    if (vb.indexOf("APP_VERSION = '" + ver + "'") < 0) {
      fs.writeFileSync(VOCAB_BUILD, vb.replace(/APP_VERSION\s*=\s*'[^']*'/, "APP_VERSION = '" + ver + "'"), 'utf8');
      console.log('  同步  _vocab/build.js APP_VERSION → ' + ver);
    }
  }
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const entries = walk(SRC, '', []);
const innerOld = alignInnerVersion(entries, ver, nativeCode);
if (innerOld && innerOld !== ver) {
  console.log('  对齐  包内版本 ' + innerOld + ' → ' + ver + '（文件名说 ' + ver + '，包里就得是 ' + ver + '）');
}
writeZip(outPath, entries);
const size = fs.statSync(outPath).size;
const why = verifyZip(outPath, entries.length);
if (why) fail('包打坏了：' + why + '\n  ' + outPath);
// 自验：从 zip 里把 manifest.json 读回来，确认包内版本就是文件名上那个版本
const backRaw = readZipEntry(outPath, 'manifest.json');
const back = backRaw ? JSON.parse(backRaw.toString('utf8')) : null;
if (!back || !back.version || back.version.name !== ver) {
  fail('包内 manifest.json 的版本没对齐（读到 ' +
    ((back && back.version && back.version.name) || 'null') + '，期望 ' + ver + '）\n  ' + outPath);
}
console.log('  完成  ' + entries.length + ' 个文件，' + (Math.round(size / 1024)) + ' KB');
// wgt 的根必须有 manifest.json：服务端不校验，但装的时候缺它就是"安装失败"
if (!entries.some(e => e.name === 'manifest.json')) fail('产物里没有根目录的 manifest.json');

if (has('--upload')) {
  console.log('\n上传：');
  try {
    const r = require('child_process').spawnSync(
      'gh', ['release', 'upload', 'PWstudy', outPath, '--clobber'],
      { stdio: 'inherit', shell: true }
    );
    if (r.error || r.status !== 0) {
      console.log('  gh 上传没成功（没装 gh / 没登录？）—— 那就手动传，步骤一样。');
    }
  } catch (e) {
    console.log('  调不起 gh —— 那就手动传，步骤一样。');
  }
}

console.log('\n下一步（把 wgt 传到固定 tag 的 Release）：');
console.log('  1. 打开 ' + RELEASE_URL);
console.log('  2. Edit release → 把 ' + file + ' 拖进 Attach assets');
console.log('  3. 在说明里写这次改了什么（会显示在「有新版本」弹窗里）');
console.log('  4. Update release');
console.log('\n传完之后，装了旧版本的 App 下次启动（或手动「检查更新」）就会收到热更新。');
console.log('校验：node _tools/check-updater.js');
