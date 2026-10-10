// utils/page-command.js - 首页指令执行引擎
//
// 这是 AI 与页面之间唯一的窄管道：
//   AI → Command[] → normalize（白名单 + 夹取）→ apply → 新 pageDoc → Vue 渲染
//
// 两条硬规矩：
//   1) apply 一律返回**新对象**，绝不原地改 doc —— 失败回退就是"不写入"，撤销就是"换回来"
//   2) apply 里不碰 DOM、不拼 CSS 字符串、不 eval；需要发请求/朗读的动作
//      只往 effects 里塞一条描述，由页面侧异步执行

import * as pageDoc from './page-doc.js';
import * as schema from './page-schema.js';
import * as cardSpec from './card-spec.js';
import * as theme from './theme.js';
import * as settings from './settings.js';
import * as wordbook from './wordbook.js';

const MAX_HISTORY = 20;
let history = [];

// 场景宏里"找不到目标就跳过"的指令（见 run 的宏展开）
const MACRO_SKIPPABLE = ['card.hide', 'card.show', 'card.move', 'card.remove'];

/* ============================================================
 * 小工具
 * ============================================================ */
function cloneCards(doc) {
  return (doc.cards || []).map(c => Object.assign({}, c));
}

function withCards(doc, cards) {
  return Object.assign({}, doc, { cards: cards });
}

function at(cards, i) {
  return (i >= 0 && i < cards.length) ? i : -1;
}

function insertAt(cards, card, to) {
  const arr = cards.slice();
  if (to === 'top') arr.unshift(card);
  else if (to === 'bottom' || typeof to !== 'number') arr.push(card);
  else arr.splice(Math.max(0, Math.min(arr.length, to)), 0, card);
  return arr;
}

function labelOf(card) {
  return card.title || card.type || card.id;
}

/* ============================================================
 * 卡片形态预设（AI 只给 type + 少量字段，这里展开成块）
 * ============================================================ */
function blocksForType(args) {
  const t = args.type || 'custom';
  const out = [];
  if (args.title) out.push({ kind: 'title', text: args.title });
  if (t === 'note') {
    out.push({ kind: 'text', text: args.text || '' });
  } else if (t === 'countdown') {
    out.push({ kind: 'countdown', title: args.title || '倒计时', date: args.date || '+7d' });
    if (args.text) out.push({ kind: 'text', text: args.text, tone: 'muted' });
  } else if (t === 'checklist') {
    // 项可以是纯字符串，也可以是 { text, done }
    const items = (args.items || []).map(x => {
      const o = (x && typeof x === 'object') ? x : { text: String(x == null ? '' : x), done: false };
      return { text: String(o.text == null ? '' : o.text), done: !!o.done };
    });
    out.push({ kind: 'checklist', items: items });
  } else if (t === 'stats') {
    const items = (args.items || []).slice(0, 4);
    items.forEach(x => {
      const o = (x && typeof x === 'object') ? x : { label: String(x), value: '' };
      out.push({ kind: 'stat', label: String(o.label || ''), value: String(o.value || ''), unit: String(o.unit || ''), live: o.live || 'none' });
    });
  } else if (t === 'quote') {
    out.push({ kind: 'quote', text: args.text || '', author: '' });
  } else if (t === 'custom') {
    (args.blocks || []).forEach(b => out.push(b));
  }
  return out;
}

/** 卡片上第一段可改写的文案：card.text → 扁平 blocks → design 节点（AI 卡的文案常藏在后两者里） */
function cardTextOf(c) {
  if (c.text) return c.text;
  const b = (c.blocks || []).find(b => (b.kind === 'text' || b.kind === 'quote' || b.kind === 'title') && b.text);
  if (b) return b.text;
  if (c.design && Array.isArray(c.design.sections)) {
    for (const sec of c.design.sections) {
      for (const n of (sec.items || [])) {
        if ((n.kind === 'text' || n.kind === 'title' || n.kind === 'quote') && n.text) return n.text;
      }
    }
  }
  return '';
}

