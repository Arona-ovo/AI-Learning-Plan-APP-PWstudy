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

        <!-- 判断"你在用哪个 App"有两条路：开了无障碍就不必再要「使用情况访问」
             （前台包名由系统事件直推，更快更省电），所以这里是"两条都没有"才提示。 -->
        <text v-if="(strictOn || forcedOn) && !usageOk && !a11yOk" class="lock-warn" @tap="openUsage">
          严格 / 强制模式需要「使用情况访问」或「无障碍」才能判断你在用哪个 App，点这里去开启
        </text>
        <text v-else class="lock-foot">{{ lockFoot }}</text>

        <text class="lock-today">今日 {{ todayMin }} 分钟 · {{ todayPomo }} 个番茄</text>
      </view>

      <!-- ===== 空闲态：默认只留三张卡 ===== -->
      <block v-else>
      <!-- 番茄钟状态卡 -->
      <!-- 与其它卡一样按注册表显隐（以前这张是硬写的，收纳 focus 不会生效） -->
      <view class="card focus-card" v-if="show('focus')" @tap="goFocus()">
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

      <!-- 今日紧迫度：整张卡没有文字 ——
           环的填充 = 有多赶，核心呼吸的快慢 = 赶的程度，
           方块 = 还剩几个番茄（实心）与已做几个（空心），
           底下那条 = 今天 24 小时，竖线是"现在"，色块是"还要多久"，
           色块顶到条尾并开始闪 = 今天已经排不下了。
           右上角一个 ? —— 想看人话解释就点它，不点也能看懂个大概。
           今天没排任务（u.empty）就整张不出现：空环没有信息量。 -->
      <view class="card urg-card" v-if="show('urgency') && !u.empty">
        <urgency-meter :u="u" @help="explainUrgency" />
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
                {{ item.goal.title }} · 第 {{ item.task.day }} 天 · {{ item.task.donePomos }}/{{ item.task.pomos }} 番茄 · 剩 ≈ {{ item.estMin }} 分
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
        <coach-box ref="coach" @changed="onCoachChanged" @ask="ask" />
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
            <image v-if="iconMap[a.pkg]" class="dk-icon-img" :src="iconMap[a.pkg]" mode="aspectFit" />
            <view v-else class="dk-icon" :class="{ 'dk-rest': a.purpose === 'rest' }">{{ initialOf(a) }}</view>
            <text class="dk-name">{{ a.name }}</text>
          </view>
        </view>
        <view v-if="dock.length" class="dock-hint">今日 {{ appTodayMin }} 分钟 · 点图标直达</view>
      </view>
      </block>

    </view>

    <!-- 统一弹窗（.pop-mask 是 fixed，必须放在 .page-slide 之外） -->
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
import * as pacing from '../../utils/pacing.js'
import * as coach from '../../utils/coach.js'
import * as urgency from '../../utils/urgency.js'
import * as partner from '../../utils/partner.js'
import * as layout from '../../utils/home-layout.ts'
import { hideNativeTabBar, syncTabbar, safeNav } from '../../utils/nav.js'
import tabSlideMixin from '../../utils/tab-slide-mixin.js'
import FloatTabbar from '../../components/float-tabbar/float-tabbar.vue'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'
import CoachBox from '../../components/coach-box/coach-box.vue'
import UrgencyMeter from '../../components/urgency-meter/urgency-meter.vue'
import AppDialog from '../../components/app-dialog/app-dialog.vue'

