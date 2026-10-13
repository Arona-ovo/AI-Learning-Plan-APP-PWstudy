// _tools/check-partner.js - 「伙伴 App（背单词）可选关联」的契约校验（只读，不改源码）
//
// 为什么和 check-link.js 分开守：那是"数据通道"，这是"用户意愿"。
// 两件事都可以**完全静默地坏掉** —— 不报错、不崩、界面照常，只是功能没了：
//   · 取消关联后退回 undecided   → 用户刚选了「不用了」，下次启动又被问一遍（最招人烦）
//   · 取消关联时顺手删了数据     → 那是真实发生过的学习，不该跟着意愿一起消失
//   · shouldAsk 漏了 focusing    → 番茄跑到一半弹出一张关联卡，直接毁掉一次专注
//   · 设置页不读 lastSyncAt      → 通道断了用户看不出来，只会以为"今天没背"
//   · 三选一的分支写错下标       → 点「不用了」结果关联上了
// 所以这里钉的全是"错了也没人报警"的那几处。设计文档：uniapp-PWstudy/docs/partner-link.md

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function read(p) { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; }

/**
 * 剥注释后再匹配 —— 说明性注释会被自己的正则命中（本项目第 4 次踩）。
 *   · 整块 /* *\/ 注释
 *   · 整行 // 或 * 开头
 *   · 行尾 // 注释（但排除 :// —— scheme 字符串里那个不是注释）
 */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .filter(l => !/^\s*(\*|\/\/)/.test(l))
    .join('\n');
}

const pjs = strip(read(path.join(ROOT, 'utils', 'partner.js')));
const pjsRaw = read(path.join(ROOT, 'utils', 'partner.js'));
const set = strip(read(path.join(ROOT, 'utils', 'settings.js')));
const link = strip(read(path.join(ROOT, 'utils', 'link.js')));
const home = strip(read(path.join(ROOT, 'pages', 'home', 'home.vue')));
const page = strip(read(path.join(ROOT, 'pkgManage', 'pages', 'settings', 'settings.vue')));

console.log('== 1. 状态存哪儿、有哪些态 ==');
if (!pjsRaw) bad('utils/partner.js 不存在');
else ok('utils/partner.js 存在');
if (/partner:\s*\{[^}]*state:\s*'undecided'/.test(set)) ok("settings 默认块带 partner.state = 'undecided'（未决定，不是默认就关联）");
else bad('settings 缺 partner 默认值 —— 首次启动会拿到 undefined，弹窗判定全线失灵');
['state', 'isLinked', 'installed', 'shouldAsk', 'markAsked', 'link', 'unlink', 'noteSync'].forEach((f) => {
  if (new RegExp('export\\s+function\\s+' + f + '\\s*\\(').test(pjs)) ok('partner.js 导出 ' + f + '()');
  else bad('partner.js 缺 ' + f + '()');
});

console.log('== 2. 三态流转（取消必须落到 declined） ==');
// 这一条是防复发：退回 undecided 会让 shouldAsk 再次为真，用户被反复追问
if (/export\s+function\s+unlink[\s\S]{0,220}state:\s*'declined'/.test(pjs)) ok('unlink() 落到 declined（不会下次启动又弹一遍）');
else bad('unlink() 没落到 declined —— 用户刚取消、转头又被问，最招人烦的一种设计');
if (/export\s+function\s+link[\s\S]{0,220}state:\s*'linked'/.test(pjs)) ok('link() 落到 linked');
else bad('link() 没落到 linked');
if (/export\s+function\s+markAsked[\s\S]{0,200}askedCount/.test(pjs)) ok('markAsked() 累加 askedCount（「以后再说」也要记账）');
else bad('markAsked() 不计数 —— 「以后再说」会变成无限次提醒');

console.log('== 3. 防骚扰（这条链路最容易被做成骚扰） ==');
if (/ASK_MAX\s*=/.test(pjs)) ok('有 ASK_MAX 上限（问够次数就永远闭嘴）');
else bad('缺 ASK_MAX —— 会一直问下去');
if (/ASK_GAP_MS\s*=/.test(pjs)) ok('有 ASK_GAP_MS 间隔');
else bad('缺 ASK_GAP_MS');
if (/export\s+function\s+shouldAsk[\s\S]{0,600}o\.focusing/.test(pjs)) ok('shouldAsk() 有 focusing 短路（专注中绝不弹窗）');
else bad('shouldAsk() 没判 focusing —— 番茄跑到一半弹关联卡，直接毁掉一次专注');
if (/export\s+function\s+shouldAsk[\s\S]{0,600}ASK_MAX/.test(pjs) &&
    /export\s+function\s+shouldAsk[\s\S]{0,600}ASK_GAP_MS/.test(pjs)) ok('shouldAsk() 同时卡次数与间隔');
else bad('shouldAsk() 漏了次数或间隔判定');
if (/export\s+function\s+shouldAsk[\s\S]{0,600}o\.installed/.test(pjs)) ok('shouldAsk() 先看装没装（没装不问）');
else bad('shouldAsk() 没看 installed —— 没装也弹，点了还没反应');

