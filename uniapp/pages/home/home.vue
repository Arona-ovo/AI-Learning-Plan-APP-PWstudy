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

      <!-- ===== 空闲态：卡片按用户保存的顺序渲染（可在「编辑首页」里排 / 收纳） =====
           顺序与显隐由 utils/home-layout.ts 管，这里只负责渲染与编辑交互。 -->
      <block v-else>
      <!-- 临时卡：权限提醒 / 未完成的 AI 规划。
           它们不是"组件"，不参与排序与收纳，也永远排在最前面 ——
           权限没开是真的会让计时断掉的，不该被用户收起来。 -->
      <view v-if="setupPending.length" class="card setup-card" @tap="goSetup()">
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
      <view v-if="resumePlan" class="card resume-card" @tap="goWizard()">
        <view class="rc-main">
          <view class="rc-dot" :class="{ 'rc-dot-run': resumePlan.running }"></view>
          <view class="rc-info">
            <view class="rc-title">AI 规划进行中</view>
            <view class="rc-sub">{{ resumeText }}</view>
          </view>
          <text class="rc-go">继续 ›</text>
        </view>
      </view>

      <!-- 注册表卡片：顺序 = 用户排的。编辑态可拖动排序、可收纳。 -->
      <view class="mod-list" @touchmove="dragMove" @touchend="dragEnd" @touchcancel="dragEnd">
        <view
          v-for="(id, i) in cardOrder"
          :key="id"
          class="mod-wrap"
          :class="{ 'is-drag': dragIndex === i, 'is-editing': editing }"
          :style="wrapStyle(i)"
        >
          <!-- 编辑态遮罩：盖住卡片本体、屏蔽卡内点击 ——
               否则拖动时会误触「开始专注 / 管理 / 直达 App」 -->
          <view v-if="editing" class="mod-shield"></view>

          <!-- 编辑态把手：整行都能拖（触摸 + H5 鼠标两条路），「收纳」除外 -->
          <view
            v-if="editing"
            class="mod-bar"
            @touchstart="dragStart(i, $event)"
            @mousedown="dragStartMouse(i, $event)"
          >
            <view class="mod-grip">
              <view class="grip-lines">
                <view class="grip-line"></view>
                <view class="grip-line"></view>
                <view class="grip-line"></view>
              </view>
            </view>
            <text class="mod-name">{{ $t(moduleName(id)) }}</text>
            <text class="mod-hide" @touchstart.stop="noop" @mousedown.stop="noop" @tap="stashModule(id)">{{ $t('收纳') }}</text>
          </view>

          <!-- 番茄钟状态卡：和其它卡一样按注册表显隐（以前这张是硬写的，收纳不生效） -->
          <!-- 点卡片 = 进专注页（**不**自动开始，先看看 / 调设置 / 改时长）；
               要马上开始就点右边的「开始」—— 只有那一个入口会直接起表。 -->
          <view v-if="id === 'focus'" class="card focus-card" @tap="goFocus()">
            <view class="fc-main">
              <view class="fc-ring" :class="{ 'fc-ring-run': running }">
                <text class="fc-time">{{ running ? fmtMMSS(cur.remainSec) : fmtHM(todayMin) }}</text>
              </view>
              <view class="fc-info">
                <view class="fc-title">{{ running ? (cur.phase === 'rest' ? '休息中' : '专注中') : '今日专注' }}</view>
                <view class="fc-sub">{{ running ? cur.taskTitle : (todayPomo + ' 个番茄 · 点「开始」直接专注') }}</view>
              </view>
              <view class="fc-go" @tap.stop="quickStart()">{{ running ? '继续' : '开始' }}</view>
            </view>
          </view>

          <!-- 今日紧迫度：整张卡没有文字 ——
               环的填充 = 有多赶，核心呼吸的快慢 = 赶的程度，
               方块 = 还剩几个番茄（实心）与已做几个（空心），
               底下那条 = 今天 24 小时，竖线是"现在"，色块是"还要多久"。
               右上角一个 ? —— 想看人话解释就点它。 -->
          <view v-else-if="id === 'urgency'" class="card urg-card">
            <urgency-meter :u="u" @help="explainUrgency" />
          </view>

          <!-- 今日任务 -->
          <view v-else-if="id === 'task'" class="card">
            <view class="card-head">
              <text class="card-title">今日任务</text>
              <view class="head-acts">
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
            <!-- 「＋ AI 规划目标」入口已移除：目标规划完就不需要它了，
                 建目标的入口统一放在「目标」tab。空态只留一句说明，不再塞按钮。 -->
            <view v-if="!queue.length" class="empty">
              <text class="empty-txt">没有待办任务。到「目标」里定一个远期目标，AI 会帮你拆成每天的日程。</text>
            </view>
            <view v-else class="task-list">
              <view
                v-for="item in queue"
                :key="item.task.id"
                class="task"
                hover-class="task-press"
                @tap="startFor(item)"
              >
                <!-- 勾选圈：做完就地勾掉，不用非得进 ⋯ 菜单找「标记完成」。
                     点行仍然是"开始专注"（快路径），两者互不干扰 -->
                <view
                  class="tk-check"
                  :class="{ 'tk-check-on': item.task.status === 'done' }"
                  @tap.stop="toggleTaskDone(item)"
                >
                  <text v-if="item.task.status === 'done'" class="tk-tick">✓</text>
                </view>
                <view class="tk-dot" :class="{ 'tk-dot-late': item.overdue }"></view>
                <view class="tk-main">
                  <view class="tk-title" :class="{ 'tk-title-done': item.task.status === 'done' }">{{ item.task.title }}</view>
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
          <view v-else-if="id === 'coach'" class="card coach-card">
            <coach-box ref="coach" @changed="onCoachChanged" @ask="ask" />
          </view>

          <!-- 目标进度 -->
          <view v-else-if="id === 'goal'" class="card">
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
            <!-- 编辑态会强制显形（否则收纳区里找不到它），没数据时给一句说明 -->
            <view v-if="!goals.length" class="empty">
              <text class="empty-txt">{{ $t('暂时没有进行中的目标') }}</text>
            </view>
          </view>

          <!-- 日程表：与日历页共用 components/schedule-list（同一套字段与样式）。
               首页默认看今天，可左右翻天、就地前移/后移；要看整月就进完整日历。 -->
          <view v-else-if="id === 'schedule'" class="card">
            <view class="card-head">
              <view class="sc-nav">
                <text class="sc-arrow" @tap="shiftSched(-1)">‹</text>
                <text class="card-title">{{ schedLabel }}</text>
                <text class="sc-arrow" @tap="shiftSched(1)">›</text>
                <text v-if="schedDate !== schedToday" class="sc-today" @tap="goTodaySched">今天</text>
              </view>
              <text class="card-more" @tap="goCalendar()">完整日历 ›</text>
            </view>
            <schedule-list
              :rows="schedRows"
              :limit="4"
              :ops="true"
              more-text="查看全部"
              @changed="refreshSchedule"
              @more="goCalendar"
            />
          </view>

          <!-- AppDock -->
          <view v-else-if="id === 'dock'" class="card">
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
        </view>
      </view>

      <!-- 首页的核心操作：收工。
           原来它缩在「今日任务」卡右上角当一个小链接，而"今天做了什么"其实是
           整个"动态安排"的输入口 —— 现在按主按钮的尺寸放在首页底部，
           填过就变成「改一下」，不重复催促。编辑首页时让位给编辑按钮。 -->
      <view v-if="!editing" class="home-cta">
        <button class="btn-primary cta-btn" @tap="goDaily()">{{ checked ? '改一下今天的收工' : '今日收工' }}</button>
        <text class="cta-tip">{{ checked ? '今天已经记过了，想改随时点开' : '花十几秒说说今天，明天的安排才排得准' }}</text>
      </view>

      <!-- 底部操作行：非编辑态只留一个入口，保持简洁 -->
      <view class="home-foot">
        <block v-if="editing">
          <view class="foot-btn ghost" @tap="openSheet">{{ $t('＋ 添加组件') }}</view>
          <view class="foot-btn primary" @tap="finishEdit">{{ $t('完成') }}</view>
        </block>
        <view v-else class="foot-link" @tap="toggleEdit">{{ $t('编辑首页') }}</view>
      </view>
      </block>

    </view>

    <!-- 「添加组件」抽屉：收纳区里的模块，点一下加回首页。
         必须放在 .page-slide 之外 —— fixed 参照不能受切 tab 的滑动动画影响，
         否则抽屉会跟着页面一起滑走（记忆约束 3）。 -->
    <view v-if="sheetShow" class="sheet-mask" @tap="closeSheet">
      <view class="sheet" @tap.stop="noop">
        <view class="sheet-head">
          <text class="sheet-title">{{ $t('添加组件') }}</text>
          <text class="sheet-close" @tap="closeSheet">{{ $t('关闭') }}</text>
        </view>
        <scroll-view class="sheet-body" scroll-y>
          <view
            v-for="m in sheetList"
            :key="m.id"
            class="sheet-item"
            @tap="restoreModule(m.id)"
          >
            <view class="sheet-info">
              <text class="sheet-name">{{ $t(m.name) }}</text>
              <text class="sheet-desc">{{ $t(m.desc) }}</text>
            </view>
            <text class="sheet-add">{{ $t('添加') }}</text>
          </view>
          <view v-if="!sheetList.length" class="sheet-empty">
            <text class="sheet-empty-text">{{ $t('所有组件都已在首页上') }}</text>
          </view>
        </scroll-view>
      </view>
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
import * as schedule from '../../utils/schedule.js'
import { hideNativeTabBar, syncTabbar, safeNav } from '../../utils/nav.js'
import tabSlideMixin from '../../utils/tab-slide-mixin.js'
import FloatTabbar from '../../components/float-tabbar/float-tabbar.vue'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'
import CoachBox from '../../components/coach-box/coach-box.vue'
import UrgencyMeter from '../../components/urgency-meter/urgency-meter.vue'
import ScheduleList from '../../components/schedule-list/schedule-list.vue'
import AppDialog from '../../components/app-dialog/app-dialog.vue'

