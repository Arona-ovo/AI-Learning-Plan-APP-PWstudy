// utils/pwreset.js - 「清除学习数据」的唯一入口
//
// 为什么要单独一个文件：清一次数据要惊动 5 个模块
// （主库 / 番茄现场 / 规划会话 / 任务要点缓存 / AI 缓存），
// 而这些模块之间不能互相 import —— focus → pwstore 是单向的，反过来就成环，
// 所以必须有一个站在它们上面的人统一喊停。调用方目前只有设置页一处。
//
// 边界（很重要）：只清「学习数据」。
// AI 配置 / 外观 / 昵称 / 番茄时长 都在 settings.js 的 fj_app_settings_v1，
// 那是偏好不是数据 —— 想清偏好走「退出登录」（settings.reset()）。
// 以前这里调的是老 App 的 utils/store.js（key fj_eng_state_v1，装的是掌握度和错题本）：
// 点一下清的是别的 App 的库，PWstudy 自己的目标/番茄一动不动 —— 2026-10-10 修正。

import * as pw from './pwstore.js';
import * as focus from './focus.js';
import * as planTask from './plan-task.js';
import * as guide from './task-guide.js';
import * as aiCache from './ai-cache.js';

/**
 * 清掉全部学习数据。
 * 返回清之前有多少东西（给弹窗汇报"清掉了多少"，也让调用方能判断是不是真清了）。
 */
export function clearAll() {
  const st = pw.get();
  const gone = {
    goals: (st.goals || []).length,
    sessions: (st.sessions || []).length,
    days: Object.keys(st.daily || {}).length,
    dock: (st.dock || []).length,
    running: false
  };

  // 顺序有讲究：**先停表，再清库**。
  // 反过来的话 focus 的 persist() 会把刚清掉的番茄现场又写回来，清了等于没清。
  try { gone.running = !!focus.abort(); } catch (e) {}
  // 下面几个各自独立：任何一个不在（平台差异 / 模块没初始化）都不该拖住清数据
  try { planTask.reset(); } catch (e) {}
  try { guide.clear(); } catch (e) {}
  try { aiCache.clearAll(); } catch (e) {}

  pw.reset();
  return gone;
}

/** 一句话汇报清掉了什么（弹窗/吐司用；全空时说"本来就没有数据"） */
export function summary(gone) {
  const g = gone || {};
  const n = (g.goals || 0) + (g.sessions || 0) + (g.days || 0) + (g.dock || 0);
  if (!n && !g.running) return '本来就没有学习数据';
  const parts = [];
  if (g.goals) parts.push(g.goals + ' 个目标');
  if (g.sessions) parts.push(g.sessions + ' 个番茄');
  if (g.days) parts.push(g.days + ' 天记录');
  if (g.dock) parts.push(g.dock + ' 个 Dock App');
  return '已清除 ' + parts.join('、') + (g.running ? '（进行中的番茄已停止）' : '');
}
