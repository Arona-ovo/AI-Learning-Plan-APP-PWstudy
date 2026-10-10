<template>
  <view
    class="container page-tabbar page-nav"
    :class="appTheme"
    :style="appBgStyle"
    @touchstart="onSlideStart"
    @touchmove="onSlideMove"
    @touchend="onSlideEnd"
    @touchcancel="onSlideEnd"
  >
    <float-navbar title="PWstudy" />

    <view class="page-slide home-slide" :class="slideCls" :style="slideStyle">

      <!-- ===== 番茄进行中：首页被"硬控"，只剩倒计时 =====
           计时一旦开始，首页不再显示任务列表 / 目标 / Dock 这些会让人分心的东西；
           想看的话先暂停或结束这一轮。 -->
      <view v-if="locked" class="lock">
        <text class="lock-phase">{{ phaseText }}</text>

        <!-- 点环 = 进全屏专注页（首页这一屏刻意只留"看时间"这一件事） -->
        <view class="lock-ring" :class="{ 'lock-ring-run': running }" @tap="goFocus()">
          <view class="lock-ring-inner">
            <text class="lock-time">{{ fmtMMSS(cur.remainSec) }}</text>
            <text class="lock-task">{{ cur.taskTitle || '自由专注' }}</text>
          </view>
        </view>

        <view class="lock-ctrl">
          <button class="lock-btn lock-btn-main" @tap="togglePause">{{ cur.paused ? '继续' : '暂停' }}</button>
          <button class="lock-btn lock-btn-ghost" @tap="confirmGiveUp">放弃</button>
        </view>

        <text v-if="(strictOn || forcedOn) && !usageOk" class="lock-warn" @tap="openUsage">
          严格 / 强制模式需要「使用情况访问」权限才能判断你在用哪个 App，点这里去开启
        </text>
        <text v-else class="lock-foot">{{ lockFoot }}</text>

        <text class="lock-today">今日 {{ todayMin }} 分钟 · {{ todayPomo }} 个番茄</text>
      </view>

      <!-- ===== 空闲态：默认只留三张卡 ===== -->
      <block v-else>
      <!-- 番茄钟状态卡 -->
      <view class="card focus-card" @tap="goFocus()">
        <view class="fc-main">
          <view class="fc-ring" :class="{ 'fc-ring-run': running }">
            <text class="fc-time">{{ running ? fmtMMSS(cur.remainSec) : fmtHM(todayMin) }}</text>
          </view>
          <view class="fc-info">
            <view class="fc-title">{{ running ? (cur.phase === 'rest' ? '休息中' : '专注中') : '今日专注' }}</view>
            <view class="fc-sub">{{ running ? cur.taskTitle : (todayPomo + ' 个番茄 · 点开始进入专注') }}</view>
          </view>
          <view class="fc-go">{{ running ? '继续' : '开始' }}</view>
        </view>
      </view>

      <!-- 权限 / 后台保活：不开的话计时会中途断、应用列表读不出来 -->
      <view class="card setup-card" v-if="setupPending.length" @tap="goSetup()">
        <view class="sc-main">
          <view class="sc-badge">{{ setupPending.length }}</view>
          <view class="sc-info">
            <view class="sc-title">还有设置没完成</view>
            <view class="sc-sub">{{ setupNames }} · 不处理的话计时可能锁屏就断</view>
          </view>
          <text class="sc-go">去设置 ›</text>
        </view>
      </view>

      <!-- 未完成的 AI 规划：退出页面也能接着聊 -->
      <view class="card resume-card" v-if="resumePlan" @tap="goWizard()">
        <view class="rc-main">
          <view class="rc-dot" :class="{ 'rc-dot-run': resumePlan.running }"></view>
          <view class="rc-info">
            <view class="rc-title">AI 规划进行中</view>
            <view class="rc-sub">{{ resumeText }}</view>
          </view>
          <text class="rc-go">继续 ›</text>
        </view>
      </view>

      <!-- 今日任务 -->
      <view class="card" v-if="show('task')">
        <view class="card-head">
          <text class="card-title">今日任务</text>
          <view class="head-acts">
            <text class="card-more" @tap="goDaily()">{{ checked ? '改填报' : '今日收工' }}</text>
            <text class="card-more" @tap="switchGoals()">全部目标 ›</text>
          </view>
        </view>
        <!-- 收工状态：有出入就提示，没填报就催一下 -->
        <view v-if="checkText" class="ck-bar" @tap="goDaily()">
          <text class="ck-txt">{{ checkText }}</text>
          <text class="ck-go">{{ checked ? '改一下' : '去填报' }} ›</text>
        </view>
        <!-- 今天没做完：按 策略 > 内容 > 时间 往后顺延 -->
        <view v-if="lateInfo" class="late-bar" @tap="goReplan(lateInfo.goalId)">
          <text class="lb-txt">{{ lateInfo.n }} 项没按时完成</text>
          <text class="lb-go">让 AI 顺延 ›</text>
        </view>
        <view v-if="!queue.length" class="empty">
          <text class="empty-txt">没有待办任务。定一个远期目标，AI 帮你拆成每天的日程。</text>
          <button class="btn-primary empty-btn" @tap="goWizard()">＋ AI 规划目标</button>
        </view>
        <view v-else class="task-list">
          <view
            v-for="item in queue"
            :key="item.task.id"
            class="task"
            hover-class="task-press"
            @tap="startFor(item)"
          >
            <view class="tk-dot" :class="{ 'tk-dot-late': item.overdue }"></view>
            <view class="tk-main">
              <view class="tk-title">{{ item.task.title }}</view>
              <view class="tk-sub">
                {{ item.goal.title }} · 第 {{ item.task.day }} 天 · {{ item.task.donePomos }}/{{ item.task.pomos }} 番茄
                <text v-if="item.overdue" class="tk-late">已超期</text>
              </view>
            </view>
            <!-- 点行 = 直接开始（快路径）；点这个 ⋯ = 弹出操作对话框 -->
            <text class="tk-play" @tap.stop="taskMenu(item)">⋯</text>
          </view>
        </view>
      </view>

      <!-- 跟 AI 说说今天：不想逐项填表时，一句话说完，AI 自己判断算不算偏离 -->
      <view class="card coach-card" v-if="show('coach')">
        <coach-box ref="coach" @changed="onCoachChanged" />
      </view>

      <!-- 目标进度 -->
      <view class="card" v-if="goals.length && show('goal')">
        <view class="card-head">
          <text class="card-title">进行中的目标</text>
          <text class="card-more" @tap="switchGoals()">管理 ›</text>
        </view>
        <view
          v-for="g in goals"
          :key="g.id"
          class="goal-row"
          @tap="goDetail(g.id)"
        >
          <view class="gr-top">
            <text class="gr-title">{{ g.title }}</text>
            <text class="gr-days">{{ remainDays(g) > 0 ? '剩 ' + remainDays(g) + ' 天' : '已到期' }}</text>
          </view>
          <view class="progress-track">
            <view class="progress-fill" :style="{ width: progressOf(g).pct + '%' }"></view>
          </view>
          <view class="gr-sub">{{ progressOf(g).done }}/{{ progressOf(g).total }} 番茄 · {{ progressOf(g).pct }}%</view>
        </view>
      </view>

      <!-- AppDock -->
      <view class="card" v-if="show('dock')">
        <view class="card-head">
          <text class="card-title">学习 App</text>
          <text class="card-more" @tap="goApps()">管理 ›</text>
        </view>
        <view v-if="!dock.length" class="empty">
          <text class="empty-txt">把背单词、刷题用的 App 加进来，一键直达并自动统计用时。</text>
          <button class="btn-ghost empty-btn" @tap="goApps()">＋ 添加 App</button>
        </view>
        <view v-else class="dock">
          <view
            v-for="a in dock"
            :key="a.pkg"
            class="dock-item"
            hover-class="dock-press"
            @tap="openApp(a)"
          >
            <view class="dk-icon" :class="{ 'dk-rest': a.purpose === 'rest' }">{{ initialOf(a) }}</view>
            <text class="dk-name">{{ a.name }}</text>
          </view>
        </view>
        <view v-if="dock.length" class="dock-hint">今日 {{ appTodayMin }} 分钟 · 点图标直达</view>
      </view>
      </block>

    </view>

    <float-tabbar ref="tabbar" current="home" />
  </view>
