<template>
  <view class="container page-nav daily-page" :class="appTheme" :style="appBgStyle">
    <float-navbar title="今日收工" :back="true" />

    <!-- 对话区：AI 一问、你一答，逐步把今天回顾完。
         不再是一张要一次填完的表 —— 表看着快，实际每一格都要想"这格填什么"，
         对话只要回答眼前这一句就行。 -->
    <scroll-view
      class="chat"
      scroll-y
      :scroll-into-view="bottomId"
      :scroll-with-animation="true"
    >
      <view v-for="(m, i) in msgs" :key="i" class="dl-row" :class="m.role">
        <view class="dl-bubble" :class="m.role">
          <text class="dl-txt">{{ m.text }}</text>
          <view v-if="m.imgs && m.imgs.length" class="dl-imgs">
            <image
              v-for="(p, k) in m.imgs"
              :key="k"
              class="dl-img"
              :src="p"
              mode="aspectFill"
              @tap="preview(p)"
            />
          </view>
        </view>
      </view>
      <view v-if="typing" class="dl-row assistant">
        <view class="dl-bubble assistant dl-typing">
          <view class="dl-dot"></view><view class="dl-dot"></view><view class="dl-dot"></view>
        </view>
      </view>
      <view id="dl-bottom"></view>
    </scroll-view>

    <!-- 回答区：这一步问什么，就给什么输入方式 -->
    <view class="ask">

      <!-- ① 今天状态：点一下就行，不用组织语言 -->
      <view v-if="step === 'mood'" class="chips">
        <text
          v-for="m in moods"
          :key="m.key"
          class="chip"
          @tap="answerMood(m)"
        >{{ m.label }}</text>
      </view>

      <!-- ② 逐项：一天里的每一项单独问一句 -->
      <view v-else-if="step === 'item'" class="chips">
        <text class="chip" @tap="answerItem(2)">做完了</text>
        <text v-if="curPlanned > 1" class="chip" @tap="answerItem(1)">做了一部分</text>
        <text class="chip" @tap="answerItem(0)">一个都没做</text>
      </view>

      <!-- ③ 后面几天的：做过的点一下，可以多选 -->
      <block v-else-if="step === 'ahead'">
        <view class="chips">
          <text
            v-for="a in draft.ahead"
            :key="a.taskId"
            class="chip"
            :class="{ 'chip-on': a.actual > 0 }"
            @tap="toggleAhead(a)"
          >{{ a.title }}</text>
        </view>
        <view class="go" @tap="finishAhead">就这些 ›</view>
      </block>

      <!-- ④ 计划外（可以贴图） ⑤ 还有什么想说的 -->
      <block v-else-if="step === 'extras' || step === 'note'">
        <view v-if="draft.photos.length" class="thumbs">
          <view v-for="(p, i) in draft.photos" :key="i" class="thumb">
            <image class="th-img" :src="p" mode="aspectFill" @tap="preview(p)" />
            <text class="th-del" @tap.stop="delPhoto(i)">×</text>
          </view>
        </view>
        <view class="bar">
          <textarea
            class="input"
            :value="text"
            @input="onInput"
            :auto-height="true"
            :maxlength="-1"
            :show-confirm-bar="false"
            :placeholder="placeholder"
            placeholder-style="color:#a8b0ab;font-size:25rpx"
          />
          <view class="pic" @tap="pickPhoto">图</view>
          <view class="send" :class="{ 'send-off': step === 'extras' && !text && !draft.photos.length }" @tap="sendText">
            {{ step === 'extras' ? (text || draft.photos.length ? '说完了' : '没有了') : '发送' }}
          </view>
        </view>
        <text v-if="step === 'note'" class="skip" @tap="finishChat">跳过，直接收工 ›</text>
      </block>

      <!-- ⑥ 收尾 -->
      <view v-else-if="step === 'done'" class="finish">
        <button class="btn-primary fin-btn" @tap="submit">
          {{ drift ? '提交，让 AI 看看后面' : '提交今天的记录' }}
        </button>
        <text class="fin-tip">
          {{ drift ? '和计划有出入，提交后会先给你看 AI 的建议，确认了才改。' : '和计划一致，提交后就只记一笔。' }}
        </text>
      </view>
    </view>

    <app-dialog
      :show="dlg.show"
      :title="dlg.title"
      :content="dlg.content"
      :confirm-text="dlg.confirmText"
      :mode="dlg.mode"
      :items="dlg.items"
      :danger="dlg.danger"
      :seq="dlg.seq"
      @confirm="onDlgYes"
      @cancel="dlg.show = false"
    />
  </view>
