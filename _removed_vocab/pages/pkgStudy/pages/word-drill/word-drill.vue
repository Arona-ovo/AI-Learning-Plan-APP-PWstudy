<template>
  <view class="container page-nav wd" :class="appTheme" :style="appBgStyle" v-if="!empty">
    <float-navbar :title="$t('刷单词')" />

    <block v-if="!finished">
      <!-- 顶部：进度 + 来源 -->
      <view class="topbar">
        <text class="progress-text">{{ idx + 1 }} / {{ questions.length }}</text>
        <view class="progress-track topbar-track">
          <view class="progress-fill" :style="{ width: ((idx + 1) / questions.length * 100) + '%' }"></view>
        </view>
        <text class="tag src-tag">{{ sourceName }}</text>
      </view>

      <!-- 作答方式：选义 / 拼写 / 自评 -->
      <view class="wd-switch" :class="{ locked: answered }">
        <view class="wd-sw" :class="{ active: mode === 'choice' }" data-m="choice" @tap="switchMode">{{ $t('选义') }}</view>
        <view class="wd-sw" :class="{ active: mode === 'spell' }" data-m="spell" @tap="switchMode">{{ $t('拼写') }}</view>
        <view class="wd-sw" :class="{ active: mode === 'self' }" data-m="self" @tap="switchMode">{{ $t('自评') }}</view>
      </view>

      <!-- 词卡：不背单词式大词卡 —— 先给词，答案和例句都藏着 -->
      <view class="card wd-card">
        <view class="wd-meta">
          <text class="tag pos-tag" v-if="cur.pos">{{ cur.pos }}</text>
          <text class="tag lv-tag">Lv{{ cur.lv }}</text>
          <text class="tag st-tag" :class="cur.status">{{ statusName }}</text>
          <text class="wd-say" @tap="sayWord">{{ $t('发音') }}</text>
        </view>
        <view class="wd-word" @tap="sayWord">{{ cur.w }}</view>
        <text class="wd-ph" v-if="phonetic">/{{ phonetic }}/</text>

        <!-- 选义：四个中文释义选一个 -->
        <view class="wd-opts" v-if="mode === 'choice'">
          <view
            v-for="(item, i) in cur.options"
            :key="i"
            class="wd-opt"
            :class="{ correct: answered && i === cur.answerIndex, wrong: answered && selected === i && i !== cur.answerIndex }"
            hover-class="wd-opt-hover"
            :data-i="i"
            @tap="choose"
          >
            <text class="wd-ol">{{ labels[i] }}</text>
            <text class="wd-ot">{{ item }}</text>
          </view>
        </view>

        <!-- 拼写：给释义，写出英文单词 -->
        <view class="wd-spell" v-else-if="mode === 'spell' && !answered">
          <text class="wd-hint">{{ spellHint }}</text>
          <textarea class="wd-input" :placeholder="$t('拼出这个单词…')" :value="input" @input="onInput" auto-height maxlength="60" />
          <button class="btn-primary wd-submit" @tap="submitSpell" :disabled="!canSubmit">{{ $t('提交') }}</button>
        </view>

        <!-- 自评：先在心里过一遍，再给自己打分 -->
        <view class="wd-self" v-else-if="mode === 'self' && !answered">
          <text class="wd-hint">{{ $t('先在心里过一遍意思，再给自己打分') }}</text>
          <view class="wd-self-row">
            <view class="wd-grade know" :data-s="'pass'" @tap="grade">{{ $t('认识') }}</view>
            <view class="wd-grade fuzzy" :data-s="'partial'" @tap="grade">{{ $t('模糊') }}</view>
            <view class="wd-grade forgot" :data-s="'fail'" @tap="grade">{{ $t('不认识') }}</view>
          </view>
        </view>
      </view>

      <!-- 答后：完整释义 + 例句 + 掌握度 -->
      <view v-if="answered" class="card wd-reveal">
        <view class="wd-rv-head" :class="toneClass">
          <text class="wd-rv-title">{{ resultTitle }}</text>
          <text class="wd-rv-score" v-if="mode === 'spell'">{{ result.score }}%</text>
        </view>

        <view class="wd-row" v-if="userAnswer">
          <text class="wd-k">{{ $t('你的答案') }}</text>
          <text class="wd-v">{{ userAnswer }}</text>
        </view>
        <view class="wd-row">
          <text class="wd-k">{{ $t('释义') }}</text>
          <text class="wd-v strong">{{ meaningText }}</text>
        </view>
        <view class="wd-row">
          <text class="wd-k">{{ $t('掌握度') }}</text>
          <text class="wd-v">{{ masteryText }}</text>
        </view>

        <view class="wd-ex" v-if="cur.exampleEn">
          <view class="wd-ex-head">
            <text class="wd-k">{{ $t('例句') }}</text>
            <text class="wd-say small" :data-text="cur.exampleEn" @tap="replay">{{ $t('朗读') }}</text>
          </view>
          <view class="wd-ex-en">
            <text
              v-for="(item, index) in exampleTokens"
              :key="index"
              :class="item.w ? (item.target ? 'wd-tok tg' : (item.book ? 'wd-tok bk' : 'wd-tok')) : 'wd-pun'"
              :data-w="item.t"
              :data-isw="item.w"
              @tap.stop="tapWord"
            >{{ item.t }}</text>
          </view>
          <text class="wd-ex-zh" v-if="cur.exampleZh">{{ cur.exampleZh }}</text>
        </view>

        <view class="wd-fav" @tap="toggleFav">
          <text class="wd-fav-star" :class="{ on: favOn }">{{ favOn ? $t('★ 已收藏') : $t('☆ 收藏这个词') }}</text>
        </view>

        <view class="wd-act">
          <text class="wd-detail" @tap="openDetail">{{ $t('词条详情 ›') }}</text>
          <button class="btn-primary wd-next" @tap="next">{{ nextText }}</button>
        </view>
      </view>
    </block>

    <!-- 本组总结 -->
    <view v-else class="wd-summary">
      <view class="card wd-sum-card">
        <text class="wd-sum-title">{{ $t('这组刷完了') }}</text>
        <text class="wd-sum-num">{{ knownCount }}<text class="wd-sum-total"> / {{ questions.length }}</text></text>
        <text class="wd-sum-sub">{{ summaryText }}</text>
        <text class="wd-sum-foot">{{ progressText }}</text>
        <text class="wd-sum-sep">{{ $t('切换方式：选义 / 拼写 / 自评') }}</text>
        <button class="btn-primary wd-sum-btn" @tap="restart">{{ $t('再刷一组') }}</button>
        <button class="btn-ghost wd-sum-btn" @tap="goHome">{{ $t('返回首页') }}</button>
      </view>
    </view>

    <!-- 点读单词弹窗 -->
    <view class="pop-mask" v-if="pop.show" @tap="closePop">
      <view class="pop-card" @tap.stop="noop">
        <view class="wd-pop-word">{{ pop.word }}</view>
        <view class="wd-pop-ph" v-if="pop.phonetic">/{{ pop.phonetic }}/</view>
        <view class="wd-pop-meaning" v-if="pop.found">{{ pop.pos }} {{ pop.meaning }}</view>
        <view class="wd-pop-none" v-else>{{ $t('未收录（仍可发音）') }}</view>
        <view class="wd-pop-src" v-if="pop.found">{{ pop.srcLabel }}</view>
        <view class="wd-pop-replay" :data-text="pop.word" @tap="replay">{{ $t('再听一次') }}</view>
      </view>
    </view>
  </view>

  <!-- 空状态 -->
  <view v-else class="container page-nav wd-empty" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('刷单词')" />
    <text class="wd-empty-text">{{ emptyText }}</text>
    <button class="btn-primary wd-empty-btn" @tap="goHome">{{ $t('返回首页') }}</button>
  </view>
