<template>
  <view class="container page-nav hv-page" :class="appTheme" :style="appBgStyle">
    <float-navbar title="额外收获" :back="true" />

    <!-- 对话区：AI 先就着刚做完的那一项问一句，用户随便说，说完它总结成一条带时间的记录 -->
    <scroll-view class="chat" scroll-y :scroll-into-view="bottomId" :scroll-with-animation="true">
      <view v-for="(m, i) in msgs" :key="i" class="dl-row" :class="m.role">
        <view class="dl-bubble" :class="m.role">
          <text class="dl-txt">{{ m.text }}</text>
        </view>
      </view>
      <view v-if="typing" class="dl-row assistant">
        <view class="dl-bubble assistant dl-typing">
          <view class="dl-dot"></view><view class="dl-dot"></view><view class="dl-dot"></view>
        </view>
      </view>
      <view id="hv-bottom"></view>
    </scroll-view>

    <!-- 回答区 -->
    <view class="ask">
      <block v-if="!saved">
        <view class="bar">
          <textarea
            class="input"
            :value="text"
            @input="onInput"
            :auto-height="true"
            :maxlength="-1"
            :show-confirm-bar="false"
            placeholder="想到什么说什么，一句也行"
            placeholder-style="color:#a8b0ab;font-size:25rpx"
          />
          <view class="send" :class="{ 'send-off': !text }" @tap="sendText">发送</view>
        </view>
        <view class="acts">
          <text v-if="lines.length" class="act-main" @tap="save">存下这次的收获</text>
          <text class="act-skip" @tap="skip">没有额外收获，直接返回 ›</text>
        </view>
      </block>
      <view v-else class="finish">
        <text class="fin-txt">已记进今天的完成台账，后面排任务时会参考。</text>
        <button class="btn-primary fin-btn" @tap="back">知道了</button>
      </view>
    </view>
  </view>
</template>

<script>
import * as pw from '../../../utils/pwstore.js'
import * as harvest from '../../../utils/harvest.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

export default {
  components: { FloatNavbar },
  data() {
    return {
      goalId: '',
      taskId: '',
      date: '',
      item: null,       // 台账里那一条（完成时间在这里）
      msgs: [],
      lines: [],        // 用户说的话（多轮累积）
      text: '',
      typing: false,
      saved: false,
      saving: false,
      bottomId: ''
    }
  },
  onLoad(query) {
    this.goalId = (query && query.goalId) || ''
    this.taskId = (query && query.taskId) || ''
    this.date = pw.today()
  },
  onShow() {
    // 已经开过场就不再重置（切后台回来、权限页回来都别把说过的话清掉）
    if (this.msgs.length) return
    this.item = harvest.listOf(this.date).filter(x => x.taskId === this.taskId)[0] || null
    this.start()
  },
  methods: {
    push(role, text) {
      this.msgs.push({ role: role, text: text })
      this.toBottom()
    },
    /** AI 说一句（带一点停顿，太快像脚本刷屏） */
    say(text) {
      this.typing = true
      this.toBottom()
      setTimeout(() => {
        this.typing = false
        this.msgs.push({ role: 'assistant', text: text })
        this.toBottom()
      }, 380)
    },
    toBottom() {
      this.bottomId = ''
      this.$nextTick(() => { this.bottomId = 'hv-bottom' })
    },
    /**
     * 开场：就着"刚做完的是哪一项 + 几点做的"问一句。
     * 这句是本地拼的，不调模型 —— 没配 AI / 断网时页面也必须能开口，
     * 而且"问什么"由已知信息决定，问模型纯属多余的一次往返。
     */
    start() {
      this.msgs = []
      const it = this.item
      const name = it ? it.title : this.fallbackTitle()
      const when = it ? it.atText : ''
      this.say('「' + name + '」' + (when ? when + ' 完成' : '已完成') + '。' +
        '除了任务本身，这次有没有什么额外的收获？' +
        '比如突然想通了一个卡了很久的点、发现某种学法更快、或者觉得这块不该排这么多 —— ' +
        '想到什么说什么，我会总结成一条带时间的记录，后面排任务时拿来参考。')
    },
    fallbackTitle() {
      const g = pw.goalOf(this.goalId)
      if (!g) return '这项任务'
      const t = (g.tasks || []).filter(x => x.id === this.taskId)[0]
      return t ? t.title : '这项任务'
    },
    onInput(e) {
      this.text = (e && e.detail && e.detail.value) || ''
    },
    sendText() {
      const v = String(this.text || '').trim()
      if (!v) return
      this.lines.push(v)
      this.push('user', v)
      this.text = ''
      // 接一句再等下一段：说完就被"已保存"打断，会让人怀疑自己说的话有没有被听见
      setTimeout(() => this.say(this.ack(v)), 260)
    },
    /** 本地接话（不调模型：这里只是"听见了"，总结在保存时做一次就够） */
    ack(v) {
      if (v.length <= 6) return '记下了。还有吗？没有就点「存下这次的收获」。'
      return '记下了。还有想说的就接着说，没有就点「存下这次的收获」。'
    },
    skip() {
      this.back()
    },
    async save() {
      if (this.saving || !this.lines.length) return
      this.saving = true
      this.typing = true
      try {
        const r = await harvest.saveHarvest(this.date, this.taskId, this.lines)
        this.typing = false
        if (!r.ok) {
          try { uni.showToast({ title: '这条完成记录已经不在了', icon: 'none' }) } catch (e) {}
          this.saving = false
          return
        }
        const h = r.harvest
        // 把总结回显一遍：用户该知道自己说的话被记成了什么
        this.push('assistant', h.summary +
          ((h.tags && h.tags.length) ? '\n标签：' + h.tags.join('、') : ''))
        this.saved = true
        this.toBottom()
      } catch (e) {
        this.typing = false
        try { uni.showToast({ title: '没存上，再试一次', icon: 'none' }) } catch (e2) {}
      } finally {
        this.saving = false
      }
    },
    back() {
      try { uni.navigateBack() } catch (e) { uni.switchTab({ url: '/pages/home/home' }) }
    }
  }
}
</script>

