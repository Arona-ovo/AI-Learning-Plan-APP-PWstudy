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
const bGripEnd = block(/gripEnd\(\)\s*\{[\s\S]*?\n    \}/);
assert(/const commit = this\.panelDrag > 50/.test(bGripEnd),
  '把手下拉：必须拖过一半才收起（方向写成 < 会"轻碰就收、使劲拉反而弹回"）');
assert(/if \(this\.panelDrag === null\) \{ this\.dragging = false; this\.gripY = 0; return \}/.test(home),
  '把手轻点（没拖出 6px）也要复位 dragging，否则过渡被永久关掉');
assert(!/class="dr-peek"/.test(home), '主页底部常驻把手（小横条）已移除：打开靠整屏上滑');

console.log('== 3b. 主页整块上滑跟手拉抽屉（不只小把手）==');
assert(/@touchstart="homeSwipeStart"/.test(home) && /@touchmove="homeSwipeMove"/.test(home) && /@touchend="homeSwipeEnd"/.test(home),
  '主页内容区绑了上滑手势（跟手升起）');
assert(/homeSwipeMove\(e\)/.test(home) && /this\.panelDrag = 100/.test(home), '上滑进入拖动（panelDrag=100 起手、面板跟手升起）');
// 首页与抽屉连贯：主页整列随同一进度上移让位（主卡升起、卡片从其下方浮现）
assert(/class="hcards" :style="homeShift"/.test(home) && /class="home-cta" :style="homeShift"/.test(home),
  '主页整列绑 homeShift（上滑时主卡上移让位）');
const bShift = block(/homeShift\(\)\s*\{[\s\S]*?\n    \}/);
assert(/openProg/.test(bShift) && /translateY/.test(bShift), '上移量由展开进度驱动（跟手，非硬切）');
// 主页必须随抽屉淡出：抽屉没有实体，主页还亮着的话收工按钮会和抽屉底部的
// 「编辑首页」摞在一起（真机 2026-10-16 视频实锤）
assert(/opacity: String\(1 - p\)/.test(bShift), '主页整列随抽屉展开淡出（不与抽屉底部按钮重叠）');
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

console.log(fail ? '\n首页分层校验失败 ' + fail + ' 项 ✗' : '\n首页分层校验全部通过 ✓');
process.exit(fail ? 1 : 0);
