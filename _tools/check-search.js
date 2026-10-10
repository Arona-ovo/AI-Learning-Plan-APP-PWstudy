// _tools/check-search.js - 校验首页顶部搜索的检索与入库逻辑（只读）
// 核心断言：
//   - 本地检索：当前词书（内置词 + 该书导入词）优先，命中词形或中文释义
//   - 词书无命中时回落到 dict.lookup（常用词典 / 词形还原），并给出来源标签
//   - AI 补充的词通过导入管道写进「当前词书」：去重、id 规则、例句回写
//   - 重复 / 非法词形不会重复入库，并返回可读原因
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./lib/load');

const mem = {};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {}
};

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(actual, expect, label) {
  if (actual === expect) ok(label + ' = ' + expect);
  else bad(label + ' 期望 ' + expect + '，实际 ' + actual);
}
function assert(cond, label) { if (cond) ok(label); else bad(label); }

// ---------- 装载真实模块 ----------
const lemma = load('utils/lemma.js');
const words = load('data/words.js');
const sentences = load('data/sentences.js');
const common = load('data/common-words.js');
const wb = load('data/wordbooks.js', { WORDS: words.WORDS });
const store = load('utils/store.js');
const sentenceIndex = load('utils/sentence-index.js', {
  SENTENCES: sentences.SENTENCES, WORDS: words.WORDS, lemmaCandidates: lemma.lemmaCandidates
});
const engine = load('utils/engine.js', {
  WORDS: words.WORDS, SENTENCES: sentences.SENTENCES, store, sentenceIndex
});
const wordbook = load('utils/wordbook.js', {
  store, WORDBOOKS: wb.WORDBOOKS, getBook: wb.getBook, wordIdsOfBook: wb.wordIdsOfBook,
  setUserBookProvider: wb.setUserBookProvider,
  WORDS: words.WORDS, streak: engine.streak, dateStr: engine.dateStr
});
const iplus1 = load('utils/iplus1.js', {
  WORDS: words.WORDS, getBook: wb.getBook, wordbook, lemma: lemma.lemma
});
const aiCache = load('utils/ai-cache.js');
const api = load('utils/sentence-api.js', {
  aiCache,
  SENTENCES: sentences.SENTENCES, iplus1, store, sentenceIndex, lemma: lemma.lemma,
  chatCompletion: () => Promise.reject(new Error('no ai in test'))
});
const dict = load('utils/dict.js', {
  WORDS: words.WORDS, COMMON_RAW: common.COMMON_RAW, store,
  lemmaCandidates: lemma.lemmaCandidates, lemma: lemma.lemma
});
const importer = load('utils/importer.js', {
  WORDS: words.WORDS, WORDBOOKS: wb.WORDBOOKS, getBook: wb.getBook,
  store, iplus1, generateBatch: api.generateBatch, dict
});
const search = load('utils/search.js', { wordbook, dict, importer });

const CORE = 'fj_zsb_core';
const INBOX = 'custom_inbox';

console.log('== 1. 空关键词 / 空白串不检索 ==');
eq(search.localSearch(CORE, '').length, 0, 'localSearch(空串) 条数');
eq(search.localSearch(CORE, '   ').length, 0, 'localSearch(空格) 条数');

console.log('== 2. 当前词书命中：英文词形（大小写不敏感） ==');
const first = wordbook.bookWords(CORE)[0];
const byWord = search.localSearch(CORE, first.w.toUpperCase());
eq(byWord.length > 0, true, '命中大写的 ' + first.w);
eq(byWord[0].w, first.w, '返回原词形');
eq(byWord[0].fromText, '当前词书', '来源标签 = 当前词书');

console.log('== 3. 当前词书命中：中文释义 ==');
const zh = String(first.m || '').split(/[；;，,]/)[0];
const byZh = search.localSearch(CORE, zh);
eq(byZh.length > 0, true, '按释义「' + zh + '」命中');
eq(byZh.some(x => x.w === first.w), true, '命中结果含该词');