<style>
/* 整页 = 一上（对话滚动）一下（回答区），与「今日收工」同一套骨架 */
.hv-page { min-height: 100vh; display: flex; flex-direction: column; padding-bottom: 0; }
.chat { flex: 1; min-height: 0; padding: 16rpx 0 20rpx; }

.dl-row { display: flex; margin-bottom: 18rpx; }
.dl-row.user { justify-content: flex-end; }
.dl-row.assistant { justify-content: flex-start; }
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
.dl-typing { display: flex; align-items: center; }
.dl-dot {
  width: 10rpx; height: 10rpx; border-radius: 50%;
  background: #98a19b; background: var(--ink-3, #98a19b);
  margin: 0 5rpx;
  animation: hv-blink 1.2s infinite both;
}
.dl-dot:nth-child(2) { animation-delay: 0.2s; }
.dl-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes hv-blink { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }

.ask { flex-shrink: 0; padding-bottom: 20rpx; }
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
.send {
  height: 76rpx; padding: 0 30rpx; margin-left: 14rpx; border-radius: 999rpx;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  font-size: 26rpx; font-weight: 500; color: #ffffff;
  background: #e4173d; background: var(--brand, #e4173d);
}
.send:active { opacity: 0.86; }
.send-off { background: rgba(228, 23, 61, 0.45); background: rgba(var(--brand-rgb, 228, 23, 61), 0.45); }

.acts { margin-top: 16rpx; display: flex; align-items: center; justify-content: space-between; }
.act-main {
  font-size: 26rpx; font-weight: 500;
  color: #bb1332; color: var(--brand-strong, #bb1332);
}
.act-main:active { opacity: 0.6; }
.act-skip { font-size: 23rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
.act-skip:active { opacity: 0.6; }

.finish { padding-top: 4rpx; }
.fin-txt { display: block; font-size: 24rpx; line-height: 1.7; color: #5a6560; color: var(--ink-2, #5a6560); }
.fin-btn { width: 100%; margin-top: 20rpx; }
</style>