/* ============================================================
 * 主题 / 背景：pageDoc 记值 + 副作用写进 settings.theme
 * ============================================================ */
export function applyThemeSideEffects(doc) {
  const t = (doc && doc.theme) || {};
  try {
    if (t.accent) theme.setAccent(t.accent);
    if (t.dark === true || t.dark === false) theme.setDark(t.dark);
    if (t.font) settings.set({ theme: { font: t.font } });
    // motion=true 表示"要动效" → 关闭流畅模式；false → 开启流畅模式（省性能）
    if (t.motion === true || t.motion === false) theme.setSmooth(!t.motion);
    if (t.density) settings.set({ theme: { density: t.density } });
  } catch (e) { /* 主题写失败不影响其他改动 */ }
  theme.apply();
}

export function applyBackgroundSideEffects(doc) {
  const b = (doc && doc.background) || {};
  try {
    if (b.preset) theme.setBackground(b.preset);
    if (b.image !== undefined && b.image !== null && b.image !== '') {
      settings.set({ theme: { bgImage: b.image } });
      theme.apply();
    }
    if (typeof b.mask === 'number') theme.setMask(b.mask);
    if (typeof b.blur === 'number') theme.setBlur(b.blur);
  } catch (e) { /* 同上 */ }
}

/* ============================================================
 * 指令实现：apply(doc, args) → { doc, note, effects? }
 * ============================================================ */
