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
//    min → byApp['app:awword']（和 AppDock 同一张表，首页/统计页直接可见）
//    words → daily[].vocabWords（UsageStats 测不到，只能靠回传）
//
// ③ 直达：外部 → PWstudy 的某个目标/任务
//      pwstudy://goal/<goalId>?task=<taskId>
//    打开目标详情（带 task 时直接进专注页并绑好任务）。
//
// 字段名一律小写、时间统一分钟、id 用 PWstudy 自己的 uid。任何一端加字段都只能加可选。

import * as pw from './pwstore.js';
import * as partner from './partner.js';

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

/**
 * 生成"呼起背单词 App"的链接。
 *
 * minutes 保持在第一个参数位（老版本对方也是这么解析的）；
 * v 与 linked 是后加的可选字段，按协议第 10.2 条"加字段只能加可选"：
 *   · v      = 协议版本，对方遇到不认识的版本按 v1 处理，不许拒绝服务
 *   · linked = 这边当前是不是已关联，对方据此决定"要不要显示来路横幅 / 学完自动回来"
 *             未关联时也照跳 —— 用户是点了 PWstudy 里的入口才过去的，回不去像被绑架。
 */
export function toPartner(task, minutes) {
  const taskId = task ? (task.id || task.taskId || '') : '';
  const back = SCHEME + '://vocab-done?min=' + (minutes || 25) + (taskId ? '&task=' + enc(taskId) : '');
  return PARTNER_SCHEME + '://study?minutes=' + (minutes || 25) +
    '&v=' + partner.PROTOCOL_V +
    '&linked=' + (partner.isLinked() ? '1' : '0') +
    (taskId ? '&task=' + enc(taskId) : '') +
    '&back=' + enc(back);
}

/**
 * 外部 App 回报的学习数据落账。两个数分开走，因为它们本来就是两件事：
 *   · 时长 → byApp[PARTNER_KEY]：和 AppDock 同一张表，首页 sumAppMin() 与
 *     统计页 buildAppRows() 都读它，所以"背单词 25 分钟"会直接出现在今日用时里。
 *   · 词数 → daily[].vocabWords：UsageStats 只测得到时长、测不到你在里面过了几个词，
 *     只能靠回传。按天记，才能回答"今天背了多少"。
 * ⚠️ 别再另记一份"external 总账"—— 同一笔时长记两处，早晚对不上，而且没人读第二份。
 */
export function recordExternal(minutes, extra) {
  const min = Math.round(Number(minutes));
  if (!(min > 0)) return false;
  try {
    const day = pw.today();
    pw.addAppMinutes(day, PARTNER_KEY, min);
    const words = extra && extra.words ? Math.round(Number(extra.words)) : 0;
    if (words > 0) pw.addVocabWords(day, words);
    // 同步"意愿"与"事实"两件事：上面落的是今天背了多少，这里记的是"链路真的通了"。
    // 设置页靠 lastSyncAt 才能说清"已关联但一直没同步到数据"——那种情况用户看不出来。
    partner.noteSync(min, words);
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
    const min = Math.round(Number(link.params.min) || 0);
    const words = Math.round(Number(link.params.words) || 0);
    recordExternal(min, { words: link.params.words, task: link.taskId });
    try {
      uni.showToast({
        title: '背单词 ' + min + ' 分钟' + (words > 0 ? ' · ' + words + ' 词' : '') + '，已记入今日',
        icon: 'none'
      });
    } catch (e) {}
    return true;
  }
  if (link.kind === 'goal' && link.goalId) {
    if (link.taskId) {
      // 不带 auto=1：进准备页让人确认时长（起表只由准备页那颗确认按钮负责）
      uni.navigateTo({
        url: '/pkgPlan/pages/focus/focus?taskId=' + link.taskId +
             '&goalId=' + link.goalId + '&title=' + enc(link.params.title || '任务')
      });
    } else {
      uni.navigateTo({ url: '/pkgPlan/pages/goal-detail/goal-detail?id=' + link.goalId });
    }
    return true;
  }
  if (link.kind === 'focus' && link.taskId) {
    uni.navigateTo({
      url: '/pkgPlan/pages/focus/focus?taskId=' + link.taskId +
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
