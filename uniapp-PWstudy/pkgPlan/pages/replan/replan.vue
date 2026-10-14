<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="AI 重新规划" :busy="loading" />

    <!-- 加载中 -->
    <view v-if="loading" class="state">
      <view class="spin"></view>
      <text class="state-txt">
        {{ fromLog ? 'AI 正在结合你今天的收工填报和近 7 天的真实投入重排剩余任务…' : 'AI 正在结合你近 7 天的真实投入重排剩余任务…' }}
      </text>
    </view>

    <!-- 出错 -->
    <view v-else-if="error" class="state">
      <text class="error">{{ error }}</text>
      <button class="btn-primary retry" @tap="run">再试一次</button>
    </view>

    <!-- 结果预览 -->
    <view v-else-if="result" class="body">
      <view class="card" v-if="result.summary">
        <text v-if="logText" class="log-tip">今天的出入：{{ logText }}</text>
        <text class="summary">{{ result.summary }}</text>
        <text v-if="overdueText" class="overdue-tip">{{ overdueText }}</text>
        <text v-if="streakText" class="overdue-tip">{{ streakText }}</text>
      </view>

      <view class="card op-card" v-for="(op, i) in result.ops" :key="i" @tap="pick[i] = !pick[i]">
        <view class="pv-check" :class="{ 'pv-check-on': pick[i] }">{{ pick[i] ? '✓' : '' }}</view>
        <view class="op-main">
          <view class="op-line">
            <text class="op-level" :class="'lv-' + (op.level || 'content')">{{ levelText(op) }}</text>
            <text class="op-kind" :class="'op-' + op.op">{{ kindText(op) }}</text>
            <text class="op-title">{{ taskTitle(op) }}</text>
          </view>
          <view class="op-detail" v-if="opDetail(op)">{{ opDetail(op) }}</view>
          <view class="op-reason" v-if="op.reason || op.text">{{ op.reason || op.text }}</view>
        </view>
      </view>

      <view v-if="!result.ops.length" class="card state-inline">
        <text class="state-txt">AI 认为目前计划无需调整，按部就班执行就好。</text>
      </view>

      <view class="actions" v-if="result.ops.length">
        <button class="btn-ghost act-btn" @tap="back">先不改</button>
        <button class="btn-primary act-btn" :disabled="!pickedCount" @tap="apply">应用选中的 {{ pickedCount }} 条</button>
      </view>
    </view>
  </view>
</template>

<script>
import * as pw from '../../../utils/pwstore.js'
import * as dailylog from '../../../utils/dailylog.js'
import { replanGoal, replanFromToday } from '../../../services/plan-agent.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

