// _tools/check-link.js - 与「背单词 App（AWword）」的联动契约校验（只读，不改源码）
//
// 为什么值得专门守一道：这套联动**失效时是完全静默的**，不报错、不崩、界面照常 ——
//   · manifest 少了 schemes:["pwstudy"]  → 对方学完回跳，这边毫无反应，数据白丢
//   · App.vue 没接 newintent             → 冷启动能收，App 已在后台时再被唤起就收不到
//   · 落账又写回一份冗余的 external 总账  → 同一笔时长记两处，两边早晚对不上
//   · 词数记成全局累计而不按天            → "今天背了多少"永远算不出来
// 四种都不会抛异常，只能靠静态钉契约 + 真机走一遍。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function read(p) { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; }

const mf = read(path.join(ROOT, 'manifest.json'));
const link = read(path.join(ROOT, 'utils', 'link.js'));
const app = read(path.join(ROOT, 'App.vue'));
const store = read(path.join(ROOT, 'utils', 'pwstore.js'));
const stats = read(path.join(ROOT, 'pages', 'stats', 'stats.vue'));

console.log('== 1. scheme 声明（系统认不认得 pwstudy://） ==');
if (/"schemes"\s*:\s*\[[^\]]*"pwstudy"/.test(mf)) ok('manifest 声明了 schemes: ["pwstudy"]');
else bad('缺 schemes: ["pwstudy"] —— 对方学完回跳会被系统丢掉，用户只会觉得"白背了"');

console.log('== 2. 协议两端都在 ==');
['parse', 'handle', 'toPartner', 'openPartner', 'recordExternal'].forEach((f) => {
  if (new RegExp('export\\s+function\\s+' + f + '\\s*\\(').test(link)) ok('link.js 导出 ' + f + '()');
  else bad('link.js 缺 ' + f + '()');
});
if (/SCHEME\s*=\s*'pwstudy'/.test(link)) ok("SCHEME = 'pwstudy'（与 manifest 一致）");
else bad("SCHEME 不是 'pwstudy'");
if (/PARTNER_SCHEME\s*=\s*'awword'/.test(link)) ok("PARTNER_SCHEME = 'awword'（与对方 scheme 对齐）");
else bad("PARTNER_SCHEME 不是 'awword' —— 跳过去的链接对方认不出");

console.log('== 3. 出去的链接（PWstudy → 对方） ==');
// 对方解析的是 awword://study?minutes=&task=&back=
if (/PARTNER_SCHEME\s*\+\s*':\/\/study\?minutes='/.test(link)) ok('生成 awword://study?minutes=…（路径与字段名与对方约定一致）');
else bad('出去链接的形状变了 —— 对方按 study?minutes=&task=&back= 解析');
if (/'&back='\s*\+\s*enc\(back\)/.test(link)) ok('带上了 back（学完回哪去，且做了 urlencode）');
else bad('没带 back 或没编码 —— 回跳会断');

console.log('== 4. 回来的落账口径（最容易悄悄错的一段） ==');
if (/recordExternal/.test(link) && /pw\.addAppMinutes\([^)]*PARTNER_KEY/.test(link)) ok('时长进 byApp[PARTNER_KEY]（与 AppDock 同一张表，首页/统计页直接可见）');
else bad('时长没进 byApp —— 统计页那张"学习 App 用时"里看不到背单词');
if (/pw\.addVocabWords\(/.test(link)) ok('词数走 addVocabWords（按天记）');
else bad('词数没按天落账 —— "今天背了多少"算不出来');
// 这一条是防复发：曾经这里同时写了一份 st.external 总账，没人读、还和 byApp 重复
if (!/st\.external\b/.test(link) && !/\.externalWords\b/.test(link)) ok('没有冗余的 external 总账（同一笔时长不许记两处）');
else bad('又写回 external 总账了 —— 两份账早晚对不上，而且没人读第二份');
if (/export\s+function\s+addVocabWords/.test(store) && /export\s+function\s+vocabWords/.test(store)) ok('pwstore 提供 addVocabWords() / vocabWords()');
else bad('pwstore 缺词数读写接口');

console.log('== 5. 接线：唤起与展示 ==');
if (/import\s+\*\s+as\s+link\s+from\s+'\.\/utils\/link\.js'/.test(app)) ok('App.vue 引入了 link');
else bad('App.vue 没引入 link —— 回跳链接没人处理');
if (/link\.handle\(/.test(app)) ok('App.vue 调了 handle()');
else bad('App.vue 没调 handle()');
if (/'newintent'/.test(app)) ok('App.vue 挂了 newintent（App 在后台时被唤起也要接住）');
else bad('App.vue 缺 newintent —— 后台唤起收不到，只有冷启动能用');
if (/names\[link\.PARTNER_KEY\]/.test(stats)) ok('统计页给伙伴 App 补了名字（不补会原样显示成 app:awword）');
else bad('统计页没给 app:awword 补名字 —— 那一行会显示成原始 key');
if (/pw\.vocabWords\(\)/.test(stats)) ok('统计页展示今日背词数');
else bad('统计页没展示词数 —— 回传的这个数白记了');

if (fail) {
  console.error('\n存在 ' + fail + ' 项失败');
  process.exit(1);
}
console.log('\n联动契约 校验全部通过');
