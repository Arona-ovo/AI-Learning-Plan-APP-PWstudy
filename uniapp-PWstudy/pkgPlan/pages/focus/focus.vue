<template>
  <view class="container page-nav focus-page" :class="appTheme" :style="appBgStyle">
    <float-navbar title="番茄专注" />

    <view class="focus-body">

      <!-- 阶段标签 -->
      <text class="phase" :class="{ 'phase-rest': isRest }">{{ phaseText }}</text>

      <!-- 计时环：conic-gradient 纯 CSS 实现（不用 Canvas，理由同打卡走势） -->
      <view class="ring-wrap">
        <view class="ring" :style="ringStyle">
          <view class="ring-inner">
            <!-- 正计时段：数字前面加个「+」，一眼看出这是"多坐了多久"而不是"还剩多久" -->
            <text class="time">{{ timeText }}</text>
            <!-- 任务名：单行截断，点一下展开（最多 3 行）。
                 圆盘里能放字的宽度只有 320rpx，长任务名一直被吃掉一半，
                 而它恰恰是"这一轮在为什么事计时"的唯一线索 —— 不可点等于没救。 -->
            <text
              class="task-title"
              :class="{ 'task-title-open': titleOpen }"
              @tap="toggleTitle"
            >{{ taskTitle }}</text>
          </view>
        </view>
      </view>

      <!-- 开始按钮：空闲态的唯一入口（以前只有"暂停/放弃"那排按钮，
           而它只在计时开始后才出现 —— 从首页点"开始"进来压根没有能按的键，
           看起来就是"点了开始没有倒计时"） -->
      <view v-if="!active" class="start-wrap">
        <button class="btn-primary start-btn" @tap="beginFocus">开始专注 {{ minutes }} 分钟</button>
        <text class="start-sub">按下去才开始计时</text>
      </view>

      <!-- 空闲态：时长选择 + 任务提示 -->
      <view v-if="!active" class="config">
        <text class="cfg-label">专注时长</text>
        <view class="cfg-row">
          <text
            v-for="m in minutesOptions"
            :key="m"
            class="cfg-opt"
            :class="{ 'cfg-opt-on': m === minutes }"
            @tap="minutes = m"
          >{{ m }} 分</text>
          <text class="cfg-opt cfg-custom" @tap="customMinutes">自定义</text>
        </view>
        <view v-if="presetTask" class="bind-card">
          <text class="bind-txt">本次专注将计入：{{ presetTask.title }}</text>
          <text v-if="taskProg" class="bind-prog">{{ taskProg }}</text>
          <text class="bind-clear" @tap="clearPreset">×</text>
        </view>
        <view class="tip">从首页点任务进来会自动绑定目标；直接开始则记为自由专注。</view>

        <!-- 结束提醒方式 -->
        <view class="strict-card">
          <view class="sr-row" v-for="o in optRows" :key="o.key">
            <view class="sr-info">
              <text class="sr-title">{{ o.title }}</text>
              <!-- 「响铃 / 震动」各给一个试一下的入口：真机上"开了没反应"时，
                   点一下就能分辨是系统媒体音量为 0、素材播不出来，还是压根没触发 -->
              <text v-if="o.key === 'sound'" class="sr-try" @tap.stop="testSound">试听 ›</text>
              <text v-else-if="o.key === 'vibe'" class="sr-try" @tap.stop="testVibe">试一下 ›</text>
              <text class="sr-sub">{{ o.sub }}</text>
            </view>
            <view class="sr-switch" :class="{ 'sr-switch-on': opts[o.key] }" @tap="toggleOpt(o.key)">
              <view class="sr-knob" :class="{ 'sr-knob-on': opts[o.key] }"></view>
            </view>
          </view>
        </view>

        <!-- 白噪音：默认关；开了再挑音色。休息/暂停会自动跟着停/停拍 -->
        <view class="strict-card">
          <view class="sr-head">
            <view class="sr-info">
              <text class="sr-title">专注白噪音</text>
              <text class="sr-try" @tap.stop="testNoise">试听 ›</text>
              <text class="sr-sub">专注时循环播放环境音（本地合成，不联网），休息自动停</text>
            </view>
            <view class="sr-switch" :class="{ 'sr-switch-on': noiseOn }" @tap="toggleNoise">
              <view class="sr-knob" :class="{ 'sr-knob-on': noiseOn }"></view>
            </view>
          </view>
          <view v-if="noiseOn" class="cfg-row noise-row">
            <text
              v-for="n in noiseKinds"
              :key="n.k"
              class="cfg-opt"
              :class="{ 'cfg-opt-on': noiseKind === n.k }"
              @tap="pickNoise(n.k)"
            >{{ n.t }}</text>
          </view>
        </view>

        <!-- 严格模式：只在番茄进行中生效，不计时的时候完全不动 -->
        <view class="strict-card">
          <view class="sr-head">
            <view class="sr-info">
              <text class="sr-title">严格模式</text>
              <text class="sr-sub">专注时打开非学习 App 就提醒，30 秒不回来本次作废</text>
            </view>
            <view class="sr-switch" :class="{ 'sr-switch-on': strictOn }" @tap="toggleStrict">
              <view class="sr-knob" :class="{ 'sr-knob-on': strictOn }"></view>
            </view>
          </view>
          <view v-if="strictOn && !usageOk" class="sr-warn" @tap="openUsage">
            需要「使用情况访问」权限才能判断你在用哪个 App，点这里去开启
          </view>
        </view>

        <!-- 强制模式：比严格模式更硬一层 —— 不是"记你一笔"，而是"把你拽回来"。
             这是个明确的开关，默认关；开了以后要用到「使用情况访问」。 -->
        <view class="strict-card">
          <view class="sr-head">
            <view class="sr-info">
              <text class="sr-title">强制模式</text>
              <text class="sr-sub">专注时切到别的 App，立刻把 PWstudy 拉回前台；连续 3 次强行离开，本次番茄作废</text>
            </view>
            <view class="sr-switch" :class="{ 'sr-switch-on': forcedOn }" @tap="toggleForced">
              <view class="sr-knob" :class="{ 'sr-knob-on': forcedOn }"></view>
            </view>
          </view>
          <view v-if="forcedOn" class="sr-note">
            放行名单：PWstudy 本身 + 系统桌面 + 「学习 App」里登记为「学习」的 {{ learnApps.length }} 个 App
            <text class="sn-go" @tap="goApps">去管理 ›</text>
          </view>
          <!-- 能力提示按"可靠性从高到低"排：原生桥 → 无障碍 → 使用情况访问 → 遮罩。
               顺序本身就是优先级：先看有没有能力拉，再看这份能力有没有被系统放行；
               最后一条是"锦上添花"的兜底，所以排在最后（只提示、不阻拦继续用）。 -->
          <view v-if="forcedOn && !pullOk" class="sr-warn">
            当前跑的不是自定义基座 / 正式打包，原生拉回能力没打进包里 —— 现在只能提醒，拦不住
          </view>
          <view v-else-if="forcedOn && !a11ySafe && !a11yOk" class="sr-warn sw-block">
            <text class="sw-head">这台手机的无障碍服务起不来，已自动让路</text>
            <text class="sw-body">刚才它在被系统绑定的过程中反复重启（那会把手机一起拖卡），所以 PWstudy 已经把它停掉，改用「使用情况访问」+ 悬浮窗遮罩这条路 —— 只是拉回会慢半拍。</text>
            <text class="sw-go" @tap.stop="retryA11y">想再试一次无障碍 ›</text>
          </view>
          <view v-else-if="forcedOn && !a11yOk" class="sr-warn sw-block" @tap="openA11y">
            <text class="sw-head">开「无障碍」，强制模式才真拦得住</text>
            <text class="sw-body">安卓 10 起系统默认禁止应用从后台跳回前台，官方只给"由系统绑定的服务"（无障碍 / 通知监听这类）开口子。开了它：你一切走就被立刻拉回来，而且不必再开「使用情况访问」。</text>
            <text class="sw-go">点这里去开 · 在列表里找「PWstudy 专注护卫」 ›</text>
          </view>
          <view v-else-if="forcedOn && !usageOk" class="sr-warn" @tap="openUsage">
            无障碍没开时，得靠「使用情况访问」判断你在用哪个 App（点这里去开）
          </view>
          <view v-else-if="forcedOn && !overlayOk" class="sr-warn" @tap="openOverlay">
            再授一个「显示在其他应用上层」：极少数 ROM 连无障碍也拦得住后台跳转，那时用一层遮罩
            把那个 App 盖住（点这里去开）
          </view>
        </view>
      </view>

      <!-- 正计时段：预设时长已经跑满，人还在继续 —— 这一屏只给「退出」，
           不再有暂停/放弃（番茄本身早就跑完了，谈"放弃"是骗人）。
           强制拉回与违规判定也在这一刻停手（见 utils/forced.js / strict.js 的 overrun 分支）。 -->
      <view v-if="active && overrun" class="ctrl">
        <button class="ctrl-btn ctrl-main" @tap="exitOverrun">{{ $t('退出') }}</button>
      </view>

      <!-- 运行态 / 暂停态 -->
      <view v-else-if="active" class="ctrl">
        <button class="ctrl-btn ctrl-main" @tap="togglePause">{{ paused ? '继续' : '暂停' }}</button>
        <button class="ctrl-btn ctrl-ghost" @tap="confirmGiveUp">放弃</button>
      </view>
      <text v-if="overrun" class="over-hint">{{ $t('预设时长已跑完，继续计时中') }}</text>

      <!-- 运行态的白噪音控制：以前开关只在空闲态，一开表想关噪音就得先放弃 -->
      <view v-if="active" class="run-noise">
        <text class="rn-label">白噪音</text>
        <text class="rn-kind" @tap="cycleNoise">{{ noiseKindName }} ›</text>
        <view class="sr-switch" :class="{ 'sr-switch-on': noiseOn }" @tap="toggleNoise">
          <view class="sr-knob" :class="{ 'sr-knob-on': noiseOn }"></view>
        </view>
      </view>

      <!-- 刚完成一个专注番茄：引导休息 -->
      <view v-if="finished" class="after">
        <text class="after-txt">
          完成 {{ lastMin }} 分钟专注，{{ longNext
            ? '这是本轮第 ' + roundCount + ' 个番茄 —— 来一段 ' + restMin + ' 分钟的长休吧'
            : '休息 ' + restMin + ' 分钟吧' }}。
        </text>
        <button class="btn-primary after-btn" @tap="startRestNow">开始休息</button>
        <button class="btn-ghost after-btn" @tap="startNextFocus">跳过休息，再来一个</button>
      </view>
      <!-- 刚完成休息 -->
      <view v-if="restDone" class="after">
        <text class="after-txt">休息结束，准备好开始下一个番茄了吗？</text>
        <button class="btn-primary after-btn" @tap="startNextFocus">再来一个番茄</button>
      </view>

      <!-- 强制模式实时状态：真拉回了几次要看得见，不然用户会怀疑它到底有没有干活。
           ⚠️ 专注中**一律显示**（不管开关开没开）：原来是 `forcedOn && active`，
           于是开关关着的时候这行压根不出现 —— 用户开着专注退出去没人拦，
           界面上却连一句"你没开强制模式"都没有，只能得出"功能没做"的结论。 -->
      <view v-if="active && !isRest" class="force-strip" :class="{ 'fs-off': !forcedOn, 'fs-weak': forcedOn && forceAct }" @tap="onForceStrip">
        <text class="fs-dot"></text>
        <text class="fs-txt">{{ forceLine }}</text>
        <text v-if="forceAct" class="fs-act">{{ forceAct }} ›</text>
      </view>

      <!-- 学习 App 入口：专注期间的白名单就摆在这儿，点图标直接跳过去。
           强制模式放行的也正是这些（外加 PWstudy 自己与系统桌面/状态栏）。 -->
      <view v-if="learnApps.length" class="learn-dock">
        <view class="ld-head">
          <text class="ld-title">学习 App</text>
          <text class="ld-more" @tap="goApps">管理 ›</text>
        </view>
        <view class="ld-row">
          <view v-for="a in learnApps" :key="a.pkg" class="ld-item" @tap="openLearnApp(a)">
            <image v-if="iconMap[a.pkg]" class="ld-icon-img" :src="iconMap[a.pkg]" mode="aspectFit" />
            <view v-else class="ld-icon">{{ initialOf(a) }}</view>
            <text class="ld-name">{{ a.name }}</text>
          </view>
        </view>
        <text v-if="forcedOn" class="ld-note">强制模式：专注期间只放行上面这些 App</text>
        <text v-else class="ld-note">从这儿跳过去，回来会自动记下这段用时</text>
      </view>

      <view class="today-strip">
        <text v-if="taskProg" class="ts-prog">{{ taskProg }}</text>
        <text>今日 {{ todayMin }} 分钟 · {{ todayPomo }} 个番茄</text>
      </view>

    </view>

    <app-dialog
      :show="dlg.show"
      :mode="dlg.mode"
      :title="dlg.title"
      :content="dlg.content"
      :confirm-text="dlg.confirmText"
      :cancel-text="dlg.cancelText"
      :danger="dlg.danger"
      :value="dlg.value"
      :placeholder="dlg.placeholder"
      :error="dlg.error"
      :items="dlg.items"
      :seq="dlg.seq"
      @confirm="onDlgYes"
      @cancel="onDlgCancel"
      @input="onDlgInput"
    />
  </view>