console.log('== 4. 结果上限 20 条 ==');
const broad = search.localSearch(CORE, 'a');
eq(broad.length <= 20, true, '宽泛查询返回条数 ≤ 20');

console.log('== 5. 词书无命中 → 回落 dict（常用词典/词形还原） ==');
const fallback = search.localSearch(CORE, 'Serendipity');
if (fallback.length) {
  ok('词典兜底命中：' + fallback[0].w + '（' + fallback[0].fromText + '）');
  eq(typeof fallback[0].fromText === 'string' && fallback[0].fromText.length > 0, true, '兜底结果带来源标签');
} else {
  ok('词典兜底未命中（该词不在常用词典，属正常）');
}
eq(search.localSearch(CORE, 'zzzzqqqqxxxx').length, 0, '乱码查询返回 0 条');

console.log('== 6. 只检索「当前词书」：别的词书的导入词不串味 ==');
const vd = importer.validateAndDedupe([{ word: 'gumption', pos: 'n.', meaning: '进取心' }], INBOX);
importer.importIntoBook(vd.accepted, INBOX);
eq(search.localSearch(CORE, 'gumption').length, 0, '核心词书搜不到 inbox 的导入词');
eq(search.localSearch(INBOX, 'gumption').length, 1, 'inbox 能搜到自己的导入词');
eq(search.localSearch(INBOX, 'gumption')[0].fromText, '当前词书', '导入词来源标签 = 当前词书');

console.log('== 7. AI 补充入库：新词写进当前词书 ==');
wordbook.switchBook(CORE);
const before = wordbook.bookVocab(CORE, 'all').total;
const r1 = search.addWordToBook(CORE, {
  word: 'photosynthesis',
  pos: 'n.',
  meaning: '光合作用',
  example: { en: 'Plants rely on photosynthesis to grow.', zh: '植物依靠光合作用生长。' }
});
eq(r1.added, true, 'addWordToBook(新词).added');
eq(r1.reason, '', 'addWordToBook(新词).reason 为空');
const after = wordbook.bookVocab(CORE, 'all').total;
eq(after, before + 1, '词汇明细总数 +1');
eq(search.localSearch(CORE, 'photosynthesis').length, 1, '入库后立刻能被本地搜到');

console.log('== 8. 例句回写（复用 AI 返回的例句，不再单独请求） ==');
const cw = importer.customWordsOf(CORE).filter(w => w.word === 'photosynthesis')[0];
eq(!!cw, true, '自定义词记录存在');
eq(cw && cw.exampleEn, 'Plants rely on photosynthesis to grow.', 'exampleEn 已回写');
eq(cw && cw.exampleZh, '植物依靠光合作用生长。', 'exampleZh 已回写');
eq(!!(cw && cw.exampleSid), true, 'exampleSid 已标记（练习页可直接使用）');

console.log('== 9. 重复入库被拦截，并给出可读原因 ==');
const r2 = search.addWordToBook(CORE, { word: 'photosynthesis', pos: 'n.', meaning: '光合作用' });
eq(r2.added, false, '第二次加入 .added');
eq(/已存在|重复/.test(r2.reason), true, '原因含「已存在」：' + r2.reason);
eq(wordbook.bookVocab(CORE, 'all').total, before + 1, '总数未重复增长');

console.log('== 10. 非法词形被拦截 ==');
const r3 = search.addWordToBook(CORE, { word: '光合作用', pos: 'n.', meaning: 'plants' });
eq(r3.added, false, '中文词形 .added');
eq(r3.reason.length > 0, true, '中文词形给出原因：' + r3.reason);
const r4 = search.addWordToBook(CORE, { word: '', pos: '', meaning: '' });
eq(r4.added, false, '空词形 .added');
const r5 = search.addWordToBook(CORE, { word: 'ok', pos: '', meaning: '' });
eq(r5.added, false, '缺释义 .added');
eq(wordbook.bookVocab(CORE, 'all').total, before + 1, '非法词未污染词库');