export default {
  components: { FloatTabbar, FloatNavbar, CoachBox, UrgencyMeter, ScheduleList, AppDialog },
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
      // ---------- 日程表卡 ----------
      // 数据构造与"哪天"的判断都在 utils/schedule.js，跟日历页同一份口径
      schedDate: pw.today(),
      schedRows: [],
      // 当前首页放了哪些模块（见 utils/home-layout.ts）
      // 这里直接读一次而不是留空：留空会让首帧所有卡都闪一下才出现。
      layoutIds: layout.layout(),
      strictOn: false,    // 严格模式：离开学习 App 就提醒，30 秒不回来作废
      forcedOn: false,    // 强制模式：离开就立刻把 PWstudy 拉回前台
      usageOk: false,     // 「使用情况访问」权限：判断前台是谁的老路子
      a11yOk: false,      // 无障碍护卫：判断前台是谁的新路子（且能拿到后台启动豁免）
      // 统一弹窗（components/app-dialog）：危险确认也走自绘卡片，不用 uni.showModal
      dlg: { show: false, mode: 'confirm', title: '', content: '', confirmText: '确定', danger: false, seq: 0, action: '', items: [], item: null },
      // ---------- 首页编辑（顺序 / 收纳 / 拖拽）----------
      // editing 是唯一开关：进编辑态才显示把手、遮罩、底部两个按钮
      editing: false,
      dragIndex: -1,      // 正在拖第几张（-1 = 没在拖）
      dragDy: 0,          // 手指位移 px，正 = 往下
      dragStartY: 0,
      dragHeights: [],    // 各卡片实际高度，喂给 homeLayout.dropIndex
      sheetShow: false,   // 「添加组件」抽屉
      sheetList: [],      // 收纳区里的模块
      iconMap: {},
      _iconPending: {}
    }
  },
  computed: {
    /**
     * 渲染用的卡片顺序。
     *
     * ⚠️ 编辑态返回**全部**注册表卡片（连平时不显形的那些也一起）——
     *    否则用户收纳了「今日紧迫度」之后，它平时又不显示（今天没排任务 = 空），
     *    就永远从收纳区里捞不回来了。拖拽下标也必须以"全部"为口径，
     *    否则收纳过卡片之后下标会错位。
     */
    cardOrder() {
      const ids = this.layoutIds || []
      if (this.editing) return ids
      return ids.filter(id => this.cardVisible(id))
    },
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
    },
    schedToday() {
      return pw.today()
    },
    /** 日程卡头部那句"这是哪天"（含节假日 / 周末，与日历页同一口径） */
    schedLabel() {
      return schedule.dateLabel(this.schedDate)
    }
  },
  watch: {
    // 番茄一跑起来首页就被倒计时"硬控"，整个卡片区都不显示了 ——
    // 编辑态必须跟着收掉，否则会留下一个点不动的把手浮在倒计时上面。
    locked(v) {
      if (v) this.finishEdit()
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
    // 离开首页一律退出编辑态，保证回来时界面是简洁的
    this.finishEdit()
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
    // 抽屉 / 编辑态都是"页面里的临时状态"，按返回应该先收起它们，
    // 顺序按覆盖层级从内到外。硬控的返回拦截排在后面（那才是真的不让走）。
    if (this.sheetShow) { this.sheetShow = false; return true }
    if (this.editing) { this.finishEdit(); return true }
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
      this.refreshSchedule()
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
    /** 这张卡平时该不该显示（浏览态口径；编辑态一律显形，理由见 cardOrder） */
    cardVisible(id) {
      // 今天没排任务时紧迫度卡是个空环，没有信息量 → 平时不出现
      if (id === 'urgency') return !!(this.u && !this.u.empty)
      // 没有进行中的目标 → 整张卡是空的
      if (id === 'goal') return !!(this.goals && this.goals.length)
      // 日程表由目标派生：没有目标就没有日程可言
      if (id === 'schedule') return !!(this.goals && this.goals.length)
      return true
    },
    // ---------- 日程表卡 ----------
    refreshSchedule() {
      try {
        this.schedRows = schedule.rowsOf(this.schedDate)
      } catch (e) {
        this.schedRows = []
      }
    },
    shiftSched(n) {
      this.schedDate = pw.addDays(this.schedDate || pw.today(), n)
      this.refreshSchedule()
    },
    goTodaySched() {
      this.schedDate = pw.today()
      this.refreshSchedule()
    },
    /** 编辑态把手上显示的模块名（来自 home-layout 的注册表） */
    moduleName(id) {
      const m = layout.moduleOf(id)
      return m ? m.name : id
    },
    // ---------- 首页编辑 ----------
    toggleEdit() {
      this.editing = !this.editing
      if (!this.editing) this.sheetShow = false
      this.dragIndex = -1
      this.dragDy = 0
    },
    finishEdit() {
      this.editing = false
      this.sheetShow = false
      this.dragIndex = -1
      this.dragDy = 0
    },
    /** 「添加组件」抽屉：列出收纳区里所有能加回来的模块 */
    openSheet() {
      try { this.sheetList = layout.stashed() } catch (e) { this.sheetList = [] }
      this.sheetShow = true
    },
    closeSheet() {
      this.sheetShow = false
    },
    stashModule(id) {
      // 全收干净了首页就是一张白板，用户会以为 App 坏了 —— 至少留一张
      if (this.cardOrder.length <= 1) {
        uni.showToast({ title: this.$t('至少保留一个组件'), icon: 'none' })
        return
      }
      try { layout.stash(id) } catch (e) {}
      this.syncLayout()
      uni.showToast({ title: this.$t('已收纳「{name}」', { name: this.$t(this.moduleName(id)) }), icon: 'none' })
    },
    restoreModule(id) {
      try { layout.restore(id) } catch (e) {}
      this.syncLayout()
      uni.showToast({ title: this.$t('已添加「{name}」', { name: this.$t(this.moduleName(id)) }), icon: 'none' })
    },
    // ---------- 拖拽 ----------
    // "记起点 + 量各卡真实高度"抽成公共入口，触摸与鼠标两条路共用
    beginDrag(i, clientY) {
      this.dragIndex = i
      this.dragStartY = typeof clientY === 'number' ? clientY : 0
      this.dragDy = 0
      this.dragHeights = []
      try {
        const q = uni.createSelectorQuery().in(this)
        q.selectAll('.mod-wrap').boundingClientRect()
        q.exec(res => {
          const arr = (res && res[0]) || []
          this.dragHeights = arr.map(r => (r && r.height) || 0)
        })
      } catch (err) {
        this.dragHeights = []
      }
    },
    dragStart(i, e) {
      if (!this.editing) return
      const t = (e && e.touches && e.touches[0]) || {}
      this.beginDrag(i, t.clientY)
    },
    // H5 桌面没有 touch 事件，补一条鼠标路径；App 端逻辑层没有 document，自动跳过
    dragStartMouse(i, e) {
      if (!this.editing) return
      if (typeof document === 'undefined') return
      if (e && e.preventDefault) e.preventDefault()
      this.beginDrag(i, e ? e.clientY : 0)
      const mm = (ev) => {
        this.dragDy = (ev && typeof ev.clientY === 'number' ? ev.clientY : 0) - this.dragStartY
      }
      const mu = () => {
        document.removeEventListener('mousemove', mm)
        document.removeEventListener('mouseup', mu)
        this.dragEnd()
      }
      document.addEventListener('mousemove', mm)
      document.addEventListener('mouseup', mu)
    },
    dragMove(e) {
      if (this.dragIndex < 0) return
      const t = (e && e.touches && e.touches[0]) || {}
      this.dragDy = (typeof t.clientY === 'number' ? t.clientY : 0) - this.dragStartY
    },
    dragEnd() {
      if (this.dragIndex < 0) return
      const from = this.dragIndex
      // 落点算法是纯函数（不碰 DOM、可单测），页面只把位移喂进去
      const to = layout.dropIndex(from, this.dragDy, this.dragHeights)
      this.dragIndex = -1
      this.dragDy = 0
      this.dragStartY = 0
      if (to !== from) {
        try { layout.move(from, to) } catch (e) {}
        this.syncLayout()
      }
    },
    wrapStyle(i) {
      if (this.dragIndex !== i) return ''
      return 'transform: translateY(' + this.dragDy + 'px); z-index: 30;'
    },
    noop() {},
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
    goCalendar() { safeNav('/pkgPlan/pages/calendar/calendar') },
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
    /**
     * 拼专注页链接。
     * 默认绑当天第一个没做完的任务：首页的"开始"应该接着计划走，
     * 而不是每次都是游离于计划之外的自由专注（想自由去专注页自己选）。
     * 推荐时长由专注页按任务剩余量算（见 focus.applySuggest）。
     * @param {boolean} auto true = 进页面就直接起表（否则只打开页面，不动）
     */
    focusUrl(auto) {
      const q = []
      if (auto) q.push('auto=1')
      try {
        const first = pw.todayQueue(1)[0]
        if (first) {
          q.push('taskId=' + first.task.id)
          q.push('goalId=' + first.goal.id)
          q.push('title=' + encodeURIComponent(first.task.title || '任务'))
        }
      } catch (e) {}
      return '/pkgPlan/pages/focus/focus' + (q.length ? '?' + q.join('&') : '')
    },
    /**
     * 点番茄卡 / 计时环 = 进专注页，**不自动开始**。
     * 计时是件有成本的事（起表后首页被硬控、严格模式开始记账），
     * 不能因为手指落在卡片空白处就莫名其妙开始一轮。
     */
    goFocus() {
      uni.navigateTo({ url: this.focusUrl(false) })
    },
    /** 卡片上的「开始」按钮：唯一一个直接起表的入口 */
    quickStart() {
      // 已经有番茄在跑：进页面接着看，不能又起一个
      if (this.cur) { this.goFocus(); return }
      uni.navigateTo({ url: this.focusUrl(true) })
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
    /** 就地勾选 / 取消完成：与日程表卡、日历页同一个 schedule.toggleDone 口径 */
    toggleTaskDone(item) {
      const r = schedule.toggleDone({
        goalId: item.goal.id,
        id: item.task.id,
        status: item.task.status || 'todo'
      })
      if (!r.ok) {
        try { uni.showToast({ title: r.msg, icon: 'none' }) } catch (e) {}
        return
      }
      try { uni.showToast({ title: r.msg, icon: 'none' }) } catch (e) {}
      // 勾完就不在"今日待办"里了 → 队列、紧迫度、目标进度都要重算
      this.refresh()
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

/* ===== 首页模块编辑（拖拽排序 / 收纳 / 加回） =====
   交互从 AWword 移植：落点算法是纯函数 utils/home-layout.ts 的 dropIndex()，
   页面只负责把手指位移喂进去，不自己算下标 —— 这样算法能单测。 */
.mod-list { position: relative; }

/* 每张卡外面套一层 .mod-wrap：拖动时只位移这一层，不动卡片内部布局。
   间距也必须搬到这一层 —— 卡片现在是 .mod-wrap 的子节点，
   继续写 .home-slide > .card 会命中不到，整页间距全丢。 */
.mod-wrap { position: relative; margin-bottom: 20rpx; }
.mod-wrap:last-child { margin-bottom: 0; }

/* 编辑态：给每张卡套一个淡色底 + 内缩，让"这是可排的块"看得出来 */
.mod-wrap.is-editing {
  border-radius: 20rpx;
  background: rgba(228, 23, 61, 0.05);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.05);
  padding: 0 12rpx 12rpx;
}

/* 正在拖的那张：抬起来一点 + 加投影，跟底下静止的卡分开 */
.mod-wrap.is-drag {
  opacity: 0.94;
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.86);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.86);
  box-shadow: 0 12rpx 32rpx rgba(23, 32, 26, 0.16);
  box-shadow: 0 12rpx 32rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.16);
}

