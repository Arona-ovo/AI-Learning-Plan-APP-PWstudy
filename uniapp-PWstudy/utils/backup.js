// utils/backup.js - 数据导出 / 导入（换机、清缓存前的救命稻草）
//
// 全本地 App，没有账号没有云，数据只有一份在 storage 里 —— 导出是唯一的退路。
// 设计取舍：
//   · 导出 = 生成 JSON 文本 → 复制剪贴板 / 存成文件（App 端）。
//     不做"系统分享"，各端行为差异太大，容易点了没反应。
//   · 导入 = 粘贴 JSON 文本。App 端没有可靠的文件选择器（Android 10+ 分区存储），
//     剪贴板反而是最稳、最通用的通道。
//   · 导入两种模式：merge（按 id 合并，不动已有进度）/ replace（整包覆盖）。
//     默认 merge —— 用户最怕的是"导入把我新数据冲掉"。

import * as pw from './pwstore.js';
import * as settings from './settings.js';

export const FORMAT = 'pwstudy-backup';
export const VERSION = 1;

export function buildPayload() {
  return {
    format: FORMAT,
    v: VERSION,
    at: Date.now(),
    atText: new Date().toLocaleString(),
    data: pw.get(),
    settings: settings.get()
  };
}

export function toJSON() {
  try { return JSON.stringify(buildPayload(), null, 2); } catch (e) { return ''; }
}

/**
 * 校验一段文本是不是自家备份。
 * 返回 { ok, payload, error, summary }
 */
export function parseJSON(text) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, error: '内容是空的' };
  let o = null;
  try {
    o = JSON.parse(t);
  } catch (e) {
    return { ok: false, error: '不是合法的 JSON（' + (e && e.message ? e.message : '解析失败') + '）' };
  }
  if (!o || typeof o !== 'object') return { ok: false, error: '内容不是一个对象' };
  if (o.format && o.format !== FORMAT) return { ok: false, error: '这不是 PWstudy 的备份文件' };
  const data = o.data && typeof o.data === 'object' ? o.data : o;
  if (!data || (!data.goals && !data.daily && !data.sessions)) {
    return { ok: false, error: '里面没有找到目标 / 每日记录 / 专注记录' };
  }
  const goals = Array.isArray(data.goals) ? data.goals : [];
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const daily = data.daily && typeof data.daily === 'object' ? Object.keys(data.daily) : [];
  return {
    ok: true,
    payload: { data, settings: o.settings || null },
    summary: {
      goals: goals.length,
      tasks: goals.reduce((n, g) => n + ((g && g.tasks) ? g.tasks.length : 0), 0),
      sessions: sessions.length,
      days: daily.length
    }
  };
}

function uniqPush(list, item, key) {
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i][key] && list[i][key] === item[key]) return false;
  }
  list.push(item);
  return true;
}

/**
 * 落地一份备份。
 * mode: 'merge'（默认，按 id 合并）/ 'replace'（整包覆盖）
 * 返回 { ok, added:{goals,sessions,days}, error }
 */
export function applyPayload(payload, mode) {
  try {
    const incoming = payload && payload.data ? payload.data : null;
    if (!incoming) return { ok: false, error: '备份内容为空' };
    const st = pw.get();
    const added = { goals: 0, sessions: 0, days: 0 };

    if (mode === 'replace') {
      st.goals = Array.isArray(incoming.goals) ? incoming.goals : [];
      st.sessions = Array.isArray(incoming.sessions) ? incoming.sessions : [];
      st.daily = (incoming.daily && typeof incoming.daily === 'object') ? incoming.daily : {};
      st.dock = Array.isArray(incoming.dock) ? incoming.dock : [];
      added.goals = st.goals.length;
      added.sessions = st.sessions.length;
      added.days = Object.keys(st.daily).length;
    } else {
      st.goals = Array.isArray(st.goals) ? st.goals : [];
      (Array.isArray(incoming.goals) ? incoming.goals : []).forEach(g => {
        if (g && g.id && uniqPush(st.goals, g, 'id')) added.goals++;
      });
      st.sessions = Array.isArray(st.sessions) ? st.sessions : [];
      (Array.isArray(incoming.sessions) ? incoming.sessions : []).forEach(s => {
        if (s && s.id && uniqPush(st.sessions, s, 'id')) added.sessions++;
      });
      st.daily = (st.daily && typeof st.daily === 'object') ? st.daily : {};
      const din = (incoming.daily && typeof incoming.daily === 'object') ? incoming.daily : {};
      Object.keys(din).forEach(k => {
        if (!(k in st.daily)) { st.daily[k] = din[k]; added.days++; }
      });
      // dock 也合并：用户可能换了手机，装的 App 不一样
      st.dock = Array.isArray(st.dock) ? st.dock : [];
      (Array.isArray(incoming.dock) ? incoming.dock : []).forEach(a => {
        if (a && a.pkg) uniqPush(st.dock, a, 'pkg');
      });
    }

    pw.touch();
    pw.flush();

    if (payload && payload.settings) {
      try {
        settings.set(payload.settings);
        settings.save();
      } catch (e) {}
    }
    return { ok: true, added };
  } catch (e) {
    return { ok: false, error: (e && e.message) || '导入失败' };
  }
}

/** 复制到剪贴板 */
export function copy(text) {
  try {
    uni.setClipboardData({ data: String(text), showToast: false });
    return true;
  } catch (e) {
    return false;
  }
}

export function paste(cb) {
  try {
    uni.getClipboardData({ success: r => cb && cb(String((r && r.data) || '')) , fail: () => cb && cb('') });
    return true;
  } catch (e) {
    cb && cb('');
    return false;
  }
}

/** App 端另存一份文件到应用沙盒（_doc），返回文件路径；失败返回 '' */
export function saveToFile(text) {
  // #ifdef APP-PLUS
  try {
    const name = 'pwstudy-backup-' + pw.today().replace(/-/g, '') + '.json';
    const path = '_doc/' + name;
    const fs = plus.io.requestFileSystem ? plus.io.requestFileSystem(plus.io.PRIVATE_DOC) : null;
    if (!fs) return '';
    fs.root.getFile(path, { create: true }, entry => {
      entry.createWriter(writer => {
        writer.onwrite = () => {};
        writer.onerror = () => {};
        writer.write(String(text));
      }, () => {});
    }, () => {});
    return path;
  } catch (e) {
    return '';
  }
  // #endif
  return '';
}
