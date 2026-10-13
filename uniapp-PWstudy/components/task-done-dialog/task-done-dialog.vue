<template>
  <!-- 任务完成弹窗：勾掉一项立刻弹出来，两个出口 ——
       「取消」= 就这么着，回原页面；「额外收获」= 去跟 AI 说两句，说完也回原页面。
       弹窗本身复用 components/app-dialog（全 App 只有一套卡片），这里只负责
       两个出口的动作与"现在弹的是哪一项"。 -->
  <app-dialog
    :show="show"
    mode="confirm"
    :title="title"
    :content="content"
    cancel-text="取消"
    confirm-text="额外收获"
    :seq="seq"
    @confirm="goHarvest"
    @cancel="close"
  />
</template>

<script>
import AppDialog from '../app-dialog/app-dialog.vue'
// 完成时刻的任务快照来自调用方（schedule-list 的行 或 首页队列的一项），
// 这里不反查数据 —— 弹窗弹出那一刻任务可能已经被别处改了，快照最稳。

export default {
  name: 'TaskDoneDialog',
  components: { AppDialog },
  data() {
    return {
      show: false,
      seq: 0,
      title: '恭喜你完成任务',
      content: '',
      row: null
    }
  },
  methods: {
    /**
     * 弹出来。
     * @param {Object} row 至少要有 goalId / id / title；goalTitle、atText 可选
     * @param {string} atText 完成时刻（HH:MM）；不传就不显示
     */
    open(row, atText) {
      if (!row) return
      this.row = row
      this.content = '「' + (row.title || '这项任务') + '」' +
        (atText ? atText + ' 完成' : '已完成') +
        (row.goalTitle ? '\n' + row.goalTitle : '')
      this.seq = (this.seq || 0) + 1
      this.show = true
      this.$emit('open', row)
    },
    close() {
      this.show = false
      this.$emit('close')
    },
    /** 给页面的 onBackPress 用：返回键要先收弹窗，不能直接退出页面 */
    isOpen() {
      return !!this.show
    },
    goHarvest() {
      const r = this.row
      this.close()
      if (!r) return
      const q = '?goalId=' + encodeURIComponent(r.goalId || '') +
        '&taskId=' + encodeURIComponent(r.id || r.taskId || '')
      try {
        uni.navigateTo({ url: '/pkgPlan/pages/harvest/harvest' + q })
      } catch (e) {}
      this.$emit('harvest', r)
    }
  }
}
</script>
