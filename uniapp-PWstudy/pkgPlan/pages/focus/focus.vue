<template>
  <view class="container page-nav focus-page" :class="[appTheme, { 'fr-intro': ringIntro, 'fr-exit': ringExit, 'fr-hide': ringHide }]" :style="appBgStyle">
    <!-- 返回键跟着页面的 onBackPress 走同一套判定（强制模式按住人不放），
         所以挂 @before-back：页面当场否决时这次点击就不导航 -->
    <float-navbar title="专注" :back="true" @before-back="onNavBack" />

    <view class="focus-body">

      <!-- 阶段标签 -->
      <text class="phase" :class="{ 'phase-rest': isRest }">{{ phaseText }}</text>

      <!-- 计时环：conic-gradient 纯 CSS 实现（不用 Canvas，理由同打卡走势）。
           ★ 圆盘就是开始键（2026-10-25 用户拍板）：原来下面那颗「开始专注 N 分钟」
           按钮整体删掉 —— 页面里已经有时长选择，按钮纯粹是多余的一层。
           空闲态点圆盘任意处直接起表（播放轻跳 + 震动）；跑起来之后圆盘只是读数，
           点它不起表也不放弃（防误触）。 -->
      <view class="ring-wrap" @tap="onRingTap">
        <view class="ring" :style="ringStyle" :class="{ 'ring-pulse': ringPulse }" @animationstart="onIntroStart" @animationend="onIntroEnd">
          <view class="ring-inner">
            <!-- 转场红色叠层（2026-10-30 第四轮）：必须是**真实元素**。
                 原来它是 .ring-inner::after 伪元素，靠 transition: opacity 在收缩中淡出 ——
                 但华为系 WebView 上伪元素的 opacity 过渡不走，摘 fr-intro 那一帧粉色
                 直接消失，圆还剩 5~6 倍大、整屏从粉硬切成灰白（用户："衔接处还是不够丝滑"）。
                 换成真实 view 后走普通元素过渡，与 .ring 的 transform 同一条渲染路径。 -->
            <view class="ring-tint"></view>
            <!-- 正计时段：数字前面加个「+」，一眼看出这是"多坐了多久"而不是"还剩多久" -->
            <text class="time">{{ timeText }}</text>
            <!-- 任务名：单行截断，点一下展开（最多 3 行）。
                 圆盘里能放字的宽度只有 320rpx，长任务名一直被吃掉一半，
                 而它恰恰是"这一轮在为什么事计时"的唯一线索 —— 不可点等于没救。 -->
            <text
              class="task-title"
              :class="{ 'task-title-open': titleOpen }"
              @tap.stop="toggleTitle"
            >{{ taskTitle }}</text>
          </view>
        </view>
      </view>

      <!-- 空闲态：时长选择 + 任务提示（开始按钮已融进圆盘，见 onRingTap） -->
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
              <!-- 开关开着却没检测到授权 = 一条也拦不住。给个"重新检测"的出口，
                   别让用户只能对着一个打不开的开关干瞪眼（2026-10-24） -->
              <text v-else-if="o.key === 'blockNotif' && opts[o.key] && !notifOk" class="sr-try sr-try-warn" @tap.stop="recheckNotif">{{ $t('没检测到授权 · 点这里重新检测') }}</text>
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

        <!-- 严格模式：只在专注进行中生效，不计时的时候完全不动 -->
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
              <text class="sr-sub">专注时切到别的 App，立刻把 PWstudy 拉回前台；连续 3 次强行离开，本次专注作废</text>
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
          <view v-else-if="forcedOn && !overlayOk" class="sr-warn sw-block" @tap="openOverlay">
            <text class="sw-head">不开「显示在其他应用上层」，强制模式就是摆设</text>
            <text class="sw-body">安卓 10 起系统禁止应用从后台自己弹界面 —— 无障碍服务也一样会被拦，而且不报错：界面一直显示"已就绪"，实际一动不动。唯一能解开这道限制的是这个权限（官方豁免）。给了它，切走时会弹出拦截页把你带回计时页；没它，拉回和遮罩两条都使不上。小米/红米还要再开一次「后台弹出界面」（设置 → 应用设置 → 应用管理 → PWstudy）。</text>
            <text class="sw-go">点这里去开 · 在列表里找 PWstudy 打开开关 ›</text>
          </view>
        </view>
      </view>

      <!-- 正计时段：预设时长已经跑满，人还在继续 —— 这一屏只给「退出」，
           不再有暂停/放弃（专注本身早就跑完了，谈"放弃"是骗人）。
           强制拉回与违规判定也在这一刻停手（见 utils/forced.js / strict.js 的 overrun 分支）。 -->
      <view v-if="active && overrun" class="ctrl">
        <button class="ctrl-btn ctrl-main" @tap="exitOverrun">{{ $t('退出') }}</button>
      </view>

      <!-- 运行态 / 暂停态 -->
      <view v-else-if="active" class="ctrl">
        <button class="ctrl-btn ctrl-main" @tap="togglePause">{{ paused ? '继续' : '暂停' }}</button>
        <button class="ctrl-btn ctrl-ghost" @tap="confirmStop">{{ $t('结束') }}</button>
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

      <!-- 运行态工具条：内置计算器。
           学数学要按计算器是正当需求，切出去用系统计算器会被强制模式当成逃逸拉回来 ——
           与其给计算器开白名单（等于开一个"随便切"的口子），不如把它搬进来。 -->
      <view v-if="active" class="tool-row">
        <text class="tr-btn" @tap="calcOpen = true">{{ $t('计算器') }}</text>
      </view>

      <!-- 刚完成一个专注：引导休息 -->
      <view v-if="finished" class="after">
        <text class="after-txt">
          完成 {{ lastMin }} 分钟专注，{{ longNext
            ? '这是本轮第 ' + roundCount + ' 段专注 —— 来一段 ' + restMin + ' 分钟的长休吧'
            : '休息 ' + restMin + ' 分钟吧' }}。
        </text>
        <button class="btn-primary after-btn" @tap="startRestNow">开始休息</button>
        <button class="btn-ghost after-btn" @tap="startNextFocus">跳过休息，再来一个</button>
      </view>
      <!-- 刚完成休息 -->
      <view v-if="restDone" class="after">
        <text class="after-txt">休息结束，准备好开始下一段专注了吗？</text>
        <button class="btn-primary after-btn" @tap="startNextFocus">再来一段专注</button>
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

      <!-- 休息中：顺手记一句心得。番茄ToDo 在休息页放"点击此处填写心得"，
           我们放进台账（挂在刚落账的那段专注上），日后复盘看得到当时在想什么。 -->
      <view v-if="active && isRest" class="note-row" @tap="editNote">
        <text class="nr-label">{{ $t('心得') }}</text>
        <text class="nr-body" :class="{ 'nr-ph': !noteText }">{{ noteText || $t('写一句刚才的收获…') }}</text>
        <text class="nr-go">›</text>
      </view>

      <view class="today-strip">
        <text v-if="taskProg" class="ts-prog">{{ taskProg }}</text>
        <text>今日 {{ todayMin }} 分钟 · {{ todayPomo }} 段专注</text>
        <text v-if="streakDays > 1" class="ts-streak">{{ streakText }}</text>
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
      :maxlength="dlg.maxlength"
      :items="dlg.items"
      :seq="dlg.seq"
      :btn-mode="dlg.btnMode"
      :confirm-countdown="dlg.countdown"
      @confirm="onDlgYes"
      @cancel="onDlgCancel"
      @input="onDlgInput"
    />

    <focus-calc :show="calcOpen" @close="calcOpen = false" />
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
import { tick as hapticTick } from '../../../utils/haptic.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../../components/app-dialog/app-dialog.vue'
import FocusCalc from '../../../components/focus-calc/focus-calc.vue'

