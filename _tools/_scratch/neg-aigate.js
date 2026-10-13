// 反向测试：故意把 AI 分项开关配坏，确认 check-aigate.js 真的会红（防假绿）。
// 结束（或中途出错）一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 同进程 require 而不是起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
// ⚠️ process.exit() 与 process.exitCode 两条退出口径都要收（有的守卫只写后者）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CHECK = path.join(ROOT, '_tools', 'check-aigate.js');
const GATE = path.join(ROOT, 'uniapp-PWstudy', 'services', 'ai-gate.js');
const AGENT = path.join(ROOT, 'uniapp-PWstudy', 'services', 'plan-agent.js');

const backup = { [GATE]: fs.readFileSync(GATE), [AGENT]: fs.readFileSync(AGENT) };
function restore() {
  Object.keys(backup).forEach(f => fs.writeFileSync(f, backup[f]));
}

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  const buf = [];
  let code = 0, exited = false;
  process.exitCode = 0;
  process.exit = (c) => { code = (c == null ? 0 : c); exited = true; const e = new Error('__exit'); e.__exit = true; throw e; };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  try { require(CHECK); } catch (e) { if (!e || !e.__exit) { restore(); throw e; } }
  process.exit = realExit;
  console.log = realLog;
  console.error = realErr;
  const c = code || process.exitCode || 0;
  process.exitCode = 0;
  return { code: c, exited: exited, buf: buf };
}

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };

/** 改坏 → 跑 → 断言"被抓到"。红条数必须 > 0：一条都没有说明是脚本崩了，不是断言命中 */
function shouldCatch(label, mutate, expect) {
  restore();
  const cur = {};
  Object.keys(backup).forEach(f => { cur[f] = fs.readFileSync(f, 'utf8'); });
  try {
    mutate(cur);
  } catch (e) {
    // 锚点失效（源码改过了）必須當成失敗，不能让它把整个脚本崩掉然后看都不看
    bad(label + ' —— 注入失败：' + e.message);
    restore();
    return;
  }
  Object.keys(cur).forEach(f => fs.writeFileSync(f, cur[f]));
  const r = runCheck();
  const reds = r.buf.filter(l => l.indexOf('✗') >= 0);
  const hit = r.code !== 0 && reds.length > 0
    && (!expect || r.buf.join('\n').indexOf(expect) >= 0);
  if (hit) ok(label + '（红 ' + reds.length + ' 条）');
  else bad(label + ' —— 没被抓到：code=' + r.code + ' 红条=' + reds.length
    + (expect ? ' 期望看到「' + expect + '」' : ''));
  restore();
}

console.log('反向测试：check-aigate.js 应该抓到下面这些坏法');
console.log('');

// 1. 把背单词的「AI 生成词书」加回来
shouldCatch('加回背单词项（wordbook）', (c) => {
  c[GATE] = c[GATE].replace("  {\n    key: 'plan',", "  {\n    key: 'wordbook',\n    name: 'AI 生成词书',\n    desc: '按主题批量造词与释义',\n    level: 'max', levelLabel: '极高'\n  },\n  {\n    key: 'plan',")
}, 'AI 生成词书（背单词）');

// 2. 登记了却没人守卫 = 假开关（把 coach 那一项的守卫调用摘掉）
// ⚠️ 锚点别带 \n：plan-agent.js 在工作区里是 CRLF，写 \n 会全部落空（已踩过）
shouldCatch('某项登记了但没人守卫（coach）', (c) => {
  const before = c[AGENT];
  c[AGENT] = before.replace("  ensureFeature('coach');", '');
  if (c[AGENT] === before) throw new Error("没找到 ensureFeature('coach') —— 锚点失效了");
}, 'coach');

// 3. 顺序打乱：把最便宜的一项排到最前面
shouldCatch('顺序不是从贵到便宜', (c) => {
  c[GATE] = c[GATE].replace("    key: 'plan',\n    name: 'AI 生成学习计划',\n    desc: '把目标拆成每天的任务。关掉后改用本地模板排 —— 结构照旧，少些个性化',\n    level: 'max', levelLabel: '极高'",
    "    key: 'plan',\n    name: 'AI 生成学习计划',\n    desc: '把目标拆成每天的任务。关掉后改用本地模板排 —— 结构照旧，少些个性化',\n    level: 'low', levelLabel: '低'");
}, '开销从大到小');

// 4. 重复 key
shouldCatch('key 重复', (c) => {
  c[GATE] = c[GATE].replace("    key: 'replan',", "    key: 'plan',");
}, 'key 没有重复');

// 5. level 用了没定义的档位
shouldCatch('level 不是 low/mid/high/max', (c) => {
  c[GATE] = c[GATE].replace("    level: 'mid', levelLabel: '中'\n  },\n  {\n    key: 'coach'", "    level: 'huge', levelLabel: '巨大'\n  },\n  {\n    key: 'coach'");
}, 'level 只用了');

// 6. 整个表被清空（key 都没了，守卫也就无从谈起）
shouldCatch('表被清空', (c) => {
  c[GATE] = c[GATE].replace(/export const AI_FEATURES = \[[\s\S]*?\n\]/, 'export const AI_FEATURES = []');
}, '表里有');

restore();
console.log('');
console.log(fail === 0 ? '反向测试全部通过（护栏真的会红）' : '失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);
