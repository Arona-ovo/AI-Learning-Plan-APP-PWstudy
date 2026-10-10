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
        </view>
        <view v-if="presetTask" class="bind-card">
          <text class="bind-txt">本次专注将计入：{{ presetTask.title }}</text>
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
            放行名单：PWstudy 本身 + 「学习 App」里登记为「学习」的 {{ learnAppCount }} 个 App
            <text class="sn-go" @tap="goApps">去管理 ›</text>
          </view>
          <view v-if="forcedOn && !usageOk" class="sr-warn" @tap="openUsage">
            需要「使用情况访问」权限才能判断你在用哪个 App，点这里去开启
          </view>
          <view v-else-if="forcedOn && !pullOk" class="sr-warn">
            当前跑的不是自定义基座 / 正式打包，原生拉回能力没打进包里 —— 现在只能提醒，拦不住
          </view>
        </view>
      </view>

      <!-- 运行态 / 暂停态 -->
      <view v-else class="ctrl">
        <button class="ctrl-btn ctrl-main" @tap="togglePause">{{ paused ? '继续' : '暂停' }}</button>
        <button class="ctrl-btn ctrl-ghost" @tap="confirmGiveUp">放弃</button>
      </view>

      <!-- 刚完成一个专注番茄：引导休息 -->
      <view v-if="finished" class="after">
        <text class="after-txt">完成 {{ lastMin }} 分钟专注，休息 {{ restMin }} 分钟吧。</text>
        <button class="btn-primary after-btn" @tap="startRestNow">开始休息</button>
        <button class="btn-ghost after-btn" @tap="startNextFocus">跳过休息，再来一个</button>
      </view>
      <!-- 刚完成休息 -->
      <view v-if="restDone" class="after">
        <text class="after-txt">休息结束，准备好开始下一个番茄了吗？</text>
        <button class="btn-primary after-btn" @tap="startNextFocus">再来一个番茄</button>
      </view>

      <view class="today-strip">
        今日 {{ todayMin }} 分钟 · {{ todayPomo }} 个番茄
      </view>

    </view>
  </view>
</template>

<script>
import * as pw from '../../../utils/pwstore.js'
import * as focus from '../../../utils/focus.js'
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
      todayMin: 0,
      todayPomo: 0,
      strictOn: false,
      forcedOn: false,    // 强制模式：离开学习 App 就当场拉回来
      usageOk: false,
      pullOk: false,      // 原生"拉回前台"能力在不在（自定义基座 / 正式包）
      learnAppCount: 0,   // 放行名单里登记为「学习」的 App 数
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
    restMin() {
      const cfg = pw.get().pomoCfg || {}
      return cfg.rest || 5
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
    // 从首页"开始"进来：带 auto=1 就直接起表，不用再点一次。
    // 只认第一次进页面（onLoad），onShow 里起表会导致每次回前台都重置计时。
    this.__auto = !!(query && (query.auto === '1' || query.auto === 1))
  },
  onShow() {
    this.refreshToday()
    if (this.__auto) {
      this.__auto = false
      if (!focus.current()) this.beginFocus()
    }
    this.cur = focus.current()
    if (this.cur && this.cur.phase === 'rest') {
      // 进入页面时已经在休息
      this.finished = false
    }
    this.strictOn = !!strict.enabled()
    this.forcedOn = !!forced.enabled()
    this.usageOk = apptime.hasUsagePermission()
    this.pullOk = !!forced.canPull()
    this.learnAppCount = this.countLearnApps()
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
      if (r.justFinished === 'focus') {
        const s = this.lastSession()
        this.lastMin = s ? s.min : (this.minutes || 25)
        this.finished = true
        this.restDone = false
        this.refreshToday()
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
      const cfg = pw.get().pomoCfg || {}
      this.cur = focus.startBreak(cfg.rest || 5)
      strict.sync()
    },
    startNextFocus() {
      this.finished = false
      this.restDone = false
      this.beginFocus()
    },
    clearPreset() { this.presetTask = null },
    countLearnApps() {
      try {
        return pw.dock().filter(a => a.purpose !== 'rest').length
      } catch (e) {
        return 0
      }
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
        this.usageOk = apptime.hasUsagePermission()
        this.pullOk = !!forced.canPull()
        this.learnAppCount = this.countLearnApps()
        if (!this.usageOk) {
          uni.showToast({ title: '还需开启使用情况访问权限', icon: 'none' })
        } else if (!this.learnAppCount) {
          uni.showToast({ title: '还没登记学习 App，切哪都算离开', icon: 'none' })
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
  background: #2e6bff;
  background: var(--brand, #2e6bff);
  border-color: transparent;
}
.bind-card {
  margin-top: 30rpx;
  display: flex; align-items: center;
  padding: 18rpx 26rpx;
  border-radius: 999rpx;
  background: rgba(46, 107, 255, 0.1);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.1);
  max-width: 100%;
}
.bind-txt {
  font-size: 24rpx;
  color: #1d4fd8;
  color: var(--brand-strong, #1d4fd8);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bind-clear { margin-left: 16rpx; font-size: 30rpx; color: #98a19b; color: var(--ink-3, #98a19b); padding: 0 8rpx; }
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
.sr-switch-on { background: var(--brand, #e11d48); }
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
/* 放行名单说明：强制模式"到底放行谁"必须写在脸上 */
.sr-note {
  margin-top: 18rpx;
  font-size: 22rpx; line-height: 1.7;
  color: var(--ink-3, #98a19b);
}
.sn-go { margin-left: 12rpx; color: var(--brand-strong, #1d4fd8); }
.noise-row { margin-top: 20rpx; justify-content: flex-start; }
.noise-row .cfg-opt { margin: 6rpx 8rpx 0 0; padding: 10rpx 26rpx; }

/* ===== 控制 ===== */
.ctrl { margin-top: 60rpx; display: flex; align-items: center; }
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

.today-strip {
  margin-top: 70rpx;
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  padding-bottom: calc(60rpx + env(safe-area-inset-bottom));
}
</style>
