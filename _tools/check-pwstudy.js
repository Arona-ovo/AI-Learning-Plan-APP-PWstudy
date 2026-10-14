// check-pwstudy.js - PWstudy 新数据层冒烟测试（node 直接跑，不需要 uni 运行时）
// 用法：node _tools/check-pwstudy.js（从仓库根目录跑）
const path = require('path');
const ROOT = path.resolve(__dirname, '..', 'uniapp-PWstudy');

// ---------- UTS 插件打桩 ----------
// utils/fgsvc.js 静态 import 了 UTS 插件 '@/uni_modules/pwstudy-focus'（条件编译
// 只在 uni-app 构建时生效，Node 会照常解析这条 import）。UTS 源码 Node 跑不了，
// 这里用 resolve 钩子把它指到一个 data: URL 的 JS 桩 —— 桩里 isAvailable() 永远
// false，与"标准基座 / 非安卓"的降级行为一致，测的正是降级路径。
// （需要 Node >= 22.15 的同步钩子 registerHooks；本仓库的校验脚本都跑 22.x）
const { registerHooks } = require('node:module');
const UTS_STUB_SRC = [
  'export function startFocusService(){ return false }',
  'export function updateFocusNotification(){ return false }',
  'export function stopFocusService(){ return false }',
  'export function isAvailable(){ return false }',
  'export function bringToFront(){ return false }',
  'export function bringToFrontSupported(){ return false }'
].join('\n');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/uni_modules/pwstudy-focus') {
      return {
        url: 'data:text/javascript;base64,' + Buffer.from(UTS_STUB_SRC).toString('base64'),
        shortCircuit: true
      };
    }
    return nextResolve(specifier, context);
  }
});

// ---------- uni 桩：storage 用内存 Map ----------
const mem = new Map();
globalThis.uni = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => { mem.set(k, v); },
  removeStorageSync: (k) => { mem.delete(k); },
  $emit: () => {}, $on: () => {},
  showToast: () => {}, vibrateLong: () => {},
  getSystemInfoSync: () => ({ platform: 'devtools' })
};
globalThis.plus = undefined;   // apptime 走降级

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ ' + msg); }
}

