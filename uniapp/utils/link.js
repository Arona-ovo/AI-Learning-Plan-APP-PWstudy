// utils/link.js - 与「背单词 App」联动的接口约定
//
// 现在就把协议定死，省得那边做完了再返工改数据。三条通道：
//
// ① 出去：PWstudy → 背单词 App
//      awword://study?minutes=25&task=<taskId>&back=<urlencoded 回跳地址>
//    minutes 是本次建议时长；back 是学完回跳到 PWstudy 的地址（下面 ②）。
//
// ② 回来：背单词 App → PWstudy
//      pwstudy://vocab-done?min=25&words=30&task=<taskId>
//    收到就按 min 把时长记进当天统计（归到 app:awword 名下，和 AppDock 同一口径）。
//
// ③ 直达：外部 → PWstudy 的某个目标/任务
//      pwstudy://goal/<goalId>?task=<taskId>
//    打开目标详情（带 task 时直接进专注页并绑好任务）。
//
// 字段名一律小写、时间统一分钟、id 用 PWstudy 自己的 uid。任何一端加字段都只能加可选。

import * as pw from './pwstore.js';

export const SCHEME = 'pwstudy';
export const PARTNER_SCHEME = 'awword';   // 背单词 App 的 scheme（那边要配同样的）
export const PARTNER_KEY = 'app:awword';  // 外部 App 时长在统计里的归属 key

function enc(s) {
  return encodeURIComponent(String(s == null ? '' : s));
}

/** 解析一条 pwstudy:// 链接 */
export function parse(url) {
  const raw = String(url || '');
  const i = raw.indexOf('://');
  if (i < 0) return null;
  const scheme = raw.slice(0, i).toLowerCase();
  if (scheme !== SCHEME) return null;
  let rest = raw.slice(i + 3);
  let query = '';
  const q = rest.indexOf('?');
  if (q >= 0) { query = rest.slice(q + 1); rest = rest.slice(0, q); }
  const parts = rest.split('/').filter(Boolean);
  const params = {};
  query.split('&').forEach(kv => {
    if (!kv) return;
    const p = kv.split('=');
    params[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
  });
  const kind = parts[0] || '';
  const goalId = kind === 'goal' ? (parts[1] || '') : (params.goal || params.goalId || '');
  return { kind, goalId, taskId: params.task || params.taskId || '', params };
}

/** 生成"呼起背单词 App"的链接 */
export function toPartner(task, minutes) {
  const taskId = task ? (task.id || task.taskId || '') : '';
  const back = SCHEME + '://vocab-done?min=' + (minutes || 25) + (taskId ? '&task=' + enc(taskId) : '');
  return PARTNER_SCHEME + '://study?minutes=' + (minutes || 25) +
    (taskId ? '&task=' + enc(taskId) : '') +
    '&back=' + enc(back);
}

/** 外部 App 回报的学习时长落账（与 AppDock 同一张表，只是归属 key 不同） */
export function recordExternal(minutes, extra) {
  const min = Math.round(Number(minutes));
  if (!(min > 0)) return false;
  try {
    pw.addAppMinutes(pw.today(), PARTNER_KEY, min);
    const st = pw.get();
    st.external = st.external || {};
    const today = pw.today();
    st.external[today] = (st.external[today] || 0) + min;
    if (extra && extra.words) {
      st.externalWords = (st.externalWords || 0) + Math.round(Number(extra.words) || 0);
    }
    pw.touch();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 处理一条进来的链接（App.vue 启动与 newintent 时调用）。
 * 返回 true 表示认领了这条链接。
 */
export function handle(url) {
  const link = parse(url);
  if (!link) return false;
  if (link.kind === 'vocab-done') {
    recordExternal(link.params.min, { words: link.params.words, task: link.taskId });
    try {
      uni.showToast({ title: '背单词 ' + (link.params.min || 0) + ' 分钟已计入', icon: 'none' });
    } catch (e) {}
    return true;
  }
  if (link.kind === 'goal' && link.goalId) {
    if (link.taskId) {
      uni.navigateTo({
        url: '/pkgPlan/pages/focus/focus?auto=1&taskId=' + link.taskId +
             '&goalId=' + link.goalId + '&title=' + enc(link.params.title || '任务')
      });
    } else {
      uni.navigateTo({ url: '/pkgPlan/pages/goal-detail/goal-detail?id=' + link.goalId });
    }
    return true;
  }
  if (link.kind === 'focus' && link.taskId) {
    uni.navigateTo({
      url: '/pkgPlan/pages/focus/focus?auto=1&taskId=' + link.taskId +
           '&goalId=' + link.goalId + '&title=' + enc(link.params.title || '任务')
    });
    return true;
  }
  return false;
}

/** 给"背单词 App"用的：把某个任务的学习时长目标带过去 */
export function openPartner(task, minutes) {
  const url = toPartner(task, minutes);
  // #ifdef APP-PLUS
  try {
    plus.runtime.openURL(url);
    return true;
  } catch (e) {}
  // #endif
  return false;
}