export default {
  components: { FloatNavbar },
  data() {
    return {
      id: '', loading: false, error: '', result: null, pick: {},
      overdueText: '', streakText: '', fromLog: false, logText: ''
    }
  },
  computed: {
    pickedCount() {
      return Object.keys(this.pick).filter(k => this.pick[k]).length
    }
  },
  onLoad(query) {
    this.id = (query && query.id) || ''
    // from=log：从"今日收工"过来 —— 把今天的填报一起喂给 AI，
    // 它才知道"你今天做的和计划不一样在哪"，而不是只看专注总数瞎调。
    this.fromLog = !!(query && query.from === 'log')
    const log = this.fromLog ? dailylog.logOf(pw.today()) : null
    this.logText = log ? dailylog.driftText(log) : ''
  },
  onShow() {
    if (!this.result) this.run()
  },
  methods: {
    goal() { return pw.goalOf(this.id) },
    async run() {
      const g = this.goal()
      if (!g) { this.error = '目标不存在或已删除'; return }
      if (!g.tasks || !g.tasks.filter(t => t.status === 'todo').length) {
        this.error = '这个目标已经没有待办任务了，先去执行几天再来看。'
        return
      }
      this.loading = true
      this.error = ''
      try {
        // 现实情况：近 7 天真实投入 + 超期任务数（AI 据此判断该调策略、调内容还是顺延时间）
        const week = pw.recentDays(7).map(d => d.focusMin).join(', ')
        const elapsed = pw.dayDiff(pw.dateStr(new Date(g.createdAt)), pw.today()) + 1
        const overdue = (g.tasks || []).filter(t => t.status === 'todo' && t.day < elapsed)
        // 连续少做天数：模型数不出来，而"能不能顺延期限"全靠它 ——
        // 偶尔一天做不完不该动截止日，连续多天追不上才说明计划本身排错了
        const streak = dailylog.shortStreak(g.id)
        this.streakText = streak >= 2
          ? ('已经连续 ' + streak + ' 天没做完，AI 可以提议顺延截止日（要你自己勾）。')
          : ''
        this.overdueText = overdue.length
          ? ('当前有 ' + overdue.length + ' 个任务超期未完成，会优先用策略/内容解决，实在跟不上才顺延时间。')
          : ''
        const reality = {
          days: week,
          overdue: overdue.length,
          overdueIds: overdue.map(t => t.id),
          streak: streak
        }
        // 顺延上限：连续 2 天以上才开门，且一次最多推"剩余天数的一半"（3-30 天）。
        // 传 0 = 这次不许顺延，模型再想推也没这个 op
        const remainDays = pw.dayDiff(pw.today(), g.deadline)
        const maxDeferDays = streak >= 2
          ? Math.max(3, Math.min(30, Math.round(remainDays * 0.5)))
          : 0
        const opt = { maxDeferDays: maxDeferDays }
        const log = this.fromLog ? dailylog.logOf(pw.today()) : null
        this.result = log
          ? await replanFromToday(g, log, reality, opt)
          : await replanGoal(g, reality, opt)
        this.pick = {}
        // 默认勾选：策略与内容类直接采纳；时间类（改期限/顺延）交给用户确认 —— 它是最后手段
        this.result.ops.forEach((op, i) => { this.pick[i] = op.op !== 'note' && op.level !== 'time' })
      } catch (e) {
        this.error = (e && e.message) || '重排失败，请稍后再试'
      } finally {
        this.loading = false
      }
    },
    taskTitle(op) {
      const g = this.goal()
      if (!g) return ''
      // 顺延期限动的是整个目标，没有 taskId —— 显示目标名
      if (op.op === 'defer') return g.title
      const t = g.tasks.filter(x => x.id === op.taskId)[0]
      return t ? t.title : ''
    },
    kindText(op) {
      return { move: '改期', resize: '调整量', drop: '砍掉', defer: '顺延期限', note: '建议' }[op.op] || op.op
    },
    // 三档：策略 > 内容 > 时间（时间顺延是最后手段）
    levelText(op) {
      return { strategy: '策略', content: '内容', time: '时间' }[op.level || ''] || '内容'
    },
    opDetail(op) {
      if (op.op === 'move') return '开始时间：第 ' + op.day + ' 天'
      if (op.op === 'resize') return '预估专注：' + op.pomos + ' 个'
      if (op.op === 'defer') {
        const g = this.goal()
        const to = g ? pw.addDays(g.deadline, op.days) : ''
        return '截止日 ' + (g ? g.deadline : '') + ' → ' + to + '（往后 ' + op.days + ' 天）'
      }
      return ''
    },
    /** 顺延截止日：整条重排里代价最大的一条，所以单独拎出来做边界检查 */
    applyDefer(g, op) {
      const days = Math.max(1, Math.min(90, Math.floor(Number(op.days) || 0)))
      if (!days) return 0
      // 只许往后推（days 恒正），且累计顺延不超过 90 天 ——
      // 再多就不是"调整计划"而是"换个目标"了，那种该由人自己重新立一个
      const total = (g.deferred || 0) + days
      if (total > 90) return 0
      if (!g.origDeadline) g.origDeadline = g.deadline   // 留着原期限，页面上能显示"已顺延 N 天"
      g.deadline = pw.addDays(g.deadline, days)
      g.deferred = total
      g.deferredAt = Date.now()
      return days
    },
    apply() {
      const g = this.goal()
      if (!g) return
      // 顺延期限先落地：后面的 move 要按新的截止日夹取 maxDay
      let moved = 0
      this.result.ops.forEach((op, i) => {
        if (this.pick[i] && op.op === 'defer') moved += this.applyDefer(g, op)
      })
      this.result.ops.forEach((op, i) => {
        if (!this.pick[i] || op.op === 'defer') return
        const t = g.tasks.filter(x => x.id === op.taskId)[0]
        if (!t) return
        if (op.op === 'move') {
          // 夹到目标期限内：模型给的 day 上限是 3650，排到截止日之后的任务
          // 永远不会出现在"今天该做"里，目标会显示"没有待办"但进度不满
          const maxDay = Math.max(1, Math.round((new Date(g.deadline).getTime() - new Date(g.createdAt || Date.now()).getTime()) / 86400000) + 1)
          t.day = Math.min(Math.max(1, op.day || t.day), maxDay)
        }
        else if (op.op === 'resize') t.pomos = op.pomos
        else if (op.op === 'drop') { t.status = 'dropped'; t.droppedAt = Date.now() }
      })
      pw.touch()
      pw.flush()
      uni.showToast({
        title: moved ? ('已应用，截止日顺延 ' + moved + ' 天') : '已应用',
        icon: 'success'
      })
      setTimeout(() => uni.navigateBack(), 500)
    },
    back() { uni.navigateBack() }
  }
}
</script>

