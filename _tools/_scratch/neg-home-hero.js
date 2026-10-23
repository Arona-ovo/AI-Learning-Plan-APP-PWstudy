// 反向测试：故意把首页分层（首屏三卡 + 下面一摞可排模块）改坏，
//   确认 check-home-hero.js 真的会红（防假绿）。
// 结束后一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 不能用 child_process 起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
//    改成同进程 require：清掉 require.cache 让它重新读文件，并接管 process.exit 取退出码。
// ⚠️ 源码是 CRLF：多行锚点里必须写 \r\n，否则匹配不到（会被判成 SKIP）。
// ⚠️ 2026-10-23 整份重写：抽屉拆了，旧的 40 条用例守的是 fixed 面板 + 上滑手势，
//    现在一条都对不上（改不到点 = SKIP，那也是失败）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, 'uniapp-PWstudy', 'pages', 'home', 'home.vue');
const CHECK = path.join(ROOT, '_tools', 'check-home-hero.js');
const orig = fs.readFileSync(FILE, 'utf8');
const NL = '\r\n';

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
  return { code, fails: buf.filter(l => l.indexOf('✗') >= 0) };
}

const cases = [
  // ---- 1. 首屏只放三张 ----
  ['HOME_IDS 里多塞一个（首屏不再只留"今天"）',
    s => s.replace("const HOME_IDS = ['focus', 'task', 'urgency']", "const HOME_IDS = ['focus', 'task', 'urgency', 'goal']")],
  ['restOrder 不排除首屏三张（上下双份渲染）',
    s => s.replace('return ids.filter(id => HOME_IDS.indexOf(id) < 0)', 'return ids')],
  ['restOrder 编辑态返回全部（两套样式并存）',
    s => s.replace('const ids = this.cardOrder || []' + NL + '      return ids.filter(id => HOME_IDS.indexOf(id) < 0)',
      'const ids = this.cardOrder || []' + NL + '      if (this.editing) return ids' + NL + '      return ids.filter(id => HOME_IDS.indexOf(id) < 0)')],

  // ---- 2. 别退回 fixed 抽屉 ----
  ['抽屉状态量回来（drawerOn）',
    s => s.replace('revealOn: false,', 'revealOn: false, drawerOn: false,')],
  ['抽屉的上滑手势回来（任何位置划 12px 就接管）',
    s => s.replace('onPageScroll(e) {', 'homeSwipeStart(e) {' + NL + '      this.swipeX0 = 0' + NL + '    },' + NL + '    onPageScroll(e) {')],
  ['首屏重新禁掉触摸（整个首页滚不动）',
    s => s.replace('.home-slide {' + NL, '.home-slide {' + NL + '  touch-action: none;' + NL)],
  // ★ 必须是"整块里干掉 min-height"，不是再加一条 min-height:0 ——
  //   同名的第二条盖不住第一条，加一条等于没改（写成那样会得到假绿）。
  ['首屏不撑满一屏（卡片静止时就露在折叠线之上）',
    s => s.replace(/\.home-hero \{[\s\S]*?\n\}/, m => m.replace(/min-height: calc\(100vh[^;]*;/g, ''))],

  // ---- 3. backdrop root：两层分工 ----
  ['底板带上 opacity（backdrop 被隔离在层内 = 糊了个寂寞）',
    s => s.replace("return { transform: 'translate3d(0,' + off + 'px,0) scale(' + sc + ')' }",
      "return { transform: 'translate3d(0,' + off + 'px,0) scale(' + sc + ')', opacity: String(p) }")],
  ['卡片层自己带位移（两层分工乱了）',
    s => s.replace("return { opacity: String(this.revealP) }", "return { opacity: String(this.revealP), transform: 'translateY(10px)' }")],
  // ★ 两条 backdrop-filter（-webkit- 与标准）都要改掉：只删一条的话，
  //   另一条里的 `backdrop-filter: var(--glass-lg` 照样命中断言 → 假绿。
  ['玻璃底板去掉毛玻璃（变成一块平涂半透明白片）',
    s => s.replace(/\.mod-sheet::before \{[\s\S]*?\n\}/, m => m.replace(/var\(--glass-lg[^)]*\)/g, 'blur(0px)'))],

  // ---- 4. 静态兜底：脚本没跑时卡片必须还在 ----
  ['revealP 初值改成 0（脚本一环没跑卡片就永久不见）',
    s => s.replace('revealP: 1,', 'revealP: 0,')],
  // ★ 要**替换**掉 opacity:1，不是在上面再插一条 opacity:0 ——
  //   两条都在块里时 /opacity:\s*1/ 依然命中，等于没改（假绿）。
  ['.mod-list 静态兜底改成透明',
    s => s.replace(/\.mod-list \{[^}]*\}/g, m => m.replace('opacity: 1;', 'opacity: 0;'))],
  ['.mod-sheet 静态兜底改成藏在下面',
    s => s.replace('  transform: none;' + NL + '}', '  transform: translateY(999px);' + NL + '}')],

  // ---- 5. 滚动进度只认 onPageScroll ----
  ['进度不量化（按帧重渲染，大页面掉帧）',
    s => s.replace('const q = Math.round(p * 20) / 20', 'const q = p')],
  // ⚠️ 只改 onPageScroll、不动 syncReveal 本体：syncReveal 会被护栏抠出来真跑，
  //    在里面塞 document 会让**护栏自己崩掉** —— 崩溃会被当成"抓到"，那是假绿。
  ['滚动位置不来自 e.scrollTop（去量节点，App 端静默失效）',
    s => s.replace('this.syncReveal(e && typeof e.scrollTop === \'number\' ? e.scrollTop : -1)',
      'this.syncReveal(document.documentElement.scrollTop)')],
  ['没有卡时也走淡入（整摞卡凭空不见）',
    s => s.replace('const on = !this.locked && this.restCount > 0', 'const on = !this.locked')],
  ['拉到位的震动不去抖（滚动途中震成一窝蜂）',
    s => s.replace('if (!this._buzzed) {', 'if (true) {')],

  // ---- 6. 结构归属（真跑标签栈）----
  // ★ 这一处是"整摞卡之后那唯一的闭合"：拿掉它，.page-slide 就一直开到浮层之后，
  //   「添加组件」那层 fixed 被卷进切 tab 的动画里（记忆约束 3）。
  //   ⚠️ 锚点里几个空行要数清楚 —— 少写一个就匹配不到，会被判成 SKIP。
  ['「添加组件」浮层塞回 .page-slide（fixed 被切 tab 动画接管）',
    s => s.replace('    </view>' + NL + NL + NL + NL + '    <!-- 「添加组件」抽屉', NL + NL + NL + '    <!-- 「添加组件」抽屉')],
  ['编辑入口挪出 .mod-list',
    s => s.replace('      <!-- 编辑入口：压在最后一卡下面', '    </view>' + NL + '      <!-- 编辑入口：压在最后一卡下面')],

  // ---- 7. 两处联动 ----
  ['进编辑态不把卡片滚到眼前（把手/收纳全在卡片上）',
    s => s.replace('if (this.editing) this.scrollToModules()', 'if (this.editing) this.drawerOn = true')],
  ['放引导前不回顶（目标卡在首屏，滑走了量不到）',
    s => s.replace(/uni\.pageScrollTo\(\{ scrollTop: 0, duration: 0 \}\)/, 'this.noop()')],
  ['卡片增减不重新对齐进度（收掉最后一张后整摞透明）',
    s => s.replace('restOrder() { this.syncReveal(-1) }', 'restOrder() {}')]
];

