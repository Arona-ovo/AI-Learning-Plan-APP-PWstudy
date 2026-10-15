// _tools/check-home-hero.js - 首页分层（第一屏聚焦 → 图形摘要 → 折叠组件列表）静态校验（只读）
//
// 回归点（对应需求：默认首页只聚焦主要任务，其余卡片压成图形 / 进度条，
//   完整卡片列表要往上滑才展开，编辑入口压在列表最底下）：
//  1) 第一屏「今日聚焦」：主任务 + 一条进度 + 三个读数 + 一颗按钮，且排在折叠区之前
//  2) 主任务怎么挑（focusTask）：排除已完成 → 超期优先 → 剩余专注最多
//  3) 图形摘要条：其余模块压成进度条 / 点阵 / 数字，点一格 = 展开并滚到那张卡
//  4) 折叠区默认收起：手势（往上滑）/ 点击两条路都能展开
//  5) 顺序：折叠把手 → 列表头 → 卡片列表 → 收工 → 编辑入口（编辑要再往下滑才够得着）
//  6) 两处联动：进编辑态自动展开（否则看不见卡片 / 拖不动）；引导前自动展开
//     （引导要挖洞的 .focus-card / .task-card 住在折叠区，收着时量不到矩形会被跳过）
//  7) 起表仍然只能从准备页进（startFocusTask 走 startFor / goFocus，不带任何 auto 参数）
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
// 模板里各块的先后：顺序本身就是这次需求（"再往下滑才有编辑"）
const at = (s) => home.indexOf(s);
const block = (re) => { const m = home.match(re); return m ? m[0] : ''; };

console.log('== 1. 第一屏：今日聚焦 ==');
assert(/class="hero"/.test(home), '有聚焦区 .hero');
assert(at('class="hero"') > 0 && at('class="hero"') < at('class="mods-peek"'),
  '聚焦区排在折叠把手之前（默认第一眼先看到它）');
assert(/class="hero-title"/.test(home) && /focusTask \? focusTask\.task\.title/.test(home),
  '聚焦区标题显示主任务名');
assert(/class="hero-bar"/.test(home) && /class="hero-fill"/.test(home), '一条今日进度条');
assert(/class="hero-stats"/.test(home) && /hs-num/.test(home), '三个读数（分钟 / 段专注 / 项待办）');
assert(/class="hero-main"/.test(home) && /@tap="startFocusTask"/.test(home), '主按钮接 startFocusTask');
assert(!/hero-ghost/.test(home), '第一屏只留一颗按钮（不摆第二个选择让人挑）');

console.log('== 2. 主任务怎么挑（focusTask） ==');
const bFocus = block(/focusTask\(\)\s*\{[\s\S]*?\n    \}/);
assert(!!bFocus, 'computed focusTask');
assert(/status !== 'done'/.test(bFocus), '排除已完成的任务（不显示一条已经打勾的）');
assert(/const late = q\.filter\(i => i\.overdue\)/.test(bFocus) && /if \(late\.length\) return late\[0\]/.test(bFocus),
  '超期的最优先（它已经欠着了）');
assert(/left\(b\) - left\(a\)/.test(bFocus), '其次挑"剩余专注最多"那条（今天真正的大头）');
const bStat = block(/taskStat\(\)\s*\{[\s\S]*?\n    \}/);
assert(/pct: total \? Math\.round\(done \* 100 \/ total\) : 0/.test(bStat), 'taskStat 算了完成百分比（空队列不除零）');