export const COMMANDS = {
  /* ---------- 结构 ---------- */
  'card.add': (doc, args) => {
    const cards = cloneCards(doc);
    if (cards.length >= schema.LIMITS.MAX_CARDS) {
      return { doc: null, note: '', error: '首页最多 ' + schema.LIMITS.MAX_CARDS + ' 张卡片' };
    }
    const blocks = blocksForType(args);
    if (!blocks.length) return { doc: null, note: '', error: '这张卡片没有可渲染的内容' };
    const card = {
      id: pageDoc.newCardId(doc),
      type: args.type || 'custom',
      builtin: false,
      visible: true,
      title: args.title || '',
      text: args.text || '',
      image: '',
      style: args.style || null,
      blocks: blocks
    };
    const next = withCards(doc, insertAt(cards, card, args.to));
    return { doc: next, note: '新增卡片「' + (card.title || card.type) + '」' };
  },

  /**
   * 整卡自由设计：布局 / 样式 / 数据 / 交互 / 内容都由 AI 定。
   * design 在 page-schema 里已经过 cardSpec.normalizeDesign 归一化，
   * 到这里时一定是"可渲染"的 —— 不需要再判合法性，只负责放对位置。
   */
  'card.design': (doc, args) => {
    const design = args.design;
    if (!design || !Array.isArray(design.sections)) {
      return { doc: null, note: '', error: '缺少可渲染的设计内容' };
    }
    const cards = cloneCards(doc);
    // 给了 target 就是改那张卡；改不到就报错，绝不悄悄新建（用户会以为改成功了）
    if (args.target) {
      const i = pageDoc.indexOfRef(doc, args.target);
      if (i < 0) return { doc: null, note: '', error: '没找到这张卡片' };
      const old = cards[i];
      const next = Object.assign({}, old, {
        design: design,
        // 标题同步一份：编辑态卡片名、撤销摘要都要用它
        title: args.title || old.title || '',
        // 换成新设计后，老的扁平 blocks 就作废了（渲染器优先认 design）
        blocks: [],
        style: args.style ? Object.assign({}, old.style, args.style) : old.style
      });
      cards[i] = next;
      return { doc: withCards(doc, cards), note: '重新设计了「' + labelOf(next) + '」' };
    }
    if (cards.length >= schema.LIMITS.MAX_CARDS) {
      return { doc: null, note: '', error: '首页最多 ' + schema.LIMITS.MAX_CARDS + ' 张卡片' };
    }
    const card = {
      id: pageDoc.newCardId(doc),
      type: 'design',
      builtin: false,
      visible: true,
      title: args.title || '',
      text: '',
      image: '',
      style: args.style || null,
      blocks: [],
      design: design
    };
    return {
      doc: withCards(doc, insertAt(cards, card, args.to)),
      note: '新增一张自定义设计的卡片' + (card.title ? '「' + card.title + '」' : '')
    };
  },

  'card.remove': (doc, args) => {
    const i = pageDoc.indexOfRef(doc, args.target);
    if (i < 0) return { doc: null, note: '', error: '没找到这张卡片' };
    const cards = cloneCards(doc);
    const gone = cards.splice(i, 1)[0];
    return { doc: withCards(doc, cards), note: '删除卡片「' + labelOf(gone) + '」' };
  },

  'card.move': (doc, args) => {
    const from = pageDoc.indexOfRef(doc, args.target);
    if (from < 0) return { doc: null, note: '', error: '没找到这张卡片' };
    const cards = cloneCards(doc);
    const card = cards.splice(from, 1)[0];
    let to = args.to;
    if (to === 'top') to = 0;
    else if (to === 'bottom') to = cards.length;
    else to = Math.max(0, Math.min(cards.length, Number(to) || 0));
    cards.splice(to, 0, card);
    return { doc: withCards(doc, cards), note: '把「' + labelOf(card) + '」移到第 ' + (to + 1) + ' 位' };
  },

  // hide / show 做成幂等：重复执行不算失败，否则场景宏里"隐藏一张本来就没上的卡"会整批挂掉
  'card.hide': (doc, args) => {
    const i = pageDoc.indexOfRef(doc, args.target);
    if (i < 0) return { doc: null, note: '', error: '没找到这张卡片' };
    const cards = cloneCards(doc);
    if (!cards[i].visible) return { doc: doc, note: '', silent: true };
    cards[i] = Object.assign({}, cards[i], { visible: false });
    return { doc: withCards(doc, cards), note: '隐藏卡片「' + labelOf(cards[i]) + '」' };
  },

  'card.show': (doc, args) => {
    const i = pageDoc.indexOfRef(doc, args.target);
    if (i < 0) return { doc: null, note: '', error: '没找到这张卡片' };
    const cards = cloneCards(doc);
    if (cards[i].visible) return { doc: doc, note: '', silent: true };
    cards[i] = Object.assign({}, cards[i], { visible: true });
    return { doc: withCards(doc, cards), note: '显示卡片「' + labelOf(cards[i]) + '」' };
  },

  'card.restore': (doc, args) => {
    const id = String(args.id || '');
    if (schema.BUILTIN_TYPES.indexOf(id) < 0) {
      return { doc: null, note: '', error: '只能恢复内置卡片（' + schema.BUILTIN_TYPES.join('/') + '）' };
    }
    if (pageDoc.indexOfRef(doc, { id: id }) >= 0) return { doc: null, note: '', error: '这张卡片已经在首页上' };
    const cards = cloneCards(doc);
    cards.push(pageDoc.__builtin(id));
    return { doc: withCards(doc, cards), note: '加回卡片「' + id + '」' };
  },

  'card.reset': (doc) => {
    const fresh = pageDoc.defaultDoc();
    return { doc: fresh, note: '恢复默认首页', effects: [{ kind: 'resetTheme' }] };
  },

  /* ---------- 文案 ---------- */
  'text.set': (doc, args) => {
    const i = pageDoc.indexOfRef(doc, args.target);
    if (i < 0) return { doc: null, note: '', error: '没找到这张卡片' };
    const cards = cloneCards(doc);
    const cur = cards[i];
    // AI 造的卡正文在 blocks / design 里，改文案要同时改到节点，否则界面上看不到变化
    const blocks = (cur.blocks || []).map(b => {
      if (b.kind === 'text' || b.kind === 'quote') return Object.assign({}, b, { text: args.value });
      return Object.assign({}, b);
    });
    let nextCard = Object.assign({}, cur, {
      text: args.value,
      blocks: blocks.length ? blocks : cur.blocks
    });
    // 新设计规格：改第一个文案类节点（title / text），没有就整卡补一段正文
    if (!blocks.length && cur.design && Array.isArray(cur.design.sections)) {
      let hit = false;
      const sections = cur.design.sections.map(sec => Object.assign({}, sec, {
        items: (sec.items || []).map(n => {
          if (hit || (n.kind !== 'title' && n.kind !== 'text')) return n;
          hit = true;
          return Object.assign({}, n, { text: args.value });
        })
      }));
      if (hit) nextCard = Object.assign({}, nextCard, { design: Object.assign({}, cur.design, { sections: sections }) });
      else {
        const extra = cardSpec.normalizeNode({ kind: 'text', text: args.value });
        if (extra) {
          nextCard = Object.assign({}, nextCard, {
            design: Object.assign({}, cur.design, {
              sections: sections.concat([{ layout: 'stack', gap: 0, align: 'left', valign: '', items: [extra] }])
            })
          });
        }
      }
    }
    cards[i] = nextCard;
    return { doc: withCards(doc, cards), note: '改写「' + labelOf(cards[i]) + '」的文案' };
  },

  'text.rewrite': (doc, args) => {
    // target:"all" = 把首页上所有 AI 卡片的文案都改写一遍（内置卡的文案是功能性的，不动）
    if (args.target && args.target.all) {
      const effects = [];
      (doc.cards || []).forEach(c => {
        if (effects.length >= 4) return;                     // 最多改 4 张，别让用户干等
        if (c.builtin || c.visible === false) return;
        const origin = cardTextOf(c);
        if (!origin) return;
        effects.push({
          kind: 'rewrite',
          targetId: c.id,
          tone: args.tone,
          instruction: args.instruction || '',
          origin: origin
        });
      });
      if (!effects.length) {
        return { doc: null, note: '', error: '首页上没有可改写的 AI 卡片文案' };
      }
      return { doc: doc, note: '让 AI 用「' + args.tone + '」的语气改写 ' + effects.length + ' 张卡片的文案', effects: effects };
    }
    const i = pageDoc.indexOfRef(doc, args.target);
    if (i < 0) return { doc: null, note: '', error: '没找到这张卡片' };
    // 需要再问一次模型 → 交给页面侧异步执行，执行完再补一条 text.set
    return {
      doc: doc,
      note: '让 AI 用「' + args.tone + '」的语气改写文案',
      effects: [{
        kind: 'rewrite',
        targetId: cards0(doc, i).id,
        tone: args.tone,
        instruction: args.instruction || '',
        origin: cards0(doc, i).text || ''
      }]
    };
  },

  'image.set': (doc, args) => {
    const i = pageDoc.indexOfRef(doc, args.target);
    if (i < 0) return { doc: null, note: '', error: '没找到这张卡片' };
    const cards = cloneCards(doc);
    const url = args.clear ? '' : (args.url || '');
    if (!args.clear && !url) return { doc: null, note: '', error: '缺少图片地址 url' };
    cards[i] = Object.assign({}, cards[i], { image: url });
    return { doc: withCards(doc, cards), note: args.clear ? '清除卡片配图' : '更换卡片配图' };
  },

  /* ---------- 样式 ---------- */
  'style.card': (doc, args) => {
    if (!args.style) return { doc: null, note: '', error: '缺少 style 参数' };
    const cards = cloneCards(doc);
    // target:"all" = 所有卡片一起改（「把所有卡片圆角调大一点」）
    if (args.target && args.target.all) {
      const next = cards.map(c => Object.assign({}, c, { style: Object.assign({}, c.style, args.style) }));
      return { doc: withCards(doc, next), note: '调整全部 ' + next.length + ' 张卡片的样式' };
    }
    const i = pageDoc.indexOfRef(doc, args.target);
    if (i < 0) return { doc: null, note: '', error: '没找到这张卡片' };
    cards[i] = Object.assign({}, cards[i], { style: Object.assign({}, cards[i].style, args.style) });
    return { doc: withCards(doc, cards), note: '调整「' + labelOf(cards[i]) + '」的样式' };
  },

  'style.text': (doc, args) => {
    const patch = {};
    if (args.size !== undefined && args.size !== null) patch.fontSize = args.size;
    if (args.weight) patch.fontWeight = args.weight;
    if (args.color) patch.color = args.color;
    if (args.align) patch.align = args.align;
    if (args.serif !== undefined) patch.serif = args.serif;
    const cards = cloneCards(doc);
    if (args.target && args.target.all) {
      const next = cards.map(c => Object.assign({}, c, { style: Object.assign({}, c.style, patch) }));
      return { doc: withCards(doc, next), note: '调整全部卡片的文字' };
    }
    const i = pageDoc.indexOfRef(doc, args.target);
    if (i < 0) return { doc: null, note: '', error: '没找到这张卡片' };
    const cur = Object.assign({}, cards[i].style);
    cards[i] = Object.assign({}, cards[i], { style: Object.assign({}, cur, patch) });
    return { doc: withCards(doc, cards), note: '调整「' + labelOf(cards[i]) + '」的文字' };
  },

  /* ---------- 主题 ---------- */
  'theme.set': (doc, args) => {
    const cur = Object.assign({}, doc.theme);
    const patch = {};
    let touched = false;
    if (args.accent) { patch.accent = args.accent; touched = true; }
    if (args.dark === true || args.dark === false) { patch.dark = args.dark; touched = true; }
    if (args.font) { patch.font = args.font; touched = true; }
    if (args.motion === true || args.motion === false) { patch.motion = args.motion; touched = true; }
    if (args.density) { patch.density = args.density; touched = true; }
    if (!touched) return { doc: null, note: '', error: 'theme.set 至少要给一个参数' };
    const next = Object.assign({}, doc, { theme: Object.assign({}, cur, patch) });
    const names = Object.keys(patch).map(k => k + '=' + patch[k]).join('，');
    return { doc: next, note: '主题改为 ' + names, effects: [{ kind: 'theme' }] };
  },

  /* ---------- 背景 ---------- */
  'bg.set': (doc, args) => {
    const cur = Object.assign({}, doc.background);
    const patch = {};
    let touched = false;
    if (args.preset) { patch.preset = args.preset; patch.image = ''; patch.gradient = null; touched = true; }
    if (args.image) { patch.image = args.image; patch.gradient = null; touched = true; }
    if (typeof args.mask === 'number') { patch.mask = args.mask; touched = true; }
    if (typeof args.blur === 'number') { patch.blur = args.blur; touched = true; }
    if (args.gradient) { patch.gradient = args.gradient; patch.image = ''; touched = true; }
    if (args.mood) {
      // 心情换肤：一条指令同时定下渐变 + 主题色 + 密度
      const m = moodPreset(args.mood);
      patch.gradient = m.gradient;
      patch.image = '';
      touched = true;
      const nextTheme = Object.assign({}, doc.theme, { accent: m.accent, density: m.density });
      const next = Object.assign({}, doc, { background: Object.assign({}, cur, patch), theme: nextTheme });
      return {
        doc: next,
        note: '换成「' + args.mood + '」的背景与配色',
        effects: [{ kind: 'theme' }, { kind: 'bg' }]
      };
    }
    if (!touched) return { doc: null, note: '', error: 'bg.set 至少要给一个参数' };
    const next = Object.assign({}, doc, { background: Object.assign({}, cur, patch) });
    return { doc: next, note: '调整背景', effects: [{ kind: 'bg' }] };
  },

  /* ---------- 学习目标 ---------- */
  'goal.set': (doc, args) => {
    const patch = {};
    if (typeof args.newWords === 'number') patch.newWords = args.newWords;
    if (typeof args.practice === 'number') patch.practice = args.practice;
    if (!Object.keys(patch).length) return { doc: null, note: '', error: 'goal.set 至少要给一个参数' };
    try { wordbook.setGoal('', patch); } catch (e) { return { doc: null, note: '', error: '目标写入失败' } }
    const txt = Object.keys(patch).map(k => (k === 'newWords' ? '每日新词' : '每日练习') + ' ' + patch[k]).join('，');
    return { doc: doc, note: '目标改为 ' + txt, effects: [{ kind: 'goal' }] };
  },

  /* ---------- 快照 ---------- */
  'skin.save': (doc, args) => {
    const name = String(args.name || '').trim();
    if (!name) return { doc: null, note: '', error: '缺少快照名称' };
    try {
      const st = settings.get() || {};
      const skins = Object.assign({}, (st.home || {}).skins);
      skins[name] = JSON.parse(JSON.stringify(doc));
      settings.set({ home: { skins: skins } });
    } catch (e) { return { doc: null, note: '', error: '快照保存失败' } }
    return { doc: doc, note: '已把当前首页存成「' + name + '」' };
  },

  'skin.apply': (doc, args) => {
    const name = String(args.name || '').trim();
    const skins = ((settings.get() || {}).home || {}).skins || {};
    const hit = skins[name];
    if (!hit) return { doc: null, note: '', error: '没有叫「' + name + '」的快照' };
    const next = JSON.parse(JSON.stringify(hit));
    return { doc: next, note: '回到快照「' + name + '」', effects: [{ kind: 'theme' }, { kind: 'bg' }] };
  },

  /* ---------- 场景宏 ---------- */
  'macro.run': (doc, args) => {
    const name = String(args.name || '').trim();
    const m = MACROS[name];
    if (!m) return { doc: null, note: '', error: '没有叫「' + name + '」的场景' };
    // 宏 = 一组预设指令，交给 run 递归执行（保证走同一套校验）
    return { doc: doc, note: '进入「' + MACRO_NAMES[name] + '」模式', expand: m };
  },

  /* ---------- 语音 ---------- */
  'page.announce': (doc, args) => {
    const text = String(args.text || '').trim();
    if (!text) return { doc: null, note: '', error: '没有要朗读的内容' };
    return { doc: doc, note: '朗读一句话', effects: [{ kind: 'speak', text: text }] };
  }
};

