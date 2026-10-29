// _tools/check-range.js - 「学习范围」：落库、取样、喂给 AI 三条链
// 运行：node _tools/check-range.js
//
// 用户要的是：圈出常学习的地方，人不在的时候系统知道，拿去喂 AI 让它排得更懂事。
//
// 守五件事：
//   1) 落库只存"在 / 不在"这个布尔 —— 经纬度一个字节都不能进 daily
//   2) 只记状态翻转 —— 取定位是耗电动作，攒心跳日志就是拿电量换没用的精度
//   3) 不申请后台定位 —— ACCESS_BACKGROUND_LOCATION 是商店重点审查权限，
//      国产 ROM 上还各有各的限制，而我们要的只是"哪几段人不在"，不是轨迹
//   4) 关着的开关不申请权限、不取样（锦上添花的功能不能反过来绑架用户）
//   5) 喂给 AI 的只有时段与分钟数，且**必须明写"不是偷懒"** ——
//      不给这句话，模型看到"下午 3 小时不在"最常见的反应就是砍任务量或者在
//      总结里说"投入不足"，那等于把客观不在场误判成主观懈怠，跟初衷相反
//
// 只读，不改源码。
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./lib/load');

const PW = path.join(ROOT, 'utils', 'pwstore.js');
const LOC = path.join(ROOT, 'utils', 'location.js');
const HARVEST = path.join(ROOT, 'utils', 'harvest.js');
const COACH = path.join(ROOT, 'utils', 'coach.js');
const SETTINGS = path.join(ROOT, 'utils', 'settings.js');
const MANIFEST = path.join(ROOT, 'manifest.json');
const PAGES = path.join(ROOT, 'pages.json');
const PROFILE = path.join(ROOT, 'pages', 'profile', 'profile.vue');
const RANGE_PAGE = path.join(ROOT, 'pkgPlan', 'pages', 'range', 'range.vue');
const APPVUE = path.join(ROOT, 'App.vue');
const FOCUS = path.join(ROOT, 'utils', 'focus.js');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

const read = (p) => fs.readFileSync(p, 'utf8');
const pwSrc = read(PW);
const locSrc = read(LOC);
const harvestSrc = read(HARVEST);
const coachSrc = read(COACH);
const settingsSrc = read(SETTINGS);
const manifestSrc = read(MANIFEST);
const pagesSrc = read(PAGES);
const profileSrc = read(PROFILE);
const pageSrc = read(RANGE_PAGE);
const appSrc = read(APPVUE);
const focusSrc = read(FOCUS);

/** 先剥注释（第 12 条硬约束）—— 注释里满是"经纬度"这类关键词，不剥会误判 */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** 切函数体（第 22 条：先切函数体再匹配，别靠字符数凑） */
function fnBody(src, name) {
  let m = new RegExp('^[ \\t]*(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*' + name + '\\s*\\(', 'm').exec(src);
  if (!m) m = new RegExp('^[ \\t]{2,6}' + name + '\\s*\\(', 'm').exec(src);
  if (!m) return '';
  const j = src.indexOf('{', m.index + m[0].length);
  if (j < 0) return '';
  let d = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(j, k + 1); }
  }
  return src.slice(j);
}

/* ---------- 1. 数据层：只存布尔，只记翻转 ---------- */
console.log('== 1. pwstore：落库 ==');
['addRangeSample', 'rangeOf', 'rangeLast', 'rangeSummary'].forEach(fn => {
  assert(new RegExp('export function ' + fn + '\\s*\\(').test(strip(pwSrc)), '导出 ' + fn + '()');
});
const ars = fnBody(strip(pwSrc), 'addRangeSample');
assert(/inside: !!inside/.test(ars), '落库字段是 inside 布尔');
assert(!/\blat\b|\blng\b|latitude|longitude/.test(ars),
  'addRangeSample 里没有经纬度 —— 位置信息不进统计层');
assert(/if \(last && !!last\.inside === !!inside\) return null/.test(ars),
  '状态没翻转就不落库（不会攒成一串心跳日志）');
assert(/d\.range\.length > 60/.test(ars), '一天的记录有上限（老数据不无限长）');

const rs = fnBody(strip(pwSrc), 'rangeSummary');
assert(/function rangeSummary\s*\(key, days\)/.test(strip(pwSrc)),
  'rangeSummary(key, days) 签名与 extStudySummary 一致');
// 首尾不可知的段不许计入时长：宁可少报，也不能拿拼出来的时长让 AI 少排任务
assert(/k === tk && now > outStart/.test(rs),
  '"最后一次看到他还在外面"只对今天补"到现在"，过去的日子不计');
