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
  // ★ 初值是 0（= 顶部）。改成 1 会让"revealOn 先亮、进度还没算出来"那一帧
  //   把首屏 fade 成 0 —— 首页一片空白，只有底下一张卡露个边（2026-10-24 实锤）。
  ['revealP 初值改成 1（进度没算出来时首屏被 fade 成空白）',
    s => s.replace('revealP: 0,', 'revealP: 1,')],
  // ★ _scrollTop 一次都没被喂过时是 undefined：参与算术得到 NaN，`<0 / >1` 两道夹逼
  //   都拦不住 → 进度停在初值 → 首屏淡出、整页看着像空的。
  ['去掉 _scrollTop 未初始化兜底（算出 NaN，进度卡死）',
    s => s.replace("if (typeof this._scrollTop !== 'number' || !isFinite(this._scrollTop)) this._scrollTop = 0", '')],
  ['去掉进度的 isFinite 兜底（NaN 骗过夹逼）',
    s => s.replace('p = !isFinite(p) ? 0 : p < 0 ? 0 : p > 1 ? 1 : p', 'p = p < 0 ? 0 : p > 1 ? 1 : p')],
  ['onShow 不对齐进度（回首页第一帧像空的）',
    s => s.replace('    try { this.syncReveal(this._scrollTop) } catch (e) {}' + NL, '')],
  ['淡入距离退回固定 520rpx（大屏上首屏已透明、卡片还没铺满 → 中间空一片）',
    s => s.replace('this._spanPx = Math.max(1, Math.min(Math.max(this.upx(REVEAL_SPAN_RPX), byScreen), capped))',
      'this._spanPx = this.upx(REVEAL_SPAN_RPX)')],
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
    s => s.replace('    restOrder() {' + NL + '      this.syncReveal(-1)', '    restOrder() {' + NL + '      this.noop()')],

  // ---- 7b. 可滚行程 ÷ 淡入距离（2026-10-26：两张卡滑不到进度 1）----
  // 分母不跟着实测行程收敛 = 回到"两张卡半透明"（真跑对照 I2 会掉回 0.6）
  ['分母不按实测行程收敛（两张卡的行程喂不满分母 → 卡片停在半透明）',
    s => s.replace('this._spanPx = Math.max(1, Math.min(Math.max(this.upx(REVEAL_SPAN_RPX), byScreen), capped))',
      'this._spanPx = Math.max(this.upx(REVEAL_SPAN_RPX), byScreen)')],
  // 能滚多远就够做题 —— measureScrollable 不存在时整组断言红的
  ['去掉 measureScrollable（不再知道这一屏能滚多远）',
    s => s.replace('    measureScrollable(tryN, force) {' + NL + '      const n = tryN || 0' + NL + '      if (n > 4) return',
      '    measureScrollableOld_() {' + NL + '      const n = 0' + NL + '      return')],
  ['量错对象（改去别的地方，量出来的不是文档总高）',
    s => s.replace("q.select('.container').boundingClientRect()", "q.select('.today-panel').boundingClientRect()")],
  ['可滚行程算错（忘了减视口高）',
    s => s.replace('const max = Math.round(box.height - win)', 'const max = Math.round(box.height)')],
  ['行程不过合理性夹逼（量串了也照用，会把页面算没）',
    s => s.replace('if (max < 0 || max > 20000) return retry()', 'if (false) return retry()')],
  ['测量没有退拍重试（首帧没挂载就永远量不到）',
    s => s.replace('      self.__measAt = now' + NL + '      const retry = () => setTimeout(() => {' + NL + '        try { self.measureScrollable(n + 1) } catch (e) {}' + NL + '      }, 180)',
      '      self.__measAt = now' + NL + '      const retry = () => {}')],
  // ⚠️ 这条最关键：syncReveal 会被护栏抠出来**真跑**，在里面塞 document 会让护栏崩。
  //    崩溃 ≠ 抓到（那是假绿），所以这里改成往**调用链上游**（onPageScroll 之外、
  //    并且不会被执行到的地方）…… 不行的话就退一步：改 measureScrollable 里的选择器
  //    为一个"看起来像 DOM API"的用法，验证"唯一允许碰尺寸的地方"这条断言真的在盯。
  ['syncReveal 里偷偷量节点（App 端那条路会静默失效）',
    s => s.replace('        const avail = this._scrollablePx || 0' + NL + '        if (avail > 0 && this._scrollTop >= avail - 6) p = 1',
      '        const avail = typeof document !== \'undefined\' ? document.body.scrollHeight : (this._scrollablePx || 0)' + NL + '        if (avail > 0 && this._scrollTop >= avail - 6) p = 1')],
  ['行程变了不重新对齐进度（要等用户再滑一下才纠正）',
    s => s.replace('              try { self.remeasure() } catch (e) {}' + NL + '              try { self.syncReveal(-1) } catch (e) {}',
      '              try { self.remeasure() } catch (e) {}')],
  ['卡片张数变了不重测行程（四张减到两张，分母还停在旧值）',
    s => s.replace('      this.__scrollableT = setTimeout(() => {' + NL + '        try { this.measureScrollable() } catch (e) {}' + NL + '      }, 260)',
      '      this.__scrollableT = setTimeout(() => {' + NL + '        try { this.noop() } catch (e) {}' + NL + '      }, 260)')],
  ['onShow 不量行程（进页面时分母永远是"没量到"）',
    s => s.replace('    try { this.measureScrollable() } catch (e) {}' + NL, '')],

  // ---- 8. 「今天」面板：一张整板 + 大圆即开始键（2026-10-25 两轮重构）----
  ['面板穿回 .card 皮肤（边框/投影/毛玻璃 = 卡片感本身，用户明确否过）',
    s => s.replace('class="today-panel"', 'class="card today-panel"')],
  ['紧迫度改回整块可点（读数不是交互目标，整块 @tap 会误触）',
    s => s.replace('<view class="tp-block urg-card">', '<view class="tp-block urg-card" @tap="explainUrgency(u)">')],
  ['「?」解释入口去掉 @tap（affordance 还在，点了却没反应）',
    s => s.replace('class="hc-q" @tap.stop="explainUrgency(u)"', 'class="hc-q"')],
  ['面板内边距退回上下 36rpx（整板又高出一截）',
    s => s.replace('padding: 26rpx 36rpx 30rpx;', 'padding: 36rpx 36rpx;')],
  ['板内一区自己套 .card（退回三卡并列的割裂感）',
    s => s.replace('class="tp-block task-card"', 'class="card tp-block task-card"')],
  // 紧迫度类名改成 task-card：板内出现两个 task、零个 urg → 顺序断言立刻红
  ['板内顺序打乱（引导按 focus → task 的次序定位，错了会指错地方）',
    s => s.replace('class="tp-block urg-card"', 'class="tp-block task-card"')],
  // ---- 8b. 大圆即开始键 + 紧迫度纯进度条 + 只留关键文字（第二轮）----
  ['大圆不再直接开始（改回"点圆进页面"，按钮被融掉的意义就没了）',
    s => s.replace('<view class="tp-block focus-card" @tap="quickStart()">',
      '<view class="tp-block focus-card" @tap="goFocus()">')],
  ['圆框缩回小环（用户明确要求"跟专注页里那个圆一样大"）',
    s => s.replace('width: 480rpx;', 'width: 168rpx;')],
  ['紧迫度加回标题 / 档位胶囊（说好简化成纯进度条）',
    s => s.replace('<view class="tp-block urg-card">',
      '<view class="tp-block urg-card"><text class="hc-lv">x</text>')],
  ['收工按钮下方加回解释小字（理念：只留关键文字）',
    s => s.replace("'今日收工' }}</button>", "'今日收工' }}</button><text class=\"cta-tip\">x</text>")]
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
