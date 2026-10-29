// 反向测试：故意把「学习范围」改坏，确认 check-range.js 真的会红。
// 结束（或中途出错）一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 同进程 require 而不是起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
// ⚠️ 别跟 run-all 并发跑：本脚本会临时改坏源码（第 23 条硬约束）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CHECK = path.join(ROOT, '_tools', 'check-range.js');
const U = path.join(ROOT, 'uniapp-PWstudy');
const PW = path.join(U, 'utils', 'pwstore.js');
const LOC = path.join(U, 'utils', 'location.js');
const HARVEST = path.join(U, 'utils', 'harvest.js');
const COACH = path.join(U, 'utils', 'coach.js');
const SETTINGS = path.join(U, 'utils', 'settings.js');
const MANIFEST = path.join(U, 'manifest.json');
const PAGES = path.join(U, 'pages.json');
const PROFILE = path.join(U, 'pages', 'profile', 'profile.vue');
const RANGE_PAGE = path.join(U, 'pkgPlan', 'pages', 'range', 'range.vue');
const APPVUE = path.join(U, 'App.vue');
const FOCUS = path.join(U, 'utils', 'focus.js');
const MAP_VUE = path.join(U, 'components', 'range-map', 'range-map.vue');

const FILES = [PW, LOC, HARVEST, COACH, SETTINGS, MANIFEST, PAGES, PROFILE, RANGE_PAGE, APPVUE, FOCUS, MAP_VUE];
const backup = {};
FILES.forEach(f => { backup[f] = fs.readFileSync(f); });
function restore() { Object.keys(backup).forEach(f => fs.writeFileSync(f, backup[f])); }

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  const buf = [];
  let code = 0;
  process.exitCode = 0;
  process.exit = (c) => { code = (c == null ? 0 : c); const e = new Error('__exit'); e.__exit = true; throw e; };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  let crash = null;
  try { require(CHECK); } catch (e) { if (!e || !e.__exit) crash = e; }
  process.exit = realExit;
  console.log = realLog;
  console.error = realErr;
  const c = crash ? 99 : (code || process.exitCode || 0);
  process.exitCode = 0;
  return { code: c, buf: buf, crash: crash };
}

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };

function shouldCatch(label, mutate, expect) {
  restore();
  const cur = {};
  FILES.forEach(f => { cur[f] = fs.readFileSync(f, 'utf8'); });
  try {
    mutate(cur);
  } catch (e) {
    bad(label + ' —— 注入失败：' + e.message);   // 锚点失效必须当失败（不能"什么都没测还打通过"）
    restore();
    return;
  }
  FILES.forEach(f => fs.writeFileSync(f, cur[f]));
  let r;
  try {
    r = runCheck();
  } finally {
    restore();
  }
  const reds = r.buf.filter(l => l.indexOf('✗') >= 0);
  const hit = r.code !== 0 && reds.length > 0
    && (!expect || r.buf.join('\n').indexOf(expect) >= 0);
  if (hit) ok(label + '（红 ' + reds.length + ' 条）');
  else bad(label + ' —— 没被抓到：code=' + r.code + ' 红条=' + reds.length
    + (expect ? ' 期望看到「' + expect + '」' : '')
    + (r.crash ? '  脚本崩了：' + r.crash.message : '')
    // 把实际红条打出来：只说"没抓到"看不出是护栏漏了还是期望文字写错了
    + (reds.length ? '\n      实际红条：' + reds.slice(0, 3).join(' || ') : '')
    + (reds.length === 0 ? '\n      输出尾巴：' + r.buf.slice(-4).join(' | ') : ''));
  restore();
}

/** 锚点替换：按目标文件自动转 CRLF（第 33 条），没命中就抛错 */
function swap(cur, file, from, to) {
  const before = cur[file];
  const crlf = before.indexOf('\r\n') >= 0;
  const f = crlf ? from.split('\n').join('\r\n') : from;
  const t = crlf ? to.split('\n').join('\r\n') : to;
  const next = before.replace(f, t);
  if (next === before) throw new Error('锚点没命中：' + from.slice(0, 70));
  cur[file] = next;
}

