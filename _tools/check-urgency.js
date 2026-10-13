// _tools/check-urgency.js - 今日紧迫度（utils/urgency.js + components/urgency-meter）校验
// 运行：node --experimental-strip-types _tools/check-urgency.js
//
// 覆盖：
//  1) 紧迫度合成：时间压力 / 超期 / 期限压力 三路权重与档位边界
//  2) 边界：夜里只剩几分钟（MIN_AVAIL 夹取）、时间不够（over）、无期限（不算压力）
//  3) 番茄方块：封顶 12 个、超出从"已完成"那头砍、overflow 标记
//  4) 时间条：24h 口径，三个百分比都在 0-100，现在时刻与"已过去"一致
//  5) 难度：按日常负荷折算，不是绝对值
//  6) 组件：整张卡**没有中文文本节点**（用户要求"尽量不用文字"），且不自带数据源
//  7) 纯本地：不 import 任何 AI / 网络模块（首页每次 refresh 都算，不能等网络）

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const P = (rel) => 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
function eq(a, b, label) {
  const s1 = JSON.stringify(a), s2 = JSON.stringify(b);
  if (s1 === s2) ok(label + ' = ' + s2);
  else bad(label + ' 期望 ' + s2 + '，实际 ' + s1);
}

/* ---------------- mock：uni 存储 ---------------- */
const kv = {};
global.uni = {
  getStorageSync: (k) => (k in kv ? kv[k] : ''),
  setStorageSync: (k, v) => { kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; },
  showToast: () => {}
};

/** 取当天某个时刻的时间戳 */
function at(hh, mm) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm || 0, 0).getTime();
}

