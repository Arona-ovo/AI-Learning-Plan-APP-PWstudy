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