</template>

<script>
import { t } from '../../../utils/i18n.js';
import * as engine from '../../../utils/engine'
import * as iplus1 from '../../../utils/iplus1'
import * as wordbook from '../../../utils/wordbook'
import * as wordSession from '../../../utils/word-session.js'
import * as dict from '../../../utils/dict'
import * as settings from '../../../utils/settings'
import * as sync from '../../../services/account-sync'
import * as tts from '../../../services/voice'
import { tokenize } from '../../../utils/tokenize'
import { bookWordSet, targetWordSet, markTokens } from '../../../utils/word-mark'
import * as sfx from '../../../utils/sfx.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

// 掌握度标签：三种来源的翻译都由 setupQuestion 预算好，模板里不做三元 + 占位符的组合
const STATUS_NAME = { new: '新词', learning: '学习中', familiar: '熟悉', mastered: '已掌握' }

export default {
  components: { FloatNavbar },
  data() {
    return {
      labels: ['A', 'B', 'C', 'D'],
      source: 'daily',
      questions: [],
      idx: 0,
      cur: { id: '', w: '', pos: '', m: '', lv: 1, options: [], answerIndex: 0, exampleEn: '', exampleZh: '', mastery: 0, status: 'new' },
      mode: 'choice',
      selected: -1,
      input: '',
      canSubmit: false,
      answered: false,
      result: null,
      userAnswer: '',
      knownCount: 0,
      counts: { pass: 0, partial: 0, fail: 0 },
      finished: false,
      empty: false,
      emptyText: '',
      phonetic: '',
      exampleTokens: [],
      statusName: '',
      resultTitle: '',
      toneClass: '',
      masteryText: '',
      meaningText: '',
      spellHint: '',
      sourceName: '',
      summaryText: '',
      progressText: '',
      nextText: '',
      pop: { show: false, word: '', pos: '', meaning: '', phonetic: '', srcLabel: '', found: false },
      // 页面还活着吗：onUnload 置 false，用来掐断"答题后延迟朗读参考答案"这类定时器。
      // 沿用练习页（practice.vue）的同一套纪律：人已离开，不许再有声音。
      alive: true,
      bookId: '',
      answerTimer: 0,
      speaking: false,
      favOn: false,
      bookSet: {}
    }
  },

  onLoad(opt) {
    try {
      this.bookId = wordbook.currentBookId()
      const src = opt && opt.source
      this.start(src === 'review' ? 'review' : (src === 'new' ? 'new' : 'daily'))
    } catch (e) {
      console.error('[word-drill onLoad]', e)
      this.empty = true
      this.emptyText = t('页面加载失败：') + String((e && e.message) || e)
    }
  },

  onHide() {
    this.clearAnswerTimer()
    tts.stop()
  },
  onUnload() {
    this.alive = false
    this.clearAnswerTimer()
    tts.stop()
  },

  methods: {
    clearAnswerTimer() {
      if (this.answerTimer) {
        clearTimeout(this.answerTimer)
        this.answerTimer = 0
      }
    },

    /**
     * 每组词量：默认 20，夹 5-60。
     * 不额外做一个「每日刷词」目标 —— 首页的「每日新词」已经按首见日期（fs）管着节奏，
     * 这里只负责一次给多少词，两套目标叠在一起反而说不清。
     */
    deckSize() {
      const n = Number(wordSession.DECK_SIZE.def)
      return Math.max(wordSession.DECK_SIZE.min, Math.min(wordSession.DECK_SIZE.max, n))
    },

    start(source) {
      if (!wordbook.bookWords(this.bookId).length) {
        this.empty = true
        this.finished = false
        this.emptyText = t('当前词书还没有词汇，请到「词库 → 导入单词」粘贴单词或用 AI 生成')
        return
      }
      const deck = wordSession.buildDeck(this.deckSize(), this.bookId, source)
      if (!deck.length) {
        this.empty = true
        this.finished = false
        this.emptyText = source === 'review'
          ? t('暂时没有需要复习的词，先去刷一组新词吧')
          : (source === 'new' ? t('这本词书的词都见过了，可以换一组复习') : t('暂时没有可刷的词'))
        return
      }
      this.source = source
      this.questions = deck
      this.knownCount = 0
      this.counts = { pass: 0, partial: 0, fail: 0 }
      this.finished = false
      this.empty = false
      // 词书词汇集合算一次就够（做题期间词书不变）
      this.bookSet = bookWordSet(this.bookId)
      this.setupQuestion(0)
    },

    setupQuestion(i) {
      const item = this.questions[i]
      this.clearAnswerTimer()
      this.idx = i
      this.cur = item
      this.mode = 'choice'
      this.selected = -1
      this.input = ''
      this.canSubmit = false
      this.answered = false
      this.result = null
      this.userAnswer = ''
      this.resultTitle = ''
      this.toneClass = ''
      this.speaking = false
      this.favOn = settings.isFavorite('word', item.id)
      // 以下几项模板里没法做"三元 + 占位符"的组合，一律在 JS 里预算成字符串
      const entry = dict.lookup(item.w)
      this.phonetic = entry && entry.phonetic ? entry.phonetic : ''
      this.statusName = t(STATUS_NAME[item.status] || '新词')
      this.meaningText = item.pos ? item.pos + ' ' + item.m : item.m
      this.masteryText = t('{m} / 5 · 见过 {n} 次', { m: item.mastery, n: item.seen })
      this.spellHint = t('释义提示：') + this.meaningText
      this.sourceName = this.source === 'review'
        ? t('复习')
        : (this.source === 'new' ? t('新词') : t('日常'))
      // 最后一个词上的按钮要说"看结果"，提前在 JS 里算好（模板不做三元）
      this.nextText = i + 1 >= this.questions.length ? t('查看结果') : t('下一个')
      // 例句里的目标词高亮（}+1 那套 word-mark 复用，但答案里不算目标）
      const tset = targetWordSet([{ w: item.w }])
      this.exampleTokens = item.exampleEn
        ? markTokens(tokenize(item.exampleEn), this.bookSet, tset)
        : []
      this.pop = { show: false, word: '', pos: '', meaning: '', phonetic: '', srcLabel: '', found: false }
      tts.speakAuto(item.w)
    },

    switchMode(e) {
      if (this.answered) return
      this.mode = e.currentTarget.dataset.m
    },

    choose(e) {
      if (this.answered) return
      const sel = Number(e.currentTarget.dataset.i)
      const pass = sel === this.cur.answerIndex
      this.selected = sel
      this.finish(pass ? 'pass' : 'fail', pass ? 1 : 0, this.cur.options[sel])
    },

    onInput(e) {
      const v = e.detail.value
      this.input = v
      this.canSubmit = !!String(v || '').trim()
    },

    // 拼写判分：大小写 / 首尾空格 / 句末标点都不算错，其余必须完全一致 ——
    // 拼写不像翻译有"意思接近"的空间，近似想过关只会把错觉练扎实
    submitSpell() {
      if (this.answered || !this.input.trim()) return
      const norm = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9\- ]/gi, '').replace(/\s+/g, ' ')
      const pass = norm(this.input) === norm(this.cur.w)
      this.finish(pass ? 'pass' : 'fail', pass ? 1 : 0, this.input.trim())
    },

    grade(e) {
      if (this.answered) return
      const s = e.currentTarget.dataset.s
      this.finish(s === 'pass' ? 'pass' : (s === 'partial' ? 'partial' : 'fail'), s === 'pass' ? 1 : 0, '')
    },

    /**
     * 一轮作答结束的统一出口。
     * 回写刻意和翻译练习走同一套（engine.recordAnswer + iplus1.recordMastery）：
     * 今日已练、连续天数、打卡走势、掌握度概览那几个口径不用再写第二份，
     * 用户在哪儿练的都会算进去。
     */
    finish(status, score, userAnswer) {
      const item = this.cur
      const bookId = this.bookId || ''
      const theWord = item.w || ''
      // 合成一道"题目"喂给 recordAnswer：有例句就用例句当题干（答错时它顺理成章
      // 变成错题本里的一条翻译复习材料），没有例句就退化为单词本身。
      const q = {
        sid: 'wd-' + item.id,
        dir: 'e2c',
        prompt: item.exampleEn || theWord,
        answer: item.exampleZh || item.m,
        lv: item.lv,
        note: '',
        words: item.words,
        wordIds: item.wordIds
      }
      engine.recordAnswer(q, status, this.mode, userAnswer)
      iplus1.recordMastery(bookId, item.wordIds, status)

      this.answered = true
      this.userAnswer = userAnswer
      this.result = { pass: status === 'pass', partial: status === 'partial', score: Math.round(score * 100) }
      if (status === 'pass') this.counts.pass++
      else if (status === 'partial') this.counts.partial++
      else this.counts.fail++
      this.knownCount = this.counts.pass

      this.resultTitle = status === 'pass'
        ? t('答对了')
        : (status === 'partial' ? t('有点印象') : t('没答上来'))
      this.toneClass = status === 'pass' ? 'ok' : (status === 'partial' ? 'mid' : 'bad')
      // 掌握度在本次作答后已回写，这里取"更新后"的值显示
      const after = (wordbook.masteryMap(bookId) || {})[item.id] || {}
      this.masteryText = t('{m} / 5 · 见过 {n} 次', { m: Number(after.m) || 0, n: Number(after.seen) || 0 })

      let readDelay = 400
      try {
        if (sfx.play(status)) readDelay = sfx.durationOf(status) + 120
      } catch (e) { /* 音效不可用不影响答题流程 */ }
      sync.recordStudy({
        bookId: bookId,
        wordId: String(item.id || theWord),
        sentenceId: '',
        direction: 'w2c',
        mode: 'word-' + this.mode,
        result: status,
        score: Math.round(score * 100),
        userAnswer: userAnswer || '',
        reference: theWord
      })
      // 答后跟着念一遍这个词，把音和形对上（定时器由 clearAnswerTimer 统一清理）
      this.clearAnswerTimer()
      this.answerTimer = setTimeout(() => {
        this.answerTimer = 0
        if (!this.alive) return
        tts.speakAuto(theWord)
      }, readDelay)
    },

    // 点读例句里的单词：查词义 + 发音
    tapWord(e) {
      const d = e.currentTarget.dataset
      if (!d.isw) return
      const raw = d.w || ''
      if (!raw.trim()) return
      const entry = dict.lookup(raw)
      this.pop = {
        show: true,
        word: entry.w || raw,
        pos: entry.pos || '',
        meaning: entry.meaning || '',
        phonetic: entry.phonetic || '',
        srcLabel: dict.SRC_LABEL[entry.src] || '',
        found: !!entry.found
      }
      tts.speakWord(dict.speakForm(raw))
    },

    closePop() {
      this.pop = { show: false, word: '', pos: '', meaning: '', phonetic: '', srcLabel: '', found: false }
    },

    noop() {},

    sayWord() {
      const w = this.cur.w
      if (!w) return
      tts.speakWord(dict.speakForm(w))
    },

    // 重听（例句 / 弹窗里的词）：用户主动触发，force=true 永不被节流吞掉
    replay(e) {
      const text = e.currentTarget.dataset.text
      if (!text) { this.speaking = false; return }
      tts.speakSentence(text, { onDone: () => { this.speaking = false } })
      this.speaking = true
    },

    toggleFav() {
      const item = this.cur
      if (!item || !item.id) return
      // payload 与词库页 / 单词详情页同一套：type=word + word/meaning，
      // 「我的收藏」页按这份结构渲染，换了字段名收藏会变成空白条目
      const payload = {
        type: 'word',
        id: String(item.id),
        word: item.w || '',
        meaning: item.m || ''
      }
      const wasOn = this.favOn
      settings.toggleFavorite(payload)
      try {
        if (wasOn) sync.unmirrorFavorite('word', String(item.id))
        else sync.mirrorFavorite(payload)
      } catch (e) { /* 未登录 / 库不可用时只存本地 */ }
      this.favOn = !wasOn
    },

    openDetail() {
      const w = String(this.cur.w || '').trim().toLowerCase()
      if (!w) return
      uni.navigateTo({
        url: '/pkgManage/pages/word-detail/word-detail?w=' + encodeURIComponent(w) +
          '&id=' + encodeURIComponent(String(this.cur.id || '')) +
          '&book=' + encodeURIComponent(String(this.bookId || ''))
      })
    },

    next() {
      if (this.idx + 1 >= this.questions.length) {
        const c = wordSession.counts(this.bookId)
        this.summaryText = t('认识 {a} 个 · 模糊 {b} 个 · 忘了 {c} 个', {
          a: this.counts.pass, b: this.counts.partial, c: this.counts.fail
        })
        this.progressText = t('全书 {t} 词：已掌握 {m} 个，待巩固 {l} 个', {
          t: c.total, m: c.mastered, l: c.new + c.learning
        })
        this.knownCount = this.counts.pass
        this.finished = true
        return
      }
      this.setupQuestion(this.idx + 1)
    },

    restart() {
      if (!this.alive) return
      this.start(this.source)
    },

    goHome() {
      uni.switchTab({ url: '/pages/home/home' })
    }
  }
}
</script>