console.log('== 3. 图形摘要条：其余模块压成图形 / 进度条 ==');
assert(/class="mini-row"/.test(home) && /class="mini"/.test(home), '有图形摘要条 mini-row / mini');
assert(/m\.kind === 'bar'/.test(home) && /m\.kind === 'dots'/.test(home), '两种图形：进度条 / 点阵');
assert(/class="mg-slot"/.test(home), '图形槽定高（纯数字型没有可画的量，一排也不高低不齐）');
assert(/@tap="jumpModule\(m\.id\)"/.test(home), '点一格 = jumpModule');
// ⚠️ 结尾别写 `},\n`：仓库是 CRLF，`,` 后面是 \r 不是 \n，整条会静默匹配不到（假绿的经典坑）
const bMini = block(/miniList\(\)\s*\{[\s\S]*?\n    \}/);
assert(!!bMini, 'computed miniList');
assert(/if \(id === 'focus'\) return/.test(bMini), 'focus 不给格（它要说的话聚焦区已经说完了）');
assert(/this\.u\.empty/.test(bMini), '紧迫度是空环时整格不出现');
const bJump = block(/jumpModule\(id\)\s*\{[\s\S]*?\n    \}/);
assert(/this\.modsOpen = true/.test(bJump), 'jumpModule 先展开列表');
assert(/pageScrollTo\(\{ selector: '\.mod-wrap\[data-id="'/.test(bJump), '再滚到那张卡（按 data-id 定位）');
assert(/class="mod-wrap"/.test(home) && /:data-id="id"/.test(home), '每张卡带 data-id（滚动定位要靠它）');

console.log('== 4. 折叠区：默认收起 ==');
assert(/modsOpen: false/.test(home), 'data 里默认收起（首页默认只显示聚焦区）');
assert(/v-if="!modsOpen"[\s\S]{0,300}class="mods-peek"/.test(home), '收起时显示折叠把手');
assert(/@touchstart="peekStart"/.test(home) && /@touchmove="peekMove"/.test(home) && /@touchend="peekEnd"/.test(home),
  '把手接上滑手势（三条事件齐全）');
assert(/@tap="openMods"/.test(home), '点一下也能展开（手势不成时还有这条路）');
const bPeek = block(/peekMove\(e\)\s*\{[\s\S]*?\n    \}/);
assert(/this\.peekY - y > 32/.test(bPeek), '往上滑过 32px 才展开（不是随便一碰就开）');
assert(/class="mh-fold"[^>]*@tap="closeMods"/.test(home), '展开后有「收起」');

console.log('== 5. 顺序：列表 → 收工 → 编辑（编辑要再往下滑才够得着） ==');
// >0 那条不能省：整块被删掉时 indexOf 返回 -1，"-1 < x" 恒真会变成假绿
assert(at('class="mods-head"') > 0 && at('class="mods-head"') < at('class="mod-list"'), '列表头在卡片列表之前');
assert(at('class="mod-list"') < at('class="home-foot"'), '编辑入口压在卡片列表之后');
assert(/class="home-foot"[\s\S]{0,400}toggleEdit/.test(home), '编辑入口仍在底部操作行');

console.log('== 6. 两处联动（漏了就是"看不见 / 跳步骤"） ==');
const bToggle = block(/toggleEdit\(\)\s*\{[\s\S]*?\n    \}/);
assert(/if \(this\.editing\) this\.modsOpen = true/.test(bToggle), '进编辑态自动展开（收着时没得拖、没得收纳）');
const bClose = block(/closeMods\(\)\s*\{[\s\S]*?\n    \}/);
assert(/if \(this\.editing\) return/.test(bClose), '编辑态不许收起');
assert(/maybeGuide[\s\S]{0,2600}this\.modsOpen = true/.test(home),
  '引导前先展开（.focus-card / .task-card 住在折叠区，收着时那两步会被跳过）');

console.log('== 7. 起表仍然只能从准备页进 ==');
const bStart = block(/startFocusTask\(\)\s*\{[\s\S]*?\n    \}/);
assert(/this\.startFor\(this\.focusTask\)/.test(bStart), '有主任务 → 带着任务进准备页');
assert(/this\.goFocus\(\)/.test(bStart), '没有安排 → 走自由专注（同样是准备页）');
assert(!/auto/.test(bStart), '不带任何 auto 起表参数');

console.log('== 8. 新文案都进了英文表 ==');
[
  '今天先做这个', '今天还没有安排', '剩 {n} 分钟', '段专注', '项待办',
  '开始专注', '往上滑看全部 {n} 个组件', '全部组件', '说一句',
  '到「目标」里定一个，AI 会帮你拆成每天的任务'
].forEach(k => assert(en.indexOf("'" + k + "'") >= 0, 'i18n-en 含 key「' + k + '」'));

console.log(fail ? '\n首页分层校验失败 ' + fail + ' 项 ✗' : '\n首页分层校验全部通过 ✓');
// ⚠️ 必须走 process.exit 而不是 exitCode：反向测试（neg-home-hero.js）靠接管
//    process.exit 取退出码，用 exitCode 的话"改坏了也返回 0"，整套反向测试会假绿。
process.exit(fail ? 1 : 0);