</template>

<script>
import * as dailylog from '../../../utils/dailylog.js'
import * as pw from '../../../utils/pwstore.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../../components/app-dialog/app-dialog.vue'

// 状态回应用语：先接住用户说的话，再往下问 ——
// "累"被直接跳到下一题会让人觉得说了也没用，后面就不肯说了。
const MOOD_REPLY = {
  great: '状态好就是本钱，那我们抓紧把今天对一遍。',
  ok: '稳。那就照着今天的事一项项过。',
  tired: '累的时候硬撑效率最低 —— 先如实记下来，明天的量我会帮你收一收。',
  busy: '被别的事占掉很正常，先记上，后面我把节奏调回来。',
  stuck: '卡住别硬顶，记下来 —— 重排时我会把它拆小或者往后挪。'
}

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      draft: { date: '', items: [], ahead: [], extras: '', facts: [], mood: '', note: '', photos: [] },
      moods: dailylog.MOODS,
      msgs: [],          // 对话流水
      typing: false,     // AI 正在"打字"
      step: '',          // mood → item → ahead → extras → note → done
      itemIdx: 0,        // 正在问第几项
      text: '',          // 当前输入框内容
      bottomId: '',
      // 统一弹窗（components/app-dialog）：多个目标时用它选一个去重排
      dlg: { show: false, mode: 'sheet', title: '', content: '', confirmText: '确定', danger: false, seq: 0, action: '', items: [] }
    }
  },
  computed: {
    /** 正在问的那一项计划了几个番茄（决定要不要给"做了一部分"这个选项） */
    curPlanned() {
      const it = (this.draft.items || [])[this.itemIdx]
      return it ? Math.max(1, Number(it.planned) || 1) : 1
    },
    placeholder() {
      return this.step === 'extras'
        ? '比如：临时刷了 30 道阅读题 / 去看了一节网课'
        : '卡在哪儿、明天想怎么调，都可以说（可选）'
    },
    // 实时判定：一问一答走完就能看出"有没有和计划不一样"
    drift() {
      const ahead = (this.draft.ahead || []).filter(a => (a.actual || 0) > 0)
      return dailylog.driftOf({ items: this.draft.items, ahead: ahead, extras: this.draft.extras })
    },
    maxPhotos() {
      return dailylog.MAX_PHOTOS
    }
  },
  onShow() {
    // 已经开过场（或从重排页退回）就不再重置 —— 否则刚说的话全没了
    if (this.msgs.length) return
    this.draft = dailylog.buildDraft()
    this.itemIdx = 0
    this.text = ''
    this.step = ''
    this.start()
  },
  methods: {
    // ---------- 对话引擎 ----------
    /** 用户说的一句 */
    push(role, text, imgs) {
      this.msgs.push({ role: role, text: text, imgs: imgs || [] })
      this.toBottom()
    },
    /** AI 说的一句（带一点"打字"停顿，太快会像脚本在刷屏） */
    ask(text) {
      this.typing = true
      this.toBottom()
      setTimeout(() => {
        this.typing = false
        this.msgs.push({ role: 'assistant', text: text, imgs: [] })
        this.toBottom()
      }, 420)
    },
    toBottom() {
      this.bottomId = ''
      this.$nextTick(() => { this.bottomId = 'dl-bottom' })
    },
    start() {
      this.msgs = []
      this.push('assistant', '今天辛苦啦。我们不填表，聊两句就行 —— 先说一句，今天整体感觉怎么样？')
      this.step = 'mood'
    },

    // ① 状态
    answerMood(m) {
      this.draft.mood = m.key
      this.push('user', m.label)
      this.step = ''
      setTimeout(() => {
        const r = MOOD_REPLY[m.key]
        if (r) this.push('assistant', r)
        setTimeout(() => this.askItem(), 520)
      }, 240)
    },

    // ② 今天该做的，一项一项问
    askItem() {
      const list = this.draft.items || []
      if (this.itemIdx >= list.length) { this.askAhead(); return }
      const it = list[this.itemIdx]
      const planned = Math.max(1, Number(it.planned) || 1)
      const done = Number(it.done) || 0
      // 把番茄钟真实记的数说出来：用户不用猜"我到底做了几个"，也不会替自己虚报
      const hint = done
        ? '（番茄钟记到 ' + done + ' 个）'
        : '（番茄钟里还没记到）'
      this.ask('「' + it.title + '」今天排了 ' + planned + ' 个番茄' + hint + '，做完了吗？')
      this.step = 'item'
    },
    answerItem(kind) {
      const it = (this.draft.items || [])[this.itemIdx]
      if (!it) { this.itemIdx++; this.askItem(); return }
      const planned = Math.max(1, Number(it.planned) || 1)
      let actual = planned
      let label = '做完了'
      if (kind === 1) { actual = Math.max(1, planned - 1); label = '做了一部分' }
      if (kind === 0) { actual = 0; label = '一个都没做' }
      it.actual = actual
      this.$forceUpdate && this.$forceUpdate()
      this.push('user', label)
      this.itemIdx++
      this.step = ''
      setTimeout(() => this.askItem(), 300)
    },

    // ③ 后面几天的，提前做了就点一下
    askAhead() {
      const list = this.draft.ahead || []
      if (!list.length) { this.askExtras(); return }
      this.ask('后面几天的这些，有提前做的吗？做过的点一下就行，没做的不用管。')
      this.step = 'ahead'
    },
    toggleAhead(a) {
      a.actual = a.actual > 0 ? 0 : Math.max(1, Number(a.planned) || 1)
      this.$forceUpdate && this.$forceUpdate()
    },
    finishAhead() {
      const picked = (this.draft.ahead || []).filter(a => (a.actual || 0) > 0)
      this.push('user', picked.length ? '提前做了：' + picked.map(a => a.title).join('、') : '都没提前做')
      this.step = ''
      setTimeout(() => this.askExtras(), 320)
    },

    // ④ 计划外（可贴图）
    askExtras() {
      this.ask('除了这些，今天还干了点别的吗？临时刷的题、看的一节课都算 —— 有成果图也可以贴上来。')
      this.step = 'extras'
      this.text = ''
    },
    // ⑤ 还有什么想说的
    askNote() {
      this.ask('最后一句：还有什么想让我知道的吗？卡在哪儿、明天想怎么调，都可以说。没有就直接跳过。')
      this.step = 'note'
      this.text = ''
    },
    onInput(e) {
      this.text = (e && e.detail && e.detail.value) || ''
    },
    sendText() {
      const v = String(this.text || '').trim()
      const imgs = (this.draft.photos || []).slice()
      if (this.step === 'extras') {
        this.draft.extras = v
        this.push('user', v || '没有了', imgs)
        this.step = ''
        setTimeout(() => this.askNote(), 320)
        return
      }
      this.draft.note = v
      this.push('user', v || '没有了', imgs)
      this.step = ''
      setTimeout(() => this.finishChat(), 320)
    },
    /** 跳到最后一步：把已经收集到的整理成一句话 */
    finishChat() {
      if (this.step === 'note') {
        this.draft.note = String(this.text || '').trim()
      }
      const d = this.draft
      const items = d.items || []
      const total = items.length
      const okN = items.filter(i => (i.actual || 0) >= Math.max(1, Number(i.planned) || 1)).length
      let s = '记下了。'
      if (total) s += '今天 ' + total + ' 项里做完了 ' + okN + ' 项。'
      if ((d.ahead || []).filter(a => (a.actual || 0) > 0).length) s += '还提前做了后面的。'
      if (d.extras) s += '计划外的事也记上了。'
      if ((d.photos || []).length) s += '贴的 ' + d.photos.length + ' 张图会留在今天的记录里。'
      s += this.drift ? '和计划有点出入，提交后我给你看看后面怎么调。' : '和计划基本一致，提交就只记一笔。'
      this.ask(s)
      this.step = 'done'
    },

    // ---------- 图片 ----------
    pickPhoto() {
      const left = this.maxPhotos - (this.draft.photos || []).length
      if (left <= 0) {
        try { uni.showToast({ title: '最多贴 ' + this.maxPhotos + ' 张', icon: 'none' }) } catch (e) {}
        return
      }
      try {
        uni.chooseImage({
          count: left,
          sizeType: ['compressed'],
          sourceType: ['album', 'camera'],
          success: (res) => {
            const list = (res && res.tempFilePaths) || []
            // 临时路径重启 App 后就失效了 → 转成本地持久文件再存
            list.forEach(p => this.persist(p))
          }
        })
      } catch (e) {}
    },
    persist(tmp) {
      const put = (p) => {
        if (!p) return
        if (!this.draft.photos) this.draft.photos = []
        if (this.draft.photos.length >= this.maxPhotos) return
        this.draft.photos.push(p)
        this.$forceUpdate && this.$forceUpdate()
      }
      try {
        if (typeof uni !== 'undefined' && uni && typeof uni.saveFile === 'function') {
          uni.saveFile({ tempFilePath: tmp, success: (r) => put((r && r.savedFilePath) || tmp), fail: () => put(tmp) })
          return
        }
      } catch (e) {}
      put(tmp)
    },
    delPhoto(i) {
      if (!this.draft.photos) return
      this.draft.photos.splice(i, 1)
      this.$forceUpdate && this.$forceUpdate()
    },
    preview(p) {
      try {
        uni.previewImage({ urls: (this.draft.photos || []).slice(), current: p })
      } catch (e) {}
    },

    // ---------- 提交 ----------
    submit() {
      this.__done = true
      const log = dailylog.save(this.draft)
      if (!log.drift) {
        try { uni.showToast({ title: '今天的记录已保存', icon: 'success' }) } catch (e) {}
        setTimeout(() => this.back(), 500)
        return
      }
      // 多个目标都涉及就让用户选一个先重排
      const ids = []
      ;(log.items || []).concat(log.ahead || []).forEach(i => {
        if (i.goalId && ids.indexOf(i.goalId) < 0) ids.push(i.goalId)
      })
      const alive = ids.filter(id => !!pw.goalOf(id))
      if (!alive.length) {
        try { uni.showToast({ title: '已保存', icon: 'success' }) } catch (e) {}
        setTimeout(() => this.back(), 500)
        return
      }
      if (alive.length === 1) { this.goReplan(alive[0]); return }
      const names = alive.map(id => { const g = pw.goalOf(id); return g ? g.title : id })
      this.openDlg({
        title: '重排哪个目标？',
        mode: 'sheet',
        items: names,
        action: 'replan',
        ids: alive
      })
    },
    // ---------- 统一弹窗 ----------
    // ⚠️ 不能叫 ask：那是对话里"AI 说一句"的方法，同名会被后者覆盖（methods 里
    //    重复 key 后者胜出），结果是想说话却弹出一个空对话框。
    openDlg(cfg) {
      this.dlg = Object.assign(
        { show: true, mode: 'confirm', title: '', content: '', confirmText: '确定',
          danger: false, action: '', items: [], ids: [] },
        cfg || {},
        { seq: (this.dlg && this.dlg.seq || 0) + 1 }
      )
    },
    onDlgYes(payload) {
      const act = this.dlg.action
      const ids = this.dlg.ids || []
      this.dlg.show = false
      if (act === 'replan') this.goReplan(ids[payload])
    },
    goReplan(goalId) {
      // from=log：replan 页会带上今天的收工填报去问 AI
      uni.navigateTo({ url: '/pkgPlan/pages/replan/replan?id=' + goalId + '&from=log' })
    },
    back() {
      try { uni.navigateBack() } catch (e) { uni.switchTab({ url: '/pages/home/home' }) }
    }
  }
}
</script>

