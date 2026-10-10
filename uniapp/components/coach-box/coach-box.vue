<template>
  <view class="cb" :class="{ 'cb-full': full }">
    <view class="cb-head">
      <text class="cb-title">跟 AI 说说今天</text>
      <text v-if="!full" class="cb-more" @tap.stop="goFull">全部对话 ›</text>
      <text v-else class="cb-more" @tap.stop="clearAll">清空</text>
    </view>

    <text class="cb-lead">做了什么、没做什么、临时换了什么 —— 直接说一句，AI 帮你判断要不要改后面的安排。</text>

    <!-- 快捷短语：给个起头，比对着空输入框想措辞快得多 -->
    <view class="cb-chips">
      <text v-for="c in chips" :key="c" class="cb-chip" @tap.stop="useChip(c)">{{ c }}</text>
    </view>

    <scroll-view
      v-if="shown.length || thinking"
      class="cb-msgs"
      scroll-y
      :scroll-into-view="bottomId"
      :scroll-with-animation="true"
    >
      <view v-for="(m, i) in shown" :key="i" class="cb-row" :class="m.role">
        <view class="cb-bubble" :class="m.role">{{ m.content }}</view>
      </view>
      <view v-if="thinking" class="cb-row assistant">
        <view class="cb-bubble assistant cb-typing">
          <view class="cb-dot"></view><view class="cb-dot"></view><view class="cb-dot"></view>
        </view>
      </view>
      <view id="cb-bottom"></view>
    </scroll-view>

    <!-- AI 没配：说清楚去哪开，别让输入框变成一个永远转圈的坑 -->
    <view v-if="aiOff" class="cb-off">
      <text class="cb-off-txt">AI 还没配置，先到「设置 → AI 服务」填好服务商与密钥。</text>
      <text class="cb-off-go" @tap.stop="goSettings">去设置 ›</text>
    </view>

    <!-- 判定"和计划有出入"才出现：照计划走完就别在这儿打扰 -->
    <view v-if="drift && !thinking" class="cb-act" @tap.stop="goReplan">
      <text class="cb-act-txt">今天和计划有出入，可以让 AI 重排后面几天</text>
      <text class="cb-act-go">去重排 ›</text>
    </view>

    <view class="cb-bar">
      <textarea
        class="cb-input"
        :value="draft"
        @input="onInput"
        :maxlength="-1"
        :auto-height="true"
        :show-confirm-bar="false"
        :disabled="thinking"
        placeholder="比如：今天背单词一个没做，跑去刷了两篇阅读"
        placeholder-style="color:#a8b0ab;font-size:25rpx"
      />
      <view class="cb-send" :class="{ 'cb-send-off': !canSend }" @tap.stop="send">{{ thinking ? '…' : '发送' }}</view>
    </view>
    <text v-if="err" class="cb-err">{{ err }}</text>
  </view>
</template>

<script>
// components/coach-box - 首页/对话页共用的"跟 AI 说说今天"
//
// 两处用法：首页卡片（compact，只留最近几条）与 pkgPlan/pages/coach（full，全部历史）。
// 状态全在 utils/coach.js 里按天存，两边看到的永远是同一段对话 ——
// 在首页说一半、点「全部对话」进去接着聊，不用重打一遍。
import * as coach from '../../utils/coach.js'
import * as pw from '../../utils/pwstore.js'
import { chatToday } from '../../services/plan-agent.js'
import { isAIEnabled } from '../../services/config.js'

export default {
  name: 'CoachBox',
  props: {
    full: { type: Boolean, default: false }
  },
  emits: ['changed'],
  data() {
    return {
      msgs: [],
      draft: '',
      thinking: false,
      drift: false,
      err: '',
      aiOff: false,
      chips: coach.CHIPS,
      bottomId: 'cb-bottom'
    }
  },
  computed: {
    // 首页只留最近几条，避免把首页撑成一屏聊天记录
    shown() {
      return this.full ? this.msgs : this.msgs.slice(-4)
    },
    canSend() {
      return !!String(this.draft || '').trim() && !this.thinking && !this.aiOff
    }
  },
  mounted() { this.refresh() },
  methods: {
    // 父页面 onShow 调一次即可：从对话页/重排页退回来要看到最新结果
    refresh() {
      this.msgs = coach.messages(pw.today())
      this.drift = coach.driftFlag(pw.today())
      this.aiOff = !isAIEnabled()
    },
    onInput(e) { this.draft = (e && e.detail && e.detail.value != null) ? e.detail.value : '' },
    useChip(c) {
      const cur = String(this.draft || '').trim()
      this.draft = cur ? (cur + '，' + c) : c
    },
    async send() {
      const text = String(this.draft || '').trim()
      if (!text || this.thinking) return
      if (this.aiOff) { this.goSettings(); return }
      const today = pw.today()
      this.draft = ''
      this.err = ''
      this.thinking = true
      coach.push(today, 'user', text)
      this.msgs = coach.messages(today)
      try {
        const r = await chatToday(text, coach.context(today), coach.messages(today))
        coach.push(today, 'assistant', r.reply)
        this.drift = !!r.drift
        coach.setDrift(today, !!r.drift)
        // 只有"确实和计划不一样"才写回收工记录 —— 他说按计划完成了就别制造偏差
        if (r.drift && r.facts.length) coach.applyFacts(today, r.facts)
        // 记功与偏差无关：说"按计划做完了"也要把番茄记上去，否则下次重排会让他重做
        if (r.credits && r.credits.length) coach.applyCredits(r.credits)
        this.msgs = coach.messages(today)
        this.$emit('changed')
      } catch (e) {
        // 用户的原话已经留在对话里了，失败不回滚：他不用重打一遍
        this.err = (e && e.message) || 'AI 没回应，稍后再试'
      } finally {
        this.thinking = false
      }
    },
    goReplan() {
      const id = coach.targetGoalId(pw.today())
      if (!id) {
        try { uni.showToast({ title: '先定一个目标，AI 才好重排', icon: 'none' }) } catch (e) {}
        return
      }
      // from=log：replan 会把今天的收工填报（含这里补记的事实）一起喂给模型
      uni.navigateTo({ url: '/pkgPlan/pages/replan/replan?id=' + id + '&from=log' })
    },
    goFull() { uni.navigateTo({ url: '/pkgPlan/pages/coach/coach' }) },
    goSettings() { uni.navigateTo({ url: '/pkgManage/pages/settings/settings' }) },
    clearAll() {
      uni.showModal({
        title: '清空今天的对话',
        content: '只清这段对话，今天已经记下的收工内容不受影响。',
        success: (r) => {
          if (!r.confirm) return
          coach.clear(pw.today())
          this.refresh()
          this.$emit('changed')
        }
      })
    }
  }
}
</script>

