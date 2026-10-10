<template>
  <view class="container page-nav daily-page" :class="appTheme" :style="appBgStyle">
    <float-navbar title="今日收工" :back="true" />

    <view class="card lead">
      <text class="lead-title">今天实际做了什么？</text>
      <text class="lead-txt">
        照着计划走的不用多说 —— 只要有一点不一样（没做完、提前做了后面的、临时换了别的），
        填完这页 AI 就会把它当成信号，重新安排后面几天的日程。
      </text>
    </view>

    <!-- 今天该做的 -->
    <view class="card" v-if="draft.items.length">
      <view class="card-head">
        <text class="card-title">今天该做的</text>
        <text class="card-more" @tap="fillAll">全部按计划完成</text>
      </view>
      <view v-for="(i, k) in draft.items" :key="i.taskId" class="dl-row">
        <view class="dl-main">
          <text class="dl-title">{{ i.title }}</text>
          <text class="dl-sub">{{ i.goalTitle }} · 第 {{ i.day }} 天 · 计划 {{ i.planned }} 个番茄</text>
        </view>
        <view class="step">
          <text class="st-btn" @tap="step(i, -1)">−</text>
          <text class="st-num" :class="{ 'st-num-zero': !i.actual, 'st-num-full': i.actual >= i.planned }">
            {{ i.actual }}/{{ i.planned }}
          </text>
          <text class="st-btn" @tap="step(i, 1)">＋</text>
        </view>
      </view>
    </view>
    <view class="card" v-else>
      <text class="card-title">今天没有安排任务</text>
      <text class="lead-txt">可以直接在下面填"计划外还做了什么"，AI 会据此调整。</text>
    </view>

    <!-- 后面几天的：提前做了就勾上 -->
    <view class="card" v-if="draft.ahead.length">
      <view class="card-head">
        <text class="card-title">提前做了后面的？</text>
      </view>
      <view v-for="i in draft.ahead" :key="i.taskId" class="dl-row">
        <view class="dl-main">
          <text class="dl-title">{{ i.title }}</text>
          <text class="dl-sub">{{ i.goalTitle }} · 原定第 {{ i.day }} 天</text>
        </view>
        <view class="step">
          <text class="st-btn" @tap="step(i, -1)">−</text>
          <text class="st-num" :class="{ 'st-num-zero': !i.actual, 'st-num-full': i.actual > 0 }">
            {{ i.actual }}
          </text>
          <text class="st-btn" @tap="step(i, 1)">＋</text>
        </view>
      </view>
      <text class="hint">做了几个填几个；没做的保持 0，不算偏差。</text>
    </view>

    <!-- 计划外 -->
    <view class="card">
      <view class="card-head"><text class="card-title">计划之外还做了什么</text></view>
      <textarea
        class="dl-input"
        v-model="draft.extras"
        :maxlength="-1"
        placeholder="比如：临时刷了 30 道阅读题 / 去看了一节网课"
        placeholder-style="color:#a8b0ab;font-size:25rpx"
      />
      <view class="moods">
        <text
          v-for="m in moods"
          :key="m.key"
          class="mood"
          :class="{ 'mood-on': draft.mood === m.key }"
          @tap="draft.mood = (draft.mood === m.key ? '' : m.key)"
        >{{ m.label }}</text>
      </view>
      <text class="hint">状态只影响 AI 的判断，不会被当成偷懒：状态差时它只会减量，不会动你的截止日期。</text>
      <textarea
        class="dl-input dl-note"
        v-model="draft.note"
        :maxlength="-1"
        placeholder="还有什么想让 AI 知道的？（可选）"
        placeholder-style="color:#a8b0ab;font-size:25rpx"
      />
    </view>

    <button class="btn-primary dl-submit" @tap="submit">
      {{ drift ? '提交，让 AI 重排后面' : '提交今天的记录' }}
    </button>
    <text class="tip">{{ drift ? '检测到和计划有出入，提交后会先给你看 AI 的建议，确认了才改。' : '和计划一致，提交后就只记一笔。' }}</text>

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

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      draft: { date: '', items: [], ahead: [], extras: '', mood: '', note: '' },
      moods: dailylog.MOODS,
      // 统一弹窗（components/app-dialog）：多个目标时用它选一个去重排
      dlg: { show: false, mode: 'sheet', title: '', content: '', confirmText: '确定', danger: false, seq: 0, action: '', items: [] }
    }
  },
  computed: {
    // 实时判定：一边填一边就能看出"有没有和计划不一样"
    drift() {
      return dailylog.driftOf({ items: this.draft.items, ahead: this.draft.ahead, extras: this.draft.extras })
    }
  },
  onShow() {
    // 提交过就别再重建：从 AI 重排页退回来时不该把刚填的清掉
    if (this.__done) return
    this.draft = dailylog.buildDraft()
  },
  methods: {
    step(i, n) {
      const cap = Math.max(1, i.planned || 1)
      const v = (Number(i.actual) || 0) + n
      i.actual = Math.max(0, Math.min(cap, v))
      // Vue2 风格的数组元素赋值在 uni-app 里未必触发，手动推一下
      this.$forceUpdate && this.$forceUpdate()
    },
    fillAll() {
      this.draft.items.forEach(i => { i.actual = Math.max(1, i.planned || 1) })
      this.$forceUpdate && this.$forceUpdate()
    },
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
      this.ask({
        title: '重排哪个目标？',
        mode: 'sheet',
        items: names,
        action: 'replan',
        ids: alive
      })
    },
    // ---------- 统一弹窗 ----------
    ask(cfg) {
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
.daily-page { padding-bottom: 60rpx; }
.lead-title { font-size: 30rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.lead-txt { display: block; margin-top: 14rpx; font-size: 24rpx; line-height: 1.7; color: #5a6560; color: var(--ink-2, #5a6560); }

.dl-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 22rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.06);
  border-bottom: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.06));
}
.dl-row:last-of-type { border-bottom: none; }
.dl-main { flex: 1; min-width: 0; }
.dl-title { font-size: 27rpx; color: #17201a; color: var(--ink-1, #17201a); }
.dl-sub { display: block; margin-top: 6rpx; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

.step { flex-shrink: 0; display: flex; align-items: center; margin-left: 18rpx; }
.st-btn {
  width: 52rpx; height: 52rpx; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 30rpx; line-height: 1;
  color: #5a6560; color: var(--ink-2, #5a6560);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  border: 2rpx solid rgba(23, 32, 26, 0.1);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.1));
}
.st-btn:active { opacity: 0.6; }
.st-num {
  min-width: 76rpx; text-align: center;
  font-size: 26rpx; font-family: Georgia, serif;
  color: #17201a; color: var(--ink-1, #17201a);
}
.st-num-zero { color: #98a19b; color: var(--ink-3, #98a19b); }
.st-num-full { color: #3b9d11; }

.dl-input {
  width: 100%; box-sizing: border-box;
  margin-top: 14rpx; padding: 18rpx 22rpx;
  font-size: 26rpx; line-height: 1.6; text-align: left;
  color: #17201a; color: var(--ink-1, #17201a);
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
  border-radius: 16rpx;
}
.dl-note { margin-top: 20rpx; }

.moods { display: flex; flex-wrap: wrap; margin-top: 20rpx; }
.mood {
  font-size: 23rpx; padding: 10rpx 24rpx; border-radius: 999rpx;
  margin: 0 12rpx 12rpx 0;
  color: #5a6560; color: var(--ink-2, #5a6560);
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
}
.mood-on {
  color: #ffffff;
  background: #2e6bff; background: var(--brand, #2e6bff);
  border-color: transparent;
}

.hint { display: block; margin-top: 16rpx; font-size: 22rpx; line-height: 1.6; color: #98a19b; color: var(--ink-3, #98a19b); }
.dl-submit { margin-top: 30rpx; }
.tip { display: block; margin-top: 20rpx; text-align: center; font-size: 23rpx; line-height: 1.6; color: #98a19b; color: var(--ink-3, #98a19b); }
</style>
