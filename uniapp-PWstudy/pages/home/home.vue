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
    <!-- ===== 主页撤退时的"毛玻璃"层（背单词 App 的 hero-glass 等价物） =====
         上滑时整张主页后退、淡出，这层在它背后把**背景**糊成一片 ——
         静止（滚动进度 0）时 opacity:0，背景必须是高清原图；只有"动起来"才糊。
         ⚠️ 必须是 .page-slide / 带 opacity 的祖先之外、且自身不做 opacity 祖先：
         一旦某一层成了 backdrop root，子级的 backdrop-filter 只能糊到那一层内部。
         这里挂在 .container 下、自身 opacity 由内联单独控制，安全。 -->
    <view class="hero-glass" :style="heroGlassStyle"></view>

    <float-navbar title="PWstudy" :focus-btn="!locked" :focus-on="focusSetOn" @open-focus="toggleManage" />

    <view class="page-slide home-slide" :class="slideCls" :style="slideStyle">

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
           权限没开是真的会让计时断掉的，不该被用户收起来。
           右上角那个 × 是"我知道，别拿它烦我"：按缺项逐条记（见 setup.mutePending），
           以后冒出**新**的缺项还会再提醒。没有这个出口的话，权限一天不开，
           这张卡就一天压在首屏上、把下面几张卡全挤下去。 -->
      <view v-if="setupPending.length" class="card setup-card">
        <view class="sc-main" @tap="goSetup()">
          <view class="sc-badge">{{ setupPending.length }}</view>
          <view class="sc-info">
            <view class="sc-title">还有设置没完成</view>
            <view class="sc-sub">{{ setupNames }} · 不处理的话计时可能锁屏就断</view>
          </view>
          <text class="sc-go">去设置 ›</text>
        </view>
        <view class="sc-x" hover-class="sc-x-press" hover-stay-time="80" @tap.stop="muteSetup">×</view>
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
      <!-- 整块首屏的位移 / 渐隐由 .home-hero / .hero-body 的内联样式给（跟随滚动进度）。
           三张卡的顺序是固定的（今天要用的就这三样），不参与排序与收纳。 -->
      <!-- ===== 首屏：一屏装下"今天要用的三张卡 + 收工" =====
           ⚠️ 它自己撑满一屏（见 CSS .home-hero 的 min-height）：下面那摞模块卡
           静止时**必然**落在折叠线之下，是**结构**保证的，不靠 opacity 藏 ——
           靠 JS 算初值的话，脚本一环没跑卡片就永久不见（同类实现已经踩过）。
           上滑时整块首屏随滚动上抬、缩小、渐隐（heroCardStyle / heroBodyStyle），
           下面那摞卡从折叠线下被推上来 —— 两层不同速，才有"另一层被拉上来"的景深。 -->
      <view class="home-hero" :style="heroCardStyle">
      <view class="hero-body" :style="heroBodyStyle">
      <!-- 首屏内容整组（三张卡 + 收工按钮）：整组用 auto margin 在首屏里垂直居中。
           内容比首屏高时 auto margin 自动归零、从顶部顺排 —— 不会把卡片顶部裁到导航栏下。
           组内一律 20rpx 等距；不再让「开始专注」单独居中、把任务卡甩到屏幕底，
           那样中间会空出一大截，看着割裂（2026-10-24 反馈"大量的缝隙和空间"）。 -->
      <view class="hero-main">
      <view class="hcards">
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
              <view v-if="hasMoreTask" class="hc-more" @tap="goCalendar">
                <text class="hc-sub">{{ $t('查看全部 ›') }}</text>
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
      <view v-if="!editing" class="home-cta">
        <button class="btn-primary cta-btn" @tap="goDaily()">{{ checked ? '改一下今天的收工' : '今日收工' }}</button>
        <text class="cta-tip">{{ checked ? '今天已经记过了，想改随时点开' : '花十几秒说说今天，明天的安排才排得准' }}</text>
      </view>
      </view>
      </view>
      </view>
      </block>
    <!-- ===== 其余组件：跟在首屏后面正常滚动 =====
         以前这是一层 fixed 的"抽屉"：非得上滑手势才拉得出来，而那个手势在屏幕
         **任何位置**划 12px 就接管（页面本身还被 touch-action:none 禁掉了滚动），
         于是"想点卡片、手抖一下"整块面板就被拽出来 —— 这是"首页很乱"的直接来源；
         而且它没有任何常驻提示，不滑就不知道下面还有东西。
         现在它就是页面流里的一摞卡：手指在哪往上滑都是**正常滚动**，
         不用学手势、不会误触，下面的内容也一直"在那儿"。
         ⚠️ .mod-sheet 是玻璃底板的宿主层，必须独立在 .mod-list 之外：
            CSS 里 backdrop root 由 filter / opacity<1 / mask 创建 —— .mod-list 要淡入
            就必然带 opacity<1，底板挂在它身上时 backdrop 被隔离在那一个层里，背后只剩
            卡片自己，于是"糊了个寂寞"（看到的就是一块平涂半透明白片 = 没有立体感）。
            拆两层后：.mod-sheet 只吃 transform（建 stacking context，但**不建** backdrop
            root）→ 底板能一路糊到首页背景与首屏内容。 -->
    <view class="mod-throw" :class="popCls">
    <view class="mod-sheet" :class="{ 'mod-empty': !restOrder.length }" :style="sheetRevealStyle">
    <view class="mod-list" :style="listRevealStyle" @touchmove="dragMove" @touchend="dragEnd" @touchcancel="dragEnd">
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

      <!-- 编辑入口：压在最后一卡下面，滑到底才够得着，平时不会误触。
           ⚠️ 它必须在滚动流里（不在 fixed 抽屉里）—— 以前抽屉在"一张卡都没有"时
           根本打不开，编辑入口就跟着一起够不着了。 -->
      <view class="home-foot">
        <block v-if="editing">
          <view class="foot-btn ghost" @tap="openSheet">{{ $t('＋ 添加组件') }}</view>
          <view class="foot-btn primary" @tap="finishEdit">{{ $t('完成') }}</view>
        </block>
        <view v-else class="foot-link" @tap="toggleEdit">{{ $t('编辑首页') }}</view>
      </view>
    </view>
    </view>
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
         ★ 跟专注有关的设置**全部**收在这一张卡里 —— 仿番茄 ToDo 把同类设置收进一处，
           首页因此只剩"今天要做什么"，不再这儿一个开关那儿一个开关（"首页很乱"的一条来源）。
         分四组：时长 / 结束提醒 / 白噪音 / 管住自己。组内是同一类动作，组之间用
         小标题分开 —— 一张卡里塞十行，不分组就是一堵墙。
         ⚠️ 内容多了就必须能滚：.fs-body 限高 + scroll-view，否则小屏上下面几行
            永远点不到。用 scroll-view 而不是 overflow:auto（App 端 view 的 overflow
            在部分机型上不吃，滚不动会静默失效）。
         更深的几项（自定义时长 / 后台保活 / 通知提醒 / 试听）留在专注页，底部只给出口 ——
         这个面板的职责是"开表前顺手调一下"，不是把所有旋钮都搬到首页。
         专注进行中（locked）与编辑首页（editing）时入口不显示；点遮罩或 × 收起。 -->
    <view v-if="focusSheet" class="fs-mask" @tap="toggleFocusSheet">
      <view class="fs-card" @tap.stop>
        <view class="fs-head">
          <text class="fs-title">{{ $t('专注设置') }}</text>
          <view class="fs-close" @tap="toggleFocusSheet">×</view>
        </view>

        <scroll-view class="fs-body" scroll-y>
          <!-- ① 时长 -->
          <text class="fc-group">{{ $t('时长') }}</text>
          <view class="fc-field">
            <view class="fc-field-head">
              <text class="fc-title">{{ $t('一段专注') }}</text>
              <text class="fc-val">{{ focusMin }} {{ $t('分钟') }}</text>
            </view>
            <view class="fc-opts">
              <text
                v-for="m in focusMinOpts"
                :key="m"
                class="fc-opt"
                :class="{ 'fc-opt-on': m === focusMin }"
                @tap="setFocusMin(m)"
              >{{ m }}</text>
            </view>
          </view>
          <view class="fc-field">
            <view class="fc-field-head">
              <text class="fc-title">{{ $t('一段休息') }}</text>
              <text class="fc-val">{{ restMin }} {{ $t('分钟') }}</text>
            </view>
            <view class="fc-opts">
              <text
                v-for="m in restMinOpts"
                :key="m"
                class="fc-opt"
                :class="{ 'fc-opt-on': m === restMin }"
                @tap="setRestMin(m)"
              >{{ m }}</text>
            </view>
          </view>

          <!-- ② 结束提醒 -->
          <text class="fc-group">{{ $t('结束提醒') }}</text>
          <view class="fc-row">
            <view class="fc-info">
              <text class="fc-title">{{ $t('结束响铃') }}</text>
              <text class="fc-sub">{{ $t('专注结束时响一声') }}</text>
            </view>
            <view class="fc-switch" :class="{ 'fc-on': soundOn }" @tap="tapSound">
              <view class="fc-knob" :class="{ 'fc-knob-on': soundOn }"></view>
            </view>
          </view>
          <view class="fc-row">
            <view class="fc-info">
              <text class="fc-title">{{ $t('结束震动') }}</text>
              <text class="fc-sub">{{ $t('专注结束时震一下') }}</text>
            </view>
            <view class="fc-switch" :class="{ 'fc-on': vibeOn }" @tap="tapVibe">
              <view class="fc-knob" :class="{ 'fc-knob-on': vibeOn }"></view>
            </view>
          </view>

          <!-- ③ 白噪音：开关 + 音色（音色只在开着的时候出现，关着时不多占一行） -->
          <text class="fc-group">{{ $t('白噪音') }}</text>
          <view class="fc-row">
            <view class="fc-info">
              <text class="fc-title">{{ $t('专注时放环境音') }}</text>
              <text class="fc-sub">{{ $t('本地合成不联网，休息自动停') }}</text>
            </view>
            <view class="fc-switch" :class="{ 'fc-on': noiseOn }" @tap="tapNoise">
              <view class="fc-knob" :class="{ 'fc-knob-on': noiseOn }"></view>
            </view>
          </view>
          <view v-if="noiseOn" class="fc-opts fc-opts-pad">
            <text
              v-for="n in noiseKinds"
              :key="n.k"
              class="fc-opt"
              :class="{ 'fc-opt-on': noiseKind === n.k }"
              @tap="pickNoise(n.k)"
            >{{ n.t }}</text>
          </view>

          <!-- ④ 管住自己：提醒 → 拉回 → 收通知 → 收尾 -->
          <text class="fc-group">{{ $t('管住自己') }}</text>
          <view class="fc-row">
            <view class="fc-info">
              <text class="fc-title">{{ $t('严格模式') }}</text>
              <text class="fc-sub">{{ $t('离开学习 App 就提醒，30 秒不回来作废') }}</text>
            </view>
            <view class="fc-switch" :class="{ 'fc-on': strictOn }" @tap="tapStrict">
              <view class="fc-knob" :class="{ 'fc-knob-on': strictOn }"></view>
            </view>
          </view>
          <view v-if="strictOn && !usageOk && !a11yOk" class="fc-warn" @tap="openUsage">{{ $t('需要「使用情况访问」才能判断你在用哪个 App') }}</view>

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
              <!-- 开关开着却没检测到授权 = 一条也拦不住。给个"重新检测"的出口，
                   别让用户只能对着一个打不开的开关干瞪眼（2026-10-24） -->
              <text v-if="blockNotifOn && !notifOk" class="fc-try fc-try-warn" @tap.stop="recheckNotif">{{ $t('没检测到授权 · 点这里重新检测') }}</text>
              <text class="fc-sub">{{ $t('专注时收起别家通知') }}</text>
            </view>
            <view class="fc-switch" :class="{ 'fc-on': blockNotifOn }" @tap="tapBlockNotif">
              <view class="fc-knob" :class="{ 'fc-knob-on': blockNotifOn }"></view>
            </view>
          </view>

          <view class="fc-row is-last">
            <view class="fc-info">
              <text class="fc-title">{{ $t('自动进休息') }}</text>
              <text class="fc-sub">{{ $t('专注结束自动休息') }}</text>
            </view>
            <view class="fc-switch" :class="{ 'fc-on': autoRestOn }" @tap="tapAutoRest">
              <view class="fc-knob" :class="{ 'fc-knob-on': autoRestOn }"></view>
            </view>
          </view>

          <view class="fs-more" @tap="goFocusSet">{{ $t('更多专注设置 ›') }}</view>
        </scroll-view>
      </view>
    </view>

    <!-- ===== 顶栏那颗键点开的「管理」面板 =====
         学习 App / 学习范围 / 权限 / 设置都是同一类"管理"动作。各给一颗顶栏键的话
         右上角会挤成一排，标题还被挤得不居中（2026-10-24）。所以统一收在这里：
         顶栏**永远只有一颗键**，以后再多加管理项只是面板里多一行，不再动顶栏。
         专注设置仍排第一行（开表前最常用的一项），点了就地展开底下那张卡。 -->
    <view v-if="manageOn" class="fs-mask" @tap="toggleManage">
      <view class="fs-card" @tap.stop>
        <view class="fs-head">
          <text class="fs-title">{{ $t('管理') }}</text>
          <view class="fs-close" @tap="toggleManage">×</view>
        </view>

        <scroll-view class="fs-body" scroll-y>
          <text class="fc-group">{{ $t('专注') }}</text>
          <view class="mg-item" @tap="manageGo('focus')">
            <view class="mg-info">
              <text class="mg-title">{{ $t('专注设置') }}</text>
              <text class="mg-sub">{{ manageFocusSub }}</text>
            </view>
            <text class="mg-go">›</text>
          </view>

          <text class="fc-group">{{ $t('学习') }}</text>
          <view class="mg-item" @tap="manageGo('apps')">
            <view class="mg-info">
              <text class="mg-title">{{ $t('学习 App 管理') }}</text>
              <text class="mg-sub">{{ manageAppsSub }}</text>
            </view>
            <text class="mg-go">›</text>
          </view>
          <view class="mg-item" @tap="manageGo('range')">
            <view class="mg-info">
              <text class="mg-title">{{ $t('学习范围') }}</text>
              <text class="mg-sub">{{ manageRangeSub }}</text>
            </view>
            <text class="mg-go">›</text>
          </view>

          <text class="fc-group">{{ $t('系统与账号') }}</text>
          <view class="mg-item" @tap="manageGo('setup')">
            <view class="mg-info">
              <text class="mg-title">{{ $t('权限与后台保活') }}</text>
              <text class="mg-sub">{{ manageSetupSub }}</text>
            </view>
            <text class="mg-go">›</text>
          </view>
          <view class="mg-item is-last" @tap="manageGo('settings')">
            <view class="mg-info">
              <text class="mg-title">{{ $t('设置') }}</text>
              <text class="mg-sub">{{ $t('主题 / 背景 / 触感 / 更新') }}</text>
            </view>
            <text class="mg-go">›</text>
          </view>
        </scroll-view>
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
import * as insets from '../../utils/insets.js'
// 触感反馈：抽屉滑出到位震一下（跟着设置 › 触感反馈的总开关走，utils/haptic.js）
import * as haptic from '../../utils/haptic.js'
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