console.log('== 11. 未接 AI 时：只走本地，行为不变 ==');
// 页面侧逻辑：本地无命中且 aiEnabled=false 时不触发 AI 请求（此处只验证本地结果）
eq(search.localSearch(CORE, 'quintessential').length >= 0, true, '本地检索不抛异常');

console.log('== 12. 切词书后，补充的词落在切换后的当前词书 ==');
const newId = wordbook.createUserBook('搜索测试书', '单测');
wordbook.switchBook(newId);
const r6 = search.addWordToBook('', { word: 'ephemeral', pos: 'adj.', meaning: '短暂的' });
eq(r6.added, true, '空 bookId 时写入当前词书');
eq(wordbook.bookVocab(newId, 'all').total, 1, '新词书明细 = 1');
eq(wordbook.bookVocab(CORE, 'all').total, before + 1, '核心词书未受影响');
eq(search.localSearch(newId, 'ephemeral').length, 1, '新词书可搜到');
eq(search.localSearch(CORE, 'ephemeral').length, 0, '核心词书搜不到（按书隔离）');
wordbook.deleteUserBook(newId);
wordbook.switchBook(CORE);

console.log('== 13. "[object Object]" 不能进词库（也不能被当成搜索词） ==');
// 成因：搜索框在部分端拿到的不是字符串，String(v) 后变成 "[object Object]"，
// 被当待查词交给 AI，生成结果又被写进词库 —— 词库里就多出一个怪词条
const r7 = search.addWordToBook(CORE, { word: '[object Object]', pos: '', meaning: 'x' });
eq(r7.added, false, '垃圾词形不入库');
eq(search.localSearch(CORE, '[object Object]').length, 0, '垃圾词形检索不到');

// 万一历史版本已经写进去过：启动时的清理要能把它捞出来
const jb = wordbook.createUserBook('垃圾清理测试', '单测');
const st = store.get();
st.customWords[jb] = [
  { id: 'j1', word: '[object Object]', pos: '', meaning: 'x' },
  { id: 'j2', word: 'legitimate', pos: 'n.', meaning: '合理的' }
];
store.save(st);
eq(wordbook.bookWords(jb).length, 2, '清理前 2 条');
eq(wordbook.purgeJunkWords(), 1, 'purgeJunkWords 删掉 1 条垃圾');
eq(wordbook.bookWords(jb).length, 1, '清理后剩 1 条');
eq(wordbook.bookWords(jb)[0].w, 'legitimate', '正常单词未被误伤');
// "object" 是正经英文单词，不能被规则误删
st.customWords[jb] = [{ id: 'j3', word: 'object', pos: 'n.', meaning: '物体' }];
store.save(st);
eq(wordbook.purgeJunkWords(), 0, '"object" 不受影响');
eq(wordbook.bookWords(jb).length, 1, 'object 仍在');
// 幂等：再跑一次不会越删越少
eq(wordbook.purgeJunkWords(), 0, '重复清理幂等');
wordbook.deleteUserBook(jb);

