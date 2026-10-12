// services/backend.ts - 在线模式（服务器通道）的唯一入口
//
// 为什么服务器还不存在就要写：接服务器那天要改的东西越少越好。App 侧无非需要
// 这几样 —— 一个能关的通道、一份凭证、一个设备标识、一套"服务器靠不住就退回
// 本地"的规矩。这些全是 JS/TS，**将来接服务器不用发整包**（wgt 就能带上）。
//
// 现在开关默认关：所有调用立刻抛"未启用"，调用方走本地逻辑 —— 功能一条不少
// （跟伙伴 App 联动同一个原则：可选增强，关了不缺功能）。
//
// ⚠️ 哪些能力接服务器时**不能**只靠 wgt（必须云打包 APK）：
//   推送（要 manifest 权限 + 厂商通道）、微信/手机号一键登录（原生 SDK）、
//   内购、后台定位。纯 HTTP 接口 / 账号密码登录 / 数据同步 → 全是 JS，wgt 够。
//
// 分层：pages → services/backend.ts → services/http.js（熔断 / 超时 / 错误归一化）
// 业务层不该自己拼 URL、自己管 token —— 那正是"接服务器时到处要改"的根源。

import * as settings from '../utils/settings.js';
import * as http from './http.js';
import * as secure from '../utils/secure-storage.ts';

/** 会话凭证存在 plus 安全存储里（Android KeyStore / iOS Keychain），不落普通 storage */
const TOKEN_KEY = 'fj_online_token';

/** 单次请求的默认超时：在线功能不该让用户干等，慢了就降级 */
const TIMEOUT = 10000;

export interface OnlineConfig {
  enabled: boolean;
  baseUrl: string;
  deviceId: string;
  userId: string;
  lastSyncAt: number;
  lastError: string;
}

function cfg(): OnlineConfig {
  const s: any = settings.get() || {};
  return s.online || { enabled: false, baseUrl: '', deviceId: '', userId: '', lastSyncAt: 0, lastError: '' };
}

function patch(p: Partial<OnlineConfig>): OnlineConfig {
  settings.set({ online: p as any });
  return cfg();
}

/* ---------------- 开关与地址 ---------------- */

export function enabled(): boolean {
  return !!cfg().enabled;
}

export function setEnabled(on: boolean): boolean {
  return patch({ enabled: !!on }).enabled;
}

/**
 * 规范化地址：去掉结尾斜杠，**只认 http(s)**。
 * 为什么挑：手滑填成 `localhost:3000`（没协议）或 `ws://…` 时，uni.request 会
 * 用一个莫名其妙的 URL 发出去，然后卡到超时 —— 不如当场拒绝，让用户填对。
 */
export function normalizeUrl(raw: string): string {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  return s;
}

export function baseUrl(): string {
  return normalizeUrl(cfg().baseUrl);
}

/** @returns 是否存下来了（地址不合法就拒绝，并把开关一起关掉） */
export function setBaseUrl(raw: string): boolean {
  const u = normalizeUrl(raw);
  if (raw && !u) return false;
  patch(u ? { baseUrl: u } : { baseUrl: '', enabled: false });
  return true;
}

/** 通道可用：开关开了**且**地址填对了。两者缺一都算离线 */
export function ready(): boolean {
  return enabled() && !!baseUrl();
}

/* ---------------- 设备标识 ---------------- */

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * 本机标识（多设备同步时用来区分数据来自哪台机器）。
 * 只在第一次用到时生成并落盘 —— 提前生成会让"从没开过在线模式"的用户也多一条数据。
 */
export function deviceId(): string {
  const c = cfg();
  if (c.deviceId) return c.deviceId;
  const id = newId();
  patch({ deviceId: id });
  return id;
}

/* ---------------- 凭证 ---------------- */

export async function token(): Promise<string | null> {
  try { return await secure.getSecure(TOKEN_KEY); } catch (e) { return null; }
}

export async function setToken(t: string): Promise<void> {
  try {
    if (t) await secure.setSecure(TOKEN_KEY, t);
    else await clearToken();
  } catch (e) {}
}

export async function clearToken(): Promise<void> {
  try { await secure.removeSecure(TOKEN_KEY); } catch (e) {}
}

/** 服务端侧的账号 id（登录后回写） */
export function userId(): string {
  return cfg().userId || '';
}
export function setUserId(id: string): string {
  return patch({ userId: String(id || '') }).userId;
}

/* ---------------- 请求 ---------------- */

function offline(): never {
  // notConfigured：告诉调用方"这不是服务挂了，是压根没开" —— 不该熔断、不该重试
  throw new http.ServiceError('在线模式没开', { notConfigured: true, offline: true, degradable: true });
}

function urlOf(path: string): string {
  const p = String(path || '');
  return baseUrl() + (p.charAt(0) === '/' ? p : '/' + p);
}

async function headers(): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'x-device-id': deviceId() };
  const t = await token();
  if (t) h.Authorization = 'Bearer ' + t;
  const uid = userId();
  if (uid) h['x-user-id'] = uid;
  return h;
}

/**
 * 401 / 403 = 凭证失效：清掉本地 token 再抛。
 * 为什么必须清：留着旧 token 会让之后的每一次请求都稳定失败（还都是 401），
 * 用户看到的就是"在线功能全挂了"。清掉之后至少能走"重新登录"这条路。
 */
function onAuthError(): never {
  clearToken();
  throw new http.ServiceError('登录状态已失效，请重新登录', {
    status: 401, notConfigured: true, auth: true, degradable: true
  });
}

/**
 * 请求服务端。未启用 / 没地址 / 没登录 → 抛可降级的 ServiceError，
 * 调用方一律"能用就用，用不了走本地"。
 */
export async function call(path: string, body?: any, opt?: { timeout?: number; method?: string }): Promise<any> {
  if (!ready()) offline();
  const o = opt || {};
  const res = await http.request({
    url: urlOf(path),
    method: (o.method || (body == null ? 'GET' : 'POST')).toUpperCase(),
    data: body,
    headers: await headers(),
    timeout: o.timeout || TIMEOUT
  });
  if (res && (res.statusCode === 401 || res.statusCode === 403)) onAuthError();
  return res && res.data;
}

export async function get(path: string, opt?: { timeout?: number }): Promise<any> {
  return call(path, null, Object.assign({}, opt, { method: 'GET' }));
}

export async function post(path: string, body?: any, opt?: { timeout?: number }): Promise<any> {
  return call(path, body == null ? {} : body, Object.assign({}, opt, { method: 'POST' }));
}

/* ---------------- 同步状态（给 UI / 排查用） ---------------- */

export function markSynced(at?: number): void {
  patch({ lastSyncAt: at || Date.now(), lastError: '' });
}

export function markError(msg: string): void {
  patch({ lastError: String(msg || '').slice(0, 160) });
}

export function status(): { ready: boolean; enabled: boolean; baseUrl: string; lastSyncAt: number; lastError: string; hasToken: boolean } {
  return {
    ready: ready(),
    enabled: enabled(),
    baseUrl: baseUrl(),
    lastSyncAt: cfg().lastSyncAt || 0,
    lastError: cfg().lastError || '',
    hasToken: false   // token 是异步的，要准确值请 await token()
  };
}