function cards0(doc, i) {
  return (doc.cards || [])[i] || {};
}

export const MACRO_NAMES = { exam: '考试冲刺', commute: '通勤碎片', bedtime: '睡前复习', focus: '沉浸专注' };

export const MACROS = {
  exam: [
    { op: 'card.move', args: { target: { id: 'action' }, to: 'top' } },
    { op: 'card.show', args: { target: { id: 'goal' } } },
    { op: 'card.hide', args: { target: { id: 'favorites' } } },
    { op: 'theme.set', args: { accent: 'rose', density: 'compact' } },
    { op: 'bg.set', args: { gradient: { from: '#FFF1F1', to: '#FFD9D9', angle: 165 } } },
    { op: 'goal.set', args: { newWords: 30, practice: 20 } }
  ],
  commute: [
    { op: 'card.move', args: { target: { id: 'action' }, to: 'top' } },
    { op: 'card.hide', args: { target: { id: 'chart' } } },
    { op: 'theme.set', args: { accent: 'teal', density: 'compact' } },
    { op: 'bg.set', args: { preset: 'mint' } },
    { op: 'goal.set', args: { practice: 10 } }
  ],
  bedtime: [
    { op: 'card.move', args: { target: { id: 'chart' }, to: 'top' } },
    { op: 'theme.set', args: { accent: 'purple', dark: true, density: 'relaxed' } },
    { op: 'bg.set', args: { gradient: { from: '#232043', to: '#151226', angle: 165 } } }
  ],
  focus: [
    { op: 'card.hide', args: { target: { id: 'favorites' } } },
    { op: 'card.hide', args: { target: { id: 'chart' } } },
    { op: 'theme.set', args: { accent: 'graphite', motion: false, density: 'compact' } },
    { op: 'bg.set', args: { preset: 'default' } }
  ]
};