<style>
/* 整页 = 一上（对话滚动）一下（回答区），键盘弹起时输入框不被顶飞 */
.daily-page { min-height: 100vh; display: flex; flex-direction: column; padding-bottom: 0; }
.chat { flex: 1; min-height: 0; padding: 16rpx 0 20rpx; }

.dl-row { display: flex; margin-bottom: 18rpx; }
.dl-row.user { justify-content: flex-end; }
.dl-row.assistant { justify-content: flex-start; }

/* 气泡沿用首页 AI 对话那一套：助手浅灰、本人实心主色，只有右下/左下角收一下 */
.dl-bubble {
  max-width: 84%;
  padding: 18rpx 24rpx;
  border-radius: 22rpx;
  font-size: 26rpx; line-height: 1.65;
  word-break: break-word;
}
.dl-bubble.user {
  background: #e4173d; background: var(--brand, #e4173d);
  color: #ffffff;
  border-bottom-right-radius: 6rpx;
}
.dl-bubble.assistant {
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
  color: #17201a; color: var(--ink-1, #17201a);
  border-bottom-left-radius: 6rpx;
}
.dl-txt { font-size: 26rpx; line-height: 1.65; }
.dl-imgs { display: flex; flex-wrap: wrap; margin-top: 12rpx; }
.dl-img {
  width: 120rpx; height: 120rpx; border-radius: 12rpx;
  margin: 0 10rpx 10rpx 0;
}
.dl-typing { display: flex; align-items: center; }
.dl-dot {
  width: 10rpx; height: 10rpx; border-radius: 50%;
  background: #98a19b; background: var(--ink-3, #98a19b);
  margin: 0 5rpx;
  animation: dl-blink 1.2s infinite both;
}
.dl-dot:nth-child(2) { animation-delay: 0.2s; }
.dl-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes dl-blink { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }

