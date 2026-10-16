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
    <float-navbar title="PWstudy" :focus-btn="!locked" :focus-on="forcedOn || blockNotifOn || autoRestOn" @open-focus="toggleFocusSheet" />

    <view class="page-slide home-slide" :class="slideCls" :style="slideStyle"
      @touchstart="homeSwipeStart" @touchmove="homeSwipeMove" @touchend="homeSwipeEnd" @touchcancel="homeSwipeEnd">

      <!-- ===== 专注进行中：首页被"硬控"，只剩倒计时 =====
           计时一旦开始，首页不再显示任务列表 / 目标 / Dock 这些会让人分心的东西；
           想看的话先暂停或结束这一轮。 -->
      <view v-if="locked" class="lock">
        <text class="lock-phase">{{ phaseText }}</text>

        <!-- 点环 = 进全屏专注页（首页这一屏刻意只留"看时间"这一件事） -->
        <view class="lock-ring" :class="{ 'lock-ring-run': running }" @tap="goFocus()">
          <view class="lock-ring-inner">
            <text class="lock-time">{{ lockTime }}</text>
            <text class="lock-task">{{ cur.taskTitle || '自由专注' }}</text>
          </view>
        </view>

        <!-- 正计时段：专注已经跑满，这里同样只给「退出」 -->
        <view v-if="cur.overrun" class="lock-ctrl">
          <button class="lock-btn lock-btn-main" @tap="exitOverrun">{{ $t('退出') }}</button>
        </view>
        <view v-else class="lock-ctrl">
          <button class="lock-btn lock-btn-main" @tap="togglePause">{{ cur.paused ? '继续' : '暂停' }}</button>
          <button class="lock-btn lock-btn-ghost" @tap="confirmGiveUp">放弃</button>
        </view>
        <text v-if="cur.overrun" class="lock-over">{{ $t('预设时长已跑完，继续计时中') }}</text>

        <!-- 判断"你在用哪个 App"有两条路：开了无障碍就不必再要「使用情况访问」
             （前台包名由系统事件直推，更快更省电），所以这里是"两条都没有"才提示。 -->
        <text v-if="(strictOn || forcedOn) && !usageOk && !a11yOk" class="lock-warn" @tap="openUsage">
          严格 / 强制模式需要「使用情况访问」或「无障碍」才能判断你在用哪个 App，点这里去开启
        </text>
        <text v-else class="lock-foot">{{ lockFoot }}</text>

        <text class="lock-today">今日 {{ todayMin }} 分钟 · {{ todayPomo }} 段专注</text>
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

      <!-- ===== 主页：只放今天要用的三张卡（精简适配版） =====
           进首页第一眼只有"今天"：开始专注 / 今天做什么 / 今天有多赶。
           这三张是**首页专门适配的精简版**（不是把完整卡缩小）：
           每张只留一个焦点 —— 开始键 / 下一条要做 / 还剩多久。
           其余组件（目标、日程、学习 App、AI 对话）**平时完全不渲染**，
           它们住在底部抽屉里，要往上滑才拉得出来（见文件末尾 .dr-*）。 -->
      <!-- :style="homeShift"：整列随抽屉展开进度上移 —— 上滑时主卡往上让位，
           抽屉卡片在其下方逐张浮现（对照分镜 reveal≈0.5：主卡已升起一半、
           下一张卡刚探出头）。像滚动一列卡片，而不是掀一张面板。 -->
      <view class="hcards" :style="homeShift">
        <block v-for="id in homeOrder" :key="id">

          <!-- ① 开始专注 —— 这一屏唯一的视觉中心：竖向居中（环 + 开始键 + 极简上下文），
               借 .hcards 的弹性空间用上下 auto margin 推到视口正中；
               周边两张卡（任务 / 紧迫度）各自退到上下边缘并淡化，整屏只剩中心一处焦点 -->
          <view v-if="id === 'focus'" class="card hcard focus-card" hover-class="hcard-press" @tap="goFocus()">
            <view class="hc-ring" :class="{ 'hc-ring-run': running }">
              <text class="hc-ring-num">{{ todayMin }}</text>
              <text class="hc-ring-unit">{{ $t('分钟') }}</text>
            </view>
            <view class="hc-go" @tap.stop="quickStart()">{{ running ? $t('继续') : $t('开始') }}</view>
            <text class="hc-title">{{ focusTitle }}</text>
            <text class="hc-sub">{{ focusLead }}</text>
            <!-- 跑着的时候顺手给个读数：必须走 lockTime 而非 remainSec —— 正计时段
                 remainSec 恒为 0，直接渲染会一直卡在 00:00，看着像计时坏了
                 （check-overrun 第 6 节守着这条）。 -->
            <text v-if="running" class="hc-time">{{ lockTime }}</text>
          </view>

          <!-- ② 今日任务 —— 焦点是"下一条做什么"，只列最该做的三条 -->
          <view v-else-if="id === 'task'" class="card hcard task-card">
            <view class="hc-head">
              <text class="hc-title">{{ $t('今日任务') }}</text>
              <text class="hc-count">{{ taskStat.done }}/{{ taskStat.total }}</text>
            </view>
            <view class="hc-bar"><view class="hc-fill" :style="{ width: taskStat.pct + '%' }"></view></view>
            <view v-if="!queue.length" class="hc-empty">
              <text class="hc-sub">{{ $t('到「目标」里定一个，AI 会帮你拆成每天的任务') }}</text>
            </view>
            <block v-else>
              <view
                v-for="(item, ti) in homeQueue"
                :key="item.task.id"
                class="hc-task"
                :class="{ 'hc-task-lead': ti === 0 }"
                hover-class="hc-task-press"
                @tap="startFor(item)"
              >
                <view
                  class="tk-check"
                  :class="{ 'tk-check-on': item.task.status === 'done', 'tk-check-full': fullOf(item) }"
                  @tap.stop="toggleTaskDone(item)"
                >
                  <text v-if="item.task.status === 'done'" class="tk-tick">✓</text>
              </view>
                <view class="tk-dot" :class="{ 'tk-dot-late': item.overdue }"></view>
                <view class="hc-task-col">
                  <text class="hc-task-title" :class="{ 'tk-title-done': item.task.status === 'done' }">{{ item.task.title }}</text>
                  <text class="hc-sub">{{ item.goal.title }} · {{ $t('剩 {n} 分钟', { n: item.estMin }) }}</text>
                </view>
              </view>
              <view v-if="hasMoreTask" class="hc-more" @tap="openDrawer">
                <text class="hc-sub">{{ $t('查看其余 {n} 项', { n: queue.length - 3 }) }}</text>
              </view>
            </block>
          </view>

          <!-- ③ 今日紧迫度 —— 焦点是"还剩多久"，一条时间轴说完，不摆完整仪表盘 -->
          <view v-else-if="id === 'urgency'" class="card hcard urg-card" @tap="explainUrgency(u)">
            <view class="hc-head">
              <text class="hc-title">{{ $t('今日紧迫程度') }}</text>
              <text class="hc-lv" :style="{ background: u.soft, color: u.color }">{{ uLevelName }}</text>
            </view>
            <view class="hc-axis">
              <view class="hc-axis-past" :style="{ width: u.nowPct + '%' }"></view>
              <view class="hc-axis-need" :style="{ width: u.fillPct + '%' }"></view>
            </view>
            <view class="hc-foot-row">
              <text class="hc-sub">{{ $t('还剩 {n} 段专注', { n: u.leftPomos }) }}</text>
              <text class="hc-sub">{{ $t('还要 {n} 分钟', { n: u.needMin }) }}</text>
            </view>
          </view>
        </block>
      </view>
      <!-- 首页的核心操作：收工。
           原来它缩在「今日任务」卡右上角当一个小链接，而"今天做了什么"其实是
           整个"动态安排"的输入口 —— 现在按主按钮的尺寸放在首页底部，
           填过就变成「改一下」，不重复催促。编辑首页时让位给编辑按钮。 -->
      <view v-if="!editing" class="home-cta" :style="homeShift">
        <button class="btn-primary cta-btn" @tap="goDaily()">{{ checked ? '改一下今天的收工' : '今日收工' }}</button>
        <text class="cta-tip">{{ checked ? '今天已经记过了，想改随时点开' : '花十几秒说说今天，明天的安排才排得准' }}</text>
      </view>
      </block>
    </view>
    <!-- ===== 底部"抽屉"：其余组件住在这儿 =====
    它不是一张面板，也没有实体：上滑时主页整列上移让位，
    这摞卡片按展开进度**逐张淡入 + 升起**（wrapStyle 错拍），
    滑到最底 → 才够得着「编辑首页」。
    这层只是透明的点击承接层（开着时点空白处 = 收起）。
    ⚠️ 必须放在 .page-slide 之外 —— fixed 参照不能受切 tab 的滑动动画影响，
    否则抽屉会跟着页面一起滑走（记忆约束 3）。 -->
    <view class="dr-mask" :class="{ on: drawerOn }" @tap="closeDrawer" @touchmove.stop.prevent="noop">
      <view class="dr-panel" ref="drPanel" :class="{ dragging: dragging }" :style="panelStyle" @tap.stop>
        <!-- 抽屉把手：往下拖 = 收起抽屉（去掉了装饰小横条，只留标题做抓手） -->
        <view
        class="dr-grip"
        @touchstart="gripStart"
        @touchmove="gripMove"
        @touchend="gripEnd"
        @touchcancel="gripEnd"
        >
        <text class="dr-title">{{ $t('全部组件') }}</text>
      </view>
      <scroll-view class="dr-body" scroll-y>
        <view class="mod-list" @touchmove="dragMove" @touchend="dragEnd" @touchcancel="dragEnd">
          <view
          v-for="(id, i) in restOrder"
          :key="id"
          class="mod-wrap"
          :data-id="id"
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

        <!-- 专注计时状态卡：和其它卡一样按注册表显隐（以前这张是硬写的，收纳不生效） -->
        <!-- 点卡片 = 进专注页的准备态（**不**自动开始，先看看 / 调设置 / 改时长）；
        点右边的「开始」也是同一个落点 —— 起表前必须先让人看清
        "这一轮是几分钟、绑的哪个任务、开了哪些模式"，再自己按下确认。
        以前「开始」会直接起表，用户等于被拽进倒计时，连改时长的机会都没有。 -->
        <view v-if="id === 'focus'" class="card focus-card" @tap="goFocus()">
          <view class="fc-main">
            <view class="fc-ring" :class="{ 'fc-ring-run': running }">
              <!-- 同 lockTime 口径：正计时段显示 "+MM:SS"，不能吃 remainSec
                   （它那时恒为 0，渲染出来就是"卡在 00:00"）。 -->
              <text class="fc-time">{{ running ? lockTime : fmtHM(todayMin) }}</text>
            </view>
            <view class="fc-info">
              <view class="fc-title">{{ running ? (cur.phase === 'rest' ? '休息中' : '专注中') : '今日专注' }}</view>
              <view class="fc-sub">{{ running ? cur.taskTitle : (todayPomo + ' 段专注 · 点「开始」先确认时长') }}</view>
            </view>
            <view class="fc-go" @tap.stop="quickStart()">{{ running ? '继续' : '开始' }}</view>
          </view>
        </view>

        <!-- 今日紧迫程度：卡片头一行字（标题 + 档位胶囊 + ?），下面靠图形说话 ——
        环的填充 = 有多赶，核心呼吸的快慢 = 赶的程度，
        方块 = 还剩几段专注（实心）与已做几个（空心），
        底下那条 = 今天 24 小时，竖线是"现在"，色块是"还要多久"。
        右侧三行小字是图形的读数（分数 / 还剩几个 / 还要多久）。
        右上角一个 ? —— 想看完整解释就点它。 -->
        <view v-else-if="id === 'urgency'" class="card urg-card">
          <urgency-meter :u="u" @help="explainUrgency" />
        </view>

        <!-- 今日任务 -->
        <!-- task-card：新手引导要按它定位（utils/onboarding.js 的 task 步骤） -->
        <view v-else-if="id === 'task'" class="card task-card">
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
            点行仍然是"开始专注"（快路径），两者互不干扰。
            tk-check-full = 专注已做满但还没勾（2026-10-14 真机反馈：
            紧迫度按专注算"没活了"，任务列表按勾没勾算"还有 3 条"，
            两边口径打架 —— 把"就差你点一下"摆到明处） -->
            <view
            class="tk-check"
            :class="{ 'tk-check-on': item.task.status === 'done', 'tk-check-full': fullOf(item) }"
            @tap.stop="toggleTaskDone(item)"
            >
            <text v-if="item.task.status === 'done'" class="tk-tick">✓</text>
          </view>
          <view class="tk-dot" :class="{ 'tk-dot-late': item.overdue }"></view>
          <view class="tk-main">
            <view class="tk-title" :class="{ 'tk-title-done': item.task.status === 'done' }">{{ item.task.title }}</view>
            <view class="tk-sub">
              {{ item.goal.title }} · 第 {{ item.task.day }} 天 · {{ item.task.donePomos }}/{{ item.task.pomos }} 专注 · 剩 ≈ {{ item.estMin }} 分
              <text v-if="item.overdue" class="tk-late">已超期</text>
              <text v-else-if="fullOf(item)" class="tk-full" @tap.stop="toggleTaskDone(item)">{{ $t('专注已满') }}</text>
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
      <view class="gr-sub">{{ progressOf(g).done }}/{{ progressOf(g).total }} 专注 · {{ progressOf(g).pct }}%</view>
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
      @done="onSchedDone"
      @more="goCalendar"
      />
      <!-- 自动重排的结果要看得见：改了什么写在这儿，用户才知道"我说的那句话有用" -->
      <text v-if="replanTip" class="sc-tip">{{ replanTip }}</text>
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

    <!-- 编辑入口压在抽屉最底下：要往下翻两次才够得着，平时不会误触 -->
    <view class="home-foot">
      <block v-if="editing">
        <view class="foot-btn ghost" @tap="openSheet">{{ $t('＋ 添加组件') }}</view>
        <view class="foot-btn primary" @tap="finishEdit">{{ $t('完成') }}</view>
      </block>
      <view v-else class="foot-link" @tap="toggleEdit">{{ $t('编辑首页') }}</view>
    </view>
    </scroll-view>
    </view>
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
      :value="dlg.value"
      :placeholder="dlg.placeholder"
      :maxlength="dlg.maxlength"
      @confirm="onDlgYes"
      @cancel="onDlgCancel"
    />

    <!-- 任务完成弹窗（fixed 层，必须放在 .page-slide 之外 —— 记忆约束 3）。
         勾掉一项立刻弹：「取消」就这么着，「额外收获」去跟 AI 说两句。
         记账不在这里做 —— 完成那一刻 utils/pwstore.js 已经写进当日台账了。 -->
    <task-done-dialog
      ref="doneDlg"
      @open="doneDlgOn = true"
      @close="doneDlgOn = false"
    />

    <!-- 首页「专注设置」卡片（顶栏右上角胶囊点开弹出）：
         把「强制模式 / 拦截通知 / 自动进休息」三项收进同一张卡片，仿番茄 ToDo 把同类设置
         收进一处。专注进行中（locked）与编辑首页（editing）时入口不显示；卡片用遮罩弹层，
         点遮罩或 × 收起。 -->
    <view v-if="focusSheet" class="fs-mask" @tap="toggleFocusSheet">
      <view class="fs-card" @tap.stop>
        <view class="fs-head">
          <text class="fs-title">{{ $t('专注设置') }}</text>
          <view class="fs-close" @tap="toggleFocusSheet">×</view>
        </view>

        <view class="fc-row">
          <view class="fc-info">
            <text class="fc-title">{{ $t('强制模式') }}</text>
            <text class="fc-sub">{{ $t('离开学习 App 立刻拉回') }}</text>
          </view>
          <view class="fc-switch" :class="{ 'fc-on': forcedOn }" @tap="tapForced">
            <view class="fc-knob" :class="{ 'fc-knob-on': forcedOn }"></view>
          </view>
        </view>
        <view v-if="forcedOn && !overlayOk" class="fc-warn" @tap="openOverlayHome">{{ $t('强制模式需开启「显示在其他应用上层」') }}</view>

        <view class="fc-row">
          <view class="fc-info">
            <text class="fc-title">{{ $t('拦截通知') }}</text>
            <text class="fc-sub">{{ $t('专注时收起别家通知') }}</text>
          </view>
          <view class="fc-switch" :class="{ 'fc-on': blockNotifOn }" @tap="tapBlockNotif">
            <view class="fc-knob" :class="{ 'fc-knob-on': blockNotifOn }"></view>
          </view>
        </view>

        <view class="fc-row">
          <view class="fc-info">
            <text class="fc-title">{{ $t('自动进休息') }}</text>
            <text class="fc-sub">{{ $t('专注结束自动休息') }}</text>
          </view>
          <view class="fc-switch" :class="{ 'fc-on': autoRestOn }" @tap="tapAutoRest">
            <view class="fc-knob" :class="{ 'fc-knob-on': autoRestOn }"></view>
          </view>
        </view>
      </view>
    </view>

    <float-tabbar ref="tabbar" current="home" />

    <!-- 新手引导遮罩（fixed 层，必须放在 .page-slide 之外 —— 记忆约束 3）。
         步骤与状态在 utils/onboarding.js，测量与推进在本页。 -->
    <onboarding-mask
      :step="gdStep"
      :index="gdIndex"
      :total="gdTotal"
      :box="gdBox"
      :dark="gdDark"
      @next="guideNext"
      @skip="guideSkip"
      @resize="guideResize"
    />
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
import * as settings from '../../utils/settings.js'
import * as fgsvc from '../../utils/fgsvc.js'
import * as dailylog from '../../utils/dailylog.js'
import * as pacing from '../../utils/pacing.js'
import * as coach from '../../utils/coach.js'
import * as urgency from '../../utils/urgency.js'
import * as partner from '../../utils/partner.js'
import * as updater from '../../utils/updater.js'
import * as layout from '../../utils/home-layout.ts'
import * as schedule from '../../utils/schedule.js'
import * as reminder from '../../utils/reminder.js'
import * as onboarding from '../../utils/onboarding.js'
import * as harvest from '../../utils/harvest.js'
import * as theme from '../../utils/theme.js'
import { hideNativeTabBar, syncTabbar, safeNav } from '../../utils/nav.js'
import tabSlideMixin from '../../utils/tab-slide-mixin.js'
import FloatTabbar from '../../components/float-tabbar/float-tabbar.vue'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'
import CoachBox from '../../components/coach-box/coach-box.vue'
import UrgencyMeter from '../../components/urgency-meter/urgency-meter.vue'
import ScheduleList from '../../components/schedule-list/schedule-list.vue'
import AppDialog from '../../components/app-dialog/app-dialog.vue'
import OnboardingMask from '../../components/onboarding-mask/onboarding-mask.vue'
import TaskDoneDialog from '../../components/task-done-dialog/task-done-dialog.vue'