<style>
.state { padding: 100rpx 40rpx; display: flex; flex-direction: column; align-items: center; }
.state-txt { margin-top: 26rpx; font-size: 26rpx; line-height: 1.7; color: #5a6560; color: var(--ink-2, #5a6560); text-align: center; }
.error { font-size: 26rpx; line-height: 1.7; color: #c2323a; text-align: center; }
.retry { margin-top: 30rpx; width: 300rpx; height: 84rpx; font-size: 28rpx; }

.spin {
  width: 64rpx; height: 64rpx;
  border-radius: 50%;
  border: 6rpx solid rgba(228, 23, 61, 0.2);
  border: 6rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.2);
  border-top-color: #e4173d;
  border-top-color: var(--brand, #e4173d);
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.body .card { margin-bottom: 20rpx; }
.summary { display: block; font-size: 26rpx; line-height: 1.7; color: #17201a; color: var(--ink-1, #17201a); }
.overdue-tip {
  display: block; margin-top: 14rpx;
  font-size: 23rpx; line-height: 1.6; color: #8a5800;
}
.log-tip {
  display: block; margin-bottom: 14rpx;
  font-size: 23rpx; line-height: 1.6; color: #b26400;
}

/* 调整档位：策略优先、时间兜底 */
.op-level {
  flex-shrink: 0;
  font-size: 21rpx;
  padding: 4rpx 14rpx;
  border-radius: 8rpx;
  margin-right: 10rpx;
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
.lv-strategy { background: rgba(59, 109, 17, 0.12); color: #3b6d11; }
.lv-content { background: rgba(247, 144, 9, 0.14); color: #b26400; }
.lv-time { background: rgba(229, 72, 77, 0.12); color: #c2323a; }

.op-card { display: flex; align-items: flex-start; }
.pv-check {
  width: 40rpx; height: 40rpx;
  border-radius: 12rpx;
  border: 2rpx solid rgba(23, 32, 26, 0.2);
  border: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.2);
  display: flex; align-items: center; justify-content: center;
  font-size: 26rpx;
  color: #ffffff;
  flex-shrink: 0;
  margin-top: 4rpx;
}
.pv-check-on { background: #e4173d; background: var(--brand, #e4173d); border-color: transparent; }
.op-main { flex: 1; min-width: 0; margin-left: 20rpx; }
.op-line { display: flex; align-items: center; flex-wrap: wrap; }
.op-kind {
  flex-shrink: 0;
  font-size: 21rpx;
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  margin-right: 14rpx;
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
}
.op-drop { background: rgba(229, 72, 77, 0.1); color: #e5484d; }
.op-defer { background: rgba(194, 50, 58, 0.12); color: #c2323a; }
.op-resize { background: rgba(247, 144, 9, 0.14); color: #b26400; }
.op-note { background: rgba(23, 32, 26, 0.07); color: #5a6560; color: var(--ink-2, #5a6560); }
.op-title { font-size: 27rpx; color: #17201a; color: var(--ink-1, #17201a); }
.op-detail { margin-top: 8rpx; font-size: 23rpx; color: #5a6560; color: var(--ink-2, #5a6560); }
.op-reason { margin-top: 8rpx; font-size: 23rpx; line-height: 1.6; color: #98a19b; color: var(--ink-3, #98a19b); }

.state-inline { padding: 40rpx 30rpx; }

.actions { display: flex; margin: 10rpx 0 30rpx; }
.act-btn { flex: 1; }
.act-btn:first-child { margin-right: 20rpx; }
</style>