assert(/openEnds\+\+/.test(rs), '不可知的尾巴单独计数（openEnds）而不是硬凑时长');
assert(/outDays|outMin|topHours|spans/.test(rs), '摘要给出排期要用的四个读数');

/* ---------- 2. 取样：不做后台定位，有节流，开关关着不取样 ---------- */
console.log('== 2. location.js：怎么取样 ==');
const lstrip = strip(locSrc);
assert(/const MIN_GAP_MS = 5 \* 60 \* 1000/.test(lstrip), '两次取样至少隔 5 分钟（采样稀疏是设计）');
// ⚠️ 盯的是**第一种取法**：取法数组里后面还有一条高精度兜底，只搜 'isHighAccuracy: false'
//    的话，把第一条改成 true 也照样绿（neg-range 里那条变异就是这么假绿的）。
assert(/\{ type: 'gcj02', isHighAccuracy: false \}/.test(lstrip),
  '不要求高精度定位（第一种取法就是普通精度：只需要"在不在几百米内"）');
// ⚠️ 用剥过注释的源码：注释里专门提了这个常量名，拿原文搜会自己命中自己
assert(!/ACCESS_BACKGROUND_LOCATION/.test(lstrip), '不申请后台定位权限');
assert(/function enabled\(\)[\s\S]{0,200}?!!c\.on[\s\S]{0,200}?places\.length > 0/.test(lstrip) ||
  /return !!c\.on && Array\.isArray\(c\.places\) && c\.places\.length > 0/.test(lstrip),
  'enabled() = 开关打开 **且** 至少圈了一个地点');
const cn = fnBody(lstrip, 'checkNow');
assert(/if \(!enabled\(\)\) return Promise\.resolve\(\{ ok: false, reason: 'off' \}\)/.test(cn),
  '开关关着直接返回，不碰定位');
assert(/if \(!granted\(\)\)/.test(cn), '没权限就不取，不硬来');
assert(/Date\.now\(\) - lastCheckAt\(\) < MIN_GAP_MS/.test(cn), '距上次取样太近就跳过（force 除外）');
assert(/pw\.addRangeSample\(pw\.today\(\), r\.inside, Date\.now\(\)\)/.test(cn),
  '交下去的只有布尔 —— 经纬度到 insideAt 为止');
// 坐标在 checkNow 里**只该出现在一处**：交给 insideAt 算距离。
// 它本身是合法的（不落库、不外传），所以不能一棍子打死"出现 lat/lng 就算错"；
// 要盯的是它有没有顺着 patch / addRangeSample 流出去。
assert(((cn.match(/pos\./g) || []).length) === 2,
  '坐标只交给 insideAt 用一次、用完即弃（实际引用 ' + ((cn.match(/pos\./g) || []).length) + ' 处）');
