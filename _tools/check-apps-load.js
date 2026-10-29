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
  // 2026-10-29：屏幕矮的时候"面板主体"在折叠线以下，骨架行要滚才看得到 ——
  // 头那一行才是必定露出来的位置，所以转圈也得给头一份；顺带开面板就滚过去。
  assert(/v-if="loadingApps" class="al-spin al-spin-sm"/.test(appsVue),
    '面板标题行也有一颗小转圈（主体在折叠线以下时唯一看得见的信号）');
  assert(/uni\.pageScrollTo\(\{ selector: '\.add-card'/.test(appsVue),
    '打开面板后滚到可见位置（不滚的话点完「＋ 添加」屏幕毫无变化）');

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

  // == 9. 专注期间锁定白名单（2026-10-25 真机反馈）==
  // 反馈原话："专注的时候不能改 app，不然强制等于摆设" —— 专注中途把娱乐 App
  // 加成"学习 App"，强制模式（拦截非学习 App）就被从内部拆穿了。
  // 锁的口径：focus.current() 非空即锁（专注/休息/暂停都算，暂停也是"这段还没完"）；
  // 所有能改白名单的入口（添加面板、编辑器、删除、AI 推荐）一律先摇头。
  console.log('== 9. 专注期间锁白名单（不让强制模式被从内部拆穿）==');
  assert(/focusLock: false/.test(appsVue), 'data 里有 focusLock 标志');
  assert(
    /this\.focusLock = !!focusMod\.current\(\)/.test(appsVue),
    'refresh 按 focus.current() 重算（专注中即锁）'
  );
  const refBody = fnBody(appsVue, '    refresh() {');
  assert(
    refBody.length > 0 && /if \(this\.focusLock\) \{[\s\S]{0,200}this\.adding = false/.test(refBody),
    '锁着时编辑面板一律收起（不能留着半开的添加口）'
  );
  assert(
    /v-if="focusLock" class="card pc-lock"/.test(appsVue),
    '模板里有锁定横幅（用户看得见为什么点不动）'
  );
  // 每个能改白名单的入口都要先摇头。少一个 = 那条路还能改。
  // ⚠️ 必须用「签名 + 紧邻 140 字符内有 guard」：fnBody 对 methods 里的函数
  //    找不到边界（下一个 `\nfunction ` 在文件尾），会切到文件末尾 ——
  //    那样任何后面函数的 guard 都能让前面这条变绿（假绿）。
  // ⚠️ 签名要带参数列表和 `{`：只写 `startAdd(` 会先命中模板里的 @tap="startAdd(c)"。
  const guardAt = (sig) => {
    const i = appsVue.indexOf(sig);
    if (i < 0) return false;
    return /if \(this\.focusLock\) \{ this\.lockToast\(\); return \}/
      .test(appsVue.slice(i, i + 140));
  };
  [
    ['tapAddToggle() {', '添加面板开合'],
    ['startAdd(c) {', '点候选行添加'],
    ['startAddManual() {', '手动输包名添加'],
    ['startEditDock(a) {', '编辑已添加的 App'],
    ['async aiRecommend() {', 'AI 推荐'],
    ['askRemove(a) {', '删除已添加的 App']
  ].forEach(([sig, label]) => {
    assert(guardAt(sig), '入口「' + label + '」专注期间摇头（lockToast 后 return）');
  });
  assert(
    /lockToast\(\) \{[\s\S]{0,200}专注进行中，学完这段再来改/.test(appsVue),
    '锁定提示说人话（为什么点不动 + 什么时候能改）'
  );
  // 从专注页切过来 onShow 会再跑一次 refresh → 专注一结束回来立刻解锁
  assert(
    /onShow\(\)[\s\S]{0,400}this\.refresh\(\)/.test(appsVue),
    'onShow 走 refresh（专注结束后回到本页立刻解锁）'
  );

  // == 10. AI 按目标推荐学习 App（2026-10-25 真机反馈）==
  // 反馈原话："ai 目标规划完，最好让用户一起把学习 app 设置了，并且最好 ai 能
  // 根据目标智能推荐一栏展示手机内的学习 app" —— 几百个应用里自己翻太费劲。
  console.log('== 10. AI 按目标推荐学习 App ==');
  const aiGuess = read('services/ai-app-guess.js');
  assert(
    /export async function recommendStudyApps\(apps, goalsText\)/.test(aiGuess),
    '服务层有 recommendStudyApps（名单 + 目标上下文）'
  );
  assert(/\.slice\(0, 120\)/.test(aiGuess), '名单封顶 120（太长又贵又容易让模型走神）');
  assert(/\.slice\(0, 8\)/.test(aiGuess), '推荐封顶 8 个（一屏勾得完）');
  assert(/aiRec: \{ loading: false, err: '', items: \[\] \}/.test(appsVue), 'data 里有推荐区状态');
  assert(
    /v-if="aiEnabled && !aiRec\.items\.length && !aiRec\.loading" class="ai-rec-entry"/.test(appsVue),
    '模板有推荐入口（AI 关着时不显示，不挡手动添加的路）'
  );
  assert(
    /ai-rec-wait/.test(appsVue) && /AI 正在按你的目标挑学习 App/.test(appsVue),
    '有加载态文案（推荐要等十几秒，不能像卡死）'
  );
  assert(
    /aiRec\.err \? \$t\('AI 没推荐出来'\)/.test(appsVue),
    '失败时给"再试一次"（AI 挂不掉手动添加）'
  );
  assert(
    /aiGuess\.recommendStudyApps\(cands, this\.goalsContext\(\)\)/.test(appsVue),
    '推荐走 recommendStudyApps（候选名单 + 目标上下文）'
  );
  // ⚠️ 这条是命门：模型可能幻觉出不存在的包名（prompt 里写了"只准从名单里挑"
  //    但不强制），不过滤就会把幽灵 App 加进白名单 —— 之后强制模式按包名拦截
  //    永远命不中它，用户还以为设好了。
  assert(
    /\.filter\(p => byPkg\[p\.pkg\]\)/.test(appsVue),
    '⚠️ 推荐结果按已安装名单过滤（幻觉包名不进白名单）'
  );
  assert(
    /if \(e && e\.notConfigured\) this\.aiRec\.err = this\.\$t\('AI 服务未启用'\)/.test(appsVue),
    '没配 AI 时说明白是"服务未启用"（不然用户以为坏了）'
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
