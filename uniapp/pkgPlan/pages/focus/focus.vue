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
            <text class="time">{{ fmtMMSS(remainSec) }}</text>
            <text class="task-title">{{ taskTitle }}</text>
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

      <!-- 运行态 / 暂停态 -->
      <view v-else class="ctrl">
        <button class="ctrl-btn ctrl-main" @tap="togglePause">{{ paused ? '继续' : '暂停' }}</button>
        <button class="ctrl-btn ctrl-ghost" @tap="confirmGiveUp">放弃</button>
      </view>

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

      <!-- 强制模式实时状态：真拉回了几次要看得见，不然用户会怀疑它到底有没有干活 -->
      <view v-if="forcedOn && active && !isRest" class="force-strip">
        <text class="fs-dot"></text>
        <text class="fs-txt">{{ forceLine }}</text>
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
import * as notify from '../../../utils/notify.js'
import * as ambient from '../../../utils/ambient.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

export default {
  components: { FloatNavbar },
  data() {
    return {
      minutesOptions: [15, 20, 25, 30, 45, 60],
      minutes: 25,
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
    isRest() {
      return !!(this.cur && this.cur.phase === 'rest')
    },
    phaseText() {
      if (this.finished) return '番茄完成'
      if (this.restDone) return '休息结束'
      if (!this.cur) return '准备开始'
      if (this.paused) return '已暂停'
      return this.isRest ? '休息中' : '专注中'
    },
    remainSec() {
      return this.cur ? this.cur.remainSec : this.minutes * 60
    },
    // conic-gradient 比例
    ringStyle() {
      const total = this.cur ? this.cur.totalSec : this.minutes * 60
      const remain = this.remainSec
      const pct = total > 0 ? Math.max(0, Math.min(1, 1 - remain / total)) : 0
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
    // 强制模式那行实时状态：说清楚"它现在到底在不在干、干了什么"
    forceLine() {
      if (!this.pullOk) return '强制模式开启中 · 当前包没有原生拉回能力，只能提醒'
      let s = this.a11yOk
        ? '强制模式生效中 · 无障碍已开启，离开立刻拉回'
        : '强制模式生效中 · 未开无障碍，切走有概率拉不回来（见上方提示）'
      if (this.forcedPulls > 0) s += ' · 已拉回 ' + this.forcedPulls + ' 次'
      if (this.forcedEscapes > 0) s += '（离开 ' + this.forcedEscapes + '/' + forced.maxEscapes() + '）'
      return s
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
    // 从首页"开始"进来：带 auto=1 就直接起表，不用再点一次"开始"。
    // 只认第一次进页面（onLoad），onShow 里起表会导致每次回前台都重置计时。
    this.__auto = !!(query && (query.auto === '1' || query.auto === 1))
    // 绑定了任务就用任务剩余量推荐时长（放最后：覆盖前面的默认值链）
    this.applySuggest()
  },
  onShow() {
    this.refreshToday()
    if (this.__auto) {
      this.__auto = false
      if (!focus.current()) this.beginFocus()
    }
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
    if (!this.cur || this.cur.paused || this.cur.phase !== 'focus') return false
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
      if (r.justFinished === 'focus') {
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
      const opt = this.presetTask
        ? { minutes: this.minutes, taskId: this.presetTask.taskId, goalId: this.presetTask.goalId, taskTitle: this.presetTask.title }
        : { minutes: this.minutes, taskTitle: '自由专注' }
      this.cur = focus.startFocus(opt)
      focus.setCfg({ focus: this.minutes })
      this.finished = false
      this.restDone = false
      strict.sync()
      forced.sync()
    },
    togglePause() {
      if (!this.cur) { this.beginFocus(); return }
      if (this.cur.paused) focus.resume()
      else focus.pause()
      this.cur = focus.current()
      strict.sync()
      forced.sync()
    },
    confirmGiveUp() {
      uni.showModal({
        title: '放弃这个番茄？',
        content: '满 1 分钟会按实际时长记录，但不算完成任务量。',
        confirmText: '放弃',
        confirmColor: '#E5484D',
        success: (r) => {
          if (r.confirm) {
            focus.giveUp()
            this.cur = null
            this.refreshToday()
            strict.sync()
            forced.sync()
          }
        }
      })
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
    clearPreset() { this.presetTask = null },
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
    /** 自由专注的任意时长：10-120 分钟 */
    customMinutes() {
      uni.showModal({
        title: '自定义专注时长',
        editable: true,
        placeholderText: '输入 10-120 的分钟数',
        success: (r) => {
          if (!r.confirm) return
          const n = Math.round(Number(r.content))
          if (!(n >= 10 && n <= 120)) {
            uni.showToast({ title: '请输入 10-120 的整数', icon: 'none' })
            return
          }
          if (this.minutesOptions.indexOf(n) < 0) {
            this.minutesOptions.push(n)
            this.minutesOptions.sort((a, b) => a - b)
          }
          this.minutes = n
        }
      })
    },
    /** 运行态切音色：立即生效（空闲态走 pickNoise 只存偏好） */
    cycleNoise() {
      uni.showActionSheet({
        itemList: this.noiseKinds.map(k => k.t),
        success: (r) => {
          const k = this.noiseKinds[r.tapIndex]
          if (!k) return
          this.noiseKind = k.k
          if (this.noiseOn) {
            this.pickNoise(k.k)
            ambient.stop()
            ambient.start(k.k)
          }
        }
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
        // 提示只挑最要紧的一条说：无障碍 > 使用情况访问 > 学习 App > 遮罩
        //（保险丝跳了就不提无障碍了 —— 那是这台机子起不来，不是用户没开）
        if (!this.a11ySafe) {
          uni.showToast({ title: '这台手机的无障碍起不来，已改用使用情况访问', icon: 'none' })
        } else if (!this.a11yOk) {
          uni.showToast({ title: '建议开「无障碍」，否则切走拉不回来', icon: 'none' })
        } else if (!this.learnApps.length) {
          uni.showToast({ title: '还没登记学习 App，切哪都算离开', icon: 'none' })
        } else if (!this.overlayOk) {
          uni.showToast({ title: '可选：再开「显示在其他应用上层」做兜底', icon: 'none' })
        }
      }
      forced.sync()
    },
    goApps() { uni.navigateTo({ url: '/pkgPlan/pages/apps/apps' }) },
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
      if (!next) ambient.stop()   // 关掉的瞬间就安静（下次开始专注前不会再响）
    },
    pickNoise(k) {
      this.noiseKind = k
      if (this.noiseOn) this.saveNoise(k)
    },
    saveNoise(kind) {
      try {
        const st = settings.get()
        st.focus = Object.assign({ notify: true, sound: true, vibe: true, wakeLock: false, strict: false, fgservice: true, noise: '' }, st.focus || {})
        st.focus.noise = kind
        settings.save()
      } catch (e) {}
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
