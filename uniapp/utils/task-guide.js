// utils/task-guide.js - 任务学习要点的本地缓存
//
// 要点是"重算一次要几十秒、但内容不会变"的东西：任务名没变就别再问 AI 一遍。
// 单独一个 key，不与 ai-cache 的单词/句子缓存混在一起。
import { explainTask } from '../services/plan-agent.js';

const KEY = 'fj_pw_guide_v1';
const TTL = 30 * 86400000;   // 30 天

let cache = null;

function read() {
  if (cache) return cache;
  try {
    const v = uni.getStorageSync(KEY);
    cache = (v && typeof v === 'object') ? v : {};
  } catch (e) {
    cache = {};
  }
  return cache;
}

function write() {
  try { uni.setStorageSync(KEY, cache); } catch (e) {}
}

/** 缓存 key：任务 id + 任务标题（标题改了就当作新任务） */
function sigOf(task) {
  const id = String((task && task.id) || '');
  const title = String((task && task.title) || '');
  return id + '|' + title;
}

export function get(task) {
  if (!task) return null;
  const c = read();
  const hit = c[sigOf(task)];
  if (!hit || !hit.at || Date.now() - hit.at > TTL) return null;
  return hit.data || null;
}

export function has(task) {
  return !!get(task);
}

/**
 * 取要点：有缓存直接用，没有才问 AI。
 * 返回 { data, fromCache }；失败抛 Error（message 已是人话）。
 */
export async function fetch(task, goal) {
  const cached = get(task);
  if (cached) return { data: cached, fromCache: true };
  const data = await explainTask(task, goal);
  const c = read();
  c[sigOf(task)] = { at: Date.now(), data };
  write();
  return { data, fromCache: false };
}

/** 任务标题改了就顺手清掉它的旧要点 */
export function drop(taskId) {
  const c = read();
  const prefix = String(taskId || '') + '|';
  Object.keys(c).forEach(k => { if (k.indexOf(prefix) === 0) delete c[k]; });
  write();
}

export function clear() {
  cache = {};
  write();
}
