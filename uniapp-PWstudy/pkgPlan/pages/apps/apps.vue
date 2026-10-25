<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="学习 App" />

    <!-- 权限说明与引导 -->
    <view class="card">
      <view class="pc-title">使用时长是怎么统计的</view>
      <view class="pc-txt">
        ① 从首页「学习 App」点图标跳过去：自动记录从出发到回来的用时（无需任何权限）。
        ② 开启系统的「使用情况访问」后：还能统计你直接打开这些 App 的总时长，两组数据取大值展示。所有数据只存在手机里，不上传。
      </view>
      <view v-if="isAndroid && !permitted" class="pc-perm" @tap="openPerm">
        <text class="pc-perm-txt">系统统计未开启</text>
        <text class="pc-perm-btn">去开启 ›</text>
      </view>
      <view v-else-if="isAndroid" class="pc-ok">系统统计已开启</view>
    </view>

    <!-- 专注进行中：白名单锁死。专注中途把新 App 加进来 = 给逃跑开方便之门，
         强制模式拦的就是这种"自己给自己开后门" —— 所以这段日子里只许用，不许改。 -->
    <view v-if="focusLock" class="card pc-lock">
      <view class="pc-lock-title">{{ $t('专注进行中，学习 App 暂时锁定') }}</view>
      <view class="pc-lock-txt">{{ $t('现在不能添加、移除或改用途 —— 专注完了再来。') }}</view>
    </view>

    <!-- 已添加的 App -->
    <view class="card" v-if="dock.length">
      <view class="card-head">
        <text class="card-title">我的学习 App（{{ dock.length }}）</text>
        <text class="card-more" @tap="tapAddToggle">＋ 添加</text>
      </view>
      <view v-for="a in dock" :key="a.pkg" class="dock-row" @tap="startEditDock(a)">
        <image v-if="iconMap[a.pkg]" class="dr-icon-img" :src="iconMap[a.pkg]" mode="aspectFit" />
        <view v-else class="dr-icon" :class="{ 'dr-rest': a.purpose === 'rest' }">{{ initialOf(a) }}</view>
        <view class="dr-main">
          <view class="dr-name">{{ a.name }}</view>
          <view class="dr-task">
            <text class="dr-task-label" :class="{ rest: a.purpose === 'rest' }">{{ a.purpose === 'rest' ? '休息' : '学习' }}</text>
            <text v-if="a.task" class="dr-task-text">{{ a.task }}</text>
            <text v-else-if="a.purpose === 'study'" class="dr-task-empty">未填写任务说明</text>
          </view>
          <view class="dr-pkg">{{ a.pkg }}</view>
        </view>
        <text class="dr-del" @tap.stop="askRemove(a)">移除</text>
      </view>
    </view>
    <view class="card" v-else>
      <view class="pc-title">还没添加 App</view>
      <view class="pc-txt">把背单词、刷题、看课用的 App 加进来，首页就能一键直达并自动计时。</view>
      <button class="btn-primary pc-btn" @tap="tapAddToggle">＋ 添加 App</button>
    </view>

    <!-- 添加面板（kb-open：搜索框聚焦时给底部补空白，让页面有余地滚到键盘之上） -->
    <view class="card add-card" v-if="adding" :class="{ 'kb-open': searchFocus }">
      <view class="card-head">
        <text class="card-title">{{ isAndroid ? '从已安装应用里选' : '手动添加' }}</text>
        <text class="card-more" @tap="adding = false">收起</text>
      </view>

      <template v-if="isAndroid">
        <!-- AI 推荐：按当前目标从手机里挑学习 App（2026-10-25 真机反馈：
             规划完目标却要自己在几百个应用里翻，让 AI 先挑一茬） -->
        <view v-if="aiEnabled && !aiRec.items.length && !aiRec.loading" class="ai-rec-entry">
          <text class="ai-rec-tip">{{ aiRec.err ? $t('AI 没推荐出来') : $t('不知道挑哪个？让 AI 按你的目标从手机里推荐') }}</text>
          <text class="ai-rec-btn" @tap="aiRecommend">{{ aiRec.err ? $t('再试一次') : $t('让 AI 推荐') }}</text>
        </view>
        <view v-if="aiRec.loading" class="ai-rec-tip ai-rec-wait">{{ $t('AI 正在按你的目标挑学习 App…') }}</view>
        <view v-if="aiRec.items.length" class="rec-list">
          <view class="rec-head">{{ $t('按你的目标推荐') }}</view>
          <view
            v-for="r in aiRec.items"
            :key="r.pkg"
            class="cand"
            :class="{ 'cand-added': isAdded(r) }"
            @tap="startAdd(candOf(r) || r)"
          >
            <image v-if="iconMap[r.pkg]" class="dr-icon-img" :src="iconMap[r.pkg]" mode="aspectFit" />
            <view v-else class="dr-icon">{{ (r.name || '?').slice(0, 1).toUpperCase() }}</view>
            <view class="dr-main">
              <view class="dr-name">{{ r.name }}</view>
              <view class="rec-task" v-if="r.task">{{ r.task }}</view>
              <view class="dr-pkg">{{ r.pkg }}</view>
            </view>
            <text class="cand-add">{{ isAdded(r) ? $t('已添加') : $t('添加') }}</text>
          </view>
        </view>
        <!-- cursor-spacing：让输入框比键盘上沿再高一点。
             光靠 adjust-position（默认开）系统只保证"刚好露出来"，输入框会贴着键盘边，
             打字时看着很局促，某些 ROM 上还会被候选词条压住。
             聚焦时再给卡片底部补一段空白（.kb-open），保证页面有富余能滚上去。 -->
        <input
          class="search"
          :value="kw"
          placeholder="搜索应用名"
          placeholder-style="color:#a8b0ab;font-size:26rpx"
          :cursor-spacing="30"
          :adjust-position="true"
          @input="onSearch"
          @focus="searchFocus = true"
          @blur="searchFocus = false"
        />
        <view v-if="loadingApps" class="apps-loading">
          <view class="al-spin"></view>
          <text class="al-txt">{{ loadingTip }}</text>
          <view v-for="i in 4" :key="i" class="sk-row">
            <view class="sk-icon"></view>
            <view class="sk-lines">
              <view class="sk-line sk-l1"></view>
              <view class="sk-line sk-l2"></view>
            </view>
          </view>
        </view>
        <template v-else>
          <view v-if="appsError" class="pc-warn">{{ appsError }}</view>
          <view v-if="!all.length" class="pc-txt">
            实在读不到就用手动添加：填 App 名称，能从别的途径拿到包名（如应用商店详情页）就一起填上。
          </view>
          <view v-else-if="!candidates.length" class="pc-txt">没有匹配「{{ kw }}」的应用</view>
          <scroll-view v-else class="app-scroll" scroll-y>
            <view
              v-for="c in candidates"
              :key="c.pkg"
              class="cand"
              :class="{ 'cand-added': isAdded(c) }"
              @tap="startAdd(c)"
            >
              <image v-if="iconMap[c.pkg]" class="dr-icon-img" :src="iconMap[c.pkg]" mode="aspectFit" />
              <view v-else class="dr-icon">{{ (c.name || '?').slice(0, 1).toUpperCase() }}</view>
              <view class="dr-main">
                <view class="dr-name">{{ c.name }}</view>
                <view class="dr-pkg">{{ c.pkg }}</view>
              </view>
              <text class="cand-add">{{ isAdded(c) ? '已添加' : '添加' }}</text>
            </view>
          </scroll-view>
        </template>
      </template>

      <template v-else>
        <view class="m-row">
          <text class="m-label">App 名称</text>
          <input class="m-input" v-model="manual.name" placeholder="例如：不背单词" />
        </view>
        <view class="m-row">
          <text class="m-label">包名（选填）</text>
          <input class="m-input" v-model="manual.pkg" placeholder="com.example.app" />
        </view>
        <button class="btn-primary pc-btn" @tap="startAddManual">保存</button>
      </template>

      <!-- 手动添加在 App 端也要有：列表读不全时的最后退路 -->
      <view v-if="isAndroid" class="manual-toggle" @tap="manualOpen = !manualOpen">
        {{ manualOpen ? '收起手动添加' : '列表里没有？手动添加 ›' }}
      </view>
      <view v-if="isAndroid && manualOpen" class="manual-box">
        <view class="m-row">
          <text class="m-label">App 名称</text>
          <input class="m-input" v-model="manual.name" placeholder="例如：不背单词" />
        </view>
        <view class="m-row">
          <text class="m-label">包名（选填）</text>
          <input class="m-input" v-model="manual.pkg" placeholder="com.example.app" />
        </view>
        <button class="btn-ghost pc-btn" @tap="startAddManual">保存</button>
      </view>
    </view>

    <view style="height: 40rpx"></view>

    <!-- 编辑/添加弹窗
         ⚠️ touchmove 必须在遮罩这层截断：fixed 只是视觉上盖住页面，滑动照样会
            冒泡上去、默认行为还会去滚背后的列表（2026-10-26，与 home.vue 的
            .fs-mask 同一处毛病）。这张卡里没有可滚区域，整层吞掉即可。 -->
    <view v-if="editor.show" class="pop-mask" @tap="closeEditor" @touchmove.stop.prevent="noop">
      <view class="edit-card" @tap.stop>
        <view class="edit-title">{{ editor.fromDock ? '编辑用途' : '添加学习 App' }}</view>
        <view class="edit-app">
          <image v-if="iconMap[editor.pkg]" class="edit-icon-img" :src="iconMap[editor.pkg]" mode="aspectFit" />
          <view v-else class="edit-icon fallback">{{ initialOf(editor) }}</view>
          <view class="edit-main">
            <view class="edit-name">{{ editor.name }}</view>
            <view class="edit-pkg">{{ editor.pkg }}</view>
          </view>
        </view>

        <view class="edit-row">
          <text class="edit-label">用途</text>
          <view class="seg">
            <text class="seg-opt" :class="{ 'seg-on': editor.purpose === 'study' }" @tap="editor.purpose = 'study'">学习</text>
            <text class="seg-opt" :class="{ 'seg-on': editor.purpose === 'rest' }" @tap="editor.purpose = 'rest'">休息</text>
          </view>
        </view>

        <view class="edit-row">
          <text class="edit-label">任务说明</text>
          <input
            class="edit-input"
            :value="editor.task"
            placeholder="例如：背单词、看英语学习视频"
            maxlength="30"
            @input="e => editor.task = e.detail.value"
          />
        </view>

        <view v-if="editor.guessing" class="edit-hint">AI 正在判断用途…</view>
        <view v-else-if="editor.guessErr" class="edit-hint err">{{ editor.guessErr }}</view>
        <view v-else-if="!editor.task && editor.purpose === 'study'" class="edit-hint">未填写时列表会提示「未填写任务说明」</view>

        <view class="edit-btns">
          <view class="edit-btn ghost" @tap="closeEditor">取消</view>
          <view
            v-if="!editor.fromDock && aiEnabled && !editor.task && !editor.guessed"
            class="edit-btn ghost"
            @tap="aiGuessEditor"
          >让 AI 判断</view>
          <view class="edit-btn primary" @tap="confirmEditor">{{ editor.fromDock ? '保存' : '添加' }}</view>
        </view>
      </view>
    </view>

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
  </view>
