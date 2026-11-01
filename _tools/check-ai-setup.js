// _tools/check-ai-setup.js - 「填 API」这条路的校验
// 运行：node _tools/check-ai-setup.js（从仓库根目录跑）
//
// 为什么单独立一套：AI 配置不是"一个开关"，而是**四段链**——
//   设置里存了 → 服务层认它 → 各功能真的发得出请求 → 界面上不填的时候有人提醒。
// 断在哪一段，表现都是"AI 功能没反应"，而用户只会说"这 App 坏了"。
// 这套盯的就是这条链的接缝：
//   1) 专用页真的存在、路由真的注册了（不然点了「去填写」是空白页）
//   2) 保存时**总开关一起打开**（只存 key 不置 enabled=true 是最隐蔽的一处：
//      密钥填了、测试也通了，功能全都不动，因为 isAIEnabled() 还看到 false）
//   3) 先落盘再测（testAIConnection 读的是 settings，顺序反了测的是上一份配置）
//   4) 判定逻辑只有一处（services/config.js），页面不许自己另写一套
//   5) 没配的时候，三个入口都提醒：首页提醒卡 / 开始前几件事 / 规划页那条提示
//
// 只读，不改源码。
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load.js');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PAGE = 'pkgManage/pages/ai-setup/ai-setup.vue';
const HOME = 'pages/home/home.vue';
const START = 'pkgManage/pages/start/start.vue';
const WIZARD = 'pkgPlan/pages/wizard/wizard.vue';

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

/* ---------- 1. 页面与路由 ---------- */
console.log('== 1. 专用页与路由 ==');
assert(fs.existsSync(path.join(ROOT, PAGE)), 'pkgManage/pages/ai-setup/ai-setup.vue 存在');

// pages.json 里带行尾注释，按 check-refs 的同款办法先剥掉再解析
const pjRaw = R('pages.json')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/([^:])\/\/.*$/gm, '$1');
let pj = null;
try {
  pj = JSON.parse(pjRaw);
  ok('pages.json 能解析');
} catch (e) {
  bad('pages.json 解析失败：' + e.message);
}
if (pj) {
  const pk = (pj.subPackages || []).find((s) => s.root === 'pkgManage');
  assert(!!pk, 'pkgManage 分包还在');
  const paths = ((pk && pk.pages) || []).map((p) => p.path || '');
  assert(paths.indexOf('pages/ai-setup/ai-setup') >= 0, 'ai-setup 已注册进 pkgManage 分包');
  // 注册了但没预载也行；关键是别注册成主包页面（主包体积是硬约束）
  assert(!(pj.pages || []).some((p) => /ai-setup/.test(p.path || '')), '没被塞进主包（tsx 体积）');
}

const pageSrc = fs.existsSync(path.join(ROOT, PAGE)) ? R(PAGE) : '';

/* ---------- 2. 复用服务层，不另写一套判定 ---------- */
console.log('');
console.log('== 2. 判定与请求都走 services（页面不另写一套）==');
assert(/PROVIDER_PRESETS/.test(pageSrc), '服务商列表取自 services/config.js');
assert(/validateKeyFormat/.test(pageSrc), '格式校验用 services 的 validateKeyFormat');
assert(/testAIConnection/.test(pageSrc), '连通性测试用 services 的 testAIConnection');
assert(!/sk-[A-Za-z0-9]{10,}/.test(pageSrc), '页面里没有任何真密钥字面量（源码不许躺密钥）');

/* ---------- 3. 保存：总开关 + 先落盘再测 ---------- */
console.log('');
console.log('== 3. 保存语义 ==');
assert(/enabled:\s*true/.test(pageSrc),
  '保存时把 ai.enabled 置 true —— 只存 key 不置这个，功能全都不会动');
