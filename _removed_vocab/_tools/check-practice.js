// _tools/check-practice.js - 练习页「退出后异步不许再出声」校验（只读，不改源码）
//
// 背景（用户实测 bug）：点「开始背单词」后立刻退出页面，出题的 await 还在跑，
// 跑完会 setupQuestion → 自动朗读题目，于是"人已经离开了，手机还在念题"。
// 而且 AI 生成是要花钱的，退出后仍把整组题生成完等于白烧 token。
//
// 修法是两头堵，本脚本两头都盯：
//   ① session 层：buildSession / buildDrillSession / buildCustomSession 接受 shouldStop，
//      在批次边界提前收手（省掉后续 AI 请求）
//   ② practice 层：onUnload 置 alive=false，await 之后立刻 return（不再朗读、不再写状态）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const is = (c, m) => (c ? ok(m) : bad(m));

const PRACTICE = path.join('pkgStudy', 'pages', 'practice', 'practice.vue');
const pv = read(PRACTICE);
const sv = read('utils/session.js');

console.log('== 1. 页面有"还活着吗"的标记 ==');
is(/alive:\s*true/.test(pv), 'data 里有 alive 字段（默认 true）');

console.log('== 2. 退出时必须置 false ==');
// 先截出 onUnload 函数体，避免正则一路吃到 methods 区
const unloadM = pv.match(/\n\s*onUnload\(\)\s*\{([\s\S]*?)\n  \},/);
const unload = unloadM ? unloadM[1] : '';
is(unload.length > 0, '有 onUnload');
is(/this\.alive\s*=\s*false/.test(unload), 'onUnload 把 alive 置 false');
is(/tts\.stop\(\)/.test(unload), 'onUnload 停掉正在播的语音');
is(/clearAnswerTimer\(\)/.test(unload), 'onUnload 清掉"答后延迟朗读"定时器');

console.log('== 3. 切后台不能误伤（回来还要继续练）==');
// onHide 是单行写法 `onHide() { ... },`，不能用"匹配到 \n  },"的多行正则，
// 否则会一路吃掉后面的 onUnload，把它的 alive=false 算到 onHide 头上（假红）
const hideM = pv.match(/\n\s*onHide\(\)\s*\{([^\n]*)\}/);
const hide = hideM ? hideM[1] : '';
is(hide.length > 0, '有 onHide');
is(!/alive\s*=\s*false/.test(hide),
  'onHide 不置 alive=false（只停声音，出题继续；否则切后台回来反而没题）');

console.log('== 4. 出题调用都要带取消信号 ==');
// 三处：drill 主链路、drill 兜底链路、日常链路。
// 注意不能用 \([^)]*\) 去抓整段调用 —— 实参里有箭头函数 `() => !this.alive`，
// 它自带的括号会把匹配提前截断，导致数出来的"带取消信号"永远是 0（假红）
const totalCalls = (pv.match(/session\.build(?:Session|DrillSession)\(/g) || []).length;
const stopCalls = (pv.match(/session\.build(?:Session|DrillSession)\([^\n]*!this\.alive\)/g) || []).length;
is(totalCalls >= 3, '找到出题调用点（' + totalCalls + ' 处）');
is(stopCalls === totalCalls,
  '每处都传了 () => !this.alive（' + stopCalls + '/' + totalCalls + '）');

console.log('== 5. await 之后要立刻收手 ==');
const startM = pv.match(/\n\s*async start\(source\)\s*\{([\s\S]*?)\n    \},/);
const start = startM ? startM[1] : '';
is(start.length > 0, '找到 start()');
const guards = (start.match(/if\s*\(!this\.alive\)\s*return/g) || []).length;
is(guards >= 2, 'await 后至少两道关口（drill 兜底前 + 最终进 setupQuestion 前）: ' + guards);
// 最关键的一条：日常链路（else 分支）的 await 到 setupQuestion 之间必须有关口。
// 不能用 lastIndexOf('if (!this.alive) return') —— drill 分支里也有一道，
// 它会先被找到，于是即使把"共同关口"删掉，断言仍然误报为通过（假绿）。
// 必须限定区间：从最后一次出题 await 起，到 setupQuestion 为止。
const setupIdx = start.indexOf('this.setupQuestion(0)');
const lastAwait = start.lastIndexOf('await session.build');
const between = lastAwait >= 0 && setupIdx > lastAwait ? start.slice(lastAwait, setupIdx) : '';
is(!!between && /if\s*\(!this\.alive\)\s*return/.test(between),
  '最后一次出题 await 到 setupQuestion 之间有关口（日常链路也覆盖到）');
is(/tts\.speakAuto/.test(pv), '确认朗读入口确实在 setupQuestion 里（防改名后断言空转）');

console.log('== 6. session 层真的接受取消 ==');
['buildSession', 'buildDrillSession'].forEach((fn) => {
  const m = sv.match(new RegExp('export async function ' + fn + '\\(([^)]*)\\)'));
  is(!!m && /shouldStop/.test(m[1]), fn + ' 签名带 shouldStop');
});
const cm = sv.match(/async function buildCustomSession\(([^)]*)\)/);
is(!!cm && /shouldStop/.test(cm[1]), 'buildCustomSession 签名带 shouldStop（导入词书走这条）');
is(/function stopped\(/.test(sv), '有统一的取消判定函数 stopped()');
// 判定函数必须自己吞异常：页面可能已半销毁，shouldStop 抛错不能把出题搞崩
const sm = sv.match(/function stopped\(shouldStop\)\s*\{([\s\S]*?)\n\}/);
is(!!sm && /try\s*\{/.test(sm[1]) && /catch/.test(sm[1]),
  'stopped() 自己吞异常（页面半销毁时不连累出题）');
// 批次边界要有检查点
const checks = (sv.match(/if\s*\(stopped\(shouldStop\)\)\s*return questions/g) || []).length;
is(checks >= 5, '五个批次边界都设了检查点（3 个主循环 + 2 个补题循环）: ' + checks);
// 取消要能透传给自建词书那条分支
is(/return buildCustomSession\(n, bid, shouldStop\)/.test(sv),
  'buildSession 把取消信号透传给 buildCustomSession');

console.log('== 7. 不要靠抛异常来取消 ==');
is(!/throw new Error/.test(sv.slice(sv.indexOf('function stopped'), sv.indexOf('function stopped') + 400)),
  'stopped() 不用抛异常做控制流（会把已生成的题一起丢掉）');

console.log('');
console.log(fail === 0 ? '练习页异步取消 校验全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);