let bad = 0;
const base = runCheck();
console.log('基线：exit=' + base.code + '（应为 0）');
if (base.code !== 0) { console.log('基线就不是绿的，先修好再来 ✗ ' + base.fails.join(' | ')); process.exit(1); }

// ⚠️ 还原必须放在 finally 里：某个变异把**护栏自己**搞崩时（比如往被真跑的
//    syncReveal 里塞 document），进程会带着变异后的源码一起死 —— 源码就留在
//    被改坏的状态了。2026-10-23 实锤过一次，靠手工改回。
try {
  for (const [name, mut] of cases) {
    const next = mut(orig);
    if (next === orig) { console.log('SKIP 没匹配到改动点: ' + name); bad++; continue; }
    fs.writeFileSync(FILE, next);
    const r = runCheck();
    const hit = r.code !== 0;
    console.log((hit ? 'OK   被抓到: ' : 'MISS 假绿  : ') + name + (hit ? '  → ' + r.fails[0] : ''));
    if (!hit) bad++;
  }
} finally {
  fs.writeFileSync(FILE, orig);
}
const back = runCheck();
console.log(back.code === 0 ? '还原后仍是绿 ✓' : '还原后不绿 ✗ ' + back.fails.join(' | '));
if (back.code !== 0) bad++;
console.log(bad ? '反向测试有问题 ' + bad + ' 项 ✗' : '反向测试全部通过 ✓');
process.exitCode = bad ? 1 : 0;