<style>
.cb { display: flex; flex-direction: column; }
.cb-full { flex: 1; min-height: 0; }

.cb-head { display: flex; align-items: center; justify-content: space-between; }
.cb-title {
  font-size: 30rpx; font-weight: 600;
  color: #17201a; color: var(--ink-1, #17201a);
}
.cb-more { font-size: 24rpx; color: #1d4fd8; color: var(--brand-strong, #1d4fd8); }

.cb-lead {
  display: block; margin-top: 12rpx;
  font-size: 23rpx; line-height: 1.6;
  color: #5a6560; color: var(--ink-2, #5a6560);
}

.cb-chips { display: flex; flex-wrap: wrap; margin-top: 18rpx; }
.cb-chip {
  font-size: 22rpx; padding: 10rpx 22rpx; border-radius: 999rpx;
  margin: 0 12rpx 12rpx 0;
  color: #5a6560; color: var(--ink-2, #5a6560);
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
}
.cb-chip:active { opacity: 0.6; }

/* 首页限高；全屏页吃掉剩余高度 */
.cb-msgs { max-height: 380rpx; margin-top: 18rpx; }
.cb-full .cb-msgs { flex: 1; max-height: none; }

.cb-row { display: flex; margin-bottom: 16rpx; }
.cb-row.user { justify-content: flex-end; }
.cb-row.assistant { justify-content: flex-start; }

.cb-bubble {
  max-width: 84%;
  padding: 18rpx 24rpx;
  border-radius: 22rpx;
  font-size: 26rpx; line-height: 1.65;
  word-break: break-word;
}
.cb-bubble.user {
  background: #2e6bff; background: var(--brand, #2e6bff);
  color: #ffffff;
  border-bottom-right-radius: 6rpx;
}
.cb-bubble.assistant {
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
  color: #17201a; color: var(--ink-1, #17201a);
  border-bottom-left-radius: 6rpx;
}
.cb-typing { display: flex; align-items: center; }
.cb-dot {
  width: 10rpx; height: 10rpx; border-radius: 50%;
  background: #98a19b; background: var(--ink-3, #98a19b);
  margin: 0 5rpx;
  animation: cb-blink 1.2s infinite both;
}
.cb-dot:nth-child(2) { animation-delay: 0.2s; }
.cb-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes cb-blink { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }

/* AI 未配置 */
.cb-off {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 16rpx; padding: 16rpx 22rpx; border-radius: 14rpx;
  background: rgba(247, 144, 9, 0.1);
}
.cb-off-txt { flex: 1; min-width: 0; font-size: 23rpx; line-height: 1.5; color: #8a5800; }
.cb-off-go { flex-shrink: 0; margin-left: 16rpx; font-size: 23rpx; color: #b26400; }

/* 判定有出入 → 重排入口 */
.cb-act {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 16rpx; padding: 16rpx 22rpx; border-radius: 14rpx;
  background: rgba(46, 107, 255, 0.1);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.1);
}
.cb-act-txt { flex: 1; min-width: 0; font-size: 23rpx; line-height: 1.5; color: #1d4fd8; color: var(--brand-strong, #1d4fd8); }
.cb-act-go { flex-shrink: 0; margin-left: 16rpx; font-size: 23rpx; font-weight: 600; color: #1d4fd8; color: var(--brand-strong, #1d4fd8); }

/* 输入条 */
.cb-bar { display: flex; align-items: flex-end; margin-top: 18rpx; }
.cb-input {
  flex: 1; min-width: 0;
  min-height: 76rpx; max-height: 220rpx;
  padding: 18rpx 22rpx;
  box-sizing: border-box;
  font-size: 26rpx; line-height: 1.5; text-align: left;
  color: #17201a; color: var(--ink-1, #17201a);
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
  border-radius: 18rpx;
}
.cb-send {
  flex-shrink: 0; margin-left: 16rpx;
  height: 76rpx; padding: 0 30rpx;
  display: flex; align-items: center; justify-content: center;
  font-size: 26rpx; font-weight: 600;
  color: #ffffff;
  background: #2e6bff; background: var(--brand, #2e6bff);
  border-radius: 999rpx;
}
.cb-send:active { opacity: 0.75; }
.cb-send-off {
  background: #a9c3ff;
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.45);
}

.cb-err {
  display: block; margin-top: 14rpx;
  font-size: 23rpx; line-height: 1.5;
  color: #c2323a;
}
</style>