// 首屏常驻的三张卡：今天要用的就这三样 —— 开始专注 / 今天做什么 / 今天有多赶。
// 它们**不属于可排模块**（见 utils/home-layout.ts 的 hero 标记）：
// 排序 / 收纳只作用于首屏下面那一摞（目标 / 日程 / 学习 App / AI 对话）。
// 两边必须一致：这里漏一个，那张卡就会在首屏和下面各渲染一份（两套样式并存）。
const HOME_IDS = ['focus', 'task', 'urgency']

// 滚多远算"把下面那摞卡拉到位"（rpx）—— 这是**下限**：真实距离按一屏算（见 remeasure）。
// 固定成 520rpx 在大屏上只有半屏，滚到进度 1 时首屏还占着上半屏、却已经透明了，
// 中间空一片；按屏算之后才是"滚一屏 = 换一屏"。
const REVEAL_SPAN_RPX = 520
// 页面上下被悬浮导航吃掉的高度（rpx），必须与 App.vue 的 .page-nav / .page-tabbar 一致：
// 算"首屏可视高度"要用它俩，CSS 改了这里不跟着改，跨度就会偏。
const PAGE_NAV_RPX = 136
const PAGE_TAB_RPX = 220
// 死区（rpx）：刚起手那点抖动不该让卡片先闪一下
const REVEAL_DEAD_RPX = 16
// 下面那摞卡的视差（rpx）：它们**落后于滚动**这么多，看着才像从折叠线下被拉上来，
// 而不是跟着页面一起平移（同速 = 读不出"这是另一层"）。
const SHEET_PARALLAX_RPX = 220
// 首屏退场时额外上抬多少（rpx）：与页面滚动叠加，比卡片慢半拍才有景深
const HERO_LIFT_RPX = 56
// 首屏缩到多少（0.05 = 缩 5%）：后退一层，玻璃底板才读得出是浮在上面的另一层
const HERO_DEPTH_SCALE = 0.05

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
      notifOk: false,        // 「通知使用权」实际授没授（拦截通知那条开关靠它说真话）
      autoRestOn: false,     // 首页「专注设置」卡片：专注跑完自动进休息
      focusSheet: false,     // 首页「专注设置」卡片是否弹出
      manageOn: false,       // 顶栏那颗键点开的「管理」面板（所有管理入口的唯一出口）
      overlayOk: false,      // 「显示在其他应用上层」权限：强制模式拉回的准入条件
      // ---- 「专注设置」卡片新增的三组 ----
      // ⚠️ 时长那份配置在 pwstore 的 pomoCfg（focus.setCfg 写），**不在** settings.focus：
      //    两处各存一份就会出现"首页改了 25、专注页还是 45"。
      focusMin: 25,          // 一段专注多长
      restMin: 5,            // 一段休息多长
      // 档位必须与专注页 minutesOptions **逐项一致**（check-home-focus 守着）：
      //   两处各写一套的话，专注页选了 20 分钟回到首页会没有一个档位亮着。
      focusMinOpts: [15, 20, 25, 30, 45, 60],
      restMinOpts: [3, 5, 10, 15],
      soundOn: true,         // 结束响铃
      vibeOn: true,          // 结束震动
      noiseOn: false,        // 白噪音开关（'' 就是关，与专注页同口径）
      noiseKind: 'rain',     // 白噪音音色
      // 统一弹窗（components/app-dialog）：危险确认也走自绘卡片，不用 uni.showModal
      dlg: { show: false, mode: 'confirm', title: '', content: '', confirmText: '确定', danger: false, seq: 0, action: '', items: [], item: null },
      // ---------- 首页分层：首屏三卡（常驻）+ 下面一摞可排模块 ----------
      // 下面那摞卡跟在首屏后面**正常滚动**（不是抽屉）：不用学手势、不会误触，
      // 下面的内容也一直"在那儿"，不滑也知道它存在。
      // revealP = 滚动进度 0→1，串起"卡片淡入 / 首屏退场 / 背景模糊"三件事。
      // 初值 **0 = 停在顶部**，必须和 syncReveal 的"0 = 顶部"同口径：
      //   一旦 revealOn 先变 true、进度还没算出来，0 只会让下面的卡片先透明
      //   （它本来就在折叠线之下，看不见），而首屏照常全亮。
      //   ⚠️ 反过来给 1 曾把首屏 fade 成 0 —— 首页一片空白，只有底下一张卡露个边。
      revealP: 0,
      revealOn: false,
      // Q 弹：下面那摞卡拉到位瞬间播一次过冲（pop-a / pop-b 交替挂以重触发）
      popOn: false,
      popSeq: 0,
      // rpx→px 的距离（remeasure 里算；屏幕尺寸变了要重算）
      _spanPx: 0,
      _deadPx: 0,
      _parallaxPx: 0,
      _heroLiftPx: 0,
      winH: 667,          // 视口高度（onShow 实测）：进编辑态要滚到那一摞卡
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
    /**
     * 卡片副标题：只列前两项（用 shortTitle 去掉括号里的解释），多的用省略号收口。
     * ⚠️ 以前这里 join 的是**完整 title** —— 四项全带括号说明，一段排成四行，
     *    整张卡把首屏压下去半屏（用户原话："挤占下面的卡片，导致下面不好点"）。
     *    数量由左边的徽章说，文案不必重复。
     */
    setupNames() {
      const names = this.setupPending.map(x => setup.shortTitle(x.title))
      if (!names.length) return ''
      const head = names.slice(0, 2).join('、')
      return names.length > 2 ? head + '…' : head
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
     * 首屏下面那一摞（目标 / 日程 / 学习 App / AI 对话…）。
     *
     * 编辑态**也**排除首屏三张（HOME_IDS）：以前编辑态返回**全部**，于是首屏与
     * 下面各渲染一份 focus / task / urgency —— 同一模块两套样式并存，还把三张卡
     * 挤在顶部一小条里（这也是"首页很乱"的一条）。首屏那三张就是首页本身，
     * 不参与排序与收纳；想加想减的是下面这一摞。
     */
    restOrder() {
      const ids = this.cardOrder || []
      return ids.filter(id => HOME_IDS.indexOf(id) < 0)
    },
    /** 下面还有几张卡（0 张时「编辑首页」照样在，只是没有可排的卡） */
    /** 顶栏那颗「专注设置」入口要不要点亮：有任意一项管控开着就点亮 ——
        用户一眼知道"我现在是被管着的"，不用点进去看。 */
    focusSetOn() {
      return !!(this.forcedOn || this.blockNotifOn || this.autoRestOn ||
        this.strictOn || this.noiseOn)
    },
    // ---- 管理面板四行的副标题 ----
    // 每一行都要"不看进去也知道现在是什么状态"：副标题写状态，不写功能说明
    // （功能说明在目标页里讲，这里重复一遍只会把卡片撑长）。
    manageFocusSub() {
      const n = [this.soundOn, this.vibeOn, this.noiseOn, this.strictOn,
        this.forcedOn, this.blockNotifOn, this.autoRestOn].filter(Boolean).length
      const base = this.focusMin + ' ' + this.$t('分钟')
      return n ? base + ' · ' + this.$t('{n} 项开着', { n }) : base
    },
    manageAppsSub() {
      const n = (this.dock || []).length
      return n ? this.$t('已添加 {n} 个', { n }) : this.$t('还没添加')
    },
    manageRangeSub() {
      try {
        const r = settings.get().range || {}
        if (!r.on) return this.$t('未开启')
        const n = (r.places || []).length
        return n ? n + ' ' + this.$t('个地点') : this.$t('还没圈地点')
      } catch (e) {
        return ''
      }
    },
    manageSetupSub() {
      const n = (this.setupPending || []).length
      return n ? n + ' ' + this.$t('项待处理') : this.$t('都已开启')
    },
    // 音色的中文名必须走 $t：字面量数组在 i18n init 前求值的话，切英文不会重算，
    // 还会被 check-i18n 算成漏网的静态中文（阈值就那么点余量）。
    noiseKinds() {
      return [
        { k: 'white', t: this.$t('白噪') },
        { k: 'pink', t: this.$t('粉噪') },
        { k: 'brown', t: this.$t('棕噪') },
        { k: 'rain', t: this.$t('雨声') },
        { k: 'beach', t: this.$t('沙滩') }
      ]
    },
    restCount() {
      return this.restOrder.length
    },
    // 玻璃底板那一层：只给 transform（视差 + 缩放）。
    // 这一层**绝不能带 opacity**：opacity<1 会让它自成 backdrop root，
    // 底板的 backdrop-filter 就糊不到首屏内容了（玻璃感全废，见 .mod-sheet 的注释）。
    // 底板的"出场"靠它随滚动从屏幕下方推上来（跟系统 sheet 一样靠位移，不靠淡入）。
    sheetRevealStyle() {
      if (!this.revealOn) return {}
      const p = this.revealP
      const off = ((1 - p) * this._parallaxPx).toFixed(1)
      const sc = (0.955 + 0.045 * p).toFixed(4)
      return { transform: 'translate3d(0,' + off + 'px,0) scale(' + sc + ')' }
    },
    // 卡片那一层：只淡入（位移在上层 .mod-sheet，底板跟着一起被拉上来）
    listRevealStyle() {
      if (!this.revealOn) return {}
      return { opacity: String(this.revealP) }
    },
    /**
     * 主页撤退时的"毛玻璃"层（背单词 App 的 hero-glass 等价物）——
     * 上滑时整张主页后退、淡出，这层在它背后把**背景**糊成一片，让"主页在失焦退场"看得见。
     * 对照背单词 App 的五档：静止（p=0）必须透明、背景高清；随进度长到五档模糊，
     * 每档只切 class（不过渡 blur 半径，逐帧改半径 = 整屏高斯按帧重跑 = 掉帧老路）。
     * 模糊只存在于"滑到下面那屏"的过渡里，静止时一律 none。
     * 自身 opacity 由内联单独控制（它不是任何 opacity 祖先的子级，backdrop 不会被隔离）。
     */
    heroGlassStyle() {
      if (!this.revealOn) return { opacity: '0' }
      const p = this.revealP
      if (p <= 0) return { opacity: '0' }
      // 量化到 5 档（0 档=透明，已在上一步拦掉）
      const tier = p >= 0.85 ? 4 : p >= 0.6 ? 3 : p >= 0.4 ? 2 : p >= 0.2 ? 1 : 0
      if (tier === 0) return { opacity: '0' }
      const blur = [6, 12, 18, 20][tier - 1]
      const sat = [140, 150, 165, 190][tier - 1]
      const op = [0.28, 0.52, 0.76, 1][tier - 1]
      const tint = tier >= 4 ? 0.12 : 0   // 拉满那档才给一点实体色，平时纯靠模糊
      const s = {
        opacity: String(op),
        backdropFilter: 'blur(' + blur + 'px) saturate(' + sat + '%)',
        webkitBackdropFilter: 'blur(' + blur + 'px) saturate(' + sat + '%)',
        background: 'rgba(var(--surface-rgb, 255, 255, 255), ' + tint + ')'
      }
      return s
    },
    /** 下面那摞卡"推上来"的 Q 弹 class：拉到位瞬间播一次 sheet-pop 过冲，交替挂以重触发 */
    popCls() {
      if (!this.popOn) return ''
      return this.popSeq % 2 ? 'pop-b' : 'pop-a'
    },
    // 整块首屏的外壳：**只给 transform**（上抬 + 轻微缩小）—— 上滑时是整屏一起退，
    // 而不是只有下面那摞卡在动。
    // 这一层**绝对不许带 opacity**：opacity<1 会让它自成 backdrop root，背景那层
    // 毛玻璃（.hero-glass）的 backdrop-filter 就糊不到 App 背景了 —— 只会看到
    // "背景图纹丝不动地平移"。内容的渐隐因此交给内层 .hero-body。
    heroCardStyle() {
      if (!this.revealOn) return {}
      const p = this.revealP
      const lift = (p * this._heroLiftPx).toFixed(1)
      return {
        transform: 'translate3d(0,-' + lift + 'px,0) scale(' +
          (1 - HERO_DEPTH_SCALE * p).toFixed(4) + ')'
      }
    },
    // 首屏内容（环 / 任务卡 / 收工按钮）：随上滑渐隐，把位让给下面那摞卡。
    heroBodyStyle() {
      if (!this.revealOn) return {}
      // 渐隐比卡片淡入**早一点到位**（x1.2）：先看得出"首屏在退场"，
      // 而不是两层一起平移。
      let fade = this.revealP * 1.2
      fade = fade > 1 ? 1 : fade
      return {
        opacity: (1 - fade).toFixed(3),
        // 淡到基本看不见就别再吃点击：透明的首屏会挡住下面那摞卡
        pointerEvents: fade > 0.9 ? 'none' : 'auto'
      }
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
      // 专注一跑起来卡片区整个不显示了，引导的高亮目标也就没了 ——
      // 收掉但**不记完成**：这次没看成，下次进首页再放一遍
      if (v && this.gdOn) this.stopGuide()
    },
    // 卡片增减 / 进出硬控都要重新对齐滚动进度：否则"刚收纳掉最后一张卡"时
    // 进度还停在 0，剩下那摞卡会整个透明。
    restOrder() { this.syncReveal(-1) },
    locked() { this.syncReveal(-1) }
  },
  /**
   * 上滑多少 → 0→1 的滚动进度：下面那摞卡随之淡入并**落后于滚动**地上移，
   * 首屏整块随之上抬、缩小、渐隐。只动 opacity / transform（合成器接管，零重排）。
   * ⚠️ 进度只认 onPageScroll 给的 scrollTop —— 这是**唯一不依赖 DOM 的滚动数据源**：
   *   App 端逻辑层没有 document，别去 getBoundingClientRect / 量节点，那条路在真机上
   *   拿不到东西，整条动画会**静默失效**（表现为"上滑什么都没发生"）。
   */
  onPageScroll(e) {
    this.syncReveal(e && typeof e.scrollTop === 'number' ? e.scrollTop : -1)
  },
  onShow() {
    hideNativeTabBar()
    syncTabbar(this)
    // 强制模式：专注跑着的时候，App 内部也不许乱逛（回首页/统计/我的都算逃逸）。
    // 判定与跳转全在 utils/forced.js，这里只问一句 —— 被拦就直接 return，
    // 后面 refresh / startTick 都不用跑了（马上要跳走，跑了也是白跑）。
    try { if (forced.guardInside('/pages/home/home')) return } catch (e) {}
    // 实测视口高度 + 把 rpx 距离换算成 px（滚动视差要用）。
    // ⚠️ 这些都是纯辅助动作，绝不能连累后面：onShow 里断一处，refresh / startTick
    //    全不执行，首页就停在旧数据上（H5 未挂载时实测确实会抛，2026-10-23 实锤）。
    try { this.winH = uni.getSystemInfoSync().windowHeight || 667 } catch (e) { this.winH = 667 }
    try { this.remeasure() } catch (e) {}
    // 回首页立刻把滚动进度对齐一次（不碰 DOM，H5 未挂载也不会抛）：
    // revealOn 一旦亮起来就必须配一个**真实**进度 —— 等用户先滑一下才算是错的，
    // 那一帧会是"首屏已退场、卡片还没进来"，整页看着像空的。
    try { this.syncReveal(this._scrollTop) } catch (e) {}
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
    // 第一次用：先去「开始前的几件事」（系统权限 + 要不要被管着的开关），
    // 回来再放新手引导 —— 顺序反了的话，引导挖的洞会落在还没定下来的界面上。
    if (this.maybeFirstRun()) return
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
      // 从系统「通知使用权」页回来：授权成功就当场把开关打开（不然还得再点一次，
      // 而第二次点又会弹同一个框 —— 用户看到的就是"这个开关开不了"）
      if (this.__fromNotif) {
        this.__fromNotif = false
        this.syncNotifOpt()
      } else {
        this.notifOk = this.grantedNotif()
      }
      this.autoRestOn = !!f.autoRest
      this.soundOn = f.sound !== false
      this.vibeOn = f.vibe !== false
      this.noiseOn = !!f.noise
      this.noiseKind = f.noise || 'rain'
      // 时长读 pomoCfg（专注页读同一份）—— 面板里改完，进专注页就是新值
      const pc = pw.get().pomoCfg || {}
      this.focusMin = pc.focus || 25
      this.restMin = pc.rest || 5
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
      // 2026-10-24 改为统一常显：空状态由卡片自己的占位文案兜底，不再整张消失。
      // 之前按 u.empty / goals.length 隐藏带来两个问题（用户反馈）：
      //   ① 紧迫度卡"莫名其妙不见了"——今天没排任务就整张消失；
      //   ② 底部抽屉因 goal/schedule 被藏，只剩 dock / coach 两张，显得空荡还"只能看到两张"。
      // 卡片各自的空态文案（"暂时没有进行中的目标" / "今天没有日程" / 紧迫度进度条 0%）已能兜住。
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
    // ---------- 首页分层：滚动进度（下面那摞卡怎么被"拉上来"）----------
    // rpx → px。⚠️ uni-app **只转换 CSS 文件里的 rpx**，内联样式里的 rpx 不会被转换，
    // 所以 JS 算位移必须自己换；换不出来（拿不到屏宽）就按 375 宽的 0.5 兜底。
    upx(v) {
      try {
        if (typeof uni !== 'undefined' && typeof uni.upx2px === 'function') return uni.upx2px(v)
        const info = (typeof uni !== 'undefined' && uni.getSystemInfoSync) ? uni.getSystemInfoSync() : null
        const w = (info && info.windowWidth) || 375
        return v * w / 750
      } catch (e) {
        return v / 2
      }
    },
    // 把所有"rpx → px"的距离一次性重算。**屏幕尺寸变了必须重算一遍**：
    // 否则换新机 / 转横屏后距离还是老屏幕的，动画幅度会明显不对。
    remeasure() {
      this._deadPx = this.upx(REVEAL_DEAD_RPX)
      this._parallaxPx = this.upx(SHEET_PARALLAX_RPX)
      this._heroLiftPx = this.upx(HERO_LIFT_RPX)
      // 淡入距离 = 首屏在视口里实际占的那一屏（去掉悬浮顶栏 / 底栏的留白）。
      // 进度走完时首屏正好被顶出去、卡片占满屏 —— 距离给短了，会出现
      // "首屏已经透明、卡片还没铺满"的一片空白（小屏尤其明显）。
      // 下限仍是 REVEAL_SPAN_RPX：极矮的屏（横屏 / 折叠小窗）也得走完。
      let ins = 0
      try { ins = (insets.statusBar() || 0) + (insets.safeBottom() || 0) } catch (e) { ins = 0 }
      const heroPx = (this.winH || 667) - ins - this.upx(PAGE_NAV_RPX) - this.upx(PAGE_TAB_RPX)
      const byScreen = heroPx > 0 ? Math.round(heroPx * 0.96) : 0
      this._spanPx = Math.max(this.upx(REVEAL_SPAN_RPX), byScreen)
    },
    /**
     * 算"下面那摞卡淡入 / 首屏退场"的进度，并把它推进响应式数据
     * （由 listRevealStyle / sheetRevealStyle / heroCardStyle / heroBodyStyle 四个
     * computed 变成内联样式下发 —— App 端唯一可用的样式通道）。
     *
     * 进度 = 已滑距离 / 淡入距离。不量节点、不看视口高，纯粹跟着滚动走：
     *   · 静止时首屏撑满一屏，卡片在折叠线之下，p=0 → 卡片透明、首屏全亮；
     *   · 往上滑 → p 增大 → 卡片淡入并**落后于滚动**地上移，首屏同步渐隐；
     *   · 滑回去 → p 归 0。
     * ⚠️ 硬控屏（专注中）与"下面一张卡都没有"时一律 p=1：那一屏没有可淡入的东西，
     *    让卡片常显、首屏不淡出（否则会出现"卡片整个不见了"）。
     * ⚠️ 必须待在 methods 里：onPageScroll / watch 都以 this.syncReveal 调用，
     *    放到 methods 外（和生命周期选项平级）它就不是实例方法。
     */
    syncReveal(scrollTop) {
      if (typeof scrollTop === 'number' && scrollTop >= 0) this._scrollTop = scrollTop
      // ⚠️ onPageScroll 一次都没来过时 _scrollTop 还是 undefined —— 让它参与算术会得到
      //    NaN，后面的 `< 0 / > 1` 两道夹逼都拦不住它（NaN 和任何数比都是 false），
      //    进度就永远停在初值上。实测代价：首屏 opacity 被算成 0，首页整片空白，
      //    只有底下那摞卡露个边，动一下屏幕才回来。这里一律按"顶部"兜底。
      if (typeof this._scrollTop !== 'number' || !isFinite(this._scrollTop)) this._scrollTop = 0
      const on = !this.locked && this.restCount > 0
      // on=false（硬控屏 / 一张卡都没有）时 revealOn 也是 false、四套样式全返回 {}，
      // 页面用 CSS 默认值（首屏亮、卡片实）。这里同步把进度归 0，免得"关一次再开"
      // 带着上一轮的旧进度回来。
      let p = 0
      if (on) {
        // 兜底：屏宽变化后四个值都要跟着变（见 remeasure），别只补 span
        if (!this._spanPx) this.remeasure()
        const span = this._spanPx || 1
        const dead = this._deadPx || 0
        p = (this._scrollTop - dead) / span
        p = !isFinite(p) ? 0 : p < 0 ? 0 : p > 1 ? 1 : p
        // 拉到位 → 震一下 + Q 弹过冲（一次来回只响一声；滑回去再拉才会再响）
        if (p > 0.985) {
          if (!this._buzzed) {
            this._buzzed = true
            this.buzzDrawer()
            this.playPop()
          }
        } else if (p < 0.55) {
          this._buzzed = false
        }
      } else {
        this._buzzed = false
      }
      // 量化到 0.05 一档：滑一次最多 20 次赋值，不是每帧一次 ——
      // 整页重渲染的代价不能按帧付（home.vue 模板很大），5% 的跳变肉眼看不见。
      const q = Math.round(p * 20) / 20
      if (this.revealOn !== on) this.revealOn = on
      if (Math.abs(q - this.revealP) > 0.0001) this.revealP = q
    },
    /** 把下面那一摞卡滚到眼前（进编辑态时用：把手 / 收纳 / 排序全在卡片上） */
    scrollToModules() {
      try {
        uni.pageScrollTo({ scrollTop: (this._scrollTop || 0) + (this.winH || 667), duration: 260 })
      } catch (e) {}
    },
    /** 下面那摞卡拉到位震一下（drawer 档，一次来回只响一声） */
    buzzDrawer() {
      try { haptic.tick('drawer') } catch (e) { console.warn('[home] haptic tick failed:', e) }
    },
    /**
     * Q 弹：拉到位瞬间在 .mod-throw 上播一次 sheet-pop 过冲（先冲过头、再回落）。
     * ⚠️ pop-a / pop-b 两份**内容完全一样**的 keyframes 交替挂：同名动画摘了再戴，
     *   Vue 会在同一次渲染合并掉 → 第二次不播。交替挂才能每次都重触发。
     */
    playPop() {
      if (this.editing) return
      this.popSeq++
      this.popOn = false
      this.$nextTick(() => { this.popOn = true })
      clearTimeout(this._popT)
      this._popT = setTimeout(() => { this.popOn = false }, 360)
    },

    // ---------- 首页编辑 ----------
    toggleEdit() {
      this.editing = !this.editing
      // 进编辑态要把那一摞卡滚到眼前：把手 / 收纳 / 排序全在卡片上，
      // 停在首屏看的话等于进了一个什么都看不见的编辑态。
      if (this.editing) this.scrollToModules()
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
    /**
     * 卡片样式：只有编辑态拖着的那张跟手偏移。
     * 展示态一律返回空 —— 卡片常显，"淡入"统一由 .mod-list 的 opacity 管，
     * 不再逐张错拍（那套是抽屉时代的：卡片藏在折叠区里才需要一张张放出来）。
     */
    wrapStyle(i) {
      if (this.editing && this.dragIndex === i) {
        return 'transform: translateY(' + this.dragDy + 'px); z-index: 30;'
      }
      return ''
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
      // ⚠️ 这里用 pendingForCard 而不是 pending()：用户点过 × 的缺项不再上首页，
      //    但权限页 / 弹窗判断仍看完整清单（卡片可以关，真实状态不许藏）。
      try { list = setup.pendingForCard() } catch (e) {}
      this.setupPending = list
    },
    /**
     * 点卡片右上角的 × —— "我知道，别拿它烦我"。
     * 记的是**当时缺的这几项**（setup.mutePending），以后冒出新的缺项还会再提醒。
     * 不跳设置页、不弹确认框：用户的动作就是"把这张卡收掉"，不该再被问一次。
     */
    muteSetup() {
      try { setup.mutePending() } catch (e) {}
      this.setupPending = []
      try { haptic.tick('switch') } catch (e) {}
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
    /**
     * 第一次用：把「开始前的几件事」那一屏放出来（权限清单 + 可选开关）。
     *
     * ⚠️ **先记账再跳**（与 setup.appsAsked 同一个套路）：跳转失败、页面还没编译、
     *   或被别的事情打断时，不会变成"每次进 App 都被拽走一次"。
     * ⚠️ 非安卓不放：那套清单是安卓专属（setup.applicable()），别端去了只有一屏空白。
     */
    maybeFirstRun() {
      try {
        if (!setup.shouldFirstRun()) return false
        setup.markFirstRun()
        safeNav('/pkgManage/pages/start/start')
        return true
      } catch (e) {
        return false
      }
    },
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
      // 挖洞的目标（.focus-card / .task-card）就在首屏上 —— 但如果用户已经把页面
      // 滑到下面那一摞卡了，它们就在屏幕外，量不到矩形会被当"目标不存在"跳过，
      // 引导讲一半。所以先回到顶。
      try { uni.pageScrollTo({ scrollTop: 0, duration: 0 }) } catch (e) {}
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

    /**
     * 顶栏那颗键 = 「管理」面板的开关。
     * ⚠️ 编辑态与硬控态不响应：编辑时页面上全是拖拽把手、硬控时只剩倒计时，
     *    浮层盖上去会让那两处的按钮点不到。
     */
    toggleManage() {
      if (this.editing || this.locked) return
      this.manageOn = !this.manageOn
      if (this.manageOn) this.focusSheet = false
    },
    /** 面板里某一行的去路。专注设置是就地展开（多一层跳转没必要），其余跳页面。 */
    manageGo(k) {
      this.manageOn = false
      if (!k) return
      if (k === 'focus') {
        // 等遮罩退场再展开第二张卡：同时两张会叠在一起，看着像卡住了
        setTimeout(() => { this.focusSheet = true }, 180)
        return
      }
      const map = {
        apps: '/pkgPlan/pages/apps/apps',
        range: '/pkgPlan/pages/range/range',
        setup: '/pkgManage/pages/setup/setup',
        settings: '/pkgManage/pages/settings/settings'
      }
      if (!map[k]) return
      safeNav(map[k])
    },
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
    /** 系统的「通知使用权」到底授没授（读写只有一处，别在页面里各处问） */
    grantedNotif() {
      try { return !!fgsvc.notifGranted() } catch (e) { return false }
    },
    /**
     * 拿系统实际状态对一次账：授权成功就顺手把开关打开。
     * 从系统设置页回来时不刷新，用户就得再点一次开关，而第二次点又会弹同一个框。
     */
    syncNotifOpt() {
      const g = this.grantedNotif()
      this.notifOk = g
      if (!g) return false
      if (!this.blockNotifOn) {
        this.blockNotifOn = true
        this.saveFocus('blockNotif', true)
        try { uni.showToast({ title: this.$t('通知使用权已开启，拦截通知已打开'), icon: 'none' }) } catch (e) {}
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
     * 老文案只说"需要这个权限"，用户进了系统页不知道要找哪一项、也不知道列表里
     * 没有时该怎么办 —— 那就是"拦截通知开不了"的体感来源。
     */
    askNotifAccess() {
      this.ask({
        title: this.$t('拦截通知'),
        // ⚠️ 文案里不许写 \n：i18n 的 key 归一化会把真实换行折成空格，两边对不上
        content: this.$t('专注期间把别家 App 的通知收起来（下拉通知栏也看不到），专注结束再汇总发给你。怎么开：下一步会跳到系统的「通知使用权」页，在列表里找到「PWstudy 专注通知拦截」，把它的开关打开。如果列表里没有 PWstudy：把 PWstudy 完全退出再重新打开一次（服务要重新注册），回来再点这个开关就行。'),
        confirmText: this.$t('去开启'),
        action: 'goto-notif'
      })
    },
    /** 面板里的"拦截通知"开关：未授权先引导去开「通知使用权」 */
    tapBlockNotif() {
      if (!this.blockNotifOn && !this.grantedNotif()) {
        this.askNotifAccess()
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
    /** 面板里的「一段专注」：写进 pomoCfg（与专注页同一份配置，不做第二套） */
    setFocusMin(m) {
      this.focusMin = m
      try { focus.setCfg({ focus: m }) } catch (e) {}
    },
    /** 面板里的「一段休息」 */
    setRestMin(m) {
      this.restMin = m
      try { focus.setCfg({ rest: m }) } catch (e) {}
    },
    /** 面板里的「结束响铃」 */
    tapSound() {
      this.soundOn = !this.soundOn
      this.saveFocus('sound', this.soundOn)
    },
    /** 面板里的「结束震动」 */
    tapVibe() {
      this.vibeOn = !this.vibeOn
      this.saveFocus('vibe', this.vibeOn)
    },
    /** 面板里的白噪音开关：关 = 写空串（'' 就是关，与专注页同口径） */
    tapNoise() {
      const next = !this.noiseOn
      this.noiseOn = next
      this.saveFocus('noise', next ? (this.noiseKind || 'rain') : '')
    },
    /** 面板里的音色：开着就立刻换（下次开始专注起效；正跑着的那段不打断） */
    pickNoise(k) {
      this.noiseKind = k
      if (this.noiseOn) this.saveFocus('noise', k)
    },
    /** 面板里的严格模式：与专注页 toggleStrict 同口径（记一笔 + 缺权限给路） */
    tapStrict() {
      const next = !this.strictOn
      this.strictOn = next
      this.saveFocus('strict', next)
      if (next) {
        this.usageOk = apptime.hasUsagePermission()
        this.a11yOk = apptime.hasA11yPermission()
      }
      strict.sync()
    },
    /** 面板底部出口：自定义时长 / 后台保活 / 通知提醒 / 试听都在专注页 */
    goFocusSet() {
      this.focusSheet = false
      this.goFocus()
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
        // 跳系统「通知使用权」设置页。⚠️ 跳不出去必须**说出来**：
        // 以前 try 一把就完事，用户点了"去开启"却毫无反应 —— 就是那个"开不了"
        this.__fromNotif = true
        let opened = false
        try { opened = !!fgsvc.openNotifSettings() } catch (e) { opened = false }
        if (!opened) {
          this.ask({
            title: this.$t('没跳过去'),
            content: this.$t('这个机型没有开放「通知使用权」设置页，PWstudy 跳不过去。可以自己找：系统设置 → 通知（有的机型叫「通知与控制中心」）→ 通知使用权，在里面打开「PWstudy 专注通知拦截」。找不到就说明这个机型不支持，拦截通知用不了，其它功能不受影响。'),
            confirmText: this.$t('知道了')
          })
        }
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
  /* ⚠️ 这里**绝不能**再写 touch-action:none：那是为上滑拉抽屉的手势加的，
     手势一去就得放开 —— 否则整个首页滚不动，下面那摞卡永远够不着
     （抽屉版本的遗留，2026-10-23 改滚动流时踩到）。
     横向切 tab 的手势在根容器上（tab-slide-mixin 按方向判定），与纵向滚动不冲突。 */
  min-height: calc(100vh - var(--status-bar-height, 0px) - 136rpx - 220rpx - var(--safe-bottom, 0px));
  min-height: calc(100vh - var(--status-bar-height, 0px) - 136rpx - 220rpx - var(--safe-bottom, 0px) - env(safe-area-inset-bottom));
}
/* ★ 首屏：自己撑满一屏。下面那摞模块卡静止时**必然**落在折叠线之下 ——
     这是**结构**保证的，不靠 opacity 把卡片藏起来（靠 JS 算 opacity 的话，
     脚本一环没跑卡片就永久不见了）。上滑时它随滚动上抬 / 缩小 / 渐隐。 */
.home-hero {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - var(--status-bar-height, 0px) - 136rpx - 220rpx - var(--safe-bottom, 0px));
  min-height: calc(100vh - var(--status-bar-height, 0px) - 136rpx - 220rpx - var(--safe-bottom, 0px) - env(safe-area-inset-bottom));
}
.hero-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 首屏内容整组（三卡 + 收工）：auto margin 做垂直居中，且**溢出安全** ——
   内容比首屏高时 auto margin 自动归零、从顶部顺排，不会把卡片顶部裁到导航栏下。
   组内一律 20rpx 等距（见 .hcards gap），不再让某一张单独居中撑开大缝隙。 */
.hero-main {
  width: 100%;
  margin: auto 0;
  display: flex;
  flex-direction: column;
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
  /* 收紧上下留白：之前 40rpx 的底部外边距 + page-tabbar 的兜底，让抽屉滑到底后
     露出一大段空白（2026-10-24 反馈"滑到底有空白区域"）。 */
  margin-top: 20rpx;
  margin-bottom: 16rpx;
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

/* 紧迫度卡：不再单独设内边距，首页里继承 .hcard（36rpx）、底部抽屉里继承 .card（36rpx），
   三处边距统一（2026-10-24）。卡片头那行标题 + 档位胶囊 + ? 由组件自己画，无需 .card-head。 */
.urg-card { padding: 36rpx; }

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
/* 收工按钮与上方卡片的间距对齐 20rpx 的组内节奏（原先 8rpx 贴太近） */
.home-cta { margin: 20rpx 0 4rpx; }
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

/* ===== 权限 / 后台保活提醒卡 =====
   这张卡压在首屏之上，能薄就薄：徽章 + 两行文字 + × ，副标题超两行直接截断。
   以前副标题排的是四项完整标题（每项都带括号解释），一段能排四行，
   把下面的专注/任务卡整块压下去 —— 用户反馈"挤占下面的卡片，不好点"。 */
.setup-card { position: relative; margin-bottom: 20rpx; }
.sc-main { display: flex; align-items: center; padding-right: 52rpx; }
.sc-badge {
  width: 44rpx; height: 44rpx; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 24rpx; font-weight: 600; color: #ffffff;
  background: #f79009;
  margin-right: 18rpx; flex-shrink: 0;
}
.sc-info { flex: 1; min-width: 0; }
.sc-title { font-size: 29rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.sc-sub {
  font-size: 22rpx; color: #5a6560; color: var(--ink-2, #5a6560);
  margin-top: 6rpx; line-height: 1.5;
  /* 最多两行，多了截断：这张卡的高度直接决定下面几张卡能不能点到 */
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
.sc-go { font-size: 25rpx; color: #bb1332; color: var(--brand-strong, #bb1332); flex-shrink: 0; }
/* × ：「我知道，别再说了」。压到右上角，点击区给足 64rpx，别跟「去设置」抢地方 */
.sc-x {
  position: absolute; top: 0; right: 0;
  width: 64rpx; height: 64rpx;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 6rpx; box-sizing: border-box;
  font-size: 34rpx; line-height: 1;
  color: #98a19b; color: var(--ink-3, #98a19b);
}
.sc-x-press { color: #5a6560; color: var(--ink-2, #5a6560); }

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
/* "没检测到授权 · 点这里重新检测"（琥珀色 = 要你补一步，不是报错） */
.fc-try {
  display: inline-block; margin-left: 14rpx;
  font-size: 22rpx; font-weight: 500;
  color: #f79009; color: var(--amber, #f79009);
  padding: 4rpx 14rpx; border-radius: 999rpx;
  background: rgba(247, 144, 9, 0.12);
  border: 1rpx solid rgba(247, 144, 9, 0.3);
}
.fc-try:active { background: rgba(247, 144, 9, 0.22); }
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

/* ★ 内容从 3 项扩到 10 项以后必须能滚：小屏上不滚的话下面几行永远点不到。
   ⚠️ 用 scroll-view + 限高，不用 overflow:auto —— App 端 view 的 overflow 在部分
      机型上不吃，滚不动会**静默失效**（量节点那条路就是这样哑掉的）。 */
.fs-body {
  max-height: 62vh;
  padding-bottom: 8rpx;
}
/* 分组小标题：把"同类设置"显式分开 —— 一张卡里塞十行，不分组就是一堵墙 */
.fc-group {
  display: block;
  margin: 22rpx 0 4rpx;
  font-size: 22rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
.fc-group:first-child { margin-top: 2rpx; }
/* 时长：标题一行 + 档位一排（比开关紧凑，一组放两个也不显挤） */
.fc-field { padding: 10rpx 0; }
.fc-field-head { display: flex; align-items: baseline; justify-content: space-between; }
.fc-val { font-size: 24rpx; color: #5a6560; color: var(--ink-2, #5a6560); }
.fc-opts { display: flex; flex-wrap: wrap; margin-top: 12rpx; }
.fc-opts-pad { margin: 10rpx 0 4rpx; }
.fc-opt {
  min-width: 84rpx;
  margin: 0 12rpx 12rpx 0;
  padding: 10rpx 18rpx;
  border-radius: 999rpx;
  font-size: 25rpx;
  text-align: center;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
}
/* 选中态才用实心红（主按钮 tint 规则：实心红只给进度条 / 开关 / 选中态 / 聊天气泡） */
.fc-opt-on {
  color: #ffffff;
  background: #e4173d;
  background: var(--brand, #e4173d);
}
/* 分组插进来以后 :last-child 不再是最后一行（末尾还挂了个「更多」），
   最后那条分隔线得显式收掉，否则"自动进休息"下面拖一条孤零零的线。 */
.fc-row.is-last { border-bottom: none; }
/* 底部出口：更深的几项留给专注页，这里只给一个出口 */
.fs-more {
  margin: 18rpx 0 6rpx;
  font-size: 25rpx;
  text-align: center;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
}

/* ===== 管理面板的行（顶栏那颗键点开） =====
   一行 = 一个管理入口：标题 + 状态副标题 + 箭头。
   副标题写"现在是什么状态"而不是"这个页面干嘛"，点进去才知道的说明不占这里的高度。 */
.mg-item {
  display: flex;
  align-items: center;
  padding: 20rpx 2rpx;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.07);
  border-bottom: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.07));
  transition: opacity 160ms ease;
}
.mg-item:active { opacity: 0.55; }
.mg-item.is-last { border-bottom: none; }
.mg-info { flex: 1; min-width: 0; }
.mg-title {
  display: block;
  font-size: 28rpx;
  font-weight: 500;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.mg-sub {
  display: block;
  margin-top: 6rpx;
  font-size: 23rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
.mg-go {
  flex-shrink: 0;
  margin-left: 16rpx;
  font-size: 32rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
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
/* 不再 flex:1 撑满首屏（那会把三张卡拉开、中间空一大截）——
   组的高度由卡片自身决定，整组交给 .hero-main 居中。 */
.hcards { display: flex; flex-direction: column; gap: 20rpx; flex: 0 0 auto; min-height: 0; }
/* 首页三卡统一内边距：与底部抽屉的 .card（40rpx 36rpx）对齐到同一条水平边，
   不再各写一套 → 不同卡片的内容起点不齐、看着像"宽度不一致"（2026-10-24 反馈）。
   rpx 本身随屏幕动态缩放，这里只消掉"写死的不同 padding"这一层差异。 */
.hcard {
  padding: 36rpx;
  display: flex;
  align-items: center;
}
.hcard-press { opacity: 0.86; }

/* ① 开始专注：在 .hcards 里用上下 auto margin 推到正中；竖向居中排布，做整屏唯一视觉中心。
     周边两张卡（任务 / 紧迫度）各自退到上下边缘并淡化，不抢"开始专注"的焦点 */
.hcard.focus-card {
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  text-align: center;
  /* 与 .hcard 同款 36rpx 内边距，确保三张首页卡左右边距完全一致 */
  padding: 36rpx;
  /* 不再 margin:auto 0 单独居中 —— 整组由 .hero-main 统一居中，组内 20rpx 等距 */
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
/* 周边两张：不再缩放/淡化 —— 之前 scale(0.97) 会把卡片整体缩窄 3%，
   与「开始专注」卡、收工按钮的宽度肉眼可见不一致，首页显得割裂（2026-10-24 反馈）。
   现在三张卡都按 100% 宽度平铺，焦点靠"中心卡更大"本身表达，不靠缩小邻居。 */
.hcard.task-card,
.hcard.urg-card {
  flex: 0 0 auto;
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

/* ===== 首屏下面那一摞卡（正常滚动流 —— 不再是抽屉）=====
   两层的分工：
   · .mod-sheet 只吃 transform —— 玻璃底板的宿主，卡片**落后于滚动**地从下面被推上来，
     再加一点点缩放：它是从"后面"被推上来的，不是原地淡入。
   · .mod-list 只吃 opacity —— 卡片自己淡入（位移在上层，底板跟着一起走）。
   ★ 以前这里是一层 fixed 面板 + 一套上滑手势：手势在屏幕**任何位置**划 12px 就接管
     （页面本身还被 touch-action:none 禁了滚动），于是"想点卡片、手抖一下"整块面板
     就被拽出来 —— "首页很乱"的直接来源；而且它没有任何常驻提示，不滑就不知道下面
     还有东西。现在规则只有一条：**它就是页面流**。
   ⚠️ .mod-sheet 绝不能带 opacity：opacity<1 会让它自成 backdrop root，
      底板的 backdrop-filter 就糊不到首屏内容了（变成一块平涂半透明白片）。 */
.mod-sheet {
  position: relative;
  /* 静态兜底：JS 没跑时完全显现（不位移、不缩放）。
     绝不能把初值写成"藏在下面" —— 脚本一环没跑，卡片就永久不见了。 */
  transform: none;
}
.mod-list {
  position: relative;
  /* 同上：默认可见。淡入由 listRevealStyle 的内联 opacity 下发。 */
  opacity: 1;
}
/* 整摞卡共用一张**玻璃底板**：卡片之间的缝隙、上下边缘露出被模糊的首屏内容
   （按钮 / 文字滑过它底下会被糊掉），一眼就看出"这是浮在首页之上的另一层"，
   而不是接排下去的。
   ⚠️ 这块**不能带 opacity**（见 .mod-sheet 注释：一带就把 backdrop 隔离了）；
      它的出场靠"随滚动从屏幕下方推上来"，跟系统的 sheet 一样，不靠淡入。
   ⚠️ 绝不逐帧改 blur 半径（那是掉帧的老路），模糊半径恒定。 */
.mod-sheet::before {
  content: '';
  position: absolute;
  /* 与卡片左右边缘对齐：之前 left/right: -28rpx 让底板比卡片宽 56rpx，
     底部抽屉看起来比首屏三卡"宽出一截"，是首页割裂感的主要来源（2026-10-24 反馈）。
     现在底板只比卡片上下各探出 24rpx（做"另一层被推上来"的景深），左右严格齐边。 */
  left: 0;
  right: 0;
  top: -24rpx;
  bottom: -24rpx;
  z-index: -1;
  border-radius: 36rpx;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.82);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  box-shadow: 0 -8rpx 32rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.16);
  border-top: 2rpx solid rgba(255, 255, 255, 0.55);
}
/* 极端情况：底部抽屉一张卡都没有（goal/schedule 被收纳且无 dock/coach），
   只剩一块空玻璃底板，看着很怪 —— 直接不画底板，留「编辑首页」入口即可。 */
.mod-sheet.mod-empty::before { display: none; }
/* Q 弹：拉到位瞬间播一次过冲（先冲过头、再回落）。
   ⚠️ 两份**内容完全一样**的 keyframes 交替挂：同名动画摘了再戴，Vue 会在同一次
     渲染里合并掉 → 第二次不播。交替挂才能每次都重触发。 */
.mod-throw {
  transform-origin: 50% 100%;
  will-change: transform;
}
.mod-throw.pop-a { animation: sheet-pop-a 340ms cubic-bezier(0.22, 0.61, 0.36, 1); }
.mod-throw.pop-b { animation: sheet-pop-b 340ms cubic-bezier(0.22, 0.61, 0.36, 1); }
@keyframes sheet-pop-a {
  0%   { transform: translateY(0) scale(1); }
  26%  { transform: translateY(-16rpx) scale(1.026); }
  54%  { transform: translateY(5rpx) scale(0.995); }
  78%  { transform: translateY(-2rpx) scale(1.003); }
  100% { transform: translateY(0) scale(1); }
}
@keyframes sheet-pop-b {
  0%   { transform: translateY(0) scale(1); }
  26%  { transform: translateY(-16rpx) scale(1.026); }
  54%  { transform: translateY(5rpx) scale(0.995); }
  78%  { transform: translateY(-2rpx) scale(1.003); }
  100% { transform: translateY(0) scale(1); }
}

</style>
