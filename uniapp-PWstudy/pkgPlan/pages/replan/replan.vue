<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="AI 重新规划" :back="true" :busy="loading" />

    <!-- 加载中 -->
    <view v-if="loading" class="state">
      <view class="spin"></view>
      <text class="state-txt">
        {{ fromLog ? 'AI 正在结合你今天的收工填报和近 7 天的真实投入重排剩余任务…' : 'AI 正在结合你近 7 天的真实投入重排剩余任务…' }}
      </text>
    </view>

    <!-- 出错 -->
    <view v-else-if="error" class="state">
      <text class="error">{{ error }}</text>
      <textarea
        class="hint-input hint-err"
        v-model="hint"
        :maxlength="200"
        :disabled="loading"
        :placeholder="$t('想跟 AI 说点什么？（可不填，直接再试一次）')"
        placeholder-style="color:#a8b0ab;font-size:25rpx"
        :auto-height="true"
      />
      <button class="btn-primary retry" @tap="run">再试一次</button>
      <text v-if="pendingImgs.length" class="img-kept">
        {{ $t('已附 {n} 张图，重试时会一起发', { n: pendingImgs.length }) }}
      </text>
    </view>

      <!-- 结果预览 -->
    <view v-else-if="result" class="body">
      <view class="card" v-if="result.summary">
        <text v-if="logText" class="log-tip">今天的出入：{{ logText }}</text>
        <text class="summary">{{ result.summary }}</text>
        <!-- 模型不看图时说明一句：否则用户会以为截图被读了，实际只按文字排 -->
        <text v-if="result.imgIgnored" class="img-ignored">
          {{ $t('当前模型看不了图片，这次只按文字重排了。换成支持视觉的模型（如 gpt-4o-mini）就能读图。') }}
        </text>
        <text v-if="overdueText" class="overdue-tip">{{ overdueText }}</text>
        <text v-if="streakText" class="overdue-tip">{{ streakText }}</text>
      </view>

      <!-- 固定安排：补习班 / 上课这类"客观占用"的时段。
           用户 2026-11-03 的场景：临时收到补习班通知，重排完把上课时间记进日历。
           2026-11-04：地图选点太简陋又定位不准，砍掉"地点"，只留名称 + 时间；
           判断"有没有去上课"改由主页打卡完成（见 utils/tutor.js）。 -->
      <view v-if="fixedList.length" class="card fixed-card">
        <view class="fixed-head">
          <text class="fixed-title">{{ $t('固定安排') }}</text>
          <text class="fixed-tip">{{ $t('这些时段不排学习任务') }}</text>
        </view>
        <view v-for="(f, i) in fixedList" :key="i" class="fixed-row">
          <view class="fixed-main">
            <view class="fixed-line">
              <text class="fixed-name">{{ f.name }}</text>
              <text v-if="f.when" class="fixed-when">{{ f.when }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="card op-card" v-for="(op, i) in result.ops" :key="i" @tap="pick[i] = !pick[i]">
        <view class="pv-check" :class="{ 'pv-check-on': pick[i] }">{{ pick[i] ? '✓' : '' }}</view>
        <view class="op-main">
          <view class="op-line">
            <text class="op-level" :class="'lv-' + (op.level || 'content')">{{ levelText(op) }}</text>
            <text class="op-kind" :class="'op-' + op.op">{{ kindText(op) }}</text>
            <!-- 大字标题：一眼看出这条要改什么。原来第一行只有「策略」「建议」
                 两个小标签，用户得读完整段淡色小字才知道改了什么。
                 标题一律由 services/plan-agent.js 的 headlineOf() 产出（含兜底），
                 页面不再自己拼一遍 —— 单一口径，也少一处漏翻的中文 -->
            <text class="op-head" v-if="op.headline">{{ op.headline }}</text>
          </view>
          <view class="op-task" v-if="taskTitle(op)">{{ taskTitle(op) }}</view>
          <view class="op-detail" v-if="opDetail(op)">{{ opDetail(op) }}</view>
          <view class="op-reason" v-if="op.reason || op.text">{{ op.reason || op.text }}</view>
        </view>
      </view>

      <view v-if="!result.ops.length" class="card state-inline">
        <text class="state-txt">AI 认为目前计划无需调整，按部就班执行就好。</text>
      </view>

      <view class="actions" v-if="result.ops.length">
        <button class="btn-ghost act-btn" @tap="back">先不改</button>
        <button class="btn-primary act-btn" :disabled="!pickedCount" @tap="apply">应用选中的 {{ pickedCount }} 条</button>
      </view>

      <!-- 对 AI 补一句话再重排（2026-10-25 真机反馈："目标规划好了，
           却不能重新和 AI 说话再生成"）。这里就是那个说话的口子：
           写点近况 / 新要求，AI 会把这句话当成本人意见一起看。
           2026-11-03：加了图片 —— "突然收到补习班通知"这类事，打一百个字
           不如发一张截图；原来的图片入口只在新建目标的对话里，重排页没有。 -->
      <view class="card hint-card">
        <view class="hint-title">{{ $t('对结果不满意？跟 AI 说一声') }}</view>
        <textarea
          class="hint-input"
          v-model="hint"
          :maxlength="200"
          :disabled="loading"
          :placeholder="$t('例如：这周要补课，晚上才有空；数学想多排点……')"
          placeholder-style="color:#a8b0ab;font-size:25rpx"
          :auto-height="true"
        />
        <view v-if="pendingImgs.length" class="img-strip">
          <view v-for="(p, i) in pendingImgs" :key="i" class="img-thumb">
            <image :src="p" mode="aspectFill" @tap="previewImg(pendingImgs, i)" />
            <text class="img-x" @tap.stop="removeImg(i)">×</text>
          </view>
        </view>
        <view class="hint-foot">
          <text class="hint-img" @tap="pickImg">{{ $t('＋ 图片') }}</text>
          <text class="hint-img-tip">{{ $t('课表、补习班通知都能发') }}</text>
        </view>
        <button class="btn-primary hint-btn" :disabled="loading || (!hint.trim() && !pendingImgs.length)" @tap="run">
          {{ loading ? $t('AI 正在重新生成…') : (pendingImgs.length ? $t('带这张图重新生成') : $t('带这句话重新生成')) }}
        </button>
      </view>
    </view>
  </view>
</template>

<script>
import * as pw from '../../../utils/pwstore.js'
import * as dailylog from '../../../utils/dailylog.js'
import { replanGoal, replanFromToday } from '../../../services/plan-agent.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../../components/app-dialog/app-dialog.vue'
import * as calmark from '../../../utils/calmark.js'
import * as settings from '../../../utils/settings.js'

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      id: '', loading: false, error: '', result: null, pick: {},
      overdueText: '', streakText: '', fromLog: false, logText: '',
      // 用户想对 AI 补的话（可为空）：run() 会把它作为"本人最新意见"喂给模型
      hint: '',
      // 随这次重排一起发的图（本地临时路径，最多 3 张）：课表 / 补习班通知截图
      pendingImgs: [],
      // 本次结果里识别出的固定安排（补习班等）
      fixedList: []
    }
  },
  computed: {
    pickedCount() {
      return Object.keys(this.pick).filter(k => this.pick[k]).length
    }
  },
  onLoad(query) {
    this.id = (query && query.id) || ''
    // from=log：从"今日收工"过来 —— 把今天的填报一起喂给 AI，
    // 它才知道"你今天做的和计划不一样在哪"，而不是只看专注总数瞎调。
    this.fromLog = !!(query && query.from === 'log')
    const log = this.fromLog ? dailylog.logOf(pw.today()) : null
    this.logText = log ? dailylog.driftText(log) : ''
  },
  onShow() {
    if (!this.result) this.run()
  },
  methods: {
    goal() { return pw.goalOf(this.id) },
    async run() {
      const g = this.goal()
      if (!g) { this.error = '目标不存在或已删除'; return }
      if (!g.tasks || !g.tasks.filter(t => t.status === 'todo').length) {
        this.error = '这个目标已经没有待办任务了，先去执行几天再来看。'
        return
      }
      this.loading = true
      this.error = ''
      try {
        // 现实情况：近 7 天真实投入 + 超期任务数（AI 据此判断该调策略、调内容还是顺延时间）
        const week = pw.recentDays(7).map(d => d.focusMin).join(', ')
        const elapsed = pw.dayDiff(pw.dateStr(new Date(g.createdAt)), pw.today()) + 1
        const overdue = (g.tasks || []).filter(t => t.status === 'todo' && t.day < elapsed)
        // 连续少做天数：模型数不出来，而"能不能顺延期限"全靠它 ——
        // 偶尔一天做不完不该动截止日，连续多天追不上才说明计划本身排错了
        const streak = dailylog.shortStreak(g.id)
        this.streakText = streak >= 2
          ? ('已经连续 ' + streak + ' 天没做完，AI 可以提议顺延截止日（要你自己勾）。')
          : ''
        this.overdueText = overdue.length
          ? ('当前有 ' + overdue.length + ' 个任务超期未完成，会优先用策略/内容解决，实在跟不上才顺延时间。')
          : ''
        const reality = {
          days: week,
          overdue: overdue.length,
          overdueIds: overdue.map(t => t.id),
          streak: streak
        }
        // 顺延上限：连续 2 天以上才开门，且一次最多推"剩余天数的一半"（3-30 天）。
        // 传 0 = 这次不许顺延，模型再想推也没这个 op
        const remainDays = pw.dayDiff(pw.today(), g.deadline)
        const maxDeferDays = streak >= 2
          ? Math.max(3, Math.min(30, Math.round(remainDays * 0.5)))
          : 0
        const opt = { maxDeferDays: maxDeferDays }
        const log = this.fromLog ? dailylog.logOf(pw.today()) : null
        // 用户补的话 = 本人最新意见，走 extra 追加给模型（自动重排闭环用的同一入口）
        const hint = String(this.hint || '').trim()
        const extra = hint ? ('本人补充（重排时优先考虑这句话）：' + hint) : ''
        // 附图（课表 / 补习班通知）：跟正文一起走多模态，最多 3 张
        const imgs = this.pendingImgs.slice()
        this.result = log
          ? await replanFromToday(g, log, reality, opt, extra, imgs)
          : await replanGoal(g, reality, opt, extra, imgs)
        this.pick = {}
        // 默认勾选：策略与内容类直接采纳；时间类（改期限/顺延）交给用户确认 —— 它是最后手段
        this.result.ops.forEach((op, i) => { this.pick[i] = op.op !== 'note' && op.level !== 'time' })
        this.fixedList = this.buildFixed(imgs, hint)
        // 时段先落库："周六 9-12 有补习班"这件事下次重排也得知道
        if (this.fixedList.length) this.persistPlaces()
      } catch (e) {
        this.error = (e && e.message) || '重排失败，请稍后再试'
      } finally {
        this.loading = false
      }
    },
    taskTitle(op) {
      const g = this.goal()
      if (!g) return ''
      // 顺延期限动的是整个目标，没有 taskId —— 显示目标名
      if (op.op === 'defer') return g.title
      const t = g.tasks.filter(x => x.id === op.taskId)[0]
      return t ? t.title : ''
    },
    kindText(op) {
      return { move: '改期', resize: '调整量', drop: '砍掉', defer: '顺延期限', note: '建议' }[op.op] || op.op
    },
    // 三档：策略 > 内容 > 时间（时间顺延是最后手段）
    levelText(op) {
      return { strategy: '策略', content: '内容', time: '时间' }[op.level || ''] || '内容'
    },
    opDetail(op) {
      if (op.op === 'move') return '开始时间：第 ' + op.day + ' 天'
      if (op.op === 'resize') return '预估专注：' + op.pomos + ' 段'
      if (op.op === 'defer') {
        const g = this.goal()
        const to = g ? pw.addDays(g.deadline, op.days) : ''
        return '截止日 ' + (g ? g.deadline : '') + ' → ' + to + '（往后 ' + op.days + ' 天）'
      }
      return ''
    },
    /** 顺延截止日：整条重排里代价最大的一条，所以单独拎出来做边界检查 */
    applyDefer(g, op) {
      const days = Math.max(1, Math.min(90, Math.floor(Number(op.days) || 0)))
      if (!days) return 0
      // 只许往后推（days 恒正），且累计顺延不超过 90 天 ——
      // 再多就不是"调整计划"而是"换个目标"了，那种该由人自己重新立一个
      const total = (g.deferred || 0) + days
      if (total > 90) return 0
      if (!g.origDeadline) g.origDeadline = g.deadline   // 留着原期限，页面上能显示"已顺延 N 天"
      g.deadline = pw.addDays(g.deadline, days)
      g.deferred = total
      g.deferredAt = Date.now()
      return days
    },
    apply() {
      const g = this.goal()
      if (!g) return
      // 顺延期限先落地：后面的 move 要按新的截止日夹取 maxDay
      let moved = 0
      let changed = 0
      this.result.ops.forEach((op, i) => {
        if (this.pick[i] && op.op === 'defer') moved += this.applyDefer(g, op)
      })
      this.result.ops.forEach((op, i) => {
        if (!this.pick[i] || op.op === 'defer') return
        const t = g.tasks.filter(x => x.id === op.taskId)[0]
        if (!t) return
        if (op.op === 'move') {
          // 夹到目标期限内：模型给的 day 上限是 3650，排到截止日之后的任务
          // 永远不会出现在"今天该做"里，目标会显示"没有待办"但进度不满
          const maxDay = Math.max(1, Math.round((new Date(g.deadline).getTime() - new Date(g.createdAt || Date.now()).getTime()) / 86400000) + 1)
          const nd = Math.min(Math.max(1, op.day || t.day), maxDay)
          if (nd !== t.day) { t.day = nd; changed++ }
        }
        else if (op.op === 'resize') {
          if (op.pomos !== t.pomos) { t.pomos = op.pomos; changed++ }
        }
        else if (op.op === 'drop') {
          if (t.status !== 'dropped' && t.status !== 'done') { t.status = 'dropped'; t.droppedAt = Date.now(); changed++ }
        }
      })
      // 把 AI 识别的固定安排（补习 / 节假日）同步到日历 —— 这是"应用后日程没变"的核心修复：
      // 以前 fixed 只写进 goal.places（下次重排的上下文），从不在日历占格，所以用户看不到变化。
      let markersAdded = 0
      let markersSkipped = 0
      if (this.fixedList && this.fixedList.length) {
        const added = calmark.addFromFixed(this.fixedList, (settings.get() && settings.get().calendar) || {})
        markersAdded = added.length
        markersSkipped = (added.skipped || []).length
      }
      pw.touch()
      pw.flush()
      // 诚实反馈：没有任何实际改动时，别说"已应用"骗人（用户之前就是被这个假成功误导）
      if (!changed && !moved && !markersAdded && !markersSkipped) {
        uni.showToast({ title: this.$t('没有可应用的改动'), icon: 'none' })
      } else {
        const parts = []
        if (changed || moved) parts.push(this.$t('已应用调整'))
        if (markersAdded) parts.push(this.$t('已记录 {n} 条固定安排到日历', { n: markersAdded }))
        // 读不出具体时间的固定安排不会生成标注（生成了也永远不显示），
        // 这里必须说清楚，否则用户又觉得"识别了但没记上"
        if (markersSkipped) parts.push(this.$t('另有 {n} 条没读到具体日期，请到日历手动标注', { n: markersSkipped }))
        uni.showToast({ title: parts.join('，'), icon: 'none', duration: 3200 })
      }
      setTimeout(() => uni.navigateBack(), 500)
    },
    back() { uni.navigateBack() },

    /* ---------- 附图：课表 / 补习班通知截图 ---------- */
    pickImg() {
      const left = 3 - this.pendingImgs.length
      if (left <= 0) {
        uni.showToast({ title: this.$t('一次最多带 3 张图'), icon: 'none' })
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

    /* ---------- 固定安排 ---------- */
    /**
     * AI 的 fixed。兜底：模型偶尔不吐 fixed（纯文本模型尤其），只要这次带了图、
     * 或话里提到补习，就补一条 —— 不能全指望模型记性。
     * 2026-11-04：地点字段随地图弹窗一起砍掉，这里只留名称 + 时间。
     */
    buildFixed(imgs, hint) {
      const list = ((this.result && this.result.fixed) || []).map(f => ({
        name: f.name,
        when: f.when || '',
        // 结构化时间一并带过来：模型直接给 weekdays / dates 时，
        // 日历标注就不用再从 when 的文本里猜（猜不出来会变成隐形标注）
        weekdays: Array.isArray(f.weekdays) ? f.weekdays : [],
        dates: Array.isArray(f.dates) ? f.dates : [],
        type: f.type || ''
      }))
      const said = String(hint || '')
      const looksLikeTutoring = imgs.length > 0 || /补习|补课|上课|报班|课程表|课表|辅导/.test(said)
      if (!list.length && looksLikeTutoring) {
        list.push({ name: this.$t('补习班'), when: '' })
      }
      return list.slice(0, 6)
    },
    /** 写回目标：按名字合并，别把用户以前填的固定安排冲掉 */
    persistPlaces() {
      const g = this.goal()
      if (!g) return
      const merged = (g.places || []).slice()
      this.fixedList.forEach(f => {
        if (!f || !f.name) return
        const hit = merged.filter(p => p && p.name === f.name)[0]
        if (hit) {
          if (f.when) hit.when = f.when
        } else {
          merged.push({ name: f.name, when: f.when || '' })
        }
      })
      // 固定安排不会太多，留最近 12 条足够，别让 goal 无限膨胀
      g.places = merged.slice(-12)
      pw.touch()
      pw.flush()
    }
  }
}
</script>

<style>
.state { padding: 100rpx 40rpx; display: flex; flex-direction: column; align-items: center; }
.state-txt { margin-top: 26rpx; font-size: 26rpx; line-height: 1.7; color: #5a6560; color: var(--ink-2, #5a6560); text-align: center; }
.error { font-size: 26rpx; line-height: 1.7; color: #c2323a; text-align: center; }
.retry { margin-top: 30rpx; width: 300rpx; height: 84rpx; font-size: 28rpx; }
.img-kept { margin-top: 18rpx; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

.spin {
  width: 64rpx; height: 64rpx;
  border-radius: 50%;
  border: 6rpx solid rgba(228, 23, 61, 0.2);
  border: 6rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.2);
  border-top-color: #e4173d;
  border-top-color: var(--brand, #e4173d);
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.body .card { margin-bottom: 20rpx; }
.summary { display: block; font-size: 26rpx; line-height: 1.7; color: #17201a; color: var(--ink-1, #17201a); }
.overdue-tip {
  display: block; margin-top: 14rpx;
  font-size: 23rpx; line-height: 1.6; color: #8a5800;
}
.log-tip {
  display: block; margin-bottom: 14rpx;
  font-size: 23rpx; line-height: 1.6; color: #b26400;
}

/* 调整档位：策略优先、时间兜底 */
.op-level {
  flex-shrink: 0;
  font-size: 21rpx;
  padding: 4rpx 14rpx;
  border-radius: 8rpx;
  margin-right: 10rpx;
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
.lv-strategy { background: rgba(59, 109, 17, 0.12); color: #3b6d11; }
.lv-content { background: rgba(247, 144, 9, 0.14); color: #b26400; }
.lv-time { background: rgba(229, 72, 77, 0.12); color: #c2323a; }

.op-card { display: flex; align-items: flex-start; }
.pv-check {
  width: 40rpx; height: 40rpx;
  border-radius: 12rpx;
  border: 2rpx solid rgba(23, 32, 26, 0.2);
  border: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.2);
  display: flex; align-items: center; justify-content: center;
  font-size: 26rpx;
  color: #ffffff;
  flex-shrink: 0;
  margin-top: 4rpx;
}
.pv-check-on { background: #e4173d; background: var(--brand, #e4173d); border-color: transparent; }
.op-main { flex: 1; min-width: 0; margin-left: 20rpx; }
.op-line { display: flex; align-items: center; flex-wrap: wrap; }
.op-kind {
  flex-shrink: 0;
  font-size: 21rpx;
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  margin-right: 14rpx;
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
}
.op-drop { background: rgba(229, 72, 77, 0.1); color: #e5484d; }
.op-defer { background: rgba(194, 50, 58, 0.12); color: #c2323a; }
.op-resize { background: rgba(247, 144, 9, 0.14); color: #b26400; }
.op-note { background: rgba(23, 32, 26, 0.07); color: #5a6560; color: var(--ink-2, #5a6560); }
/* 大字标题：卡片上最大的字，紧跟「策略/内容/时间」标签 */
.op-head {
  flex: 1;
  min-width: 0;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1.42;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
/* 任务名降到下一行：之前和大字标题挤在同一行，标题一长就被挤没 */
.op-task { margin-top: 8rpx; font-size: 24rpx; color: #5a6560; color: var(--ink-2, #5a6560); }
.op-detail { margin-top: 8rpx; font-size: 23rpx; color: #5a6560; color: var(--ink-2, #5a6560); }
.op-reason { margin-top: 8rpx; font-size: 23rpx; line-height: 1.6; color: #98a19b; color: var(--ink-3, #98a19b); }

.state-inline { padding: 40rpx 30rpx; }

/* 补话重排（"跟 AI 说一声再生成"） */
.hint-card { padding-bottom: 30rpx; }
.hint-title { font-size: 27rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.hint-input {
  margin-top: 16rpx;
  width: 100%; min-height: 120rpx;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 18rpx 22rpx;
  font-size: 26rpx; line-height: 1.6;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.hint-err { margin-top: 24rpx; }
.hint-btn { margin-top: 18rpx; height: 84rpx; font-size: 27rpx; }

/* 附图：课表 / 补习班通知截图 */
.img-strip { display: flex; padding: 16rpx 0 0; }
.img-thumb {
  position: relative;
  width: 128rpx; height: 128rpx;
  margin-right: 14rpx;
  border-radius: 14rpx;
  overflow: hidden;
  background: rgba(23, 32, 26, 0.06);
}
.img-thumb image { width: 100%; height: 100%; display: block; }
.img-x {
  position: absolute; top: 0; right: 0;
  width: 40rpx; height: 40rpx; line-height: 36rpx;
  text-align: center;
  font-size: 28rpx;
  color: #ffffff;
  background: rgba(0, 0, 0, 0.45);
  border-bottom-left-radius: 14rpx;
}
.hint-foot { display: flex; align-items: center; margin-top: 14rpx; }
.hint-img {
  font-size: 25rpx;
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  border: 2rpx solid rgba(228, 23, 61, 0.25);
  border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.25);
}
.hint-img-tip {
  margin-left: 14rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* 固定安排（补习班 / 上课）：时段不排任务 */
.fixed-card { padding-bottom: 10rpx; }
.fixed-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4rpx; }
.fixed-title { font-size: 27rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.fixed-tip { font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
.fixed-row { display: flex; align-items: center; padding: 16rpx 0; border-top: 2rpx solid rgba(23, 32, 26, 0.06); }
.fixed-main { flex: 1; min-width: 0; }
.fixed-line { display: flex; align-items: baseline; flex-wrap: wrap; }
.fixed-name { margin-right: 12rpx; font-size: 26rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.fixed-when { font-size: 23rpx; color: #5a6560; color: var(--ink-2, #5a6560); }

/* 模型看不了图时的说明（不是错误，别用红色） */
.img-ignored { display: block; margin-top: 14rpx; font-size: 22rpx; line-height: 1.6; color: #8a5800; }

.actions { display: flex; margin: 10rpx 0 30rpx; }
.act-btn { flex: 1; }
.act-btn:first-child { margin-right: 20rpx; }
</style>