</template>

<script>
import * as pw from '../../utils/pwstore.js'
import * as focus from '../../utils/focus.js'
import * as apptime from '../../utils/apptime.js'
import * as planTask from '../../utils/plan-task.js'
import * as strict from '../../utils/strict.js'
import * as forced from '../../utils/forced.js'
import * as setup from '../../utils/setup.js'
import * as dailylog from '../../utils/dailylog.js'
import * as layout from '../../utils/home-layout.ts'
import { hideNativeTabBar, syncTabbar } from '../../utils/nav.js'
import tabSlideMixin from '../../utils/tab-slide-mixin.js'
import FloatTabbar from '../../components/float-tabbar/float-tabbar.vue'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'
import CoachBox from '../../components/coach-box/coach-box.vue'

export default {
  components: { FloatTabbar, FloatNavbar, CoachBox },
  mixins: [tabSlideMixin('home')],
  data() {
    return {
      cur: null,
      todayMin: 0,
      todayPomo: 0,
      queue: [],
      goals: [],
      dock: [],
      appTodayMin: 0,
      resumePlan: null,
      setupPending: [],
      checked: false,
      checkText: '',
      // 当前首页放了哪些模块（见 utils/home-layout.ts）
      // 这里直接读一次而不是留空：留空会让首帧所有卡都闪一下才出现。
      layoutIds: layout.layout(),
      strictOn: false,    // 严格模式：离开学习 App 就提醒，30 秒不回来作废
      forcedOn: false,    // 强制模式：离开就立刻把 PWstudy 拉回前台
      usageOk: false      // 「使用情况访问」权限：强制模式的能力前提
    }
  },
  computed: {
    setupNames() {
      return this.setupPending.map(x => x.title).join('、')
    },
    running() {
      return !!(this.cur && !this.cur.paused)
    },
    /**
     * 计时一开始，首页就被倒计时"硬控"。
     * 只要还有一轮在跑（专注 / 休息 / 暂停），任务列表、目标、Dock 一律收起来：
     * 首页在这一刻只该有一件事 —— 看着剩下的时间走完。
     */
    locked() {
      const c = this.cur
      return !!(c && c.phase)
    },
    phaseText() {
      const c = this.cur
      if (!c) return ''
      if (c.paused) return '已暂停'
      return c.phase === 'rest' ? '休息中' : '专注中'
    },
    // 硬控屏底部那句话：把"现在是哪档约束"说清楚，别让人蒙着
    lockFoot() {
      if (this.forcedOn) return '强制模式已开启 · 结束前不能切到非学习 App'
      if (this.strictOn) return '严格模式已开启 · 离开 30 秒这次作废'
      return '撑到这一声铃响，别划走'
    },
    resumeText() {
      const s = this.resumePlan
      if (!s) return ''
      if (s.plan) return '计划已生成，等你勾选落地'
      if (s.stage === 'plan') return '正在生成计划…'
      if (s.stage === 'error') return '上次出错了，点开重试'
      if (s.paused) return '已暂停，可以改完再继续'
      return 'AI 还想再问你几个问题'
    },
    lateInfo() {
      const late = this.queue.filter(i => i.overdue)
      if (!late.length) return null
      return { n: late.length, goalId: late[0].goal.id }
    }
  },
  onShow() {
    hideNativeTabBar()
    syncTabbar(this)
    this.refresh()
    this.startTick()
    // 从对话页/重排页退回来：让对话框拿到最新结果（判定过的"有出入"还在）
    if (this.$refs.coach && this.$refs.coach.refresh) this.$refs.coach.refresh()
    // 从设置页回来要重新实测一次（系统页是全屏的，回来才知道开没开）
    if (this.__fromSetup) {
      this.__fromSetup = false
      this.refreshSetup()
      return
    }
    this.maybeSetupPrompt()
  },
  onHide() {
    this.stopTick()
  },
  onUnload() {
    this.stopTick()
  },
  methods: {
    refresh() {
      const ov = pw.overview()
      this.todayMin = ov.todayMin
      this.todayPomo = ov.pomo
      this.queue = pw.todayQueue(6)
      this.goals = pw.activeGoals()
      this.dock = pw.dock()
      this.appTodayMin = this.sumAppMin()
      this.syncResume()
      this.refreshSetup()
      this.refreshCheck()
      this.syncLayout()
      this.strictOn = !!strict.enabled()
      this.forcedOn = !!forced.enabled()
      this.usageOk = apptime.hasUsagePermission()
    },
    // ---------- 首页模块显隐 ----------
    // 出厂默认只放三张；用户可在「首页自定义」里加回来。layout 为空时
    // home-layout 会自动回落到 defaultLayout()，所以这里直接读就行。
    syncLayout() {
      try {
        this.layoutIds = layout.layout()
      } catch (e) {
        this.layoutIds = layout.defaultLayout()
      }
    },
    show(id) {
      return this.layoutIds.indexOf(id) >= 0
    },
    // ---------- 今日收工 ----------
    // 收工是"动态安排"的输入口：今天做的和计划不一样，AI 才有理由重排后面。
    refreshCheck() {
      let log = null
      try { log = dailylog.logOf(pw.today()) } catch (e) {}
      this.checked = !!log
      if (!log) {
        // 晚上还没收工才催，白天不打扰
        const h = new Date().getHours()
        this.checkText = h >= 20 ? '今天还没收工，花十几秒勾一下，AI 才好安排明天' : ''
        return
      }
      this.checkText = dailylog.driftOf(log)
        ? ('今天和计划有出入：' + dailylog.driftText(log) + '，可以让 AI 重排后面')
        : '今天按计划完成了'
    },
    goDaily() { uni.navigateTo({ url: '/pkgPlan/pages/daily/daily' }) },
    // AI 可能补记了收工事实、也可能把某个任务记成已完成 → 提示条和今日队列都要跟着变
    onCoachChanged() { this.refresh() },
    // ---------- 权限与后台保活 ----------
    refreshSetup() {
      let list = []
      try { list = setup.pending() } catch (e) {}
      this.setupPending = list
    },
    // 首次进入（或有新缺项）主动问一次：不然用户根本不知道要开这些
    maybeSetupPrompt() {
      let need = false
      try { need = setup.shouldPrompt() } catch (e) { need = false }
      if (!need) return
      setup.markPrompted()
      uni.showModal({
        title: '先开几个权限',
        content: '通知、使用情况访问、电池优化白名单 —— 不开的话番茄锁屏会被系统回收、学习 App 列表读不出来。现在去设置吗？',
        confirmText: '去设置',
        cancelText: '以后再说',
        success: (r) => {
          if (r.confirm) {
            this.__fromSetup = true
            uni.navigateTo({ url: '/pkgManage/pages/setup/setup' })
          }
        }
      })
    },
    goSetup() {
      this.__fromSetup = true
      uni.navigateTo({ url: '/pkgManage/pages/setup/setup' })
    },
    // 规划是后台任务，退出页面不丢：这里给一个回来的入口
    syncResume() {
      const s = planTask.snapshot()
      const alive = s.stage === 'ask' || s.stage === 'plan' || s.stage === 'error' ||
        (s.stage === 'done' && !!s.plan)
      this.resumePlan = alive ? s : null
    },
    sumAppMin() {
      const d = pw.get().daily[pw.today()]
      if (!d || !d.byApp) return 0
      let s = 0
      Object.keys(d.byApp).forEach(k => { s += d.byApp[k] })
      return s
    },
    // ---------- 番茄 ----------
    // 首页被"硬控"时，这三个就是全部操作：让时间继续 / 让时间停下 / 不学了
    togglePause() {
      if (!this.cur) { this.goFocus(); return }
      if (this.cur.paused) focus.resume()
      else focus.pause()
      this.cur = focus.current()
      strict.sync()
      forced.sync()
    },
    confirmGiveUp() {
      uni.showModal({
        title: '结束这一轮？',
        content: '满 1 分钟会按实际时长记录，但不算完成任务量。',
        confirmText: '结束',
        confirmColor: '#E5484D',
        success: (r) => {
          if (!r.confirm) return
          focus.giveUp()
          this.cur = null
          this.refresh()
          strict.sync()
          forced.sync()
        }
      })
    },
    // 强制模式的能力前提是 UsageStats：没有它就不知道前台是谁，只能提示
    openUsage() {
      apptime.openUsageSettings()
      setTimeout(() => { this.usageOk = apptime.hasUsagePermission() }, 1200)
    },
    startTick() {
      this.stopTick()
      this.tick()
      this.__timer = setInterval(() => this.tick(), 1000)
    },
    stopTick() {
      if (this.__timer) { clearInterval(this.__timer); this.__timer = 0 }
    },
    tick() {
      const r = focus.tick()
      this.cur = r.state
      strict.sync()   // 严格模式跟番茄同步：有在跑才轮询，没在跑一次都不查
      forced.sync()   // 强制模式同理：只有「正在专注且没暂停」才盯着前台
      if (r.justFinished === 'focus') {
        this.refresh()
        uni.showToast({ title: '番茄完成！休息一下', icon: 'success' })
      }
    },
    startFor(item) {
      if (this.cur) {
        uni.showToast({ title: '有一个番茄正在进行', icon: 'none' })
        return
      }
      uni.navigateTo({
        url: '/pkgPlan/pages/focus/focus?auto=1&taskId=' + item.task.id +
             '&goalId=' + item.goal.id +
             '&title=' + encodeURIComponent(item.task.title)
      })
    },
    goFocus() {
      // auto=1：进页面直接起表（否则还得在专注页再点一次"开始"）
      uni.navigateTo({ url: '/pkgPlan/pages/focus/focus?auto=1' })
    },
    // 每日任务的操作对话框：开始 / 完成 / 改期 / 详情
    taskMenu(item) {
      const list = ['开始专注', '标记完成', '改到明天', '看目标详情']
      uni.showActionSheet({
        itemList: list,
        success: (r) => {
          if (r.tapIndex === 0) this.startFor(item)
          else if (r.tapIndex === 1) this.markDone(item)
          else if (r.tapIndex === 2) this.pushTomorrow(item)
          else if (r.tapIndex === 3) this.goDetail(item.goal.id)
        },
        fail: () => {}
      })
    },
    markDone(item) {
      pw.setTaskStatus(item.goal.id, item.task.id, 'done')
      pw.flush()
      this.refresh()
      try { uni.showToast({ title: '已标记完成', icon: 'success' }) } catch (e) {}
    },
    pushTomorrow(item) {
      pw.moveTaskDay(item.goal.id, item.task.id, (item.task.day || 1) + 1)
      pw.flush()
      this.refresh()
      try { uni.showToast({ title: '已改到明天', icon: 'none' }) } catch (e) {}
    },
    // ---------- 跳转 ----------
    goWizard() { uni.navigateTo({ url: '/pkgPlan/pages/wizard/wizard' }) },
    goDetail(id) { uni.navigateTo({ url: '/pkgPlan/pages/goal-detail/goal-detail?id=' + id }) },
    goApps() { uni.navigateTo({ url: '/pkgPlan/pages/apps/apps' }) },
    goReplan(id) { uni.navigateTo({ url: '/pkgPlan/pages/replan/replan?id=' + id }) },
    switchGoals() { uni.switchTab({ url: '/pages/goals/goals' }) },
    openApp(a) {
      apptime.launchApp(a.pkg)
    },
    // ---------- 展示 ----------
    fmtMMSS(sec) {
      sec = Math.max(0, Number(sec) || 0)
      const m = Math.floor(sec / 60)
      const s = sec % 60
      return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s)
    },
    fmtHM(min) {
      min = Number(min) || 0
      if (min < 60) return min + '分'
      return Math.floor(min / 60) + '时' + (min % 60 ? (min % 60) + '分' : '')
    },
    remainDays(g) {
      return pw.dayDiff(pw.today(), g.deadline)
    },
    progressOf(g) { return pw.goalProgress(g) },
    initialOf(a) {
      const s = String(a.name || a.pkg || '?')
      return s.slice(0, 1).toUpperCase()
    }
  }
}
</script>

