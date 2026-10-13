<template>
  <!-- 今日紧迫程度：
       标题行先把"这是什么、现在哪一档"说出来 —— 一条长卡片没有字会显得空，
       这一行（标题 + 档位胶囊 + ?）就是它的"卡片头"，跟其它卡一个规格。
       下面四个图形各说一件事：
         ① 环的填充    = 紧迫度（0-100）
         ② 核心的呼吸  = 紧迫度的强度（越急跳得越快）
         ③ 番茄方块    = 完成难度与进度（空心=已做，实心=还剩）
         ④ 24h 时间条  = 剩余时间（竖线是"现在"，色块是"还要多久"，
                          色块顶到条尾并开始闪 = 今天已经排不下了）
       右侧三行小字是给图形做的"读数"：分数 + 一句人话 + 还剩几个 + 还要多久。 -->
  <view class="urg" :class="['urg-lv' + u.level, { 'urg-alarm': u.level >= 3 }]">

    <!-- 卡片头：这一行字说明"这条是什么、紧不紧" -->
    <view class="ug-head">
      <text class="ug-title">{{ $t('今日紧迫程度') }}</text>
      <text class="ug-lv" :style="lvStyle">{{ levelText }}</text>
      <view class="ug-help" hover-class="ug-help-press" @tap.stop="onHelp">?</view>
    </view>

    <view class="ug-body">
      <!-- ① ② 紧迫度环 + 呼吸核心 -->
      <view class="ug-ring" :style="ringStyle">
        <view class="ug-inner">
          <view class="ug-halo" :style="haloStyle"></view>
          <view class="ug-core" :style="coreStyle"></view>
        </view>
      </view>

      <!-- ③ ④ 难度（番茄方块）与剩余时间（时间条），外加三行读数 -->
      <view class="ug-side">
        <view class="ug-line">
          <text class="ug-score" :style="numStyle">{{ score }}</text>
          <text class="ug-unit">/ 100</text>
          <text class="ug-hint" :style="numStyle">{{ hintText }}</text>
        </view>

        <view class="ug-line">
          <view class="ug-blocks">
            <view
              v-for="(b, i) in u.blocks"
              :key="i"
              class="ug-blk"
              :class="'ug-blk-' + b"
              :style="b === 'left' ? { background: u.color } : {}"
            ></view>
            <view v-if="u.overflow" class="ug-blk ug-blk-more"></view>
          </view>
          <text class="ug-note">{{ $t('还剩 {n} 个', { n: leftPomos }) }}</text>
        </view>

        <view class="ug-track">
          <view class="ug-past" :style="{ width: u.passedPct + '%' }"></view>
          <view
            class="ug-need"
            :class="{ 'ug-need-over': u.over }"
            :style="needStyle"
          ></view>
          <view class="ug-now" :style="{ left: u.nowPct + '%' }"></view>
        </view>

        <view class="ug-foot">
          <text class="ug-f1">{{ needText }}</text>
          <text class="ug-f2">{{ availText }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
function clamp(n, lo, hi) {
  const v = Number(n) || 0;
  return v < lo ? lo : (v > hi ? hi : v);
}

export default {
  props: {
    u: { type: Object, default: () => ({}) }
  },
  computed: {
    lv() {
      return clamp(this.u.level, 0, 3);
    },
    score() {
      return clamp(this.u.score, 0, 100);
    },
    leftPomos() {
      return Math.max(0, Number(this.u.leftPomos) || 0);
    },
    // 档位名。卡片只留这点文字，其余全靠图形 —— 全部走 $t，英文态不会裸奔
    levelText() {
      const all = [
        this.$t('从容'), this.$t('正常'),
        this.$t('紧张'), this.$t('告急')
      ];
      return all[this.lv];
    },
    // 一句人话：分数是给眼睛看的，这句是给感觉看的。
    // 排不下时档位名还不够直白，换两句更硬的。
    hintText() {
      if (this.u.over) {
        return this.lv >= 3 ? this.$t('今天排不下了') : this.$t('时间有点不够了');
      }
      const all = [
        this.$t('时间还很宽裕'), this.$t('按计划来就行'),
        this.$t('得抓紧一点了'), this.$t('今天怕是排不下了')
      ];
      return all[this.lv];
    },
    numStyle() {
      return { color: this.u.color || '#F79009' };
    },
    lvStyle() {
      return {
        color: this.u.color || '#F79009',
        background: this.u.soft || 'rgba(247, 144, 9, 0.14)'
      };
    },
    ringStyle() {
      const deg = Math.round((Number(this.u.score) || 0) * 3.6);
      const c = this.u.color || '#F79009';
      return { background: 'conic-gradient(' + c + ' ' + deg + 'deg, rgba(23,32,26,0.08) ' + deg + 'deg)' };
    },
    // 呼吸周期跟着紧迫度走：从容时慢到几乎不动，告急时接近心跳
    beat() {
      return (Number(this.u.beatMs) || 2000) + 'ms';
    },
    coreStyle() {
      return { background: this.u.color || '#F79009', animationDuration: this.beat };
    },
    haloStyle() {
      return {
        borderColor: this.u.color || '#F79009',
        animationDuration: this.beat,
        opacity: 0.18 + (Number(this.u.level) || 0) * 0.1
      };
    },
    needStyle() {
      const start = Number(this.u.nowPct) || 0;
      // 顶到条尾就截断（剩下的一点留给"已经排不下"这个信号去闪）
      const w = Math.min(Number(this.u.fillPct) || 0, Math.max(0, 100 - start));
      return { left: start + '%', width: w + '%', background: this.u.color || '#F79009' };
    },
    needText() {
      return this.$t('还需 {t}', { t: this.durText(this.u.needMin) });
    },
    availText() {
      return this.$t('今天剩 {t}', { t: this.durText(this.u.availMin) });
    }
  },
  methods: {
    // 分钟 → "3 小时 12 分" / "48 分钟"（单位走 $t，英文态是 3h 12m）
    durText(min) {
      const m = Math.max(0, Math.round(Number(min) || 0));
      if (m < 60) return this.$t('{n} 分钟', { n: m });
      const h = Math.floor(m / 60);
      const r = m % 60;
      if (!r) return this.$t('{h} 小时', { h: h });
      return this.$t('{h} 小时 {m} 分', { h: h, m: r });
    },
    onHelp() {
      this.$emit('help', this.u);
    }
  }
}
</script>

<style>
.urg {
  position: relative;
}

/* ===== 卡片头：一行字 + 档位胶囊 + ? ===== */
.ug-head {
  display: flex;
  align-items: center;
  margin-bottom: 26rpx;
}
.ug-title {
  font-size: 30rpx; font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.ug-lv {
  margin-left: 16rpx;
  padding: 4rpx 18rpx;
  border-radius: 999rpx;
  font-size: 21rpx; font-weight: 500;
}
.ug-help {
  flex-shrink: 0;
  margin-left: auto;
  width: 40rpx; height: 40rpx;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  border-width: 2rpx;
  border-style: solid;
  border-color: rgba(23, 32, 26, 0.08);
  border-color: var(--hairline, rgba(23, 32, 26, 0.08));
  background: rgba(255, 255, 255, 0.5);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.5);
}
.ug-help-press { opacity: 0.5; }

/* ===== 主体：环 + 右列 ===== */
.ug-body { display: flex; align-items: center; }

/* ===== ① ② 紧迫度环 ===== */
.ug-ring {
  width: 140rpx; height: 140rpx;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.ug-inner {
  width: 104rpx; height: 104rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.9);
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.ug-core {
  width: 44rpx; height: 44rpx;
  border-radius: 50%;
  animation-name: ug-breathe;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
}
.ug-halo {
  position: absolute;
  width: 84rpx; height: 84rpx;
  border-radius: 50%;
  border-width: 2rpx;
  border-style: solid;
  animation-name: ug-breathe;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-direction: reverse;
}

@keyframes ug-breathe {
  0%   { transform: scale(0.70); opacity: 0.45; }
  50%  { transform: scale(1);    opacity: 1; }
  100% { transform: scale(0.70); opacity: 0.45; }
}

/* ===== 右列：三行读数 + 图形 ===== */
.ug-side { flex: 1; min-width: 0; margin-left: 32rpx; }
.ug-line { display: flex; align-items: baseline; }
.ug-score { font-size: 42rpx; font-weight: 600; line-height: 1; }
.ug-unit {
  margin-left: 6rpx;
  font-size: 20rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
/* 一句人话：分数是给眼睛的，这句是给心的 */
.ug-hint {
  margin-left: auto;
  padding-left: 12rpx;
  flex-shrink: 0;
  font-size: 23rpx; font-weight: 500;
}
.ug-note {
  margin-left: auto;
  padding-left: 12rpx;
  flex-shrink: 0;
  font-size: 21rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

/* ===== ③ 番茄方块：难度与进度 ===== */
.ug-blocks {
  flex: 1; min-width: 0;
  display: flex; flex-wrap: wrap;
  margin-bottom: 14rpx;
}
.ug-blk {
  width: 18rpx; height: 18rpx;
  border-radius: 6rpx;
  margin: 0 6rpx 8rpx 0;
  background: rgba(23, 32, 26, 0.1);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.1);
}
/* 实心 = 还没做，给它一点厚度，别跟空心一样平 */
.ug-blk-left { box-shadow: 0 2rpx 6rpx rgba(23, 32, 26, 0.16); }
.ug-blk-done { opacity: 0.55; }
.ug-blk-more {
  background: rgba(23, 32, 26, 0.06);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
  opacity: 0.6;
}

/* ===== ④ 24 小时时间条：整条是一天，竖线是现在，色块是还要多久 ===== */
.ug-track {
  position: relative;
  height: 20rpx;
  border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.09);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.09);
}
.ug-past {
  position: absolute; left: 0; top: 0; height: 100%;
  border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.13);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.13);
}
.ug-need {
  position: absolute; top: 3rpx; height: 14rpx;
  border-radius: 999rpx;
  box-shadow: 0 2rpx 6rpx rgba(23, 32, 26, 0.14);
  transition: width 400ms cubic-bezier(0.22, 0.61, 0.36, 1), left 400ms ease;
}
.ug-need-over {
  animation: ug-blink 900ms ease-in-out infinite;
}
.ug-now {
  position: absolute; top: -5rpx;
  width: 4rpx; height: 30rpx;
  border-radius: 2rpx;
  background: rgba(23, 32, 26, 0.5);
  background: rgba(var(--ink-1, 23, 32, 26), 0.5);
}

/* 底部读数：左边"还要多久做完"，右边"今天还剩多久" */
.ug-foot {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-top: 14rpx;
}
.ug-f1, .ug-f2 { font-size: 21rpx; }
.ug-f1 { color: #5a6560; color: var(--ink-2, #5a6560); }
.ug-f2 { color: #98a19b; color: var(--ink-3, #98a19b); }

@keyframes ug-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}

/* ===== 告急：环外再套一圈跟着呼吸的光晕（方的光晕看着像错位，所以挂在环上） ===== */
.urg-alarm .ug-ring {
  animation: ug-alarm 1600ms ease-in-out infinite;
}
@keyframes ug-alarm {
  0%, 100% { box-shadow: 0 0 0 0 rgba(190, 18, 60, 0); }
  50%      { box-shadow: 0 0 0 12rpx rgba(190, 18, 60, 0.16); }
}
</style>