assert(!/patch\(\{[^}]*pos\./.test(cn), '坐标不写进设置');
assert(/checkSelfPermission/.test(lstrip), '权限是实测的（checkSelfPermission），不是猜的');

/* ---------- 3. 隐私红线：AI 上下文里不能有位置 ---------- */
console.log('== 3. 隐私：喂给 AI 的只有时段 ==');
const rb = fnBody(strip(harvestSrc), 'rangeBlock');
assert(rb.length > 0, 'harvest 有 rangeBlock()');
assert(!/\blat\b|\blng\b|latitude|longitude/.test(rb), 'rangeBlock 里没有经纬度');
assert(!/places|place\.name|\.name/.test(rb), 'rangeBlock 里没有地点名');
// 这条是这功能的立身之本：不写清楚，模型会把"人不在"判成"人懈怠"
assert(/不是偷懒|不是懈怠|不要据此/.test(rb),
  '明写"不是偷懒 / 不是能力下降"，不许让模型据此下调判断');
assert(/不要硬塞|move 挪开而不是 drop 砍掉|用 move 挪开/.test(rb),
  '撞上这些时段要 move 挪开，不要 drop 砍掉');
const cb = fnBody(strip(coachSrc), 'context');
assert(/rangeSummary/.test(cb), 'coach.context 也带上这份数据');
assert(!/\blat\b|\blng\b|latitude|longitude/.test(cb), 'coach 上下文里没有经纬度');

/* ---------- 4. 接线：两条重排主线与收工对话都吃得到 ---------- */
console.log('== 4. 接线 ==');
const eb = fnBody(strip(harvestSrc), 'extraBlock');
assert(/const rb = rangeBlock\(\)/.test(eb) && /if \(rb\) parts\.push\(rb\)/.test(eb),
  'extraBlock 把 rangeBlock 拼进 extra（两条自动重排主线都走这里）');
assert(/RANGE_DAYS/.test(strip(harvestSrc)), '回溯天数走具名常量 RANGE_DAYS');

/* ---------- 4b. 取样时机：光有页面手动刷新攒不出数据 ---------- */
console.log('== 4b. 取样时机 ==');
// 只在设置页手动刷新是不够的：用户不会一天点十次"刷新"，
// 攒出来的数据喂给 AI 就是空的 —— 所以三个自动时机一条都不能少。
assert(/import \* as loc from '\.\/utils\/location\.js'/.test(appSrc), 'App.vue 引入了 location');
assert(/onShow\(\)[\s\S]{0,900}?loc\.checkNow\(\)/.test(appSrc),
  '打开 App / 切回前台时看一眼（不 force，交给 5 分钟节流）');
assert(/import \* as loc from '\.\/location\.js'/.test(focusSrc), 'focus.js 引入了 location');
const sf = fnBody(strip(focusSrc), 'startFocus');
assert(/rangeMark\(\)/.test(sf), '专注**开始**时强制取样');
const ff = fnBody(strip(focusSrc), 'finishFocus');
assert(/rangeMark\(\)/.test(ff), '专注**结束**时强制取样（少了这条，"中途出去了"永远攒不出来）');
assert(/loc\.checkNow\(true\)/.test(fnBody(strip(focusSrc), 'rangeMark')),
  '这两个点是 force（不被 5 分钟节流挡掉）');

/* ---------- 5. 设置：默认关 ---------- */
console.log('== 5. 设置与入口 ==');
assert(/range: \{ on: false, places: \[\]/.test(settingsSrc),
  'settings 默认 range.on = false（关着就一个权限都不申请）');
assert(/deepMerge\(defaults\(\), v\)/.test(settingsSrc),
  '老用户升级时缺省字段会自动补上（不会读到 undefined 崩）');
assert(/pages\/range\/range/.test(strip(pagesSrc)), 'pages.json 注册了 range 页面');
assert(/\/pkgPlan\/pages\/range\/range/.test(profileSrc), '「我的」里有入口');
assert(/loc\.on\(\) \? loc\.places\(\)\.length : -1/.test(profileSrc),
  '入口的副标题只在开关打开后才显示（关着不该挂"未开启"催人）');

/* ---------- 6. 页面 ---------- */
console.log('== 6. range 页面 ==');
assert(/components: \{[^}]*FloatNavbar[^}]*AppDialog[^}]*\}/.test(pageSrc), '弹窗走统一的 app-dialog');
assert(!/uni\.showModal|uni\.showActionSheet/.test(pageSrc),
  '页面里没有系统原生弹窗（样式管不到，一律走 app-dialog）');
assert(/switch :checked="on"/.test(pageSrc), '有总开关');
assert(/还没给定位权限/.test(pageSrc), '没权限时界面上说得出来');
assert(/不会发给 AI|不会发给/.test(pageSrc), '页面上把隐私边界写给用户看');
// 2026-10-29：取定位最坏要轮三种取法（8 秒一次），只把文字换成「定位中…」看着像卡死
assert(/v-if="locating" class="loc-spin"/.test(pageSrc), '「＋ 加地点」取定位时有转圈');
assert(/@keyframes loc-spin/.test(pageSrc), '转圈有 keyframes（不然是个静止的圈）');

/* ---------- 6b. 地图编辑器（2026-10-29 真机反馈后重做的那几处） ---------- */
console.log('== 6b. 地图编辑器 ==');
// 用户原话："这一块的 UI 和定位也有问题，点击完以后不会把定位点定位到目前用户的位置。"
// 拆开是四件事，每条都对应一个真机症状：
const MAP_VUE = path.join(ROOT, 'components', 'range-map', 'range-map.vue');
const mapSrc = read(MAP_VUE);
const mapTpl = mapSrc.slice(0, mapSrc.indexOf('</template>'));
// ① 手势：enable-scroll / enable-zoom 不写，部分内核默认关 —— "地图能看不能拖"
assert(/:enable-scroll="true"/.test(mapTpl) && /:enable-zoom="true"/.test(mapTpl),
  '地图手势显式打开（enable-scroll / enable-zoom，不写可能默认关）');
