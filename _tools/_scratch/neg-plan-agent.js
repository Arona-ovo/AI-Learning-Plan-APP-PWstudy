/**
 * _tools/_scratch/neg-plan-agent.js —— check-plan-agent.js 的反向测试
 *
 * 背景：2026-10-14 真机四条反馈，服务端 / 落地页改了四处：
 *   ① 排期必须铺满用户设的整个时间范围（提示词 + normalizePlan 等比拉伸 + 本地模板同口径）；
 *   ② 规划以「天」为单位（早/中/晚只是天内时段）；
 *   ③ 追问必问"报班 / 补习"，并提示可以发课表截图；
 *   ④ 预览阶段卡可折叠、改提醒时间立刻重渲染。
 * 新护栏写完之后必须证明它抓得到坏代码 —— 否则就是永远绿的自欺断言。
 *
 * ⚠️ 同 neg-urgency-card 那套坑：
 *   ① 沙箱里 spawnSync EBUSY → 护栏只能**同进程 require**；
 *   ② 护栏自己会 process.exit → 换成"只记码不真退"；
 *   ③ 源码是 CRLF，注入片段写的 \n 全要转一遍（见 swap）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'uniapp-PWstudy');
const CHECK = path.join(__dirname, '..', 'check-plan-agent.js');
const FILES = {
  agent: path.join(ROOT, 'services', 'plan-agent.js'),
  wiz: path.join(ROOT, 'pkgPlan', 'pages', 'wizard', 'wizard.vue'),
  detail: path.join(ROOT, 'pkgPlan', 'pages', 'goal-detail', 'goal-detail.vue'),
  replan: path.join(ROOT, 'pkgPlan', 'pages', 'replan', 'replan.vue')
};

const backup = {};
Object.keys(FILES).forEach(k => { backup[k] = fs.readFileSync(FILES[k], 'utf8'); });

/** 注入：把 old 换成 next。old 必须真在文件里，否则算测试写错了（不是护栏的锅）。 */
function swap(file, oldStr, next) {
  const src = backup[file];
  let o = oldStr;
  let n = next;
  if (src.indexOf('\r\n') >= 0) {          // 源码是 CRLF，注入片段写的是 \n
    o = oldStr.split('\n').join('\r\n');
    n = next.split('\n').join('\r\n');
  }
  if (src.indexOf(o) < 0) throw new Error('注入点找不到：' + oldStr.slice(0, 60));
  fs.writeFileSync(FILES[file], src.split(o).join(n));
}
function restore() {
  Object.keys(FILES).forEach(k => fs.writeFileSync(FILES[k], backup[k]));
}

const realExit = process.exit;
let exited = null;
const realLog = console.log;
const realErr = console.error;

process.exit = function (code) { exited = code; };

async function runCheck(mutations) {
  restore();
  console.log = function () {};
  console.error = function () {};   // 护栏的 ✗ 行别混进本测试的输出
  let code = null;
  try {
    mutations.forEach(m => swap(m[0], m[1], m[2]));
    exited = null;
    delete require.cache[require.resolve(CHECK)];
    try {
      require(CHECK);
    } catch (e) {
      // 护栏自己炸了也算"抓到"，但下面按退出码判，不单独放宽
    }
    for (let i = 0; i < 60 && exited === null; i++) {
      await new Promise(r => setTimeout(r, 20));
    }
    code = exited;
  } finally {
    console.log = realLog;
    console.error = realErr;
    restore();          // 注入点写错时也不能把改坏的源码留在工作区
  }
  return code;
}

let pass = 0;
let fail = 0;
async function shouldCatch(label, mutations) {
  const code = await runCheck(mutations);
  if (code === 1) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '（退出码 ' + code + '，应当为 1）'); }
}

