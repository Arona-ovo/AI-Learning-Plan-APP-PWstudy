<template>
  <!-- 日程表：日历页（pkgPlan/pages/calendar）和首页「日程表」卡**共用这一个组件**。
       字段、排版、前后移交互都在这儿，两边只负责喂 rows ——
       这样"两套样式"从根上长不出来（改一处两边同时生效）。 -->
  <view class="sl">
    <view v-if="!rows.length" class="sl-empty">
      <text class="sl-empty-txt">{{ emptyText || '这一天没有安排任务。' }}</text>
    </view>

    <block v-else>
      <view v-for="t in shown" :key="t.key" class="ct-row">
        <!-- 勾选：当天的事就地勾掉，不用再进详情页找"标记完成" -->
        <view
          v-if="checkable && t.status !== 'dropped'"
          class="ct-check"
          :class="{ 'ct-check-on': t.status === 'done' }"
          @tap.stop="toggle(t)"
        >
          <text v-if="t.status === 'done'" class="ct-tick">✓</text>
        </view>
        <view class="ct-main">
          <view class="ct-title" :class="{ 'ct-title-done': t.status !== 'todo' }">{{ t.title }}</view>
          <view class="ct-sub">
            {{ t.goalTitle }} · {{ t.donePomos }}/{{ t.pomos }} 番茄
            <text v-if="t.status === 'done'" class="ct-done">已完成</text>
            <text v-else-if="t.status === 'dropped'" class="ct-drop">已砍掉</text>
            <text v-else-if="t.overdue" class="ct-late">已超期</text>
          </view>
        </view>
        <view v-if="ops && t.status === 'todo'" class="ct-ops">
          <text class="ct-op" @tap.stop="shift(t, -1)">前移</text>
          <text class="ct-op" @tap.stop="shift(t, 1)">后移</text>
        </view>
      </view>

      <view v-if="restCount > 0" class="sl-more">
        <text class="sl-more-txt">还有 {{ restCount }} 项</text>
        <text v-if="moreText" class="sl-more-go" @tap.stop="emitMore">{{ moreText }} ›</text>
      </view>

      <text v-if="tip" class="ct-tip">前移/后移一天：直接改任务日期，不走 AI（小改动自己动手更快）。</text>
    </block>
  </view>
</template>

<script>
import * as schedule from '../../utils/schedule.js'

export default {
  name: 'ScheduleList',
  props: {
    /** rowsOf() 出来的行（含 goalId / id / startDay / status / overdue） */
    rows: { type: Array, default: () => [] },
    /** 最多显示几条（0 = 全显示）。首页卡片用它控制高度 */
    limit: { type: Number, default: 0 },
    /** 是否显示「前移 / 后移」 */
    ops: { type: Boolean, default: true },
    /** 是否显示勾选圈（点一下 = 标记完成 / 取消完成） */
    checkable: { type: Boolean, default: true },
    /** 是否显示底部那条说明 */
    tip: { type: Boolean, default: false },
    emptyText: { type: String, default: '' },
    /** 折叠时右侧的入口文案（不传就只显示"还有 N 项"） */
    moreText: { type: String, default: '' }
  },
  computed: {
    shown() {
      const n = Number(this.limit) || 0
      return n > 0 ? (this.rows || []).slice(0, n) : (this.rows || [])
    },
    restCount() {
      const n = Number(this.limit) || 0
      if (n <= 0) return 0
      return Math.max(0, (this.rows || []).length - n)
    }
  },
  methods: {
    toggle(row) {
      const r = schedule.toggleDone(row)
      if (!r.ok) {
        try { uni.showToast({ title: r.msg, icon: 'none' }) } catch (e) {}
        return
      }
      try { uni.showToast({ title: r.msg, icon: 'none' }) } catch (e) {}
      // 刚被**勾完成**的那一项要单独抛出去：父级要弹「恭喜你完成任务」并问额外收获。
      // 取消完成（r.done=false）不抛 —— 那是撤销，不该弹祝贺。
      // ⚠️ 先抛再抛 changed：父级拿到 row 里的 id 才能反查完成时刻
      if (r.done) this.$emit('done', row)
      // 勾完可能就不在这一天的列表里了（已完成的不进"待办"队列）→ 让父级重算
      this.$emit('changed')
    },
    shift(row, delta) {
      const r = schedule.move(row, delta)
      if (!r.ok) {
        try { uni.showToast({ title: r.msg, icon: 'none' }) } catch (e) {}
        return
      }
      try { uni.showToast({ title: r.msg, icon: 'none' }) } catch (e) {}
      // 数据改了让父级重算：组件的 props 是父级的派生值，自己不该就地改
      this.$emit('changed')
    },
    // 包一层而不是在模板里直接写 $emit('more')：
    // check-handlers.js 会去脚本里找同名方法，模板里的 $emit(...) 会被判成"方法没定义"
    emitMore() {
      this.$emit('more')
    }
  }
}
</script>

<style>
/* 类名沿用日历页原来的 .ct-*：搬过来时样式一行没改，
   两边共用同一套，避免"首页一版、日历页一版" */
/* 勾选圈：空心 = 待办，实心 = 已完成 */
.ct-check {
  width: 40rpx; height: 40rpx; border-radius: 50%;
  margin-right: 18rpx; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: 2rpx solid rgba(23, 32, 26, 0.22);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.22));
}
.ct-check-on {
  background: #e4173d; background: var(--brand, #e4173d);
  border-color: transparent;
}
.ct-tick { font-size: 24rpx; line-height: 1; color: #ffffff; font-weight: 600; }
.ct-check:active { opacity: 0.6; }

.ct-row { display: flex; align-items: center; padding: 18rpx 0; border-bottom: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.06); }
.ct-row:last-of-type { border-bottom: none; }
.ct-main { flex: 1; min-width: 0; }
.ct-title { font-size: 27rpx; color: #17201a; color: var(--ink-1, #17201a); }
.ct-title-done { color: #98a19b; color: var(--ink-3, #98a19b); text-decoration: line-through; }
.ct-sub { margin-top: 6rpx; font-size: 21rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
.ct-done { margin-left: 10rpx; color: #3b6d11; }
.ct-drop { margin-left: 10rpx; }
.ct-late { margin-left: 10rpx; color: #e5484d; }
.ct-ops { flex-shrink: 0; display: flex; }
.ct-op {
  margin-left: 14rpx; padding: 8rpx 18rpx; border-radius: 999rpx;
  font-size: 22rpx; color: #bb1332; color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1); background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
}
.ct-op:active { opacity: 0.6; }
.ct-tip { display: block; margin-top: 18rpx; font-size: 21rpx; line-height: 1.7; color: #98a19b; color: var(--ink-3, #98a19b); }

.sl-empty { padding: 10rpx 0; }
.sl-empty-txt { font-size: 25rpx; line-height: 1.7; color: #5a6560; color: var(--ink-2, #5a6560); }
.sl-more { display: flex; align-items: center; justify-content: space-between; margin-top: 14rpx; }
.sl-more-txt { font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
.sl-more-go { font-size: 22rpx; color: #bb1332; color: var(--brand-strong, #bb1332); }
</style>
