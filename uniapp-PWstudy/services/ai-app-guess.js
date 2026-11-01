// services/ai-app-guess.js - 根据应用名称/包名推测学习用途
//
// 用于「学习 App」添加应用时自动填充：
//   · purpose = 'study' | 'rest'
//   · task    = 具体任务说明（如「背单词」「看英语学习视频」）
//
// 走统一 LLM 层，未配置 / 失败 / 超时一律抛可降级错误，由调用方兜底。

import { complete } from './llm.js';
import { isAIEnabled } from './config.js';
import { featureOn } from './ai-gate.js';

// 从模型返回中抽取第一个 JSON 对象（容忍 ```json 代码块与前后废话）
function extractJSON(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  const end = s.lastIndexOf('}');
  if (end < start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { return null; }
}

/**
 * 根据应用名称和包名推测用途。
 * @returns {Promise<{purpose:'study'|'rest', task:string}>}
 *   失败时抛出 LLMError（degradable），调用方应回退到默认值。
 */
export async function guessAppTask(name, pkg) {
  if (!isAIEnabled()) {
    const err = new Error('AI 服务未启用');
    err.degradable = true;
    err.notConfigured = true;
    throw err;
  }
  // 跟"没启用"同一个可降级出口：调用方本来就打算兜底，这里换个说法而已
  if (!featureOn('appguess')) {
    const err = new Error('「AI 猜 App 用途」已在设置里关闭');
    err.degradable = true;
    err.notConfigured = true;
    throw err;
  }
  const prompt = [
    '你是一名学习助手，正在帮用户判断手机应用是用于学习还是休息。',
    '请根据应用名称和包名，给出最可能的用途分类和具体学习任务说明。',
    '',
    '规则：',
    '1. 只输出 JSON，不要任何解释。',
    '2. purpose 只能是 "study" 或 "rest"。',
    '3. 如果是学习类 App，task 应填写具体学习任务（如：背单词、刷数学选择题、看英语听力视频、背政治知识点、练习口语、查词典、整理错题）。',
    '4. 如果是休息/娱乐/社交/工具类 App，task 留空字符串。',
    '5. 若判断不准，优先判为 study 并给一个宽泛但合理的任务说明。',
    '',
    '应用名称：' + (name || ''),
    '包名：' + (pkg || ''),
    '',
    '输出示例：{"purpose":"study","task":"背单词"}'
  ].join('\n');

  const raw = await complete(prompt, { temperature: 0.3, timeout: 8000 });
  const o = extractJSON(raw);
  if (!o || (o.purpose !== 'study' && o.purpose !== 'rest')) {
    const err = new Error('AI 返回格式异常');
    err.degradable = true;
    throw err;
  }
  return {
    purpose: o.purpose,
    task: String(o.task || '').trim().slice(0, 30)
  };
}

/**
 * 一次给一批 App 归类：学习 / 休闲 / 不用管。
 *
 * 两个地方都用它：
 *   ① 休闲 App 的「让 AI 推荐」—— 从已装列表里挑出最容易拖走注意力的；
 *   ② 自动补全 —— 把"今天用过但没登记"的 App 分好类，一键（或全自动）收进两份清单。
 * 一次问一批而不是一个个问：几十个 App 逐个请求又慢又贵，还容易被限流。
 *
 * @param {{pkg:string,name:string}[]} apps
 * @param {{hint?:string, max?:number}} opts hint = 额外上下文（如"这些是今天用过的"）
 * @returns {Promise<{items:{pkg:string,kind:'study'|'leisure'|'skip',task:string}[]}>}
 *   失败抛可降级错误，调用方兜底（推荐区显示"再试一次"，自动补全退回手动选）。
 */
export async function classifyApps(apps, opts) {
  if (!isAIEnabled()) {
    const err = new Error('AI 服务未启用');
    err.degradable = true;
    err.notConfigured = true;
    throw err;
  }
  if (!featureOn('appguess')) {
    const err = new Error('「AI 猜 App 用途」已在设置里关闭');
    err.degradable = true;
    err.notConfigured = true;
    throw err;
  }
  const o = opts || {};
  const max = Number(o.max) > 0 ? Number(o.max) : 80;
  const list = (Array.isArray(apps) ? apps : [])
    .filter(a => a && a.pkg && a.name)
    .slice(0, max)
    .map(a => '- ' + a.name + '（' + a.pkg + '）')
    .join('\n');
  if (!list) return { items: [] };
  const prompt = [
    '你是一名学习助手，正在帮学生把手机里的 App 分类。',
    o.hint ? ('背景：' + o.hint) : '',
    '',
    '下面是他手机里的应用名单。请逐个判断属于哪一类：',
    '- study：学习用（背单词、网课、刷题、词典、笔记、错题、听力、考研/考公题库）',
    '- leisure：消遣用（短视频、社交、游戏、直播、影视、购物、小说、音乐）',
    '- skip：系统与工具（系统设置、桌面、输入法、应用商店、文件管理、相机、支付、银行、地图、外卖、工具类）',
    '',
    '规则：',
    '1. 只输出 JSON，不要任何解释。',
    '2. pkg 必须与名单完全一致，一个都不要漏、不要编。',
    '3. kind 只能是 "study" / "leisure" / "skip"。',
    '4. study 的 task 写一句 10 字内的用途（如"背单词"）；leisure / skip 的 task 留空。',
    '5. 拿不准时：有明显学习内容（课程、题库、词典、单词）判 study，其余按 skip 处理，不要硬判 leisure。',
    '',
    '应用名单：',
    list,
    '',
    '输出示例：{"items":[{"pkg":"cn.xxx","kind":"study","task":"背单词"}]}'
  ].filter(s => s !== '').join('\n');

  const raw = await complete(prompt, { temperature: 0.2, timeout: 20000 });
  const obj = extractJSON(raw);
  const items = (obj && Array.isArray(obj.items) ? obj.items : [])
    .filter(x => x && x.pkg)
    .map(x => {
      const kind = (x.kind === 'study' || x.kind === 'leisure') ? x.kind : 'skip';
      return {
        pkg: String(x.pkg),
        kind: kind,
        task: kind === 'study' ? String(x.task || '').trim().slice(0, 20) : ''
      };
    });
  return { items: items };
}

/**
 * 按当前目标从"手机里已安装的应用"里推荐学习 App（2026-10-25 真机反馈）：
 * AI 规划完目标，下一步就是把配套的学习 App 登记进来 —— 但几百个应用里
 * 让用户自己一个个翻太费劲，让 AI 按目标先挑一茬，用户勾一下就行。
 *
 * @param {{pkg:string,name:string}[]} apps 已安装且尚未添加的应用（name+pkg）
 * @param {string} goalsText 目标上下文（目标标题 + 待办任务名，多行）
 * @returns {Promise<{picks:{pkg:string,task:string}[]}>} 按可能性排序，最多 8 个
 *   失败时抛错，由调用方兜底（展示"再试一次"，不打断手动添加）。
 */
export async function recommendStudyApps(apps, goalsText) {
  if (!isAIEnabled()) {
    const err = new Error('AI 服务未启用');
    err.degradable = true;
    err.notConfigured = true;
    throw err;
  }
  if (!featureOn('appguess')) {
    const err = new Error('「AI 猜 App 用途」已在设置里关闭');
    err.degradable = true;
    err.notConfigured = true;
    throw err;
  }
  const list = (Array.isArray(apps) ? apps : [])
    .filter(a => a && a.pkg && a.name)
    .slice(0, 120)   // 封顶：名单太长又贵又容易让模型走神
    .map(a => '- ' + a.name + '（' + a.pkg + '）')
    .join('\n');
  if (!list) return { picks: [] };
  const prompt = [
    '你是学习助手。学习者的目标如下：',
    String(goalsText || '（未填写）'),
    '',
    '下面是他手机里已安装的应用名单。请挑出最可能**用于学习**的'
    + '（背单词、网课、刷题、词典、笔记、错题、听力这类），最多 8 个，按可能性从高到低排。',
    '',
    '规则：',
    '1. 只输出 JSON，不要任何解释。',
    '2. 只准从名单里挑，pkg 必须与名单完全一致；拿不准的一律不选。',
    '3. 娱乐 / 社交 / 视频 / 系统工具类不选（B 站这类学习视频 App 除外 —— 名单里有就选）。',
    '4. task 是给这个 App 的用途说明，10 字内（如"背单词""看专升本网课"）。',
    '5. 一个都挑不出就给空数组，不要硬凑。',
    '',
    '应用名单：',
    list,
    '',
    '输出示例：{"picks":[{"pkg":"cn.xxx","task":"背单词"}]}'
  ].join('\n');

  const raw = await complete(prompt, { temperature: 0.3, timeout: 15000 });
  const o = extractJSON(raw);
  const picks = (o && Array.isArray(o.picks) ? o.picks : [])
    .filter(p => p && p.pkg)
    .map(p => ({ pkg: String(p.pkg), task: String(p.task || '').trim().slice(0, 20) }));
  return { picks: picks.slice(0, 8) };
}
