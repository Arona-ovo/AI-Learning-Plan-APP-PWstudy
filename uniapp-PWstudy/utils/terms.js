// utils/terms.js - 产品术语口径
//
// ★ 为什么不叫「番茄」：番茄工作法 / 番茄钟 / 番茄ToDo 都是别家产品的叫法，
//   我们最早照着它做的，但对外一律叫「专注」，计量单位是「段」。
//   模型训练语料里"番茄"太常见，光在 prompt 里禁不够（真机截图漏出来过），
//   所以加这道确定性清洗：所有 AI 生成的文案都过一遍 deBrand。
//
// 三道闸：
//   ① prompt 里的 TERM_RULE（约束模型别这么说）
//   ② services/llm.js 在返回前洗一遍（兜住所有调用方，包括以后新加的）
//   ③ 页面渲染前的字段级清洗（normalize* 里，防止老数据 / 本地兜底文案漏网）

// 「番茄」系列 → 专注（顺序敏感：先长词后短词）
const BRAND_WORDS = /番茄工作法|番茄钟|番茄/g;

export function deBrand(v) {
  const raw = String(v == null ? '' : v);
  if (!raw) return '';
  let s = raw.replace(BRAND_WORDS, '专注');
  // 量词跟着改：专注论「段」不论「个」（3-4 个专注 → 3-4 段专注）
  s = s.replace(/(\d+(?:\.\d+)?(?:\s*[-–—~～至到]\s*\d+(?:\.\d+)?)?)\s*个\s*专注/g, '$1 段专注');
  s = s.replace(/([一二三四五六七八九十两半]+)\s*个\s*专注/g, '$1 段专注');
  s = s.replace(/个专注/g, '段专注');
  return s;
}

// 递归清洗：AI 返回的 JSON 结构里，凡是字符串字段都过一遍
export function deBrandDeep(o) {
  if (typeof o === 'string') return deBrand(o);
  if (Array.isArray(o)) return o.map(deBrandDeep);
  if (o && typeof o === 'object') {
    const out = {};
    Object.keys(o).forEach(k => { out[k] = deBrandDeep(o[k]); });
    return out;
  }
  return o;
}

// 流式输出专用：一块可能正好停在「番」上，直接替换会漏掉半个词。
// 返回 { head: 现在能安全发出去的, tail: 先扣着等下一块的 }。
export function cutBrandTail(t) {
  const m = /(番茄工作法|番茄钟|番茄)$/.exec(String(t || ''));
  if (!m) return { head: String(t || ''), tail: '' };
  return { head: String(t).slice(0, String(t).length - m[0].length), tail: m[0] };
}

// prompt 里的硬约束（编号用 0，不占各 prompt 自己的规则序号）
export const TERM_RULE = '0. **用词**：专注的计量单位是「段」（例：每天 3-4 段专注），'
  + '**绝对不要**说「番茄 / 番茄钟 / 番茄工作法 / pomodoro」—— 那是别家产品的叫法；';
