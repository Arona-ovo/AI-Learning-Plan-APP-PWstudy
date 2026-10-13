// 反向测试：故意把源码改坏，确认 check-timeslot.js 真的会红（防假绿）。
// 结束后一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 不能用 child_process 起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
//    改成同进程 require：清掉 require.cache 让它重新读文件，并接管 process.exit 取退出码。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const U = (rel) => path.join(ROOT, 'uniapp-PWstudy', rel);
const CHECK = path.join(ROOT, '_tools', 'check-timeslot.js');

const FILES = [
  'utils/timeslot.js',
  'utils/reminder.js',
  'utils/settings.js',
  'utils/plan-task.js',
  'services/plan-agent.js',
  'pkgPlan/pages/wizard/wizard.vue',
  'pkgPlan/pages/goal-detail/goal-detail.vue',
  'pages/home/home.vue'
];
const orig = {};
FILES.forEach(f => { orig[f] = fs.readFileSync(U(f), 'utf8'); });

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  let code = 0;
  const buf = [];
  process.exit = (c) => { code = (c == null ? 0 : c); const e = new Error('__exit'); e.__exit = true; throw e; };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  try { require(CHECK); } catch (e) {
    // 脚本被改崩也算"抓到"（护栏里有断言会在崩之前红，直接抛说明连跑都跑不动）
    if (!e || !e.__exit) { code = 1; buf.push('✗ 脚本崩了: ' + (e && e.message)); }
  } finally { console.log = realLog; console.error = realErr; process.exit = realExit; }
  return { code, fails: buf.filter(l => l.indexOf('✗') >= 0) };
}

// 每条用例：改哪个文件、怎么改
const cases = [
  ['时段不认中文说法', 'utils/timeslot.js',
    s => s.replace("['pm',   ['pm', 'p.m.', 'evening', 'night', '晚上', '傍晚', '夜里', '夜间', '深夜', '晚']]", "['pm',   ['pm']]")],
  ['spread 不把越界的时段拉回可用范围', 'utils/timeslot.js',
    s => s.replace('const at = cur ? pool.indexOf(cur) : -1;', 'const at = cur ? 0 : -1;')],
  ['spread 不补漏给的（缺一组）', 'utils/timeslot.js',
    s => s.replace('      t.slot = pool[i % pool.length];\n      i++;', '      t.slot = pool[0];\n      i++;')],
  ['keyNow 不挡深夜', 'utils/timeslot.js',
    s => s.replace('if (cur >= LATEST_MIN) return \'\';', '')],
  ['出厂默认把时段关掉', 'utils/settings.js',
    s => s.replace('      slot: true,\n      slotNotify: true', '      slot: false,\n      slotNotify: false')],
  ['关掉开关仍然产出 slot（不是纯回退）', 'services/plan-agent.js',
    s => s.replace('if (input.slotOn) row.slot = timeslot.normalize(t && t.slot);', "row.slot = timeslot.normalize(t && t.slot);")],
  ['本地兜底不轮转补时段', 'services/plan-agent.js',
    s => s.replace('if (input && input.slotOn) timeslot.spread(tasks, input.slots);', '')],
  ['模型漏给时段不补（分组会缺一组）', 'services/plan-agent.js',
    s => s.replace('if (input.slotOn) timeslot.spread(tasks, input.slots);', '')],
  ['提示词不下发 slot 字段', 'services/plan-agent.js',
    s => s.replace("(input.slotOn ? ',\"slot\":\"am|noon|pm\"' : '') +", "'' +")],
  // 注意：源码是 CRLF，多行 pattern 里的 \n 匹配不上，这里只用单行片段
  ['追问不把时段当必问项', 'services/plan-agent.js',
    s => s.replace('if (seed.slotOn) {', 'if (false) {')],
  ['生成阶段不读开关（中途关掉无效）', 'utils/plan-task.js',
    s => s.replace('input.slotOn = timeslot.enabled();', 'input.slotOn = true;')],
  ['结果页不按时段分组', 'pkgPlan/pages/wizard/wizard.vue',
    s => s.replace('v-for="(sg, si) in group.groups" :key="si" class="pv-slot"', 'v-for="(sg, si) in [{ tasks: group.raw }]" :key="si" class="pv-slot"')],
  ['向导页不把勾选的时段传出去', 'pkgPlan/pages/wizard/wizard.vue',
    s => s.replace('slots: (this.draft.slots || []).slice()', "slots: []")],
  ['详情页关掉开关仍显示时段', 'pkgPlan/pages/goal-detail/goal-detail.vue',
    s => s.replace("if (!this.slotOn || !t) return ''", "if (!t) return ''")],
  ['首页不触发时段提醒', 'pages/home/home.vue',
    s => s.replace('try { reminder.checkSlot() } catch (e) {}', '')],
  ['时段提醒不记账（同一时段重复催）', 'utils/reminder.js',
    s => s.replace('if (done.indexOf(key) >= 0) return;', 'if (false) return;')],
  ['该时段没事做也打扰', 'utils/reminder.js',
    s => s.replace('    if (!list.length) return;\n', '')],
  ['时段提醒不看开关', 'utils/reminder.js',
    s => s.replace('if (!timeslot.notifyOn()) return 0;', '')],
  ['时段顺序写反（分组也跟着反）', 'utils/timeslot.js',
    s => s.replace("export const KEYS = ['am', 'noon', 'pm'];", "export const KEYS = ['pm', 'noon', 'am'];")],
  ['关掉时段后结果页仍分组（老数据会冒出时段）', 'pkgPlan/pages/wizard/wizard.vue',
    s => s.replace(": [{ key: '', name: '', hint: '', tasks: g.raw }]", ': timeslot.groupOf(g.raw)')],
  ['分组时丢了全局 idx（勾选会错位）', 'pkgPlan/pages/wizard/wizard.vue',
    s => s.replace('out[mi].raw.push(Object.assign({ idx }, t))', 'out[mi].raw.push(t)')]
];

let bad = 0;
const base = runCheck();
console.log('基线：exit=' + base.code + '（应为 0）');
if (base.code !== 0) { console.log('基线就不是绿的，先修好再来 ✗'); process.exit(1); }

for (const [name, file, mut] of cases) {
  const next = mut(orig[file]);
  if (next === orig[file]) { console.log('SKIP 没匹配到改动点: ' + name); bad++; continue; }
  fs.writeFileSync(U(file), next, 'utf8');
  let r;
  try { r = runCheck(); } finally { fs.writeFileSync(U(file), orig[file], 'utf8'); }
  if (r.code !== 0) {
    console.log('  抓到 ' + name + '（' + r.fails.length + ' 条红）');
  } else {
    console.log('  漏了 ' + name + ' ✗');
    bad++;
  }
}

// 还原后必须还是绿的
const after = runCheck();
console.log('还原后：exit=' + after.code + '（应为 0）');
if (after.code !== 0) bad++;

console.log(bad === 0 ? '\n反向测试全部通过（护栏不是假绿）' : '\n反向测试失败 ' + bad + ' 项 ✗');
process.exit(bad ? 1 : 0);
