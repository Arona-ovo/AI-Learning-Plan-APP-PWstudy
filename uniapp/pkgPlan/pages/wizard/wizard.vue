<template>
  <view class="container page-nav wizard-page" :class="appTheme" :style="appBgStyle">
    <float-navbar title="AI 目标规划" :busy="task.running" />

    <!-- ============ 第一步：目标 + 截止日期 + 每天投入（不弹系统日期框） ============ -->
    <view v-if="stage === 'form'" class="stage">
      <!-- 模板：第一次进来不知道怎么下笔时的台阶 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">不知道怎么下手？挑一个改改</text>
          <text class="card-more" @tap="tplOpen = !tplOpen">{{ tplOpen ? '收起' : '展开' }}</text>
        </view>
        <view v-if="tplOpen" class="tpl-grid">
          <view
            v-for="t in templates"
            :key="t.key"
            class="tpl"
            :class="{ 'tpl-on': draft.tplKey === t.key }"
            @tap="useTemplate(t)"
          >
            <view class="tpl-icon">{{ t.icon }}</view>
            <text class="tpl-name">{{ t.name }}</text>
          </view>
        </view>
        <view v-else class="tip">点「展开」看看内置的几个常见目标，选一个会自动填好标题、时长和建议跨度。</view>
      </view>

      <view class="card">
        <view class="f-label">你的远期目标</view>
        <textarea
          class="f-textarea"
          v-model="draft.title"
          :maxlength="120"
          placeholder="例如：三个月内专升本英语从 60 分提到 90 分"
          placeholder-style="color:#a8b0ab;font-size:26rpx"
        />
        <view class="f-count">{{ draft.title.length }}/120</view>
      </view>

      <view class="card">
        <view class="card-head">
          <text class="card-title">截止日期</text>
          <text class="card-date">{{ draft.deadline }}</text>
        </view>
        <!-- 快捷跨度 -->
        <view class="chips">
          <text
            v-for="q in quickDates"
            :key="q.d"
            class="chip"
            :class="{ 'chip-on': draft.deadline === q.date }"
            @tap="quickDate(q.d)"
          >{{ q.label }}</text>
        </view>
        <!-- 内嵌月历：点选日期，不再弹系统窗口，也没有滚轮"显示值≠选中值"的问题 -->
        <view class="mcal">
          <view class="mcal-head">
            <text class="mcal-nav" @tap="shiftMonth(-1)">‹</text>
            <text class="mcal-title">{{ calYear }} 年 {{ calMonth }} 月</text>
            <text class="mcal-nav" @tap="shiftMonth(1)">›</text>
          </view>
          <view class="mcal-week">
            <text v-for="w in weekNames" :key="w" class="mcal-wname">{{ w }}</text>
          </view>
          <view class="mcal-grid">
            <view
              v-for="(c, i) in calCells"
              :key="i"
              class="mcal-cell"
              :class="{
                'mcal-out': !c.inMonth,
                'mcal-off': c.off,
                'mcal-sel': c.date === draft.deadline,
                'mcal-today': c.now && c.date !== draft.deadline,
                'mcal-rest': c.rest
              }"
              @tap="pickDay(c)"
            >
              <text class="mcal-d">{{ c.d }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="card">
        <view class="card-head">
          <text class="card-title">每天可投入</text>
        </view>
        <view class="chips">
          <text
            v-for="m in minOptions"
            :key="m"
            class="chip"
            :class="{ 'chip-on': draft.dailyMin === m }"
            @tap="pickMin(m)"
          >{{ m }} 分钟</text>
        </view>
        <view class="tip">先定个大方向，后面 AI 会按你的实际情况追问细节（基础、可用时段、偏好等），问够了才开始拆计划。</view>
      </view>

      <view v-if="error" class="error-card">{{ error }}</view>
      <button class="btn-primary go-btn" :disabled="!canGo" @tap="startSession">下一步：和 AI 聊聊细节</button>
      <view v-if="!aiReady" class="ai-off">还没配置 AI 服务：到「我的 → 设置 → AI 服务」填好密钥后再来。</view>
    </view>

    <!-- ============ 第二步：对话式收集需求 ============ -->
    <view v-else-if="stage === 'chat'" class="stage chat-stage" :style="kbStyle">
      <scroll-view class="chat-scroll" scroll-y :scroll-into-view="anchorId">
        <view v-for="(m, i) in messages" :key="i" :id="'msg' + i" class="bubble-wrap" :class="{ 'mine': m.role === 'user' }">
          <view class="bubble" :class="m.role === 'user' ? 'b-mine' : 'b-ai'">
            <view v-if="m.images && m.images.length" class="b-imgs">
              <image
                v-for="(p, j) in m.images" :key="j"
                :src="p" mode="aspectFill" class="b-img"
                @tap="previewImg(m.images, j)"
              />
            </view>
            <text>{{ m.content }}</text>
          </view>
        </view>
        <view v-if="task.running && !task.paused" class="bubble-wrap">
          <view class="bubble b-ai b-typing">
            <text class="dot">·</text><text class="dot">·</text><text class="dot">·</text>
            <text class="typing-txt"> {{ task.runningWhat }}中</text>
          </view>
        </view>
        <view v-if="error" class="inline-error">{{ error }}</view>
        <view v-if="task.enough && !task.running" class="ready-tip">信息够了，可以开始生成计划。</view>
        <view :id="anchorId" style="height: 1rpx"></view>
      </scroll-view>

      <!-- 暂停态：改完再继续 -->
      <view v-if="task.paused" class="pause-bar">
        <textarea
          class="pause-input"
          v-model="pendingText"
          :maxlength="300"
          :adjust-position="false"
          :show-confirm-bar="false"
          placeholder="已暂停。改一改这句话，或补充点信息，再点继续"
          placeholder-style="color:#a8b0ab;font-size:25rpx"
        />
        <view class="pause-actions">
          <button class="btn-ghost pa-btn" @tap="resume(false)">不补了，直接继续</button>
          <button class="btn-primary pa-btn" @tap="resume(true)">用这句话继续</button>
        </view>
      </view>

      <!-- 常态输入条 -->
      <view v-else class="input-bar">
        <view v-if="pendingImgs.length" class="img-strip">
          <view v-for="(p, i) in pendingImgs" :key="i" class="img-thumb">
            <image :src="p" mode="aspectFill" @tap="previewImg(pendingImgs, i)" />
            <text class="img-x" @tap.stop="removeImg(i)">×</text>
          </view>
        </view>
        <view class="input-row">
          <textarea
            class="chat-input"
            v-model="input"
            :maxlength="300"
            :auto-height="true"
            :show-confirm-bar="false"
            :adjust-position="false"
            :cursor-spacing="16"
            placeholder="回答 AI 的问题…（可附图，如报班日程）"
            placeholder-style="color:#a8b0ab;font-size:26rpx"
          />
          <view class="ib-actions">
            <text v-if="task.running" class="ib-pause" @tap="doPause">暂停</text>
            <text class="ib-img" @tap="pickImg">图片</text>
            <text class="ib-send" :class="{ 'ib-send-off': (!input.trim() && !pendingImgs.length) || task.running }" @tap="doSend">发送</text>
          </view>
        </view>
      </view>

      <!-- 开始规划的入口：追问够了才变成主按钮 -->
      <view class="chat-bottom">
        <button v-if="task.enough && !task.running" class="btn-primary" @tap="doGenerate">开始规划</button>
        <button v-else class="btn-ghost" :disabled="task.running" @tap="doGenerate">直接开始规划（跳过追问）</button>
        <!-- 残留会话的出口：问到一半不想问了 / 生成失败卡住，以前只能杀进程重进 -->
        <text class="chat-abandon" @tap="doAbandon">放弃这次，重新填</text>
      </view>
    </view>

    <!-- ============ 第三步：结果预览（逐条勾选后才落地） ============ -->
    <view v-else class="stage">
      <view class="card">
        <view v-if="plan.local" class="p-local">
          没接 AI，这份是按通用节奏套的模板：阶段和任务名是通用的，得你自己改。
          想要贴合你情况的排期，到「我的 › AI 设置」填好服务商和密钥再重新生成。
        </view>
        <view class="p-title">{{ draft.title }}</view>
        <view class="p-meta">截止 {{ draft.deadline }} · 每天 {{ draft.dailyMin }} 分钟 · 共 {{ plan.tasks.length }} 个任务</view>
        <view v-if="plan.strategy" class="p-strategy">{{ plan.strategy }}</view>
        <view v-if="plan.risks && plan.risks.length" class="p-risks">
          <text v-for="(r, i) in plan.risks" :key="i" class="p-risk">⚠ {{ r }}</text>
        </view>
      </view>

      <view class="card" v-for="(group, gi) in grouped" :key="gi">
        <view class="card-head">
          <text class="card-title">{{ group.title }}</text>
          <text class="card-more">阶段 {{ gi + 1 }}</text>
        </view>
        <view
          v-for="t in group.tasks"
          :key="t.idx"
          class="pv-task"
          @tap="togglePick(t.idx)"
        >
          <view class="pv-check" :class="{ 'pv-check-on': picked[t.idx] }">{{ picked[t.idx] ? '✓' : '' }}</view>
          <view class="pv-main">
            <view class="pv-txt" :class="{ 'pv-txt-off': !picked[t.idx] }">{{ t.title }}</view>
            <view class="pv-sub">
              第 {{ t.day }} 天开始 · {{ t.pomos }} 个番茄
              <text v-if="t.light" class="pv-light">{{ t.light }}·已减量</text>
            </view>
          </view>
        </view>
      </view>

      <view class="pv-actions">
        <button class="btn-ghost pv-btn" :disabled="task.running" @tap="doRegenerate">{{ task.running ? '生成中…' : '重新生成' }}</button>
        <button class="btn-primary pv-btn" :disabled="!pickedCount" @tap="commit">落地这 {{ pickedCount }} 个任务</button>
      </view>
    </view>
  </view>
</template>

<script>
import * as pw from '../../../utils/pwstore.js'
import * as planTask from '../../../utils/plan-task.js'
import { TEMPLATES, seedOf } from '../../../data/goal-templates.js'
import * as holiday from '../../../utils/holiday.js'
import { aiGateReason } from '../../../services/config.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

export default {
  components: { FloatNavbar },
  data() {
    return {
      stage: 'form',                 // form | chat | result
      tplOpen: false,
      templates: TEMPLATES,
      draft: { title: '', deadline: '', dailyMin: 60, level: '', tplKey: '' },
      minOptions: [30, 60, 90, 120, 180, 240],
      weekNames: ['一', '二', '三', '四', '五', '六', '日'],
      calYear: 2026, calMonth: 10, calCells: [],
      quickDates: [],
      task: { running: false, runningWhat: '', paused: false, enough: false, pendingText: '' },
      messages: [],
      input: '',
      pendingText: '',
      pendingImgs: [],   // 本轮要随消息一起发的图（本地临时路径，最多 3 张）
      kbH: 0,            // 软键盘高度（px）：键盘弹起时给对话区加同值 padding，页面顶端不再被顶走
      anchorN: 0,        // 滚动锚点的自增序号：键盘弹出/发消息时换 id，强制 scroll-view 滚到底
      plan: null,
      picked: {},
      error: '',
      aiReady: true
    }
  },
  computed: {
    anchorId() {
      // 锚点 id 里带上消息数与自增序号：新消息、键盘弹出都会变成新 id，
      // scroll-into-view 才会真的重新滚（同值不会重触发）
      return 'anchor' + this.anchorN + '-' + this.messages.length
    },
    kbStyle() {
      return this.kbH > 0 ? { paddingBottom: this.kbH + 'px' } : {}
    },
    canGo() {
      return String(this.draft.title).trim().length >= 4 && !!this.draft.deadline
    },
    grouped() {
      if (!this.plan) return []
      const out = []
      this.plan.tasks.forEach((t, idx) => {
        const mi = t.ms - 1
        while (out.length <= mi) out.push({ title: this.plan.milestones[out.length] ? this.plan.milestones[out.length].title : '阶段', tasks: [] })
        out[mi].tasks.push(Object.assign({ idx }, t))
      })
      return out
    },
    pickedCount() {
      return Object.keys(this.picked).filter(k => this.picked[k]).length
    }
  },
  onLoad() {
    const t0 = pw.today()
    this.draft.deadline = pw.addDays(t0, 90)
    this.syncCal()
    this.quickDates = [
      { d: 14, label: '2 周', date: pw.addDays(t0, 14) },
      { d: 30, label: '1 个月', date: pw.addDays(t0, 30) },
      { d: 90, label: '3 个月', date: pw.addDays(t0, 90) },
      { d: 180, label: '半年', date: pw.addDays(t0, 180) },
      { d: 365, label: '1 年', date: pw.addDays(t0, 365) }
    ]
    try { this.aiReady = !aiGateReason() } catch (e) { this.aiReady = false }
    this.__onChange = () => this.syncFromTask()
    try { uni.$on(planTask.CHANGE_EVENT, this.__onChange) } catch (e) {}
    // 键盘：adjust-position=false 关掉"整页上推"（顶端会被顶出屏幕），
    // 改成自己听高度，给对话区加 padding，只动底部
    this.__onKb = (res) => {
      this.kbH = (res && res.height) || 0
      if (this.kbH > 0) this.anchorN++
    }
    try { uni.onKeyboardHeightChange(this.__onKb) } catch (e) {}
  },
  onShow() {
    this.syncFromTask()
  },
  onUnload() {
    try { if (this.__onChange) uni.$off(planTask.CHANGE_EVENT, this.__onChange) } catch (e) {}
    try { if (this.__onKb) uni.offKeyboardHeightChange(this.__onKb) } catch (e) {}
  },
  methods: {
    // ---------- 日期（内嵌月历点选） ----------
    syncCal() {
      // 月历的初始月份跟随当前选中日期，保证选中态看得见
      const p = String(this.draft.deadline || pw.today()).split('-')
      this.calYear = Number(p[0])
      this.calMonth = Number(p[1])
      this.buildCal()
    },
    buildCal() {
      const first = new Date(this.calYear, this.calMonth - 1, 1)
      const daysInMonth = new Date(this.calYear, this.calMonth, 0).getDate()
      const lead = (first.getDay() + 6) % 7   // 周一开头
      const today = pw.today()
      const cells = []
      let i = 0
      for (; i < lead; i++) {
        const d = new Date(this.calYear, this.calMonth - 1, 1 - (lead - i))
        cells.push({ date: holiday.toStr(d), d: d.getDate(), inMonth: false, off: true })
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const date = this.calYear + '-' + holiday.pad(this.calMonth) + '-' + holiday.pad(d)
        const type = holiday.dayType(date)
        cells.push({
          date, d, inMonth: true,
          off: date < today,                       // 过去的日子不可选
          now: date === today,
          rest: type === 'holiday' || type === 'weekend'
        })
      }
      while (cells.length % 7 !== 0) {
        const last = cells[cells.length - 1]
        const nd = holiday.addDays(last.date, 1)
        cells.push({ date: nd, d: Number(nd.slice(8)), inMonth: false, off: true })
      }
      this.calCells = cells
    },
    pickDay(c) {
      if (!c || !c.inMonth || c.off) return
      this.draft.deadline = c.date
      this.buildCal()
    },
    shiftMonth(n) {
      let m = this.calMonth + n
      let y = this.calYear
      if (m < 1) { m = 12; y-- }
      if (m > 12) { m = 1; y++ }
      this.calYear = y
      this.calMonth = m
      this.buildCal()
    },
    quickDate(d) {
      this.draft.deadline = pw.addDays(pw.today(), d)
      this.syncCal()
    },
    pickMin(m) { this.draft.dailyMin = m },

    // ---------- 模板 ----------
    useTemplate(t) {
      const seed = seedOf(t, pw.today())
      this.draft = {
        title: seed.title,
        deadline: pw.addDays(pw.today(), seed.spanDays),
        dailyMin: seed.dailyMin,
        level: seed.level,
        tplKey: t.key,
        raw: seed.raw          // 会话开始时一起喂给 AI
      }
      this.tplOpen = false
      this.syncCal()
      uni.showToast({ title: '已填入，可以再改改', icon: 'none' })
    },

    // ---------- 会话 ----------
    syncFromTask() {
      const s = planTask.snapshot()
      this.task = s
      this.messages = s.messages || []
      if (s.seed) this.draft = Object.assign(this.draft, s.seed)
      this.error = s.error || ''
      // 阶段判定：结果出来了 → 结果页；有会话 → 对话页；否则表单页
      if (s.plan) {
        this.plan = s.plan
        if (!Object.keys(this.picked).length) {
          const p = {}
          s.plan.tasks.forEach((t, idx) => { p[idx] = true })
          this.picked = p
        }
        this.stage = 'result'
      } else if (s.stage === 'ask' || s.stage === 'plan' || s.stage === 'error') {
        this.stage = 'chat'
      } else {
        this.stage = 'form'
      }
      if (s.stage === 'plan' && !s.plan && !s.running) this.stage = 'chat'
    },
    startSession() {
      if (!this.canGo) return
      const seed = {
        title: String(this.draft.title).trim(),
        raw: String(this.draft.raw || this.draft.title || '').trim(),
        deadline: this.draft.deadline,
        dailyMin: this.draft.dailyMin,
        level: String(this.draft.level || '').trim()
      }
      planTask.startSession(seed)
      this.syncFromTask()
      // 第一句话就是目标本身，让 AI 接着追问
      planTask.send(seed.title)
    },
    doSend() {
      const text = String(this.input || '').trim()
      const imgs = this.pendingImgs.slice()
      if ((!text && !imgs.length) || this.task.running) return
      this.input = ''
      this.pendingImgs = []
      planTask.send(text || '（见图）', imgs)
    },

    // ---------- 附图（报班日程截图等） ----------
    pickImg() {
      const left = 3 - this.pendingImgs.length
      if (left <= 0) {
        uni.showToast({ title: '一次最多带 3 张图', icon: 'none' })
        return
      }
      uni.chooseImage({
        count: left,
        sizeType: ['compressed'],
        success: (res) => {
          this.pendingImgs = this.pendingImgs.concat(res.tempFilePaths || []).slice(0, 3)
          this.compressPending()
        }
      })
    },
    // 截图动辄 2-4MB，base64 塞请求体太肥：压一道质量，压不动就按原图发
    compressPending() {
      // #ifdef APP-PLUS
      Promise.all(this.pendingImgs.map((p) => new Promise((resolve) => {
        uni.compressImage({
          src: p,
          quality: 55,
          success: (r) => resolve((r && r.tempFilePath) || p),
          fail: () => resolve(p)
        })
      }))).then((arr) => { this.pendingImgs = arr })
      // #endif
    },
    removeImg(i) {
      this.pendingImgs = this.pendingImgs.filter((x, idx) => idx !== i)
    },
    previewImg(list, i) {
      uni.previewImage({ urls: list, current: i })
    },
    doPause() {
      planTask.pause()
      this.pendingText = ''
      this.syncFromTask()
    },
    resume(withText) {
      const text = withText ? String(this.pendingText || '').trim() : ''
      planTask.resume(text)
      this.pendingText = ''
    },
    doGenerate() { planTask.generate() },
    doRegenerate() { planTask.regenerate() },
    /**
     * 放弃这段会话，回到第一步重填。
     * 以前没有这个出口：问到一半改主意、或者生成失败卡在对话页，只能杀进程重进。
     */
    doAbandon() {
      uni.showModal({
        title: '放弃这次规划？',
        content: '这段对话会清掉，回到最开始重新填目标（已填的内容还在）。',
        confirmText: '放弃',
        confirmColor: '#E5484D',
        success: (r) => {
          if (!r.confirm) return
          planTask.abandon()
          this.plan = null
          this.picked = {}
          this.messages = []
          this.error = ''
          this.stage = 'form'
        }
      })
    },

    // ---------- 落地 ----------
    togglePick(idx) {
      this.picked[idx] = !this.picked[idx]
    },
    commit() {
      if (!this.plan) return
      const tasks = this.plan.tasks.filter((t, idx) => this.picked[idx])
      if (!tasks.length) return
      const g = pw.addGoal({
        title: String(this.draft.title).trim(),
        raw: String(this.draft.title).trim(),
        deadline: this.draft.deadline,
        dailyMin: this.draft.dailyMin,
        level: String(this.draft.level || '').trim()
      }, Object.assign({}, this.plan, { tasks }))
      planTask.reset()
      uni.showToast({ title: '目标已落地', icon: 'success' })
      setTimeout(() => {
        uni.redirectTo({ url: '/pkgPlan/pages/goal-detail/goal-detail?id=' + g.id })
      }, 600)
    }
  }
}
</script>

<style>
.wizard-page { display: flex; flex-direction: column; min-height: 100vh; }
.stage { padding-bottom: 40rpx; }
.stage .card { margin-bottom: 20rpx; }

/* ===== 目标模板 ===== */
.tpl-grid { display: flex; flex-wrap: wrap; }
.tpl {
  width: 31%;
  margin: 0 2% 16rpx 0;
  padding: 20rpx 10rpx;
  box-sizing: border-box;
  border-radius: 16rpx;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
  display: flex; flex-direction: column; align-items: center;
}
.tpl:nth-child(3n) { margin-right: 0; }
.tpl-on { border-color: var(--brand, #e11d48); background: rgba(var(--brand-rgb, 225, 29, 72), 0.08); }
.tpl-icon {
  width: 56rpx; height: 56rpx; border-radius: 50%;
  background: rgba(var(--brand-rgb, 225, 29, 72), 0.14);
  color: var(--brand-strong, #be123c);
  font-size: 26rpx; line-height: 56rpx; text-align: center;
  font-family: Georgia, serif;
}
.tpl-name { margin-top: 10rpx; font-size: 22rpx; color: var(--ink-1, #17201a); text-align: center; }

.f-label { font-size: 26rpx; color: #5a6560; color: var(--ink-2, #5a6560); }
.f-textarea {
  margin-top: 18rpx;
  width: 100%; height: 200rpx;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 20rpx 24rpx;
  font-size: 28rpx; line-height: 1.6;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.f-count { margin-top: 10rpx; text-align: right; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16rpx; }
.card-title { font-size: 29rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.card-date { font-size: 26rpx; color: #be123c; color: var(--brand-strong, #be123c); font-family: Georgia, serif; }
.card-more { font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

.chips { display: flex; flex-wrap: wrap; }
.chip {
  font-size: 24rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  padding: 10rpx 26rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
  margin: 0 12rpx 12rpx 0;
}
.chip-on {
  color: #ffffff;
  background: #e11d48;
  background: var(--brand, #e11d48);
  border-color: transparent;
}

/* ===== 内嵌月历（替代 uni 的 mode="date" 系统弹窗） ===== */
.mcal { margin-top: 10rpx; }
.mcal-head { display: flex; align-items: center; justify-content: space-between; padding: 6rpx 10rpx; }
.mcal-title { font-size: 26rpx; font-weight: 600; color: var(--ink-1, #17201a); }
.mcal-nav { font-size: 36rpx; color: var(--ink-2, #5a6560); padding: 0 20rpx; }
.mcal-week { display: flex; margin-bottom: 6rpx; }
.mcal-wname { flex: 1; text-align: center; font-size: 20rpx; color: var(--ink-3, #98a19b); }
.mcal-grid { display: flex; flex-wrap: wrap; }
.mcal-cell {
  width: 14.28%;
  height: 84rpx;
  display: flex; align-items: center; justify-content: center;
  border-radius: 12rpx;
  box-sizing: border-box;
}
.mcal-d { font-size: 25rpx; color: var(--ink-1, #17201a); font-family: Georgia, serif; }
.mcal-out .mcal-d { color: var(--ink-3, #98a19b); opacity: 0.45; }
.mcal-off .mcal-d { color: var(--ink-3, #98a19b); opacity: 0.35; }
.mcal-rest { background: rgba(247, 144, 9, 0.08); }
.mcal-sel { background: var(--brand, #e11d48); }
.mcal-sel .mcal-d { color: #ffffff; font-weight: 600; }
.mcal-today { border: 2rpx solid var(--brand, #e11d48); }

.tip { margin-top: 20rpx; font-size: 22rpx; line-height: 1.7; color: #98a19b; color: var(--ink-3, #98a19b); }
.error-card {
  margin-bottom: 20rpx; padding: 24rpx 28rpx;
  border-radius: 18rpx;
  background: rgba(229, 72, 77, 0.1);
  font-size: 25rpx; line-height: 1.7; color: #c2323a;
}
.go-btn { margin-top: 10rpx; }
.ai-off { margin-top: 18rpx; font-size: 23rpx; color: #8a5800; text-align: center; }

/* ===== 对话 ===== */
.chat-stage { display: flex; flex-direction: column; flex: 1; }
.chat-scroll { flex: 1; min-height: 300rpx; }
.bubble-wrap { display: flex; justify-content: flex-start; margin-bottom: 20rpx; }
.bubble-wrap.mine { justify-content: flex-end; }
.bubble {
  max-width: 78%;
  padding: 22rpx 28rpx;
  font-size: 27rpx; line-height: 1.65;
  border-radius: 24rpx;
}
.b-ai {
  background: rgba(255, 255, 255, 0.82);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.82);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
  border-bottom-left-radius: 8rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.b-mine {
  background: #e11d48;
  background: var(--brand, #e11d48);
  color: #ffffff;
  border-bottom-right-radius: 8rpx;
}
.b-typing { color: #98a19b; color: var(--ink-3, #98a19b); }
.dot { font-size: 40rpx; line-height: 1; }
.typing-txt { font-size: 24rpx; margin-left: 6rpx; }
.inline-error {
  padding: 18rpx 24rpx; margin-bottom: 20rpx;
  border-radius: 16rpx;
  background: rgba(229, 72, 77, 0.1);
  font-size: 24rpx; line-height: 1.6; color: #c2323a;
}
.ready-tip {
  text-align: center;
  font-size: 23rpx;
  color: #3b6d11;
  margin-bottom: 12rpx;
}

.input-bar {
  border-top: 2rpx solid rgba(23, 32, 26, 0.07);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
  padding: 16rpx 0 12rpx;
}
.input-row { display: flex; align-items: flex-end; }
.img-strip { display: flex; padding: 0 0 14rpx; }
.img-thumb {
  position: relative;
  width: 108rpx; height: 108rpx;
  margin-right: 14rpx;
  border-radius: 14rpx;
  overflow: hidden;
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
}
.img-thumb image { width: 100%; height: 100%; display: block; }
.img-x {
  position: absolute; top: 0; right: 0;
  width: 36rpx; height: 36rpx;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  color: #ffffff; font-size: 26rpx; line-height: 1;
  border-bottom-left-radius: 12rpx;
}
.b-imgs { display: flex; flex-wrap: wrap; gap: 10rpx; margin-bottom: 10rpx; }
.b-img { width: 200rpx; height: 200rpx; border-radius: 12rpx; display: block; }
.chat-input {
  flex: 1;
  max-height: 200rpx;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 18rpx;
  padding: 16rpx 22rpx;
  font-size: 26rpx; line-height: 1.6;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.ib-actions { display: flex; flex-direction: column; align-items: flex-end; margin-left: 16rpx; }
.ib-send {
  font-size: 27rpx; font-weight: 600;
  color: #be123c;
  color: var(--brand-strong, #be123c);
  padding: 12rpx 26rpx;
  border-radius: 999rpx;
  background: rgba(225, 29, 72, 0.1);
  background: rgba(var(--brand-rgb, 225, 29, 72), 0.1);
}
.ib-send-off { color: #b0b7b2; background: rgba(23, 32, 26, 0.05); }
.ib-pause { font-size: 23rpx; color: #5a6560; color: var(--ink-2, #5a6560); margin-bottom: 12rpx; }
.ib-img {
  font-size: 23rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
  margin-bottom: 12rpx;
}

.pause-bar {
  padding: 16rpx 0;
  border-top: 2rpx solid rgba(23, 32, 26, 0.07);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}
.pause-input {
  width: 100%; height: 160rpx;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  border: 2rpx solid #f79009;
  border-radius: 18rpx;
  padding: 18rpx 22rpx;
  font-size: 26rpx; line-height: 1.6;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.pause-actions { display: flex; margin-top: 16rpx; }
.pa-btn { flex: 1; height: 84rpx; font-size: 26rpx; }
.pa-btn:first-child { margin-right: 16rpx; }

.chat-bottom { padding-top: 8rpx; }
.chat-abandon {
  display: block; margin-top: 22rpx; text-align: center;
  font-size: 23rpx; color: #98a19b; color: var(--ink-3, #98a19b);
}

/* ===== 结果 ===== */
.p-local {
  margin-bottom: 18rpx; padding: 16rpx 20rpx; border-radius: 16rpx;
  font-size: 23rpx; line-height: 1.65;
  color: #92400e; color: var(--ink-2, #92400e);
  background: rgba(247, 144, 9, 0.12);
}
.p-title { font-size: 32rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.p-meta { margin-top: 12rpx; font-size: 23rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
.p-strategy {
  margin-top: 18rpx; padding: 18rpx 22rpx;
  border-radius: 16rpx;
  background: rgba(225, 29, 72, 0.07);
  background: rgba(var(--brand-rgb, 225, 29, 72), 0.07);
  font-size: 25rpx; line-height: 1.7;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.p-risks { margin-top: 16rpx; display: flex; flex-direction: column; }
.p-risk { font-size: 23rpx; line-height: 1.7; color: #8a5800; }

.pv-task { display: flex; align-items: flex-start; padding: 16rpx 0; }
.pv-check {
  width: 40rpx; height: 40rpx;
  border-radius: 12rpx;
  border: 2rpx solid rgba(23, 32, 26, 0.2);
  border: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.2);
  display: flex; align-items: center; justify-content: center;
  font-size: 26rpx; color: #ffffff;
  flex-shrink: 0; margin-top: 4rpx;
}
.pv-check-on { background: #e11d48; background: var(--brand, #e11d48); border-color: transparent; }
.pv-main { flex: 1; min-width: 0; margin-left: 20rpx; }
.pv-txt { font-size: 27rpx; line-height: 1.5; color: #17201a; color: var(--ink-1, #17201a); }
.pv-txt-off { color: #98a19b; color: var(--ink-3, #98a19b); text-decoration: line-through; }
.pv-sub { margin-top: 6rpx; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
.pv-light {
  margin-left: 10rpx; padding: 2rpx 10rpx; border-radius: 999rpx;
  background: rgba(247, 144, 9, 0.16); color: #b25e00;
}

.pv-actions { display: flex; margin: 10rpx 0 30rpx; }
.pv-btn { flex: 1; }
.pv-btn:first-child { margin-right: 20rpx; }
</style>
