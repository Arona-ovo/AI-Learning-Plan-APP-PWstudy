// _tools/check-amap-key.js - 高德（amap）key 在 manifest 里的**字段名与取值**校验（只读）
// 运行：node _tools/check-amap-key.js
//
// 为什么要这道闸（2026-10-27，真机 + 反编译实锤）：
//   用户报「学习地点 ＋ 加地点 → 定位失败，换一个地方再试一次」。
//   把手机里 1.3.5 的包（versionCode 109）拉下来用 aapt 看 AndroidManifest，铁证是：
//       A: android:name="com.amap.api.v2.apikey"
//       A: android:value=""  (Raw: "")
//   两个 meta-data（地图 / 定位各一个）**值都是空串** → 高德 SDK 起不来
//   → uni.getLocation({type:'gcj02'}) 直接 fail → 界面只剩一句笼统的「定位失败」，
//   地图底图也不会出瓦片。
//
//   而项目 manifest 里明明写了 key —— 写的是：
//       "maps": { "amap": { "android": "...", "ios": "..." } }
//   官方「完整 manifest.json」schema 要求的是 **appkey_android / appkey_ios**：
//       "maps": { "amap": { "appkey_ios": "", "appkey_android": "" } }
//       "geolocation": { "amap": { "appkey_ios": "", "appkey_android": "" } }
//   字段名对不上 → 云端打包取不到值 → **静默注入空串**，HBuilderX 不报错、
//   本地跑标准基座也看不出来（标准基座用的是 DCloud 自己的 key）。
//   ⇒ 这类错误只有"打包后反编译 APK"或"这道闸"能拦住，所以把它固化成检查项。
//
// 校验项：
//   1) app-plus.modules 里 Geolocation 与 Maps 都勾了（少一个，对应 SDK 不进包）
//   2) maps.amap.appkey_android 是 32 位十六进制（不是占位符、不是空）
//   3) geolocation.amap.appkey_android 同样合法
//      —— uni.getLocation 走的是**定位**模块，只配 maps 不够
//   4) 不许再出现旧写法 maps.amap.android / .ios / geolocation.amap.android
//      （写了也不生效，只会让人误以为配好了）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MF = path.join(ROOT, 'uniapp-PWstudy', 'manifest.json');

let pass = 0;
let fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '\n      → ' + extra : '')); }
}

// manifest.json 允许 /* */ 注释，先剥掉再 parse
function readManifest() {
  const raw = fs.readFileSync(MF, 'utf8');
  return JSON.parse(raw.replace(/\/\*[\s\S]*?\*\//g, ''));
}

// 高德 Android key 是 32 位小写十六进制
function isRealKey(v) {
  return typeof v === 'string' && /^[0-9a-f]{32}$/i.test(v.trim());
}

console.log('高德 key 校验（manifest.json）');

let mf;
try {
  mf = readManifest();
} catch (e) {
  console.log('  ✗ manifest.json 解析失败：' + e.message);
  console.log('\n✗ FAIL 1 项');
  process.exitCode = 1;
  return;
}

const ap = mf['app-plus'] || {};
const modules = ap.modules || {};
const cfg = ((ap.distribute || {}).sdkConfigs) || {};

// ---- 1) 模块勾选 ----
assert(!!modules.Geolocation, 'app-plus.modules 勾了 Geolocation（定位模块，getLocation 靠它）');
assert(!!modules.Maps, 'app-plus.modules 勾了 Maps（地图模块，选点底图靠它）');

// ---- 2) 地图 key ----
const mapsAmap = (cfg.maps || {}).amap || {};
assert(isRealKey(mapsAmap.appkey_android),
  'maps.amap.appkey_android 是有效的 32 位十六进制 key',
  '当前值：' + JSON.stringify(mapsAmap.appkey_android) +
  '　官方字段名是 appkey_android，写成 android 云端打包会注入空值');

// ---- 3) 定位 key ----
const geoAmap = (cfg.geolocation || {}).amap || {};
assert(!!(cfg.geolocation && cfg.geolocation.amap),
  'sdkConfigs.geolocation.amap 存在（uni.getLocation 走定位模块，只配 maps 不够）');
assert(isRealKey(geoAmap.appkey_android),
  'geolocation.amap.appkey_android 是有效的 32 位十六进制 key',
  '当前值：' + JSON.stringify(geoAmap.appkey_android));

// ---- 4) 不许残留旧字段名 ----
const legacy = [];
if (Object.prototype.hasOwnProperty.call(mapsAmap, 'android')) legacy.push('maps.amap.android');
if (Object.prototype.hasOwnProperty.call(mapsAmap, 'ios')) legacy.push('maps.amap.ios');
if (Object.prototype.hasOwnProperty.call(geoAmap, 'android')) legacy.push('geolocation.amap.android');
if (Object.prototype.hasOwnProperty.call(geoAmap, 'ios')) legacy.push('geolocation.amap.ios');
assert(legacy.length === 0,
  '没有残留旧写法（android / ios）',
  '发现：' + legacy.join('、') + '　这两类字段打包时不生效，应改名为 appkey_android / appkey_ios');

// 注：versionCode / versionName 的一致性由 check-version-egg.js 负责，这里不重复。

console.log('\n' + (fail ? '✗ FAIL ' + fail : '✓ ALL PASS ' + pass + ' 项'));
process.exitCode = fail ? 1 : 0;
