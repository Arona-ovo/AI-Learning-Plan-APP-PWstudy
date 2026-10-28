// 反向测试：故意把源码改坏，确认 check-home-focus.js 真的会红（防假绿）。
// 结束后一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 不能用 child_process 起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
//    改成同进程 require：清掉 require.cache 让它重新读文件，并接管 process.exit 取退出码。
// ⚠️ 源码是 CRLF：锚点统一写 \n，由 swap 按文件实际行尾转换（手写 \r\n 太容易漏一个）。
// ⚠️ mutator 收到的是**整份文件字典**：这次改动跨 home / focus 两个页面，单文件变异不够用。
// ⚠️ 还原必须放在 finally 里（2026-10-23 在 neg-home-hero 上实锤过：某个变异把护栏自己搞崩，
//    进程带着被改坏的源码一起死就麻烦了）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FILES = {
  home: path.join(ROOT, 'uniapp-PWstudy', 'pages', 'home', 'home.vue'),
  focus: path.join(ROOT, 'uniapp-PWstudy', 'pkgPlan', 'pages', 'focus', 'focus.vue'),
  check: path.join(ROOT, '_tools', 'check-home-focus.js')
};
const CHECK = FILES.check;
const orig = {};
for (const k in FILES) orig[k] = fs.readFileSync(FILES[k], 'utf8');

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  let code = 0;
  const buf = [];
  process.exit = (c) => { code = (c == null ? 0 : c); const e = new Error('__exit'); e.__exit = true; throw e; };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  try { require(CHECK); } catch (e) { if (!e || !e.__exit) throw e; }
  finally { console.log = realLog; console.error = realErr; process.exit = realExit; }
  return { code, fails: buf.filter((l) => l.indexOf('✗') >= 0) };
}

/** 全局替换（split/join）—— ⚠️ 不能只换第一个：home.vue 里 <scroll-view class="fs-body">
 *  有两处（专注设置面板 + 管理面板），只换第一处会撞上"改的不是被检查的那一段"→ 假绿。 */
const swap = (cur, key, from, to) => {
  const nl = cur[key].indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  const F = from.split('\n').join(nl);
  const T = to.split('\n').join(nl);
  const before = cur[key];
  const next = before.split(F).join(T);
  if (next === before) throw new Error('锚点没命中 [' + key + ']: ' + from);
  cur[key] = next;
};
/** 在某个 CSS 块里做替换（同名的 class 在别处还有，必须限定范围） */
const inBlock = (cur, key, head, from, to) => {
  const i = cur[key].indexOf(head);
  if (i < 0) throw new Error('块没找到 [' + key + ']: ' + head);
  const j = cur[key].indexOf('\n}', i);
  if (j < 0) throw new Error('块没收尾: ' + head);
  const seg = cur[key].slice(i, j);
  if (seg.indexOf(from) < 0) throw new Error('块内没找到: ' + from);
  cur[key] = cur[key].slice(0, i) + seg.split(from).join(to) + cur[key].slice(j);
};