console.log('反向测试：check-range.js 应该抓到下面这些坏法');
console.log('');

// ---- 0. 元测试：基线必须是绿的 ----
{
  restore();
  const r = runCheck();
  if (r.code === 0) ok('基线：没改坏时 check-range.js 全绿');
  else bad('基线就不是绿的（code=' + r.code + '），下面的结果不可信：' +
    r.buf.filter(l => l.indexOf('✗') >= 0).slice(0, 5).join(' | '));
}

/* ---------- 1. 落库：只存布尔、只记翻转 ---------- */
shouldCatch('落库把经纬度也存了（位置进统计层）', (c) => {
  swap(c, PW, '  const rec = { at: ts, inside: !!inside };',
    '  const rec = { at: ts, inside: !!inside, lat: 39.9, lng: 116.4 };');
}, 'addRangeSample 里没有经纬度');

shouldCatch('不判翻转（每次取样都落一条 → 心跳日志）', (c) => {
  swap(c, PW, '  if (last && !!last.inside === !!inside) return null;\n', '');
}, '状态没翻转就不落库');

shouldCatch('一天的记录没有上限（老数据无限长）', (c) => {
  swap(c, PW, '  if (d.range.length > 60) d.range = d.range.slice(-40);   // 老数据不无限长\n', '');
}, '一天的记录有上限');

shouldCatch('过去的日子也硬补"到现在"（时长不可知却照算）', (c) => {
  swap(c, PW, '      if (k === tk && now > outStart) {', '      if (now > outStart) {');
}, '只对今天补"到现在"');

shouldCatch('不可知的尾巴不单独计数（静默丢掉还能看不出来）', (c) => {
  swap(c, PW, '        openEnds++;', '        // nothing');
}, 'openEnds');

/* ---------- 2. 取样：不做后台定位、有节流 ---------- */
shouldCatch('取样间隔缩到 1 分钟（拿电量换没用的精度）', (c) => {
  swap(c, LOC, 'const MIN_GAP_MS = 5 * 60 * 1000;', 'const MIN_GAP_MS = 60 * 1000;');
}, '至少隔 5 分钟');

shouldCatch('开了高精度定位（慢且费电）', (c) => {
  // ⚠️ 锚点跟着 location.js 的"三次取法"数组走：原来写的是 'isHighAccuracy: false,'
  //    （那时还是对象里的一个字段），重构后逗号在花括号外面，锚点就再也命中不了 ——
  //    这种"注入失败"必须当红，别当成"没测到也算过"。
  swap(c, LOC, "{ type: 'gcj02', isHighAccuracy: false }", "{ type: 'gcj02', isHighAccuracy: true }");
}, '不要求高精度定位');

shouldCatch('申请了后台定位权限', (c) => {
  swap(c, LOC, "    return ok('android.permission.ACCESS_FINE_LOCATION') || ok('android.permission.ACCESS_COARSE_LOCATION');",
    "    return ok('android.permission.ACCESS_FINE_LOCATION') || ok('android.permission.ACCESS_BACKGROUND_LOCATION');");
}, '不申请后台定位权限');

shouldCatch('enabled() 只看开关（没圈地点也去取定位）', (c) => {
  swap(c, LOC, '  return !!c.on && Array.isArray(c.places) && c.places.length > 0;', '  return !!c.on;');
}, 'enabled()');

shouldCatch('开关关着也去取定位', (c) => {
  swap(c, LOC, "  if (!enabled()) return Promise.resolve({ ok: false, reason: 'off' });\n", '');
}, '开关关着直接返回');

shouldCatch('没有节流（想取就取）', (c) => {
  swap(c, LOC, '  if (!force && Date.now() - lastCheckAt() < MIN_GAP_MS) {\n    return Promise.resolve({ ok: false, reason: \'throttled\' });\n  }\n', '');
}, '距上次取样太近就跳过');