(async () => {
  const pw = await import(P('utils/pwstore.js'));
  const U = await import(P('utils/urgency.js'));

  /**
   * 造一份数据算一次。
   * opt.createdDaysAgo 决定"计划已进行天数"（= 超期判定基准）
   */
  function scenario(opt) {
    const o = opt || {};
    pw.reset();
    const st = pw.get();
    st.pomoCfg.focus = o.focus || 25;
    st.goals = [];
    if (o.tasks !== null) {
      const created = Date.now() - (o.createdDaysAgo || 0) * 86400000;
      st.goals.push({
        id: 'g1',
        title: '目标',
        status: 'active',
        dailyMin: o.dailyMin || 60,
        deadline: o.deadline || '',
        createdAt: created,
        tasks: (o.tasks || []).map((t, i) => ({
          id: 't' + i,
          title: '任务' + i,
          day: t.day || 1,
          pomos: t.pomos || 0,
          donePomos: t.donePomos || 0,
          status: 'todo'
        }))
      });
    }
    return U.compute(o.now);
  }

  /* ---------- 1. 三路权重与档位 ---------- */
  console.log('== 1. 紧迫度合成：时间压力 + 超期 + 期限压力 ==');
  // 早上 9 点，剩 2 个番茄（50 分），可用 900 分 → 时间很宽裕，没有期限 → 从容
  const easy = scenario({ now: at(9, 0), tasks: [{ pomos: 1 }, { pomos: 1 }] });
  eq(easy.leftPomos, 2, '轻松：剩余番茄');
  eq(easy.needMin, 50, '轻松：需要分钟 = 2 × 25');
  eq(easy.availMin, 900, '轻松：到 24:00 可用分钟');
  assert(easy.score < 25 && easy.level === 0, '轻松 → 档位 0 从容（score ' + easy.score + '）');
  assert(!easy.over, '轻松：时间够（over=false）');
  eq(easy.color, '#3b6d11', '轻松：档位色');

  // 晚上 22 点，剩 9 个番茄（225 分），可用 120 分 → 排不下 → over
  const hard = scenario({
    now: at(22, 0),
    createdDaysAgo: 3,                                   // 计划已进行 4 天
    tasks: [{ day: 1, pomos: 3 }, { day: 2, pomos: 3 }, { day: 3, pomos: 3 }],
    deadline: pw.today()                                 // 今天就到期
  });
  eq(hard.overdue, 3, '告急：3 项超期');
  eq(hard.needMin, 225, '告急：需要分钟');
  eq(hard.availMin, 120, '告急：可用分钟');
  assert(hard.over, '告急：时间排不下（over=true）');
  eq(hard.level, 3, '告急：档位 3');
  eq(hard.color, '#bb1332', '告急：档位色');
  eq(hard.score, 100, '告急：分数封顶 100（55 时间 + 20 超期 + 25 期限）');

  // 时间不够就必须脱离"从容"档：即使没有任何超期与期限压力
  const overOnly = scenario({
    now: at(23, 0),
    tasks: [{ pomos: 8 }],
    deadline: pw.addDays(pw.today(), 60)                 // 期限很远 → 压力 0.1
  });
  assert(overOnly.over, '仅时间不够：over=true');
  assert(overOnly.score >= 60, '仅时间不够：分数被顶到 ≥60（不该再显示从容，实际 ' + overOnly.score + '）');
  assert(overOnly.level >= 2, '仅时间不够：至少紧张档（实际 ' + overOnly.level + '）');

  // 期限压力单调：越近越紧
  const near = scenario({ now: at(10, 0), tasks: [{ pomos: 1 }], deadline: pw.today() });
  const far = scenario({ now: at(10, 0), tasks: [{ pomos: 1 }], deadline: pw.addDays(pw.today(), 60) });
  assert(near.score > far.score, '期限越近分数越高（' + near.score + ' > ' + far.score + '）');
  // 没设期限 = 不知道就不瞎紧张
  const none = scenario({ now: at(10, 0), tasks: [{ pomos: 1 }] });
  eq(none.days, -1, '未设期限：days = -1');
  assert(none.score <= far.score, '未设期限的压力 ≤ 最远期限（' + none.score + ' ≤ ' + far.score + '）');

  /* ---------- 2. 边界 ---------- */
  console.log('== 2. 边界 ==');
  // 23:58 只剩 2 分钟：不夹会算出 ratio 爆炸，夹到 30 才是"今天来不及了"这个信号
  const late = scenario({ now: at(23, 58), tasks: [{ pomos: 1 }] });
  eq(late.availMin, 30, '23:58 可用分钟夹到下限 30');
  eq(late.empty, false, '有任务就不算空');

  // 一个番茄都没排：整张卡不出现（首页 v-if="!u.empty"）
  const none2 = scenario({ now: at(12, 0), tasks: [] });
  eq(none2.totalPomos, 0, '空：总番茄 0');
  eq(none2.empty, true, '空：empty=true（首页整卡隐藏）');
  eq(none2.blocks, [], '空：没有方块');

  // 全做完了：没有剩余量，但卡还在（能看到"今天已经清空了"）
  const done = scenario({ now: at(12, 0), tasks: [{ pomos: 3, donePomos: 3 }] });
  eq(done.leftPomos, 0, '做完：剩余 0');
  eq(done.donePomos, 3, '做完：已完成 3');
  assert(!done.over, '做完：不显示排不下');

  /* ---------- 3. 番茄方块 ---------- */
  console.log('== 3. 番茄方块（难度与进度） ==');
  const few = scenario({ now: at(12, 0), tasks: [{ pomos: 2, donePomos: 1 }] });
  eq(few.blocks, ['done', 'left'], '2 个：1 空心（已做）+ 1 实心（还剩）');

  // 15 个（10 做 + 5 剩）超过 12 个上限 → 从已完成那头砍
  const many = scenario({ now: at(12, 0), tasks: [{ pomos: 15, donePomos: 10 }] });
  eq(many.blocks.length, 12, '超上限：方块封顶 12 个');
  eq(many.overflow, true, '超上限：overflow=true（多画一个省略块）');
  eq(many.blocks.filter(b => b === 'left').length, 5, '超上限：剩余 5 个一个不少（砍的是已做那头）');
  eq(U.MAX_BLOCKS, 12, 'MAX_BLOCKS = 12');

  /* ---------- 4. 24 小时时间条 ---------- */
  console.log('== 4. 24 小时时间条 ==');
  const t6 = scenario({ now: at(6, 0), tasks: [{ pomos: 2 }] });
  eq(t6.nowPct, 25, '06:00 → 现在落在 25%');
  eq(t6.passedPct, t6.nowPct, '已过去与现在时刻同口径（整条 = 24h）');
  eq(t6.fillPct, 3.5, '需要 50 分钟 → 占 3.5%');
  [t6, easy, hard, late, many].forEach((r, i) => {
    assert(r.nowPct >= 0 && r.nowPct <= 100, '用例' + i + ' nowPct 在 0-100（' + r.nowPct + '）');
    assert(r.fillPct >= 0 && r.fillPct <= 100, '用例' + i + ' fillPct 在 0-100（' + r.fillPct + '）');
  });
  // 夜里需要量与现在位置之和会超过 100：由组件的 needStyle 截断，
  // 数据层不加锁（截断是显示问题，塞进数据层会让"排不下"这个信号失真）
  assert(hard.fillPct + hard.nowPct > 100,
    '排不下时：fillPct+nowPct 溢出（' + (hard.fillPct + hard.nowPct).toFixed(1) +
    '%）由组件截断到条尾，数据层保留真值');

  /* ---------- 5. 难度按日常负荷折算 ---------- */
  console.log('== 5. 难度 = 相对日常负荷，不是绝对值 ==');
  const light = scenario({ now: at(12, 0), tasks: [{ pomos: 2 }], dailyMin: 240 });
  const heavy = scenario({ now: at(12, 0), tasks: [{ pomos: 2 }], dailyMin: 30 });
  assert(heavy.difficulty > light.difficulty,
    '同样 2 个番茄，日常只有 30 分的人更难（' + heavy.difficulty + ' > ' + light.difficulty + '）');
  eq(easy.difficulty >= 0 && easy.difficulty <= 100, true, '难度夹在 0-100');
  const od = scenario({
    now: at(12, 0), createdDaysAgo: 3,
    tasks: [{ day: 1, pomos: 2 }, { day: 2, pomos: 2 }], dailyMin: 120
  });
  const noOd = scenario({ now: at(12, 0), tasks: [{ pomos: 2 }, { pomos: 2 }], dailyMin: 120 });
  assert(od.difficulty > noOd.difficulty, '超期让难度更高（' + od.difficulty + ' > ' + noOd.difficulty + '）');

  /* ---------- 6. 呼吸周期与档位名 ---------- */
  console.log('== 6. 呼吸周期 / 档位名 ==');
  eq(U.compute(at(12, 0)).beatMs >= 800, true, 'beatMs 下限 800ms（再快就像抽搐）');
  assert(hard.beatMs < easy.beatMs, '越急跳得越快（' + hard.beatMs + ' < ' + easy.beatMs + '）');
  eq(U.levelName(0), '从容', 'levelName(0)');
  eq(U.levelName(3), '告急', 'levelName(3)');
  eq(U.levelName(99), '告急', 'levelName 越界夹到末档');
  eq(U.levelName(-1), '从容', 'levelName 负值夹到首档');
  eq(U.LV_COLOR.length, 4, '四档配色');

  /* ---------- 7. 组件：几乎没有文字 ---------- */
  console.log('== 7. components/urgency-meter 无文字 ==');
  const comp = R('components/urgency-meter/urgency-meter.vue');
  const cut = comp.indexOf('\n</template>');
  const tpl = comp.slice(0, cut).replace(/<!--[\s\S]*?-->/g, '');
  const hanText = (tpl.match(/>[^<>{}]*</g) || [])
    .map(m => m.slice(1, -1).trim())
    .filter(v => /[\u4e00-\u9fa5]/.test(v));
  eq(hanText, [], '模板里没有中文文本节点（用户要求：尽量不用文字）');
  assert(/\?/.test(tpl) && /@tap\.stop="onHelp"/.test(tpl), '唯一的文字是一个 ? 按钮');
  assert(/props:\s*\{[\s\S]*?u:/.test(comp), '数据靠 props.u 传入（组件自己不读库）');
  assert(!/pwstore|pacing/.test(comp), '组件不直接读数据层');
  assert(/\$emit\('help'/.test(comp), '点 ? 抛出 help 事件（由页面弹说明）');
  assert(/animationDuration/.test(comp), '呼吸周期是运行时下发的（跟着紧迫度变）');
  assert(/conic-gradient/.test(comp), '环用 conic-gradient 画（不用 canvas：原生组件脱离 CSS transform）');

  /* ---------- 8. 纯本地，不等网络 ---------- */
  console.log('== 8. 纯本地计算 ==');
  const src = R('utils/urgency.js');
  assert(!/from\s+'\.\.\/services\//.test(src) && !/from\s+'\.\/services\//.test(src),
    'urgency.js 不依赖 services（首页每次 refresh 都算，不能等网络）');
  assert(!/\bawait\b/.test(src), 'urgency.js 全同步（compute 返回值直接进 data）');
  assert(/pacing\.focusLen\(\)/.test(src), '番茄时长跟随设置（不写死 25）');

  /* ---------- 9. 首页接线 ---------- */
  console.log('== 9. 首页接线 ==');
  const home = R('pages/home/home.vue');
  // 首页改成自定义布局（注册表 + cardVisible）之后，"显不显示"不再写在模板的 v-if 上，
  // 而是 cardVisible 里那句判据 —— 断言跟着实现走，别再盯那个早就不存在的 show('urgency')。
  assert(/if \(id === 'urgency'\) return !!\(this\.u && !this\.u\.empty\)/.test(home),
    '首页：排了任务才显示紧迫度卡（cardVisible 判据）');
  assert(/<urgency-meter :u="u" @help="explainUrgency" \/>/.test(home), '首页：绑定数据与 ? 事件');
  assert(/this\.u = urgency\.compute\(\)/.test(home), 'refresh 里重算（剩余时间是走动的）');
  const hl = R('utils/home-layout.ts');
  assert(/id: 'urgency'[\s\S]{0,80}def: true/.test(hl), '紧迫度默认就在首页（注册表 def:true）');

  console.log('');
  console.log(fail === 0 ? '全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('运行异常：', e);
  process.exit(1);
});