</template>

<script>
import * as pw from '../../../utils/pwstore.js'
import * as apptime from '../../../utils/apptime.js'
import * as focusMod from '../../../utils/focus.js'
import * as aiGuess from '../../../services/ai-app-guess.js'
import { isAIEnabled } from '../../../services/config.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../../components/app-dialog/app-dialog.vue'

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      dock: [],
      permitted: false,
      isAndroid: false,
      // 专注会话进行中 = 白名单锁死（见模板里 pc-lock 的说明）
      focusLock: false,
      aiEnabled: false,
      adding: false,
      all: [],
      kw: '',
      loadingApps: false,
      appsError: '',
      searchFocus: false,    // 搜索框是否聚焦（键盘抬起时给面板补底部空白）
      _appsRefreshed: false, // 本次进页面是不是已经真读过一次（避免后台刷新跑两遍）
      manual: { name: '', pkg: '', purpose: 'study' },
      iconMap: {},
      _iconPending: {},
      _iconQueue: [],    // 图标串行队列（见 pumpIcon：一次一个，处理完让 UI 喘一帧）
      _iconPumping: false,
      editor: {
        show: false,
        fromDock: false,
        pkg: '',
        name: '',
        purpose: 'study',
        task: '',
        guessing: false,
        guessed: false,
        guessErr: ''
      },
      // 统一弹窗（components/app-dialog）
      dlg: { show: false, mode: 'confirm', title: '', content: '', confirmText: '确定', danger: false, seq: 0, action: '', items: [], pkg: '' },
      manualOpen: false,
      // AI 推荐：按当前目标从已安装应用里挑学习 App（结果本进程内缓存）
      aiRec: { loading: false, err: '', items: [] }
    }
  },
  computed: {
    /** 加载文案：第一次读没有缓存，说清楚要等一下，别让用户以为卡死了 */
    loadingTip() {
      return this.all.length ? '正在更新应用列表…' : '正在读取应用列表…第一次会慢一点，之后就秒开'
    },
    candidates() {
      const k = String(this.kw || '').trim().toLowerCase()
      if (!k) return this.all.slice(0, 60)
      return this.all.filter(a => a.name.toLowerCase().indexOf(k) >= 0 || a.pkg.toLowerCase().indexOf(k) >= 0).slice(0, 60)
    }
  },
  watch: {
    candidates(list) {
      list.forEach(c => this.ensureIcon(c.pkg))
    },
    // 应用列表（两轮全量系统枚举 + 后面跟着一长串图标编码）只在用户真的要"添加"时才读：
    // 进页面就读的话，首页点"设置学习 App"会先白卡一阵才进来（真机踩过：卡到路由 locked）
    adding(open) {
      if (open && this.isAndroid && !this.all.length) this.loadApps()
    }
  },
  onShow() {
    this.refresh()
    // ⚠️ onShow 不 loadApps：只加载已添加的少量图标（refresh 里已经 ensureIcon(dock)）。
    // 全量列表延迟到 adding 面板打开时（见上面的 watch）。
  },
  methods: {
    // 占位：遮罩上的 @touchmove.stop.prevent 需要一个 handler 才能编译
    // （写法与 home.vue 的 noop 一致），本身什么也不做
    noop() {},
    refresh() {
      // 清一遍脏数据：早期版本可能存进过 pkg/name 为空的死行（真机截图出现过 null/undefined）
      const st = pw.get()
      const before = st.dock.length
      st.dock = st.dock.filter(a => a && a.pkg)
      st.dock.forEach(a => {
        if (!a.name || a.name === 'null') a.name = a.pkg
        if (a.task === undefined || a.task === null) a.task = ''
      })
      if (st.dock.length !== before) pw.touch()
      this.dock = st.dock
      this.isAndroid = apptime.supported()
      this.aiEnabled = isAIEnabled()
      this.permitted = this.isAndroid && apptime.hasUsagePermission()
      // 专注期间锁白名单：从专注页切过来时 onShow 会重算，专注一结束立刻解锁
      try { this.focusLock = !!focusMod.current() } catch (e) { this.focusLock = false }
      // 锁着的时候编辑面板/弹窗一律收起：不能留着半开的添加口
      if (this.focusLock) {
        this.adding = false
        if (this.editor.show) this.editor.show = false
      }
      this.dock.forEach(a => this.ensureIcon(a.pkg))
    },
    /** 添加面板开合的统一入口：专注期间只摇头不开门 */
    tapAddToggle() {
      if (this.focusLock) { this.lockToast(); return }
      this.adding = !this.adding
    },
    /** 锁定期的统一提示：为什么点不动 */
    lockToast() {
      uni.showToast({ title: this.$t('专注进行中，学完这段再来改'), icon: 'none' })
    },
    /**
     * 打开添加面板：先把列表铺出来，再考虑要不要刷新。
     *
     * 原来只有一条路 —— 同步去枚举系统里所有应用，读完了才有东西显示，
     * 于是低端机上"点『添加』以后干等一两秒、界面一点反应没有"，
     * 用户只能以为是自己手机卡了。
     *
     * 现在分两段：
     *   ① 有落盘缓存 → 立刻渲染（同步，零等待），后台再静默刷一次把新装的 App 补上；
     *   ② 没有缓存（第一次用）→ 才显示加载态，并且明确写出"第一次会慢一点"。
     */
    loadApps() {
      if (this.all.length) return
      const cached = apptime.installedAppsCached()
      if (cached.length) {
        this.all = cached
        this.appsError = ''
        // 后台静默刷新：装了新 App 也得能挑到。installedApps 内部有 5 分钟进程内缓存，
        // 所以这里最多真枚举一次，不会变成轮询。
        this.readApps(true)
        return
      }
      this.readApps(false)
    },
    /**
     * 真去读一次系统应用列表。
     * @param {boolean} silent true = 静默（已有内容在显示，不置加载态、不闪）
     */
    readApps(silent) {
      if (this._appsRefreshed) return
      this._appsRefreshed = true
      if (!silent) this.loadingApps = true
      // 读应用列表在部分低端机上偏慢，延一帧再跑，先让页面完成首绘
      setTimeout(() => {
        try {
          const list = apptime.installedApps()
          // 静默刷新时读空了不要清掉已有的列表 —— 那多半是偶发失败，
          // 把已经显示出来的内容抹掉比失败本身更糟
          if (list && list.length) this.all = list
          else if (!silent) this.all = []
          this.appsError = apptime.lastAppsError || ''
          // ⚠️ 不要在这里对 this.all 全量 ensureIcon —— 200+ 个图标一口气排进宏任务队列，
          //    每个都是"跨进程取图标 + 画 bitmap + 编码"，真机上会把主线程冻好几秒
          //    （页面冻住、路由 locked、退出不了，就是它）。候选区图标由 candidates 的
          //    watcher 按需加载（最多 60 个），再由下面的串行队列逐个消化。
        } catch (e) {
          if (!silent) {
            this.all = []
            this.appsError = '读取应用列表失败：' + ((e && e.message) || '未知错误')
          }
        }
        this.loadingApps = false
      }, silent ? 200 : 60)
    },
    onSearch(e) { this.kw = e.detail.value },
    isAdded(c) { return this.dock.some(a => a.pkg === c.pkg) },

    // ---------- 图标 ----------
    // 串行队列：一次只编码一个图标，处理完歇 30ms 再取下一个。
    // 为什么不能 setTimeout(0) 连发：每个图标都是"跨进程取 Drawable + 画 bitmap +
    // 编码 + base64"，单个几十毫秒；几十个连发 = 主线程连续被占满，UI 一帧都排不上
    // —— 真机上表现就是页面冻住、navigateTo 报 locked、退出键都没反应（踩过）。
    ensureIcon(pkg) {
      if (!pkg || this.iconMap[pkg] || this._iconPending[pkg]) return
      this._iconPending[pkg] = true
      this._iconQueue.push(pkg)
      this.pumpIcon()
    },
    pumpIcon() {
      if (this._iconPumping) return
      const pkg = this._iconQueue.shift()
      if (!pkg) return
      this._iconPumping = true
      setTimeout(() => {
        try {
          const url = apptime.appIconDataUrl(pkg)
          if (url) this.iconMap[pkg] = url
        } catch (e) {
          console.warn('[apps] 加载图标失败', pkg, e)
        }
        delete this._iconPending[pkg]
        this._iconPumping = false
        // 让 UI 先喘一帧，再消化下一个 —— 宁可图标出得慢，不能让页面冻住
        setTimeout(() => this.pumpIcon(), 30)
      }, 0)
    },

    // ---------- 添加/编辑 ----------
    openEditor(cfg) {
      const c = cfg || {}
      this.editor = {
        show: true,
        fromDock: !!c.fromDock,
        pkg: String(c.pkg || ''),
        name: String(c.name || ''),
        purpose: c.purpose === 'rest' ? 'rest' : 'study',
        task: String(c.task || ''),
        guessing: false,
        guessed: false,
        guessErr: ''
      }
      this.ensureIcon(this.editor.pkg)
      // 添加新学习 App 时，如果 AI 已启用，自动判断一次用途
      if (!c.fromDock && this.aiEnabled && !this.editor.task) {
        this.aiGuessEditor()
      }
    },
    closeEditor() {
      this.editor.show = false
    },
    startAdd(c) {
      if (this.isAdded(c)) return
      if (this.focusLock) { this.lockToast(); return }
      this.openEditor({ pkg: c.pkg, name: c.name, purpose: 'study' })
    },
    startAddManual() {
      if (this.focusLock) { this.lockToast(); return }
      const name = String(this.manual.name || '').trim()
      if (!name) { uni.showToast({ title: '先填个名字', icon: 'none' }); return }
      const pkg = String(this.manual.pkg || '').trim() || 'manual:' + name
      this.openEditor({ pkg, name, purpose: 'study' })
    },
    startEditDock(a) {
      if (this.focusLock) { this.lockToast(); return }
      this.openEditor({ fromDock: true, pkg: a.pkg, name: a.name, purpose: a.purpose, task: a.task })
    },
    async aiGuessEditor() {
      if (this.editor.guessing) return
      this.editor.guessing = true
      this.editor.guessErr = ''
      try {
        const r = await aiGuess.guessAppTask(this.editor.name, this.editor.pkg)
        this.editor.purpose = r.purpose
        this.editor.task = r.task
        this.editor.guessed = true
      } catch (e) {
        this.editor.guessErr = (e && e.message) ? e.message : 'AI 判断失败'
        // 未配置 AI 时不算错误， quietly 兜底
        if (e && e.notConfigured) this.editor.guessErr = ''
      }
      this.editor.guessing = false
    },
    confirmEditor() {
      const ed = this.editor
      const task = String(ed.task || '').trim()
      if (ed.fromDock) {
        pw.dockSetPurpose(ed.pkg, ed.purpose)
        pw.dockSetTask(ed.pkg, task)
      } else {
        if (this.dock.some(a => a.pkg === ed.pkg)) {
          this.closeEditor()
          return
        }
        pw.dockAdd(ed.pkg, ed.name, ed.purpose, task)
      }
      this.closeEditor()
      this.refresh()
      uni.showToast({ title: ed.fromDock ? '已保存' : '已添加', icon: 'success' })
    },

    addManual() {
      // 旧入口保留（手动添加现在走编辑器，这里不再直接保存）
      this.startAddManual()
    },
    togglePurpose(a) {
      pw.dockSetPurpose(a.pkg, a.purpose === 'rest' ? 'study' : 'rest')
      this.refresh()
    },

    // ---------- AI 推荐 ----------
    /** 目标上下文：目标标题 + 各自待办的头部几条，喂给推荐用 */
    goalsContext() {
      try {
        const lines = pw.activeGoals().map(g => {
          const todos = (g.tasks || []).filter(t => t.status === 'todo').slice(0, 5).map(t => t.title)
          return '- ' + g.title + (todos.length ? ('（要做：' + todos.join('；') + '）') : '')
        })
        return lines.join('\n') || '（还没有目标）'
      } catch (e) { return '（还没有目标）' }
    },
    /** 推荐行反查完整候选（拿 name/图标兜底；AI 只回 pkg+task） */
    candOf(r) {
      return this.all.filter(a => a.pkg === r.pkg)[0] || null
    },
    /** 让 AI 按目标推荐一次；失败展示"再试一次"，绝不打断手动添加 */
    async aiRecommend() {
      if (this.focusLock) { this.lockToast(); return }
      if (this.aiRec.loading) return
      this.aiRec.loading = true
      this.aiRec.err = ''
      try {
        // 全量名单可能还没读过（adding 的 watcher 只在面板打开时触发）——这里可能更早
        if (!this.all.length) {
          this.loadApps()
          for (let i = 0; i < 40 && !this.all.length; i++) {
            await new Promise(r => setTimeout(r, 100))
          }
        }
        const have = {}
        this.dock.forEach(a => { have[a.pkg] = true })
        const cands = this.all.filter(a => !have[a.pkg])
        const r = await aiGuess.recommendStudyApps(cands, this.goalsContext())
        const byPkg = {}
        this.all.forEach(a => { byPkg[a.pkg] = a })
        this.aiRec.items = (r.picks || [])
          .filter(p => byPkg[p.pkg])
          .map(p => Object.assign({}, byPkg[p.pkg], { task: p.task }))
        this.aiRec.items.forEach(x => this.ensureIcon(x.pkg))
        if (!this.aiRec.items.length) this.aiRec.err = this.$t('AI 没推荐出来')
      } catch (e) {
        this.aiRec.items = []
        this.aiRec.err = (e && e.message) ? e.message : this.$t('AI 没推荐出来')
        if (e && e.notConfigured) this.aiRec.err = this.$t('AI 服务未启用')
      }
      this.aiRec.loading = false
    },

    // ---------- 统一弹窗 ----------
    ask(cfg) {
      this.dlg = Object.assign(
        { show: true, mode: 'confirm', title: '', content: '', confirmText: '确定',
          danger: false, action: '', items: [], pkg: '' },
        cfg || {},
        { seq: (this.dlg && this.dlg.seq || 0) + 1 }
      )
    },
    onDlgYes() {
      const act = this.dlg.action
      const pkg = this.dlg.pkg
      this.dlg.show = false
      if (act === 'remove') {
        pw.dockRemove(pkg)
        this.refresh()
      }
    },
    askRemove(a) {
      if (this.focusLock) { this.lockToast(); return }
      this.ask({
        title: '移除 App',
        content: '「' + a.name + '」不再出现在首页，历史统计保留。',
        confirmText: '移除',
        danger: true,
        action: 'remove',
        pkg: a.pkg
      })
    },
    openPerm() {
      apptime.openUsageSettings()
    },
    initialOf(a) {
      return String(a.name || a.pkg || '?').slice(0, 1).toUpperCase()
    }
  }
}
</script>