</template>

<script>
import * as pw from '../../../utils/pwstore.js'
import * as focus from '../../../utils/focus.js'
import * as pacing from '../../../utils/pacing.js'
import * as strict from '../../../utils/strict.js'
import * as forced from '../../../utils/forced.js'
import * as apptime from '../../../utils/apptime.js'
import * as settings from '../../../utils/settings.js'
import { safeNav } from '../../../utils/nav.js'
import { t } from '../../../utils/i18n.js'
import * as notify from '../../../utils/notify.js'
import * as ambient from '../../../utils/ambient.js'
import * as audio from '../../../utils/audio.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../../components/app-dialog/app-dialog.vue'

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      minutesOptions: [15, 20, 25, 30, 45, 60],
      minutes: 25,
      titleOpen: false,      // 圆盘里的任务名是否展开（默认单行，点一下展开到 3 行）
      presetTask: null,      // {taskId, goalId, title}
      cur: null,
      finished: false,
      restDone: false,
      lastMin: 0,
      // 本轮番茄进度与下一段休息时长（长休按"第几个番茄"触发，所以要显示出来）
      roundCount: 0,
      longNext: false,
      restMin: 5,
      todayMin: 0,
      todayPomo: 0,
      strictOn: false,
      forcedOn: false,    // 强制模式：离开学习 App 就当场拉回来
      usageOk: false,
      pullOk: false,      // 原生"拉回前台"能力在不在（自定义基座 / 正式包）
      overlayOk: false,   // 「显示在其他应用上层」授权：拦不住时用遮罩兜底
      a11ySafe: true,     // 无障碍护卫的保险丝：false = 这个 ROM 上起不来，别再引导用户去开
      a11yOk: false,      // 无障碍护卫已开启（强制模式最关键的一层：后台启动的官方豁免）
      a11yLive: false,    // 护卫已连上（正在收窗口事件）
      a11yEvents: 0,      // 护卫收到过多少窗口事件（>0 说明它真的在干活）
      learnApps: [],      // 放行名单里登记为「学习」的 App（专注页底部那排图标）
      iconMap: {},        // pkg -> data URL（懒加载，拿不到就退回首字母）
      _iconPending: {},   // 正在读图标的包名（防重复发起）
      forcedPulls: 0,     // 强制模式已经拉回几次（原生看门狗的战绩）
      forcedEscapes: 0,   // 已经离开几次（满 3 次作废）
      // 强制模式的能力盘点（native / a11y / overlay / usage / svc…）：
      // 状态条和首次引导都读它，不各算一套 —— 两边算法不一致就会出现
      // "状态条说已就绪、实际上根本拉不动"这种骗人的界面。
      forceCap: { native: false, a11y: false, overlay: false, usage: false, svc: false, svcAllowed: true, canPullBack: false, canDetect: false, effective: false },
      // 统一弹窗的一份状态：confirm = 确认框，input = 带输入框（自定义时长）。
      // 页面里所有"要先问一句"的动作都走它 —— 不再有第二套（系统 showModal 样式管不到）
      // 「确定 / 取消」走 t()：这两个词字典里早就有译文，别再各写一份中文
      dlg: { show: false, mode: 'confirm', title: '', content: '', confirmText: t('确定'), cancelText: t('取消'), danger: false, value: '', placeholder: '', error: '', items: [], seq: 0, action: '' },
      opts: { notify: true, sound: true, vibe: true, fgservice: true },
      optRows: [
        { key: 'notify', title: '通知提醒', sub: '结束后发通知，专注中在状态栏显示剩余时间' },
        { key: 'fgservice', title: '后台保活', sub: '计时期间常驻前台服务，息屏也不中断（需正式打包/自定义基座生效）' },
        { key: 'sound', title: '结束响铃', sub: '番茄结束时响一声' },
        { key: 'vibe', title: '震动', sub: '番茄结束时震一下' }
      ],
      noiseKinds: [
        { k: 'white', t: '白噪' },
        { k: 'pink', t: '粉噪' },
        { k: 'brown', t: '棕噪' },
        { k: 'rain', t: '雨声' }
      ],
      noiseKind: 'rain',
      noiseOn: false
    }
  },
  computed: {
    active() {
      return !!this.cur
    },
    paused() {
      return !!(this.cur && this.cur.paused)
    },
    /** 预设时长已跑满、正在正计时（番茄闹钟的做法：到点不赶人走） */
    overrun() {
      return !!(this.cur && this.cur.overrun)
    },
    overSec() {
      return this.cur ? (Number(this.cur.overSec) || 0) : 0
    },
    isRest() {
      return !!(this.cur && this.cur.phase === 'rest')
    },
    phaseText() {
      // 正计时与"完成面板"共用这一档：番茄本身跑满了，区别只在于人还在继续
      //（写成两个分支会多出一条静态中文，i18n 阈值正卡满 —— 能省就省）
      if (this.finished || this.overrun) return '番茄完成'
      if (this.restDone) return '休息结束'
      if (!this.cur) return '准备开始'
      if (this.paused) return '已暂停'
      return this.isRest ? '休息中' : '专注中'
    },
    remainSec() {
      return this.cur ? this.cur.remainSec : this.minutes * 60
    },
    /** 环心的大号读数：正计时段显示"+MM:SS"（多坐了多久），其余显示"还剩多久" */
    timeText() {
      return this.overrun ? '+' + this.fmtMMSS(this.overSec) : this.fmtMMSS(this.remainSec)
    },
    // conic-gradient 比例（正计时段恒为满环 —— 目标已经达成了）
    ringStyle() {
      const total = this.cur ? this.cur.totalSec : this.minutes * 60
      const remain = this.remainSec
      const pct = this.overrun ? 1 : (total > 0 ? Math.max(0, Math.min(1, 1 - remain / total)) : 0)
      const deg = Math.round(pct * 360)
      const run = this.active && !this.paused
      const c1 = this.isRest ? '#3b6d11' : (run ? '#e5484d' : '#98a19b')
      return {
        background: 'conic-gradient(' + c1 + ' ' + deg + 'deg, rgba(23,32,26,0.08) ' + deg + 'deg)'
      }
    },
    taskTitle() {
      if (this.cur) return this.cur.taskTitle || '自由专注'
      if (this.presetTask) return this.presetTask.title
      return '自由专注'
    },
    /**
     * 当前关联任务的进度一句话：任务进度 + 剩余量折算分钟。
     * 让"计时"和"计划"看得见是同一件事 —— 只显示任务名的话，
     * 用户不知道这个任务还要来几个番茄、今天专注算不算数。
     */
    taskProg() {
      const t = this.presetTaskObj()
      if (!t) return ''
      const done = t.donePomos || 0
      const total = t.pomos || 1
      const remain = Math.max(0, total - done)
      const len = pacing.focusLen()
      return '任务 ' + done + '/' + total + ' 番茄 · 还剩 ' + remain + ' 个 ≈ ' + (remain * len) + ' 分钟'
    },
    noiseKindName() {
      const k = this.noiseKinds.filter(x => x.k === this.noiseKind)[0]
      return (k && k.t) || '音色'
    },
    /**
     * 强制模式那行实时状态：说清楚"它现在到底在不在干、干了什么"。
     *
     * ⚠️ 顺序就是"从根到叶"的排查顺序，也是用户该照着做的顺序：
     *    开关开没开 → 包里有没有原生能力 → 前台服务起不起得来
     *    → 看不看得见你在哪个 App → 拉不拉得动。
     *    任何一条不满足，"离开就拉回"就是假的，界面不许说它已就绪。
     */
    forceLine() {
      void this.__lang      // 下面用到了 $t：computed 要建立语言依赖，否则切语言不重算
      const c = this.forceCap
      let s
      // 正计时段：拉回与违规判定都已停手，界面不许再说"已就绪 · 离开立刻拉回"
      if (this.overrun) s = this.$t('已跑满预设时长，不再拉回')
      else if (!this.forcedOn) s = '离开不会被拉回'
      else if (!c.native) s = '当前包没有原生拉回能力，只能提醒'
      else if (!c.svcAllowed) s = '「后台保活」或「通知提醒」关着，拉回起不来'
      else if (!c.canDetect) s = '看不出你在哪个 App —— 要开「无障碍」或「使用情况访问」'
      else if (!c.canPullBack) s = '看得出你切走了，但拉不回来 —— 去开「无障碍」'
      else s = '已就绪 · 离开立刻拉回'
      if (this.forcedOn) {
        if (this.forcedPulls > 0) s += ' · 已拉回 ' + this.forcedPulls + ' 次'
        if (this.forcedEscapes > 0) s += '（离开 ' + this.forcedEscapes + '/' + forced.maxEscapes() + '）'
      }
      return s
    },
    /** 状态条右侧的行动：没就绪时给一条最短的路，就绪了就什么都不给 */
    forceAct() {
      if (!this.forcedOn) return '开启'
      const c = this.forceCap
      if (!c.native) return ''
      if (!c.svcAllowed) return '去开'
      if (!c.canDetect || !c.canPullBack) return '去授权'
      return ''
    }
  },
  onLoad(query) {
    if (query && query.taskId && query.goalId) {
      this.presetTask = {
        taskId: query.taskId,
        goalId: query.goalId,
        title: query.title ? decodeURIComponent(query.title) : '任务'
      }
    }
    if (query && query.minutes) {
      const m = Number(query.minutes)
      if (m && this.minutesOptions.indexOf(m) >= 0) this.minutes = m
    }
    const cfg = pw.get().pomoCfg || {}
    if (cfg.focus && this.minutesOptions.indexOf(cfg.focus) >= 0) this.minutes = cfg.focus
    // ⚠️ 这里**没有**"带 auto=1 就直接起表"的分支（曾经有过，已删）：
    // 从首页 / 目标详情 / 通知点进来，一律停在准备态，
    // 让人先确认"这一轮几分钟、绑的哪个任务、开了哪些模式"，再自己按下确认。
    // 绑定了任务就用任务剩余量推荐时长（放最后：覆盖前面的默认值链）
    this.applySuggest()
  },
  onShow() {
    this.refreshToday()
    this.cur = focus.current()
    this.refreshRound()
    if (this.cur && this.cur.phase === 'rest') {
      // 进入页面时已经在休息
      this.finished = false
    }
    this.strictOn = !!strict.enabled()
    this.forcedOn = !!forced.enabled()
    // 从系统设置页回来：先让缓存失效再实测，否则界面还显示着"没开"
    if (this.__fromA11y) {
      this.__fromA11y = false
      apptime.refreshA11y()
    }
    this.usageOk = apptime.hasUsagePermission()
    this.pullOk = !!forced.canPull()
    this.overlayOk = apptime.canDrawOverlays()
    this.refreshA11y()
    this.refreshLearnApps()
    this.refreshForceCap()
    try {
      const f = (settings.get() && settings.get().focus) || {}
      this.opts = {
        notify: f.notify !== false,
        fgservice: f.fgservice !== false,
        sound: f.sound !== false,
        vibe: f.vibe !== false
      }
      this.noiseKind = f.noise || 'rain'
      this.noiseOn = !!f.noise
    } catch (e) {}
    strict.sync()
    forced.sync()
    this.startTick()
  },
  onHide() {
    this.stopTick()
    // 注意：严格模式故意不在这儿停 —— 人切走才是它该干活的时候
  },
  onUnload() { this.stopTick() },
  // 强制模式 + 正在专注：返回键不放行。不然"按一下返回就出去了"，模式等于没有。
  // 暂停 / 休息阶段照常放行 —— 拦人是为了专注，不是把人困死。
  onBackPress() {
    if (!this.forcedOn) return false
    // 正计时段放行：番茄已经跑满了，这时候再把人按在页面里就是"拦人不放"
    if (!this.cur || this.cur.paused || this.cur.overrun || this.cur.phase !== 'focus') return false
    uni.showToast({ title: '强制模式：先把这个番茄跑完', icon: 'none' })
    return true
  },
  methods: {
    refreshToday() {
      const ov = pw.overview()
      this.todayMin = ov.todayMin
      this.todayPomo = ov.pomo
    },
    /**
     * 本轮第几个番茄 / 下一段是不是长休。
     * 这两个值存在库里、不是响应式的，只能靠手动刷 —— computed 会一直拿旧值。
     */
    refreshRound() {
      const r = focus.roundInfo()
      this.roundCount = r.count
      this.longNext = r.longNext
      this.restMin = focus.nextRestMin()
    },
    startTick() {
      this.stopTick()
      this.tick()
      this.__timer = setInterval(() => this.tick(), 500)
    },
    stopTick() {
      if (this.__timer) { clearInterval(this.__timer); this.__timer = 0 }
    },
    tick() {
      const r = focus.tick()
      this.cur = r.state
      // 强制模式战绩：原生看门狗在后台拉回来的次数，每 ~1 秒对一次账就够
      //（跨 JS↔原生桥取值不便宜，别跟着 500ms 的 UI 心跳一起刷）
      const now = Date.now()
      if (!this.__forceAt || now - this.__forceAt > 1000) {
        this.__forceAt = now
        this.refreshForce()
      }
      if (r.justOverrun) {
        // 预设时长跑满 → 转正计时。只震一下并把两个模式叫停：
        // 弹"完成"面板会把人正学到一半的思路打断（他还没说要走）。
        try { uni.vibrateLong({}) } catch (e) {}
        strict.sync()
        forced.sync()
        this.refreshForceCap()
      } else if (r.justFinished === 'focus') {
        const s = this.lastSession()
        this.lastMin = s ? s.min : (this.minutes || 25)
        this.finished = true
        this.restDone = false
        this.refreshToday()
        // 番茄刚跑完 → 本轮计数变了，下一段可能是长休，得马上重算
        this.refreshRound()
        try { uni.vibrateLong({}) } catch (e) {}
      } else if (r.justFinished === 'rest') {
        this.restDone = true
        this.finished = false
      }
    },
    lastSession() {
      const ss = pw.get().sessions
      return ss.length ? ss[ss.length - 1] : null
    },
    beginFocus() {
      // 换一轮 / 换任务就把展开态收回：留着上一条的展开，下一条短任务名会顶着一块空
      this.titleOpen = false
      const opt = this.presetTask
        ? { minutes: this.minutes, taskId: this.presetTask.taskId, goalId: this.presetTask.goalId, taskTitle: this.presetTask.title }
        : { minutes: this.minutes, taskTitle: '自由专注' }
      this.cur = focus.startFocus(opt)
      focus.setCfg({ focus: this.minutes })
      this.finished = false
      this.restDone = false
      strict.sync()
      forced.sync()
      // 番茄刚起：这时候问"要不要离开就拉回"最自然 —— 晚了就是人已经跑掉了
      this.maybeAskForced()
    },
    togglePause() {
      if (!this.cur) { this.beginFocus(); return }
      if (this.cur.paused) focus.resume()
      else focus.pause()
      this.cur = focus.current()
      strict.sync()
      forced.sync()
    },
    /** 放弃当前番茄：走统一弹窗（以前是系统 showModal，样式跟 App 对不上） */
    confirmGiveUp() {
      this.ask({
        title: '放弃这个番茄？',
        content: '满 1 分钟会按实际时长记录，但不算完成任务量。',
        confirmText: '放弃',
        danger: true,
        action: 'give-up'
      })
    },
    /**
     * 正计时收摊：番茄早就跑满了，所以按「完整番茄」落账（正计时那段一起算进去），
     * 然后才落到"完成"面板 —— 让人决定是去休息还是再来一个。
     */
    exitOverrun() {
      const s = focus.stopOverrun()
      this.cur = null
      this.titleOpen = false
      this.lastMin = s ? s.min : (this.minutes || 25)
      this.finished = true
      this.restDone = false
      this.refreshToday()
      this.refreshRound()
      strict.sync()
      forced.sync()
    },
    startRestNow() {
      this.finished = false
      // 必须走 startRest：只有它按"本轮第几个番茄"决定短休还是长休。
      // 以前这里自己拼了一段固定短休，长休就永远轮不到。
      this.cur = focus.startRest()
      this.refreshRound()
      strict.sync()
    },
    startNextFocus() {
      this.finished = false
      this.restDone = false
      this.beginFocus()
    },
    /** 圆盘里的任务名：点一下展开 / 收起。换了任务就收回单行（免得留着上一条的展开态） */
    toggleTitle() {
      this.titleOpen = !this.titleOpen
    },
    clearPreset() { this.presetTask = null; this.titleOpen = false },
    /** 绑定的任务对象（找不到目标/任务返回 null） */
    presetTaskObj() {
      if (!this.presetTask) return null
      const g = pw.goalOf(this.presetTask.goalId)
      if (!g) return null
      return g.tasks.filter(x => x.id === this.presetTask.taskId)[0] || null
    },
    /**
     * 按任务剩余量推荐本次专注时长。
     * 25 分钟的"标准番茄"只对颗粒度负责，不对总量负责 —— 剩 3 个番茄的任务
     * 推荐一次 60 分钟的深专注，剩 1 个就 25 分钟；但都夹在 15-60，
     * 超过 60 分钟的单次专注违背番茄节奏，是"推荐值"而不是硬性值。
     */
    suggestMinutes() {
      const t = this.presetTaskObj()
      if (!t) return 0
      const remain = Math.max(1, (t.pomos || 1) - (t.donePomos || 0))
      return Math.min(60, Math.max(15, remain * pacing.focusLen()))
    },
    /** 把推荐值插进时长选项并选中（保留系统推荐档，用户仍可改） */
    applySuggest() {
      const sug = this.suggestMinutes()
      if (!sug) return
      if (this.minutesOptions.indexOf(sug) < 0) {
        this.minutesOptions.push(sug)
        this.minutesOptions.sort((a, b) => a - b)
      }
      this.minutes = sug
    },
    /**
     * 自由专注的任意时长：10-120 分钟，走统一弹窗的 input 模式。
     *
     * 以前这里是 uni.showModal({ editable: true }) —— 系统原生弹窗，
     * 圆角 / 间距 / 字号 / 按钮 / 配色 / 暗色 / 屏宽全由系统决定，CSS 一律管不到，
     * 所以它在 App 里怎么看都像"另一个 App 的框"。换成统一弹窗后，
     * 视觉自动跟 App.vue 里那一份 .pop-card / .dlg-input / .dlg-btn 对齐，
     * 深浅色与安全区也跟着令牌走。
     */
    customMinutes() {
      this.ask({
        mode: 'input',
        title: '自定义专注时长',
        placeholder: '输入 10-120 的分钟数',
        value: String(this.minutes || ''),
        action: 'custom-min'
      })
    },
    /**
     * 运行态切音色：立即生效（空闲态走 pickNoise 只存偏好）。
     * 走统一菜单弹窗 —— 以前是 uni.showActionSheet，系统底部弹层的
     * 字号 / 圆角 / 选中色 / 暗色全由系统决定，跟这套玻璃卡片对不上。
     */
    cycleNoise() {
      this.ask({
        mode: 'sheet',
        items: this.noiseKinds.map(k => k.t),
        action: 'noise'
      })
    },
    /**
     * 刷新底部"学习 App"入口 = 强制模式的放行名单。
     * 口径与 utils/apptime.js 的 isAllowedPkg / allowList 完全一致：
     * 只取登记为「学习」的，登记为「休息」的不算（专注期间去刷手机当然算跑偏）。
     */
    refreshLearnApps() {
      let list = []
      try {
        list = pw.dock().filter(a => a && a.pkg && a.purpose !== 'rest')
      } catch (e) {
        list = []
      }
      this.learnApps = list
      list.forEach(a => this.ensureIcon(a.pkg))
    },
    /** 应用图标懒加载（plus.android 桥读图标偏慢，延一帧，别卡首绘） */
    ensureIcon(pkg) {
      if (!pkg || this.iconMap[pkg] || this._iconPending[pkg]) return
      this._iconPending[pkg] = true
      setTimeout(() => {
        try {
          const url = apptime.appIconDataUrl(pkg)
          if (url) this.$set(this.iconMap, pkg, url)
        } catch (e) {
          console.warn('[focus] 加载图标失败', pkg, e)
        }
        delete this._iconPending[pkg]
      }, 0)
    },
    initialOf(a) {
      return String((a && a.name) || (a && a.pkg) || '?').slice(0, 1).toUpperCase()
    },
    /**
     * 点底部的学习 App → 跳过去（专注期间唯一被放行的离开理由）。
     * 必须过白名单校验：这个列表是界面渲染出来的，但入口函数不能假设调用方一定合法
     *（将来别的页面复用时，传进来的 pkg 也得自己再验一遍）。
     */
    openLearnApp(a) {
      const pkg = String((a && a.pkg) || '')
      const hit = this.learnApps.filter(x => x.pkg === pkg)[0]
      if (!pkg || !hit) {
        uni.showToast({ title: '不在学习 App 名单里', icon: 'none' })
        return
      }
      if (!apptime.supported()) {
        uni.showToast({ title: '在手机 App 里才能直接跳转', icon: 'none' })
        return
      }
      const ok = apptime.launchStudyApp(pkg)
      if (ok) {
        uni.showToast({ title: '去「' + hit.name + '」，回来接着计时', icon: 'none' })
      }
    },
    /** 刷新强制模式战绩（拉回次数 / 离开次数） */
    refreshForce() {
      if (!this.forcedOn || !this.cur || this.cur.phase !== 'focus') return
      this.forcedPulls = forced.pullsOf()
      this.forcedEscapes = forced.escapesOf()
    },
    /**
     * 刷新强制模式的能力盘点。状态条、首次引导、补全路径**共读这一份** ——
     * 各算一套必然分叉，分叉的表现就是"界面说已就绪，实际根本拉不动"。
     */
    refreshForceCap() {
      let cap = { native: false, a11y: false, overlay: false, usage: false, svc: false, svcAllowed: true, canPullBack: false, canDetect: false, effective: false }
      try { cap = forced.capability({ a11y: this.a11yOk, overlay: this.overlayOk }); } catch (e) {}
      this.forceCap = cap
      return cap
    },

    /* ---------- 强制模式的"第一次"：主动问，而不是等人去翻设置 ----------
     *
     * 为什么必须有这一段：强制模式是独立开关、默认关，而它那张设置卡只在**空闲态**
     * 出现。用户一点"开始专注"，卡片就没了 —— 于是他压根不知道还有这么个功能，
     * 退出 App 发现没人拦，唯一合理的结论就是"专注功能没做"。
     * 番茄闹钟类 App 的做法是"开始专注 = 锁住"，所以我们至少要问一次。
     */

    /** 开始番茄时调：只在"没开 + 从没问过"时弹一次，别每轮都烦人 */
    maybeAskForced() {
      if (this.forcedOn) return
      try {
        const st = settings.get()
        if (st && st.focus && st.focus.forcedAsked) return
      } catch (e) { return }
      this.askForced()
    },

    /**
     * 弹统一弹窗：页面里所有"要先问一句"的动作都经过它，
     * 保证 mode / value / placeholder / error 这几个字段不会漏（漏了就是输入框不显示）。
     * seq 每次 +1：组件用 v-if 挂载，从"确认框"切到"输入框"时不会重新挂载，靠它兜底同步。
     */
    ask(o) {
      this.dlg = {
        show: true,
        mode: o.mode || 'confirm',
        title: o.title || '',
        content: o.content || '',
        confirmText: o.confirmText || t('确定'),
        cancelText: o.cancelText || t('取消'),
        danger: !!o.danger,
        value: o.value || '',
        placeholder: o.placeholder || '',
        error: '',
        items: o.items || [],
        seq: ((this.dlg && this.dlg.seq) || 0) + 1,
        action: o.action || ''
      }
    },

    askForced() {
      this.ask({
        title: '要不要开启「离开就拉回」？',
        content: '开启后，在这个番茄跑完之前切到别的 App，PWstudy 会立刻把你拉回来；连续强行离开 3 次，本次番茄作废。它需要你再授权「无障碍」—— 安卓 10 起系统默认禁止应用从后台跳回前台，官方只给无障碍这类"由系统绑定的服务"开口子。',
        confirmText: '开启并去授权',
        cancelText: '这次不用',
        action: 'forced-on'
      })
    },

    /**
     * 确认。载荷随 mode 变化：input → 文本，其余 → true。
     * ⚠️ input 校验不通过时**不关弹窗**：把错误写到 dlg.error 就地提示，
     * 让用户接着改 —— 关掉再 toast 等于让人重填一遍。
     */
    onDlgYes(v) {
      const act = this.dlg.action
      if (act === 'custom-min') {
        const n = Math.round(Number(String(v == null ? '' : v).trim()))
        if (!(n >= 10 && n <= 120)) {
          this.dlg.error = '请输入 10-120 的整数'
          return
        }
        this.dlg.show = false
        this.dlg.error = ''
        if (this.minutesOptions.indexOf(n) < 0) {
          this.minutesOptions.push(n)
          this.minutesOptions.sort((a, b) => a - b)
        }
        this.minutes = n
        return
      }
      this.dlg.show = false
      if (act === 'give-up') {
        focus.giveUp()
        this.cur = null
        this.refreshToday()
        strict.sync()
        forced.sync()
      } else if (act === 'noise') {
        // sheet 的载荷是选中项下标
        const k = this.noiseKinds[Number(v)]
        if (!k) return
        this.noiseKind = k.k
        // 走 pickNoise → syncAmbient：它自己会判断"现在是不是正在专注"，
        // 不在专注（比如休息中）就只是存偏好、不出声（白噪音只陪专注）
        if (this.noiseOn) this.pickNoise(k.k)
      } else if (act === 'forced-on') {
        this.markForcedAsked()
        if (!this.forcedOn) this.toggleForced()
        else this.guideNextStep()
      } else if (act === 'goto-a11y') {
        this.openA11y()
      }
    },

    onDlgCancel() {
      const act = this.dlg.action
      this.dlg.show = false
      this.dlg.error = ''
      // 选了"这次不用"也算问过了 —— 不记住的话下一轮番茄又会弹
      if (act === 'forced-on') this.markForcedAsked()
    },

    /** 输入中：清掉上一次的报错，不然红字会一直挂着 */
    onDlgInput(v) {
      if (this.dlg.error) this.dlg.error = ''
      this.dlg.value = String(v == null ? '' : v)
    },

    /** 记下"问过了"（选什么都记） */
    markForcedAsked() {
      try {
        const st = settings.get()
        st.focus = Object.assign({}, st.focus || {}, { forcedAsked: true })
        settings.save()
      } catch (e) {}
    },

    /** 点专注中那条状态条：按"从根到叶"的顺序把最短的补全路径指出来 */
    onForceStrip() {
      const c = this.refreshForceCap()
      if (!this.forcedOn) { this.askForced(); return }
      if (!c.native) return
      if (!c.svcAllowed) { this.ensureServiceSetting(); return }
      if (!c.canDetect || !c.canPullBack) this.guideNextStep()
    },

    /**
     * 开完强制模式之后，把最要紧的那一步推给用户。
     * 顺序 = 可靠性从高到低：无障碍（唯一能提前拿到后台启动许可的）> 使用情况访问 > 悬浮窗。
     */
    guideNextStep() {
      const c = this.refreshForceCap()
      if (!c.native) {
        uni.showToast({ title: '当前包没有原生拉回能力，只能提醒', icon: 'none' })
        return
      }
      if (c.a11y) {
        uni.showToast({ title: '已就绪 · 切走会立刻拉回来', icon: 'none' })
        return
      }
      if (!c.svcAllowed) { this.ensureServiceSetting(); return }
      if (!this.a11ySafe) {
        uni.showToast({ title: '这台手机的无障碍起不来，改用使用情况访问', icon: 'none' })
        if (!this.usageOk) setTimeout(() => this.openUsage(), 1000)
        return
      }
      this.dlg = {
        show: true,
        title: '还差一步：开「无障碍」',
        content: '安卓 10 起系统默认禁止应用从后台跳回前台，官方只给无障碍这类"由系统绑定的服务"开口子。开了它：你一切走就被立刻拉回来，也不必再开「使用情况访问」。下一步会跳到系统的无障碍页，在列表里找「PWstudy 专注护卫」打开。（安卓 13+ 侧载安装的应用要先在「应用信息 → 右上角 ⋮ → 允许受限设置」放行一次。）',
        confirmText: '去开无障碍',
        cancelText: '先不开',
        danger: false,
        seq: (this.dlg && this.dlg.seq || 0) + 1,
        action: 'goto-a11y'
      }
    },

    /**
     * 强制模式的载体是前台服务：「后台保活」或「通知提醒」任一关掉，服务就起不来，
     * 拉回功能等于空谈。这里直接帮用户打开并说明原因 ——
     * 不弹"请去设置里打开"这种空提示（用户找不到），也不静默不管（那是骗人）。
     */
    ensureServiceSetting() {
      try {
        const st = settings.get()
        const f = st.focus || {}
        if (f.fgservice !== false && f.notify !== false) return false
        st.focus = Object.assign({}, f, { fgservice: true, notify: true })
        settings.save()
        this.opts = Object.assign({}, this.opts, { notify: true, fgservice: true })
        uni.showToast({
          title: '已打开「后台保活」和「通知提醒」—— 拉回要靠它们',
          icon: 'none',
          duration: 2400
        })
        this.refreshForceCap()
        return true
      } catch (e) {
        return false
      }
    },
    openOverlay() {
      apptime.openOverlaySettings()
      setTimeout(() => { this.overlayOk = apptime.canDrawOverlays() }, 1200)
    },
    /**
     * 刷新无障碍状态。
     * a11yOk 是"系统里勾上了没"，a11yLive/a11yEvents 是"它真的在干活没" ——
     * 两个都要看：勾上了但服务被系统回收（或抢不过省电策略），事件数会一直是 0。
     */
    refreshA11y() {
      this.a11yOk = apptime.hasA11yPermission()
      // 保险丝跳了 = 这个 ROM 上服务起不来（再开也是卡），界面改成另一套说法
      this.a11ySafe = apptime.a11ySafe()
      const st = apptime.a11yStats()
      this.a11yLive = !!st.on
      this.a11yEvents = Number(st.events) || 0
    },
    /**
     * 保险丝跳过闸之后，让用户能"再试一次"。
     * 只清计数，不替用户去系统页 —— 开关在系统手里，我们只能把它自己的刹车松开。
     */
    retryA11y() {
      apptime.resetA11y()
      apptime.refreshA11y()
      this.refreshA11y()
      uni.showToast({
        title: '已复位，可以去系统设置里再开一次试试',
        icon: 'none',
        duration: 2200
      })
    },
    /**
     * 跳系统「无障碍」设置页。
     * 安卓 13+ 对侧载安装的应用有「受限设置」闸门：用户得先
     * 「应用信息 → 右上角 ⋮ → 允许受限设置」，那个列表里才勾得上本服务 ——
     * 系统故意不给应用跳这一步的捷径，只能靠文案讲清楚（提示里已经写了去哪找）。
     */
    openA11y() {
      // 已经跳过闸的话，先复位再去 —— 否则用户开着开关回来还是"没反应"，
      // 而且那次 bind 大概率又会把进程拖进重启循环。
      if (!this.a11ySafe) {
        apptime.resetA11y()
        this.a11ySafe = true
      }
      this.__fromA11y = true
      apptime.openA11ySettings()
      // 系统页是全屏的，回来才知道结果；这里再补一次，防止用户很快就切回来
      //（延迟着查还有一个好处：躲开系统刚 bind 服务时那段最容易 Binder 互等的窗口）
      setTimeout(() => { apptime.refreshA11y(); this.refreshA11y() }, 1200)
    },
    // ---------- 强制模式 ----------
    toggleForced() {
      const next = !this.forcedOn
      this.forcedOn = next
      try {
        const st = settings.get()
        st.focus = Object.assign(
          { notify: true, sound: true, vibe: true, wakeLock: false, strict: false, forced: false, fgservice: true, noise: '' },
          st.focus || {},
          { forced: next }
        )
        settings.save()
      } catch (e) {}
      if (next) {
        apptime.refreshA11y()
        this.usageOk = apptime.hasUsagePermission()
        this.pullOk = !!forced.canPull()
        this.overlayOk = apptime.canDrawOverlays()
        this.refreshA11y()
        this.refreshLearnApps()
        // 载体先兜住：服务起不来的话后面说什么都没用
        const changed = this.ensureServiceSetting()
        // 提示只挑最要紧的一条说，并**直接给路**：无障碍 > 使用情况访问 > 学习 App > 遮罩
        //（保险丝跳了就不提无障碍了 —— 那是这台机子起不来，不是用户没开）
        if (!changed) {
          if (!this.a11ySafe) {
            uni.showToast({ title: '这台手机的无障碍起不来，已改用使用情况访问', icon: 'none' })
          } else if (!this.a11yOk) {
            // 原来这里只 toast 一句"建议开无障碍"，用户看完还是不知道去哪开 ——
            // 改成弹窗把路径说清并直接跳过去，这才是闭环。
            this.guideNextStep()
          } else if (!this.learnApps.length) {
            uni.showToast({ title: '还没登记学习 App，切哪都算离开', icon: 'none' })
          } else if (!this.overlayOk) {
            uni.showToast({ title: '可选：再开「显示在其他应用上层」做兜底', icon: 'none' })
          }
        }
      }
      forced.sync()
      this.refreshForceCap()
    },
    goApps() { safeNav('/pkgPlan/pages/apps/apps') },
    toggleOpt(key) {
      const next = !this.opts[key]
      this.opts[key] = next
      try {
        const st = settings.get()
        st.focus = Object.assign({ notify: true, sound: true, vibe: true, wakeLock: false, strict: false, fgservice: true, noise: '' }, st.focus || {})
        st.focus[key] = next
        settings.save()
      } catch (e) {}
      if (next && key === 'notify') notify.requestPermission()
    },
    // ---------- 白噪音 ----------
    toggleNoise() {
      const next = !this.noiseOn
      this.noiseOn = next
      this.saveNoise(next ? (this.noiseKind || 'rain') : '')
      if (!next) {
        ambient.stop()   // 关掉的瞬间就安静（下次开始专注前不会再响）
        return
      }
      // 开了却听不见，八成是媒体音量为 0 —— 与其让用户一头雾水，不如当场说清
      if (audio.quiet()) {
        uni.showToast({
          title: '系统媒体音量为 0，白噪音听不见 —— 请先按音量键调大',
          icon: 'none',
          duration: 3000
        })
      }
      this.syncAmbient()
    },
    pickNoise(k) {
      this.noiseKind = k
      if (!this.noiseOn) return
      this.saveNoise(k)
      this.syncAmbient()
    },
    /**
     * 让白噪音跟"现在这一刻的状态"对齐：专注进行中且开关开着 → 立刻响，否则立刻停。
     *
     * ⚠️ 以前只有 focus.start()（开始专注）这一条路会起声 —— 番茄跑到一半才开开关，
     *    要等**下一轮**才响，用户只会以为这个功能坏了。所以开关、切音色都得当场生效。
     * 休息不陪：口径与 utils/focus.js 一致（白噪音只陪专注，进休息就停）。
     */
    syncAmbient() {
      const on = this.noiseOn && this.active && !this.paused && !this.isRest;
      if (!on) { ambient.stop(); return; }
      const kind = this.noiseKind || 'rain';
      ambient.start(kind);
      // 播不出来是异步才知道的（onError 或"发起了但没响"） ——
      // 稍后回看一眼，把原因说给用户，别让他对着一个没声音的开关发呆。
      setTimeout(() => {
        if (ambient.current() !== kind) return;   // 期间又切走了，这条提示已过期
        const err = ambient.lastError();
        if (err) uni.showToast({ title: err, icon: 'none', duration: 3000 });
      }, 2800);
    },
    saveNoise(kind) {
      try {
        const st = settings.get()
        st.focus = Object.assign({ notify: true, sound: true, vibe: true, wakeLock: false, strict: false, fgservice: true, noise: '' }, st.focus || {})
        st.focus.noise = kind
        settings.save()
      } catch (e) {}
    },
    /**
     * 声音自检：一次把三类"没声音"的原因分开问清楚。
     *   ① 系统媒体音量为 0（最常见，安卓的播放器走 STREAM_MUSIC）
     *   ② 素材播不出来（路径/格式/播放器报错，带错误码）
     *   ③ 压根没走到播放（开关没开 / 状态机没调）
     */
    testSound() {
      uni.showToast({ title: '正在试听…', icon: 'none', duration: 1200 })
      audio.selfTest((r) => {
        const mv = r.volume
        const vTxt = mv ? '媒体音量 ' + mv.vol + '/' + mv.max : '读不到媒体音量'
        if (r.quiet) {
          uni.showToast({
            title: '媒体音量为 0 —— 请先按音量键调大，这是没声音最常见的原因',
            icon: 'none',
            duration: 3200
          })
          return
        }
        if (!r.play.ok) {
          uni.showToast({
            title: '播放失败（' + vTxt + '）：' + (r.play.code || r.play.err || '未知错误'),
            icon: 'none',
            duration: 3200
          })
          return
        }
        // advanced = 播放进度有没有往前走；走不动通常就是"播了但没真出声"
        const advTxt = r.play.advanced === false ? '（播放器进度没推进，可能没真出声）' : ''
        uni.showToast({
          title: '已响一声 · ' + vTxt + (r.play.via === 'tone' ? '（走的系统蜂鸣兜底）' : '') + advTxt,
          icon: 'none',
          duration: 3000
        })
      })
    },
    /** 震动自检：直接震一下，验证开关与权限是否真的通 */
    testVibe() {
      const ok = notify.vibrate()
      uni.showToast({ title: ok ? '应该震了一下' : '震不动（机型不支持或没权限）', icon: 'none', duration: 2200 })
    },
    /** 白噪音试听：播 4 秒当前音色，把"播不出来 / 媒体音量为 0"分开说清楚 */
    testNoise() {
      const k = this.noiseKind || 'rain'
      // 正在专注且已经在放同一路时，不用再叠一路：直接播报现状
      if (this.active && ambient.current() === k) {
        uni.showToast({
          title: ambient.lastError() || '正在播放中；若听不见，多半是媒体音量为 0',
          icon: 'none',
          duration: 2600
        })
        return
      }
      uni.showToast({ title: '正在试听 ' + (this.noiseKindName || k) + '…', icon: 'none', duration: 1500 })
      ambient.preview(k, 4000, (info) => {
        if (!info || !info.ok) {
          uni.showToast({
            title: '白噪音播不出来：' + ((info && (info.code || info.err)) || '未知原因'),
            icon: 'none',
            duration: 3000
          })
          return
        }
        if (audio.quiet()) {
          uni.showToast({ title: '试听已发起，但媒体音量为 0 —— 调大音量才听得见', icon: 'none', duration: 3000 })
          return
        }
        uni.showToast({ title: '试听完毕（' + (this.noiseKindName || k) + '）', icon: 'none', duration: 1800 })
      })
    },
    toggleStrict() {
      const next = !this.strictOn
      this.strictOn = next
      try {
        const st = settings.get()
        st.focus = Object.assign({ notify: true, sound: true, vibe: true, wakeLock: false, strict: false, fgservice: true, noise: '' }, st.focus || {}, { strict: next })
        settings.save()
      } catch (e) {}
      if (next) {
        this.usageOk = apptime.hasUsagePermission()
        if (!this.usageOk) {
          uni.showToast({ title: '还需开启使用情况访问权限', icon: 'none' })
        }
      }
      strict.sync()
    },
    openUsage() {
      apptime.openUsageSettings()
      setTimeout(() => { this.usageOk = apptime.hasUsagePermission() }, 1200)
    },
    fmtMMSS(sec) {
      sec = Math.max(0, Number(sec) || 0)
      const m = Math.floor(sec / 60)
      const s = sec % 60
      return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s)
    }
  }
}
</script>

