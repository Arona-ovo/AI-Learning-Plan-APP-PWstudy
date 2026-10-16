// 反向测试：故意把首页分层改坏，确认 check-home-hero.js 真的会红（防假绿）。
// 结束后一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 不能用 child_process 起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
//    改成同进程 require：清掉 require.cache 让它重新读文件，并接管 process.exit 取退出码。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, 'uniapp-PWstudy', 'pages', 'home', 'home.vue');
const CHECK = path.join(ROOT, '_tools', 'check-home-hero.js');
const orig = fs.readFileSync(FILE, 'utf8');

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
  // ---- 1. 主页只放三张卡 ----
  ['主页三卡容器改名（第一屏没了）',
    s => s.replace('<view class="hcards">', '<view class="hcards2">')],
  ['主页不按 homeOrder 渲染（其余组件又挤回首页）',
    s => s.replace('v-for="id in homeOrder"', 'v-for="id in cardOrder"')],
  ['HOME_IDS 里多塞一个（首页不再只留"今天"）',
    s => s.replace("const HOME_IDS = ['focus', 'task', 'urgency']",
      "const HOME_IDS = ['focus', 'task', 'urgency', 'goal']")],
  ['homeOrder 口径反了（主页变成"其余组件"）',
    s => s.replace('HOME_IDS.indexOf(id) >= 0', 'HOME_IDS.indexOf(id) < 0')],
  ['restOrder 不排除三件套（卡片重复渲染）',
    s => s.replace('HOME_IDS.indexOf(id) < 0', 'true')],
  // ⚠️ 不能直接替换 'if (this.editing) return ids' —— cardOrder 里有一句一模一样的，
  //   会被先命中，改坏的是别处（于是这条用例变成假绿）。必须带 restOrder 上下文。
  ['restOrder 编辑态不返回全部（收纳后捞不回来）',
    s => s.replace(/(restOrder\(\)\s*\{[\s\S]{0,200}?)if \(this\.editing\) return ids/,
      '$1if (false) return ids')],

  // ---- 2. 三张卡是首页适配的精简版 ----
  ['专注卡丢了 focus-card（引导第 2 步定位不到）',
    s => s.replace('class="card hcard focus-card"', 'class="card hcard"')],
  ['专注卡没有读数环（焦点没了）',
    s => s.replace('class="hc-ring"', 'class="hc-ring2"')],
  ['开始键不 stop 冒泡（点键会顺带跳页）',
    s => s.replace('class="hc-go" @tap.stop="quickStart()"', 'class="hc-go" @tap="quickStart()"')],
  ['任务卡不限三条（首页又被撑长）',
    s => s.replace('v-for="(item, ti) in homeQueue"', 'v-for="(item, ti) in queue"')],
  ['任务卡其余不给抽屉入口',
    s => s.replace('v-if="hasMoreTask"', 'v-if="false"')],
  ['紧迫度卡不画时间轴（只有干巴巴一行字）',
    s => s.replace('class="hc-axis"', 'class="hc-axis2"')],

  // ---- 3. 抽屉不上滑就完全不渲染 ----
  ['抽屉默认就展开（不上滑也看见卡片）',
    s => s.replace('drawerOn: false', 'drawerOn: true')],
  ['抽屉层不整包 v-if（收起只是藏起来，卡片照样渲染）',
    s => s.replace('<view v-if="drawerOn" class="dr-mask"', '<view class="dr-mask"')],
  ['抽屉里遍历 cardOrder（卡片重复）',
    s => s.replace('v-for="(id, i) in restOrder"', 'v-for="(id, i) in cardOrder"')],
  ['抽屉内把手不能下拉收起',
    s => s.replace('@touchmove="gripMove"', '@touchmove="noop"')],
  ['下拉阈值归零（滚列表就误关抽屉）',
    s => s.replace('y - this.gripY > 48', 'y - this.gripY > -1')],
  ['把手丢掉上滑手势（只能点）',
    s => s.replace('@touchmove="peekMove"', '@touchmove="noop"')],
  ['把手点不动（手势失灵就没退路）',
    s => s.replace('@tap="openDrawer"', '@tap="noop"')],
  ['上滑阈值归零（随便一碰就开抽屉）',
    s => s.replace('this.peekY - y > 32', 'this.peekY - y > -1')],
  ['抽屉开着时把手不隐藏（叠在面板上）',
    s => s.replace('v-if="!drawerOn && restCount"', 'v-if="restCount"')],

  // ---- 4. 再往下滑才有编辑 ----
  ['编辑入口挪到列表之前（一开抽屉就看见）',
    s => s.replace('<view class="mod-list"', '<view class="home-foot"></view><view class="mod-list"')],
  ['收工挪进抽屉（主页底部空了）',
    s => s.replace('class="home-cta"', 'class="home-cta-in-drawer"')],

  // ---- 5. 两处联动 ----
  ['进编辑态不自动拉出抽屉（看不见卡片）',
    s => s.replace('if (this.editing) this.drawerOn = true', 'if (this.editing) {}')],
  // ⚠️ 不能只替换 'if (this.editing) return' —— restOrder 里那句
  //    'if (this.editing) return ids' 同前缀会被先命中，改坏的是别处（假绿）
  ['编辑态允许收起抽屉（拖到一半没了）',
    s => s.replace(/(closeDrawer\(\) \{[\s\S]{0,200}?)if \(this\.editing\) return/,
      '$1if (false) return')],
  ['引导前不拉出抽屉（第 2/3 步被跳过）',
    s => s.replace(/(引导要挖洞[\s\S]{0,320}?)this\.drawerOn = true/,
      '$1this.drawerOn = false')],
  ['计时一起不收抽屉（fixed 层浮在硬控屏上）',
    s => s.replace('if (v && this.drawerOn) { this.editing = false; this.drawerOn = false }',
      'if (v && this.drawerOn) { this.editing = false }')],

  // ---- 6. 抽屉层在 page-slide 之外 ----
  // 把 page-slide 的闭合 </view> 拿掉，抽屉层就变成它的子节点了
  // ⚠️ 仓库是 CRLF（记忆约束 17）：这里要写 \r\n，写 \n 会静默匹配不上（假绿）
  ['抽屉层塞回 page-slide 内（fixed 被切 tab 动画接管）',
    s => s.replace('    </view>\r\n    <!-- ===== 底部抽屉', '    <!-- ===== 底部抽屉')],
  // ⚠️ 不能改名成 page-slide-x —— 'page-slide' 仍是它的子串，断言照样命中（假绿）
  ['主页三卡搬出 page-slide（不跟切 tab 动画了）',
    s => s.replace('class="page-slide home-slide"', 'class="pslide home-slide"')],

  // ---- 7. 起表仍然只能从准备页进 ----
  ['主按钮直接起表（带 auto=1）',
    s => s.replace("uni.navigateTo({ url: this.focusUrl() })",
      "uni.navigateTo({ url: this.focusUrl() + '&auto=1' })")],

  // ---- 3b. 主页整块上滑拉抽屉 ----
  // 把内容区的上滑绑定撤掉：用户又在主页上滑没反应（只靠那个小把手太难够）
  ['主页上滑手势从内容区移除（用户上滑又没反应）',
    s => s.replace(
      '@touchstart="homeSwipeStart" @touchend="homeSwipeEnd" @touchcancel="homeSwipeEnd"',
      '@touchstart="noop" @touchend="noop"')],
  // 守卫改成"永远不拦"：抽屉已开 / 编辑 / 计时中时上滑也会乱开
  ['上滑手势守卫失效（抽屉开着还往上滑就重叠）',
    s => s.replace('if (this.drawerOn || this.editing || this.locked) { this.swipeY0 = 0; return }',
      'if (false) { this.swipeY0 = 0; return }')]
];

let bad = 0;
const base = runCheck();
console.log('基线：exit=' + base.code + '（应为 0）');
if (base.code !== 0) { console.log('基线就不是绿的，先修好再来 ✗'); process.exit(1); }

for (const [name, mut] of cases) {
  const next = mut(orig);
  if (next === orig) { console.log('SKIP 没匹配到改动点: ' + name); bad++; continue; }
  fs.writeFileSync(FILE, next);
  const r = runCheck();
  const hit = r.code !== 0;
  console.log((hit ? 'OK   被抓到: ' : 'MISS 假绿  : ') + name + (hit ? '  → ' + r.fails[0] : ''));
  if (!hit) bad++;
}

fs.writeFileSync(FILE, orig);
const back = runCheck();
console.log(back.code === 0 ? '还原后仍是绿 ✓' : '还原后不绿 ✗ ' + back.fails.join(' | '));
if (back.code !== 0) bad++;
console.log(bad ? '反向测试有问题 ' + bad + ' 项 ✗' : '反向测试全部通过 ✓');
process.exitCode = bad ? 1 : 0;