/* 回答区 */
.ask { flex-shrink: 0; padding-bottom: 20rpx; }
.chips { display: flex; flex-wrap: wrap; }
.chip {
  font-size: 24rpx; padding: 14rpx 28rpx; border-radius: 999rpx;
  margin: 0 14rpx 14rpx 0;
  color: #5a6560; color: var(--ink-2, #5a6560);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
}
.chip:active { opacity: 0.6; }
.chip-on {
  color: #ffffff;
  background: #e4173d; background: var(--brand, #e4173d);
  border-color: transparent;
}
.go {
  display: flex; align-items: center; justify-content: center;
  height: 72rpx; border-radius: 999rpx;
  font-size: 26rpx; font-weight: 500;
  color: #bb1332; color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  border: 2rpx solid rgba(228, 23, 61, 0.4);
  border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.4);
}
.go:active { opacity: 0.8; }

.thumbs { display: flex; flex-wrap: wrap; margin-bottom: 14rpx; }
.thumb { position: relative; margin: 0 14rpx 14rpx 0; }
.th-img { width: 130rpx; height: 130rpx; border-radius: 14rpx; }
.th-del {
  position: absolute; top: -8rpx; right: -8rpx;
  width: 40rpx; height: 40rpx; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 24rpx; line-height: 1; color: #ffffff;
  background: rgba(23, 32, 26, 0.62);
}

