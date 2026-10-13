/**
 * _tools/check-apps-load.js —— 「学习 App 添加页加载慢」的回归护栏
 *
 * 背景（2026-10-14）：用户反馈「点添加 App 的时候，列表要加载比较久」。
 * 慢有三层原因，修法也分三层，这里逐条钉住，防止以后被改回去：
 *
 *   ① 每次都从头枚举系统应用（没有跨启动的缓存）
 *      → 落盘缓存 installedAppsCached()：点开就先渲染，后台再刷一次
 *   ② 枚举最多跑四轮全量系统扫描（含两次毫无意义的 MATCH_UNINSTALLED_PACKAGES）
 *      → 只跑两轮
 *   ③ 同一个包的名字被跨进程取两次（getApplicationLabel + loadLabel）
 *      → 已经有真名字的包跳过第二次
 *   ④ 读的时候界面没有任何反馈 → 用户以为是自己手机卡了
 *      → 转圈 + 说明文案 + 骨架行
 *
 * 外加搜索框的键盘间距（cursor-spacing / kb-open）。
 *
 * 反向测试：_tools/_scratch/neg-apps-load.js
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * 切出一个顶层函数的函数体。
 * ⚠️ 两种"下一个顶层"的形态顺序不能反：先找 `\nfunction `、再找 `\nexport function `，
 *    反过来会漏掉更近的那个边界，切出来的片段偏大（护栏就会抓不到注入的坏代码）。
 */
function fnBody(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  let end = src.length;
  const a = src.indexOf('\nfunction ', i + 1);
  const b = src.indexOf('\nexport function ', i + 1);
  const c = src.indexOf('\nconst ', i + 1);
  [a, b, c].forEach(p => { if (p > i) end = Math.min(end, p); });
  return src.slice(i, end);
}

let pass = 0;
let fail = 0;
function ok(m) { pass++; console.log('  ✓ ' + m); }
function bad(m) { fail++; console.log('  ✗ ' + m); }
function assert(c, m) { if (c) ok(m); else bad(m); }