// ② 图钉尺寸是物理像素：28/36 在 3 倍屏上只有 9dp，缩成一个看不清的红点
const mkBlock = (mapSrc.match(/markers\(\)\s*\{[\s\S]*?\n    \}/) || [''])[0];
const mkSize = (mkBlock.match(/width:\s*(\d+)/) || [0, 0])[1] | 0;
assert(mkSize >= 44, '图钉按物理像素写且够大（width=' + mkSize + '，小于 44 在 3 倍屏上看不清）');
// ③ 范围圈：strokeWidth 是物理像素，写 2 在 3 倍屏上只有 0.7dp —— 真机上只剩一根发丝
const cBlock = (mapSrc.match(/circles\(\)\s*\{[\s\S]*?\n    \}/) || [''])[0];
const sw = (cBlock.match(/strokeWidth:\s*(\d+)/) || [0, 0])[1] | 0;
assert(sw >= 3, '范围圈描边够粗（strokeWidth=' + sw + '，2 在 3 倍屏上等于看不见）');
assert(/color: '#[0-9a-fA-F]{6}(ff)?'/.test(cBlock),
  '范围圈描边是实色（半透明描边铺在粉色底图上看不见）');
// ④ 定位按钮：App 端 cover-view 的点击偶发不派发，且原生地图不认容器圆角会把按钮切掉
assert(!/<cover-view/.test(mapTpl), '地图里不再用 cover-view（点击偶发不派发 + 被方形边界裁切）');
assert(/class="rm-ro-item rm-ro-loc"/.test(mapTpl) && /@tap="locateMe"/.test(mapTpl),
  '「定位」是读数行里的普通 chip（走普通 view 的命中区域）');
// ⑤ 归中要被"验过"：moveToLocation 在部分机型是空操作，必须实测视野中心
const ctr = (mapSrc.match(/recenter\(\)\s*\{[\s\S]*?\n    \}/) || [''])[0];
assert(/moveToLocation/.test(ctr), '归中先按文档调 moveToLocation');
assert(/getCenterLocation\(\{/.test(ctr), '归中之后实测视野中心（不然"点了没反应"查不出来）');
assert(/remountMap\(\)/.test(ctr), '实测没挪到位就换 key 重挂地图（原生层唯一的硬兜底）');
assert(/:key="mapSeq"/.test(mapTpl) && /this\.mapSeq \+= 1/.test(mapSrc),
  'map 绑了 :key="mapSeq"，重挂才真的会重建视野');
assert(/id="rangemap"|mapId: 'rangemap'/.test(mapSrc), '地图 id 唯一（createMapContext 靠它）');

/* ---------- 7. manifest：权限模块 ---------- */
console.log('== 7. manifest ==');
assert(/ACCESS_FINE_LOCATION/.test(manifestSrc) && /ACCESS_COARSE_LOCATION/.test(manifestSrc),
  '声明了前台定位权限');
assert(!/ACCESS_BACKGROUND_LOCATION/.test(manifestSrc), '**没有**后台定位权限');
assert(/"Geolocation"/.test(manifestSrc), '勾了 Geolocation 模块（不勾云打包出来取不了位置）');

/* ---------- 8. 真跑一遍 ---------- */
console.log('== 8. 真跑 ==');
const store = {};
global.uni = {
  getStorageSync: (k) => (k in store ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; }
};
try {
  const pw = load('utils/pwstore.js');
  const today = pw.today();
  const yest = pw.addDays(today, -1);
  const at = (d, h, m) =>
    new Date(d + 'T' + String(h).padStart(2, '0') + ':' + String(m || 0).padStart(2, '0') + ':00').getTime();

  assert(pw.addRangeSample(today, true, at(today, 8)) !== null, '第一条（进）落库');
  assert(pw.addRangeSample(today, false, at(today, 12)) !== null, '翻转（出）落库');
  assert(pw.addRangeSample(today, true, at(today, 13, 30)) !== null, '再翻转（回）落库');
  assert(pw.addRangeSample(today, true, at(today, 14)) === null, '没翻转不落库');

  // 昨天：出去了再没回来 → 时长不可知，不计
  pw.addRangeSample(yest, true, at(yest, 9));
  pw.addRangeSample(yest, false, at(yest, 10));

  const s = pw.rangeSummary(today, 7);
  assert(!!s, 'rangeSummary 有数据时不返回 null');
  assert(s.times === 1, '只算得出 1 段（昨天那段首尾不可知，不计），实际 ' + s.times);
  assert(s.outMin === 90, '那一段是 90 分钟，实际 ' + s.outMin);
  assert(s.outDays === 1, '涉及 1 天，实际 ' + s.outDays);
  assert(s.openEnds === 1, '昨天的尾巴进了 openEnds，实际 ' + s.openEnds);
  assert(s.spans.length === 1 && s.spans[0].min === 90, 'spans 里只有能确定的那一段');

  pw.reset();
  assert(pw.rangeSummary(today, 7) === null, '没数据时返回 null（不拿空块去占提示词）');
} catch (e) {
  bad('真跑崩了：' + (e && e.message));
}

console.log(fail ? '\n✗ 学习范围校验失败（' + fail + ' 条）' : '\n学习范围校验全部通过 ✓');
process.exitCode = fail ? 1 : 0;