(async () => {
  const pw = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/pwstore.js');
  const focus = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/focus.js');
  const planAgent = await import('file:///' + ROOT.replace(/\\/g, '/') + '/services/plan-agent.js');

  console.log('\n[1] pwstore 基础');
  pw.init();
  ok(pw.today().length === 10, 'today() 返回 YYYY-MM-DD');
  ok(pw.dayDiff('2026-10-09', '2026-12-08') === 60, 'dayDiff 跨月计算 = 60');

  console.log('\n[2] 规划落地与今日队列');
  const input = { title: '三个月英语上 90', raw: 'x', deadline: pw.addDays(pw.today(), 90), dailyMin: 60, level: '' };
  const rawPlan = {
    strategy: '先打底再冲刺',
    risks: ['时间紧'],
    milestones: [{ title: '打底', days: 30 }, { title: '冲刺', days: 60 }],
    tasks: [
      { title: '背完核心词', ms: 1, day: 1, pomos: 2, tags: [] },
      // day 写 999 会被夹到末天（= 今天起第 90 天）：这一条代表"计划铺到了截止日"。
      // 必须这样写 —— 排期没铺满全程的会被 normalizePlan 等比拉伸重新分布
      // （见 plan-agent.js 的"覆盖全程"），那时 day 1 的任务会被推后，本小节的
      // "今日队列"断言就失去意义了
      { title: '每日一篇阅读', ms: 9, day: 999, pomos: 2, tags: [] },
      { title: '', ms: 1, day: 3, pomos: 1 }            // 空标题 → 应被丢弃
    ]
  };
  // 真实链路：wizard 拿到的是 planGoal() 的归一化产物，addGoal 只落库
  const plan = planAgent.normalizePlan(rawPlan, input);
  const g = pw.addGoal(input, plan);
  ok(g.tasks.length === 2, '空标题任务被过滤（2 个任务）');
  ok(g.tasks[1].msId === g.milestones[1].id, '越界 milestone 夹到阶段数上限（归入第 2 阶段）');
  ok(pw.activeGoals().length === 1, 'activeGoals 1 个');
  const q = pw.todayQueue(10);
  ok(q.length === 1 && q[0].task.day === 1, '今日队列只含 day<=elapsed（第 1 天）');
  const prog = pw.goalProgress(g);
  ok(prog.total === 4 && prog.done === 0, 'goalProgress 总番茄 = 4');

  console.log('\n[3] 番茄状态机');
  // 0.02 分钟不足 1 分钟 → 自然结束但不落账（设计行为：太短的番茄不算数）
  focus.startFocus({ minutes: 0.02, taskId: g.tasks[0].id, goalId: g.id, taskTitle: '背词' });
  let cur = focus.current();
  ok(cur && cur.phase === 'focus' && cur.taskTitle === '背词', 'startFocus 进入 focus');
  await new Promise(r => setTimeout(r, 1400));
  let r = focus.tick();
  // 2026-10-14 起：专注到点**不收摊**，转「正计时」（番茄闹钟的做法：不赶人走）
  ok(r.justOverrun === true && r.justFinished === null, '到点转「正计时」→ justOverrun=true');
  cur = focus.current();
  ok(cur && cur.overrun === true && cur.phase === 'focus', '到点后 state 还在（人还在继续）');
  ok(cur && cur.remainSec === 0, '倒读数归零（环上改由 overSec 说话）');
  await new Promise(r2 => setTimeout(r2, 1100));
  const cur2 = focus.current();
  ok(cur2 && cur2.overSec >= 1, '正计时读数真的在往上走（overSec=' + (cur2 && cur2.overSec) + '）');
  ok(pw.overview().pomo === 0, '正计时期间还没落账（落账推迟到「退出」）');
  ok(focus.stopOverrun() === null && pw.overview().pomo === 0, '不足 1 分钟的番茄退出也不落账');
  ok(focus.current() === null, '按「退出」才清场');
  // 落账与任务联动用直接调用验证（真实番茄是 25 分钟，测试不等真实时长）
  pw.recordPomo({ id: 's1', goalId: g.id, taskId: g.tasks[0].id, startAt: 0, endAt: 0, min: 25, done: true });
  pw.addPomoToTask(g.id, g.tasks[0].id);
  ok(pw.overview().pomo === 1, 'recordPomo 落账（pomo=1）');
  let g2 = pw.goalOf(g.id);
  ok(g2.tasks[0].donePomos === 1, '任务 donePomos +1');
  pw.addPomoToTask(g.id, g.tasks[0].id);
  g2 = pw.goalOf(g.id);
  ok(g2.tasks[0].status === 'done', '番茄做满自动完成');

  focus.startFocus({ minutes: 5, taskTitle: 'x' });
  focus.pause();
  ok(focus.current().paused === true, 'pause 生效');
  focus.giveUp();
  ok(focus.current() === null, 'giveUp 清场');
  focus.startBreak(5);
  ok(focus.current().phase === 'rest', 'startBreak 进入休息');
  r = focus.tick();
  ok(r.justFinished === null, '休息进行中不落账');
  focus.abort();

  console.log('\n[4] plan-agent 校验器');
  const j = planAgent.extractJSON('```json\n{"a":1,}\n```');
  ok(j.a === 1, 'extractJSON 容忍围栏与尾逗号');
  // 借鉴 jsonrepair / json_repair：模型输出被截断、用单引号、带注释都得能救回来
  const cut = planAgent.extractJSON('好的：\n{"strategy":"先摸底","milestones":[{"title":"阶段一"},');
  ok(cut.strategy === '先摸底' && cut.milestones[0].title === '阶段一', 'extractJSON 能补全被截断的 JSON');
  const sq = planAgent.extractJSON("{'reply':'用单引号写的', 'enough': True,}");
  ok(sq.reply === '用单引号写的' && sq.enough === true, 'extractJSON 修单引号与 Python 常量');
  const cm = planAgent.extractJSON('```json\n{"a":1, // 说明\n "b":[1,2,]}\n```');
  ok(cm.a === 1 && cm.b.length === 2, 'extractJSON 去掉注释与数组尾逗号');
  const url = planAgent.extractJSON('{"link":"https://a.com/x?y=1","n":2}');
  ok(url.link === 'https://a.com/x?y=1', '修复不破坏字符串里的 // 与引号');
  const np = planAgent.normalizePlan({
    strategy: 's',
    milestones: [{ title: 'A' }, { title: 'B' }],
    tasks: [{ title: 't1', ms: 5, day: 999, pomos: 99 }]
  }, input);
  // ⚠️ 别断言 pomos === 8：normalizePlan 之后还有一道"假期/周末减量"（周末 ×0.8），
  // 而这里的 day:999 会被夹到第 90 天 —— 第 90 天落在周几是随"今天"漂移的。
  // （2026-10-11 跑：落点 2027-01-08 周五 → 8 保持；跨到 10-12 跑：落点 01-09 周六 → 8×0.8≈6）
  // 这条只守"夹取上界"这个本意；减量本身的正确性由下面 holiday 那组日期写死的断言守着。
  ok(np.tasks[0].ms === 2 && np.tasks[0].day <= np.totalDays &&
     np.tasks[0].pomos >= 1 && np.tasks[0].pomos <= 8,
     'normalizePlan 数值夹取（番茄上界 8；落地时还会被假期/周末再打折）');
  const tasks = [{ id: 'T1', title: 'a', day: 3, pomos: 2, status: 'todo' }, { id: 'T2', title: 'b', day: 4, pomos: 1, status: 'done' }];
  const nr = planAgent.normalizeReplan({
    summary: 'ok',
    ops: [
      { op: 'move', taskId: 'T1', day: 5, reason: '慢了' },
      { op: 'drop', taskId: 'T2' },                        // 已完成 → 丢弃
      { op: 'move', taskId: 'NOPE', day: 2 },              // 未知 id → 丢弃
      { op: 'note', text: '保持节奏' }
    ]
  }, tasks);
  // 展示序为 策略→内容→时间，故 note(策略) 排在 move(时间) 之前
  ok(nr.ops.length === 2 && nr.ops[0].op === 'note' && nr.ops[1].op === 'move', 'normalizeReplan 非法 op 被丢弃');

  console.log('\n[5] 每日统计 / AppDock');
  pw.dockAdd('com.a', 'AppA', 'study');
  pw.addAppMinutes(pw.today(), 'com.a', 12);
  pw.addAppMinutes(pw.today(), 'com.unknown', 5);   // 未登记的也要能记（前台计时已过滤，这里直接进 byApp）
  pw.setAppMinutes(pw.today(), { 'com.a': 20 });
  const st = pw.get();
  ok(st.daily[pw.today()].byApp['com.a'] === 20, 'setAppMinutes 覆盖 dock 内的包');
  ok(st.daily[pw.today()].byApp['com.unknown'] === 5, 'setAppMinutes 不动未登记的包');
  ok(pw.overview().todayMin === 25, 'overview 今日分钟来自番茄落账');

  console.log('\n[6] 重排三档优先级（策略 > 内容 > 时间）');
  const lvTasks = [
    { id: 'A', title: 'a', day: 3, pomos: 2, status: 'todo' },
    { id: 'B', title: 'b', day: 4, pomos: 2, status: 'todo' },
    { id: 'C', title: 'c', day: 5, pomos: 1, status: 'todo' }
  ];
  const lv = planAgent.normalizeReplan({
    summary: 'ok',
    ops: [
      { op: 'move', taskId: 'A', day: 9, level: 'time', reason: '顺延' },
      { op: 'resize', taskId: 'B', pomos: 4, reason: '加量' },        // 未给 level → content
      { op: 'note', text: '换个学法' }                                 // note → strategy
    ]
  }, lvTasks);
  ok(lv.ops.length === 3, '三条 op 都保留');
  ok(lv.ops[0].level === 'strategy' && lv.ops[1].level === 'content' && lv.ops[2].level === 'time',
    '按 策略→内容→时间 排序');
  ok(lv.ops[2].op === 'move' && lv.ops[2].level === 'time', '时间档兜在最后');

  console.log('\n[7] 规划后台任务（未配置 AI 时的人话报错）');
  const task = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/plan-task.js');
  task.reset();
  ok(task.snapshot().stage === 'idle', '初始 idle');
  task.startSession({ title: '专升本英语 90 分', raw: '', deadline: pw.addDays(pw.today(), 90), dailyMin: 60, level: '' });
  ok(task.snapshot().stage === 'ask' && task.snapshot().seed.dailyMin === 60, '起会话 → ask');
  await task.send('我想三个月提到 90 分');
  const snap = task.snapshot();
  ok(snap.messages.length === 1 && snap.messages[0].role === 'user', '用户消息已入会话');
  ok(!!snap.error && /AI 服务/.test(snap.error), '未配置 AI 时给出人话错误：' + snap.error);
  task.pause();
  ok(task.snapshot().paused === true, 'pause 生效');
  task.setSeed({ dailyMin: 90 });
  ok(task.snapshot().seed.dailyMin === 90, 'setSeed 可改会话输入');
  task.reset();
  ok(task.snapshot().stage === 'idle', 'reset 回到 idle');

  console.log('\n[8] 出厂默认值');
  const settingsMod = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/settings.js');
  settingsMod.init();
  const stg = settingsMod.get();
  // 红色调为主 + 红只做小面积点缀：主色玫红（启动页同款）、大按钮是淡红底+深红字；
  // 背景暖砂（避开粉白渐变，那是"像经期 App"的另一半根源）
  ok(stg.theme.accent === 'rose', '默认主题色 = 玫红');
  ok(stg.theme.background === 'sand', '默认背景 = 暖砂渐变');
  ok(stg.profile.nickname === 'plana', '默认昵称 = plana');

  console.log('\n[9] 节假日感知（国务院 2026 年安排）');
  const hol = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/holiday.js');
  ok(hol.dayType('2026-10-03') === 'holiday', '国庆期间判定为假期');
  ok(hol.holidayName('2026-10-03') === '国庆', '假期名 = 国庆');
  ok(hol.dayType('2026-10-10') === 'makeup', '10/10 调休补班 → 当工作日');
  ok(hol.dayType('2026-02-14') === 'makeup', '2/14 春节前补班 → 当工作日');
  ok(hol.dayType('2026-02-20') === 'holiday', '春节连休中间也算假期');
  ok(hol.factorOf('2026-10-03') === 0.5 && hol.factorOf('2026-10-10') === 1, '假期半量 / 补班不减');
  ok(/国庆/.test(hol.summaryFor('2026-09-28', '2026-10-08')), 'prompt 摘要里带国庆');
  const hp = planAgent.normalizePlan({
    strategy: 's',
    milestones: [{ title: 'A' }],
    tasks: [
      { title: '假期里的任务', ms: 1, day: 5, pomos: 4 },   // 2026-10-02 国庆
      { title: '普通工作日任务', ms: 1, day: 16, pomos: 4 }, // 2026-10-13 周二
      { title: '周末任务', ms: 1, day: 20, pomos: 4 },        // 2026-10-17 周六
      // 同上：day 会被夹到末天。没有这条兜底任务时 normalizePlan 会把整份排期
      // 等比拉伸铺满全程，上面三条的日期就全挪走了，假期 / 周末判断跟着失真
      { title: '收尾模考', ms: 1, day: 999, pomos: 4 }
    ]
  }, { title: 't', deadline: hol.addDays('2026-09-28', 40), dailyMin: 60, startDate: '2026-09-28' });
  ok(hp.tasks[0].pomos === 2 && hp.tasks[0].light === '国庆', '撞假期的任务自动减半');
  ok(hp.tasks[1].pomos === 4 && !hp.tasks[1].light, '普通工作日任务不动');
  ok(hp.tasks[2].pomos === 3, '周末任务打八折（4 → 3）');
  ok(hp.risks.some(r => /假期/.test(r)), '风险里说明了自动减量');

  console.log('\n[10] 统计口径与出厂开关');
  const st2 = pw.get();
  const h0 = st2.daily[pw.today()].byHour || {};
  ok(Object.keys(h0).length > 0, '番茄按小时落账（时段分布有数据）');
  ok(pw.hourProfile(7).length === 24, 'hourProfile 返回 24 个时段');
  const fc = pw.forecast(pw.activeGoals()[0], 7);
  ok(typeof fc.ok === 'boolean', 'forecast 返回结构化结果（ok=' + fc.ok + '）');
  ok(stg.focus && stg.focus.strict === false && stg.focus.notify === true,
    '出厂默认：严格模式关、通知开');
  ok(stg.focus && stg.focus.wakeLock === false, '息屏保活默认关（省电优先）');

  console.log('\n[11] 联动接口与模板库');
  const link = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/link.js');
  const back = link.parse('pwstudy://vocab-done?min=25&words=30');
  ok(back && back.kind === 'vocab-done' && back.params.min === '25', '解析回跳链接');
  const goalLink = link.parse('pwstudy://goal/G1?task=T2');
  ok(goalLink.goalId === 'G1' && goalLink.taskId === 'T2', '解析目标直达链接');
  ok(link.parse('awword://study?x=1') === null, '不是本 App 的 scheme 直接忽略');
  ok(/^awword:\/\/study\?minutes=25/.test(link.toPartner({ id: 'T1' }, 25)), '生成呼起背单词 App 的链接');
  ok(link.recordExternal(20, { words: 10 }) === true, '外部回报时长落账');
  const tpl = await import('file:///' + ROOT.replace(/\\/g, '/') + '/data/goal-templates.js');
  ok(tpl.TEMPLATES.length >= 5, '内置 ' + tpl.TEMPLATES.length + ' 个目标模板');
  const seed = tpl.seedOf(tpl.TEMPLATES[0], pw.today());
  ok(!!seed.title && seed.dailyMin > 0 && seed.spanDays > 0, '模板能生成规划输入');

  console.log('\n[12] 权限与后台保活清单');
  const setup = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/setup.js');
  ok(setup.ITEMS.length === 5, '五项设置清单（含"无障碍"）');
  ok(setup.ITEMS.some(x => x.key === 'a11y'), '清单里有 a11y —— 强制模式的能力前提');
  // must 允许写成函数（随设置变化）：求值只在 setup 内部做，对外一律是布尔
  const su = setup.status();
  ok(su.length === setup.ITEMS.length && su.every(x => typeof x.ok === 'boolean'), 'status() 每项都有实测结果');
  ok(su.every(x => typeof x.must === 'boolean'), 'status() 的 must 已求值成布尔（不外泄函数）');
  // 默认没开强制模式 → 无障碍不是必办（不该去烦不用它的人）；开了才必办
  ok(su.filter(x => x.must).length === 3, '默认三项必办（通知 / 使用情况 / 电池）');
  ok(su.filter(x => x.key === 'a11y')[0].must === false, '没开强制模式时无障碍是"可选"');
  const suSettings = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/settings.js');
  const suFocusBefore = suSettings.get().focus || {};
  suSettings.set({ focus: Object.assign({}, suFocusBefore, { forced: true }) });
  ok(setup.status().filter(x => x.key === 'a11y')[0].must === true, '开了强制模式 → 无障碍变成必办');
  suSettings.set({ focus: Object.assign({}, suFocusBefore, { forced: false }) });
  // 桩环境不是安卓：整套清单不适用，不该拿去提醒用户
  ok(setup.applicable() === false, '非安卓平台清单不适用');
  ok(setup.pending().length === 0, '非安卓不产生待办项');
  ok(setup.shouldPrompt() === false, '非安卓不弹首次提醒');
  setup.skip();
  setup.markDone('battery');
  ok(setup.status().filter(x => x.key === 'battery')[0].ok === true, '电池项可手动标记完成');
  // 假装是安卓：必办项应重新出现（电池已手动标记，通知在 API33 以下恒 true → 剩"使用情况"）
  const realSys = globalThis.uni.getSystemInfoSync;
  globalThis.uni.getSystemInfoSync = () => ({ platform: 'android' });
  ok(setup.applicable() === true, '安卓平台清单生效');
  ok(setup.pending().length === 1, '安卓上必办项 = 使用情况访问');
  ok(setup.fixItem('a11y') !== undefined, '无障碍项可通过 fixItem 跳设置页（标准基座下返回 false 也算走通）');
  globalThis.uni.getSystemInfoSync = realSys;

  console.log('\n[13] 状态栏 / 安全区尺寸');
  const insets = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/insets.js');
  // 桩环境：platform = devtools，不是 immersive → 应当返回 0（不能凭空留白边）
  ok(insets.statusBar() === 0, '非沉浸式 → 状态栏高度 0（不多留白边）');
  ok(insets.safeBottom() === 0, '安全区底部 0');
  insets.reset();
  ok(insets.statusBar() === 0, 'reset 后重算结果一致');
  const theme = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/theme.js');
  const rs = theme.rootStyle();
  ok(rs['--status-bar-height'] === '0px', 'rootStyle 下发 --status-bar-height');
  ok(rs['--safe-bottom'] === '0px', 'rootStyle 下发 --safe-bottom');

  console.log('\n[14] 应用列表读取（模拟 plus.android 桥）');
  // 真机"搜不到本机应用"的根因：PackageInfo / ResolveInfo 上只有公开字段
  // （packageName / activityInfo），没有 getPackageName() 这类 getter，
  // 旧代码一调用就抛，整条路被 catch 掉 → 列表恒空。这里用假桥验证新实现取得到。
  const realPlus = globalThis.plus;
  const realSys2 = globalThis.uni.getSystemInfoSync;
  globalThis.uni.getSystemInfoSync = () => ({ platform: 'android' });
  const fakeApps = [
    { packageName: 'com.study.vocab', flags: 0 },
    { packageName: 'com.android.systemui', flags: 1 },   // 系统应用 → 应被跳过
    { packageName: 'com.study.quiz', flags: 0 }
  ];
  globalThis.plus = {
    android: {
      importClass: (x) => x,
      runtimeMainActivity: () => ({
        // 与 manifest 的 packagename 保持一致（实测打出来的就是这个）
        getPackageName: () => 'com.PWstudy',
        getSystemService: () => null,     // 没授权"使用情况访问" → 走不到路 3
        getPackageManager: () => ({
          getInstalledApplications: () => ({
            size: () => fakeApps.length,
            get: (i) => fakeApps[i]
          }),
          getApplicationLabel: (info) => 'App:' + info.packageName
        })
      }),
      // 公开字段：plus 桥上只有 getAttribute / plusGetAttribute 能读到
      getAttribute: (obj, name) => (obj ? obj[name] : undefined)
    }
  };
  const at = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/apptime.js');
  const list = at.installedApps();
  ok(list.length === 2, '读到 2 个非系统应用（系统应用被跳过）');
  ok(list.some(x => x.pkg === 'com.study.vocab'), '包名取自公开字段 packageName');
  ok(list.some(x => x.name === 'App:com.study.quiz'), '应用名走 getApplicationLabel');
  ok(!list.some(x => x.pkg === 'com.android.systemui'), 'FLAG_SYSTEM 应用不进候选');
  globalThis.plus = realPlus;
  globalThis.uni.getSystemInfoSync = realSys2;

  console.log('\n[15] 今日收工：计划 vs 实际 → 触发 AI 重排');
  const dailylog = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/dailylog.js');
  // 造一个自己的目标，免得受前面用例的任务状态影响
  const in2 = { title: '收工测试目标', raw: 'x', deadline: pw.addDays(pw.today(), 30), dailyMin: 60, level: '' };
  const p2 = planAgent.normalizePlan({
    strategy: 's', risks: [], milestones: [{ title: 'a', days: 30 }],
    tasks: [
      { title: '今天该做的任务', ms: 1, day: 1, pomos: 2 },
      // day 5：落在"未来 7 天内"，才会进"提前做了"候选（day 9 太远，收工表不列）
      { title: '后面才做的任务', ms: 1, day: 5, pomos: 1 },
      // 压住 stretching：排期必须铺到截止日，否则 normalizePlan 会等比拉伸，
      // 上面两条的 day 会被重算（今天该做的那条就跑到后面去了）
      { title: '收尾复盘', ms: 1, day: 999, pomos: 1 }
    ]
  }, in2);
  const dg = pw.addGoal(in2, p2);

  const draft = dailylog.buildDraft();
  const mine = draft.items.filter(i => i.goalId === dg.id);
  ok(mine.length === 1, '今天该做的任务进入收工表');
  ok(draft.ahead.some(i => i.taskId === dg.tasks[1].id), '后面几天的任务进入"提前做了"候选');
  // "按实际番茄数填"的复位基准：必须是真实记录的 donePomos，不能是计划值。
  // 以前的一键"全部按计划完成"直接把 actual 拉到 planned —— 番茄没跑也算完成，
  // 后面几天的日程会从这个谎开始全错。
  ok(draft.items.every(i => typeof i.done === 'number'), '草稿每项带真实番茄数 done');
  ok(draft.items.every(i => i.actual <= i.done), '预填不会超过真实记录（没跑就是 0）');
  ok(draft.items.every(i => i.actual <= Math.max(1, i.planned)), '预填不会超过计划值');

  const flat = (items, ahead, extras) => dailylog.driftOf({ items, ahead: ahead || [], extras: extras || '' });
  const full = mine.map(i => Object.assign({}, i, { actual: i.planned }));
  ok(flat(full, [], '') === false, '完全按计划完成 → 不算偏差');
  ok(flat(full.map(i => Object.assign({}, i, { actual: 0 })), [], '') === true, '有一项没做 → 算偏差');
  ok(flat(full, [{ taskId: 'x', actual: 1 }], '') === true, '提前做了后面的 → 算偏差');
  ok(flat(full, [], '临时刷了 30 道题') === true, '做了计划外的 → 算偏差');

  const log = dailylog.save(Object.assign({}, draft, {
    items: mine.map(i => Object.assign({}, i, { actual: 0 })),
    ahead: [], extras: '临时刷了 30 道阅读题', mood: 'tired', note: ''
  }));
  ok(log.drift === true, '落库的 log 带 drift 标记');
  ok(!!pw.get().daily[pw.today()].log, '收工记录落在 daily[今天].log（跟着备份走）');
  ok(dailylog.doneToday() === true, 'doneToday() 为真');
  ok(dailylog.driftText(log).indexOf('没做完') >= 0, '偏差文案说明有几项没做完');

  const sum = dailylog.summaryFor(log);
  ok(/计划 vs 实际/.test(sum), '给 AI 的摘要以"计划 vs 实际"开头');
  ok(/完全没做/.test(sum), '摘要标出哪项没做');
  ok(/计划之外还做了：临时刷了 30 道阅读题/.test(sum), '摘要带上计划外的内容');
  ok(/今天状态：有点累/.test(sum), '摘要带上今天状态（让 AI 区分"太重"和"今天不行"）');
  ok(typeof planAgent.replanFromToday === 'function', 'plan-agent 导出 replanFromToday');
  ok(typeof planAgent.replanGoal === 'function', '原有的 replanGoal 仍在（老入口没被顶掉）');

  // 填报"提前做了后面的任务"要真的把进度记上去，否则 AI 会让他重做一遍
  const aheadTask = dg.tasks.filter(t => t.day === 5)[0];
  ok((aheadTask.donePomos || 0) === 0, '没填报时后面那项还是 0 番茄');
  dailylog.save(Object.assign({}, dailylog.buildDraft(), {
    items: [],
    ahead: [{ goalId: dg.id, taskId: aheadTask.id, title: aheadTask.title, goalTitle: dg.title, day: 5, planned: 1, actual: 1 }],
    extras: '', mood: '', note: ''
  }));
  ok(aheadTask.donePomos === 1, '填报后进度回填到任务上');
  ok(aheadTask.status === 'done', '做满即自动完成');

  console.log('\n[16] 首页对话：一句话说完 → AI 提炼事实 → 写回收工记录');
  const coach = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/coach.js');
  const today = pw.today();

  ok(Array.isArray(coach.CHIPS) && coach.CHIPS.length > 0, 'coach 提供快捷短语');
  ok(coach.messages(today).length === 0, '新的一天没有对话');

  coach.push(today, 'user', '今天背单词一个没做，跑去刷了两篇阅读');
  coach.push(today, 'assistant', '听起来今天是换了内容…');
  ok(coach.messages(today).length === 2, '对话按天存（两条）');
  ok(!!pw.get().daily[today].coach, '对话落在 daily[今天].coach（跟着备份走）');

  const cctx = coach.context(today);
  ok(typeof cctx.text === 'string' && cctx.text.length > 0, '给 AI 的底稿非空');
  ok(/今天计划要做的/.test(cctx.text), '底稿带上今天该做的事');
  ok(/近 7 天每天专注分钟/.test(cctx.text), '底稿带上近 7 天真实投入');
  ok(Array.isArray(cctx.goalIds), '底稿带目标 id 列表（AI 才能指认是哪个目标）');
  ok(Array.isArray(cctx.taskIds) && cctx.taskIds.length > 0, '底稿带可记功的任务 id（AI 才能指认做了哪个）');
  ok(/可记功的任务/.test(cctx.text), '底稿把任务 id 与标题一起给模型');

  // 归一化：AI 给什么都要能落地，非法 goalId 必须置空
  const c1 = planAgent.normalizeChat(
    { reply: '行，那明天先补背单词', facts: ['背单词 0 个番茄', '刷了 2 篇阅读'], drift: true, goalId: dg.id },
    cctx.goalIds
  );
  ok(c1.drift === true && c1.facts.length === 2, 'AI 判定有出入 → drift + 事实都留下');
  ok(c1.goalId === dg.id, '目标 id 在给定列表里 → 保留');
  const c2 = planAgent.normalizeChat({ reply: '', facts: [], drift: false, goalId: '不存在的id' }, cctx.goalIds);
  ok(c2.goalId === '', '目标 id 不在列表里 → 置空');
  ok(c2.reply.length > 0, 'AI 没给回复时有兜底文案（不会显示空白气泡）');
  const c3 = planAgent.normalizeChat({ reply: '按计划走完了', facts: [], drift: false }, cctx.goalIds);
  ok(c3.drift === false, '照计划完成 → 不算偏差（不该惊动重排）');

  // 事实写回收工记录：后面 replan?from=log 读的就是这一份。
  // 走独立的 facts 字段而不是 extras —— extras 是"计划外做了什么"（手填），
  // 混在一起会让 AI 把"我把第 3 天的阅读做完了"误读成计划外的事。
  const before = (dailylog.logOf(today) || {}).extras || '';
  coach.applyFacts(today, c1.facts);
  const lg1 = dailylog.logOf(today);
  ok((lg1.facts || []).indexOf('刷了 2 篇阅读') >= 0, 'AI 提炼的事实写进 log.facts');
  ok(!lg1.extras && !before, '事实不再混进 extras（那条留给"计划外做了什么"）');
  coach.applyFacts(today, ['又补了一句']);
  const lg2 = dailylog.logOf(today);
  ok((lg2.facts || []).length === 3, '第二次补记是追加，不是覆盖');
  ok(dailylog.driftOf({ items: [], ahead: [], extras: '', facts: ['我把第 3 天的阅读做完了'] }) === false,
    '对话事实本身不算偏差（按计划汇报不该逼用户去重排）');
  ok(dailylog.driftOf({ items: [], ahead: [], extras: '临时刷了 30 道题', facts: [] }) === true,
    '手填的"计划外做了什么"仍然算偏差');
  ok(dailylog.summaryFor(lg2).indexOf('刷了 2 篇阅读') >= 0, '重排给 AI 看的底稿仍带上对话事实');
  coach.setDrift(today, true);
  ok(coach.driftToday(today) === true, 'AI 判定有出入 → driftToday 为真（首页才显示重排入口）');

  // 记功：AI 指认的任务 id 必须真在清单里，编造的 id 一律不记
  const tid = cctx.taskIds[0];
  ok(planAgent.normalizeChat({ reply: 'x', credits: [{ taskId: '假id', add: 3 }] }, [], cctx.taskIds).credits.length === 0,
    '编造的任务 id 不记功');
  ok(planAgent.normalizeChat({ reply: 'x', credits: [{ taskId: tid, add: 99 }] }, [], cctx.taskIds).credits[0].add === 8,
    '记功数量夹到 1-8');
  const creditTask = (() => {
    const gs = pw.get().goals;
    for (let k = 0; k < gs.length; k++) {
      const t = (gs[k].tasks || []).filter(x => x.id === tid)[0];
      if (t) return t;
    }
    return null;
  })();
  const wasDone = (creditTask && creditTask.donePomos) || 0;
  coach.applyCredits([{ taskId: tid, add: 2 }]);
  ok((creditTask.donePomos || 0) >= wasDone + 1, '说做完了 → 番茄真记到任务上');
  coach.applyCredits([{ taskId: tid, add: 0 }]);
  ok((creditTask.donePomos || 0) >= wasDone + 1, '记功只增不减（传 0 不会把进度抹掉）');

  coach.setDrift(today, true);
  ok(coach.driftFlag(today) === true, 'driftFlag 落库后可读回（首页据此显示重排入口）');
  ok(!!pw.goalOf(coach.targetGoalId(today)), '重排目标 id 指向一个真实存在的目标');

  coach.clear(today);
  ok(coach.messages(today).length === 0, '清空只清对话');
  ok(!!dailylog.logOf(today), '清空对话不影响收工记录');

  // ---------- 强制模式 ----------
  console.log('\n[17] 强制模式：默认关，只在专注中盯着前台');
  const forced = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/forced.js');
  forced.sync();
  ok(forced.enabled() === false, '出厂默认关（enabled=false）');
  ok(forced.armed() === false, '没计时时不轮询（armed=false）');

  // 开了强制模式但没有在跑番茄 → 依然不该动
  try {
    const st = settingsMod.get();
    st.focus = Object.assign({}, st.focus || {}, { forced: true });
    settingsMod.save();
  } catch (e) {}
  ok(forced.enabled() === true, '开关打开后 enabled=true');
  forced.sync();
  ok(forced.armed() === false, '空闲态：开了也不轮询');

  // 专注中 → 上弦
  focus.startFocus({ minutes: 5, taskTitle: '强制模式测试' });
  forced.sync();
  ok(forced.armed() === true, '专注进行中 → 上弦');

  // 暂停 → 立刻松手（暂停就是用户主动说"我不学了/歇会儿"，不该继续拽）
  focus.pause();
  forced.sync();
  ok(forced.armed() === false, '暂停后立刻停监视');
  focus.resume();
  forced.sync();
  ok(forced.armed() === true, '恢复后重新上弦');

  // 休息阶段不拦
  focus.giveUp();
  focus.startBreak(5);
  forced.sync();
  ok(forced.armed() === false, '休息阶段不拦（休息就该休息）');

  // 收工：计时没了 → 监视器必须彻底停下来（不留轮询定时器）
  focus.giveUp();
  forced.sync();
  ok(forced.armed() === false, '番茄结束后监视器收手');
  ok(forced.escapesOf() === 0, '一轮结束后跑偏计数归零');

  // 降级：没有原生拉回能力时如实说，不假装锁得住
  ok(forced.canPull() === false, '标准基座下 canPull=false（如实降级）');
  ok(at.bringSelfFront() === false, '非安卓 / 无桥接时 bringSelfFront 安全返回 false');
  ok(forced.nativeActive() === false, '没有原生看门狗时 nativeActive=false → JS 兜底轮询接手');
  ok(typeof forced.maxEscapes() === 'number' && forced.maxEscapes() >= 2, 'maxEscapes 暴露出去（页面别写死 "3"）');

  // 能力盘点：界面靠它决定"该提示用户去开哪一项"，不能只有一句 canPull
  const cap = forced.capability();
  ok(cap && typeof cap.native === 'boolean' && typeof cap.a11y === 'boolean', 'capability() 给出四层能力明细');
  ok(cap.canDetect === (cap.a11y || cap.usage), 'canDetect = 无障碍 或 使用情况访问（两条"眼睛"任一条即可）');
  ok(cap.effective === (cap.native && (cap.a11y || cap.overlay) && (cap.a11y || cap.usage)),
    'effective = 看得见 + 拉得动（标准基座下必为 false）');
  ok(cap.effective === false, '桩环境没有原生桥 → 不谎报"拦得住"');
  // 无障碍的三条桥在非安卓下必须安全降级（不能抛，也不能谎报 true）
  ok(at.hasA11yPermission() === false, '非安卓 hasA11yPermission=false（如实降级）');
  ok(at.a11ySupported() === false, '非安卓 a11ySupported=false');
  ok(at.a11yStats() && at.a11yStats().on === false && at.a11yStats().events === 0, '非安卓 a11yStats 返回空战绩');
  ok(at.openA11ySettings() === false, '非安卓 openA11ySettings 安全返回 false');
  at.refreshA11y();
  ok(at.hasA11yPermission() === false, 'refreshA11y 后仍为 false（不因缓存清空而误报）');

  // 白名单口径：原生看门狗按 allowList() 放行，JS 判定走 isAllowedPkg()。
  // 两边一旦不一致，就会"原生把人拽回来、JS 又说没跑偏"（或者反过来漏放行）。
  const oldDock = pw.dock().slice();
  pw.get().dock = [];
  pw.dockAdd('com.demo.study', '刷题软件', 'study', '');
  pw.dockAdd('com.demo.video', '短视频', 'rest', '');
  const allow = at.allowList();
  ok(allow.indexOf('com.demo.study') >= 0, 'allowList 收「学习」用途的 App（原生按它放行）');
  ok(allow.indexOf('com.demo.video') < 0, 'allowList 不收「休息」用途的 App（专注期间去刷手机就是跑偏）');
  ok(allow.filter(p => p === 'com.demo.study').length === 1, 'allowList 去重（同一个包不漏也不重）');
  ok(at.isAllowedPkg('com.demo.study') === true && at.isAllowedPkg('com.demo.video') === false,
    '两套判定同口径：isAllowedPkg 与 allowList 一致');
  ok(at.isAllowedPkg('com.some.unknown.app') === false, '没登记过的 App 算跑偏');
  ok(at.isAllowedPkg('com.miui.home') === true && at.isAllowedPkg('com.huawei.android.launcher') === true,
    '国产桌面在名单里（强制模式的遮罩不会把用户锁在屏幕外）');
  // 收尾：还原 dock，别影响后面的用例
  pw.get().dock = oldDock;
  pw.touch();

  // 收尾：把强制模式关回去，别污染同一进程里后面的用例
  try {
    const st = settingsMod.get();
    st.focus = Object.assign({}, st.focus || {}, { forced: false });
    settingsMod.save();
  } catch (e) {}

  // ---------- 看板娘表情调度 ----------
  console.log('\n[18] mascot：状态决定表情（多邻国式）');
  const mascot = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/mascot.js');
  const MORNING = new Date('2026-10-10T09:00:00');
  const NOON = new Date('2026-10-10T14:00:00');
  const NIGHT = new Date('2026-10-10T20:00:00');
  const DAY = 86400000;
  const setPomo = (n) => {
    const st = pw.get();
    const d = st.daily[pw.today()];
    if (d) { d.pomo = n; d.focusMin = n * 25; }
    pw.touch();
  };
  // 清场：归档前面用例的目标 + 清空今日番茄，表情测试需要受控状态
  pw.activeGoals().forEach(g => pw.archiveGoal(g.id));
  setPomo(0);

  // 0. 没目标 → 默认脸
  ok(mascot.pick(MORNING).key === 'plana', '没有进行中的目标 → plana 默认脸');

  // 截止日迫近（≤3 天）且没做完 → 震惊
  const mU = pw.addGoal(
    { title: '临期目标', raw: 'x', deadline: pw.addDays(pw.today(), 2), dailyMin: 30, level: '' },
    { strategy: '', risks: [], milestones: [{ title: 'm', days: 3 }], tasks: [{ title: '冲刺', ms: 1, day: 1, pomos: 2 }] }
  );
  ok(mascot.pick(MORNING).key === 'shock', '截止日剩 2 天且没做完 → shock');

  // 已过期还有活 → 委屈（优先级高于 shock）
  pw.goalOf(mU.id).deadline = pw.addDays(pw.today(), -1);
  pw.touch();
  ok(mascot.pick(MORNING).key === 'sad', '截止日已过还有任务 → sad');

  // 摆烂：目标立了 ≥4 天 + 连续 4 天没番茄 → 生气
  pw.removeGoal(mU.id);
  const mAngry = pw.addGoal(
    { title: '老目标', raw: 'x', deadline: pw.addDays(pw.today(), 90), dailyMin: 30, level: '' },
    { strategy: '', risks: [], milestones: [{ title: 'm', days: 30 }], tasks: [{ title: '日常', ms: 1, day: 1, pomos: 2 }] }
  );
  pw.goalOf(mAngry.id).createdAt = Date.now() - 6 * DAY;
  pw.touch();
  ok(mascot.pick(MORNING).key === 'angry', '立了 6 天 + 连续没学 → angry');

  // 摆烂 2-3 天 → 委屈
  pw.goalOf(mAngry.id).createdAt = Date.now() - 3 * DAY;
  pw.touch();
  ok(mascot.pick(MORNING).key === 'sad', '立了 3 天 + 连续没学 → sad');

  // 新目标（当天立）当天没学 → 不翻旧账，按时段给脸
  pw.removeGoal(mAngry.id);
  const mNew = pw.addGoal(
    { title: '今天刚立', raw: 'x', deadline: pw.addDays(pw.today(), 30), dailyMin: 30, level: '' },
    { strategy: '', risks: [], milestones: [{ title: 'm', days: 30 }], tasks: [{ title: 'day1', ms: 1, day: 1, pomos: 2 }] }
  );
  ok(mascot.pick(MORNING).key === 'calm', '当天没学 + 上午 → calm（不翻旧账）');
  ok(mascot.pick(NOON).key === 'nervous', '当天没学 + 下午 → nervous');
  ok(mascot.pick(NIGHT).key === 'sad', '当天没学 + 晚上 → sad');

  // 做了一部分 → 平静 / 紧张（超期多则紧张）
  const mst = pw.get();
  mst.daily[pw.today()].pomo = 1;   // 有在学：跳过摆烂判定
  pw.touch();
  pw.setTaskStatus(mNew.id, mNew.tasks[0].id, 'done');
  ok(mascot.pick(MORNING).key === 'happy', '今天全部做完 → happy');

  // 连续 3 天都有番茄 → 得意吐舌
  for (let i = 1; i <= 3; i++) {
    const key = pw.addDays(pw.today(), -i);
    if (!st.daily[key]) st.daily[key] = { focusMin: 0, pomo: 0, byApp: {}, byHour: {} };
    st.daily[key].pomo = 20;
  }
  pw.touch();
  ok(mascot.pick(MORNING).key === 'tongue', '连续 3 天学习 + 今天全做完 → tongue');

  // 部分完成且超期堆积 → 紧张（规则 6）
  pw.archiveGoal(mNew.id);   // 归档上一个目标，别混进统计
  const mPart = pw.addGoal(
    { title: '拖了几天', raw: 'x', deadline: pw.addDays(pw.today(), 90), dailyMin: 30, level: '' },
    { strategy: '', risks: [], milestones: [{ title: 'm', days: 30 }],
      tasks: [
        { title: 'a', ms: 1, day: 1, pomos: 1 },
        { title: 'b', ms: 1, day: 1, pomos: 1 },
        { title: 'c', ms: 1, day: 1, pomos: 1 }
      ] }
  );
  pw.goalOf(mPart.id).createdAt = Date.now() - 4 * DAY;   // day1 全部变超期
  pw.setTaskStatus(mPart.id, mPart.tasks[0].id, 'done');   // 1 完成 2 超期没做
  pw.touch();
  ok(mascot.pick(MORNING).key === 'nervous', '超期比剩下的多 → nervous');

  // 表情图都真实存在
  const fs = require('fs');
  Object.keys(mascot.FACES).forEach(k => {
    const p = 'uniapp-PWstudy' + mascot.FACES[k];
    ok(fs.existsSync(p), '表情图存在 ' + mascot.FACES[k]);
  });

  // ==================================================================
  console.log('\n[19] 清除学习数据（pwreset）：清的是 PWstudy 自己的库');
  const pwreset = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/pwreset.js');
  const planTask = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/plan-task.js');
  const guide = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/task-guide.js');
  const aiCache = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/ai-cache.js');

  // 造一点"脏"现场：正在跑的番茄 + 规划会话 + AI 缓存
  focus.setCfg({ focus: 40, rest: 8 });          // 偏好：清数据不该被打回 25/5
  focus.startFocus({ minutes: 25, taskId: 't1', goalId: 'g1', taskTitle: '清数据测试' });
  planTask.startSession({ title: '待清的规划会话' });
  aiCache.rememberWord({ word: 'wipe', pos: 'v.', meaning: '清除' });

  ok(focus.current() !== null, '清之前确实有番茄在跑');
  ok(planTask.snapshot().stage === 'ask', '清之前规划会话处于 ask');
  ok(aiCache.stats().words > 0, '清之前 AI 缓存里有词条');

  const gone = pwreset.clearAll();
  ok(gone.running === true, 'clearAll 报告"刚才有番茄在跑"');
  ok(gone.goals > 0 && gone.sessions > 0 && gone.days > 0, 'clearAll 汇报清掉的量（目标/番茄/天数）');
  ok(focus.current() === null, '进行中的番茄被停掉（不落账）');
  ok(pw.get().runtime === null, 'runtime 现场已清（focus 不会把现场写回来）');
  ok(pw.get().goals.length === 0, 'goals 已空');
  ok(pw.get().sessions.length === 0, 'sessions 已空');
  ok(Object.keys(pw.get().daily).length === 0, 'daily 已空');
  ok(pw.get().dock.length === 0, 'dock 已空');

  // 偏好不跟着清：番茄时长是设置，不是学习数据
  ok(pw.get().pomoCfg && pw.get().pomoCfg.focus === 40, 'pomoCfg 保留（偏好不属于学习数据）');
  const cfgNow = (await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/settings.js')).get();
  ok(cfgNow && cfgNow.focus && cfgNow.focus.notify === true, 'settings.js（AI 配置/外观）没被清');

  ok(planTask.snapshot().stage === 'idle', '规划会话回到 idle');
  ok(aiCache.stats().words === 0, 'AI 缓存已清');
  ok(mem.get('fj_pw_data_v1') && mem.get('fj_pw_data_v1').goals.length === 0, 'storage 里也真的写空了');
  ok(!mem.has('fj_eng_state_v1'), '老 App 的 fj_eng_state_v1 全程没被碰过');

  // 空库再清一次：不该报错，汇报"本来就没有"
  const gone2 = pwreset.clearAll();
  ok(gone2.goals === 0 && gone2.running === false, '空库再清一次不出错');
  ok(pwreset.summary(gone2).indexOf('本来就没有') >= 0, '空库汇报"本来就没有学习数据"');
  ok(pwreset.summary(gone).indexOf('已清除') === 0, '有数据时汇报"已清除 …"');

  // 清完之后还能正常继续用（不是把模块搞成死状态）
  const gAfter = pw.addGoal(
    { title: '清完再立一个', raw: 'x', deadline: pw.addDays(pw.today(), 30), dailyMin: 30, level: '' },
    { strategy: '', risks: [], milestones: [{ title: 'm', days: 30 }], tasks: [{ title: 't', ms: 1, day: 1, pomos: 1 }] }
  );
  ok(pw.activeGoals().length === 1 && gAfter.tasks.length === 1, '清完之后还能正常立目标');
  ok(typeof guide.get === 'function', 'task-guide 接口仍在（清缓存没把它搞坏）');

  console.log('\n[20] 番茄结算口径（2026-10-11 三处修复的回归）');
  // 真实番茄是几十分钟，测试不可能真等 —— 临时把 Date.now 往前拨。
  // focus 全程用 endAt 差值算时间，拨表等价于"时间过去了"。
  // 放在最后跑：它会真落账，挪到前面会污染 [5] 的今日分钟断言。
  const realNow = Date.now;
  let off = 0;
  Date.now = function () { return realNow.call(Date) + off; };
  try {
    // ① 暂停时长不能算进专注时长：25 分钟番茄中途停 1 小时，落账只能是 25 分钟
    focus.startFocus({ minutes: 25, taskTitle: '扣暂停' });
    focus.pause();
    off = 60 * 60000;                        // 暂停了整整 1 小时
    focus.resume();
    off = 85 * 60000;                        // 恢复后正好跑完剩下的 25 分钟
    const prevN = pw.get().sessions.length;
    const due = focus.current();             // 全程没调 tick
    ok(due && due.overrun === true, '到点转「正计时」，不需要页面驱动');
    ok(pw.get().sessions.length === prevN, '正计时期间还没落账（等「退出」才记）');
    off = 95 * 60000;                        // 又多坐了 10 分钟
    const lastS = focus.stopOverrun();
    ok(pw.get().sessions.length === prevN + 1, '退出时结算落了一条会话');
    ok(lastS && lastS.min === 35, '落账 = 25 预设 + 10 正计时 = 35 分钟（暂停那 1 小时仍被扣掉）');
    ok(lastS && lastS.done === true, '自然跑完 → done=true');
    ok(focus.current() === null, '退出后清场');

    // ② 看门狗：只有首页和专注页会每秒调 tick，切到别的 tab 时靠它推进
    const prevN2 = pw.get().sessions.length;
    focus.startFocus({ minutes: 1, taskTitle: '看门狗' });
    off = 96 * 60000;                        // 上面停在 95 分钟处，再走 1 分钟到点
    focus.pause();                           // remainSec 被压成 0
    focus.resume();                          // 重新排定时器 ≈ 1 秒后触发
    await new Promise(r3 => setTimeout(r3, 1600));
    const wd = focus.current();
    ok(wd && wd.overrun === true, '看门狗自己到点推进正计时（人在别的 tab 也不会挂住）');
    focus.stopOverrun();
    ok(focus.current() === null, '退出后清场');
    const s2 = pw.get().sessions[pw.get().sessions.length - 1];
    ok(pw.get().sessions.length === prevN2 + 1 && !!s2 && s2.done === true,
      '看门狗结算照常记一个完整番茄');
    // ⚠️ 这里不能查 pw.overview().pomo（= 今天的番茄数）：本用例把 Date.now 往前拨了
    // 86 分钟，本地时间过了 22:34 之后这个 startAt 就已经是"明天"了 —— 而 recordPomo
    // 是按**开始那天**入账的（跨零点跑完的番茄不该算到第二天）。按"今天"查会变成
    // "白天跑绿、晚上跑红"的假红。改成查"这条会话自己那一天"，跨零点也稳。
    const dayKey = pw.dateStr(new Date(s2.startAt));
    ok(!!pw.get().daily[dayKey] && pw.get().daily[dayKey].pomo >= 1,
      '番茄记在"开始那天"上（跨零点跑完也归属开始日）');
  } finally {
    Date.now = realNow;
    focus.abort();
  }
  ok(pw.get().runtime == null, 'abort 后现场清空（不会把番茄留给下次启动）');

  console.log('\n[21] 没配 AI 时的本地兜底计划');
  // 没填过密钥的用户点「开始规划」必须也能拿到一份能落地的计划，
  // 而不是一句"请先配置 AI" —— 那是把核心功能锁在门槛后面。
  const lp = planAgent.localPlan({
    title: '考研英语', raw: '', deadline: pw.addDays(pw.today(), 30), dailyMin: 60, level: ''
  });
  ok(lp.local === true, '本地模板带 local 标记（页面据此提示"没接 AI"）');
  ok(lp.totalDays > 0 && lp.milestones.length >= 2, '模板切出至少 2 个阶段');
  ok(lp.tasks.length > 0, '模板排出任务');
  ok(lp.tasks.every(t => t.day >= 1 && t.day <= lp.totalDays), '任务起始天数都落在期限内');
  ok(lp.tasks.every(t => t.ms >= 1 && t.ms <= lp.milestones.length), '任务归属的阶段号不越界');
  ok(lp.tasks.every(t => t.pomos >= 1 && t.pomos <= 8), '番茄数夹在 1-8');
  ok(/未接入 AI/.test(lp.strategy), '策略文案明说这是模板，不是 AI 排的');
  const lp2 = planAgent.localPlan({ title: 'x', deadline: pw.addDays(pw.today(), 5), dailyMin: 30 });
  ok(lp2.tasks.every(t => t.day <= lp2.totalDays), '5 天的目标也不会把任务排到期限外');

  console.log('\n[22] 顺延期限 / 补记番茄进统计 / 长休 / 跨零点');
  // ---- 顺延期限（defer）：以前 ops 只有 move/resize/drop/note，deadline 全库无赋值点 ----
  const deferTasks = [{ id: 't1', day: 3, pomos: 2, status: 'todo' }, { id: 't2', day: 5, pomos: 1, status: 'todo' }];
  const dOk = planAgent.normalizeReplan({
    summary: 's',
    ops: [
      { op: 'defer', days: 7, reason: '连续追不上' },
      { op: 'defer', days: 3 },                       // 第二条要被丢
      { op: 'move', taskId: 't1', day: 9 }
    ]
  }, deferTasks, { maxDeferDays: 30 });
  const defs = dOk.ops.filter(o => o.op === 'defer');
  ok(defs.length === 1, 'defer 只认第一条（多条顺延叠加没意义）');
  ok(defs[0] && defs[0].days === 7, 'defer 带顺延天数');
  ok(defs[0] && defs[0].level === 'time', 'defer 恒为 time 档（动截止日是最后手段）');
  ok(dOk.ops.some(o => o.op === 'move'), 'defer 不带 taskId，不会被"找不到任务"误杀');
  const dBig = planAgent.normalizeReplan({ summary: 's', ops: [{ op: 'defer', days: 999 }] }, deferTasks, { maxDeferDays: 30 });
  ok(dBig.ops.length === 1 && dBig.ops[0].days === 30, '顺延天数夹到上限（模型给 999 天也只给 30）');
  ok(!planAgent.normalizeReplan({ summary: 's', ops: [{ op: 'defer', days: 5 }] }, deferTasks, { maxDeferDays: 0 })
    .ops.some(o => o.op === 'defer'), 'maxDeferDays=0 → 不许顺延（还没连续多天做不完）');
  ok(planAgent.normalizeReplan({ summary: 's', ops: [{ op: 'move', taskId: 't1', day: 6 }] }, deferTasks).ops.length === 1,
    '不给上限时走 30 天兜底，且不影响别的 op');

  // ---- 补记番茄必须进统计口径 ----
  const g3 = pw.addGoal(
    { title: '统计口径', raw: 'x', deadline: pw.addDays(pw.today(), 30), dailyMin: 30, level: '' },
    { strategy: '', risks: [], milestones: [{ title: 'm', days: 30 }], tasks: [{ title: '补记用', ms: 1, day: 1, pomos: 3 }] }
  );
  const t3 = g3.tasks[0];
  const nS0 = pw.get().sessions.length;
  const pomo0 = pw.get().daily[pw.today()].pomo;
  const min0 = pw.get().daily[pw.today()].focusMin;
  const bh0 = Object.keys(pw.get().daily[pw.today()].byHour || {}).length;
  ok(pw.creditPomo(g3.id, t3.id, 2) === 2, '补记 2 个番茄');
  ok(pw.get().sessions.length === nS0 + 1, '补记也写进 sessions（统计认这笔）');
  ok(pw.get().daily[pw.today()].pomo === pomo0 + 2, '今日番茄数 +2（热力图 / forecast 认）');
  ok(pw.get().daily[pw.today()].focusMin > min0, '今日专注分钟也涨（不是只改任务字段）');
  const sC = pw.get().sessions[pw.get().sessions.length - 1];
  ok(sC.src === 'log' && sC.done === true, 'session 带 src 标记，能与真番茄分开看');
  ok(Object.keys(pw.get().daily[pw.today()].byHour || {}).length === bh0,
    '补记不写 byHour（没有真实时段，塞进去会污染"哪几段学得进去"）');
  ok(pw.creditPomo(g3.id, t3.id, 5) === 1, '只补到任务上限（3 个的任务填 5 也只补 1）');
  ok(t3.status === 'done', '补满自动完成');

  const g4 = pw.addGoal(
    { title: '手勾完成', raw: 'x', deadline: pw.addDays(pw.today(), 30), dailyMin: 30, level: '' },
    { strategy: '', risks: [], milestones: [{ title: 'm', days: 30 }], tasks: [{ title: '手勾', ms: 1, day: 1, pomos: 2 }] }
  );
  const pomoB = pw.get().daily[pw.today()].pomo;
  pw.setTaskStatus(g4.id, g4.tasks[0].id, 'done');
  ok(g4.tasks[0].donePomos === 2, '手工勾完成补齐番茄数');
  ok(pw.get().daily[pw.today()].pomo === pomoB + 2, '手工勾完成的差额也进今日番茄数（不再只改字段）');

  // ---- 跨零点的番茄记在哪一天 ----
  const yKey = pw.addDays(pw.today(), -1);
  const yMin0 = (pw.get().daily[yKey] || {}).focusMin || 0;
  const tMin0 = pw.get().daily[pw.today()].focusMin;
  const y2350 = new Date();
  y2350.setDate(y2350.getDate() - 1);
  y2350.setHours(23, 50, 0, 0);
  pw.recordPomo({ id: 'x-midnight', goalId: '', taskId: '', startAt: y2350.getTime(), endAt: y2350.getTime() + 20 * 60000, min: 20, done: true });
  ok(((pw.get().daily[yKey] || {}).focusMin || 0) === yMin0 + 20, '跨零点的番茄记在开始那天（昨天那 20 分钟不会消失）');
  ok(pw.get().daily[pw.today()].focusMin === tMin0, '今天不会被记上一段没坐过的时间');

  // ---- 长休：以前 startRest 读 state.count（恒为 0 且 state 已清空），永远触发不了 ----
  const pcfg = pw.get().pomoCfg || {};
  const everyN = pcfg.every || 4;
  const longMin = pcfg.long || 15;
  const restMin = pcfg.rest || 5;
  // [20] 那一节已经真跑落账过几个番茄，本轮计数不是 0 —— 先归零再测，才能对上"第几个"
  pw.get().pomoRound = { count: 0, date: pw.today() };
  const realNow2 = Date.now;
  let off2 = 0;
  Date.now = function () { return realNow2.call(Date) + off2; };
  try {
    for (let i = 1; i <= everyN; i++) {
      focus.startFocus({ minutes: 1, taskTitle: '长休测试' });
      off2 += 61 * 60000;
      focus.current();                 // 到点 → 转「正计时」（不收摊）
      focus.stopOverrun();             // 人按「退出」→ 落账 + 本轮计数 +1
      const rest = focus.startRest();  // state 此时已被清空，这里必须还能work
      const want = (i === everyN) ? longMin : restMin;
      ok(rest && rest.phase === 'rest' && rest.totalSec === want * 60,
        '第 ' + i + ' 个番茄后是' + (i === everyN ? '长' : '短') + '休 ' + want + ' 分钟');
      focus.abort();
    }
    ok(focus.roundInfo().count === everyN, '本轮计数跨状态机存活（番茄结束后仍读得到）');
    ok(focus.isLongRestNext() === true, 'isLongRestNext 在整轮点上为真');
    ok(focus.nextRestMin() === longMin, 'nextRestMin 给出长休时长');
  } finally {
    Date.now = realNow2;
    focus.abort();
  }

  // ---- 连续少做天数：AI 拿它决定"这次能不能顺延期限" ----
  const g5 = pw.addGoal(
    { title: '连续少做', raw: 'x', deadline: pw.addDays(pw.today(), 30), dailyMin: 30, level: '' },
    { strategy: '', risks: [], milestones: [{ title: 'm', days: 30 }], tasks: [{ title: '欠的', ms: 1, day: 1, pomos: 2 }] }
  );
  const t5 = g5.tasks[0];
  const row = (date, actual) => ({
    date: date,
    items: [{ goalId: g5.id, taskId: t5.id, title: t5.title, goalTitle: g5.title, day: 1, planned: 2, actual: actual }],
    ahead: [], extras: '', facts: [], mood: '', note: ''
  });
  dailylog.save(row(pw.addDays(pw.today(), -1), 0));
  dailylog.save(row(pw.today(), 1));
  ok(dailylog.shortStreak(g5.id) === 2, '连续两天没做完 → streak = 2（这才允许顺延期限）');
  dailylog.save(row(pw.today(), 2));
  ok(dailylog.shortStreak(g5.id) === 0, '今天补做完了 → 连续段断掉，streak 归 0（顺延的口子随之关上）');
  ok(dailylog.shortStreak('不存在的目标') === 0, '没这个目标时返回 0（别把别的账算到它头上）');

  console.log('\n[23] 学习能力画像（排期按能力不按意愿）');
  const pacing = await import('file:///' + ROOT.replace(/\\/g, '/') + '/utils/pacing.js');
  // 显式造 7 天历史：4,5,4,3,4,5,4 → 中位数 4 → 容量 = ceil(4×1.2) = 5
  const setHist = (arr) => {
    for (let k = 0; k < arr.length; k++) {
      const key = pw.addDays(pw.today(), -(k + 1));
      // 后写覆盖先写：想让 pomo=9 就得把造的数据放后面（这些天可能已有测试落下的账）
      pw.get().daily[key] = Object.assign({}, pw.get().daily[key] || {},
        { focusMin: arr[k] * 25, pomo: arr[k], byApp: {}, byHour: {}, log: null });
    }
    pw.touch();
  };
  setHist([4, 5, 4, 3, 4, 5, 4]);
  const pac1 = pacing.profile();
  ok(pac1.samples >= 7, '样本取近 14 天有学习记录的日子');
  ok(pac1.med === 4, '容量用中位数（单日爆发不抬容量）');
  ok(pac1.capacity === 5, '排期容量 = 中位数 × 1.2 = 5 个/天（略高于现状才会进步，高太多只会崩）');
  ok(pac1.completeRate != null && pac1.completeRate >= 0 && pac1.completeRate <= 1, '完成率来自近 7 天填报（0-1）');
  ok(/番茄/.test(pacing.promptText(60)) && /容量/.test(pacing.promptText(60)), '给 AI 的画像文字带容量口径');
  ok(pacing.capacityOf(240) === pacing.DAILY_CAP, '意愿 240 分钟也越不过认知负荷上限（8 番茄/天）');
  ok(pacing.capacityOf(30) >= 1, '目标很轻也有下限');
  setHist([9, 9, 9, 9, 9, 9, 9]);
  ok(pacing.profile().capacity === pacing.DAILY_CAP, '连续超量冲刺也不把容量推过 8（超过 4 小时/天的计划没人能维持）');
  pw.get().daily[pw.addDays(pw.today(), -1)] = null;
  pw.get().daily[pw.addDays(pw.today(), -2)] = null;
  pw.touch();
  ok(pacing.profile().samples >= 1, '删掉几天历史后仍能工作（不炸、按剩余样本算）');

  // ---- 目标详情页：点完要立刻变（2026-10-14 真机反馈）----
  // App 端"store 裸对象 → 浅拷贝替换 g"这条路不保证触发重渲染：
  // 提醒 chip 与任务勾选点完没反应，退出重进才刷新（daily.vue 四处 $forceUpdate 是同一批坑）
  {
    const gd = require('fs').readFileSync(
      path.join(ROOT, 'pkgPlan', 'pages', 'goal-detail', 'goal-detail.vue'), 'utf8');
    ok(/remindAt: ''/.test(gd), '提醒时间是独立 data 字段（不只挂在 g 上）');
    ok(/chip-on': remindAt === t/.test(gd), 'chip 选中态绑独立字段 remindAt');
    ok(!/chip-on': g\.remindAt/.test(gd), 'chip 不许再绑 g.remindAt（App 端不保证重渲染）');
    ok(/pickRemind\(t\) \{[\s\S]*?this\.remindAt = t \|\| ''[\s\S]*?\n    \},/.test(gd),
      'pickRemind 里直接赋独立字段（普通响应式赋值，必触发）');
    ok(/toggle\(t\) \{[\s\S]*?\$forceUpdate/.test(gd), '勾选任务补 $forceUpdate（同一个坑）');
    ok(/this\.remindAt = \(g && g\.remindAt\) \|\| ''/.test(gd), 'refresh 时独立字段跟库里同步');
  }

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(1); });