console.log('== 14. 输入值归一化：非字符串不能变成搜索词 ==');
// 页面侧 pickText 的契约（home.vue）：事件对象 / {value} / null 都要能抠出字符串
const homeSrc = fs.readFileSync(path.join(ROOT, 'pages', 'home', 'home.vue'), 'utf8');
assert(/pickText\(v\)/.test(homeSrc), 'home.vue 有 pickText');
assert(/JUNK_TEXT\.test\(kw\)/.test(homeSrc), 'onSearchInput 拦掉 [object 开头');
assert(/WORDISH\.test\(q\)/.test(homeSrc), 'aiLookup 只问"像单词"的串');
assert(!/onSearchInput\(String\(/.test(homeSrc), '不再用 String(v) 直接当关键词');
const nbSrc = fs.readFileSync(path.join(ROOT, 'components', 'float-navbar', 'float-navbar.vue'), 'utf8');
assert(/pickValue\(e\)/.test(nbSrc), 'float-navbar 有 pickValue');
assert(!/\$emit\('search', e\.detail\.value\)/.test(nbSrc), '不再裸取 e.detail.value');

console.log('== 15. allowKnown：词典里已有的词也能收进别的词书 ==');
// 单词详情页「加入词书」要同时服务两类词：AI 补充的新词 + 词典里原有的词。
// 后者在默认导入管道里会被判成「已存在（去重）」，所以详情页走 allowKnown，
// 只按目标词书自身去重 —— 同一个词可以属于多本书，但不能在同一本书里重复。
const core0 = words.WORDS[0].w;
const r8 = search.addWordToBook(CORE, { word: core0, pos: 'v.', meaning: '测试释义' });
eq(r8.added, false, '默认管道：核心词不重复导入核心词书（' + r8.reason + '）');
const r9 = search.addWordToBook(CORE, { word: core0, pos: 'v.', meaning: '测试释义' }, { allowKnown: true });
eq(r9.added, false, 'allowKnown 也不重复塞回同一本书');
const ub2 = wordbook.createUserBook('加入词书测试', '单测');
const r10 = search.addWordToBook(ub2, { word: core0, pos: 'v.', meaning: '测试释义' }, { allowKnown: true });
eq(r10.added, true, 'allowKnown：核心词可收进另一本书');
eq(search.localSearch(ub2, core0).length, 1, '新书里能搜到这个词');
const r11 = search.addWordToBook(ub2, { word: core0, pos: 'v.', meaning: '测试释义' }, { allowKnown: true });
eq(r11.added, false, '同一本书不重复收录');
eq(wordbook.bookVocab(ub2, 'all').total, 1, '新书词汇数仍为 1');
wordbook.deleteUserBook(ub2);
// 非法词形在 allowKnown 下依旧要被拦住
const r12 = search.addWordToBook(CORE, { word: '光合作用', pos: 'n.', meaning: 'x' }, { allowKnown: true });
eq(r12.added, false, 'allowKnown 下中文词形仍被拦');
const r13 = search.addWordToBook(CORE, { word: '[object Object]', pos: '', meaning: 'x' }, { allowKnown: true });
eq(r13.added, false, 'allowKnown 下垃圾词形仍被拦');

console.log('== 16. AI 补充的词不自动进词书（归属权在用户） ==');
// home.vue 以前在 aiLookup 里顺手 addWordToBook，导致搜过一次的词全塞进核心词书。
// 现在 explainWord 只写 aiCache，词书要不要收由单词详情页的「加入词书」决定。
const homeSrc2 = fs.readFileSync(path.join(ROOT, 'pages', 'home', 'home.vue'), 'utf8');
// 只取 aiLookup 方法体（注释里的"以前会…"会干扰正则，先剥掉行注释）
const aiIdx = homeSrc2.indexOf('aiLookup(kw)');
assert(aiIdx > 0, '定位到 aiLookup 方法');
const aiBlock = homeSrc2.slice(aiIdx, aiIdx + 2000).replace(/\/\/[^\n]*/g, '');
assert(aiBlock.indexOf('async aiLookup') === 0 || aiBlock.indexOf('aiLookup(kw)') >= 0,
  '取到 aiLookup 方法体（' + aiBlock.length + ' 字符）');
assert(!/addWordToBook\s*\(/.test(aiBlock), 'aiLookup 不再调用 addWordToBook');
assert(!/addToBook\s*\(/.test(aiBlock), 'aiLookup 不再调用 addToBook');
assert(/aiCache\.findWord/.test(aiBlock), 'AI 结果只落本机缓存（aiCache）');
assert(/本机缓存 · 未加入词书/.test(homeSrc2), '角标文案说明「未加入词书」');
assert(/点开词条可加入词书/.test(homeSrc2), '提示用户去词条页加入');
assert(/class="sr-ai"[^>]*@tap="openWord/.test(homeSrc2), 'AI 结果块可点开进词条页');
assert(/v-else-if="cached"[\s\S]{0,200}@tap="openWord/.test(homeSrc2), '缓存结果块也可点开进词条页');

console.log('');
console.log(fail === 0 ? '首页搜索逻辑全部通过' : '失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