export default {
  components: { FloatTabbar, FloatNavbar, CoachBox, UrgencyMeter, AppDialog },
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
      // 今日紧迫度（utils/urgency.js 算好，整张卡靠图形说话，不含文字）
      u: {},
      // 当前首页放了哪些模块（见 utils/home-layout.ts）
      // 这里直接读一次而不是留空：留空会让首帧所有卡都闪一下才出现。
      layoutIds: layout.layout(),
      strictOn: false,    // 严格模式：离开学习 App 就提醒，30 秒不回来作废
      forcedOn: false,    // 强制模式：离开就立刻把 PWstudy 拉回前台
      usageOk: false,     // 「使用情况访问」权限：判断前台是谁的老路子
      a11yOk: false,      // 无障碍护卫：判断前台是谁的新路子（且能拿到后台启动豁免）
      // 统一弹窗（components/app-dialog）：危险确认也走自绘卡片，不用 uni.showModal
      dlg: { show: false, mode: 'confirm', title: '', content: '', confirmText: '确定', danger: false, seq: 0, action: '', items: [], item: null },
      iconMap: {},
      _iconPending: {}
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
    this.maybePartnerAsk()
  },
  onHide() {
    this.stopTick()
  },
  onUnload() {
    this.stopTick()
  },
  /**
   * 硬控期间拦返回键 —— 首页原来没有这一层，于是"回到首页按一下返回"就能退出 App，
   * 强制模式白开了（专注页拦住了，首页没拦）。
   * 只在「正在专注且没暂停」时拦：休息与暂停照常放行 —— 拦人是为了专注，不是把人困死。
   * 判据与专注页 onBackPress 保持同一份（两处不一致就会出现"换个页面就能出去"）。
   */
  onBackPress() {
    if (!this.forcedOn) return false
    if (!this.cur || this.cur.paused || this.cur.phase !== 'focus') return false
    uni.showToast({ title: '先把这个番茄跑完，或到专注页放弃', icon: 'none' })
    return true
  },
  methods: {
    refresh() {
      const ov = pw.overview()
      this.todayMin = ov.todayMin
      this.todayPomo = ov.pomo
      this.queue = pw.todayQueue(6).map(q => {
        // 剩余预计时长 = 还没做的番茄数 × 单番茄时长（跟随设置，别写死 25）
        const left = Math.max(0, (q.task.pomos || 0) - (q.task.donePomos || 0))
        q.estMin = left * pacing.focusLen()
        return q
      })
      this.goals = pw.activeGoals()
      this.dock = pw.dock()
      this.dock.forEach(a => this.ensureIcon(a.pkg))
      this.appTodayMin = this.sumAppMin()
      this.syncResume()
      this.refreshSetup()
      this.refreshCheck()
      this.syncLayout()
      this.refreshUrgency()
      this.strictOn = !!strict.enabled()
      this.forcedOn = !!forced.enabled()
      this.usageOk = apptime.hasUsagePermission()
      this.a11yOk = apptime.hasA11yPermission()
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
    // ---------- 今日紧迫度 ----------
    // 纯本地计算（utils/urgency.js，不调 AI）：首页每次刷新都要重算，
    // 因为"还剩多少时间"是走动的 —— 时间条不跟着走就失真了。
    refreshUrgency() {
      try { this.u = urgency.compute() } catch (e) { this.u = {} }
    },
    // 卡片上唯一的文字入口：一个 ?。点开才把四个图形翻译成人话。
    // 平时不显示，是因为"看一眼就知道今天紧不紧张"这件事，图形比文字快。
    explainUrgency(u) {
      const v = u || this.u || {}
      const lv = urgency.levelName(v.level)
      const left = v.over
        ? this.$t('剩下的活已经排不进今天了（时间条顶到头并在闪）')
        : this.$t('还剩 {n} 分钟可用，够做这些', { n: v.availMin || 0 })
      this.ask({
        title: this.$t('今日紧迫度 · {lv}', { lv: lv }),
        content:
          this.$t('① 圆环填充 = 紧迫度 {n}/100', { n: v.score || 0 }) + '\n' +
          this.$t('② 中心呼吸 = 越急跳得越快') + '\n' +
          this.$t('③ 方块 = 还剩 {a} 个番茄（实心），已做 {b} 个（空心）',
            { a: v.leftPomos || 0, b: v.donePomos || 0 }) + '\n' +
          this.$t('④ 时间条 = 今天 24 小时，竖线是现在，色块是还要多久 —— {s}', { s: left }) +
          (v.overdue ? '\n' + this.$t('另有 {n} 项已超期', { n: v.overdue }) : ''),
        confirmText: this.$t('知道了'),
        action: 'urgency'
      })
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
      // 两个入口都要看：收工表的逐项填报 + 首页对话里 AI 的判定，只认一边会漏
      const t = dailylog.driftText(log)
      this.checkText = coach.driftToday()
        ? ('今天和计划有出入：' + (t || 'AI 从你的描述里听出了不一样') + '，可以让 AI 重排后面')
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
      this.ask({
        title: '先开几个权限',
        content: '通知、使用情况访问（开了无障碍就不必）、电池优化白名单 —— 不开的话番茄锁屏会被系统回收、学习 App 列表读不出来；开了强制模式还多一项无障碍，否则切走拉不回来。现在去设置吗？',
        confirmText: '去设置',
        action: 'setup'
      })
    },
    goSetup() {
      this.__fromSetup = true
      uni.navigateTo({ url: '/pkgManage/pages/setup/setup' })
    },
    /**
     * 伙伴 App（背单词）的首次询问。
     *
     * 五个条件缺一不可（都在 utils/partner.js 里判）：装了 + 还没决定 +
     * 没问够 3 次 + 距上次 ≥ 2 天 + 当前不在专注中。
     * 最后那条是硬规矩：一个"可选的关联"，不配打断一次番茄。
     *
     * 延迟 1.2s 再弹：首页刚渲染完就糊一张卡片上来，用户还没看清自己在哪。
     * 已经有别的弹窗在（比如权限引导）就让路 —— 权限比这个重要。
     */
    maybePartnerAsk() {
      setTimeout(() => {
        if (this.dlg.show) return
        let go = false
        try {
          go = partner.shouldAsk({
            installed: partner.installed(),
            focusing: !!(focus.current() && focus.current().phase)
          })
        } catch (e) { go = false }
        if (!go) return
        // 先记账再弹：不管最后选哪个，这一轮"问过了"都成立，
        // 否则关掉弹窗立刻回前台会再弹一次。
        partner.markAsked()
        this.ask({
          mode: 'sheet',
          title: this.$t('要和背单词 App 打通吗？'),
          content: this.$t('检测到这台设备上装了背单词 App。打通之后：从 PWstudy 一键跳过去背，学完自动回来，时长和词数自动记进今天。\n\n不打通也不影响任何功能 —— 你用别的方式背，花的时间 PWstudy 照样统计得到。'),
          items: [
            { label: this.$t('打通（推荐）') },
            { label: this.$t('以后再说') },
            { label: this.$t('不用了，我按自己的方式背') }
          ],
          action: 'partner-ask'
        })
      }, 1200)
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
    // ---------- 统一弹窗 ----------
    // 全 App 只有一套弹窗（components/app-dialog）：系统弹窗在 App 端样式管不到，
    // 跟这套毛玻璃卡片不是一个画风。ask() 只负责描述，动作在 onDlgYes 里按 action 分派。
    ask(cfg) {
      this.dlg = Object.assign(
        { show: true, mode: 'confirm', title: '', content: '', confirmText: '确定',
          danger: false, action: '', items: [], item: null },
        cfg || {},
        { seq: (this.dlg && this.dlg.seq || 0) + 1 }
      )
    },
    onDlgYes(payload) {
      const act = this.dlg.action
      const item = this.dlg.item
      this.dlg.show = false
      if (act === 'task') {
        if (payload === 0) this.startFor(item)
        else if (payload === 1) this.markDone(item)
        else if (payload === 2) this.pushTomorrow(item)
        else if (payload === 3) this.goDetail(item.goal.id)
        return
      }
      if (act === 'coach-clear') {
        try { coach.clear(pw.today()) } catch (e) {}
        if (this.$refs.coach && this.$refs.coach.refresh) this.$refs.coach.refresh()
        this.refresh()
        return
      }
      if (act === 'setup') {
        this.__fromSetup = true
        uni.navigateTo({ url: '/pkgManage/pages/setup/setup' })
        return
      }
      // 伙伴 App 首次询问的三个选项（顺序 = items 下标）
      if (act === 'partner-ask') {
        if (payload === 0) {
          partner.link()
          uni.showToast({ title: this.$t('已打通 · 过去背完会自动记回今天'), icon: 'none', duration: 2200 })
        } else if (payload === 2) {
          // 落到 declined：明确拒绝之后不再自动问，但设置里随时能改回来
          partner.unlink()
          uni.showToast({ title: this.$t('好 · 之后不再提示，设置里可以随时打开'), icon: 'none', duration: 2200 })
        } else {
          uni.showToast({ title: this.$t('好 · 需要时到设置里打开'), icon: 'none' })
        }
        return
      }
      if (act === 'giveup') {
        focus.giveUp()
        this.cur = null
        this.refresh()
        strict.sync()
        forced.sync()
      }
    },
    confirmGiveUp() {
      this.ask({
        title: '结束这一轮？',
        content: '满 1 分钟会按实际时长记录，但不算完成任务量。',
        confirmText: '结束',
        danger: true,
        action: 'giveup'
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
      // 默认绑当天第一个没做完的任务：首页的"开始"应该接着计划走，
      // 而不是每次都是游离于计划之外的自由专注（想自由去专注页自己选）。
      // 推荐时长由专注页按任务剩余量算（见 focus.applySuggest）。
      let q = ''
      try {
        const first = pw.todayQueue(1)[0]
        if (first) {
          q = '&taskId=' + first.task.id + '&goalId=' + first.goal.id +
            '&title=' + encodeURIComponent(first.task.title || '任务')
        }
      } catch (e) {}
      // auto=1：进页面直接起表（否则还得在专注页再点一次"开始"）
      uni.navigateTo({ url: '/pkgPlan/pages/focus/focus?auto=1' + q })
    },
    // 每日任务的操作对话框：开始 / 完成 / 改期 / 详情
    taskMenu(item) {
      this.ask({
        title: item.task.title,
        mode: 'sheet',
        items: ['开始专注', '标记完成', '改到明天', '看目标详情'],
        action: 'task',
        item: item
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
    goApps() { safeNav('/pkgPlan/pages/apps/apps') },
    goReplan(id) { uni.navigateTo({ url: '/pkgPlan/pages/replan/replan?id=' + id }) },
    switchGoals() { uni.switchTab({ url: '/pages/goals/goals' }) },
    openApp(a) {
      apptime.launchApp(a.pkg)
    },
    ensureIcon(pkg) {
      if (!pkg || this.iconMap[pkg] || this._iconPending[pkg]) return
      this._iconPending[pkg] = true
      setTimeout(() => {
        try {
          const url = apptime.appIconDataUrl(pkg)
          if (url) this.iconMap[pkg] = url
        } catch (e) {
          console.warn('[home] 加载图标失败', pkg, e)
        }
        delete this._iconPending[pkg]
      }, 0)
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

/* 紧迫度卡：整张卡就是一个图形，不需要 card-head 那种标题行，
   所以上下留白比通用卡紧一点，让四个图形自己撑住这张卡。 */
.urg-card { padding: 32rpx 36rpx; }

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
  border: 6rpx solid rgba(228, 23, 61, 0.22);
  border: 6rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.22);
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
.lock-btn-main {
  width: 280rpx;
  color: #bb1332; color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1); background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  border: 2rpx solid rgba(228, 23, 61, 0.4); border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.4);
}
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
.rc-go { font-size: 25rpx; color: #bb1332; color: var(--brand-strong, #bb1332); flex-shrink: 0; }

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
.sc-go { font-size: 25rpx; color: #bb1332; color: var(--brand-strong, #bb1332); flex-shrink: 0; }

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
  border: 6rpx solid rgba(228, 23, 61, 0.25);
  border: 6rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.25);
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
  color: #bb1332; color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1); background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  border: 2rpx solid rgba(228, 23, 61, 0.4); border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.4);
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
.card-more { font-size: 24rpx; color: #bb1332; color: var(--brand-strong, #bb1332); }

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
  background: #e4173d;
  background: var(--brand, #e4173d);
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
.tk-play { font-size: 26rpx; color: #bb1332; color: var(--brand-strong, #bb1332); flex-shrink: 0; }

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
  background: rgba(228, 23, 61, 0.12);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.12);
  display: flex; align-items: center; justify-content: center;
  font-size: 36rpx; font-weight: 600;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
}
.dk-rest {
  background: rgba(122, 124, 122, 0.14);
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
.dk-icon-img {
  width: 92rpx; height: 92rpx;
  border-radius: 24rpx;
  flex-shrink: 0;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.5);
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
