// 反向测试：故意把在线模式的代码改坏，确认 check-online.js 真的会红（防假绿）。
// 结束后用内存备份还原，不走 git。
//
// check-online.js 是同步的（断言不在 promise 里），但 process.exit 仍要接管 ——
// 它靠 throw 跳出 require，不接管的话整个回归进程会被带崩。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const U = (rel) => path.join(ROOT, 'uniapp', rel);
const CHECK = path.join(ROOT, '_tools', 'check-online.js');

const FILES = ['utils/settings.js', 'services/backend.ts', 'services/cloud-sync.ts'];
const orig = {};
FILES.forEach(f => { orig[f] = fs.readFileSync(U(f), 'utf8'); });

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const prevExit = process.exit;
  const realLog = console.log, realErr = console.error;
  let code = 0;
  process.exit = (c) => {
    code = (c == null ? 0 : c);
    const e = new Error('__exit');
    e.__exit = true;
    throw e;
  };
  console.log = () => {};
  console.error = () => {};
  let crash = null;
  try { require(CHECK); } catch (e) { if (!e || !e.__exit) crash = e; }
  console.log = realLog;
  console.error = realErr;
  process.exit = prevExit;
  process.exitCode = 0;
  return crash ? 99 : code;
}

const cases = [
  ['默认开着在线模式（没服务器也往外发请求）', 'utils/settings.js',
    s => s.replace('online: { enabled: false', 'online: { enabled: true')],
  ['users 表进了同步清单（把密码哈希推给服务器）', 'services/cloud-sync.ts',
    s => s.replace("['studyRecords', 'wordFavorites']", "['studyRecords', 'wordFavorites', 'users']")],
  ['关着也发请求（不判 ready）', 'services/backend.ts',
    s => s.replace('if (!ready()) offline();', '')],
  ['401 不清 token（之后每次请求都稳定 401）', 'services/backend.ts',
    s => s.replace(/clearToken\(\);\r?\n\s*throw new http\.ServiceError\('登录状态已失效/,
      "throw new http.ServiceError('登录状态已失效")],
  ['凭证改存普通 storage（不经 KeyStore / Keychain）', 'services/backend.ts',
    s => s.replace(/secure\.(get|set|remove)Secure/g, 'plainStore.$1')],
  ['地址不挑协议（填 ws:// 也照发）', 'services/backend.ts',
    s => s.replace('if (!/^https?:\\/\\//i.test(s)) return \'\';', '')],
  ['整批无脑标记已同步（服务端没收到的也标 → 丢数据）', 'services/cloud-sync.ts',
    s => s.replace("await r.markSynced(uuids, 'synced');", "await r.markSynced(rows.map(x => x.uuid), 'synced');")],
  ['拉下来直接盖本地（不比 updated_at）', 'services/cloud-sync.ts',
    s => s.replace('if (mine && Number(mine.updated_at || 0) >= Number(row.updated_at || 0)) continue;', '')],
  ['同步失败却标记成功（用户以为同步上了）', 'services/cloud-sync.ts',
    s => s.replace('backend.markError(msg);', 'backend.markError(msg); backend.markSynced();')],
  ['自己拼 URL 发请求（绕开 backend）', 'services/cloud-sync.ts',
    s => s.replace("await backend.post('/sync/push'", "await http.request({ url: 'http://x/sync/push'")],
  ['deviceId 一上来就生成（没开在线模式也留一条）', 'services/backend.ts',
    s => s.replace('if (c.deviceId) return c.deviceId;', '')]
];

let bad = 0;
const base = runCheck();
console.log('基线：exit=' + base + '（应为 0）');
if (base !== 0) { console.log('基线就不是绿的，先修好再来 ✗'); process.exit(1); }

for (const [name, file, mut] of cases) {
  const src = orig[file];
  const next = mut(src);
  if (next === src) { console.log('SKIP 没匹配到改动点: ' + name); bad++; continue; }
  fs.writeFileSync(U(file), next, 'utf8');
  let code;
  try { code = runCheck(); } finally { fs.writeFileSync(U(file), src, 'utf8'); }
  if (code !== 0) console.log('  抓到 ' + name);
  else { console.log('  漏了 ' + name + ' ✗'); bad++; }
}

const after = runCheck();
console.log('还原后：exit=' + after + '（应为 0）');
if (after !== 0) bad++;

console.log(bad === 0 ? '\n反向测试全部通过（护栏不是假绿）' : '\n反向测试失败 ' + bad + ' 项 ✗');
process.exit(bad ? 1 : 0);