<style>
.wd-switch {
  display: flex;
  background: rgba(255, 255, 255, 0.62);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.62);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  border-radius: 999rpx;
  padding: 6rpx;
  margin-bottom: 24rpx;
}

.wd-switch.locked { opacity: 0.5; }

.wd-sw {
  flex: 1;
  text-align: center;
  padding: 14rpx 0;
  border-radius: 999rpx;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.wd-sw.active {
  background: #ffffff;
  background: var(--solid, #ffffff);
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  font-weight: 600;
}

.pos-tag { background: rgba(46, 107, 255, 0.12); color: #1d4fd8; }
.pos-tag { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); color: var(--brand-strong, #1d4fd8); font-weight: 600; }

.lv-tag { background: rgba(23, 32, 26, 0.07); color: #5a6560; margin-left: 12rpx; }
.lv-tag { background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07); color: var(--ink-2, #5a6560); margin-left: 12rpx; }

.st-tag { margin-left: 12rpx; background: rgba(23, 32, 26, 0.07); color: #5a6560; }
.st-tag { background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07); color: var(--ink-2, #5a6560); }
.st-tag.new { background: rgba(46, 107, 255, 0.12); color: #1d4fd8; }
.st-tag.new { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); color: var(--brand-strong, #1d4fd8); }
.st-tag.familiar { background: rgba(124, 58, 237, 0.14); color: #7c3aed; }
.st-tag.mastered { background: rgba(47, 158, 110, 0.16); color: #2f9e6e; }

.src-tag { background: rgba(247, 144, 9, 0.14); color: #b54708; margin-left: 16rpx; }

.wd-meta { display: flex; align-items: center; margin-bottom: 20rpx; }

.wd-say {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  background: rgba(255, 255, 255, 0.62);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.62);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.34);
  border-radius: 999rpx;
  padding: 6rpx 24rpx;
}

.wd-say:active { background: rgba(46, 107, 255, 0.12); }
.wd-say:active { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); }

.wd-say.small { margin-left: 16rpx; font-size: 22rpx; padding: 2rpx 18rpx; }

/* 主词：整页最大的字，衬线体 —— 不背单词那一类的第一眼焦点 */
.wd-word {
  text-align: center;
  font-size: 72rpx;
  line-height: 1.3;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
  word-break: break-all;
}

.wd-ph {
  display: block;
  text-align: center;
  margin-top: 6rpx;
  font-size: 26rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.wd-opts { margin-top: 32rpx; }

.wd-opt {
  display: flex;
  align-items: flex-start;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border-radius: 24rpx;
  padding: 26rpx 28rpx;
  margin-bottom: 18rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  box-shadow: 0 8rpx 24rpx rgba(23, 32, 26, 0.05);
  box-shadow: 0 8rpx 24rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
}

.wd-opt-hover { background: rgba(46, 107, 255, 0.1); }
.wd-opt-hover { background: rgba(var(--brand-rgb, 46, 107, 255), 0.1); }

.wd-opt.correct { border-color: #2e6bff; background: rgba(46, 107, 255, 0.13); }
.wd-opt.correct { border-color: var(--brand, #2e6bff); background: rgba(var(--brand-rgb, 46, 107, 255), 0.13); }

.wd-opt.wrong { border-color: #e5484d; background: rgba(229, 72, 77, 0.1); }

.wd-ol {
  flex-shrink: 0;
  width: 48rpx;
  height: 48rpx;
  line-height: 48rpx;
  text-align: center;
  border-radius: 50%;
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  font-size: 24rpx;
  font-weight: 600;
  margin-right: 20rpx;
}

.wd-opt.correct .wd-ol { background: #2e6bff; color: #ffffff; }
.wd-opt.correct .wd-ol { background: var(--brand, #2e6bff); color: #ffffff; }
.wd-opt.wrong .wd-ol { background: #e5484d; color: #ffffff; }

.wd-ot { flex: 1; font-size: 30rpx; line-height: 1.55; color: #17201a; }
.wd-ot { color: var(--ink-1, #17201a); }

.wd-hint {
  display: block;
  margin: 24rpx 0 16rpx;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.wd-input {
  width: 100%;
  box-sizing: border-box;
  min-height: 140rpx;
  font-size: 34rpx;
  line-height: 1.5;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 20rpx;
  padding: 20rpx 24rpx;
}

.wd-submit { margin-top: 24rpx; height: 88rpx; font-size: 30rpx; }

.wd-self-row { display: flex; margin-top: 20rpx; }

.wd-grade {
  flex: 1;
  text-align: center;
  padding: 22rpx 0;
  margin: 0 8rpx;
  border-radius: 999rpx;
  font-size: 28rpx;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
}

.wd-grade:first-child { margin-left: 0; }
.wd-grade:last-child { margin-right: 0; }
.wd-grade.know { color: #2f9e6e; border-color: rgba(47, 158, 110, 0.4); }
.wd-grade.fuzzy { color: #f79009; border-color: rgba(247, 144, 9, 0.4); }
.wd-grade.forgot { color: #e5484d; border-color: rgba(229, 72, 77, 0.4); }
.wd-grade:active { opacity: 0.8; }

.wd-reveal { margin-top: 24rpx; }

.wd-rv-head { display: flex; align-items: center; margin-bottom: 18rpx; }

.wd-rv-title { font-size: 34rpx; font-weight: 600; }
.wd-rv-head.ok .wd-rv-title { color: #2f9e6e; }
.wd-rv-head.mid .wd-rv-title { color: #f79009; }
.wd-rv-head.bad .wd-rv-title { color: #e5484d; }

.wd-rv-score { margin-left: 16rpx; font-size: 24rpx; color: #98a19b; }
.wd-rv-score { color: var(--ink-3, #98a19b); }

.wd-row { display: flex; align-items: flex-start; margin-bottom: 14rpx; }

.wd-k {
  flex-shrink: 0;
  width: 120rpx;
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.wd-v { flex: 1; font-size: 28rpx; line-height: 1.6; color: #5a6560; }
.wd-v { color: var(--ink-2, #5a6560); }

.wd-v.strong {
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-size: 32rpx;
  font-weight: 500;
}

.wd-ex {
  margin-top: 6rpx;
  padding: 20rpx 24rpx;
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border-left: 6rpx solid #2e6bff;
  border-left-color: var(--brand, #2e6bff);
  border-radius: 16rpx;
}

.wd-ex-head { display: flex; align-items: center; }
.wd-ex-head .wd-k { width: auto; margin-right: 16rpx; }

.wd-ex-en { margin-top: 10rpx; }

.wd-tok,
.wd-pun {
  font-family: Georgia, "Times New Roman", "PingFang SC", serif;
  font-size: 30rpx;
  line-height: 1.7;
}

.wd-pun { color: #17201a; }
.wd-pun { color: var(--ink-1, #17201a); }

.wd-tok { color: #17201a; border-bottom: 2rpx dashed #bfd4ff; }
.wd-tok { color: var(--ink-1, #17201a); }

.wd-tok:active { background: rgba(46, 107, 255, 0.12); border-radius: 6rpx; }
.wd-tok:active { background: rgba(var(--brand-rgb, 46, 107, 255), 0.12); border-radius: 6rpx; }

/* 目标词（也就是正在刷的这个词）：底色 + 加粗，一眼看见它在句子里的样子 */
.wd-tok.tg {
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  font-weight: 600;
  background: rgba(46, 107, 255, 0.14);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.14);
  border-bottom: 2rpx solid transparent;
  border-radius: 6rpx;
}

.wd-tok.bk {
  color: #2e6bff;
  color: var(--brand, #2e6bff);
  border-bottom: 2rpx solid rgba(46, 107, 255, 0.45);
  border-bottom-color: rgba(var(--brand-rgb, 46, 107, 255), 0.45);
}

.wd-ex-zh {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 1.6;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.wd-fav { text-align: center; padding: 16rpx 0 6rpx; }

.wd-fav-star { font-size: 26rpx; color: #98a19b; }
.wd-fav-star { color: var(--ink-3, #98a19b); }
.wd-fav-star.on { color: #f79009; }

.wd-act { display: flex; align-items: center; margin-top: 12rpx; }

.wd-detail {
  flex-shrink: 0;
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  padding: 20rpx 8rpx;
}

.wd-next { flex: 1; margin-left: 20rpx; height: 88rpx; font-size: 30rpx; }

.wd-summary { padding: 10rpx 0; }

.wd-sum-card { text-align: center; }

.wd-sum-title {
  display: block;
  font-size: 30rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.wd-sum-num {
  display: block;
  margin-top: 18rpx;
  font-size: 84rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.wd-sum-total { font-size: 32rpx; color: #98a19b; font-weight: 400; }
.wd-sum-total { color: var(--ink-3, #98a19b); }

.wd-sum-sub { display: block; margin-top: 12rpx; font-size: 26rpx; color: #5a6560; }
.wd-sum-sub { color: var(--ink-2, #5a6560); }

.wd-sum-foot { display: block; margin-top: 10rpx; font-size: 24rpx; color: #98a19b; }
.wd-sum-foot { color: var(--ink-3, #98a19b); }

.wd-sum-sep { display: block; margin-top: 18rpx; font-size: 22rpx; color: #98a19b; }
.wd-sum-sep { color: var(--ink-3, #98a19b); }

.wd-sum-btn { margin-top: 24rpx; }

.wd-pop-word { font-size: 44rpx; font-weight: 600; color: #17201a; }
.wd-pop-word { color: var(--ink-1, #17201a); font-family: Georgia, "Times New Roman", serif; }

.wd-pop-ph { display: block; margin-top: 6rpx; font-size: 26rpx; color: #98a19b; }
.wd-pop-ph { color: var(--ink-3, #98a19b); }

.wd-pop-meaning { display: block; margin-top: 18rpx; font-size: 30rpx; color: #5a6560; }
.wd-pop-meaning { color: var(--ink-2, #5a6560); }

.wd-pop-none { display: block; margin-top: 18rpx; font-size: 28rpx; color: #98a19b; }
.wd-pop-none { color: var(--ink-3, #98a19b); }

.wd-pop-src { display: block; margin-top: 14rpx; font-size: 22rpx; color: #98a19b; }
.wd-pop-src { color: var(--ink-3, #98a19b); }

.wd-pop-replay {
  display: inline-block;
  margin-top: 26rpx;
  font-size: 26rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  border: 2rpx solid rgba(46, 107, 255, 0.34);
  border-color: rgba(var(--brand-rgb, 46, 107, 255), 0.34);
  border-radius: 999rpx;
  padding: 10rpx 32rpx;
}

.wd-empty-text {
  display: block;
  margin-top: 80rpx;
  font-size: 28rpx;
  line-height: 1.7;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  text-align: center;
}

.wd-empty-btn { margin-top: 60rpx; }
</style>