/** 心情 → 渐变 + 主题色 + 密度 */
export function moodPreset(mood) {
  const m = String(mood || '');
  const table = [
    // 颜色词行放最前：模型/用户描述常直接写「蓝色渐变」，命中颜色就该按颜色来，
    // 否则「安静的蓝色渐变」会先撞上「安静」掉进深海军蓝，跟用户想要的浅蓝差很远
    { k: ['绿'], g: { from: '#E1F4EA', to: '#C6EBD9', angle: 165 }, a: 'green', d: 'cozy' },
    { k: ['粉', '樱'], g: { from: '#FFE8F0', to: '#F3D9E6', angle: 165 }, a: 'rose', d: 'relaxed' },
    { k: ['紫', '薰衣草'], g: { from: '#E9E4F7', to: '#D5CBF0', angle: 165 }, a: 'purple', d: 'relaxed' },
    { k: ['黄', '橙', '金'], g: { from: '#FDF3E3', to: '#F7DFC4', angle: 165 }, a: 'amber', d: 'cozy' },
    { k: ['黑', '深色', '暗'], g: { from: '#232043', to: '#151226', angle: 165 }, a: 'purple', d: 'relaxed' },
    { k: ['蓝'], g: { from: '#DCEAFF', to: '#B9D5FF', angle: 165 }, a: 'blue', d: 'relaxed' },
    { k: ['沉静', '冷静', '安静', '下雨', '雨天'], g: { from: '#1E3A5F', to: '#0F1B2D', angle: 165 }, a: 'blue', d: 'relaxed' },
    { k: ['活泼', '开心', '周五', '轻快'], g: { from: '#FFE29F', to: '#FFA99F', angle: 165 }, a: 'amber', d: 'cozy' },
    { k: ['温暖', '暖', '治愈'], g: { from: '#FDF3E3', to: '#F7DFC4', angle: 165 }, a: 'amber', d: 'relaxed' },
    { k: ['清新', '薄荷', '清爽'], g: { from: '#E1F4EA', to: '#C6EBD9', angle: 165 }, a: 'green', d: 'cozy' },
    { k: ['专注', '严肃', '认真'], g: { from: '#E9ECEA', to: '#D6DBD8', angle: 165 }, a: 'graphite', d: 'compact' },
    { k: ['浪漫', '温柔', '柔和'], g: { from: '#FFE8F0', to: '#F3D9E6', angle: 165 }, a: 'rose', d: 'relaxed' },
    { k: ['夜晚', '夜间', '睡前'], g: { from: '#232043', to: '#151226', angle: 165 }, a: 'purple', d: 'relaxed' }
  ];
  for (const row of table) {
    if (row.k.some(x => m.indexOf(x) >= 0)) return { gradient: row.g, accent: row.a, density: row.d };
  }
  return { gradient: { from: '#EEF3F0', to: '#DCE7E1', angle: 165 }, accent: 'blue', density: 'cozy' };
}