assert(/settings\.set\(\{\s*ai\s*\}\)/.test(pageSrc) || /settings\.set\(\{\s*ai\s*:/.test(pageSrc),
  '保存写的是 settings.ai（服务层读的就是这一份）');
const iSave = pageSrc.indexOf('settings.set({ ai');
const iTest = pageSrc.indexOf('await testAIConnection()');
assert(iSave >= 0 && iTest > iSave, '先落盘再测连通（顺序反了测的是上一份配置）');
assert(/verify:\s*\{\s*sig/.test(pageSrc), '保存时把旧的验证结论作废（换配置就不该说"可用"）');

/* ---------- 4. 不许直接弹系统窗 ---------- */
console.log('');
console.log('== 4. 弹窗口径（与 check-dialog 同一条规矩）==');
assert(pageSrc.indexOf('uni.showModal') < 0, '页面没直接调 uni.showModal（统一走 app-dialog）');
assert(pageSrc.indexOf('uni.showActionSheet') < 0, '页面没直接调 uni.showActionSheet');

/* ---------- 5. 三个入口都提醒 ---------- */
console.log('');
console.log('== 5. 没配的时候，三处都提醒 ==');
const homeSrc = R(HOME);
assert(/aiGateReason/.test(homeSrc), '首页用 services 的 aiGateReason 判定（不自己拼条件）');
assert(/refreshAiNeed\(\)/.test(homeSrc), '首页有 refreshAiNeed()');
const iCall = homeSrc.indexOf('this.refreshAiNeed()');
const iRefresh = homeSrc.indexOf('refresh() {');
assert(iRefresh >= 0 && iCall > iRefresh, 'refresh() 里会调（从填写页回来就能变）');
assert(/v-if="aiNeed"/.test(homeSrc), '首页有「还差一个 API Key」那张卡');
assert(/@tap="goAiSetup\(\)"/.test(homeSrc), '点卡片能到填写页');
assert(/muteAi/.test(homeSrc), '那张卡能点掉（别变成拆不掉的牛皮癣）');

const startSrc = R(START);
assert(/aiGateReason/.test(startSrc), '「开始前的几件事」也判 AI 状态');
assert(/ai-setup/.test(startSrc), '那一屏有去填写的入口');

const wizSrc = R(WIZARD);
assert(/@tap="goAiSetup"/.test(wizSrc), '规划页那条"还没填"的提示能点（不是一段死文字）');
assert(/goAiSetup\(\)\s*\{[\s\S]{0,220}ai-setup/.test(wizSrc), '规划页的 goAiSetup 真的跳 ai-setup');

/* ---------- 6. 真跑一遍判定链（把 services/config.js 跑起来）---------- */
console.log('');
console.log('== 6. 判定链（真跑 services/config.js，settings 用桩）==');
const store = { ai: {} };
const settingsStub = {
  get: () => ({ ai: store.ai }),
  set: (patch) => { if (patch && patch.ai) { store.ai = Object.assign({}, store.ai, patch.ai); } }
};
let cfg = null;
try {
  cfg = load('services/config.js', { settings: settingsStub });
  ok('config.js 能加载（settings 用桩）');
} catch (e) {
  bad('config.js 加载失败：' + e.message);
}
if (cfg) {
  store.ai = {};
  assert(cfg.aiGateReason() === '未填写 API 密钥', '空配置 → 先报缺密钥（' + cfg.aiGateReason() + '）');
  store.ai = { apiKey: 'sk-test-123456' };
  assert(/地址/.test(cfg.aiGateReason()), '有密钥没地址 → 报缺地址（' + cfg.aiGateReason() + '）');
  store.ai = { apiKey: 'sk-test-123456', baseURL: 'https://api.example.com/v1', enabled: false };
  assert(/未开启/.test(cfg.aiGateReason()), '地址密钥都有但开关关着 → 报未开启（' + cfg.aiGateReason() + '）');
  assert(cfg.isAIUsable() === false, '上面那状态下 isAIUsable() 是 false（页面据此露提醒卡）');
  store.ai = { apiKey: 'sk-test-123456', baseURL: 'https://api.example.com/v1', enabled: true };
  assert(cfg.aiGateReason() === '' && cfg.isAIUsable() === true, '三项齐备 → 判定可用');
  // 地址归一：填根地址 / 填到 /v1 / 直接贴全路径，三种都要能得到同一个 chat 端点
  const want = 'https://api.example.com/v1/chat/completions';
  assert(cfg.chatEndpoint('https://api.example.com') === want, '根地址自动补 /v1/chat/completions');
  assert(cfg.chatEndpoint('https://api.example.com/v1') === want, '/v1 结尾不会补成 /v1/v1');
  assert(cfg.chatEndpoint('https://api.example.com/v1/chat/completions') === want, '整条路径原样用');
  // 预设表是"地址和模型已填好"的前提：少一个字段，页面上就会是空框
  const bad2 = cfg.PROVIDER_PRESETS.filter((p) => p.value !== 'custom' && (!p.baseURL || !p.model));
  assert(bad2.length === 0, '每个内置服务商都有默认地址与模型（' + cfg.PROVIDER_PRESETS.length + ' 个）');
}

/* ---------- 7. 设置默认值 ---------- */
console.log('');
console.log('== 7. settings 默认值 ==');
const setSrc = R('utils/settings.js');
assert(/promptMuted:\s*false/.test(setSrc), 'ai.promptMuted 默认 false（提醒卡默认会出来）');
assert(/verify:\s*\{\s*sig:/.test(setSrc), 'ai.verify 有默认结构（页面读它不会 undefined）');

console.log('');
console.log(fail === 0 ? 'AI 配置链路校验全部通过' : '失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);