<style>
.card { margin-bottom: 20rpx; }
.pc-title { font-size: 29rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.pc-txt { margin-top: 14rpx; font-size: 24rpx; line-height: 1.8; color: #5a6560; color: var(--ink-2, #5a6560); }
.pc-warn {
  margin: 16rpx 0; padding: 16rpx 20rpx;
  border-radius: 14rpx;
  background: rgba(247, 144, 9, 0.12);
  font-size: 23rpx; line-height: 1.7; color: #8a5800;
}
.manual-toggle { margin-top: 22rpx; font-size: 24rpx; color: var(--brand-strong, #bb1332); text-align: center; }
.manual-box { margin-top: 10rpx; padding-top: 6rpx; border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07); }
.pc-btn { margin-top: 24rpx; height: 84rpx; font-size: 27rpx; }
.pc-perm {
  margin-top: 20rpx;
  display: flex; align-items: center; justify-content: space-between;
  padding: 18rpx 24rpx;
  border-radius: 16rpx;
  background: rgba(247, 144, 9, 0.1);
}
.pc-perm-txt { font-size: 24rpx; color: #8a5800; }
.pc-perm-btn { font-size: 25rpx; font-weight: 600; color: #f79009; }
.pc-ok {
  margin-top: 20rpx;
  padding: 14rpx 24rpx;
  border-radius: 16rpx;
  background: rgba(59, 109, 17, 0.1);
  font-size: 24rpx; color: #3b6d11;
}

/* 专注期锁定提示（琥珀色，与"系统统计未开启"同一套警示视觉） */
.pc-lock { border: 2rpx solid rgba(247, 144, 9, 0.35); }
.pc-lock-title { font-size: 27rpx; font-weight: 600; color: #8a5800; }
.pc-lock-txt { margin-top: 8rpx; font-size: 23rpx; line-height: 1.7; color: #8a5800; opacity: 0.85; }

.card-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 20rpx;
}
.card-title { font-size: 29rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.card-more { font-size: 24rpx; color: #bb1332; color: var(--brand-strong, #bb1332); }

.dock-row { display: flex; align-items: center; padding: 16rpx 0; }
.dr-icon-img {
  width: 76rpx; height: 76rpx;
  border-radius: 20rpx;
  flex-shrink: 0;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.5);
}
.dr-icon {
  width: 76rpx; height: 76rpx;
  border-radius: 20rpx;
  background: rgba(228, 23, 61, 0.12);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.12);
  display: flex; align-items: center; justify-content: center;
  font-size: 30rpx; font-weight: 600;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  flex-shrink: 0;
}
.dr-rest { background: rgba(122, 124, 122, 0.16); color: #5a6560; color: var(--ink-2, #5a6560); }
.dr-main { flex: 1; min-width: 0; margin: 0 20rpx; }
.dr-name { font-size: 27rpx; color: #17201a; color: var(--ink-1, #17201a); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr-task {
  margin-top: 6rpx;
  display: flex; align-items: center;
  font-size: 22rpx;
  overflow: hidden;
}
.dr-task-label {
  flex-shrink: 0;
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  margin-right: 10rpx;
}
.dr-task-label.rest { background: rgba(122, 124, 122, 0.14); color: #5a6560; color: var(--ink-2, #5a6560); }
.dr-task-text {
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dr-task-empty {
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  font-style: italic;
}
.dr-pkg { margin-top: 4rpx; font-size: 20rpx; color: #98a19b; color: var(--ink-3, #98a19b); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr-purpose {
  flex-shrink: 0;
  font-size: 22rpx;
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(225, 29, 29, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  margin-right: 16rpx;
}
.dr-del {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #e5484d;
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(229, 72, 77, 0.08);
}

/* ===== 加载态 =====
   读应用列表在真机上要几百毫秒到一秒多，这段时间界面必须有反馈：
   没有的话用户只会得出一个结论 —— "是不是我手机卡了"。
   转圈 + 一句说明 + 骨架行，三件套都在说同一件事：在读，马上就好。 */
.apps-loading { padding: 4rpx 0 8rpx; }
.al-spin {
  width: 40rpx; height: 40rpx;
  margin: 10rpx auto 14rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.18);
  border-top-color: var(--brand, #e4173d);
  animation: al-spin 0.8s linear infinite;
}
@keyframes al-spin { to { transform: rotate(360deg); } }
.al-txt {
  display: block;
  text-align: center;
  font-size: 23rpx; line-height: 1.6;
  color: var(--ink-2, #5a6560);
}
.sk-row { display: flex; align-items: center; margin-top: 22rpx; }
.sk-icon {
  width: 76rpx; height: 76rpx;
  border-radius: 20rpx;
  flex-shrink: 0;
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
  animation: sk-pulse 1.4s ease-in-out infinite;
}
.sk-lines { flex: 1; min-width: 0; margin-left: 20rpx; }
.sk-line {
  height: 20rpx; border-radius: 999rpx;
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
  animation: sk-pulse 1.4s ease-in-out infinite;
}
.sk-l1 { width: 45%; }
.sk-l2 { width: 72%; margin-top: 12rpx; animation-delay: 0.18s; }
@keyframes sk-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* 搜索框聚焦：给面板底部补一段空白，让页面有富余滚到键盘之上
   （cursor-spacing 负责"抬高多少"，这里负责"有地方可抬"） */
.add-card.kb-open { padding-bottom: 220rpx; }

.search {
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 16rpx 22rpx;
  font-size: 26rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  margin-bottom: 12rpx;
}
.app-scroll { max-height: 640rpx; }
.cand { display: flex; align-items: center; padding: 12rpx 0; }
.cand-added { opacity: 0.45; }
.cand-add { flex-shrink: 0; font-size: 24rpx; color: #bb1332; color: var(--brand-strong, #bb1332); }

/* ===== AI 推荐区（按目标从已装应用里挑） ===== */
.ai-rec-entry {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16rpx; padding: 16rpx 22rpx;
  border-radius: 16rpx;
  background: rgba(124, 58, 237, 0.08);
}
.ai-rec-tip { flex: 1; font-size: 23rpx; line-height: 1.6; color: #5a6560; color: var(--ink-2, #5a6560); }
.ai-rec-wait { text-align: center; margin-bottom: 12rpx; }
.ai-rec-btn {
  flex-shrink: 0; margin-left: 16rpx;
  font-size: 24rpx; font-weight: 600;
  color: #7c3aed;
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(124, 58, 237, 0.12);
}
.rec-head {
  margin-bottom: 8rpx;
  font-size: 23rpx; font-weight: 600;
  color: #7c3aed;
}
.rec-task { margin-top: 2rpx; font-size: 22rpx; color: #7c3aed; }

.m-row { display: flex; align-items: center; padding: 18rpx 0; }
.m-label { width: 150rpx; font-size: 25rpx; color: #5a6560; color: var(--ink-2, #5a6560); flex-shrink: 0; }
.m-input { flex: 1; font-size: 26rpx; color: #17201a; color: var(--ink-1, #17201a); text-align: right; }
.seg { display: flex; }
.seg-opt {
  font-size: 23rpx;
  padding: 8rpx 26rpx;
  border-radius: 999rpx;
  margin-left: 12rpx;
  background: rgba(23, 32, 26, 0.06);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
.seg-on { background: #e4173d; background: var(--brand, #e4173d); color: #ffffff; }

/* 编辑/添加弹窗 */
.edit-card {
  width: 78vw;
  max-width: 560rpx;
  padding: 36rpx 32rpx;
  border-radius: 28rpx;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.86);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(var(--surface-rgb, 255, 255, 255), 0.8);
  box-shadow: 0 24rpx 70rpx rgba(23, 32, 26, 0.16);
}
.edit-title { font-size: 32rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); text-align: center; }
.edit-app {
  display: flex; align-items: center;
  margin-top: 28rpx; padding: 20rpx;
  border-radius: 20rpx;
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.04);
}
.edit-icon-img {
  width: 84rpx; height: 84rpx;
  border-radius: 22rpx;
  flex-shrink: 0;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.5);
}
.edit-icon {
  width: 84rpx; height: 84rpx;
  border-radius: 22rpx;
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.12);
  display: flex; align-items: center; justify-content: center;
  font-size: 34rpx; font-weight: 600;
  color: var(--brand-strong, #bb1332);
  flex-shrink: 0;
}
.edit-icon.fallback { background: rgba(var(--neutral-rgb, 23, 32, 26), 0.1); color: var(--ink-2, #5a6560); }
.edit-main { flex: 1; min-width: 0; margin-left: 20rpx; }
.edit-name { font-size: 28rpx; color: var(--ink-1, #17201a); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.edit-pkg { margin-top: 4rpx; font-size: 21rpx; color: var(--ink-3, #98a19b); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.edit-row {
  display: flex; align-items: center;
  margin-top: 26rpx;
}
.edit-label { width: 140rpx; font-size: 26rpx; color: var(--ink-2, #5a6560); flex-shrink: 0; }
.edit-input {
  flex: 1;
  font-size: 26rpx;
  color: var(--ink-1, #17201a);
  text-align: right;
  padding: 12rpx 16rpx;
  border-radius: 12rpx;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
}
.edit-hint {
  margin-top: 16rpx;
  font-size: 22rpx;
  color: var(--ink-3, #98a19b);
  text-align: center;
}
.edit-hint.err { color: #e5484d; }
.edit-btns {
  display: flex; align-items: center; justify-content: center;
  margin-top: 32rpx;
}
.edit-btn {
  flex: 1;
  height: 78rpx;
  margin: 0 8rpx;
  border-radius: 999rpx;
  display: flex; align-items: center; justify-content: center;
  font-size: 26rpx; font-weight: 600;
}
.edit-btn.ghost {
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
  color: var(--ink-2, #5a6560);
}
.edit-btn.primary {
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  color: var(--brand-strong, #bb1332);
  border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.4);
}
</style>