/* ============================================================
 * 执行：原子性 —— 任一条失败就整体不写入
 * ============================================================ */
/**
 * @param {object} doc  当前 pageDoc（不会被修改）
 * @param {object[]} cmds 已归一化的指令
 * @param {object} opt { summary, live }
 * @returns { ok, doc, applied[], failed, reason, effects[] }
 */
export function run(doc, cmds, opt) {
  const o = opt || {};
  const start = doc;
  let cur = doc;
  const applied = [];
  const effects = [];

  const queue = [];
  (cmds || []).forEach(c => queue.push(c));

  // 宏展开：展开后的指令同样要走校验（不能因为是内置的就绕过）
  let guard = 0;
  while (queue.length && guard++ < 40) {
    const cmd = queue.shift();
    const impl = COMMANDS[cmd.op];
    if (!impl) {
      return { ok: false, doc: start, applied: applied, failed: cmd, reason: '不支持的指令 ' + cmd.op, effects: [] };
    }
    let r;
    try {
      r = impl(cur, cmd.args || {});
    } catch (e) {
      r = { doc: null, note: '', error: '执行出错' };
    }
    if (!r.doc) {
      return {
        ok: false,
        doc: start,
        applied: applied,
        failed: cmd,
        reason: cmd.op + '：' + (r.error || '执行失败'),
        effects: []
      };
    }
    if (r.expand) {
      // 宏：把展开的指令插到队首（保持原有顺序）
      const norm = schema.normalizeCommands(r.expand);
      if (!norm.ok) {
        return { ok: false, doc: start, applied: applied, failed: cmd, reason: '宏展开失败：' + norm.errors.join('；'), effects: [] };
      }
      // 宏是"尽力而为"的组合：针对某张卡的指令，若这张卡不在首页就跳过，
      // 免得「隐藏收藏速览」在没上首页时把整组指令带崩。
      const safe = norm.commands.filter(c => {
        if (MACRO_SKIPPABLE.indexOf(c.op) < 0) return true;
        return pageDoc.indexOfRef(cur, c.args && c.args.target) >= 0;
      });
      queue.unshift.apply(queue, safe);
      applied.push({ op: cmd.op, note: r.note });
      continue;
    }
    cur = r.doc;
    // silent = 幂等命中（如"隐藏一张已经隐藏的卡"）：不计入摘要，避免刷屏
    if (!r.silent) applied.push({ op: cmd.op, note: r.note || '' });
    (r.effects || []).forEach(e => effects.push(e));
  }

  return { ok: true, doc: cur, applied: applied, failed: null, reason: '', effects: effects };
}