.bar { display: flex; align-items: flex-end; }
.input {
  flex: 1; min-height: 76rpx; max-height: 200rpx;
  box-sizing: border-box; padding: 18rpx 22rpx;
  font-size: 26rpx; line-height: 1.6;
  color: #17201a; color: var(--ink-1, #17201a);
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
  border-radius: 22rpx;
}
.pic {
  width: 76rpx; height: 76rpx; margin-left: 14rpx; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  font-size: 25rpx; color: #5a6560; color: var(--ink-2, #5a6560);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  border: 2rpx solid rgba(23, 32, 26, 0.1);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.1));
}
.pic:active { opacity: 0.6; }
.send {
  height: 76rpx; padding: 0 30rpx; margin-left: 14rpx; border-radius: 999rpx;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  font-size: 26rpx; font-weight: 500; color: #ffffff;
  background: #e4173d; background: var(--brand, #e4173d);
}
.send:active { opacity: 0.86; }
.send-off { background: rgba(228, 23, 61, 0.45); background: rgba(var(--brand-rgb, 228, 23, 61), 0.45); }

.skip { display: block; margin-top: 16rpx; text-align: center; font-size: 23rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

.finish { padding-top: 4rpx; }
.fin-btn { width: 100%; }
.fin-tip { display: block; margin-top: 16rpx; text-align: center; font-size: 22rpx; line-height: 1.6; color: #98a19b; color: var(--ink-3, #98a19b); }
</style>
