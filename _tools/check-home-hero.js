// _tools/check-home-hero.js - 首页分层（主页三卡 + 底部抽屉）静态校验（只读）
//
// 回归点（对应需求：主页只显示今天要用的东西 —— 开始专注 / 任务 / 紧迫度，
//   这三张要做首页适配、突出焦点、简洁；其余卡片做成抽屉，
//   不上滑就**完全不出现**，滑到抽屉底部才有编辑）：
//  1) 主页常驻 = 三张精简卡（homeOrder / HOME_IDS），每张一个焦点
//  2) 抽屉：drawerOn 默认 false，抽屉层常驻但用 .on class + transform 切换（收起时不挂载 → 不掉帧）
//  3) 抽屉把手（grip）跟手下拉收起；主页整屏上滑跟手拉起，过半才提交
//  4) 编辑入口压在抽屉滚动区最底部（要再往下滑才够得着）
//  5) 两处联动：进编辑态自动拉出抽屉、引导前自动拉出；计时一起就收起
//  6) 抽屉层必须在 .page-slide 之外（记忆约束 3：fixed 参照不能被动画 transform 接管）
//  7) 起表仍然只有准备页那颗确认键（首页不带任何 auto 参数）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const home = R('pages/home/home.vue');
const en = R('utils/i18n-en.js');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
// 模板先后关系：本需求里"顺序"本身就是验收项（把手 → 列表 → 收工 → 编辑）
const at = (s) => home.indexOf(s);
const block = (re) => { const m = home.match(re); return m ? m[0] : ''; };

console.log('== 1. 主页只放今天要用的三张卡 ==');
assert(/<view class="hcards" :style="homeShift">/.test(home), '有主页三卡容器 .hcards（并绑定整列上移）');
assert(/v-for="id in homeOrder"/.test(home), '主页按 homeOrder 渲染');
assert(/const HOME_IDS = \['focus', 'task', 'urgency'\]/.test(home),
  'HOME_IDS = 专注 / 今日任务 / 紧迫度（其余一律进抽屉）');
const bHome = block(/homeOrder\(\)\s*\{[\s\S]*?\n    \}/);
assert(/HOME_IDS\.indexOf\(id\) >= 0/.test(bHome), 'homeOrder 只留三件套');
const bRest = block(/restOrder\(\)\s*\{[\s\S]*?\n    \}/);
assert(/HOME_IDS\.indexOf\(id\) < 0/.test(bRest), 'restOrder 是"其余组件"');
assert(/if \(this\.editing\) return ids/.test(bRest), '编辑态抽屉列出全部卡片（收纳后捞得回来）');

console.log('== 2. 三张卡都是首页适配的精简版（每张一个焦点）==');
assert(/class="card hcard focus-card"/.test(home), '① 专注卡（focus-card 保留，引导靠它定位）');
assert(/class="hc-ring"/.test(home) && /hc-ring-num/.test(home), '① 焦点：今日累计读数（环）');
assert(/class="hc-go"[^>]*@tap\.stop="quickStart\(\)"/.test(home), '① 焦点：唯一落点是那颗开始键');
assert(/class="card hcard task-card"/.test(home), '② 任务卡（task-card 保留，引导靠它定位）');
assert(/v-for="\(item, ti\) in homeQueue"/.test(home), '② 焦点：只列最该做的三条');
assert(/v-if="hasMoreTask"[\s\S]{0,120}openDrawer/.test(home), '② 其余的从抽屉里看');
assert(/class="card hcard urg-card"/.test(home), '③ 紧迫度卡');
assert(/class="hc-axis"/.test(home) && /hc-axis-now/.test(home), '③ 焦点：一条 24 小时时间轴 + 现在位置');