export default {
  components: { FloatNavbar, AppDialog, FocusCalc },
  data() {
    return {
      minutesOptions: [15, 20, 25, 30, 45, 60],
      minutes: 25,
      // 圆圈衔接转场：从首页大圆点进来（?zoom=1）时，ring 先处于"放大盖满全屏"
      // 态，两帧后移除 ringIntro 缩回就位 —— 与首页圆放大退出是同一视觉主体。
      ringIntro: false,
      // 转场期间把**整页内容**（圈内读数/任务名 + 圆外所有内容）藏起来，
      // 等圆真正落位再统一淡入。★ 2026-10-30 真机录屏实锤：原来圈内文字
      // 200ms 就跟着淡入，可华为系 WebView 会把 fr-ring-drop 整条 keyframes 丢掉，
      // 圆定格在 4.5 倍直到 600ms 兜底才由 transition 收缩 —— 那 400ms 里
      // 「60:00」「背第1批…」被撑成一屏巨字。现在改由 JS 量"圆落位了"再摘 fr-hide，
      // 任何设备上都不会再有放大的字。
      ringHide: false,
      // 点出转场：圆放大盖满屏再 navigateBack(none)，首页那颗圆接着缩回就位
      // （2026-10-29；与这个页面的 fr-intro 是同一段动画的正反两遍）
      ringExit: false,
      // 是不是从首页大圆（zoom=1）点进来的。不是的话没有"同一个视觉主体"可衔接，
      // 点出就退回系统动画 —— 硬播放大反而会从圆的原地炸开，莫名其妙。
      zoomIn: false,
      // 点圆盘起表的反馈：跳一下（ring-pulse 动画）+ 震一下（haptic）
      ringPulse: false,
      titleOpen: false,      // 圆盘里的任务名是否展开（默认单行，点一下展开到 3 行）
      presetTask: null,      // {taskId, goalId, title}
      cur: null,
      finished: false,
      restDone: false,
      lastMin: 0,
      // 本轮专注进度与下一段休息时长（长休按"第几段专注"触发，所以要显示出来）
      roundCount: 0,
      longNext: false,
      restMin: 5,
      todayMin: 0,
      todayPomo: 0,
      streakDays: 0,     // 连续专注天数（番茄ToDo 那个"连续专注 N 天"）
      noteText: '',      // 休息页的心得（挂在刚落账的那段专注上）
      quotaOk: false,    // 已通过退出配额确认（紧接着的二选一才作数）
      exitKinds: [],     // 二选一菜单项对应的动作（void / early），与 items 一一对应
      calcOpen: false,   // 内置计算器（学数学不用切走 —— 切走会被强制模式当成逃逸）
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
      opts: { notify: true, sound: true, vibe: true, fgservice: true, blockNotif: false, autoRest: true },
      notifOk: false,   // 「通知使用权」实际授没授（拦截通知那条开关靠它说真话）
      optRows: [
        { key: 'notify', title: '通知提醒', sub: '结束后发通知，专注中在状态栏显示剩余时间' },
        { key: 'fgservice', title: '后台保活', sub: '计时期间常驻前台服务，息屏也不中断（需正式打包/自定义基座生效）' },
        // 番茄ToDo 同款（2026-10-15 视频）：专注期间把别家通知收起来，结束汇总发还
        { key: 'blockNotif', title: '拦截通知', sub: '专注期间收起别家 App 的通知，结束汇总发给你（需「通知使用权」）' },
        { key: 'autoRest', title: '自动进休息', sub: '专注跑完后直接开始休息，不再停在完成面板上' },
        { key: 'sound', title: '结束响铃', sub: '专注结束时响一声' },
        { key: 'vibe', title: '震动', sub: '专注结束时震一下' }
      ],
      noiseKind: 'rain',
      noiseOn: false
    }
  },
  computed: {
    // 音色名走 $t：字面量数组在 i18n init 前就求值了 —— 切英文不会重算，
    // 还会被 check-i18n 算成漏网的静态中文。名单与 utils/ambient.js 的 KINDS 对齐。
    noiseKinds() {
      return [
        { k: 'white', t: this.$t('白噪') },
        { k: 'pink', t: this.$t('粉噪') },
        { k: 'brown', t: this.$t('棕噪') },
        { k: 'rain', t: this.$t('雨声') },
        { k: 'beach', t: this.$t('沙滩') },
        { k: 'clock', t: this.$t('时钟滴答') }
      ]
    },
    active() {
      return !!this.cur
    },
    paused() {
      return !!(this.cur && this.cur.paused)
    },
    /** 预设时长已跑满、正在正计时（专注闹钟的做法：到点不赶人走） */
    overrun() {
      return !!(this.cur && this.cur.overrun)
    },
    overSec() {
      return this.cur ? (Number(this.cur.overSec) || 0) : 0
    },
    isRest() {
      return !!(this.cur && this.cur.phase === 'rest')
    },
    /** 连续专注天数（>1 才显示）。带占位符的文案走 t()，不新增静态中文 */
    streakText() {
      void this.__lang      // 建立语言依赖，切语言要跟着重算
      return t('连续专注 {n} 天', { n: this.streakDays })
    },
    phaseText() {
      // 正计时与"完成面板"共用这一档：专注本身跑满了，区别只在于人还在继续
      //（写成两个分支会多出一条静态中文，i18n 阈值正卡满 —— 能省就省）
      if (this.finished || this.overrun) return '专注完成'
      if (this.restDone) return '休息结束'
      // 空闲态这行是**唯一的起表提示**（开始按钮已融进圆盘）：写成动作而不是状态，
      // 人一看就知道点哪儿。phaseText 的消费方统一走 $t，译文在 i18n-en。
      if (!this.cur) return '点圆盘开始'
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
      const st = {
        // ⚠️ 这条纯色必须先写：老安卓 WebView 认不出 conic-gradient 时会**整条丢掉**
        //    background 简写（不抛错、不回落），圆环当场消失 —— 有它兜着，至少还有
        //    一圈灰环在，不会被当成"圆盘坏了"。
        backgroundColor: 'rgba(23,32,26,0.08)',
        background: 'conic-gradient(' + c1 + ' ' + deg + 'deg, rgba(23,32,26,0.08) ' + deg + 'deg)'
      }
      // ⚠️ 别把 intro 的放大起点写成行内 transform（2026-10-29 真机实锤后删除）：
      //   曾经是"老内核 var() 不稳"的双保险，但行内值的移除要走逻辑层→视图层的桥，
      //   和 fr-intro class 的摘除**未必同帧到达** —— class 已摘（皮肤变白、文字显现），
      //   行内 transform 还钉在 coverScale 上，于是巨字定格在满屏圆上；等 style 消息
      //   到了又触发一次 transition 重播。transform 只留 CSS class 这一个来源，
      //   摘 class = 放大态当帧消失，没有第二条通路。
      return st
    },
    taskTitle() {
      if (this.cur) return this.cur.taskTitle || '自由专注'
      if (this.presetTask) return this.presetTask.title
      return '自由专注'
    },
    /**
     * 当前关联任务的进度一句话：任务进度 + 剩余量折算分钟。
     * 让"计时"和"计划"看得见是同一件事 —— 只显示任务名的话，
     * 用户不知道这个任务还要来几段专注、今天专注算不算数。
     */
    taskProg() {
      const t = this.presetTaskObj()
      if (!t) return ''
      const done = t.donePomos || 0
      const total = t.pomos || 1
      const remain = Math.max(0, total - done)
      const len = pacing.focusLen()
      return '任务 ' + done + '/' + total + ' 专注 · 还剩 ' + remain + ' 个 ≈ ' + (remain * len) + ' 分钟'
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
      // ⚠️ 这里原来是"去开「无障碍」"—— 错的，而且它让用户把力气花在没用的地方。
      //    无障碍服务是我们自己的组件，不在官方豁免里"被另一个可见应用绑定"那一类，
      //    它内部 startActivity 一样被拦。真正能让 startActivity 放行的只有
      //    「显示在其他应用上层」（官方豁免清单里明列的一条）。
      else if (!c.canPullBack) s = '看得出你切走了，但拉不回来 —— 去开「显示在其他应用上层」'
      // 「全都配好了、也确实发现你切走了，却一次都没拉回来」——
      // 这比"没配好"更该说破：它意味着原生那几条 startActivity 全被系统**静默**拦掉了
      // （不抛异常，所以 pullSelf 一直返回成功，界面也一直以为自己得手）。
      // 以前这里直接落到"已就绪"，于是界面永远说好话、真机永远没反应。
      else if (this.forcedEscapes > 0 && this.forcedPulls === 0) s = '已经发现你切走了，但一次都没拉回来 —— 点右侧自检'
      else s = '已就绪 · 离开立刻拉回'
      if (this.forcedOn) {
        if (this.forcedPulls > 0) s += ' · 已拉回 ' + this.forcedPulls + ' 次'
        if (this.forcedEscapes > 0) s += '（离开 ' + this.forcedEscapes + '/' + forced.maxEscapes() + '）'
      }
      return s
    },
    /** 状态条右侧的行动：没就绪时给一条最短的路，就绪了就给自检 */
    forceAct() {
      if (!this.forcedOn) return '开启'
      const c = this.forceCap
      if (!c.native) return ''
      if (!c.svcAllowed) return '去开'
      if (!c.canDetect || !c.canPullBack) return '去授权'
      // 全绿也给自检入口：这个链十几环，"界面说已就绪、真机一动不动"已经来回好几轮，
      // 让用户能一键把每一环的实测值交出来，别再靠猜。
      return '自检'
    },
    /**
     * 自检读数串。
     *
     * 刻意写成 key=value 的英文短串而不是一行行中文：① 不占 i18n 额度（阈值已经卡满）；
     * ② 它就是给排查用的原始读数，中文包装反而会漏信息。
     */
    diagLine() {
      const d = forced.diag()
      if (!d) return 'watchdog unavailable'
      const y = (v) => (v ? 'Y' : 'N')
      return 'svc=' + y(d.svc) + ' watch=' + y(d.watch) +
        '\nsrc=' + (d.src || '-') + ' fg=' + (d.fg || '-') +
        '\nepisode=' + y(d.episode) + ' tries=' + d.tries + ' blind=' + d.blind +
        '\npulls=' + d.pulls + ' escapes=' + d.escapes + ' allow=' + d.allowN +
        '\novGrant=' + y(d.ovGrant) + ' ovWanted=' + y(d.ovWanted) + ' ovOn=' + y(d.ovOn) +
        '\na11y=' + y(d.a11y) + ' ev=' + d.a11yEv + ' tripped=' + y(d.tripped)
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
    // ★ 圆圈衔接转场（zoom=1，首页 quickStart 带过来）：ring 从"放大盖满全屏"
    //   态缩回就位。放大倍数写死 4.5（2026-10-29：华为 WebView 会把 @keyframes
    //   里的 var(--cover-scale) 整条丢弃，收缩动画直接不跑，圆定格在放大态 ——
    //   真机实锤，详见 fr-ring-drop 注释）；盖满屏之后 4.5 和精确值视觉无差别。
    if (query && query.zoom) {
      this.ringIntro = true
      this.zoomIn = true
      this.ringHide = true
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
    // 点出转场复位：还没退栈、只是被别的页面盖住又回来时，圆不能停在放大态
    clearTimeout(this._exitT); this._exitT = null
    this._leaving = false
    this.ringExit = false
    // 内容让位的兜底复位（2026-10-30）：不在转场里（ringIntro 已摘）却还藏着，
    // 说明上一次转场中途被切走、定时器被 onHide 清了 —— 立刻放出来，
    // 别让整页文字永久隐身（这类"藏了没人放"是最难查的坑）。
    clearTimeout(this._ringKfT); this._ringKfT = null
    clearTimeout(this._ringHideT); this._ringHideT = null
    if (!this.ringIntro) this.ringHide = false
    // ★ 圆圈衔接转场收尾（收缩动画由 CSS animation 自播放，armIntro 只挂
    //   animationend 收口 + 兜底定时器 —— 为什么不能用 rAF/exec 当上屏信号，
    //   见 armIntro 的注释。
    //   ⚠️ 整段包 try：armIntro 炸了也不能把后面的 refresh 拖下水（项目保命姿势）。）
    try { this.armIntro() } catch (e) { this.ringIntro = false }
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
    // （失效在这里同步做，实测本身延到 deferredChecks —— intro 别被拖住）
    if (this.__fromA11y) {
      this.__fromA11y = false
      apptime.refreshA11y()
    }
    // ★ 转场期间 onShow 只做"首屏就要画"的轻活（10-27，真机视频实锤）：
    //   原生权限实测（usage/overlay/pull/a11y）、学习 App 图标读取、强制能力
    //   盘点这些都是几十上百毫秒级的同步调用，排在 onShow 里会拖住首帧渲染
    //   —— 症状就是"首页圆放大后整个屏幕冻住一秒多，专注页直接弹出没有
    //   收缩动画"（电脑上这几毫秒看不出来，手机上是一整段定格）。
    //   这些读数都喂给首屏折叠线以下的强制模式状态区，晚 320ms 补上没人看得见。
    clearTimeout(this._deferT)
    this._deferT = setTimeout(() => {
      this._deferT = null
      try { this.deferredChecks() } catch (e) {}
    }, 320)
    try {
      const f = (settings.get() && settings.get().focus) || {}
      this.opts = {
        notify: f.notify !== false,
        fgservice: f.fgservice !== false,
        sound: f.sound !== false,
        vibe: f.vibe !== false,
        blockNotif: !!f.blockNotif,
        autoRest: f.autoRest !== false
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
    // 转场 probe / 延迟体检必须跟着收：页面都切走了，定时器不该还留着
    // （probe 是兜底摘 intro 的那颗；defer 是补跑原生权限实测的那颗 ——
    //   下次 onShow 会重新挂，这里清掉只是防"切走后还回来改状态"）
    clearTimeout(this._introProbeT); this._introProbeT = null; this._introDone = null
    clearTimeout(this._introFadeT); this._introFadeT = null
    clearTimeout(this._ringKfT); this._ringKfT = null
    clearTimeout(this._ringHideT); this._ringHideT = null
    clearTimeout(this._deferT); this._deferT = null
    // 注意：严格模式故意不在这儿停 —— 人切走才是它该干活的时候
  },
  onUnload() {
    this.stopTick()
    clearTimeout(this._introProbeT); this._introProbeT = null; this._introDone = null
    clearTimeout(this._introFadeT); this._introFadeT = null
    clearTimeout(this._ringKfT); this._ringKfT = null
    clearTimeout(this._ringHideT); this._ringHideT = null
    clearTimeout(this._deferT); this._deferT = null
    clearTimeout(this._exitT); this._exitT = null
  },
  // 强制模式 + 正在专注：返回不放行。不然"按一下返回就出去了"，模式等于没有。
  // 暂停 / 休息阶段照常放行 —— 拦人是为了专注，不是把人困死。
  // ⚠️ 判定只写这一份：物理返回键（onBackPress）与顶栏返回键（onNavBack）共用，
  //    不然会出现"按返回被按住、点左上角却能跑出去"的窟窿。
  onBackPress() {
    // ★ 本页自己发起的退栈（playExit → leaveNow）会**再触发一次** onBackPress。
    //   这里必须放行（return false），否则下面那句 return true 会把这次导航原样否掉：
    //   圆放大 → 被否掉 → 再放大，240ms 一轮的死循环，人永远退不出去，圆最后焊在放大态
    //   （2026-10-29 真机实锤：点返回后闪跳约 4 次/秒，3 秒后仍停在整屏粉色大圆上）。
    if (this._leaving) return false
    // 强制模式按住：照旧当场否掉
    if (this.backBlocked()) {
      this.sayBlocked()
      return true
    }
    // 其余情况**由本页接管返回**（return true 挡掉系统的裸退），先把圆放大盖满屏，
    // 240ms 后再真的退 —— 首页那颗圆从同一放大态缩回就位（见 playExit）。
    // 不接管的话：系统窗口动画把人送走，首页那一帧是一整块盖满屏的粉色然后弹回去。
    this.playExit()
    return true
  },
  methods: {
    /** 强制模式正在计时：这会儿不许离开本页（暂停 / 休息 / 正计时都放行） */
    backBlocked() {
      if (!this.forcedOn) return false
      if (!this.cur || this.cur.paused || this.cur.overrun || this.cur.phase !== 'focus') return false
      return true
    },

    /** 被拦住时说一句（物理返回键与顶栏返回键共用，不许各写一句） */
    sayBlocked() {
      uni.showToast({ title: '强制模式：先把这段专注跑完', icon: 'none' })
    },

    /**
     * 顶栏返回键的否决口：导航栏点返回时同步问一次，被拦就当场否决。
     * ⚠️ 顶栏那个键走的是 uni.navigateBack，**绕不开页面的 onBackPress** ——
     *    少了这一层，"强制模式按住的人"点一下左上角就跑了。
     */
    onNavBack(veto) {
      if (this.backBlocked()) {
        this.sayBlocked()
        if (typeof veto === 'function') veto()
        return
      }
      // 没被拦：**否决导航栏自己的 navigateBack**（它绕过页面、也不播动画），
      // 改由本页 playExit 先放大圆再退 —— 与物理返回键同一条路，
      // 不然"点左上角"和"按返回键"出来的动画是两套。
      this.playExit()
      if (typeof veto === 'function') veto()
    },

    /**
     * 点出转场（2026-10-29）：圆放大盖满屏 → 240ms 后 navigateBack(none)。
     * 首页那颗大圆此刻停在 coverScale 上（点进留下的），接手缩回就位
     * （home.vue 的 startRingReturn / .ring-return）—— 点进点出是同一段动画的正反两遍。
     * ⚠️ animationType:'none' 与点进那边同一个理由：系统窗口动画会和缩放各跑各的。
     * ⚠️ 240ms = fr-ring-rise 爬到 coverScale 的 keyframe（34% × 700ms，之后是
     *    盖住导航黑洞的长尾；改一处要改两处）。
     */
    playExit() {
      if (this._exitT) return        // 连点只退一次
      // 不是从首页大圆点进来的（没有 zoom=1）：没有"同一个圆"可衔接，
      // 硬播放大只会从圆的原地炸开一屏粉，比系统动画更难懂 —— 直接退。
      if (!this.zoomIn) {
        this.leaveNow(false)
        return
      }
      // intro 还没播完就按返回：圆本来就盖满着全屏，不必再放大一遍
      //（那时 .fr-intro 和 .fr-exit 会抢同一条 animation，圆会先弹回 1 倍再放大 = 闪一下）
      if (this.ringIntro) {
        this.leaveNow()
        return
      }
      this.ringExit = true
      this._exitT = setTimeout(() => {
        this._exitT = null
        // ★ 兜底**先挂上，再去导航**（2026-10-29）。原来是先 leaveNow 再挂兜底：
        //   leaveNow 里一旦抛异常，那行兜底就永远执行不到 —— .fr-exit 焊死在根节点上，
        //   圆停在 coverScale、整页内容 opacity:0，人就被困在一块盖满屏的粉色里。
        this._exitT = setTimeout(() => {
          this._exitT = null
          // 能跑到这里说明**页面还在**（真退成了的话 onUnload 早把定时器清掉了）：
          // 说明前面那次导航没成 —— 先把视觉复位，再补退一次，别让人停在放大态。
          this.ringExit = false
          this._leaving = false
          if (this.stillTop()) this.leaveNow(false)
        }, 900)
        this.leaveNow()
      }, 240)
    },
    /** 本页现在是不是还在栈顶（补退前要确认，否则会把盖在上面的那一页退掉） */
    stillTop() {
      const pages = (typeof getCurrentPages === 'function' ? getCurrentPages() : []) || []
      if (pages.length <= 1) return false
      const top = pages[pages.length - 1] || {}
      return top.route === 'pkgPlan/pages/focus/focus'
    },
    /**
     * 真的退出去。
     * @param {boolean} [silent] 关掉系统窗口动画（点出转场用 none，好让首页那颗圆接手；
     *   没有 zoom（不是从首页大圆进来的）就别用 none，保持系统默认的退栈动画）
     * ⚠️ 这一页也可能是栈底（从通知 / 外部链接直接进来的），那时 navigateBack
     *    原地不动、人就被困在一块盖满屏的粉色上 —— 那就回首页。
     */
    leaveNow(silent) {
      const pages = (typeof getCurrentPages === 'function' ? getCurrentPages() : []) || []
      // ★ 打"自发导航"标记（2026-10-29）：navigateBack 会再进一次 onBackPress，
      //   那里见到 _leaving 必须放行，否则会把自己这次导航否掉（死循环，见 onBackPress 顶部）。
      this._leaving = true
      if (pages.length > 1) {
        try {
          if (silent === false) uni.navigateBack({ delta: 1 })
          else uni.navigateBack({ delta: 1, animationType: 'none' })
        } catch (e) {
          // 个别基座不认 animationType（参数校验失败会直接抛）：别把人留在原地，
          // 退回不带参数的那次调用 —— 窗口动画难看一点，但至少真的退出去。
          try { uni.navigateBack({ delta: 1 }) } catch (e2) {}
        }
      } else {
        uni.switchTab({ url: '/pages/home/home' })
      }
    },

    /**
     * ★ 圆圈衔接转场的收尾（2026-10-27 重写 —— 下面这段历史要给后人留着，
     *   不然隔两个月又会有人把 rAF 那条路加回来）：
     *
     *   要不要保留的机会成本笔记（10-26 那版的三条信号竞速）：
     *    同一帧"加上又摘掉"class，浏览器不会跑 transition（圆闪一下直接归位），
     *    所以当时要用 rAF ×2 / selectQuery.exec / setTimeout 三条信号竞速来"延后
     *    一帧摘"。但 **App 端新页面自带窗口动画**：首页圆放大 260ms 后 navigateTo，
     *    新 webview 已经跑起来但还没真正可见 —— 那些信号回调到得比"人看见页面"
     *    早，过渡在不可见的那段里就跑完了（观感＝点开圆卡半拍然后直接弹出）。
     *    这就是"安卓基座不对劲、电脑端正常"的来处。
     *
     *   10-27 的办法是把这件事彻底交给浏览器：收缩写成 CSS animation **自播放**
     *   （起跑点焊在首帧上，不依赖任何 JS 信号），JS 只负责"播完摘掉 class"。
    /**
     * 圆圈衔接转场的收尾（10-27 重写，真机视频实锤）：
     * 收缩动画本身由 CSS animation **自播放**（起跑点焊在首帧上，见
     * .fr-intro .ring 的注释）—— 这里只负责"播完把 intro 摘掉"：
     * 主路径是 .ring 上的 animationend（模板 @animationend="onIntroEnd"），
     * 兜底定时器 600ms：老内核不认 keyframes 时 animationend 永远不来，
     * 摘掉 class 退回 transition 收缩那条旧路，不能让圆永久盖着屏幕。
     * ⚠️ 千万别再拿 rAF / selectQuery.exec 当"上屏信号"提前摘 intro：
     *    App 端是渲染先行、上屏在后，信号到达时人还没看见页面 —— intro
     *    被提前摘掉，看到的就是"首页圆放大后定格一秒、专注页整个弹出"，
     *    收缩动画整个被吞（2026-10-27 用户录屏逐帧核对）。
     */
    armIntro() {
      if (!this.ringIntro) return
      const self = this
      this._ringKfStarted = false
      this._introDone = () => {
        if (!self.ringIntro || !self._introDone) return
        self._introDone = null
        self.ringIntro = false
        clearTimeout(self._introProbeT)
        self._introProbeT = null
        clearTimeout(self._ringKfT)
        self._ringKfT = null
        // ★ 内容等圆真正落位再淡入（2026-10-30 真机录屏实锤）。
        //   两条路耗时不同：关键帧真跑了 → 圆已到 1 倍，稍等即可；
        //   关键帧没跑（华为系丢掉 fr-ring-drop）→ 摘 fr-intro 才触发 transition
        //   从 4.5 缩到 1，要等这 260ms 走完，否则文字又跟着放大成巨字。
        // ⚠️ 兜底路径的 wait 要贴着收缩时长（260ms）走（2026-10-30 掉帧反馈）：
        //   原来写 300，圆落位后还要空等约 0.3s 才轮到「60:00」淡入 —— 用户感觉
        //   "到显示时间这一段卡"。改成 260：圆刚落位数字就起淡入，无缝接上。
        //   关键帧路径圆本来就已落位，40ms 足够。
        const wait = self._ringKfStarted ? 40 : 260
        clearTimeout(self._ringHideT)
        self._ringHideT = setTimeout(() => {
          self._ringHideT = null
          self.ringHide = false
        }, wait)
      }
      // ★ 关键帧看门狗（2026-10-30）：华为系 WebView 会把 fr-ring-drop 这条
      //   animation **整条丢弃**（真机录屏：圆定格在 4.5 倍整整 600ms，才由
      //   600ms 兜底摘 intro、用 transition 补一次收缩）。这里 150ms 内没收到
      //   animationstart 就判定"关键帧没起来"，立刻走 _introDone 让 base 的
      //   transition: transform 260ms 接管 —— 不再干等 600ms 那一大段定格。
      this._ringKfT = setTimeout(() => {
        self._ringKfT = null
        if (self._ringKfStarted || !self.ringIntro) return
        if (self._introDone) self._introDone()
      }, 150)
      this._introProbeT = setTimeout(this._introDone, 600)
    },
    /** .ring 的 animationstart：确认收缩关键帧真的起跑了（个别内核会整条丢弃） */
    onIntroStart(e) {
      if (e && e.animationName && e.animationName !== 'fr-ring-drop') return
      this._ringKfStarted = true
      clearTimeout(this._ringKfT)
      this._ringKfT = null
    },
    /** .ring 的 animationend：转场收缩播完了（ring-pulse 的 end 也会进来，
     *  但那时 intro 早摘了 —— _introDone 已置空，直接 return） */
    onIntroEnd(e) {
      if (!this._introDone || this._introFadeT) return
      // ★ 只认收缩那一条：.ring 上还挂着 ring-pulse，别拿它的 end 收口。
      //   （个别老内核不派发 animationName，那就按老规矩收，别把圆永久留在放大态。）
      if (e && e.animationName && e.animationName !== 'fr-ring-drop') return
      // 收缩 260ms 结束，class 再留 40ms 收个尾（内容已改由 fr-hide 控制，
      // 不再需要等圈内淡入走完 —— 那个"200ms 后淡入"正是巨字的来处）。
      this._introFadeT = setTimeout(() => {
        this._introFadeT = null
        if (this._introDone) this._introDone()
      }, 40)
    },
    /**
     * onShow 里延后的那批"重体检"（10-27 从 onShow 挪出来，见 onShow 注释）：
     * 原生权限实测 / 学习 App 图标 / 强制能力盘点。intro 播完（320ms）再补，
     * 读数都喂给折叠线以下的强制模式状态区，晚这一点没人看得见。
     * ⚠️ 从系统「通知使用权」页回来的那次要当场把开关打开（syncNotifOpt），
     *    延后 320ms 也成立 —— 那个开关在页面底部，本来就不在首帧里。
     */
    deferredChecks() {
      this.usageOk = apptime.hasUsagePermission()
      this.pullOk = !!forced.canPull()
      this.overlayOk = apptime.canDrawOverlays()
      if (this.__fromNotif) {
        this.__fromNotif = false
        this.syncNotifOpt()
      } else {
        this.notifOk = !!this.grantedNotif()
      }
      this.refreshA11y()
      this.refreshLearnApps()
      this.refreshForceCap()
    },
    refreshToday() {
      const ov = pw.overview()
      this.todayMin = ov.todayMin
      this.todayPomo = ov.pomo
      this.streakDays = pw.focusStreak()
      // 休息中的心得：挂在当前这段刚落账的专注上（没有就显示占位文案）
      const s = focus.lastSession()
      this.noteText = (s && s.note) || ''
    },
    /**
     * 本轮第几段专注 / 下一段是不是长休。
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
        // 专注刚跑完 → 本轮计数变了，下一段可能是长休，得马上重算
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
    /**
     * 点圆盘 = 起表（2026-10-25 用户拍板："把开始专注融入到圆圈里面，不需要单独的
     * Button 按钮。直接点击中间那个圆圈就可以了，并且同样要有跳动（略微的放大缩小）
     * 的动画，有震动。"）
     * 反馈先行：动画 + 震动在 beginFocus 之前就播出去 —— 后面 mayBeAskForced
     * 可能弹引导框，反馈不该等它。跑起来之后圆盘只是读数，点它不起表也不放弃。
     */
    onRingTap() {
      if (this.active) return
      this.ringPulse = true
      clearTimeout(this._pulseT)
      // 360ms 与 CSS 里 .ring-pulse 的动画时长对齐（改一处要改两处）
      this._pulseT = setTimeout(() => { this.ringPulse = false }, 360)
      hapticTick('switch')
      this.beginFocus()
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
      // 专注刚起：这时候问"要不要离开就拉回"最自然 —— 晚了就是人已经跑掉了
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
    /**
     * 结束当前专注：先决定"要不要受配额管"，再让人二选一。
     *
     * 为什么拆成两步（番茄ToDo 严格模式同款，视频里逐帧看到的就是这套）：
     *   ① 强制/严格模式开着时，"中途退出"是有额度的（每月 2 次），而且
     *      「确定」按钮要强制等 3 秒 —— 挡的是"一烦就点掉"那一下冲动；
     *   ② 过了配额才让选：放弃（零记录）还是提前完成（保住已坐的时间）。
     * 没开强制/严格模式就没有这道闸，直接给二选一 —— 不该拿额度去烦没开的人。
     */
    confirmStop() {
      this.quotaOk = false
      // 刚点开不到 1 分钟就结束：根本没开始学，直接作废（不占强制/严格额度、也没什么可记），
      // 不再给二选一 —— 短到没什么可记，问也问不出名堂。
      if (focus.usedSec() < 60) { this.askShortVoid(); return }
      if (!this.exitGuarded()) { this.askExitChoice(); return }
      const left = pw.exitQuotaLeft()
      if (left <= 0) {
        this.ask({
          title: t('本月的中途退出次数用完了'),
          content: t('严格模式下中途退出仍会如实记录已经坐出来的时长：选「结束并记录」任务不计入完成量，选「提前完成」则任务进度照算。'),
          btnMode: 'alert',
          confirmText: t('知道了'),
          action: 'quota-out'
        })
        return
      }
      this.ask({
        title: t('严格模式开启中，确定要中途退出？'),
        // 中途退出额度已不再消耗（≥1 分钟如实记账、<1 分钟直接作废都不占额度），
        // 所以这里不再显示"已退出/还可退出"的计数 —— 那串数字只会永远停在 0/2，纯误导。
        content: t('中途退出会如实记录已坐的时长：选「结束并记录」任务不计入完成量，选「提前完成」则任务进度照算。确定要退出吗？'),
        confirmText: t('确定退出'),
        cancelText: t('继续专注'),
        countdown: 3,
        danger: true,
        action: 'exit-quota'
      })
    },

    /** 强制模式或严格模式开着 = 中途退出要受管制 */
    exitGuarded() {
      return !!(this.forcedOn || this.strictOn)
    },

    /** 短会话（<1 分钟）：直接作废，不再给二选一（没什么可记，问也问不出名堂） */
    askShortVoid() {
      this.ask({
        title: t('本次专注不足 1 分钟'),
        content: t('不记录学习时长，本次作废。'),
        confirmText: t('作废并退出'),
        cancelText: t('继续专注'),
        danger: true,
        action: 'void-short'
      })
    },

    /**
     * 二选一（已坐满 1 分钟的真实专注）：结束并记录 / 提前完成。
     *
     * ⚠️ 不再提供"不计入学习时长（作废）"：那是 <1 分钟短会话的待遇（askShortVoid），
     *    真实的专注时间应当如实计入「今日专注分钟」—— 这是 App 的核心指标，
     *    若对长会话也开放作废，数据就能被人随意抹掉，指标就失去意义了。
     *    强制/严格模式的"中途退出额度"本来只针对作废；既然 ≥1 分钟不再作废，额度不再消耗。
     *
     * 两个选项都如实记录时长，区别只在任务是否达标：
     *   stop  = 结束并记录（记实际分钟，done=false，任务不计入完成量）
     *   early = 提前完成（记实际分钟，done=true，任务进度照算）
     */
    askExitChoice() {
      const items = [
        { label: t('结束并记录学习时长（任务未完成）') },
        { label: t('提前完成（任务达标）') }
      ]
      const kinds = ['stop', 'early']
      this.exitKinds = kinds
      this.ask({
        mode: 'sheet',
        title: t('请选择你的操作'),
        content: t('结束并记录 = 坐了多久记多久，但任务不算完成；提前完成 = 时长照记，任务进度照算。'),
        items: items,
        action: 'exit-choice'
      })
    },

    /**
     * 真结束（≥1 分钟路径）。两条路都如实记录时长，区别只在任务是否达标：
     *   stop  = focus.giveUp()    → 记实际分钟，done=false（任务不计入完成量）
     *   early = focus.finishEarly()→ 记实际分钟，done=true（任务进度照算）
     * ⚠️ 按下标不如按 kind：sheet 项与 kinds 严格一一对应，照下标写容易错位。
     */
    doExit(idx) {
      const kind = (this.exitKinds || [])[idx]
      const s = kind === 'stop' ? focus.giveUp() : focus.finishEarly()
      this.cur = null
      this.quotaOk = false
      this.refreshToday()
      this.refreshRound()
      strict.sync()
      forced.sync()
      if (!s) return                        // 理论上 ≥1 分钟不会落空，保险
      this.lastMin = s.min
      this.restDone = false
      if (this.autoRestOn()) this.startRestNow()
      else this.finished = true
    },

    /** 设置里的"专注跑完自动进休息"（默认开，番茄ToDo 就是这个节奏） */
    autoRestOn() {
      try {
        const st = settings.get()
        if (st && st.focus && typeof st.focus.autoRest === 'boolean') return st.focus.autoRest
      } catch (e) {}
      return true
    },

    /** 休息页写一句心得（挂在刚落账的那段专注上） */
    editNote() {
      this.ask({
        mode: 'input',
        title: t('写一句心得'),
        placeholder: t('刚才这段专注的收获…'),
        value: this.noteText,
        maxlength: 60,
        action: 'note'
      })
    },
    /**
     * 正计时收摊：专注早就跑满了，所以按「完整专注」落账（正计时那段一起算进去），
     * 然后才落到"完成"面板 —— 让人决定是去休息还是再来一个。
     */
    exitOverrun() {
      const s = focus.stopOverrun()
      this.cur = null
      this.titleOpen = false
      this.lastMin = s ? s.min : (this.minutes || 25)
      this.restDone = false
      this.refreshToday()
      this.refreshRound()
      strict.sync()
      forced.sync()
      // 设了"跑完自动进休息"就直接接上休息，不再停在"完成"面板上让人再点一次
      if (this.autoRestOn()) this.startRestNow()
      else this.finished = true
    },
    startRestNow() {
      this.finished = false
      // 必须走 startRest：只有它按"本轮第几段专注"决定短休还是长休。
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
     * 25 分钟的"标准专注"只对颗粒度负责，不对总量负责 —— 剩 3 段专注的任务
     * 推荐一次 60 分钟的深专注，剩 1 个就 25 分钟；但都夹在 15-60，
     * 超过 60 分钟的单次专注违背专注节奏，是"推荐值"而不是硬性值。
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
     * 专注闹钟类 App 的做法是"开始专注 = 锁住"，所以我们至少要问一次。
     */

    /** 开始专注时调：只在"没开 + 从没问过"时弹一次，别每轮都烦人 */
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
        // 确定按钮的强制等待秒数（退出严格模式这类动作挡的就是"一烦就点掉"）
        countdown: Math.max(0, Math.floor(Number(o.countdown) || 0)),
        btnMode: o.btnMode || 'confirm',
        maxlength: Math.max(1, Math.floor(Number(o.maxlength) || 24)),
        seq: ((this.dlg && this.dlg.seq) || 0) + 1,
        action: o.action || ''
      }
    },

    askForced() {
      this.ask({
        title: '要不要开启「离开就拉回」？',
        content: '开启后，在这段专注跑完之前切到别的 App，PWstudy 会立刻把你拉回来；连续强行离开 3 次，本次专注作废。它需要你再授权「无障碍」—— 安卓 10 起系统默认禁止应用从后台跳回前台，官方只给无障碍这类"由系统绑定的服务"开口子。',
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
      if (act === 'note') {
        const txt = String(v == null ? '' : v)
        focus.setNote(txt)
        this.noteText = txt
        return
      }
      if (act === 'goto-notif') {
        // 跳系统「通知使用权」设置页。⚠️ 跳不出去必须**说出来**：
        // 以前这里是 try 一把就完事，用户点了"去开启"却毫无反应 —— 就是那个"开不了"。
        this.__fromNotif = true
        let opened = false
        try { opened = !!fgsvc.openNotifSettings() } catch (e) { opened = false }
        if (!opened) {
          this.ask({
            title: t('没跳过去'),
            content: t('这个机型没有开放「通知使用权」设置页，PWstudy 跳不过去。可以自己找：系统设置 → 通知（有的机型叫「通知与控制中心」）→ 通知使用权，在里面打开「PWstudy 专注通知拦截」。找不到就说明这个机型不支持，拦截通知用不了，其它功能不受影响。'),
            confirmText: t('知道了')
          })
        }
        return
      }
      if (act === 'exit-quota') {
        this.quotaOk = true            // 过了配额这一关，紧接着的二选一才作数
        this.askExitChoice()
        return
      }
      if (act === 'quota-out') {
        this.askExitChoice()           // 额度用完：只剩"提前完成"那一项
        return
      }
      if (act === 'exit-choice') {
        this.doExit(Number(v))
        return
      }
      if (act === 'void-short') {
        // 短会话（<1 分钟）直接作废：分钟 / 任务进度 / 今日专注数一律不记
        focus.voidSession()
        this.cur = null
        this.refreshToday()
        this.refreshRound()
        strict.sync()
        forced.sync()
        return
      }
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
      // 选了"这次不用"也算问过了 —— 不记住的话下一轮专注又会弹
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
      if (!c.canDetect || !c.canPullBack) { this.guideNextStep(); return }
      // 走到这儿 = 配置全绿 → 点它就是自检（哪怕真没问题，也该能自证）
      this.refreshForce()
      this.ask({ title: '', content: this.diagLine, action: '' })
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
      // ⚠️ "已就绪"必须看 effective（四层全中），原来只看 c.a11y ——
      //    于是"开了无障碍、没开悬浮窗"时这里照样报"已就绪"，
      //    而实际上一条都拉不动。这是"界面说好了、真机没反应"的直接来源。
      if (c.effective) {
        uni.showToast({ title: '已就绪 · 切走会立刻拉回来', icon: 'none' })
        return
      }
      if (!c.svcAllowed) { this.ensureServiceSetting(); return }
      // 悬浮窗是**准入条件**而不是"可选兜底"：没有它，安卓 10+ 三条拉回路
      // 全被 AMS 静默拦掉（不抛异常，所以界面一直以为自己成功）。先补它。
      if (!c.overlay) {
        uni.showToast({ title: '还差「显示在其他应用上层」，不开拉不回来', icon: 'none' })
        setTimeout(() => this.openOverlay(), 900)
        return
      }
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
          // ⚠️ 顺序改过：悬浮窗从最后一位（"可选兜底"）提到第一位。
          //    它是强制模式的**准入条件** —— 没有它，安卓 10+ 三条拉回路全被静默拦掉，
          //    而界面还会因为"没抛异常"显示已就绪。以前把它排最后，用户看到的是
          //    "一句可有可无的建议"，于是从来没开过，于是永远拉不动。
          if (!this.overlayOk) {
            uni.showToast({ title: '还差「显示在其他应用上层」，不开拉不回来', icon: 'none' })
            setTimeout(() => this.openOverlay(), 900)
          } else if (!this.a11ySafe) {
            uni.showToast({ title: '这台手机的无障碍起不来，已改用使用情况访问', icon: 'none' })
          } else if (!this.a11yOk && !this.usageOk) {
            // 只 toast 一句"建议开无障碍"没用，用户不知道去哪开 ——
            // 改成弹窗把路径说清并直接跳过去，这才是闭环。
            this.guideNextStep()
          } else if (!this.learnApps.length) {
            uni.showToast({ title: '还没登记学习 App，切哪都算离开', icon: 'none' })
          }
        }
      }
      forced.sync()
      this.refreshForceCap()
    },
    goApps() { safeNav('/pkgPlan/pages/apps/apps') },
    /** 系统的「通知使用权」到底授没授（读写只有一处，别在页面里各处问） */
    grantedNotif() {
      try { return !!fgsvc.notifGranted() } catch (e) { return false }
    },
    /**
     * 拿系统实际状态对一次账：授权成功就顺手把开关打开。
     * 不在 onShow 里直接开是为了让"重新检测"也能复用同一段。
     */
    syncNotifOpt() {
      const g = this.grantedNotif()
      this.notifOk = g
      if (!g) return false
      if (!this.opts.blockNotif) {
        this.opts = Object.assign({}, this.opts, { blockNotif: true })
        try {
          const st = settings.get()
          st.focus = Object.assign({}, st.focus || {}, { blockNotif: true })
          settings.save()
        } catch (e) {}
        try { uni.showToast({ title: t('通知使用权已开启，拦截通知已打开'), icon: 'none' }) } catch (e) {}
      }
      return true
    },
    /** 手动"重新检测"：有的 ROM 授权后要隔几秒才写进系统表 */
    recheckNotif() {
      if (this.syncNotifOpt()) return
      this.askNotifAccess()
    },
    /**
     * 「通知使用权」没开：先讲清**怎么开**，再把系统那一页拉起来。
     * ⚠️ 老文案只说"需要这个权限"，用户点完"去开启"进了系统页却不知道要找哪一项、
     *    也不知道列表里没有时该怎么办 —— 那就是"拦截通知开不了"的体感来源。
     */
    askNotifAccess() {
      this.ask({
        title: t('拦截通知'),
        // ⚠️ 文案里不许写 \n：i18n 的 key 归一化会把真实换行折成空格，
        //    而护栏抽源码拿到的却是字面的 `\n` 两字符 —— 两边永远对不上（2026-10-24 已踩）
        content: t('专注期间把别家 App 的通知收起来（下拉通知栏也看不到），专注结束再汇总发给你。怎么开：下一步会跳到系统的「通知使用权」页，在列表里找到「PWstudy 专注通知拦截」，把它的开关打开。如果列表里没有 PWstudy：把 PWstudy 完全退出再重新打开一次（服务要重新注册），回来再点这个开关就行。'),
        confirmText: t('去开启'),
        action: 'goto-notif'
      })
    },
    toggleOpt(key) {
      // 拦截通知要「通知使用权」：没授权就不落开关，先带人去开 ——
      // 开关显示"开着"却一条也拦不住，是骗人的界面
      if (key === 'blockNotif' && !this.opts.blockNotif) {
        if (!this.grantedNotif()) {
          this.askNotifAccess()
          return
        }
      }
      const next = !this.opts[key]
      this.opts[key] = next
      try {
        const st = settings.get()
        st.focus = Object.assign({ notify: true, sound: true, vibe: true, wakeLock: false, strict: false, fgservice: true, noise: '', blockNotif: false, autoRest: true }, st.focus || {})
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
     * ⚠️ 以前只有 focus.start()（开始专注）这一条路会起声 —— 专注跑到一半才开开关，
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
/* ★ 点圆盘起表的反馈动画（2026-10-25 用户拍板"要有跳动的动画"）：
   略微放大缩小一跳（320ms）。
   必须用 keyframes 而不是 transition —— 点击一次只播**一轮**（1 → 1.045 → 1），
   transition 只会从 A 滑到 B 停住，回不去，那就不是"跳一下"而是"变大不回"。
   ⚠️ 与 .ring 常驻的 transform transition（圆圈衔接转场用）不冲突：animation
      播放期间优先级高于 transition，且两者不会同时出现。 */
.ring-pulse { animation: ring-pulse 320ms cubic-bezier(0.22, 0.61, 0.36, 1); }
@keyframes ring-pulse {
  0% { transform: scale(1); }
  40% { transform: scale(1.045); }
  100% { transform: scale(1); }
}
/* 按下即缩一丁点：pulse 是"点了之后"的反馈，这是"按下当时"的反馈，
   两层叠加（外层 ring-wrap 按内圈、ring 播 pulse）才不会互抢 */
.ring-wrap:active .ring-inner { transform: scale(0.97); }

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
  /* ★ 基态必须**显式**写 scale(1)，不能指望默认的 none：intro 走的是
     scale(N) → scale(1) 这条插值，从 none 起算时，部分安卓 WebView 不去补中间
     帧而是直接跳到终点 —— 症状就是"手机上没动画、电脑上有"（none 与矩阵之间的
     插值各家实现松紧不一）。两端都写成 scale() 就没有解释的余地。 */
  transform: scale(1);
  /* ★ 不要常驻 will-change: transform（2026-10-29 真机实锤）：
     曾经为"intro/pulse 走 GPU 不重绘"加过常驻 will-change，结果华为 WebView 上
     合成层纹理**冻结在放大态**：DOM 里 fr-intro 已摘、transform 已回 scale(1)，
     屏幕上还显示着几百毫秒前那张放大旧纹理（连圈内文字一起被放大成巨字），
     定格到下次强制合成才"缩回去"。息屏再亮后圆盘卡死也是同一病根。
     CSS transform/opacity 动画播放时浏览器本来就会临时提层，常驻是负优化。 */
  /* ★ 圆盘是纯视觉（转场缩放），点击交给稳定的 ring-wrap 承接（见模板）：
     华为系 WebView 会对 transform 动画中的元素丢触摸，点圆要等动画落定才灵 ——
     把 ring 设成 pointer-events:none，触摸永远落到不缩放的 ring-wrap 上。 */
  pointer-events: none;
}
.ring-inner {
  position: relative;           /* 给 .ring-tint 的红色叠层做定位 */
  width: 420rpx; height: 420rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.82);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.82);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  box-shadow: 0 16rpx 48rpx rgba(23, 32, 26, 0.1);
  box-shadow: 0 16rpx 48rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.1);
  /* ★ 2026-10-30 去掉 backdrop-filter（帧率）：圈内底色本来就是 82% 不透明的表面色，
     身后又是纯色页面底 —— 毛玻璃几乎看不出差别，却要在落位那一刻新建一个模糊
     合成层，"到显示数字卡一下"的隐性开销就是它。去掉后观感基本不变。 */
}
/* 红色皮肤做成**独立叠层**：收缩时只淡出它的 opacity（GPU 合成、零重绘）——
   红→白在收缩过程中就渐完了，落位时已经是白玻璃，用户说的"先红再变白"那一下消失。
   ⚠️ 不要再把红色写回 .ring-inner 的 background：那是 6 倍盖满整屏的元素，
     每帧重绘 background 必掉帧（2026-10-30 实测）。
   ⚠️ 也**不要改回伪元素 ::after**（2026-10-30 第四轮真机实锤）：伪元素上的
     `transition: opacity` 在华为系 WebView 不走 —— 摘 fr-intro 那一帧圆还有
     5~6 倍大，粉色直接消失，整屏从粉硬切成灰白玻璃，就是用户说的"衔接处不够
     丝滑 / 中间闪一下"。真实 view 的 opacity 过渡与 .ring 的 transform 同路径，
     实测同步渐完。 */
.ring-tint {
  position: absolute;
  left: 0; top: 0; right: 0; bottom: 0;
  border-radius: 50%;
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  border: 2rpx solid rgba(228, 23, 61, 0.28);
  border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.28);
  opacity: 0;
  transition: opacity 260ms ease;
  pointer-events: none;
}
/* intro 期红色叠层可见；摘 fr-intro（收缩开始）后 opacity 1→0 与 transform 同步淡出 */
.fr-intro .ring-tint { opacity: 1; }
/* ★ 圆圈衔接转场（2026-10-25，与首页 .ring-launch 是一对）：
   从首页大圆点进来（?zoom=1）时 ring 先处于"放大盖满全屏"态，缩回就位。
   ★ 收缩由 CSS animation **自播放**（10-27 改，真机视频实锤的修复）：
     animation 从元素第一帧被画出来就开始跑，不依赖任何 JS 信号 —— 而 JS 的
     rAF / selectQuery.exec 在 App 端是"渲染先行、上屏在后"：回调到达时页面
     可能还没显示给人看，按信号摘 intro = 收缩动画播完了人才看见，症状就是
     "首页圆放大后定格一秒多、专注页整个直接弹出"（电脑上这几毫秒看不出来）。
     animation 自播放等于把起跑点焊在首帧上，浏览器画第一帧时动画同步开始。
   intro 期间 ring-inner 换成**首页大圆的皮肤**（淡红底 + 红边、去掉玻璃投影），
   收缩过程中再渐变回玻璃盘 —— 两个圆之间是同一视觉主体，对齐且不跳色。
   ⚠️ 下面的静态规则（不缩水的放大态 / 红皮肤 / opacity:0）**留着**：老内核
      不认 keyframes 时 animation 不跑，class 由 armIntro 的兜底定时器摘掉，
      那时就退化回"transition 收缩"的旧路径 —— 两条路都通。 */
.ring { transition: transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1); }
/* ⚠️ 放大倍数写死，不要用 var(--cover-scale)（2026-10-29 真机实锤）：
   华为 WebView 对 @keyframes 里的 var() 解析失败会**整条丢弃 animation** ——
   收缩动画压根不跑，圆被静态规则钉在放大态约 600ms（直到兜底摘 class），
   定格期间文字淡入动画照常播放，满屏巨字就是这么来的。
   普通声明里的 var() 它倒认，但 keyframes 里不行 —— 所以三处转场全部写死。

   ★ 2026-10-30 第四轮：专注页这边 4.5 → **6**。
     4.5 倍半径只有 1080rpx，而专注页圆心 ≈320rpx（首页那颗 ≈591rpx，更靠下），
     屏高 1624rpx —— 要盖住底部得半径 ≥1304rpx。4.5 倍时底部一直露出一截圆弧，
     录屏里看得很清楚：首页那颗圆是"整屏粉"，切过来底部却有一条边。
     交接那一帧的可见边界从屏外变成屏内，用户感知就是"衔接处顿一下"。
     6 倍（半径 1440rpx）四边全部出屏，两边都是纯色整屏，交接看不出任何几何差。
   ⚠️ 首页那边仍是 4.5（它圆心低，4.3 倍就盖满），两边**允许不同值** ——
     前提是都真的盖满：盖满之后差多少都看不出来。护栏 check-home-focus
     分别盯着「专注页 ≥6」「首页 ≥4.5」这两条线。 */
.fr-intro .ring {
  transform: scale(6);
  animation: fr-ring-drop 260ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
}
@keyframes fr-ring-drop {
  from { transform: scale(6); }
  to   { transform: scale(1); }
}
.fr-intro .ring-inner {
  /* 红色皮肤已移到 ::after 叠层（见上），这里**不再改底色** —— 收缩期间底色
     零变化，只淡出叠层 opacity，零重绘（2026-10-30：红→白在收缩里渐完，且不掉帧）。 */
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  /* 历史：这里曾经挂 animation: fr-skin-back（粉→玻璃换肤）。它的 @keyframes 里
     全是 var()，华为系 WebView 会整条丢弃 → 摘 fr-intro 那帧圆还是 4.5 倍，
     皮肤从粉硬切成白玻璃 = 整屏白闪。所以换肤绝不能再用 keyframes，
     也不要在 4.5 倍大圆上改背景色（每帧重绘整屏 = 掉帧）。下面的
     @keyframes fr-skin-back 仅留作参照，别再挂到元素上。 */
}
@keyframes fr-skin-back {
  from {
    background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
    border-color: rgba(var(--brand-rgb, 228, 23, 61), 0.28);
    box-shadow: none;
  }
  to {
    background: rgba(var(--surface-rgb, 255, 255, 255), 0.82);
    border-color: var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
    box-shadow: 0 16rpx 48rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.1);
  }
}
/* 盘内文字与圆外内容在 intro 期让位，等圆真正落位后再淡入（见下面 .fr-hide）。
   （历史：10-25 起先试过"60ms 就淡入"，10-29 改成"200ms 固定延时"，都栽在
    华为系 WebView 上 —— 它把 fr-ring-drop 丢掉时圆会定格 600ms，任何固定延时
    都会在圆还没落位时把字露出来。所以 2026-10-30 彻底改成"量到落位再摘 class"。）*/
/* 【2026-10-30 移除】不再用"200ms 后固定淡入"：华为系 WebView 会把 fr-ring-drop
   这条 keyframes 整条丢弃，圆定格在 4.5 倍整整 600ms 才由兜底 transition 收缩，
   而文字 200ms 就淡入 —— 那 400ms 里「60:00」「背第1批高频词50个并…」被撑成一屏
   巨字横穿整屏（圈外按钮也提前冒在粉幕上），真机录屏逐帧实锤。固定延时这条路已被
   证伪。现在整页内容由 .fr-hide 统一藏住，JS 量到"圆真的落位了"再摘，见下。 */
/* 只藏**圈内**读数/任务名 —— 它们跟着圆一起放大，是巨字的唯一来源。
   圆外内容（时长按钮/开关）不跟着放大，交给 .fr-intro 的 opacity:0 就行：
   摘 fr-intro（收缩开始）时它们立刻随 transition 淡入，缩小这段就不是一张
   空白页了（2026-10-30 真机录屏实锤：整页全藏 → 圆一边缩一边变白、内容没出来，
   中间约 0.3 秒像空白页）。 */
.fr-hide .ring-inner .time,
.fr-hide .ring-inner .task-title { opacity: 0; }
/* 说明（2026-10-30 第三轮）：这里原来还写着一份"静态粉色皮肤"（与 .fr-intro 同值），
   目的是让摘 fr-intro 时皮肤零变化、零重绘。现在红色改到 .ring-tint 叠层后，
   底色本来就是固定的玻璃色、全程不变，不再需要这份覆盖；红色由叠层 opacity 在收缩
   过程中淡出。大圆上（6 倍盖满屏）**只允许动 transform / opacity**，别再改
   background / box-shadow —— 那是"掉帧"的唯一来源。 */
@keyframes fr-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.fr-intro .ring-inner .time,
.fr-intro .ring-inner .task-title { opacity: 0; }
/* ★ 读数/任务名的 opacity 变化必须走过渡（2026-10-29 真机实锤）：
   fr-intro 摘除的瞬间 opacity 0→1 如果是**突变**，而 transform 还停在放大态
   （动画未跑完/桥消息延迟），用户看到的就是满屏巨字"啪"地跳出来 ——
   圆外内容有 220ms 淡入（下一条规则），这两行字没有，就特别显眼。
   fr-exit 那条 transition: none 特异性更高，退出方向的瞬消不受影响。 */
/* 200ms → 140ms（2026-10-30）：落位后数字要"跟着就出来"，淡入拖太久会被当成卡顿。
   140ms 仍够遮住 0→1 的突变，又不拖延。 */
.ring-inner .time,
.ring-inner .task-title { transition: opacity 140ms ease; }
.fr-intro .focus-body > *:not(.ring-wrap) { opacity: 0; pointer-events: none; }
/* ★ 顶栏也要跟着让位（2026-10-30 用户反馈）：.fnb-wrap 是 fixed + z-index 400，
   会压在放大盖屏的圆**上面** —— 不藏的话圆还在放大、顶栏就先"闪"出来了，
   正是"中间的圆有动画、其它凭空闪现"的另一半。intro 期藏，摘 fr-intro
   （收缩开始）随 200ms 淡入，与圆外内容同一节拍。 */
.focus-page .fnb-wrap { transition: opacity 200ms ease; }
.focus-page.fr-intro .fnb-wrap { opacity: 0; }
.focus-body > * { transition: opacity 220ms ease 60ms; }
/* ★ 点出（2026-10-29）：与上面 fr-intro 是一对，方向相反 ——
   圆从就位处放大盖满全屏（240ms），播完 navigateBack(none)，首页那颗圆接着缩回。
   点出原来压根没有动画：系统窗口动画把人送走，首页那一帧是一整块盖满屏的粉色，
   然后一帧弹回原尺寸（录屏逐帧核对过）。
   ⚠️ 圈内文字/读数必须**当帧消失**，不能淡出：圆放大 3 倍多，字跟着放大，
     淡出的那几十毫秒就是一屏巨字。这和首页 .ring-launch 那边同一处理。 */
.fr-exit .ring {
  transform: scale(6);
  /* ★ 长尾放大（2026-10-29，与首页 hc-ring-rise 同一修法）：240ms 到 6 倍
     后**不停**，继续极慢爬行 —— navigateBack 之后首页 webview 重新上屏有黑洞，
     动画到点定格就是"卡一下"；长尾让这段黑洞里画面仍在动，首页 ring-return
     从这个倍数接手时最多差 4%，肉眼不可见（双方都已盖满屏，边界在屏外）。
     倍数写死，理由见 fr-ring-drop 注释。 */
  animation: fr-ring-rise 700ms both;
}
@keyframes fr-ring-rise {
  0%   { transform: scale(1); animation-timing-function: cubic-bezier(0.4, 0, 0.55, 1); }
  /* 34% ≈ 240ms：与 playExit 里 navigateBack 的 240ms 对齐（改一处要改两处） */
  34%  { transform: scale(6); animation-timing-function: linear; }
  100% { transform: scale(6.24); }
}
/* 放大期间换成首页大圆的皮肤（淡红底 + 红边、去玻璃与投影）：
   navigateBack 那一帧首页接手的正是这个淡红圆盘，不换肤就会"白玻璃盘 → 淡红盘"跳色。 */
.fr-exit .ring-inner {
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  border-color: rgba(228, 23, 61, 0.28);
  border-color: rgba(var(--brand-rgb, 228, 23, 61), 0.28);
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  /* 换肤跟放大同步走完：圆在 1 倍上停着的头几十毫秒是看得见的，
     颜色硬切会闪一下；200ms 到点正好铺满屏，和首页那颗圆无缝对上。 */
  transition: background 200ms linear, border-color 200ms linear;
}
.fr-exit .ring-inner .time,
.fr-exit .ring-inner .task-title { opacity: 0; transition: none; }
.fr-exit .focus-body > *:not(.ring-wrap) { opacity: 0; transition: none; }
.time {
  /* ★ 圆盘读数必须与首页大圆**同源**（home.vue 的 .hc-ring-num）：
     这两个圈是同一个视觉主体的两个状态（点进去放大 → 落回来），字体一旦不同，
     转场中间那一下就看得出来"换了一个东西"。
     ⚠️ 这里之前写的是 Georgia —— iOS/macOS 有的衬线体，**安卓上一套都没有**，
     会一路退到 Noto Serif：圆盘衬线、首页无衬线，两边就不一样了；电脑上看着
     一样是因为电脑有 Georgia，安卓没有。所以干脆不写具体族名。
     不写 = 走 App.vue 的继承链（.container 的 font-family: var(--app-font)），
     用户在设置里换的字体也跟得上；写了任何具体族名都会把这根继承掐断。 */
  font-size: 96rpx;
  /* 500 → 600：衬线换无衬线后同一字号会视觉变轻一档，96rpx 需要补回来 */
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 2rpx;
  /* letter-spacing 会在**最后一个字符后面**也留一份，整串看着偏左；
     补等量缩进推回来（写法同 .phase，也与首页 .hc-ring-num 同一组） */
  text-indent: 2rpx;
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
  /* ring 设了 pointer-events:none，任务名要单独放开（自带 .stop，不冒泡误起表） */
  pointer-events: auto;
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
/* "没检测到授权 · 点这里重新检测"：用琥珀色（这是"要你补一步"，不是报错） */
.sr-try-warn {
  color: var(--amber, #f79009);
  background: rgba(247, 144, 9, 0.12);
  border-color: rgba(247, 144, 9, 0.3);
}
.sr-try-warn:active { background: rgba(247, 144, 9, 0.22); }
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
/* 音色一行：现在是 5 个音色，窄屏上一排放不下就得换行（不然会被裁掉看不见） */
.noise-row { margin-top: 20rpx; justify-content: flex-start; flex-wrap: wrap; }
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

/* 连续专注天数：跟"今日"那条并列，用主色点一下存在感（激励项，不是数据项） */
.ts-streak {
  color: #e4173d;
  color: var(--brand, #e4173d);
  font-weight: 600;
}

/* 运行态工具条：计算器入口（跟白噪音那行同一档视觉，别做成主按钮抢走注意力） */
.tool-row {
  margin-top: 22rpx;
  display: flex; justify-content: center;
}

.tr-btn {
  padding: 14rpx 34rpx;
  border-radius: 999rpx;
  font-size: 25rpx;
  font-weight: 500;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
}

.tr-btn:active { opacity: 0.7; }

/* 休息页的心得一行：点开就能写，写完就地显示 */
.note-row {
  margin-top: 40rpx;
  padding: 26rpx 30rpx;
  border-radius: 22rpx;
  border: 2rpx solid rgba(23, 32, 26, 0.07);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.07));
  background: rgba(255, 255, 255, 0.5);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.5);
  display: flex; align-items: center; gap: 16rpx;
}

.nr-label {
  flex-shrink: 0;
  font-size: 24rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.nr-body {
  flex: 1; min-width: 0;
  font-size: 25rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}

/* 还没写：占位文案再淡一档，让人看出这是"可以点"而不是已有内容 */
.nr-ph {
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.nr-go {
  flex-shrink: 0;
  font-size: 26rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
</style>
