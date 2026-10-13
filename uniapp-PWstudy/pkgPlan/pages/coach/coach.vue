<template>
  <view class="container page-nav coach-page" :class="appTheme" :style="appBgStyle">
    <float-navbar title="跟 AI 说说今天" :back="true" />
    <!-- 与首页同一份对话（utils/coach.js 按天存）：在首页说一半，进来接着聊 -->
    <view class="card cw">
      <coach-box ref="box" full />
    </view>
  </view>
</template>

<script>
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import CoachBox from '../../../components/coach-box/coach-box.vue'

export default {
  components: { FloatNavbar, CoachBox },
  onShow() {
    // 从重排页退回来要看到最新一轮
    if (this.$refs.box && this.$refs.box.refresh) this.$refs.box.refresh()
  }
}
</script>

<style>
.coach-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  padding-bottom: calc(30rpx + var(--safe-bottom, 0px) + constant(safe-area-inset-bottom));
  padding-bottom: calc(30rpx + var(--safe-bottom, 0px) + env(safe-area-inset-bottom));
}
.cw {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 32rpx 28rpx;
}
</style>
