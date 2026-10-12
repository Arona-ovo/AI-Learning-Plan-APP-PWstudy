// services/cloud-sync.ts - 云同步的调度与服务端契约（骨架）
//
// 服务器还没接，这里先把"怎么同步"定下来 —— 定契约比写实现重要：
// 契约早定，服务端照着做就行；契约不定，等服务端写完了再来凑，两边都得改。
//
// 三条规矩：
//  1. **只同步学习数据**（studyRecords / wordFavorites）。users 表**永远不推** ——
//     它带 password_hash，推上去等于把密码哈希交出去，一次事故就是全量泄露。
//     账号资料以后要同步，单独开 /me 接口传昵称头像，不复用这张表。
//  2. **没推成功就不标记已同步**：markSynced 只在服务端确认收到之后调用，
//     失败的数据留在 pending 里下次再来 —— 宁可重复推，不能丢。
//  3. **拉下来的不能直接盖本地**：按 updated_at 比，谁新用谁（last-write-wins）。
//     本地更旧才覆盖；本地更新就保留本地，等下一次 push 把它带上去。
//
// 服务端要实现的两个接口（完整字段见 uniapp/docs/online-mode.md）：
//   POST /sync/push   { deviceId, tables: { studyRecords:[Row], wordFavorites:[Row] } }
//                     → { applied: { studyRecords:[uuid], wordFavorites:[uuid] }, serverTime }
//   GET  /sync/pull?since=<毫秒时间戳>
//                     → { serverTime, tables: { studyRecords:[Row], wordFavorites:[Row] } }

import { getRepositories } from '../repositories/index.ts';
import * as backend from './backend.ts';
import { ServiceError } from './http.js';

/** 参与同步的表。**加表要同时改服务端**，并且确认那张表没有敏感字段 */
export const SYNC_TABLES = ['studyRecords', 'wordFavorites'] as const;
export type SyncTable = typeof SYNC_TABLES[number];

/** 一批最多推多少条：太大了一次请求容易超时，失败了整批重来还更慢 */
const BATCH = 200;

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  error?: string;
  /** 服务端时间（成功时才有）—— 用它当下次拉取的 since，比本地时钟可靠 */
  serverTime?: number;
}

function repoOf(table: SyncTable): any {
  const repos: any = getRepositories();
  return repos[table];
}

/** 取出待同步的行（sync_status = pending） */
async function pendingOf(table: SyncTable): Promise<any[]> {
  const r = repoOf(table);
  if (!r || !r.findPendingSync) return [];
  try {
    const uid = backend.userId();
    // 两个仓储的签名略有差别：users 不收 user_id，这里按表分别处理
    const rows = table === 'wordFavorites' || table === 'studyRecords'
      ? await r.findPendingSync(uid, BATCH)
      : await r.findPendingSync(BATCH);
    return Array.isArray(rows) ? rows : [];
  } catch (e) { return []; }
}

/**
 * 推：把本地待同步的改动交给服务端，**服务端确认收到哪些、才标记哪些**。
 * 为什么不整批标：服务端可能只收下其中一部分（校验失败 / 重复），
 * 按它返回的 applied 列表标记才不会丢数据。
 */
export async function push(): Promise<{ pushed: number; serverTime?: number }> {
  const tables: Record<string, any[]> = {};
  for (const t of SYNC_TABLES) {
    const rows = await pendingOf(t);
    if (rows.length) tables[t] = rows;
  }
  const total = Object.keys(tables).reduce((a, k) => a + tables[k].length, 0);
  if (!total) return { pushed: 0 };

  const res = await backend.post('/sync/push', { deviceId: backend.deviceId(), tables });
  const applied = (res && res.applied) || {};

  let done = 0;
  for (const t of SYNC_TABLES) {
    const uuids: string[] = Array.isArray(applied[t]) ? applied[t] : [];
    if (!uuids.length) continue;
    try {
      const r = repoOf(t);
      // 只有服务端明确"收到了"的才标记 —— 没列出的留在 pending，下次再推
      await r.markSynced(uuids, 'synced');
      done += uuids.length;
    } catch (e) {}
  }
  return { pushed: done, serverTime: res && res.serverTime };
}

/**
 * 拉：按 updated_at 比，远端更新才覆盖本地。
 * 本地是新的就跳过（它会在下一次 push 带上去），不做"谁也别动"的第三种状态 ——
 * 那种状态下用户看到的是数据卡住不动，比偶尔覆盖一次更难解释。
 */
export async function pull(since?: number): Promise<{ pulled: number; serverTime?: number }> {
  const t0 = since == null ? (backend.status().lastSyncAt || 0) : since;
  const res = await backend.get('/sync/pull?since=' + encodeURIComponent(String(t0)));
  const tables = (res && res.tables) || {};
  let n = 0;

  for (const t of SYNC_TABLES) {
    const rows: any[] = Array.isArray(tables[t]) ? tables[t] : [];
    if (!rows.length) continue;
    const r = repoOf(t);
    if (!r) continue;
    for (const row of rows) {
      if (!row || !row.uuid) continue;
      try {
        const mine = await r.findByUuid(row.uuid);
        if (mine && Number(mine.updated_at || 0) >= Number(row.updated_at || 0)) continue;
        const patchRow = Object.assign({}, row, { sync_status: 'synced' });
        if (mine) await r.update(row.uuid, patchRow);
        else if (r.create) await r.create(patchRow);
        n++;
      } catch (e) {}
    }
  }
  return { pulled: n, serverTime: res && res.serverTime };
}

/**
 * 同步一次：先推后拉。
 *
 * 任一步失败都**不动数据**、只记错误 —— 同步失败不该改变用户看到的内容，
 * 也不该弹窗打扰（在线模式是增强，不是主流程）。下次调用自然重试。
 */
export async function syncOnce(opt?: { since?: number }): Promise<SyncResult> {
  if (!backend.ready()) {
    return { ok: false, pushed: 0, pulled: 0, error: '在线模式没开' };
  }
  let pushed = 0;
  let pulled = 0;
  let serverTime: number | undefined;
  try {
    const a = await push();
    pushed = a.pushed;
    serverTime = a.serverTime;
    const b = await pull((opt && opt.since) != null ? opt!.since : serverTime);
    pulled = b.pulled;
    serverTime = b.serverTime || serverTime;
    backend.markSynced(serverTime);
    return { ok: true, pushed, pulled, serverTime };
  } catch (e) {
    const msg = e instanceof ServiceError ? e.message : String((e && e.message) || e);
    backend.markError(msg);
    return { ok: false, pushed, pulled, error: msg };
  }
}

/** 给 UI / 排查看：同步开关、上次成功时间、待同步条数、上次错误 */
export async function status(): Promise<{
  ready: boolean; lastSyncAt: number; lastError: string; pending: number;
}> {
  let pending = 0;
  for (const t of SYNC_TABLES) pending += (await pendingOf(t)).length;
  const s = backend.status();
  return { ready: s.ready, lastSyncAt: s.lastSyncAt, lastError: s.lastError, pending };
}