shouldCatch('把坐标写进设置（留了副本）', (c) => {
  swap(c, LOC, 'patch({ lastCheckAt: Date.now(), lastInside: !!r.inside, lastDist: r.dist });',
    'patch({ lastCheckAt: Date.now(), lastInside: !!r.inside, lastDist: r.dist, lat: pos.lat, lng: pos.lng });');
}, '坐标不写进设置');

/* ---------- 3. 隐私红线 ---------- */
// ⚠️ 注入内容必须真的带上 lat / lng / .name 这些字样：
//    护栏盯的是"代码里有没有出现这些标识符"，塞一串数字坐标是抓不到的（假绿）。
shouldCatch('给 AI 的块里带了经纬度', (c) => {
  swap(c, HARVEST, "  const lines = ['【在 / 不在学习范围（近 ' + s.days + ' 天，本人设定的学习地点）】'];",
    "  const lines = ['【在 / 不在学习范围】lat=' + s.lat + ' lng=' + s.lng];");
}, 'rangeBlock 里没有经纬度');

shouldCatch('给 AI 的块里带了地点名', (c) => {
  swap(c, HARVEST, "  lines.push('- 不在范围内共 ' + s.times + ' 段",
    "  lines.push('- 地点：' + s.places[0].name + '，不在范围内共 ' + s.times + ' 段");
}, 'rangeBlock 里没有地点名');

shouldCatch('没写"不是偷懒"（模型会把人不在判成懈怠）', (c) => {
  swap(c, HARVEST, "  lines.push('- **这些时段他客观不在学习地点，做不了事，不是偷懒也不是能力下降**：' +\n    '不要据此下调对他的判断，不要在反馈里说\"投入不足\"之类的话。');\n", '');
}, '明写"不是偷懒');

shouldCatch('撞上时段的处置写成了 drop（直接砍任务）', (c) => {
  swap(c, HARVEST, '若正好撞上，用 move 挪开而不是 drop 砍掉。', '若正好撞上，用 drop 砍掉。');
}, 'move 挪开');

shouldCatch('收工对话的底稿里带了坐标', (c) => {
  swap(c, COACH, "      lines.push('不在学习范围内（近 ' + rg.days + ' 天",
    "      lines.push('lat=' + rg.lat + ' lng=' + rg.lng + ' 不在学习范围内（近 ' + rg.days + ' 天");
}, 'coach 上下文里没有经纬度');

/* ---------- 4. 接线 ---------- */
shouldCatch('重排不拼 rangeBlock（存了也不喂 AI）', (c) => {
  swap(c, HARVEST, '  const rb = rangeBlock();\n  if (rb) parts.push(rb);\n', '');
}, 'extraBlock 把 rangeBlock 拼进');

/* ---------- 4b. 取样时机 ---------- */
shouldCatch('打开 App 时不取样（只有设置页手动刷新，攒不出数据）', (c) => {
  swap(c, APPVUE, '    try { loc.checkNow() } catch (e) {}\n', '');
}, '切回前台');

shouldCatch('专注开始时不取样', (c) => {
  swap(c, FOCUS, '  armWatchdog();\n  rangeMark();', '  armWatchdog();');
  // ⚠️ expect 别绕开断言里的 ** 标记：'专注开始' 在 '专注**开始**时' 里匹配不上
}, '开始**时强制取样');

shouldCatch('专注结束时不取样（"中途出去了"永远攒不出来）', (c) => {
  swap(c, FOCUS, '  bumpRound();\n  // 结束这一下也要记：开始在场、结束在场，中间那段时间才算真的"人在"。\n' +
    '  // 只记开始不记结束的话，"专注中途出去了"这条信息永远攒不出来。\n  rangeMark();',
    '  bumpRound();');
}, '结束**时强制取样');

/* ---------- 5. 设置与入口 ---------- */
shouldCatch('默认把开关打开（关不掉的人被动授权）', (c) => {
  swap(c, SETTINGS, 'range: { on: false, places: []', 'range: { on: true, places: []');
}, '默认 range.on = false');