// ⚠️ 这里是**同步** IIFE，不是 async。
//    run-all.js 是靠 `process.exit` 抛一个哨兵 Error 来中断同步 require 的；
//    一旦包成 async，那个 throw 就变成 rejection —— try{require()}catch 接不到，
//    最后落成一个 unhandledRejection，把整个全量回归进程崩掉（硬约束 26/27）。
//    本护栏没有 await，没必要 async；真有 await 的护栏才需要（那时退出码走 exitCode 那条路）。
try {
  const apptime = read('utils/apptime.js');
  const appsVue = read('pkgPlan/pages/apps/apps.vue');

  console.log('== 1. 落盘缓存：跨启动也能秒开 ==');
  assert(/const APPS_STORE_KEY\s*=/.test(apptime), '定义了落盘缓存的 key');
  assert(
    /uni\.setStorageSync\(APPS_STORE_KEY/.test(apptime),
    '读到列表后会写盘（下次冷启动点开就是秒出）'
  );
  assert(
    /export function installedAppsCached\(\)/.test(apptime),
    '对外提供 installedAppsCached()（页面先渲染用）'
  );

  // ⚠️ 这条是最容易写错的：installedAppsCached() 里一旦给 _appsCache 赋值，
  //    installedApps() 就会因为"进程内缓存还新鲜"直接短路返回 ——
  //    后台刷新永远不执行，新装的 App 就再也挑不到了（缓存变成死数据）。
  const cachedBody = fnBody(apptime, 'export function installedAppsCached()');
  assert(cachedBody.length > 0, 'installedAppsCached() 的函数体切得出来');
  assert(
    !/_\s*appsCache\s*=\s*arr/.test(cachedBody),
    '⚠️ 缓存读取**不**写进程内缓存标志（否则后台刷新被短路，新装的 App 补不上来）'
  );
  assert(
    !/_\s*appsCacheAt\s*=/.test(cachedBody),
    '⚠️ 缓存读取**不**刷新缓存时间戳（同上）'
  );
  assert(
    /if \(_appsCache && _appsCache\.length\) return _appsCache/.test(cachedBody),
    '本次进程已经真读过时才走内存缓存'
  );

  console.log('== 2. 只存"真读到了"的结果 ==');
  assert(
    /if \(out\.length\) \{/.test(apptime) && /saveAppsCache\(out\)/.test(apptime),
    '列表为空时不写缓存（偶发失败别被锁进缓存）'
  );

  console.log('== 3. 枚举轮数：去掉无意义的 MATCH_UNINSTALLED_PACKAGES ==');
  assert(
    !/sweep\('apps',\s*128\)/.test(apptime) && !/sweep\('pkgs',\s*128\)/.test(apptime),
    '不再枚举 MATCH_UNINSTALLED_PACKAGES(128) —— 那两轮纯属白等'
  );
  assert(
    /sweep\('apps', 0\) \|\| sweep\('pkgs', 0\)/.test(apptime),
    '只跑 apps / pkgs 两轮'
  );

  console.log('== 4. 名字只取一次（跨进程调用是慢的大头） ==');
  assert(
    /const named = \{\}/.test(apptime),
    '有 named 集合记录"哪些包已经拿到真名字"'
  );
  assert(
    /if \(nm !== pkg\) named\[pkg\] = 1/.test(apptime),
    'push 时把"名字不是拿包名顶替的"记进 named'
  );
  // ⚠️ 判的是 named 不是 seen：路 1 取名字失败时名字仍是包名，那种情况值得再试一次
  assert(
    /if \(named\[pkg\]\) continue/.test(apptime),
    '路 2 跳过已拿到真名字的包（不再重复 loadLabel）'
  );
  assert(
    !/if \(seen\[pkg\]\) continue/.test(apptime),
    '⚠️ 判据不是 seen（那样会把"路 1 拿到假名字"的包也跳过，名字永远补不上）'
  );

  console.log('== 5. 页面：先渲染，再刷新 ==');
  const loadBody = fnBody(appsVue, '    loadApps() {');
  assert(loadBody.length > 0, 'loadApps() 的函数体切得出来');
  assert(
    /apptime\.installedAppsCached\(\)/.test(loadBody),
    'loadApps 先取落盘缓存把列表铺出来'
  );
  assert(
    /this\.readApps\(true\)/.test(loadBody),
    '有缓存时走**静默**后台刷新（把新装的 App 补上来）'
  );
  assert(
    /this\.readApps\(false\)/.test(loadBody),
    '没缓存时才走带加载态的读取'
  );
  assert(
    /if \(this\._appsRefreshed\) return/.test(appsVue),
    '刷新只跑一次（_appsRefreshed 闸门，不会变成轮询）'
  );

  console.log('== 6. 静默刷新不许把已经显示出来的列表抹掉 ==');
  assert(
    /if \(list && list\.length\) this\.all = list/.test(appsVue),
    '读空了不覆盖已有列表'
  );
  assert(
    /else if \(!silent\) this\.all = \[\]/.test(appsVue),
    '只有非静默（首次）读取失败才清空'
  );

  console.log('== 7. 加载态：必须看得见"在读" ==');
  // ⚠️ 测**整句**不测词：只测 class 的话，把 v-if 改成 false（加载态永远不出现）
  //    照样是绿的 —— 那种"界面上其实什么都没有"的坏法才是真要防的。
  assert(
    /v-if="loadingApps" class="apps-loading"/.test(appsVue),
    '加载态容器由 loadingApps 控制（不是常驻，也不是永远不显示）'
  );
  assert(/class="al-spin"/.test(appsVue), '有转圈动画（不是干等）');
  assert(/@keyframes al-spin/.test(appsVue), '转圈动画有 keyframes（不然是静态的）');
  assert(/loadingTip/.test(appsVue), '有加载文案');
  assert(
    /第一次会慢一点/.test(appsVue),
    '文案里说清"第一次慢、之后秒开"（防用户以为是手机卡）'
  );
  assert(/class="sk-row"/.test(appsVue), '有骨架行占位');

  console.log('== 8. 搜索框与键盘的间距 ==');
  assert(/:cursor-spacing="30"/.test(appsVue), '搜索框有 cursor-spacing（比键盘高一点）');
  assert(/:adjust-position="true"/.test(appsVue), '保留 adjust-position（系统自动上推）');
  assert(
    /@focus="searchFocus = true"/.test(appsVue) && /@blur="searchFocus = false"/.test(appsVue),
    '聚焦/失焦有状态（给面板补底部空白用）'
  );
  assert(/'kb-open': searchFocus/.test(appsVue), '聚焦时给面板加 kb-open');
  assert(
    /\.add-card\.kb-open \{ padding-bottom: 220rpx; \}/.test(appsVue),
    'kb-open 真的补了底部空白（有地方可抬）'
  );

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
} catch (e) {
  // ⚠️ run-all.js 是靠抛一个哨兵 Error('__exit') 来中断同步 require、从而取到退出码的。
  //    这里必须把它**原样放回去**：吞掉的话运行器会以为护栏真崩了 ——
  //    既刷一堆"护栏自己炸了"的假错误，又被记成"运行器误报"。
  if (e && e.__exit) throw e;
  console.error('护栏自己炸了：', e && e.message);
  console.error(e && e.stack);
  process.exit(1);
}