<style>
.focus-page { display: flex; flex-direction: column; }

.focus-body { flex: 1; display: flex; flex-direction: column; align-items: center; padding-top: 30rpx; }

/* 开始按钮：空闲态的主操作，宽度固定，跟着计时环居中 */
.start-wrap { width: 100%; margin-top: 40rpx; display: flex; flex-direction: column; align-items: center; }
.start-btn { width: 86%; }
.start-sub { margin-top: 16rpx; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

.phase {
  font-size: 26rpx;
  letter-spacing: 4rpx;
  text-indent: 4rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
.phase-rest { color: #3b6d11; }

/* ===== 计时环 ===== */
.ring-wrap { margin-top: 50rpx; }
.ring {
  width: 480rpx; height: 480rpx;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.ring-inner {
  width: 420rpx; height: 420rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.82);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.82);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  box-shadow: 0 16rpx 48rpx rgba(23, 32, 26, 0.1);
  box-shadow: 0 16rpx 48rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.1);
}
.time {
  font-size: 96rpx; font-weight: 500;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-family: Georgia, "Times New Roman", serif;
  letter-spacing: 2rpx;
}
.task-title {
  margin-top: 16rpx;
  max-width: 320rpx;
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  text-align: center;
  /* 可点：给一点按下反馈，否则用户不知道这里能展开 */
  border-radius: 8rpx;
  padding: 4rpx 8rpx;
}

/* 展开态：多行显示（最多 3 行，再长仍省略 —— 圆盘里放不下整篇）。
   ⚠️ 3 行 + 时间号 ≈ 220rpx，仍在 420rpx 的圆内，不会把数字挤出去。 */
.task-title-open {
  white-space: normal;
  text-overflow: clip;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.task-title:active {
  background: rgba(23, 32, 26, 0.06);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
}

/* ===== 配置 ===== */
.config { margin-top: 60rpx; width: 86%; display: flex; flex-direction: column; align-items: center; }
.cfg-label { font-size: 24rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
.cfg-row { display: flex; flex-wrap: wrap; justify-content: center; margin-top: 20rpx; }
.cfg-opt {
  font-size: 26rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  padding: 12rpx 30rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
  margin: 8rpx;
}
.cfg-opt-on {
  color: #ffffff;
  background: #e4173d;
  background: var(--brand, #e4173d);
  border-color: transparent;
}
.bind-card {
  margin-top: 30rpx;
  display: flex; align-items: center;
  padding: 18rpx 26rpx;
  border-radius: 999rpx;
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  max-width: 100%;
}
.cfg-custom {
  border-style: dashed;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
.bind-txt {
  font-size: 24rpx;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bind-clear { margin-left: 16rpx; font-size: 30rpx; color: #98a19b; color: var(--ink-3, #98a19b); padding: 0 8rpx; }
.bind-prog {
  margin-left: 12rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tip {
  margin-top: 30rpx;
  font-size: 22rpx; line-height: 1.7;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  text-align: center;
}

/* ===== 严格模式开关 ===== */
.strict-card {
  margin-top: 40rpx;
  padding: 24rpx 26rpx;
  border-radius: 18rpx;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.55);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
}
.sr-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16rpx 0;
}
.sr-row:first-child { padding-top: 0; }
.sr-row:last-child { padding-bottom: 0; }
.sr-head { display: flex; align-items: center; justify-content: space-between; }
.sr-info { flex: 1; min-width: 0; padding-right: 20rpx; }
.sr-title { font-size: 27rpx; font-weight: 600; color: var(--ink-1, #17201a); }
/* 「试听 / 试一下」：紧跟标题后面，点一下就能自检（不是装饰，是真机上定位"没声音"的入口） */
.sr-try {
  margin-left: 14rpx; font-size: 22rpx; font-weight: 500;
  color: var(--brand-strong, #bb1332);
  padding: 4rpx 14rpx; border-radius: 999rpx;
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  border: 1rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.28);
}
.sr-try:active { background: rgba(var(--brand-rgb, 228, 23, 61), 0.2); }
.sr-sub { display: block; margin-top: 8rpx; font-size: 22rpx; line-height: 1.6; color: var(--ink-3, #98a19b); }
.sr-switch {
  width: 88rpx; height: 50rpx; border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.16);
  padding: 5rpx; box-sizing: border-box;
  display: flex; align-items: center; flex-shrink: 0;
  transition: background 0.18s ease;
}
.sr-switch-on { background: var(--brand, #e4173d); }
.sr-knob {
  width: 40rpx; height: 40rpx; border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.18);
  transition: transform 0.18s ease;
}
.sr-knob-on { transform: translateX(38rpx); }
.sr-warn {
  margin-top: 18rpx; padding: 14rpx 18rpx;
  border-radius: 12rpx;
  background: rgba(247, 144, 9, 0.14);
  font-size: 23rpx; line-height: 1.6; color: #b25e00;
}
/* 无障碍引导：它是"能不能真拦住"的关键，所以比一般提示更重一点（标题加粗 + 一行行动指引） */
.sw-block { display: block; }
.sw-head { display: block; font-weight: 600; font-size: 25rpx; color: #8a4a00; margin-bottom: 6rpx; }
.sw-body { display: block; }
.sw-go { display: block; margin-top: 6rpx; font-weight: 600; text-decoration: underline; }
/* 放行名单说明：强制模式"到底放行谁"必须写在脸上 */
.sr-note {
  margin-top: 18rpx;
  font-size: 22rpx; line-height: 1.7;
  color: var(--ink-3, #98a19b);
}
.sn-go { margin-left: 12rpx; color: var(--brand-strong, #bb1332); }
.noise-row { margin-top: 20rpx; justify-content: flex-start; }
.noise-row .cfg-opt { margin: 6rpx 8rpx 0 0; padding: 10rpx 26rpx; }

/* ===== 控制 ===== */
.ctrl { margin-top: 60rpx; display: flex; align-items: center; }
/* 运行态白噪音行：在"暂停/放弃"下面，开着表也能关 */
.run-noise {
  margin-top: 40rpx;
  display: flex; align-items: center;
  padding: 16rpx 30rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
}
.rn-label { font-size: 25rpx; color: #5a6560; color: var(--ink-2, #5a6560); }
.rn-kind {
  flex: 1;
  margin-left: 20rpx;
  font-size: 25rpx;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
}
.ctrl-btn {
  height: 96rpx;
  border-radius: 999rpx;
  font-size: 30rpx;
  font-weight: 500;
  letter-spacing: 2rpx;
  text-indent: 2rpx;
  display: flex; align-items: center; justify-content: center;
  margin: 0 16rpx;
}
.ctrl-main { width: 300rpx; }
.ctrl-ghost { width: 200rpx; }
.ctrl-btn::after { border: none; }
/* 正计时说明：环上那个 +MM:SS 是什么意思，必须写出来 ——
   不然用户只会以为"倒计时卡在 00:00 不动了" */
.over-hint {
  margin-top: 18rpx;
  font-size: 22rpx; line-height: 1.6;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  text-align: center;
}

/* ===== 完成态 ===== */
.after { margin-top: 60rpx; width: 86%; display: flex; flex-direction: column; align-items: center; }
.after-txt { font-size: 27rpx; color: #17201a; color: var(--ink-1, #17201a); text-align: center; }
.after-btn { margin-top: 24rpx; width: 100%; height: 92rpx; font-size: 29rpx; }

/* ===== 强制模式实时状态 ===== */
.force-strip {
  margin-top: 44rpx;
  width: 86%;
  display: flex; align-items: center; justify-content: center;
  padding: 14rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
}
.fs-dot {
  width: 12rpx; height: 12rpx; border-radius: 50%;
  margin-right: 14rpx;
  flex-shrink: 0;
  background: var(--brand, #e4173d);
}
.fs-txt {
  font-size: 22rpx; line-height: 1.5;
  color: var(--brand-strong, #bb1332);
  text-align: center;
}
/* 没开强制模式：灰掉。
   不能用"看不见"来表达没开 —— 用户正是靠这一行才知道有这个功能。 */
.force-strip.fs-off {
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
}
.force-strip.fs-off .fs-dot { background: var(--ink-3, #98a19b); }
.force-strip.fs-off .fs-txt { color: var(--ink-2, #5a6560); }
/* 开了但能力不全：琥珀。说"已就绪"是骗人，说"没开"也不对 —— 这是第三态 */
.force-strip.fs-weak {
  background: rgba(247, 144, 9, 0.12);
}
.force-strip.fs-weak .fs-dot { background: #f79009; }
.force-strip.fs-weak .fs-txt { color: #8a5800; }
.fs-act {
  flex-shrink: 0;
  margin-left: 14rpx;
  font-size: 22rpx; font-weight: 600;
  color: var(--brand-strong, #bb1332);
}

/* ===== 学习 App 入口（= 强制模式放行名单） =====
   专注期间唯一"允许离开"的去处，所以放在最下面、常驻可见。 */
.learn-dock {
  margin-top: 40rpx;
  width: 86%;
  padding: 22rpx 24rpx;
  border-radius: 18rpx;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.55);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
}
.ld-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 18rpx;
}
.ld-title { font-size: 25rpx; font-weight: 600; color: var(--ink-1, #17201a); }
.ld-more { font-size: 23rpx; color: var(--brand-strong, #bb1332); }
.ld-row {
  display: flex; flex-wrap: wrap;
  margin: 0 -8rpx;
}
.ld-item {
  width: 25%; box-sizing: border-box;
  padding: 8rpx;
  display: flex; flex-direction: column; align-items: center;
}
.ld-icon-img {
  width: 84rpx; height: 84rpx;
  border-radius: 22rpx;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.5);
}
.ld-icon {
  width: 84rpx; height: 84rpx;
  border-radius: 22rpx;
  display: flex; align-items: center; justify-content: center;
  font-size: 32rpx; font-weight: 600;
  color: var(--brand-strong, #bb1332);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.12);
}
.ld-name {
  margin-top: 12rpx;
  max-width: 100%;
  font-size: 21rpx;
  color: var(--ink-2, #5a6560);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ld-note {
  display: block;
  margin-top: 16rpx;
  font-size: 21rpx; line-height: 1.6;
  color: var(--ink-3, #98a19b);
}

.today-strip {
  margin-top: 70rpx;
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  display: flex; flex-direction: column; align-items: center; gap: 8rpx;
  padding-bottom: calc(60rpx + env(safe-area-inset-bottom));
}
</style>