console.log('== 3. 抽屉：常驻但收起时不挂载卡片（真抽屉 + 不掉帧）==');
assert(/drawerOn: false/.test(home), 'data 里抽屉默认收起');
// 关键：抽屉 DOM 常驻（不再整包 v-if 挂载），只动 opacity/transform（GPU 合成），
// 不会因为挂载整摞卡片掉帧。
assert(/class="dr-mask"[^>]*:class="\{ on: drawerOn \}"/.test(home), '抽屉层常驻 + .on class 切换开合');
// "抽屉没有实体"：遮罩全透明，不压暗整屏（上滑时主页和卡片是同一列，不是两层）
const drMaskCss = block(/\.dr-mask \{[\s\S]*?\n\}/);
assert(/background:\s*transparent/.test(drMaskCss) && !/rgba\(/.test(drMaskCss),
  '遮罩全透明：上滑不压暗整屏（没有实体抽屉）');
// 面板不再整体平移：没有从屏下滑上来的实体 sheet，卡片各自按进度浮现
const drPanelCss = block(/\.dr-panel \{[\s\S]*?\n\}/);
assert(drPanelCss !== '' && !/translateY\(100%\)/.test(drPanelCss),
  '面板不再整体滑入（卡片逐张浮现，替代实体 sheet）');
// ★ 层级感：整块玻璃底板（圆角 + 毛玻璃 + 上沿阴影）。
//   完全透明时抽屉卡片和主页卡片成了"同一层里接着排"，读不出谁盖着谁。
assert(/border-radius:\s*40rpx 40rpx 0 0/.test(drPanelCss), '玻璃底板有上方圆角');
assert(/backdrop-filter:\s*var\(--glass-lg/.test(drPanelCss), '玻璃底板有毛玻璃（不是实色白板）');
assert(/box-shadow:\s*0 -16rpx 44rpx/.test(drPanelCss), '玻璃底板有上沿阴影（浮在上面的层次）');
assert(/background:\s*rgba\(var\(--surface-rgb/.test(drPanelCss), '玻璃底板半透明（透得出底下的主页）');
// 面板自身的视差：闭合时下沉、展开归零，和主页位移不同速
const bPanelStyle = block(/panelStyle\(\)\s*\{[\s\S]*?\n    \}/);
assert(/PANEL_PARALLAX_PCT/.test(bPanelStyle) && /translateY/.test(bPanelStyle),
  '面板自带小幅视差（与主页不同速 → 两层错开）');
assert(/const PANEL_PARALLAX_PCT = 10/.test(home), '面板视差幅度常量存在');
assert(/class="dr-panel"[^>]*ref="drPanel"[^>]*:style="panelStyle"/.test(home), '面板内联 --open 进度跟手');
// 逐张错拍：wrapStyle 里按 openProg 算每张卡的淡入/升起（scroll-linked stagger）
const bWrap = block(/wrapStyle\(i\)\s*\{[\s\S]*?\n    \}/);
assert(/this\.openProg/.test(bWrap) && /opacity/.test(bWrap) && /translateY/.test(bWrap),
  '抽屉卡片随展开进度逐张淡入+升起（错拍 stagger）');
assert(/v-for="\(id, i\) in restOrder"/.test(home), '抽屉里遍历其余组件');
assert(/class="dr-grip"/.test(home) && /@touchmove="gripMove"/.test(home), '抽屉内把手可下拉收起');
// 关闭改成"跟手拖动 + 过半才提交"，不再是固定 48px 阈值
assert(/gripMove\(e\)/.test(home) && /this\.panelDrag = 0/.test(home), '把手下拉进入拖动（panelDrag=0 起手）');
assert(/gripEnd\(\)/.test(home) && /this\.closeDrawer\(\)/.test(home), '拉过半 → 收起，否则弹回');
assert(/if \(dy <= 6\) return/.test(home), '把手下拉要超过 6px 才接管（滚列表不会误关）');
assert(/if \(dy <= 12 \|\| dy <= dx\) return/.test(home), '上滑要"明显竖向"才接管（不和顶部滚动打架）');
// 开/关两条手势的提交方向各自独立断言 —— 之前笼统一条，方向写反照样是绿的
const bOpenEnd = block(/homeSwipeEnd\(e\)\s*\{[\s\S]*?\n    \}/);
assert(/const commit = this\.panelDrag < 50/.test(bOpenEnd), '上滑：拉过一半才提交开（轻拖弹回）');
// ★ 上滑一甩也能开（跟收起的一甩对称，参考 AWword 的顺滑感）：只认"拖过一半"太死板
assert(/const OPEN_FLICK_V = 0\.45/.test(home), '上滑一甩的速度阈值常量存在');
assert(/this\.dragVy <= -OPEN_FLICK_V/.test(bOpenEnd),
  '快速上滑一甩也算开（⚠️ 上滑速度为负，判定必须是 <= 负值）');
const bOpenStart = block(/homeSwipeStart\(e\)\s*\{[\s\S]*?\n    \}/);
assert(/this\.dragVy = 0/.test(bOpenStart) && /this\.dragT = /.test(bOpenStart),
  '上滑起手清速度残留（旧手势的 lastMoveY/dragVy 会污染第一帧）');
assert(/this\.trackVy\(t\.clientY\)/.test(block(/homeSwipeMove\(e\)\s*\{[\s\S]*?\n    \}/)),
  '上滑拖动要记速度（否则一甩判定永远为 0）');
const bGripEnd = block(/gripEnd\(\)\s*\{[\s\S]*?\n    \}/);
assert(/const commit = this\.panelDrag > CLOSE_COMMIT_PCT/.test(bGripEnd),
  '把手下拉：拖过阈值才收起（方向写成 < 会"轻碰就收、使劲拉反而弹回"）');
// ★ 收起阈值必须比"一半"小得多：面板 76vh，一半就是 38vh，
//   真机上要从上往下滑老长一段才收得回去（2026-10-16 反馈）
assert(/const CLOSE_COMMIT_PCT = 20/.test(home), '收起阈值 20%（不是 50% —— 38vh 太远）');
// 快速一甩也收：不想拖够距离时甩一下就走
assert(/this\.dragVy >= CLOSE_FLICK_V/.test(bGripEnd), '收起支持"快速一甩"（不必拖够距离）');
assert(/const CLOSE_FLICK_V = 0\.45/.test(home), '一甩的速度阈值常量存在');
assert(/trackVy\(y\)/.test(home) && /this\.dragVy = /.test(home), '有手指速度记录（喂给一甩判定）');
const bGripMove = block(/gripMove\(e\)\s*\{[\s\S]*?\n    \}/);
assert(/this\.trackVy\(t\.clientY\)/.test(bGripMove), '把手拖动要记速度（否则一甩判定永远为 0）');
// 内容区也能收：滚到顶之后再往下拉就接管，不必非够顶部那条把手
assert(/@touchmove="bodyMove"/.test(home) && /@touchend="bodyEnd"/.test(home),
  '抽屉内容区也接管收起手势');
const bBodyMove = block(/bodyMove\(e\)\s*\{[\s\S]*?\n    \}/);
assert(/this\.bodyTop > 2/.test(bBodyMove) && /return/.test(bBodyMove),
  '列表没滚到顶时不抢手势（让它自己滚）');
assert(/@scroll="bodyScroll"/.test(home) && /this\.bodyTop = /.test(home), '内容区滚动位置有记录');
assert(/bodyEnd\(\)/.test(home) && /this\.gripEnd\(\)/.test(home),
  '内容区接管后走同一套收起判定（不另起一套）');
assert(/if \(this\.panelDrag === null\) \{ this\.dragging = false; this\.gripY = 0; return \}/.test(home),
  '把手轻点（没拖出 6px）也要复位 dragging，否则过渡被永久关掉');
// ★ 滑出要有震动（2026-10-16 反馈）：只在"打开提交"的松手瞬间震，收起不震。
//   全套行为测试在 check-haptic.js；这里守接线位置。
const bBuzz = block(/buzzDrawer\(\)\s*\{[\s\S]*?\n    \}/);
assert(bBuzz !== '' && /haptic\.tick\('drawer'\)/.test(bBuzz) && /catch/.test(bBuzz),
  'buzzDrawer 震 drawer 档且包 catch（震不动也要把抽屉拉开）');
assert(/if \(commit\) this\.buzzDrawer\(\)/.test(bOpenEnd), '打开提交的松手瞬间才震（拖动中不震）');
assert(/this\.drawerOn = true\s*\n\s*this\.buzzDrawer\(\)/.test(bOpenEnd), '兜底一甩开抽屉同样震');
assert(!/class="dr-peek"/.test(home), '主页底部常驻把手（小横条）已移除：打开靠整屏上滑');

console.log('== 3b. 主页整块上滑跟手拉抽屉（不只小把手）==');
assert(/@touchstart="homeSwipeStart"/.test(home) && /@touchmove="homeSwipeMove"/.test(home) && /@touchend="homeSwipeEnd"/.test(home),
  '主页内容区绑了上滑手势（跟手升起）');
// ★ 承载上滑手势的元素必须禁掉浏览器默认平移：否则安卓 webview 把"从下往上滑"当成页面滚动/橡皮筋吞掉
//   （touchmove 多为 passive，preventDefault 被忽略），自定义上滑接管不了 → 抽屉拉不开（2026-10-17 真机实锤）。
const bSlideCss = block(/\.home-slide \{[\s\S]*?\n\}/);
assert(/touch-action:\s*none/.test(bSlideCss), '主页上滑宿主 .home-slide 有 touch-action:none（安卓不被浏览器抢滚动）');
assert(/homeSwipeMove\(e\)/.test(home) && /this\.panelDrag = 100/.test(home), '上滑进入拖动（panelDrag=100 起手、面板跟手升起）');
// 首页与抽屉连贯：主页整列随同一进度上移让位（主卡升起、卡片从其下方浮现）
assert(/class="hcards" :style="homeShift"/.test(home) && /class="home-cta" :style="homeShift"/.test(home),
  '主页整列绑 homeShift（上滑时主卡上移让位）');
const bShift = block(/homeShift\(\)\s*\{[\s\S]*?\n    \}/);
assert(/openProg/.test(bShift) && /translateY/.test(bShift), '上移量由展开进度驱动（跟手，非硬切）');
// ★ 景深：主页整列轻微缩小形成后退一层。只上移不缩小 = 两层同速同大小，
//   看着就是同一列接着排，没有抽屉压上来的层次。
assert(/HOME_DEPTH_SCALE/.test(bShift) && /scale\(/.test(bShift), '主页整列随抽屉缩小（景深：后退一层）');
assert(/const HOME_DEPTH_SCALE = 0\.07/.test(home), '景深缩放常量存在');
// ★ 上滑视差要比原来 18vh 更大，否则位移太小读不出层次
assert(/HOME_PARALLAX_VH/.test(bShift), '上移幅度走常量（不是散落的魔法数字）');
assert(/const HOME_PARALLAX_VH = 26/.test(home), '上滑视差幅度 26vh（原先 18vh 太小）');
// 缩放要以同一个原点收，否则三张卡各自缩放、间距乱跳
assert(/transform-origin:\s*50% 22%/.test(home), '主页整列统一 transform-origin（不各自绕中心缩）');
// 主页必须随抽屉淡出：主页还亮着的话收工按钮会和抽屉底部的
// 「编辑首页」摞在一起（真机 2026-10-16 视频实锤）
assert(/opacity: String\(1 - p \* 0\.92\)/.test(bShift), '主页整列随抽屉展开淡出（不与抽屉底部按钮重叠）');
// ★ 诊断：面板高度算不出来必须留痕（H=0 → dy/H=NaN → 内联 transform 被整个丢弃
//   → 表现"上滑没反应"且控制台一声不吭）。但**有估算值可用时别刷日志** ——
//   panelHpx 每次 touchmove 都走，无条件 warn 会把控制台淹掉（真机 2026-10-16 实锤）。
const bPanelH = block(/panelHpx\(\)\s*\{[\s\S]*?\n    \}/);
assert(/this\.nodeMiss\+\+/.test(bPanelH), '高度算不出来要计数（诊断）');
assert(/console\.warn\(/.test(bPanelH) && /\[drawer\]/.test(bPanelH), '高度算不出来要 console.warn 留痕');
assert(/if \(H > 0\) return H/.test(bPanelH) && /return 480/.test(bPanelH),
  '高度有地板值 480（除零 → NaN → 动画等于没写）');
assert(/this\.panelH \|\| Math\.round\(this\.winH \* 0\.76\)/.test(bPanelH),
  '优先用缓存的实测高度，其次才退回估算');
assert(/nodeMiss: 0/.test(home), 'data 里有 nodeMiss 诊断计数');
// ★ 面板高度必须提前异步量好缓存：app 端 ref 不是 DOM 节点，读不到 offsetHeight
//   （真机日志 ref=has 却拿不到高度）；而 touchmove 要同步用、等不了异步查询。
assert(/panelH: 0/.test(home), 'data 里有 panelH 缓存字段');
const bMeasure = block(/measurePanel\(tryN\)\s*\{[\s\S]*?\n    \}/);
assert(bMeasure !== '', '存在 measurePanel（异步量真实高度）');
assert(/createSelectorQuery/.test(bMeasure) && /boundingClientRect/.test(bMeasure),
  'measurePanel 用选择器查询量高（不是读 ref.offsetHeight）');
assert(/select\('\.dr-panel'\)/.test(bMeasure), 'measurePanel 量的是抽屉面板');
assert(/this\.panelH = Math\.round\(h\)/.test(bMeasure), '量到就写进 panelH 缓存');
assert(/measurePanel\(n \+ 1\)/.test(bMeasure), '首帧没布局完要退一拍重量（最多 6 次）');
assert(/this\.measurePanel\(\)/.test(home), '进页面要把面板高度量好（onShow 调用）');
assert(!/\$refs\.drPanel/.test(home.split('measurePanel(tryN)')[1] || ''),
  '量高不再依赖 ref（app 端 ref 不是 DOM 节点）');
// ⚠️ 抽屉面板必须 border-box：width:100% + padding 在 content-box 下溢出右边缘，
//    卡片整体向右偏、右边被屏幕裁掉一截
assert(/box-sizing: border-box/.test(drPanelCss), '抽屉面板 border-box（避免 width100%+padding 溢出右边缘）');
// 结构护栏：Options API 里 top-level 的自定义项会被 Vue 直接丢弃 —— 
// 曾经 runReplanFlow 等 5 个方法被放在 onShow 与 onHide 之间（methods 之外），
// 结果 this.runReplanFlow is not a function，且任务完成弹窗永远打不开。
const iMethods = home.indexOf('\n  methods: {');
assert(iMethods > 0, '存在 methods: {');
for (const nm of ['async runReplanFlow()', 'onSchedDone(row)', 'openDoneDialog(row)', 'askReplanNote(ask)', 'maybePendingAsk()']) {
  const i = home.indexOf(nm);
  assert(i > iMethods, nm + ' 必须住在 methods 里（顶层会被 Vue 丢弃）');
}
// 主页不能开天窗：三张主卡全被收纳时兜底回「开始专注」
const bHomeOrder = block(/homeOrder\(\)\s*\{[\s\S]*?\n    \}/);
assert(/ids\.length \? ids : \['focus'\]/.test(bHomeOrder), '主卡全被收纳时兜底回「开始专注」（主页不开天窗）');
assert(/drawerOn \|\| this\.editing \|\| this\.locked/.test(home), '抽屉已开 / 编辑 / 计时中时上滑不响应');
assert(/if \(!this\.restCount\)/.test(home), '没有其余组件可展示时不空开抽屉');
assert(/dy > 56 && dx < dy \* 0\.6 && startY > this\.winH \* 0\.55/.test(home), '兜底：下半屏起手 + 上滑够长才开');

console.log('== 4. 再往下滑才有编辑 ==');
assert(at('class="mod-list"') > 0 && at('class="home-foot"') > at('class="mod-list"'),
  '编辑入口排在卡片列表之后');
assert(at('class="dr-body"') > 0 && at('class="home-foot"') > at('class="dr-body"'),
  '编辑入口在抽屉滚动区里（滑到底才出现）');
assert(at('class="home-cta"') > 0 && at('class="home-cta"') < at('class="mod-list"'),
  '收工留在主页底部（在抽屉之前）');

console.log('== 5. 两处联动 ==');
const bToggle = block(/toggleEdit\(\)\s*\{[\s\S]*?\n    \}/);
assert(/if \(this\.editing\) this\.drawerOn = true/.test(bToggle), '进编辑态自动拉出抽屉');
const bClose = block(/closeDrawer\(\)\s*\{[\s\S]*?\n    \}/);
assert(/if \(this\.editing\) return/.test(bClose), '编辑态不许收起抽屉');
assert(!/buzzDrawer|haptic/.test(bClose), '收起不震（用户只要"滑出来"震）');
// ⚠️ 这里不能用 /maybeGuide[\s\S]*?this\.drawerOn = true/ 这种跨段正则：
//   它会一路吃到后面任意一个 drawerOn = true（比如 toggleEdit 里的），
//   于是"引导前忘了拉抽屉"根本抓不到（假绿）。精确到 maybeGuide 方法体。
const bGuide = block(/maybeGuide\(\)\s*\{[\s\S]*?\n {4}\}/);
assert(/this\.drawerOn = true/.test(bGuide), '引导前先拉出抽屉');
// 同理，locked(v) 只取 watch 那一段（缩进 4 空格收尾）
const bLocked = block(/locked\(v\)\s*\{[\s\S]*?\n {4}\}/);
assert(/this\.drawerOn = false/.test(bLocked), '计时一起就收起抽屉');

console.log('== 6. 抽屉层在 .page-slide 之外（记忆约束 3）==');
// 真跑一遍标签栈：只比"谁写在前面"是假绿 —— 标签忘了闭合时，
// 就算是写在 page-slide 后面，也照样是它的子节点，fixed 参照还是会被动画接管。
// 记忆约束 3：抽屉 / sheet 这类 fixed 层必须挂在 .page-slide 之外，
//   否则切 tab 的 transform 会让 fixed 元素以包裹层为参照、跟着页面滑走。
const VOID = { image: 1, input: 1, icon: 1, br: 1 };
const ancestorsOf = (cls) => {
  const tm = home.slice(home.indexOf('<template>'), home.indexOf('</template>'));
  const stack = [];
  let hit = null;
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(tm))) {
    const close = m[1], tag = m[2], attrs = m[3], self = m[4];
    if (tag === 'template') continue;
    if (self === '/' || VOID[tag]) continue;
    if (close) { if (stack.length) stack.pop(); continue; }
    const cm = attrs.match(/class="([^"]*)"/);
    const cl = cm ? cm[1] : '';
    stack.push(cl);
    if (hit === null && cl.split(/\s+/).indexOf(cls) >= 0) hit = stack.slice(0, -1);
  }
  return hit;
};
const ancDr = ancestorsOf('dr-mask');
assert(ancDr !== null, '找得到抽屉层 .dr-mask');
assert(ancDr !== null && ancDr.join(' | ').indexOf('page-slide') < 0,
  '抽屉层 (.dr-mask) 不在 .page-slide 内（fixed 不受切 tab 动画影响）');
const ancHc = ancestorsOf('hcards');
assert(ancHc !== null && ancHc.join(' | ').indexOf('page-slide') >= 0,
  '主页三卡仍留在 .page-slide 内（跟着切 tab 动画走）');

console.log('== 7. 起表仍然只能从准备页进 ==');
// 先剥注释再扫 —— 注释里要写清楚"为什么没有 auto=1"，不剥会被自己的注释命中
// （口径与 check-home.js 一致）。autoRestOn / autoReplan 是正经功能名，不能用 /auto/ 扫。
const heroCode = home.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
assert(!/auto=1/.test(heroCode), '首页不带 auto=1 起表参数（只扫代码，不扫注释）');

console.log('== 8. 新文案都进了英文表 ==');
[
  '今天先做这个', '今天还没有安排', '剩 {n} 分钟', '段专注', '项待办',
  '开始专注', '全部组件', '说一句', '更多组件', '开始',
  '查看其余 {n} 项', '还剩 {n} 段专注', '还要 {n} 分钟',
  '自由专注', '点这里先看清时长与设置', '休息中', '专注中'
].forEach(k => assert(en.indexOf("'" + k + "'") >= 0, 'i18n-en 含 key「' + k + '」'));

console.log('== 9. 背单词 App 移植：hero-glass 模糊层 + 抽屉 Q 弹 ==');
// hero-glass：主页撤退时把背景糊成一片（静止必须透明、背景高清；只过渡 opacity，不过渡 blur 半径）
assert(/class="hero-glass"[^>]*:style="heroGlassStyle"/.test(home), 'hero-glass 层存在并绑定 heroGlassStyle');
const hgCss = block(/\.hero-glass \{[\s\S]*?\n\}/);
assert(/z-index: -1/.test(hgCss), 'hero-glass z-index:-1（压背景之上 / 主页之下，不被 opacity 祖先隔离）');
assert(/transition: opacity 0\.16s ease/.test(hgCss), 'hero-glass 只过渡 opacity（160ms），不过渡 blur 半径');
const bGlass = block(/heroGlassStyle\(\)\s*\{[\s\S]*?\n    \},/);
assert(/if \(this\.editing \|\| p <= 0\) return \{ opacity: '0' \}/.test(bGlass), '静止 / 编辑态 hero-glass 透明（背景必须高清）');
assert(/const blur = \[6, 12, 18, 20\]\[tier - 1\]/.test(bGlass), 'hero-glass 五档模糊（不过渡半径）');
assert(/backdropFilter: 'blur\(/.test(bGlass), 'hero-glass 走 backdrop-filter 而非实色垫片');
assert(/webkitBackdropFilter/.test(bGlass), 'hero-glass 带 -webkit- 前缀（App 端 webview 兼容）');
assert(/const tint = tier >= 4 \? 0\.12 : 0/.test(bGlass), '拉满那档才给一点实体色，平时纯靠模糊');
// 抽屉"丢上来"的 Q 弹：dr-throw 包 dr-panel，pop-a/pop-b 交替重触发
assert(/<view class="dr-throw" :class="popCls">/.test(home), 'dr-throw 包裹层存在（动画不冲掉面板跟手位移）');
const bPopCls = block(/popCls\(\)\s*\{[\s\S]*?\n    \},/);
assert(/return this\.popSeq % 2 \? 'pop-b' : 'pop-a'/.test(bPopCls), 'popCls 按奇偶交替 pop-a/pop-b 重触发');
const bPlayPop = block(/playPop\(\)\s*\{[\s\S]*?\n    \},/);
assert(/this\.popSeq\+\+/.test(bPlayPop) && /this\.popOn = false/.test(bPlayPop) && /this\.popOn = true/.test(bPlayPop),
  'playPop 先关后开 + 自增序号以重触发');
assert(/if \(this\.editing\) return/.test(bPlayPop), '编辑态打开不弹（编辑有自己的过渡）');
const bWatch = block(/watch: \{[\s\S]*?\n  \},/);
assert(/drawerOn\(n, o\)\s*\{[\s\S]*?this\.playPop\(\)/.test(bWatch), 'drawerOn false→true 监听统一触发 Q 弹');
const popKeyA = block(/@keyframes sheet-pop-a \{[\s\S]*?\n\}/);
assert(/26%.*translateY\(-16rpx\) scale\(1\.026\)/.test(popKeyA), 'sheet-pop 冲过头 -16rpx/1.026');
assert(/54%.*translateY\(5rpx\) scale\(0\.995\)/.test(popKeyA), 'sheet-pop 回落 +5rpx/0.995');
assert(/78%.*translateY\(-2rpx\) scale\(1\.003\)/.test(popKeyA), 'sheet-pop 二段余震 -2rpx');
const popKeyB = block(/@keyframes sheet-pop-b \{[\s\S]*?\n\}/);
assert(popKeyB !== '' && /translateY\(-16rpx\) scale\(1\.026\)/.test(popKeyB), 'sheet-pop-b 与 a 内容一致（交替挂用）');

console.log(fail ? '\n首页分层校验失败 ' + fail + ' 项 ✗' : '\n首页分层校验全部通过 ✓');
process.exit(fail ? 1 : 0);