shouldCatch('pages.json 没注册页面（点进去白屏）', (c) => {
  swap(c, PAGES, '"path": "pages/range/range"', '"path": "pages/rangeX/rangeX"');
}, '注册了 range 页面');

shouldCatch('「我的」里没有入口（功能没人找得到）', (c) => {
  swap(c, PROFILE, "'/pkgPlan/pages/range/range'", "'/pkgPlan/pages/none/none'");
}, '有入口');

/* ---------- 6. 页面 ---------- */
shouldCatch('页面里用了系统原生弹窗（样式管不到）', (c) => {
  swap(c, RANGE_PAGE, "    refresh() {\n      this.on = loc.on();",
    "    refresh() {\n      uni.showModal({ title: 'x' });\n      this.on = loc.on();");
}, '没有系统原生弹窗');

shouldCatch('页面没有总开关（关不掉）', (c) => {
  swap(c, RANGE_PAGE, '<switch :checked="on" color="#e4173d" @change="toggle" />', '');
}, '有总开关');

shouldCatch('加地点没有转圈（取定位最坏轮三种取法，看着像卡死）', (c) => {
  swap(c, RANGE_PAGE, '<view v-if="locating" class="loc-spin"></view>', '');
}, '取定位时有转圈');

/* ---------- 6b. 地图编辑器 ---------- */
shouldCatch('地图手势又关回去（能看不能拖，用户以为卡死）', (c) => {
  swap(c, MAP_VUE, '        :enable-scroll="true"', '');
}, '地图手势显式打开');

shouldCatch('图钉又写成 28px（3 倍屏上只有 9dp，看不清）', (c) => {
  swap(c, MAP_VUE, '        width: 48,', '        width: 28,');
}, '图钉按物理像素写且够大');

shouldCatch('范围圈描边又写回 2px（真机只剩一根发丝）', (c) => {
  swap(c, MAP_VUE, '        strokeWidth: 4', '        strokeWidth: 2');
}, '范围圈描边够粗');

shouldCatch('定位退回地图里的 cover-view（点击偶发不派发 + 被切掉）', (c) => {
  swap(c, MAP_VUE, 'class="rm-ro-item rm-ro-loc"', 'class="rm-ro-item"');
}, '读数行里的普通 chip');

shouldCatch('归中之后不实测视野中心（点了没反应也查不出来）', (c) => {
  swap(c, MAP_VUE, 'ctx.getCenterLocation({', 'ctx.getCenterLocatioX({');
}, '实测视野中心');

shouldCatch('重挂地图不换 key（视野还是不动）', (c) => {
  swap(c, MAP_VUE, '      this.mapSeq += 1;', '      this.mapSeq = 1;');
}, '重挂才真的会重建视野');

/* ---------- 7. manifest ---------- */
shouldCatch('manifest 里加了后台定位权限', (c) => {
  swap(c, MANIFEST,
    '                    "<uses-permission android:name=\\"android.permission.ACCESS_FINE_LOCATION\\"/>"',
    '                    "<uses-permission android:name=\\"android.permission.ACCESS_FINE_LOCATION\\"/>",\n' +
    '                    "<uses-permission android:name=\\"android.permission.ACCESS_BACKGROUND_LOCATION\\"/>"');
  // ⚠️ expect 别贴着断言里的 ** 标记写：'没有后台定位权限' 在 '**没有**后台定位权限'
  //    里是**匹配不上**的（"没有"后面隔了两个星号），会假报"没抓到"
}, '后台定位权限');

shouldCatch('manifest 没勾 Geolocation 模块（打包出来取不了位置）', (c) => {
  swap(c, MANIFEST, '"Geolocation" : {', '"GeolocationX" : {');
}, '勾了 Geolocation 模块');

console.log('');
{
  restore();
  const r = runCheck();
  if (r.code === 0) ok('还原后仍是绿 ✓');
  else bad('还原后没回到绿：' + r.buf.filter(l => l.indexOf('✗') >= 0).slice(0, 5).join(' | '));
}
console.log('');
console.log(fail === 0 ? '反向测试全部通过 ✓（每条坏法都被抓到了）' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);
