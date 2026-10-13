// _tools/check-online.js - 在线模式（服务器通道 + 云同步骨架）校验
// 运行：node _tools/check-online.js
//
// 服务器还没接，这些代码现在没有任何页面调用 —— 护栏守的不是"现在能用"，
// 而是**将来接服务器那天别被改坏**。挑的都是最容易踩的：
//  1) 默认必须关：在线模式是可选增强，没服务器时 App 要 100% 跑本地
//  2) 关着的时候**一个请求都不许发**（判 ready 再发，不是发失败再降级）
//  3) 凭证只进安全存储（Android KeyStore / iOS Keychain），绝不落普通 storage
//  4) users 表**永远不参与同步**（它带 password_hash）
//  5) 没被服务端确认收到的数据不许标记已同步（标了 = 丢数据）
//  6) 拉下来的不能直接盖本地（按 updated_at 比，谁新用谁）
//
// ⚠️ TS 模块没法用 load.js 跑（它只转 ESM，不剥类型），所以这里全是静态契约检查。
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { load } = require('./lib/load.js');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
function eq(a, b, label) {
  const s1 = JSON.stringify(a), s2 = JSON.stringify(b);
  if (s1 === s2) ok(label + ' = ' + s2);
  else bad(label + ' 期望 ' + s2 + '，实际 ' + s1);
}

/** 剥注释：块注释 + 行注释（行注释只剥整行的，避免误伤字符串里的 //） */
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 切出某个函数体的花括号块。
 * ⚠️ head 必须一直写到函数体的 `{` **之前**（含 TS 返回类型），否则
 * `Promise<{ pushed: number }>` 里的 `{` 会被当成函数体起点 —— TS 文件专属的坑。
 */
function block(src, head) {
  const i = src.indexOf(head);
  if (i < 0) return '';
  const j = src.indexOf('{', i + head.length);
  if (j < 0) return '';
  let d = 0, k = j;
  for (; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) break; }
  }
  return src.slice(j, k + 1);
}

/* ---------- 1. 默认关闭（运行时） ---------- */
console.log('== 1. 默认关闭：没服务器时 App 完全跑本地 ==');
const kv = {};
global.uni = {
  getStorageSync: (k) => (k in kv ? kv[k] : ''),
  setStorageSync: (k, v) => { kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; }
};
const settings = load('utils/settings.js');
const dft = settings.defaults().online || {};
eq(dft.enabled, false, 'online.enabled 默认关');
eq(dft.baseUrl, '', 'baseUrl 默认为空');
assert('deviceId' in dft && 'userId' in dft && 'lastSyncAt' in dft && 'lastError' in dft,
  '字段齐了（deviceId / userId / lastSyncAt / lastError）');

/* ---------- 2. 通道 ---------- */
console.log('== 2. 通道 services/backend.ts ==');
const be = strip(R('services/backend.ts'));
assert(/export function ready\(\)[\s\S]{0,120}enabled\(\)[\s\S]{0,40}baseUrl\(\)/.test(be),
  'ready() = 开关开了**且**地址填对了');
assert(/if \(!ready\(\)\) offline\(\)/.test(be), '发请求前先判 ready —— 关着就不发');
assert(/throw new http\.ServiceError\('在线模式没开'[\s\S]{0,120}notConfigured: true/.test(be),
  '未启用抛 notConfigured（告诉调用方"不是服务挂了"，不该熔断重试）');
assert(/secure\.getSecure\(|secure\.setSecure\(|secure\.removeSecure\(/.test(be), '凭证走 plus 安全存储');
assert(!/setStorageSync\(TOKEN_KEY|setStorageSync\('fj_online/.test(be),
  '凭证绝不落普通 storage（Android KeyStore / iOS Keychain 才有意义）');
assert(/401|403/.test(be) && /clearToken\(\);\s*\n?\s*throw/.test(be),
  '401/403 → 先清 token 再抛（留着旧 token 会让后续每次请求都稳定失败）');
assert(/\^https\?:\\\/\\\//i.test(be) || /\^https\?:\\\//.test(be) || /https\?:\\\/\\\//.test(be),
  '地址只认 http(s)');
// deviceId 只在用到时才生成（提前生成会让从没开过在线模式的用户也多一条数据）
const devBlk = block(be, 'export function deviceId()');
assert(/if \(c\.deviceId\) return c\.deviceId/.test(devBlk), 'deviceId 只在首次用到时生成');

/* ---------- 3. 同步 ---------- */
console.log('== 3. 云同步骨架 services/cloud-sync.ts ==');
const cs = strip(R('services/cloud-sync.ts'));
assert(/SYNC_TABLES\s*=\s*\[[^\]]*\]/.test(cs), '有明确的同步表清单');
const tblDecl = (cs.match(/SYNC_TABLES\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
assert(tblDecl.indexOf('users') < 0,
  '⚠️ users 表不参与同步（它带 password_hash，推上去等于交出密码哈希）');
assert(/studyRecords/.test(tblDecl) && /wordFavorites/.test(tblDecl), '同步的是学习数据两张表');
// 只有服务端确认收到的才标记
const pushBlk = block(cs, 'export async function push(): Promise<{ pushed: number; serverTime?: number }>');
assert(/applied/.test(pushBlk) && /markSynced\(uuids/.test(pushBlk),
  '按服务端返回的 applied 标记已同步（没确认的不标 → 不会丢数据）');
assert(!/markSynced\(\s*(rows|list|pending)/.test(pushBlk), '不是整批无脑标记');
// 拉取要按 updated_at 比
const pullBlk = block(cs, 'export async function pull(since?: number): Promise<{ pulled: number; serverTime?: number }>');
assert(/updated_at/.test(pullBlk), '拉下来按 updated_at 比（谁新用谁，不直接盖本地）');
assert(/continue/.test(pullBlk), '本地更新时跳过远端那条');
// 失败不动数据
const onceBlk = block(cs, 'export async function syncOnce(opt?: { since?: number }): Promise<SyncResult>');
assert(/markError/.test(onceBlk), '失败记错误（用户问"为什么没同步上"时有的答）');
// 只看 catch 之后那段：成功路径本来就有 markSynced，全文扫会把失败路径放过去
const catchPart = onceBlk.slice(onceBlk.indexOf('catch'));
assert(catchPart && !/markSynced/.test(catchPart), '失败路径不标记已同步（标了 = 用户以为同步上了）');
// 分别看两个函数：全文扫的话改掉一个、另一个还在，照样绿
assert(/backend\.post\(/.test(pushBlk), '推送走 backend.post（不自己拼 URL / 不管 token）');
assert(/backend\.get\(/.test(pullBlk), '拉取走 backend.get');

/* ---------- 4. 文档 ---------- */
console.log('== 4. 文档与接线 ==');
const doc = path.join(ROOT, 'docs', 'online-mode.md');
assert(fs.existsSync(doc), '有 uniapp-PWstudy/docs/online-mode.md（服务端照它实现）');
if (fs.existsSync(doc)) {
  const t = fs.readFileSync(doc, 'utf8');
  assert(/\/sync\/push/.test(t) && /\/sync\/pull/.test(t), '文档写明了两个同步接口');
  assert(/password_hash|密码哈希/.test(t), '文档写明了 users 表不同步的原因');
  assert(/wgt/.test(t), '文档写明了哪些走 wgt、哪些必须发 APK');
}
assert(/online: \{ enabled: false/.test(R('utils/settings.js')), 'settings 里 online 段默认关');

console.log(fail === 0 ? '\n在线模式基础校验全部通过' : '\n失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);