console.log('== 4. 取消关联不能删数据 ==');
// 把 unlink 的函数体单独切出来看：它只该改意愿，不该碰任何学习记录
{
  const i = pjs.indexOf('export function unlink');
  const j = pjs.indexOf('export function', i + 10);
  const body = i >= 0 ? pjs.slice(i, j > i ? j : pjs.length) : '';
  if (body && !/pw\./.test(body) && !/pwreset|clearAll|remove|delete/.test(body)) {
    ok('unlink() 只改意愿，不碰任何学习记录（已记的时长与词数保留）');
  } else {
    bad('unlink() 里出现了删数据动作 —— 那是真实发生过的学习，不该跟着关联一起消失');
  }
}
if (!/import[^\n]*pwreset/.test(pjs)) ok('partner.js 没有引入 pwreset（清数据的唯一入口不许出现在这里）');
else bad('partner.js 引了 pwreset —— 取消关联随时可能变成清库');

console.log('== 5. 同步回执（否则通道断了没人知道） ==');
if (/partner\.noteSync\(/.test(link)) ok('link.js 收到回传时调了 noteSync()（设置页才答得出"上次同步是什么时候"）');
else bad('没调 noteSync() —— lastSyncAt 永远是 0，用户分不清"今天没背"和"通道断了"');
if (/export\s+function\s+syncAgo/.test(pjs)) ok('partner.js 提供 syncAgo()');
else bad('缺 syncAgo()');

console.log('== 6. 首次询问的接线（home.vue） ==');
if (/import\s+\*\s+as\s+partner\s+from\s+'\.\.\/\.\.\/utils\/partner\.js'/.test(home)) ok('home.vue 引入了 partner');
else bad('home.vue 没引入 partner —— 永远不会弹首次询问');
if (/this\.maybePartnerAsk\(\)/.test(home)) ok('onShow 调了 maybePartnerAsk()');
else bad('没调 maybePartnerAsk()');
if (/mode:\s*'sheet'/.test(home) && /action:\s*'partner-ask'/.test(home)) ok('询问弹窗是三选一菜单（mode: sheet）');
else bad('询问弹窗不是三选一 —— 用户没有「以后再说 / 不用了」的退路，就成了绑架');
if (/partner\.markAsked\(\)/.test(home)) ok('弹之前先 markAsked()（关掉弹窗回前台不会立刻再弹）');
else bad('没记账就弹 —— 关掉再回来会连着弹');
if (/partner-ask[\s\S]{0,600}payload\s*===\s*0[\s\S]{0,400}partner\.link\(\)/.test(home)) ok('选项 0 = 打通（调 link()）');
else bad('选项 0 没落到 link()');
if (/partner-ask[\s\S]{0,900}payload\s*===\s*2[\s\S]{0,300}partner\.unlink\(\)/.test(home)) ok('选项 2 = 不用了（落到 declined）');
else bad('选项 2 没落到 unlink() —— 点了「不用了」却还是会被问');
if (/if\s*\(\s*this\.dlg\.show\s*\)\s*return/.test(home)) ok('已有弹窗时让路（权限引导优先，不抢）');
else bad('没判 dlg.show —— 会和权限引导弹窗互相覆盖');

console.log('== 7. 设置页的常驻入口（四种状态、四个动作） ==');
if (/import\s+\*\s+as\s+partner\s+from\s+'\.\.\/\.\.\/\.\.\/utils\/partner\.js'/.test(page)) ok('settings.vue 引入了 partner');
else bad('settings.vue 没引入 partner');
['refreshPartner', 'doLink', 'doDecline', 'askUnlink', 'goPartner'].forEach((f) => {
  if (new RegExp('\\n\\s{4}' + f + '\\s*\\(').test(page)) ok('settings.vue 有 ' + f + '()');
  else bad('settings.vue 缺 ' + f + '()');
});
if (/pn\.installed/.test(page) && /pn\.state\s*===\s*'linked'/.test(page) && /pn\.state\s*===\s*'declined'/.test(page)) {
  ok('模板覆盖了四种状态（未安装 / 未决定 / 已关联 / 已关闭）');
} else {
  bad('模板状态分支不全 —— 至少有一种状态会显示成空白或错乱');
}
if (/action:\s*'unlink'/.test(page) && /act\s*===\s*'unlink'/.test(page)) ok('「取消关联」走了二次确认并真的落账');
else bad('取消关联没接上 —— 点了没反应');
if (/k\s*===\s*'partner'/.test(page)) ok('收起态在胶囊右侧给出一句话状态（secHint）');
else bad("secHint 没处理 'partner' —— 收起时这一栏右侧是空的");
// 「已关闭」之后必须还能回来：模板里那条"重新关联"按钮靠 state === 'declined' 判定
if (/pn\.state\s*===\s*'declined'\s*\?\s*\$t\('重新关联'\)/.test(page)) ok('已关闭状态下给出「重新关联」入口（关了还能开回来）');
else bad('已关闭之后没有回来的路 —— 一次误点就永久失去这个功能');

// ⚠️ 计数器叫 fail，不叫 bad —— bad 是上面那个报错函数（对象永远是真值）
console.log(fail ? ('\n伙伴 App 关联巡检：' + fail + ' 项待处理') : '\n伙伴 App 关联巡检全部通过');
process.exit(fail ? 1 : 0);