/** 解析 + 执行一步到位（页面侧主入口） */
export function applyCommands(doc, rawCmds, opt) {
  const n = schema.normalizeCommands(rawCmds);
  if (!n.ok) {
    return { ok: false, doc: doc, applied: [], failed: null, reason: n.errors.join('；'), effects: [], errors: n.errors };
  }
  const r = run(doc, n.commands, opt);
  r.errors = n.errors;   // 被跳过的指令（已截断但仍提示给用户）
  return r;
}

/* ============================================================
 * 历史栈：撤销
 * ============================================================ */
/**
 * 入栈时连 settings.theme 一起留一份快照。
 * 原因：pageDoc.theme 是**稀疏**的（没改过的字段是 '' / null），
 * 只靠它还原不了"改之前是什么样"——比如 doc.theme.dark=null 既可能是"用户没说"，
 * 也可能是"撤销回没改过的状态"。带上这份基线，撤销才是真正的一步到位。
 */
export function snapshot(doc, summary) {
  const st = settings.get() || {};
  let th = null;
  let perf = null;
  try { th = JSON.parse(JSON.stringify(st.theme || {})); } catch (e) { th = null; }
  try { perf = JSON.parse(JSON.stringify(st.performance || {})); } catch (e) { perf = null; }
  history.push({
    doc: JSON.parse(JSON.stringify(doc)),
    theme: th,
    perf: perf,
    summary: summary || '',
    at: Date.now()
  });
  if (history.length > MAX_HISTORY) history.shift();
}