/* 透明遮罩盖住卡片本体：拖的时候手指是划过整张卡的，
   不挡掉卡内点击就会误触「开始专注 / 管理 / 直达 App」直接跳页。
   把手行靠更高的 z-index 浮在它上面，所以把手自己照样能拖。 */
.mod-shield {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 10;
}

.mod-bar {
  position: relative;
  z-index: 11;
  display: flex;
  align-items: center;
  padding: 14rpx 8rpx 12rpx;
  /* 把手区域内禁掉滚动手势，拖动时页面不会跟着滚；页面其他区域照常可滚 */
  touch-action: none;
  /* H5 桌面：鼠标提示可拖 */
  cursor: grab;
}
.mod-bar:active { cursor: grabbing; }

.mod-grip { display: flex; align-items: center; margin-right: 14rpx; flex-shrink: 0; }
.grip-lines { display: flex; flex-direction: column; margin-right: 10rpx; }
.grip-line {
  width: 30rpx;
  height: 4rpx;
  border-radius: 4rpx;
  margin: 4rpx 0;
  background: #98a19b;
  background: var(--ink-3, #98a19b);
}

.mod-name {
  flex: 1;
  font-size: 24rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

/* 「收纳」= 从首页移除，不是删数据。危险色只上文字和描边，不做实心块 */
.mod-hide {
  flex-shrink: 0;
  font-size: 24rpx;
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  color: #e5484d;
  color: var(--danger, #e5484d);
  border: 2rpx solid rgba(229, 72, 77, 0.3);
}
.mod-hide:active { background: rgba(229, 72, 77, 0.1); }

/* ===== 底部操作行：非编辑态只留一个文字入口，不抢卡片的风头 ===== */
.home-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 28rpx;
  margin-bottom: 40rpx;
}
.foot-btn {
  height: 76rpx;
  min-width: 220rpx;
  padding: 0 40rpx;
  margin: 0 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 27rpx;
  font-weight: 500;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  border-radius: 999rpx;
  border: 2rpx solid transparent;
}
/* 主按钮走 tint 模式（项目设计令牌）：淡底 + 深字 + 发丝描边，不做大块实心红 */
.foot-btn.primary {
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  border-color: rgba(228, 23, 61, 0.4);
  border-color: rgba(var(--brand-rgb, 228, 23, 61), 0.4);
}
.foot-btn.primary:active { opacity: 0.86; }
.foot-btn.ghost {
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border-color: rgba(23, 32, 26, 0.12);
  border-color: var(--hairline, rgba(23, 32, 26, 0.12));
}
.foot-btn.ghost:active { opacity: 0.86; }

.foot-link {
  font-size: 24rpx;
  padding: 12rpx 32rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
.foot-link:active { opacity: 0.6; }

/* ===== 「添加组件」抽屉 =====
   .sheet-mask 是 fixed，模板里必须放在 .page-slide 之外，
   否则切 tab 的滑动 transform 会把抽屉一起带走（记忆约束 3）。 */
.sheet-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 900;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: rgba(23, 32, 26, 0.35);
  background: rgba(var(--shadow-rgb, 23, 32, 26), 0.35);
}
/* 抽屉底用 --surface-rgb 而不是 --surface：本项目没定义 --surface，
   写 var(--surface, #fff) 在深色模式下会一直是白底 */
.sheet {
  background: rgba(255, 255, 255, 0.97);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.97);
  border-radius: 28rpx 28rpx 0 0;
  padding: 28rpx 32rpx 40rpx;
  max-height: 70vh;
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}
.sheet-title {
  font-size: 30rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.sheet-close {
  font-size: 25rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
.sheet-body { max-height: 54vh; }
.sheet-item {
  display: flex;
  align-items: center;
  padding: 24rpx 0;
  border-top: 2rpx solid rgba(23, 32, 26, 0.07);
  border-top: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.07));
}
.sheet-info { flex: 1; min-width: 0; }
.sheet-name {
  display: block;
  font-size: 28rpx;
  font-weight: 500;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.sheet-desc {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  line-height: 1.5;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
/* 行尾这个小「添加」也走 tint 模式，跟全项目主按钮同语言 */
.sheet-add {
  flex-shrink: 0;
  margin-left: 20rpx;
  font-size: 24rpx;
  padding: 10rpx 28rpx;
  border-radius: 999rpx;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  border: 2rpx solid rgba(228, 23, 61, 0.4);
  border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.4);
}
.sheet-add:active { opacity: 0.86; }
.sheet-empty { padding: 48rpx 0; text-align: center; }
.sheet-empty-text {
  font-size: 25rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

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

/* ===== 首页核心操作：今日收工 ===== */
.home-cta { margin: 8rpx 0 4rpx; }
.cta-btn { width: 100%; }
.cta-tip {
  display: block; margin-top: 16rpx; text-align: center;
  font-size: 22rpx; line-height: 1.6;
  color: #98a19b; color: var(--ink-3, #98a19b);
}

/* ===== 日程表卡（与日历页共用 components/schedule-list） ===== */
.sc-nav { display: flex; align-items: center; flex: 1; min-width: 0; }
.sc-arrow { font-size: 34rpx; color: #5a6560; color: var(--ink-2, #5a6560); padding: 0 14rpx; }
.sc-arrow:active { opacity: 0.6; }
.sc-nav .card-title { margin-right: 4rpx; }
.sc-today {
  margin-left: 14rpx; padding: 4rpx 16rpx; border-radius: 999rpx;
  font-size: 21rpx; color: #bb1332; color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1); background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
}

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
/* 勾选圈（与日程表卡同一套语义：空心=待办，实心=已完成） */
.tk-check {
  width: 40rpx; height: 40rpx; border-radius: 50%;
  margin-right: 16rpx; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: 2rpx solid rgba(23, 32, 26, 0.22);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.22));
}
.tk-check-on {
  background: #e4173d; background: var(--brand, #e4173d);
  border-color: transparent;
}
.tk-check:active { opacity: 0.6; }
.tk-tick { font-size: 24rpx; line-height: 1; color: #ffffff; font-weight: 600; }

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
.tk-title-done { color: #98a19b; color: var(--ink-3, #98a19b); text-decoration: line-through; }
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