(async () => {
  realLog('\n== 对照：不做任何注入时护栏必须是绿的 ==');
  const green = await runCheck([]);
  if (green === 0) { pass++; console.log('  ✓ 原样源码 → 护栏绿'); }
  else { fail++; console.log('  ✗ 原样源码 → 护栏应当是绿的，实际 ' + green); }

  realLog('\n== 1. 铺满全程的兜底被摘掉 ==');
  await shouldCatch('stretchToCover 直接失效（跟没写一样）', [
    ['agent', 'function stretchToCover(tasks, totalDays) {\n  let maxDay = 0;',
      'function stretchToCover(tasks, totalDays) {\n  return 0;\n  let maxDay = 0;']
  ]);
  await shouldCatch('normalizePlan 不再调用拉伸', [
    ['agent', '  const fromDay = stretchToCover(tasks, totalDays);', '  const fromDay = 0;']
  ]);
  await shouldCatch('本地模板不铺满（localPlan 绕过兜底）', [
    ['agent', '  stretchToCover(tasks, totalDays);\n  // 模板没有时段信息', '  // 模板没有时段信息']
  ]);
  await shouldCatch('忘了取整 / 忘了夹回末天（day 越界）', [
    ['agent', 'tasks.forEach(t => { t.day = Math.max(1, Math.min(totalDays, Math.round(t.day * k))); });',
      'tasks.forEach(t => { t.day = t.day * k + 3; });']
  ]);
  await shouldCatch('拉伸了却不告诉用户（risks 里没写）', [
    ['agent', "  if (fromDay) {\n    risks.push('原计划只排到第 ' + fromDay + ' 天", "  if (false) {\n    risks.push('x' + fromDay + ' 天"]
  ]);

  realLog('\n== 2. 规划单位写成时段 / 任务的核又被收紧 ==');
  await shouldCatch('提示词不再写"任务以「天」为单位"', [
    ['agent', '任务以「天」为单位**：day = 建议第几天开始（1 = 今天）。早/中/晚只是天内的时段',
      '任务排期**：day = 建议第几天开始（1 = 今天）']
  ]);
  await shouldCatch('任务数上限退回旧的 6-30（长目标排不满的根源）', [
    ['agent', "'任务总数按长度给：建议 ' + taskCap + ' 个左右", "'任务总数 6-30 个，建议 ' + taskCap + ' 个左右"]
  ]);
  await shouldCatch('提示词不再禁止提前收工', [
    ['agent', "'不许提前收工（' + totalDays + ' 天的目标排到一半就停 = 排期不完整）", "'尽量往前排"]
  ]);

  realLog('\n== 3. 报班 / 补习这个必问项被删 ==');
  await shouldCatch('整条"固定安排是必问项"规则删掉', [
    ['agent', "    '4. **固定安排是必问项**：只要还没问出\"有没有报班 / 补习 / 上课这类每周固定占用时间的安排\"，这一轮就问它；' +\n    '问的时候顺带提一句\"有课表的话可以点输入框旁的「图片」发截图，我能看着图排\"；' +\n    '用户答了（含发了图）就别再追着问，把结论写进 summary（如\"周六全天补习班，周日半天\"）'",
      "    '4. 还有什么要问的就问吧'"]
  ]);
  await shouldCatch('必问项里不提"报班 / 补习"', [
    ['agent', '有没有报班 / 补习 / 上课这类每周固定占用时间的安排', '有没有固定的时间安排']
  ]);
  await shouldCatch('不再提示用户可以发截图', [
    ['agent', '有课表的话可以点输入框旁的「图片」发截图，我能看着图排', '有课表的话可以说一下']
  ]);

  realLog('\n== 4. 预览折叠 ==');
  await shouldCatch('卡片头点不了', [
    ['wiz', '<view class="card-head" @tap="toggleFold(gi)">', '<view class="card-head">']
  ]);
  await shouldCatch('折叠只改样式不真的移除节点', [
    ['wiz', '<view v-if="!folded(gi)">', '<view v-show="!folded(gi)">']
  ]);
  await shouldCatch('所有阶段都默认展开（长计划照样一条到底）', [
    ['wiz', 'return gi === 0 ? !!this.fold[gi] : this.fold[gi] !== false', 'return false']
  ]);
  await shouldCatch('新一轮计划不重置折叠状态', [
    ['wiz', '        if (this.plan !== s.plan) {\n          this.picked = {}\n          this.fold = {}\n        }',
      '        if (this.plan !== s.plan) {\n          this.picked = {}\n        }']
  ]);
  await shouldCatch('折叠头看不到"几个任务 · 第几天到第几天"', [
    ['wiz', '阶段 {{ gi + 1 }} · {{ group.count }} 个任务 · 第 {{ group.from }}-{{ group.to }} 天', '阶段 {{ gi + 1 }}']
  ]);

  realLog('\n== 5. 改提醒时间要立刻生效 ==');
  await shouldCatch('refresh 退回同引用赋值', [
    ['detail', '      this.g = g ? Object.assign({}, g) : null', '      this.g = g']
  ]);
  await shouldCatch('改成深拷贝整份库对象（目标改不动了）', [
    ['detail', 'Object.assign({}, g)', 'JSON.parse(JSON.stringify(g))']
  ]);

  realLog('\n== 6. 目标详情阶段折叠被拆（真机反馈：太长了，收不起来）==');
  await shouldCatch('详情页阶段头点不了', [
    ['detail', '@tap="toggleFold(gi)"', '']
  ]);
  await shouldCatch('折叠只改样式不真的移除节点', [
    ['detail', '<view v-if="!folded(gi)">', '<view v-show="!folded(gi)">']
  ]);
  await shouldCatch('缺省展开写死第一个（排期未到的阶段也糊在脸上）', [
    ['detail', "if (this.grouped[i].tasks.some(t => t.status === 'todo' && (t.day || 1) <= elapsed)) return i",
      "if (this.grouped[i].tasks.some(t => t.status === 'todo')) return i"]
  ]);
  await shouldCatch('点过还跟着 defaultOpen 走（用户刚收起的又被弹开）', [
    ['detail', 'this.fold[gi] = !this.folded(gi)', 'delete this.fold[gi]']
  ]);
  await shouldCatch('折叠头没有"N 个任务 · 第 x-y 天"摘要', [
    ['detail', "{{ $t('阶段 {n} · {c} 个任务 · 第 {a}-{b} 天', { n: gi + 1, c: group.tasks.length, a: group.from, b: group.to }) }}",
      "{{ $t('阶段 {n}', { n: gi + 1 }) }}"]
  ]);

  realLog('\n== 7. 重排页不能跟 AI 补话（真机反馈：规划好了没法再对话）==');
  await shouldCatch('补话输入框被删', [
    ['replan', 'v-model="hint"', 'v-model="hintX"']
  ]);
  await shouldCatch('补的话不进 extra（等于没补，还白问一次模型）', [
    ['replan', "const extra = hint ? ('本人补充（重排时优先考虑这句话）：' + hint) : ''", "const extra = ''"]
  ]);
  await shouldCatch('常规重排不带 extra', [
    ['replan', 'await replanGoal(g, reality, opt, extra)', 'await replanGoal(g, reality, opt)']
  ]);
  await shouldCatch('按今日记录重排不带 extra', [
    ['replan', 'await replanFromToday(g, log, reality, opt, extra)', 'await replanFromToday(g, log, reality, opt)']
  ]);
  await shouldCatch('空话也能提交（多点一次调用，结果还一样）', [
    ['replan', ':disabled="loading || !hint.trim()"', ':disabled="loading"']
  ]);
  await shouldCatch('出错态不留补话入口（用户想"换个说法再试"都没地方）', [
    ['replan', 'class="hint-input hint-err"', 'class="hint-input"']
  ]);

  restore();
  realLog('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  realExit(fail ? 1 : 0);
})();