export function undo() {
  if (!history.length) return null;
  const last = history.pop();
  pageDoc.save(last.doc);
  // 还原外观：settings.set 是深合并、删不掉键，所以先用 defaults 补齐成一份完整的
  // 配置再整体写回，这样"改动前没这个键"也能正确回到没有的状态。
  try {
    const def = settings.defaults();
    const th = Object.assign({}, def.theme, last.theme || {});
    settings.set({ theme: th });
    if (last.perf) settings.set({ performance: Object.assign({}, def.performance, last.perf) });
  } catch (e) { /* 主题回退失败不影响其它改动 */ }
  applyThemeSideEffects(last.doc);
  applyBackgroundSideEffects(last.doc);
  return last.doc;
}

export function canUndo() {
  return history.length > 0;
}

export function lastUndo() {
  return history.length ? history[history.length - 1] : null;
}

export function clearHistory() {
  history = [];
}

/* ============================================================
 * 提交：执行成功后的收尾（落盘 + 主题/背景副作用）
 * ============================================================ */
export function commit(doc, summary) {
  snapshot(pageDoc.get(), summary || '');
  pageDoc.save(doc);
  applyThemeSideEffects(doc);
  applyBackgroundSideEffects(doc);
  return doc;
}

/** 生成给用户的变更摘要 */
export function summaryOf(applied) {
  const list = (applied || []).filter(a => a.note).map(a => a.note);
  if (!list.length) return '没有可应用的改动';
  return list.join('，');
}