const cases = [
  // ================= 1. 原有的「专注设置」卡片 =================
  ['时长不写 pomoCfg（首页/专注页两份配置）',
    (c) => swap(c, 'home', 'focus.setCfg({ focus: m })', "this.saveFocus('focusMin', m)")],
  ['休息时长不写 pomoCfg',
    (c) => swap(c, 'home', 'focus.setCfg({ rest: m })', "this.saveFocus('restMin', m)")],
  ['刷新时不从 pomoCfg 读回',
    (c) => swap(c, 'home', 'this.focusMin = pc.focus || 25', 'this.focusMin = 25')],
  // ⚠️ 必须全部替换：两处 fs-body 都要换，只换一处 = 没改到被检查的那段（假绿）
  ['卡片不可滚（scroll-view 换回 view）',
    (c) => swap(c, 'home', '<scroll-view class="fs-body" scroll-y>', '<view class="fs-body">')],
  ['卡片不限高（十行撑满整屏）', (c) => swap(c, 'home', 'max-height: 62vh;', '')],
  ['白噪音关写 true 而不是空串',
    (c) => swap(c, 'home', "next ? (this.noiseKind || 'rain') : ''", "next ? (this.noiseKind || 'rain') : true")],
  ['音色排常显（关着也占一行）',
    (c) => swap(c, 'home', 'v-if="noiseOn" class="fc-opts fc-opts-pad"', 'class="fc-opts fc-opts-pad"')],
  ['改完严格模式不 sync（开关与真实状态分叉）',
    (c) => inBlock(c, 'home', 'tapStrict() {', 'strict.sync()', '')],
  ['出口不收卡片（跳回来还浮在脸上）',
    (c) => inBlock(c, 'home', 'goFocusSet() {', 'this.focusSheet = false', '')],
  ['focusSetOn 漏掉白噪音',
    (c) => swap(c, 'home', 'this.strictOn || this.noiseOn', 'this.strictOn')],
  ['音色名不走 $t（字面量数组）', (c) => swap(c, 'home', "this.$t('白噪')", "'白噪'")],
  ['少一个分组（十行不分组成一堵墙）', (c) => swap(c, 'home', "$t('管住自己')", "$t('自我管理')")],
  ['最后一条分隔线没收掉',
    (c) => swap(c, 'home', '.fc-row.is-last { border-bottom: none; }', '.fc-row.is-last { }')],
  ['顶栏高亮不接 focusSetOn',
    (c) => swap(c, 'home', ':focus-on="focusSetOn"', ':focus-on="forcedOn"')],

  // ===== 2. App 端共享元素转场的时序（2026-10-26 真机反馈："安卓没动画、电脑端正常"）=====
  ['这一跳不关 App 系统窗口动画（两层动画叠着跑 = 抖一下）',
    (c) => swap(c, 'home', "animationType: 'none'", "animationType: 'slide-in-right'")],
  ['intro 收尾退回"直接摘"（同帧加减 class 不跑 transition）',
    (c) => swap(c, 'focus', 'try { this.armIntro() } catch (e) { this.ringIntro = false }',
      'this.ringIntro = false')],
  // ★ 下面的锚点按 10-27 的"自播放"方案重写：以前 rAF / selectQuery.exec 那两条
  //   信号被实锤为"渲染先行、上屏在后"（提前摘 intro = 收缩动画被吞），已删除；
  //   现在收口靠 @animationend + 600ms 兜底，动画本身由 CSS keyframes 自己跑。
  ['收缩动画改回"等人去摘"（fr-ring-drop 的自播放 animation 删了）',
    (c) => swap(c, 'focus', 'animation: fr-ring-drop 260ms cubic-bezier(0.22, 0.61, 0.36, 1) both;', '')],
  ['armIntro 里又拿 rAF 当上屏信号（提前摘 intro → 收缩动画被吞，10-27 实锤）',
    (c) => swap(c, 'focus', 'this._introProbeT = setTimeout(this._introDone, 600)',
      'try { requestAnimationFrame(() => requestAnimationFrame(this._introDone && this._introDone())) } catch (e) {}\n      this._introProbeT = setTimeout(this._introDone, 600)')],
  ['intro 态不关毛玻璃（backdrop-filter 全屏逐帧重模糊 → 收缩掉帧）',
    (c) => swap(c, 'focus', '  -webkit-backdrop-filter: none;\n  backdrop-filter: none;', '')],
  ['去掉 setTimeout 兜底（老内核 animationend 不来 → 圆永久盖着屏幕）',
    (c) => swap(c, 'focus', 'this._introProbeT = setTimeout(this._introDone, 600)', 'this._introProbeT = 0')],
  ['.ring 不绑 @animationend（动画播完没处收口，只剩兜底定时器）',
    (c) => swap(c, 'focus', ' @animationend="onIntroEnd"', '')],
  ['重体检搬回 onShow（首帧被原生调用拖住 → 定格一秒再弹出）',
    (c) => swap(c, 'focus',
      'clearTimeout(this._deferT)\n    this._deferT = setTimeout(() => {\n      this._deferT = null\n      try { this.deferredChecks() } catch (e) {}\n    }, 320)',
      'this.usageOk = apptime.hasUsagePermission()\n    this.refreshLearnApps()')],
  ['首页大圆不提合成层（放大到全屏逐帧重绘 → 低端机掉帧）',
    (c) => swap(c, 'home', '  will-change: transform;', '')],
  ['专注页圆盘不提合成层（收缩/pulse 每帧重绘）',
    (c) => swap(c, 'focus', '  will-change: transform;', '')],
  ['onHide 不收 probe（页面都切走了还留着去摘 intro）',
    (c) => swap(c, 'focus',
      'clearTimeout(this._introProbeT); this._introProbeT = null; this._introDone = null\n    clearTimeout(this._deferT); this._deferT = null\n    // 注意：严格模式',
      '// 注意：严格模式')],
  ['intro 的放大起点不写行内值（只剩 CSS 变量，内核不稳时倍数对不上首页）',
    (c) => swap(c, 'focus', "if (this.ringIntro) st.transform = 'scale(' + this.coverScale + ')'",
      "if (this.ringIntro) st.opacity = '1'")],
  ['conic-gradient 没有纯色兜底（老安卓认不出会整条丢掉，圆环当场消失）',
    (c) => swap(c, 'focus', "backgroundColor: 'rgba(23,32,26,0.08)',", '')],
  ['ring 基态退回隐式 none（部分安卓 WebView 不补中间帧 → 直接跳到终点）',
    (c) => swap(c, 'focus', '  transform: scale(1);\n  /* ★ 提合成层', '  /* ★ 提合成层')],

  // ===== 3. 两个圆的读数字体同源 =====
  ['专注页 .time 又加回 Georgia（安卓没有 → 退 Noto Serif，两个圆当场分家）',
    (c) => inBlock(c, 'focus', '.time {', 'font-size: 96rpx;', 'font-size: 96rpx; font-family: Georgia, serif;')],
  ['首页 .hc-ring-num 加 Georgia（同样会在安卓上分家）',
    (c) => inBlock(c, 'home', '.tp-block.focus-card .hc-ring-num {', 'font-size: 72rpx;',
      'font-size: 72rpx; font-family: Georgia, serif;')],
  ['专注页 .time 字重退回 500（衬线换无衬线后视觉轻一档，两个圆不一样重）',
    (c) => inBlock(c, 'focus', '.time {', 'font-weight: 600', 'font-weight: 500')],
  ['首页大圆丢掉字间距（同一串 25:00，两边得一样）',
    (c) => inBlock(c, 'home', '.tp-block.focus-card .hc-ring-num {', 'letter-spacing: 2rpx;', '')],
  ['硬控遮罩的大计时加回 Georgia（安卓会退成 Noto Serif，同一个读数两种字）',
    (c) => inBlock(c, 'home', '.lock-time {', 'font-size: 102rpx;',
      'font-size: 102rpx; font-family: Georgia, serif;')],
  ['结算卡的计时读数加回 Georgia',
    (c) => inBlock(c, 'home', '.fc-time {', 'font-size: 34rpx;',
      'font-size: 34rpx; font-family: Georgia, serif;')],

  // ===== 4. 元测试：护栏自身不能静默失效 =====
  ['元测试 —— 护栏取 armIntro 的正则写错（方法改名后整节静默失效）',
    (c) => swap(c, 'check', '/    armIntro\\(\\)\\s*\\{', '/    armIntroz\\(\\)\\s*\\{')]
];