// 图形摘要条的进度条色：跟着 accent 主题走。写死 #e4173d 的话，
// 换成蓝色 / 绿色主题时这一条会显得像另一套设计留下的。
const BRAND = 'var(--brand, #e4173d)'

// 主页常驻的三张卡：今天要用的就这三样 —— 开始专注 / 今天做什么 / 今天有多赶。
// 其余模块一律进底部抽屉（不上滑就完全不渲染）。
const HOME_IDS = ['focus', 'task', 'urgency']

// ★ 上滑视差：主页整列最多上移多少（vh）。抽屉上来时主页被"顶上去"，
//   两者位移不同速才有景深；数值越大层次越明显（之前 18 太小，读出来像同一层）。
const HOME_PARALLAX_VH = 26
// ★ 景深：抽屉上来时主页整列缩到多少（0.07 = 缩 7%），
//   后退一层 = 抽屉那层玻璃底板往前，层次才立得住。
const HOME_DEPTH_SCALE = 0.07
// ★ 抽屉玻璃底板自己的视差：闭合时往下沉多少（面板高度的百分比）。
//   比主页的位移小得多 —— 主页 26vh 大幅后退，底板只小幅上顶，两层错开。
const PANEL_PARALLAX_PCT = 10

export default {
  components: {
    FloatTabbar, FloatNavbar, CoachBox, UrgencyMeter, ScheduleList,
    AppDialog, OnboardingMask, TaskDoneDialog
  },
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
      // 今日紧迫程度（utils/urgency.js 算好：标题 + 档位 + 三行读数，其余靠图形）
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
      blockNotifOn: false,   // 首页「专注设置」卡片：专注期间收起别家 App 通知
      autoRestOn: false,     // 首页「专注设置」卡片：专注跑完自动进休息
      focusSheet: false,     // 首页「专注设置」卡片是否弹出
      overlayOk: false,      // 「显示在其他应用上层」权限：强制模式拉回的准入条件
      // 统一弹窗（components/app-dialog）：危险确认也走自绘卡片，不用 uni.showModal
      dlg: { show: false, mode: 'confirm', title: '', content: '', confirmText: '确定', danger: false, seq: 0, action: '', items: [], item: null },
      // ---------- 首页分层：主页三卡（常驻）+ 抽屉（其余组件）----------
      // 主页只放今天要用的三张卡（专注 / 任务 / 紧迫度），其余组件**平时完全不渲染** ——
      // 它们住在底部抽屉里，往上滑才拉得出来。抽屉状态只活在本次会话（切 tab 回来保持），
      // 不写进设置 —— 每次进首页都强制收起的话，刚拉开看两眼又被收回去很烦。
      drawerOn: false,    // 抽屉是否拉出
      // 抽屉拖动：panelDrag = 展开进度的反向百分比（0=全开，100=全关），null=未拖动
      panelDrag: null,
      dragging: false,
      gripY: 0,            // 抽屉内把手的手势起点（往下拉 = 收起）
      nodeMiss: 0,         // 诊断：面板高度算不出来的累计次数（见 panelHpx）
      panelH: 0,           // 抽屉面板实测高度 px（measurePanel 异步量好缓存，拖动时同步用）
      // 主页整块的上滑手势：用户在主页内容区（不只那个小把手）往上滑就该拉开抽屉。
      // 只记起点，touchend 时再算位移，避免 touchmove 和页面滚动打架。
      swipeX0: 0,
      swipeY0: 0,
      winH: 667,          // 视口高度（onShow 实测），用来判定"下半屏起手"的上滑
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
      _iconPending: {},
      // ---------- 新手引导（utils/onboarding.js）----------
      // gdOn  = 引导进行中（含"正在量位置、遮罩还没出来"那几百毫秒）
      // gdStep = 当前步（null = 还没量出来 / 没在引导）；gdBox = 目标矩形（null = 欢迎步，气泡居中）
      gdOn: false,
      gdStep: null,
      gdIndex: 0,
      gdBox: null,
      // ---------- 任务完成反馈 + 动态重排（utils/harvest.js）----------
      // doneDlgOn 弹窗是否在场（返回键要先收它；页面自己看得见，别去问组件）
      doneDlgOn: false,
      // 重排结果的一句话提示（"AI 已按今天的完成情况重排了后面 3 项"）
      replanTip: ''
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
      // 正计时仍算"专注中"：人确实还在学，且下面 lockTime 的 +MM:SS 与那行说明
      // 已经把"预设时长跑满了"讲清楚了 —— 这里再分一档只是多一条静态中文。
      if (c.paused) return '已暂停'
      return c.phase === 'rest' ? '休息中' : '专注中'
    },
    /**
     * 硬控屏那个大号读数。
     * 正计时段必须显示"+MM:SS"：沿用 remainSec 的话会一直卡在 00:00，
     * 看着就是"计时坏了"，而实际上人只是把这一轮接着做下去了。
     */
    lockTime() {
      const c = this.cur
      if (!c) return '00:00'
      return c.overrun ? '+' + this.fmtMMSS(Number(c.overSec) || 0) : this.fmtMMSS(c.remainSec)
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
    /**
     * 第一屏「今天先做这个」挑哪一条。
     * 超期的最优先（它已经欠着了），其次挑"剩下要做的专注最多"那条 —— 那才是今天的大头。
     * 全部做完就返回 null，聚焦区转成"去定个目标"，不会显示一条已经打勾的任务。
     */
    focusTask() {
      const q = (this.queue || []).filter(i => i.task && i.task.status !== 'done')
      if (!q.length) return null
      const late = q.filter(i => i.overdue)
      if (late.length) return late[0]
      const left = i => Math.max(0, (Number(i.task.pomos) || 0) - (Number(i.task.donePomos) || 0))
      return q.slice().sort((a, b) => left(b) - left(a))[0] || q[0]
    },
    /** 今日任务完成度：聚焦区那条进度条 + 右上角 x/y 都读它 */
    taskStat() {
      const q = this.queue || []
      const total = q.length
      const done = q.filter(i => i.task && i.task.status === 'done').length
      return { done: done, total: total, pct: total ? Math.round(done * 100 / total) : 0 }
    },
    /**
     * 主页（常驻）只放"今天要用的三张卡"：专注 / 今日任务 / 紧迫度。
     * 顺序沿用用户在「编辑首页」里排出的相对先后（尊重他自己的排序）。
     */
    homeOrder() {
      const ids = (this.cardOrder || []).filter(id => HOME_IDS.indexOf(id) >= 0)
      // 兜底：三张主卡全被收纳时主页不能开天窗 —— 至少把「开始专注」摆回来。
      // 不兜底的后果（真机出现过）：整页只剩一张收工按钮，中间一大片空白。
      return ids.length ? ids : ['focus']
    },
    /**
     * 抽屉里住着其余组件（目标 / 日程 / 学习 App / AI 对话…）。
     * 编辑态返回**全部**卡片 —— 否则收纳之后就永远从抽屉里捞不回来（理由同 cardOrder）。
     */
    restOrder() {
      const ids = this.cardOrder || []
      if (this.editing) return ids
      return ids.filter(id => HOME_IDS.indexOf(id) < 0)
    },
    /** 抽屉里还有几张卡（0 张时连把手都不显示） */
    restCount() {
      return this.restOrder.length
    },
    // 把"展开进度" open 作为 CSS 变量传下去：抽屉把手 / 底部编辑区靠它淡入。
    // 卡片本体不走这条（它们的逐张错拍显现在 wrapStyle 里按进度算）。
    // 面板自己也带一小段视差：闭合时下沉 PANEL_PARALLAX_PCT%，展开归零 ——
    // 主页大幅后退、底板小幅上顶，两层不同速才有层次（同速 = 同一列接着排）。
    panelStyle() {
      const p = this.openProg
      const s = {
        '--open': String(p),
        transform: 'translateY(' + ((1 - p) * PANEL_PARALLAX_PCT).toFixed(2) + '%)'
      }
      if (this.dragging) s.transition = 'none'
      return s
    },
    // 抽屉"展开进度"：0=全关（卡片不可见），1=全开（完全显现）。
    // 拖动时跟手（由 panelDrag 实时换算），松手后由 drawerOn 决定终态，
    // 让"首页上移"和"卡片浮现"被同一个进度串起来，首页上滑和抽屉不再割裂。
    openProg() {
      if (this.panelDrag !== null) return Math.max(0, Math.min(1, 1 - this.panelDrag / 100))
      return this.drawerOn ? 1 : 0
    },
    // 主页整列随展开进度**上移 + 轻微缩小**：上滑时主卡往上让位，
    // 抽屉卡片在其下方逐张浮现 —— 像把一列卡片滚上去，而不是掀一张面板。
    // ★ 缩小是为了景深：主页后退一层，抽屉那块玻璃底板才读得出"浮在上面"。
    //   只上移不缩小的话，两层同速、同大小，看着就是同一列接着排下去。
    // 拖动中关掉过渡跟手，松手后由样式表里的 transition 补完。
    homeShift() {
      if (this.editing) return {}
      const p = this.openProg
      if (p <= 0) return {}
      const s = {
        transform: 'translateY(-' + (p * HOME_PARALLAX_VH).toFixed(2) + 'vh) scale(' +
          (1 - p * HOME_DEPTH_SCALE).toFixed(4) + ')',
        // 主页整列同步淡出：若主页还亮着，收工按钮会和抽屉底部的
        // 「编辑首页」叠在一起（真机视频里两行字摞一处）
        opacity: String(1 - p * 0.92)
      }
      if (this.dragging) s.transition = 'none'
      return s
    },
    /**
     * 主页任务卡只列最该做的三条 —— 第一行永远是主任务
     * （超期优先，其次剩余专注最多），后面按原队列顺序补齐。
     */
    homeQueue() {
      const q = this.queue || []
      if (!q.length) return []
      const lead = this.focusTask
      if (!lead) return q.slice(0, 3)
      return [lead].concat(q.filter(i => i !== lead)).slice(0, 3)
    },
    /** 专注卡副标题：跑着就说在跑哪一段，空着就说点进去先看什么 */
    focusLead() {
      if (this.running) return this.cur.taskTitle || this.$t('自由专注')
      if (this.focusTask) return this.focusTask.task.title
      return this.$t('点这里先看清时长与设置')
    },
    /** 任务卡还有没列出来的 */
    hasMoreTask() {
      return (this.queue || []).length > 3
    },
    /** 专注卡标题：跑着就说在跑哪一段，空着就是「开始专注」 */
    focusTitle() {
      if (this.running) return this.cur.phase === 'rest' ? this.$t('休息中') : this.$t('专注中')
      return this.$t('开始专注')
    },
    /** 紧迫度档位名（来自 urgency.levelName，走 $t 才有英文） */
    uLevelName() {
      const v = this.u || {}
      // 读一下 __lang 建立依赖，切语言时这一行会跟着重画
      void this.__lang
      return this.$t(urgency.levelName(v.level))
    },
    schedToday() {
      return pw.today()
    },
    /** 日程卡头部那句"这是哪天"（含节假日 / 周末，与日历页同一口径） */
    schedLabel() {
      return schedule.dateLabel(this.schedDate)
    },
    gdTotal() {
      return onboarding.count()
    },
    /** 遮罩层用固定配色，深浅由这里显式传下去（不跟 CSS 变量，见组件内注释） */
    gdDark() {
      try { return !!theme.isDark() } catch (e) { return false }
    }
  },
  watch: {
    // 专注一跑起来首页就被倒计时"硬控"，整个卡片区都不显示了 ——
    // 编辑态必须跟着收掉，否则会留下一个点不动的把手浮在倒计时上面。
    locked(v) {
      if (v) this.finishEdit()
      // 抽屉是 fixed 的，硬控屏盖不住它 —— 不收掉就会浮在倒计时上面
      if (v && this.drawerOn) { this.editing = false; this.drawerOn = false }
      // 专注一跑起来卡片区整个不显示了，引导的高亮目标也就没了 ——
      // 收掉但**不记完成**：这次没看成，下次进首页再放一遍
      if (v && this.gdOn) this.stopGuide()
    }
  },
  onShow() {
    hideNativeTabBar()
    syncTabbar(this)
    // 实测一次视口高度：主页上滑拉抽屉要判定"下半屏起手"，免得和顶部滚动打架
    try { this.winH = uni.getSystemInfoSync().windowHeight || 667 } catch (e) { this.winH = 667 }
    // 抽屉面板高度提前量好缓存：拖动时要用它把手指位移换成百分比（异步量来不及）
    this.measurePanel()
    this.refresh()
    this.startTick()
    // 进 App 先补一次每日提醒（没开着时错过的那个点，进来就补上，当天只补一次）
    this.__remindMin = -1
    this.checkRemind()
    // 从对话页/重排页退回来：让对话框拿到最新结果（判定过的"有出入"还在）
    if (this.$refs.coach && this.$refs.coach.refresh) this.$refs.coach.refresh()
    // 从设置页回来要重新实测一次（系统页是全屏的，回来才知道开没开）
    if (this.__fromSetup) {
      this.__fromSetup = false
      this.refreshSetup()
      return
    }
    // 新手引导：第一次进来放一遍（只看一次，设置页「关于」里可重看）。
    // 它铺满全屏，放出来就不该再叠权限 / 关联 / 更新那几个弹窗 —— 挤在一起谁都看不清。
    if (this.maybeGuide()) return
    this.maybeSetupPrompt()
    this.maybePartnerAsk()
    this.maybeUpdatePrompt()
    // 动态重排（utils/harvest.js）：跨天兜底 + 当天全部完成后的自动重排。
    // 放在所有"问用户"的弹窗之后、且异步跑 —— 它不该挡住刚进 App 时该看的东西。
    this.runReplanFlow()
  },

  onHide() {
    // 离开首页一律退出编辑态，保证回来时界面是简洁的
    this.finishEdit()
    this.focusSheet = false
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
    // 任务完成弹窗同理：按返回只是"不说了"，不是退出 App。
    if (this.doneDlgOn && this.$refs.doneDlg) { this.$refs.doneDlg.close(); return true }
    if (this.gdOn) { this.endGuide(); return true }
    if (this.sheetShow) { this.sheetShow = false; return true }
    if (this.editing) { this.finishEdit(); return true }
    if (!this.forcedOn) return false
    // 正计时段放行：专注已跑满，这时候还把人按在首页就是"拦人不放"
    if (!this.cur || this.cur.paused || this.cur.overrun || this.cur.phase !== 'focus') return false
    uni.showToast({ title: '先把这段专注跑完，或到专注页放弃', icon: 'none' })
    return true
  },
  methods: {
    // ---------- 任务完成反馈 + 动态重排（utils/harvest.js）----------

    /**
     * 两条自动重排线，进首页各试一次：
     *   ① sweep  跨天兜底 —— 过了 00:00 昨天还有没做完的，重排后面的（一天一次）
     *   ② autoReplan 当天全部完成 —— 综合今天完成的数据与历史反馈重排（一天一次）
     *
     * 都**不等用户确认**：这是需求定的（"若需要则直接重排，无需用户确认"）。
     * 但砍任务 / 顺延截止日这两种"事后难反悔"的动作不会自动落地 —— 它们进待确认队列，
     * 由 maybePendingAsk() 单独问一次。
     *
     * ⚠️ 顺序固定：先兜底再全部完成。兜底会把欠账重排掉，跑完当天状态才准；
     *    反过来先判"全部完成"很容易在有欠账时误判。
     */
    async runReplanFlow() {
      const show = (txt) => {
        if (!txt) return
        this.replanTip = txt
        try { uni.showToast({ title: txt, icon: 'none', duration: 3200 }) } catch (e) {}
      }
      try {
        // 上次重排的结果先回显一下（不是这次跑的），让"重排过"这件事有痕迹
        const last = pw.replanState().last
        if (last && last.at && Date.now() - last.at < 36 * 3600 * 1000 && !this.replanTip) {
          this.replanTip = 'AI 上次重排：' + (last.detail || last.summary || '调整了后面的任务')
        }
        const sw = await harvest.sweep()
        if (sw && sw.ok && sw.applied) {
          show('昨天有没做完的，已重排后面 ' + sw.applied + ' 项')
          this.refresh()
        }
        const ar = await harvest.autoReplan()
        if (ar && ar.ok && ar.applied) {
          show('今天的任务都做完了，已按完成情况重排后面 ' + ar.applied + ' 项')
          this.refresh()
        }
        // 信息不足：不硬排，先问本人一句最新意见，拿到再重跑一次
        if (ar && ar.ok === false && ar.ask) { this.askReplanNote(ar.ask); return }
        if (sw && sw.ok === false && sw.ask) { this.askReplanNote(sw.ask); return }
        this.maybePendingAsk()
      } catch (e) {
        // 自动重排失败一律静默：它不该在用户刚打开 App 时弹一个错误吓人
        console.warn('[home] 自动重排失败', e && e.message)
      }
    },
    /** 勾掉一项（日程表卡）→ 弹「恭喜你完成任务」 */
    onSchedDone(row) {
      this.openDoneDialog(row)
    },
    /**
     * 弹完成弹窗。
     * ⚠️ 专注起表时首页被倒计时硬控，卡片都没了 —— 那时不弹（也无处可弹）。
     */
    openDoneDialog(row) {
      if (this.locked || this.gdOn) return
      const d = this.$refs.doneDlg
      if (!d) return
      // 完成时刻从当日台账里取（pwstore 在置完成那一刻就记好了）
      let atText = ''
      try {
        const it = harvest.listOf(pw.today()).filter(x => x.taskId === (row.id || row.taskId))[0]
        if (it) atText = it.atText || ''
      } catch (e) {}
      d.open({
        goalId: row.goalId,
        id: row.id || row.taskId,
        title: row.title,
        goalTitle: row.goalTitle
      }, atText)
      // 勾完最后一项 → 可能正好触发"全部完成"，顺手试一次（一天只跑一次，有守卫）
      this.runReplanFlow()
    },
    /**
     * 信息不足时问一句（需求 6）。
     * 拿到回答 → 存进 lastNote → 立刻带这句话重跑一次重排。
     */
    askReplanNote(ask) {
      if (this.dlg.show || this.doneDlgOn) return
      this.ask({
        title: '想先问你一句',
        content: (ask && ask.ask) || '现在的数据还不够排出更好的安排，方便说一句你的想法吗？',
        mode: 'input',
        confirmText: '就这样重排',
        placeholder: '比如：每天最多 2 段专注 / 先啃阅读',
        value: '',
        maxlength: 120,
        action: 'replan-note'
      })
    },
    /** 砍任务 / 顺延截止日：这两件事不自动落地，攒着在这儿问一次 */
    maybePendingAsk() {
      if (this.dlg.show || this.doneDlgOn) return
      const list = harvest.pendingList()
      if (!list.length) return
      const it = list[0]
      this.ask({
        title: '有一件事想跟你确认',
        content: harvest.pendingText(it),
        confirmText: '就按它说的',
        cancelText: '先不动',
        action: 'replan-pending'
      })
    },
    refresh() {
      const ov = pw.overview()
      this.todayMin = ov.todayMin
      this.todayPomo = ov.pomo
      this.queue = pw.todayQueue(6).map(q => {
        // 剩余预计时长 = 还没做的专注数 × 单段专注时长（跟随设置，别写死 25）
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
      // 「专注设置」卡片的三项开关：直接读 settings，保证离开设置页回来同步
      const f = (settings.get().focus) || {}
      this.blockNotifOn = !!f.blockNotif
      this.autoRestOn = !!f.autoRest
      this.overlayOk = apptime.canDrawOverlays()
      if (this.locked) this.focusSheet = false
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
    // ---------- 首页分层：底部抽屉（其余组件）----------
    openDrawer() {
      this.drawerOn = true
    },
    closeDrawer() {
      // 编辑态不许收起：抽屉里那摞卡片是唯一能拖 / 能收纳的地方
      if (this.editing) return
      this.drawerOn = false
    },
    /**
     * 量一次抽屉面板的真实高度缓存进 panelH —— touchmove 里要**同步**用，
     * 而 createSelectorQuery 是异步的，拖动现场等不起。
     * ⚠️ 别再指望 this.$refs.drPanel.offsetHeight：app 端 ref 拿到的不是 DOM 节点
     *    （真机日志 ref=has 却读不到高度，2026-10-16 实锤）。
     * 首帧可能还没布局完（量到 0）→ 退一拍重量，最多 6 次。
     */
    measurePanel(tryN) {
      const n = tryN || 0
      if (n > 6) return
      const q = uni.createSelectorQuery().in(this)
      q.select('.dr-panel').boundingClientRect()
      q.exec((res) => {
        const r = res && res[0]
        const h = r && (r.height || 0)
        if (h > 0) { this.panelH = Math.round(h); return }
        setTimeout(() => { this.measurePanel(n + 1) }, 120)
      })
    },
    // 抽屉当前像素高度（拖动百分比要换算成 px）：缓存的实测值，没有就退回 76vh 估算。
    panelHpx() {
      const H = this.panelH || Math.round(this.winH * 0.76)
      // ★ 诊断只在**两种都拿不到**时才留痕：H 算不出 → dy/H 得 NaN →
      //   内联 transform 收到 NaN 被整个丢弃 → 表现"上滑没反应"、控制台一声不吭。
      //   有估算值可用就别刷日志 —— 这函数在每次 touchmove 里都会走。
      if (H > 0) return H
      this.nodeMiss++
      if (this.nodeMiss === 1 || this.nodeMiss % 20 === 0) {
        console.warn('[drawer] 面板高度算不出来，退回地板值 480',
          'miss=' + this.nodeMiss, 'winH=' + this.winH, 'panelH=' + this.panelH)
      }
      // 地板值：除以 0 会让进度变 NaN，动画等于没写上去
      return 480
    },
    /**
     * 主页整块上滑：不只是小把手。手指在内容区往上滑，抽屉面板跟着手指升起，
     * 拉过一半松手就开、没过一半弹回。这样"从下往上滑"是跟手的，不再靠阈值硬切，
     * 也不会因为整包 v-if 挂载而掉帧（抽屉 DOM 常驻，只动 transform）。
     * 只有"下半屏起手 + 明显竖向"才接管，避免和顶部滚动 / 卡片轻点打架。
     */
    homeSwipeStart(e) {
      const t = (e && e.touches && e.touches[0]) || null
      this.swipeX0 = t ? t.clientX : 0
      this.swipeY0 = t ? t.clientY : 0
    },
    homeSwipeMove(e) {
      if (this.drawerOn || this.editing || this.locked || !this.restCount) return
      const t = (e && e.touches && e.touches[0]) || null
      if (!t) return
      const dy = this.swipeY0 - t.clientY   // 上滑为正
      const dx = Math.abs(t.clientX - this.swipeX0)
      if (this.panelDrag === null) {
        // 还没进入拖动：要"明显竖向上滑"才接管，否则交给页面正常滚动
        if (dy <= 12 || dy <= dx) return
        this.dragging = true
        this.panelDrag = 100   // 从全关（进度 0）开始跟手
      }
      const H = this.panelHpx()
      let pct = 100 - (dy / H * 100)
      pct = Math.max(0, Math.min(100, pct))
      this.panelDrag = pct
      if (e && e.preventDefault) e.preventDefault()
    },
    homeSwipeEnd(e) {
      if (this.drawerOn || this.editing || this.locked) { this.swipeY0 = 0; this.swipeX0 = 0; return }
      if (!this.restCount) { this.swipeY0 = 0; this.swipeX0 = 0; return }
      if (this.panelDrag !== null) {
        // 跟手拖动中松手：拉过一半就开，否则弹回
        const commit = this.panelDrag < 50
        this.dragging = false
        this.panelDrag = null
        this.swipeY0 = 0; this.swipeX0 = 0
        this.drawerOn = commit
        return
      }
      // 没进入拖动的兜底：快速一甩也开（阈值同前）
      const startY = this.swipeY0
      if (!startY) { this.swipeY0 = 0; this.swipeX0 = 0; return }
      const t = (e && e.changedTouches && e.changedTouches[0]) ||
                (e && e.touches && e.touches[0]) || null
      if (!t) { this.swipeY0 = 0; this.swipeX0 = 0; return }
      const dy = startY - t.clientY
      const dx = Math.abs((this.swipeX0 || 0) - t.clientX)
      this.swipeY0 = 0; this.swipeX0 = 0
      if (dy > 56 && dx < dy * 0.6 && startY > this.winH * 0.55) {
        this.drawerOn = true
      }
    },
    /** 抽屉里那道把手：往下拉 = 收起，同样跟手；拉过一半松手才关，否则弹回 */
    gripStart(e) {
      this.gripY = (e && e.touches && e.touches[0]) ? e.touches[0].clientY : 0
      this.dragging = true
    },
    gripMove(e) {
      if (!this.drawerOn) return
      const t = (e && e.touches && e.touches[0]) || null
      if (!t) return
      const dy = t.clientY - this.gripY   // 下拉为正
      if (this.panelDrag === null) {
        if (dy <= 6) return
        this.panelDrag = 0
      }
      const H = this.panelHpx()
      let pct = dy / H * 100
      pct = Math.max(0, Math.min(100, pct))
      this.panelDrag = pct
    },
    gripEnd() {
      // 没进入拖动也要复位 dragging —— 否则点一下标题（没拖出 6px）
      // dragging 永远是 true，所有过渡被关掉，界面看着像冻住了
      if (this.panelDrag === null) { this.dragging = false; this.gripY = 0; return }
      // 下拉收起：往下拖过面板一半才算数（与上滑"过半才开"对称）。
      // ⚠️ 方向别写反：panelDrag 是"离开的距离"，下拉收起时要 > 50 才提交；
      //    写成 < 50 会变成"轻碰就收、使劲拉反而弹回"。
      const commit = this.panelDrag > 50
      this.dragging = false
      this.panelDrag = null
      this.gripY = 0
      if (!commit) return        // 没拉过半 → 维持打开
      this.closeDrawer()          // 拉过半 → 收起
    },
    // ---------- 首页编辑 ----------
    toggleEdit() {
      this.editing = !this.editing
      // 进编辑态必须先把抽屉拉开：把手、收纳、排序全在抽屉里那一摞卡片上，
      // 收着的时候点「编辑首页」等于进了一个什么都看不见的编辑态。
      if (this.editing) this.drawerOn = true
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
    // 抽屉卡片样式：
    //  · 编辑态 → 只有被拖的那张跟手偏移（排序）；
    //  · 展示态 → 按"展开进度"逐张错拍淡入 + 升起（scroll-linked stagger）：
    //    第 i 张在 [i*span, i*span+0.55] 区间内渐显，span 按张数归一，
    //    保证最后一张恰好在 openProg=1 时完全显现 —— 手指滑到哪，哪张卡出头。
    wrapStyle(i) {
      if (this.editing) {
        if (this.dragIndex !== i) return ''
        return 'transform: translateY(' + this.dragDy + 'px); z-index: 30;'
      }
      const n = this.restOrder.length
      const span = n > 1 ? 0.45 / (n - 1) : 0
      const p = Math.max(0, Math.min(1, (this.openProg - i * span) / 0.55))
      if (p >= 1) return ''
      return 'opacity: ' + p.toFixed(3) + '; transform: translateY(' + ((1 - p) * 26).toFixed(1) + 'px);'
    },
    noop() {},
    // ---------- 今日紧迫度 ----------
    // 纯本地计算（utils/urgency.js，不调 AI）：首页每次刷新都要重算，
    // 因为"还剩多少时间"是走动的 —— 时间条不跟着走就失真了。
    refreshUrgency() {
      try { this.u = urgency.compute() } catch (e) { this.u = {} }
    },
    // 卡面上只放"标题 + 档位 + 三行读数"这点字，完整解释收进这个 ? 弹窗 ——
    // "看一眼就知道今天紧不紧张"这件事，图形比文字快。
    explainUrgency(u) {
      const v = u || this.u || {}
      const lv = urgency.levelName(v.level)
      const left = v.over
        ? this.$t('剩下的活已经排不进今天了（时间条顶到头并在闪）')
        : this.$t('还剩 {n} 分钟可用，够做这些', { n: v.availMin || 0 })
      this.ask({
        title: this.$t('今日紧迫程度 · {lv}', { lv: lv }),
        content:
          this.$t('① 圆环填充 = 紧迫度 {n}/100', { n: v.score || 0 }) + '\n' +
          this.$t('② 中心呼吸 = 越急跳得越快') + '\n' +
          this.$t('③ 方块 = 还剩 {a} 段专注（实心），已做 {b} 个（空心）',
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
    /**
     * 有新版本时问一次。
     *
     * 排在关联询问**之后**再晚一点：它延迟 1.2s，等它先问完。
     * 已经有别的弹窗/询问在场就**不抢**，这次进首页不弹了 —— 下次进来再说。
     * 更新提醒再重要，也比不上"用户正在办的事"。
     */
    maybeUpdatePrompt() {
      setTimeout(() => {
        // 页面上的弹窗状态只有这里看得到，所以"忙不忙"由页面传给 updater
        try { updater.promptOnce({ busy: !!this.dlg.show }) } catch (e) {}
      }, 1800)
    },
    // ---------- 新手引导（步骤与状态在 utils/onboarding.js）----------

    /**
     * 该不该放引导：第一次进入（或设置页点了「重看」）才放。
     * 返回 true 表示"引导在场"，调用方据此让路，别把别的弹窗叠上来。
     */
    maybeGuide() {
      if (this.gdOn) {
        // 上一次量位置还没落地（遮罩空白）人就切走了 —— 补一次，别把引导卡成一个隐形层
        if (!this.gdStep) this.measureStep()
        return true
      }
      if (this.locked) return false   // 正在专注，首页被倒计时硬控，卡片都没了
      let show = false
      try { show = onboarding.shouldShow() } catch (e) { show = false }
      if (!show) return false
      this.gdOn = true
      this.gdIndex = 0
      this.gdBox = null
      // 引导要挖洞的是 .focus-card / .task-card，而它们住在折叠区里 ——
      // 收着的时候量不到矩形，那两步会被当"目标不存在"跳过，引导讲一半。
      this.drawerOn = true
      // 等卡片渲染完再量：首帧 layout 还没落地，量到的矩形是空的
      this.$nextTick(() => { setTimeout(() => { this.measureStep() }, 320) })
      return true
    },

    /**
     * 量当前步的目标矩形。量不到（模块被收纳 / 结构改了 / 正在硬控）
     * 就**自动跳过这一步** —— 绝不把用户卡死在引导里。
     * @param {boolean} retried 已经为这一步滚过一次了（防止来回滚不停）
     */
    measureStep(retried) {
      const step = onboarding.stepAt(this.gdIndex)
      if (!step) { this.endGuide(); return }
      const t = step.target
      if (!t) { this.gdBox = null; this.gdStep = step; return }  // 欢迎步：整屏居中
      const got = (rect) => {
        if (!rect || !rect.width || !rect.height) { this.guideAdvance(); return }
        // 目标不在视口里（首页往下滚过 / 转屏后布局变了）：先把页面滚到它可见再量一次。
        // 滚完还是看不见就退化成"居中讲解"—— 宁可没有挖洞，也别把这一步整步吞掉，
        // 用户会以为引导坏了（这一步讲的正是最该知道的入口）。
        if (!this._inView(rect) && !retried && !t.ref) {
          try {
            uni.pageScrollTo({ selector: t.sel, duration: 200 })
            setTimeout(() => { if (this.gdOn) this.measureStep(true) }, 280)
            return
          } catch (e) { /* 不支持滚动定位 → 走下面的居中兜底 */ }
          this.gdBox = null
          this.gdStep = step
          return
        }
        if (!this._inView(rect)) {
          this.gdBox = null
          this.gdStep = step
          return
        }
        this.gdBox = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        this.gdStep = step
      }
      if (t.ref) {
        const c = this.$refs[t.ref]
        if (c && typeof c.rect === 'function') { c.rect(t.sel, got); return }
        this.guideAdvance()
        return
      }
      try {
        uni.createSelectorQuery().in(this).select(t.sel).boundingClientRect(got).exec()
      } catch (e) { this.guideAdvance() }
    },

    /** 量到的矩形是否整个落在视口里（留 8px 余量，贴边不算"看得见"） */
    _inView(rect) {
      if (!rect || !rect.height) return false
      let vh = 667
      try { vh = uni.getSystemInfoSync().windowHeight || 667 } catch (e) {}
      return rect.top >= 8 && rect.top + rect.height <= vh - 8
    },

    /** 转屏 / 分屏 / 折叠屏展开：旧矩形作废，等布局落地后重新量当前这一步 */
    guideResize() {
      if (!this.gdOn || !this.gdStep) return
      setTimeout(() => { if (this.gdOn) this.measureStep() }, 160)
    },

    /** 推进一步；走完就收尾并落盘（下次不再放） */
    guideAdvance() {
      const r = onboarding.advance(this.gdIndex, onboarding.count())
      this.gdIndex = r.index
      this.gdBox = null
      this.gdStep = null
      if (r.done) { this.endGuide(); return }
      this.$nextTick(() => this.measureStep())
    },
    guideNext() {
      this.guideAdvance()
    },
    guideSkip() {
      this.endGuide()
    },
    /** 正常收尾：记完成，下次不再放 */
    endGuide() {
      this.stopGuide()
      try { onboarding.finish() } catch (e) {}
    },
    /** 只收起不记完成（比如专注起表把卡片顶掉了）—— 下次进首页再放一遍 */
    stopGuide() {
      this.gdOn = false
      this.gdStep = null
      this.gdBox = null
      this.gdIndex = 0
    },

    maybeSetupPrompt() {
      let need = false
      try { need = setup.shouldPrompt() } catch (e) { need = false }
      if (!need) return
      setup.markPrompted()
      // 文案按**实际缺哪几项**生成，不写死一份名单：开了强制模式会多出「显示在其他
      // 应用上层」和「无障碍」，写死的话加一项就漏一条 —— 用户照着弹窗开完还是缺，
      // 于是永远拉不回来，还查不出为什么。
      const names = setup.pendingNames()
      this.ask({
        title: '先开几个权限',
        // names 一定非空（pending 为空时 shouldPrompt 就返回 false 了），不必再兜底
        content: names.join('、') +
          ' —— 不开的话专注锁屏会被系统回收、学习 App 列表读不出来。现在去设置吗？',
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
     * 最后那条是硬规矩：一个"可选的关联"，不配打断一次专注。
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
    // ---------- 专注 ----------
    // 首页被"硬控"时，这三个就是全部操作：让时间继续 / 让时间停下 / 不学了
    togglePause() {
      if (!this.cur) { this.goFocus(); return }
      if (this.cur.paused) focus.resume()
      else focus.pause()
      this.cur = focus.current()
      strict.sync()
      forced.sync()
    },
    /** 正计时收摊：专注早就跑满，按完整专注落账（含多坐的那段），然后回空闲态 */
    exitOverrun() {
      focus.stopOverrun()
      this.cur = null
      this.refresh()
      strict.sync()
      forced.sync()
    },

    /* ==================== 首页「专注设置」卡片（顶栏右上角胶囊点开） ====================
       把强制模式 / 拦截通知 / 自动进休息三项收进同一张卡片，仿番茄 ToDo 把同类设置收进一处。
       逻辑与专注页同口径（未授权就引导去开，绝不假称已生效），只是入口前置到首页，少跳一层。 */

    /** 展开 / 收起「专注设置」卡片（编辑态与硬控态不响应，免得盖住编辑按钮或倒计时） */
    toggleFocusSheet() {
      if (this.editing || this.locked) return
      this.focusSheet = !this.focusSheet
    },
    /** 面板里的"强制模式"开关：与专注页 toggleForced 同口径（记录意图 + 缺权限引导）。
       真正的拉回能力在专注开始时随前台服务一起起来，这里只管"开了没、权限齐不齐"。 */
    tapForced() {
      const next = !this.forcedOn
      this.forcedOn = next
      this.saveFocus('forced', next)
      if (next) {
        apptime.refreshA11y && apptime.refreshA11y()
        this.usageOk = apptime.hasUsagePermission()
        this.overlayOk = apptime.canDrawOverlays()
        this.a11yOk = apptime.hasA11yPermission()
        // 悬浮窗是强制模式的准入条件（不是兜底）：没有它安卓 10+ 拉回路全被静默拦掉。
        // 先报这条最要紧的，并直接给路；其余权限交给「设置」页统一引导。
        if (!this.overlayOk) {
          uni.showToast({ title: this.$t('强制模式需开启「显示在其他应用上层」'), icon: 'none' })
          setTimeout(() => this.openOverlayHome(), 900)
        } else if (!this.a11yOk && !this.usageOk) {
          this.goSetup()
        }
      }
      forced.sync()
    },
    /** 面板里的"拦截通知"开关：未授权先引导去开「通知使用权」 */
    tapBlockNotif() {
      if (!this.blockNotifOn && !fgsvc.notifGranted()) {
        this.ask({
          title: this.$t('拦截通知'),
          content: this.$t('专注期间把别家 App 的通知收起来（下拉通知栏也看不到），专注结束再汇总发给你。需要「通知使用权」权限。'),
          confirmText: this.$t('通知使用权没开启，点这里去开启'),
          action: 'goto-notif'
        })
        return
      }
      const next = !this.blockNotifOn
      this.blockNotifOn = next
      this.saveFocus('blockNotif', next)
    },
    /** 面板里的"自动进休息"开关 */
    tapAutoRest() {
      const next = !this.autoRestOn
      this.autoRestOn = next
      this.saveFocus('autoRest', next)
    },
    /** 把单项专注开关落盘（浅合并，绝不丢别的字段） */
    saveFocus(key, val) {
      try {
        const st = settings.get()
        st.focus = Object.assign(
          { notify: true, sound: true, vibe: true, fgservice: true, blockNotif: false, autoRest: true, forced: false },
          st.focus || {},
          { [key]: val }
        )
        settings.save()
      } catch (e) {}
    },
    /** 跳系统「显示在其他应用上层」设置页；跳回来再补一次实测 */
    openOverlayHome() {
      try { apptime.openOverlaySettings() } catch (e) {}
      setTimeout(() => { this.overlayOk = apptime.canDrawOverlays() }, 1200)
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
    /**
     * 取消也要收尾：待确认队列那条被"先不动"驳回后必须出队，
     * 否则它会在每次进首页时又弹一遍 —— 用户明明已经拒绝过了。
     */
    onDlgCancel() {
      const act = this.dlg.action
      this.dlg.show = false
      if (act === 'replan-pending') {
        let r = { msg: '' }
        try { r = harvest.resolvePending(0, false) } catch (e) {}
        try { uni.showToast({ title: r.msg || '好，先不动', icon: 'none', duration: 2000 }) } catch (e) {}
      }
    },
    onDlgYes(payload) {
      const act = this.dlg.action
      const item = this.dlg.item
      this.dlg.show = false
      if (act === 'goto-notif') {
        // 跳系统「通知使用权」设置页；跳不出去（插件不在 / 标准基座）就只能如实算了
        try { fgsvc.openNotifSettings() } catch (e) {}
        return
      }
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
      // 需求 6：AI 掌握的数据不足以判断最优排版 → 先问本人一句最新意见，
      // 拿到就存进 lastNote 并**立刻带这句话重排一次**（不是"记下来下次再说"）
      if (act === 'replan-note') {
        const v = String(payload || '').trim()
        if (!v) { this.maybePendingAsk(); return }
        try { harvest.saveNote(v) } catch (e) {}
        try { uni.showToast({ title: '记下了，正在按你说的重排', icon: 'none', duration: 2000 }) } catch (e) {}
        this.runReplanFlow()
        return
      }
      // 砍任务 / 顺延截止日：不自动落地的那两条，逐条问一次
      if (act === 'replan-pending') {
        let r = { ok: false, msg: '' }
        try { r = harvest.resolvePending(0, true) } catch (e) {}
        try { uni.showToast({ title: r.msg || '好', icon: 'none', duration: 2400 }) } catch (e) {}
        this.refresh()
        // 后面可能还排着别的待确认 —— 问完这一条接着问下一条
        this.$nextTick(() => { setTimeout(() => this.maybePendingAsk(), 600) })
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
      strict.sync()   // 严格模式跟专注同步：有在跑才轮询，没在跑一次都不查
      forced.sync()   // 强制模式同理：只有「正在专注且没暂停」才盯着前台
      if (r.justOverrun) {
        // 预设时长跑满 → 转正计时（不再弹"休息一下"：人还没说要走）
        this.refresh()
        uni.showToast({ title: this.$t('专注时间到'), icon: 'none' })
        strict.sync()
        forced.sync()
      } else if (r.justFinished === 'focus') {
        this.refresh()
        uni.showToast({ title: '专注完成！休息一下', icon: 'success' })
      }
      this.checkRemind()
    },
    /**
     * 到点催一句：每日提醒（目标上定的时间）+ 时段提醒（任务排在早/中/晚，到段就催）。
     *
     * 每分钟查一次，不是每秒 —— 提醒是分钟级的事，没必要跟着秒针转。
     * ⚠️ 边界说清楚：这是"App 前台时准点 + 没开着时下次进 App 补一句（当天一次）"。
     *    要做到"没打开 App 也准点响"得用系统闹钟（原生 AlarmManager），那要进 UTS 插件。
     */
    checkRemind() {
      if (this.locked) return   // 正在专注就不打扰了：提醒的是"还没开始"
      const m = new Date().getMinutes()
      if (m === this.__remindMin) return
      this.__remindMin = m
      try { reminder.check() } catch (e) {}
      try { reminder.checkSlot() } catch (e) {}
    },
    startFor(item) {
      if (this.cur) {
        uni.showToast({ title: '有一段专注正在进行', icon: 'none' })
        return
      }
      uni.navigateTo({
        url: '/pkgPlan/pages/focus/focus?taskId=' + item.task.id +
             '&goalId=' + item.goal.id +
             '&title=' + encodeURIComponent(item.task.title)
      })
    },
    /**
     * 拼专注页链接。
     * 默认绑当天第一个没做完的任务：首页的"开始"应该接着计划走，
     * 而不是每次都是游离于计划之外的自由专注（想自由去专注页自己选）。
     * 推荐时长由专注页按任务剩余量算（见 focus.applySuggest）。
     *
     * ⚠️ 这里**不拼任何"进页面就起表"的标记**（以前有个 auto=1）。
     * 起表是有成本的动作：首页立刻被硬控、严格模式开始记账、强制模式开始拦截。
     * 让人先在准备态看清时长与配置、自己按下确认，才谈得上"这一轮是我决定的"。
     */
    focusUrl() {
      const q = []
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
     * 点专注卡 / 计时环 = 进专注页的准备态，**不自动开始**。
     * 计时是件有成本的事（起表后首页被硬控、严格模式开始记账），
     * 不能因为手指落在卡片空白处就莫名其妙开始一轮。
     */
    goFocus() {
      uni.navigateTo({ url: this.focusUrl() })
    },
    /**
     * 卡片上的「开始」按钮：与点卡片同一个落点 —— 进准备页，**不直接起表**。
     *（2026-10-14 真机反馈："一点开始就直接倒计时了，我还没看清是几分钟"。）
     * 计时逻辑本身没动，收窄的只是入口：起表仍然只有准备页那颗确认按钮。
     */
    quickStart() {
      this.goFocus()
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
    /**
     * 专注已做满但还没勾：列表里显示「专注已满」待勾徽标。
     * 为什么要有：紧迫度按专注算（做满 = 今天没活了 → 从容），任务列表按勾没勾算
     * （没勾 = 还挂着 3 条没完成）—— 两边口径打架，真机上用户看着"一堆活没干
     * 却显示不急"。把"就差你点一下"摆到明处；点徽标 = 走勾选链（同勾选圈）。
     */
    fullOf(item) {
      const t = item && item.task
      if (!t || t.status !== 'todo') return false
      const total = Number(t.pomos) || 0
      return total > 0 && (Number(t.donePomos) || 0) >= total
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
      // 勾完成 → 弹「恭喜你完成任务」（取消完成不弹）
      if (r.done) {
        this.openDoneDialog({
          goalId: item.goal.id, id: item.task.id,
          title: item.task.title, goalTitle: item.goal.title
        })
      }
    },
    markDone(item) {
      pw.setTaskStatus(item.goal.id, item.task.id, 'done')
      pw.flush()
      this.refresh()
      this.openDoneDialog({
        goalId: item.goal.id, id: item.task.id,
        title: item.task.title, goalTitle: item.goal.title
      })
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

/* ===== 主页聚焦布局：开始专注居中，周边淡化 =====
   根容器 .page-nav 顶部占掉 (状态栏 + 136rpx)，.page-tabbar 底部占掉
   (220rpx + 安全区)；这里撑起剩下的全部可视高度做成 flex 列，
   「开始专注」靠上下 auto margin 推到正中，任务 / 紧迫度退到底部并淡化
   （见 .hcard.task-card / .urg-card），收工压在最底 —— 视觉焦点只剩一处。 */
.home-slide {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  /* 与 .page-nav / .page-tabbar 的占位口径一致（两行写法兜底不支持 env 的端） */
  min-height: calc(100vh - var(--status-bar-height, 0px) - 136rpx - 220rpx - var(--safe-bottom, 0px));
  min-height: calc(100vh - var(--status-bar-height, 0px) - 136rpx - 220rpx - var(--safe-bottom, 0px) - env(safe-area-inset-bottom));
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

/* 紧迫度卡：卡片头那行字是组件自己画的（标题 + 档位胶囊 + ?），
   所以这里不用再套一层 .card-head，留白比通用卡紧一点。 */
.urg-card { padding: 30rpx 36rpx 32rpx; }

/* ===== 专注进行中：首页被倒计时"硬控" =====
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
/* 正计时说明：环上那个 +MM:SS 是什么意思，得写出来 ——
   否则用户只会以为"倒计时卡在 00:00 不动了" */
.lock-over {
  margin-top: 18rpx;
  font-size: 22rpx; line-height: 1.6;
  text-align: center;
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
/* 自动重排的结果：改了什么写一句在这儿，用户才知道"我说的话真的有用" */
.sc-tip {
  display: block; margin-top: 16rpx;
  font-size: 22rpx; line-height: 1.6;
  color: #b26400; color: var(--ink-2, #b26400);
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

/* ===== 专注计时状态卡 ===== */
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

/* ===== 首页「专注设置」卡片（顶栏右上角胶囊点开弹出） =====
   遮罩弹层：半透明压暗背景，卡片居中浮起；与 app-dialog 同一套玻璃语言。 */
.fs-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(23, 32, 26, 0.32);
  background: rgba(var(--shadow-rgb, 23, 32, 26), 0.32);
  padding: 48rpx;
  box-sizing: border-box;
}
.fs-card {
  width: 100%;
  max-width: 620rpx;
  padding: 12rpx 30rpx 18rpx;
  border-radius: 28rpx;
  background: rgba(255, 255, 255, 0.86);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.86);
  -webkit-backdrop-filter: var(--glass-lg, blur(16px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(16px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  box-shadow: 0 20rpx 60rpx rgba(23, 32, 26, 0.18), 0 4rpx 12rpx rgba(23, 32, 26, 0.08);
  box-shadow: 0 20rpx 60rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.18), 0 4rpx 12rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.08);
}
.fs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 2rpx 14rpx;
}
.fs-title {
  font-size: 30rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.fs-close {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  line-height: 1;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  border-radius: 50%;
  transition: opacity 160ms ease;
}
.fs-close:active { opacity: 0.6; }

/* 卡片内每行开关（与底部胶囊时期共用，原样保留） */
.fc-row {
  display: flex;
  align-items: center;
  padding: 18rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.07);
  border-bottom: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.07));
}
.fc-row:last-child { border-bottom: none; }
.fc-info { flex: 1; min-width: 0; margin-right: 18rpx; }
.fc-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.fc-sub {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  line-height: 1.5;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
/* 强制模式缺悬浮窗：给一条可点的路（与顶栏引导同一句文案） */
.fc-warn {
  margin: 4rpx 0 12rpx;
  padding: 14rpx 20rpx;
  border-radius: 14rpx;
  background: rgba(247, 144, 9, 0.14);
  font-size: 22rpx;
  line-height: 1.5;
  color: #b25e00;
  text-align: center;
}
.fc-warn:active { opacity: 0.8; }

/* iOS 风开关（与专注页 .sr-switch 同语言） */
.fc-switch {
  position: relative;
  flex-shrink: 0;
  width: 84rpx;
  height: 48rpx;
  border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.16);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.16);
  transition: background 200ms ease;
}
.fc-switch-on {
  background: rgba(228, 23, 61, 0.9);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.9);
}
.fc-knob {
  position: absolute;
  top: 4rpx;
  left: 4rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2rpx 6rpx rgba(23, 32, 26, 0.2);
  transition: transform 200ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
.fc-knob-on { transform: translateX(36rpx); }

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
/* 专注做满还没勾：勾选圈换成绿色描边（"就差你点一下"），徽标同色系淡底 */
.tk-check-full {
  border-color: #3b6d11;
  border-width: 3rpx;
}
.tk-full {
  margin-left: 10rpx;
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  background: rgba(59, 109, 17, 0.12);
  color: #3b6d11;
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

/* ===== 首页模块编辑（拖拽排序 / 收纳 / 加回）=====
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

/* ===== 主页三卡：今天要用的（专注 / 任务 / 紧迫度）=====
   这三张不是"把完整卡缩小"，而是**为首页重写的精简版**：
   每张只回答一个问题，其余信息一律不摆 —— 想看全的往下翻抽屉。
   ① 开始专注：焦点只有那颗键
   ② 今日任务：焦点是"下一条做什么"，只列三条
   ③ 今日紧迫度：焦点是"还剩多久"，一条时间轴说完 */
.hcards { display: flex; flex-direction: column; gap: 20rpx; flex: 1 1 auto; min-height: 0; }
.hcard {
  padding: 30rpx 28rpx;
  display: flex;
  align-items: center;
}
.hcard-press { opacity: 0.86; }

/* ① 开始专注：在 .hcards 里用上下 auto margin 推到正中；竖向居中排布，做整屏唯一视觉中心。
     周边两张卡（任务 / 紧迫度）各自退到上下边缘并淡化，不抢"开始专注"的焦点 */
.hcard.focus-card {
  flex: 0 0 auto;
  margin: auto 0;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 40rpx 32rpx;
}
.hcard.focus-card .hc-ring { width: 168rpx; height: 168rpx; margin: 0 0 24rpx; }
.hcard.focus-card .hc-ring-num { font-size: 46rpx; }
.hcard.focus-card .hc-go {
  margin: 28rpx 0 4rpx;
  width: 248rpx;
  height: 86rpx;
  font-size: 30rpx;
  font-weight: 600;
}
.hcard.focus-card .hc-title { margin-top: 12rpx; }
.hcard.focus-card .hc-time { margin-top: 10rpx; }
/* 周边两张：退到上下边缘并淡化，强化"中心聚焦"的视觉关系 */
.hcard.task-card,
.hcard.urg-card {
  flex: 0 0 auto;
  opacity: 0.74;
  transform: scale(0.97);
  transform-origin: center;
}

/* ① 开始专注：环是今日累计读数；在 .focus-card 里被放大并居中（见上文 .hcard.focus-card） */
.hc-ring {
  width: 132rpx;
  height: 132rpx;
  flex: 0 0 auto;
  margin-right: 24rpx;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  border: 2rpx solid rgba(228, 23, 61, 0.28);
  border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.28);
}
.hc-ring-run { animation: hc-breath 2.4s ease-in-out infinite; }
@keyframes hc-breath {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.045); }
}
.hc-ring-num {
  font-size: 38rpx;
  font-weight: 600;
  line-height: 1.1;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.hc-ring-unit {
  margin-top: 2rpx;
  font-size: 19rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
.hc-body { flex: 1; min-width: 0; }
.hc-title {
  display: block;
  font-size: 31rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.hc-sub {
  display: block;
  margin-top: 6rpx;
  font-size: 23rpx;
  line-height: 1.45;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hc-time {
  display: block;
  margin-top: 8rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
}
.hc-go {
  flex: 0 0 auto;
  margin-left: 18rpx;
  height: 72rpx;
  padding: 0 34rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 27rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
  border-radius: 999rpx;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  border: 2rpx solid rgba(228, 23, 61, 0.4);
  border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.4);
}
.hcard.task-card,
.hcard.urg-card { flex-direction: column; align-items: stretch; }
.hc-head { display: flex; align-items: baseline; justify-content: space-between; }
.hc-count { font-size: 23rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
/* 进度条：实心色只用在进度条上（项目令牌：不给按钮上实心红） */
.hc-bar {
  height: 8rpx;
  margin: 18rpx 0 6rpx;
  border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.09);
  overflow: hidden;
}
.hc-fill {
  height: 100%;
  border-radius: 999rpx;
  background: #e4173d;
  background: var(--brand, #e4173d);
  transition: width 240ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
.hc-task {
  display: flex;
  align-items: center;
  padding: 16rpx 4rpx;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.05);
}
.hc-task-lead .hc-task-title { font-weight: 600; }
/* 按下的反馈：只压一点底色，不用实心红（实心红留给进度条 / 开关 / 选中态） */
.hc-task-press { background: rgba(23, 32, 26, 0.04); }
.hc-task-col { flex: 1; min-width: 0; margin-left: 14rpx; }
.hc-task-title {
  display: block;
  font-size: 27rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hc-empty { padding: 8rpx 0 4rpx; }
.hc-more { padding: 14rpx 4rpx 2rpx; text-align: right; }
.hc-more .hc-sub { color: #98a19b; color: var(--ink-3, #98a19b); }

/* ③ 今日紧迫度：一条 24 小时时间轴 + 两个读数 */
.hc-lv {
  flex: 0 0 auto;
  padding: 4rpx 18rpx;
  border-radius: 999rpx;
  font-size: 21rpx;
  font-weight: 600;
}
.hc-axis {
  position: relative;
  height: 12rpx;
  margin: 20rpx 0 14rpx;
  border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.08);
  overflow: hidden;
  display: flex;
}
/* 已经过去的那一段（灰） */
.hc-axis-past { height: 100%; background: rgba(23, 32, 26, 0.12); }
/* 还要花多久（品牌色，跟着 accent 主题走） */
.hc-axis-need { height: 100%; background: #e4173d; background: var(--brand, #e4173d); }
/* "现在"这条竖线 */
.hc-axis-now {
  position: absolute;
  top: -4rpx;
  bottom: -4rpx;
  width: 4rpx;
  margin-left: -2rpx;
  border-radius: 2rpx;
  background: #17201a;
  background: var(--ink-1, #17201a);
}
.hc-foot-row { display: flex; align-items: baseline; justify-content: space-between; }

/* ===== 底部"抽屉"：其余组件住在这儿 =====
   上滑时主页整列上移并轻微缩小（后退一层），抽屉这块**玻璃底板**小幅上顶，
   卡在底板上的卡片按展开进度逐张淡入 + 升起（见 wrapStyle 的错拍）——
   两层不同速、不同大小，才有"抽屉压上来"的景深，而不是同一列接着排。
   外层 .dr-mask 只是透明的点击承接层（开着时点空白处 = 收起），**不压暗整屏**。 */
.dr-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 620;
  background: transparent;
  display: flex;
  align-items: flex-end;
  /* 常驻但默认不挡触摸，开=承接点击。只动 opacity/pointer-events，不掉帧 */
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
}
.dr-mask.on {
  opacity: 1;
  pointer-events: auto;
}
.dr-panel {
  /* ⚠️ 必须 border-box：width:100% + padding 在 content-box 下会溢出右边缘，
     卡片整体"向右偏"被屏幕裁掉一截（真机视频 2026-10-16 实锤） */
  box-sizing: border-box;
  width: 100%;
  height: 76vh;
  display: flex;
  flex-direction: column;
  padding: 0 24rpx;
  /* ★ 层级感：整块玻璃底板（圆角 + 毛玻璃 + 上沿阴影）。
     之前把它做成完全透明，结果抽屉卡片和主页卡片成了"同一层里接着排"，
     读不出谁盖着谁。有这块底板，抽屉才明确浮在首页之上 ——
     但它是**玻璃**不是实色 sheet：底下主页的余光还透得过来，
     不会退回"一张白板压上来"的老观感。 */
  border-radius: 40rpx 40rpx 0 0;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.82);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  box-shadow: 0 -16rpx 44rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.22);
  border-top: 2rpx solid rgba(255, 255, 255, 0.55);   /* 玻璃上沿的高光边 */
  /* 视差由 panelStyle 内联给（跟手时关过渡）；松手后靠这条补完 */
  transition: transform 0.34s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}
.dr-panel.dragging {
  transition: none;
}
/* 主页整列松手后的补完过渡：拖动中由 homeShift 内联关掉（跟手），
   松手后交给这条，弹到终态。
   ★ transform-origin 固定在上方偏中：主页后退时是"整体往里收"，
     不是绕各自中心缩 —— 否则三张卡各自缩放，之间的间距会跟着乱跳。 */
.hcards,
.home-cta {
  transform-origin: 50% 22%;
  transition: transform 0.34s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease;
  will-change: transform;
}
/* 抽屉把手 / 底部编辑区：随展开进度 --open 淡入 + 升起
   （--open 由 panelStyle 内联在 .dr-panel 上，子元素继承）。
   卡片本体不在这一组：它们的显现走 wrapStyle 内联（逐张错拍）。 */
.dr-grip,
.home-foot {
  opacity: var(--open, 0);
  transform: translateY(calc((1 - var(--open, 0)) * 28rpx));
  transition: opacity 0.34s ease, transform 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}
/* 抽屉卡片：松手后补完淡入/升起的过渡。拖动中关掉（跟手）；
   编辑态（is-editing）例外：排序拖动不能带过渡，否则跟手发糊 */
.mod-wrap:not(.is-editing) {
  transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.dr-panel.dragging .dr-grip,
.dr-panel.dragging .home-foot,
.dr-panel.dragging .mod-wrap:not(.is-editing) {
  transition: none;
}
/* 抽屉把手：往下拖 = 收起（touch-action 禁掉滚动手势，拖动时页面不跟着走）。
   上下 padding 撑出足够大的热区 —— 之前只有"全部组件"四个字那么大，
   真机上根本抓不住，抽屉收不回去（2026-10-16 视频实锤） */
.dr-grip {
  flex: 0 0 auto;
  padding: 34rpx 0 26rpx;
  margin: 0 -24rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  touch-action: none;
}
.dr-title {
  margin-top: 10rpx;
  font-size: 24rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
.dr-body {
  flex: 1;
  min-height: 0;
  padding-bottom: calc(40rpx + var(--safe-bottom, 0px));
}
</style>