<style>
/* 卡片间距：.card 本身不带外边距（它是通用窗体），首页这一摞靠这里统一拉开。
   之前只有带专属 class 的几张卡有 margin，剩下的今日任务/目标/AppDock 是贴着的。 */
.home-slide > .card { margin-bottom: 20rpx; }
.home-slide > .card:last-child { margin-bottom: 0; }

/* ===== 番茄进行中：首页被倒计时"硬控" =====
   这一屏刻意只留三样东西：还剩多久、在为谁计时、继续/停下。
   任务列表、目标进度、Dock 全收起来，不给"顺手划两下"的机会。 */
.lock {
  display: flex; flex-direction: column; align-items: center;
  padding: 40rpx 0 calc(40rpx + env(safe-area-inset-bottom));
}
.lock-phase {
  font-size: 26rpx; letter-spacing: 6rpx; text-indent: 6rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
.lock-ring {
  margin-top: 46rpx;
  width: 460rpx; height: 460rpx;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  border: 6rpx solid rgba(225, 29, 72, 0.22);
  border: 6rpx solid rgba(var(--brand-rgb, 225, 29, 72), 0.22);
}
.lock-ring-run { animation: lock-pulse 2.2s ease-in-out infinite; }
@keyframes lock-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.03); }
}
.lock-ring-inner {
  width: 398rpx; height: 398rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.82);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.82);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  box-shadow: 0 16rpx 48rpx rgba(23, 32, 26, 0.1);
  box-shadow: 0 16rpx 48rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.1);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.lock-time {
  font-size: 102rpx; font-weight: 500;
  font-family: Georgia, "Times New Roman", serif;
  letter-spacing: 2rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.lock-task {
  margin-top: 12rpx; max-width: 300rpx;
  font-size: 25rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  text-align: center;
}
.lock-ctrl { margin-top: 60rpx; display: flex; align-items: center; }
.lock-btn {
  height: 92rpx;
  border-radius: 999rpx;
  font-size: 29rpx; font-weight: 500;
  letter-spacing: 2rpx; text-indent: 2rpx;
  box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  margin: 0 14rpx;
}
.lock-btn::after { border: none; }
.lock-btn-main { width: 280rpx; background: #e11d48; background: var(--brand, #e11d48); color: #ffffff; }
.lock-btn-ghost {
  width: 200rpx;
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
/* 强制模式缺权限：不藏着，直接在硬控屏上给一条可点的路 */
.lock-warn {
  margin-top: 34rpx;
  padding: 16rpx 26rpx;
  border-radius: 14rpx;
  background: rgba(247, 144, 9, 0.14);
  font-size: 23rpx; line-height: 1.6;
  color: #b25e00;
  text-align: center;
}
.lock-foot {
  margin-top: 40rpx;
  font-size: 24rpx; letter-spacing: 2rpx; text-indent: 2rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
.lock-today {
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* ===== 未完成的 AI 规划 ===== */
.resume-card { margin-bottom: 20rpx; }
.rc-main { display: flex; align-items: center; }
.rc-dot {
  width: 16rpx; height: 16rpx; border-radius: 50%;
  background: #f79009; background: var(--brand, #f79009);
  margin-right: 18rpx; flex-shrink: 0;
}
.rc-dot-run { animation: rc-blink 1.2s ease-in-out infinite; }
@keyframes rc-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
.rc-info { flex: 1; min-width: 0; }
.rc-title { font-size: 29rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.rc-sub { font-size: 23rpx; color: #5a6560; color: var(--ink-2, #5a6560); margin-top: 6rpx; }
.rc-go { font-size: 25rpx; color: #1d4fd8; color: var(--brand-strong, #1d4fd8); flex-shrink: 0; }

/* ===== 今日收工 ===== */
.head-acts { display: flex; align-items: center; }
.head-acts .card-more:first-child { margin-right: 22rpx; }
.ck-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16rpx 22rpx; margin-bottom: 16rpx;
  border-radius: 14rpx;
  background: rgba(247, 144, 9, 0.1);
}
.ck-txt { flex: 1; min-width: 0; font-size: 23rpx; line-height: 1.5; color: #8a5800; }
.ck-go { flex-shrink: 0; margin-left: 16rpx; font-size: 23rpx; color: #b26400; }

/* ===== 权限 / 后台保活提醒卡 ===== */
.setup-card { margin-bottom: 20rpx; }
.sc-main { display: flex; align-items: center; }
.sc-badge {
  width: 44rpx; height: 44rpx; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 24rpx; font-weight: 600; color: #ffffff;
  background: #f79009;
  margin-right: 18rpx; flex-shrink: 0;
}
.sc-info { flex: 1; min-width: 0; }
.sc-title { font-size: 29rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.sc-sub { font-size: 22rpx; color: #5a6560; color: var(--ink-2, #5a6560); margin-top: 6rpx; line-height: 1.5; }
.sc-go { font-size: 25rpx; color: #1d4fd8; color: var(--brand-strong, #1d4fd8); flex-shrink: 0; }

/* ===== 超期提示条 ===== */
.late-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16rpx 22rpx; margin-bottom: 16rpx;
  border-radius: 14rpx;
  background: rgba(247, 144, 9, 0.12);
  border: 2rpx solid rgba(247, 144, 9, 0.3);
}
.lb-txt { font-size: 25rpx; color: #b25e00; }
.lb-go { font-size: 25rpx; font-weight: 600; color: #f79009; }

/* ===== 番茄钟状态卡 ===== */
.focus-card { margin-bottom: 20rpx; }
.fc-main { display: flex; align-items: center; }
.fc-ring {
  width: 150rpx; height: 150rpx;
  border-radius: 50%;
  border: 6rpx solid rgba(46, 107, 255, 0.25);
  border: 6rpx solid rgba(var(--brand-rgb, 46, 107, 255), 0.25);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.fc-ring-run {
  border-color: #e5484d;
  animation: fc-pulse 2s ease-in-out infinite;
}
@keyframes fc-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}
.fc-time {
  font-size: 34rpx; font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", serif;
}
.fc-info { flex: 1; min-width: 0; margin-left: 28rpx; }
.fc-title {
  font-size: 30rpx; font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.fc-sub {
  margin-top: 8rpx; font-size: 24rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fc-go {
  flex-shrink: 0;
  font-size: 26rpx; font-weight: 600;
  color: #ffffff;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  border-radius: 999rpx;
  padding: 14rpx 32rpx;
}

/* ===== 卡片头 ===== */
.card-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 24rpx;
}
.card-title {
  font-size: 30rpx; font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.card-more { font-size: 24rpx; color: #1d4fd8; color: var(--brand-strong, #1d4fd8); }

/* ===== 空态 ===== */
.empty { padding: 20rpx 0 8rpx; }
.empty-txt {
  display: block;
  font-size: 25rpx; line-height: 1.7;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
.empty-btn { margin-top: 24rpx; height: 84rpx; font-size: 28rpx; }

/* ===== 任务列表 ===== */
.task-list { margin: -6rpx 0; }
.task {
  display: flex; align-items: center;
  padding: 22rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.07);
  border-bottom: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}
.task:last-child { border-bottom: none; }
.task-press { opacity: 0.7; }
.tk-dot {
  width: 18rpx; height: 18rpx; border-radius: 50%;
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  flex-shrink: 0;
}
.tk-dot-late { background: #f79009; }
.tk-main { flex: 1; min-width: 0; margin: 0 20rpx; }
.tk-title {
  font-size: 28rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tk-sub {
  margin-top: 6rpx; font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
.tk-late {
  margin-left: 10rpx;
  color: #e5484d;
}
.tk-play { font-size: 26rpx; color: #1d4fd8; color: var(--brand-strong, #1d4fd8); flex-shrink: 0; }

/* ===== 目标进度 ===== */
.goal-row { padding: 18rpx 0; }
.gr-top { display: flex; align-items: center; justify-content: space-between; }
.gr-title {
  font-size: 28rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gr-days { font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); flex-shrink: 0; margin-left: 16rpx; }
.gr-sub { margin-top: 10rpx; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

/* ===== AppDock ===== */
.dock { display: flex; flex-wrap: wrap; }
.dock-item {
  width: 25%;
  display: flex; flex-direction: column; align-items: center;
  padding: 14rpx 0;
}
.dock-press { opacity: 0.7; }
.dk-icon {
  width: 92rpx; height: 92rpx;
  border-radius: 24rpx;
  background: rgba(46, 107, 255, 0.12);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.12);
  display: flex; align-items: center; justify-content: center;
  font-size: 36rpx; font-weight: 600;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
}
.dk-rest {
  background: rgba(122, 124, 122, 0.14);
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
.dk-name {
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  max-width: 150rpx;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dock-hint {
  margin-top: 16rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  text-align: center;
}
</style>