let bad = 0;
const base = runCheck();
console.log('基线：exit=' + base.code + '（应为 0）');
if (base.code !== 0) { console.log('基线就不是绿的，先修好再来 ✗ ' + base.fails.join(' | ')); process.exit(1); }

try {
  for (const [name, mut] of cases) {
    const cur = Object.assign({}, orig);
    let r;
    try {
      mut(cur);
    } catch (e) {
      console.log('SKIP 没命中改动点: ' + name + ' —— ' + e.message);
      bad++;
      continue;
    }
    for (const k in FILES) fs.writeFileSync(FILES[k], cur[k]);
    try {
      r = runCheck();
    } catch (e) {
      console.log('CRASH 护栏自己崩了: ' + name + ' —— ' + e.message);
      bad++;
      continue;
    }
    const hit = r.code !== 0;
    console.log((hit ? 'OK   被抓到: ' : 'MISS 假绿  : ') + name + (hit ? '  → ' + r.fails[0] : ''));
    if (!hit) bad++;
  }
} finally {
  for (const k in FILES) fs.writeFileSync(FILES[k], orig[k]);
}
const back = runCheck();
console.log(back.code === 0 ? '还原后仍是绿 ✓' : '还原后不绿 ✗ ' + back.fails.join(' | '));
if (back.code !== 0) bad++;
console.log(bad ? '反向测试有问题 ' + bad + ' 项 ✗' : '反向测试全部通过 ✓');
process.exitCode = bad ? 1 : 0;
