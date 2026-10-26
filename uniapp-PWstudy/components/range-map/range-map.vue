<template>
  <!-- 遮罩层截断手势：fixed 不等于层级断开，滑动照样会滚背后的页面。
       卡内没有可滚区域，整层吞掉（与 app-dialog / focus-calc 同一处契约）。 -->
  <view class="rm-mask" v-if="show" @tap="onMaskTap" @touchmove.stop.prevent="noop">
    <view class="rm-card" @tap.stop="noop">
      <view class="rm-head">
        <text class="rm-title">{{ $t('学习范围地图') }}</text>
        <text class="rm-hint">{{ hintText }}</text>
      </view>

      <!-- 真地图（uni 内置 <map>，App 端走高德 SDK，需在 manifest 配 sdkConfigs.maps.amap
           + 云打包）。marker 是图钉位置、circle 是范围（半径按真实米画，比例永远准）。
           选位置：点地图任意处（@tap 拿经纬度，App 端可靠）或拖图钉（@markerdrag 增强）；
           改范围：下方滑块 / 快捷档；归中：地图右下角「定位」钮 / 编辑态的「回到原位」。 -->
      <map
        class="rm-map"
        :id="mapId"
        :latitude="lat"
        :longitude="lng"
        :scale="scale"
        :markers="markers"
        :circles="circles"
        :show-location="true"
        @tap="onTapMap"
        @markerdrag="onMarkerDrag"
        @updated="onUpdated"
      >
        <!-- 原生地图层级最高，普通 view 盖不住 —— 地图内的浮动控件只能用 cover-view。
             点一下取当前 GPS：图钉 + 视野一起归中到当前位置。 -->
        <cover-view class="rm-locate" @click="locateMe">
          <cover-view class="rm-locate-txt" :class="{ 'rm-locate-busy': locating }">{{ locating ? '···' : $t('定位') }}</cover-view>
        </cover-view>
      </map>

      <!-- 读数 -->
      <view class="rm-readout">
        <text class="rm-ro-item rm-ro-r">{{ radiusText }}</text>
        <text class="rm-ro-item" v-if="offsetMeters > 1">{{ offsetText }}</text>
        <text class="rm-ro-item rm-ro-back" v-if="canBack" @tap="backToOrigin">{{ $t('回到原位') }}</text>
      </view>

      <!-- 快捷档 + 缩放 -->
      <view class="rm-presets">
        <text
          v-for="m in presetMeters"
          :key="m"
          class="rm-preset"
          hover-class="rm-preset-hover"
          :hover-stay-time="60"
          @tap="setRadius(m)"
        >{{ m }} m</text>
        <view class="rm-zoom">
          <text class="rm-zoom-btn" hover-class="rm-preset-hover" :hover-stay-time="60" @tap="zoom(true)">＋</text>
          <text class="rm-zoom-btn" hover-class="rm-preset-hover" :hover-stay-time="60" @tap="zoom(false)">－</text>
        </view>
      </view>

      <!-- 半径滑块（真实连续 30~5000 米） -->
      <view class="rm-slider-row">
        <text class="rm-slider-label">{{ $t('范围') }}</text>
        <slider
          class="rm-slider"
          :min="30"
          :max="5000"
          :step="10"
          :value="radiusM"
          activeColor="#e4173d"
          backgroundColor="#f0d6da"
          block-size="22"
          @changing="onSlide"
          @change="onSlide"
        />
        <text class="rm-slider-val">{{ Math.round(radiusM) }}m</text>
      </view>

      <view class="rm-btns">
        <view class="rm-btn ghost" hover-class="rm-btn-hover" :hover-stay-time="60" @tap="close">{{ $t('取消') }}</view>
        <view class="rm-btn primary" hover-class="rm-btn-hover" :hover-stay-time="60" @tap="confirm">{{ $t('确定') }}</view>
      </view>
    </view>
  </view>
</template>

<script>
// components/range-map/range-map.vue —— 学习范围「真地图」编辑器
//
// 2026-10-26：从自绘 canvas 方案切换为高德真地图。原因：自绘在真机上图钉错位、
//   圆环比例与读数不符、且无真实底图。uni 内置 <map> 在 App 端走高德 SDK，
//   marker 是真实经纬度（不会再错位），circle 半径按真实米画（比例永远准），
//   底图有真实道路/地块。代价：manifest 需配 sdkConfigs.maps.amap 的 key，
//   且必须云打包（wgt 带不进原生地图）。
//
// 选位置交互：
//   - 点地图任意处（@tap）拿经纬度移动图钉 —— App 端可靠，作主交互；
//   - 拖图钉（@markerdrag）增强 —— 平台若支持拖动结束回调则同步坐标，不支持也不影响。
// 改范围：滑块（连续）+ 100/200/500/1000 快捷档 + 视图缩放按钮。
// 归中（2026-10-26 补）：
//   - 地图右下角「定位」cover-view：取一次当前 GPS，图钉 + 视野一起过去 ——
//     原生地图层级最高，普通 view 盖不住，地图内的浮动控件只能 cover-view；
//   - 编辑模式下图钉挪离了地点原坐标时，读数行多一颗「回到原位」（撤销手滑）。
//   视野回图钉统一走 centerMap()：平时 latitude/longitude prop 变了 <map> 自己会挪，
//   但"原地再定位"（新 GPS 和图钉只差几米）与"拖走地图再点回来"两种场景 prop
//   看不出变化，必须显式 moveToLocation 拉一次。
//
// ⚠️ i18n：所有中文 UI 串都走 $t()，且每条都要在 i18n-en.js 补英文（check-i18n 红线）。
const PIN = '/static/pin.png'; // 图钉素材（_tools/gen-pin.py 生成；iconPath 是必填项，缺文件图钉整个不画）

import * as loc from '../../utils/location.js';

export default {
  name: 'RangeMap',
  props: {
    show: { type: Boolean, default: false },
    // 中心的参考 GPS（加地点=当前定位；编辑=地点自身坐标）
    centerLat: { type: Number, default: 0 },
    centerLng: { type: Number, default: 0 },
    // 初始半径（米）
    initRadius: { type: Number, default: 200 },
    // true=加地点；false=编辑
    youHere: { type: Boolean, default: false }
  },
  data() {
    return {
      mapId: 'rangemap',
      lat: 0,
      lng: 0,
      radiusM: 200,
      scale: 16,
      presetMeters: [100, 200, 500, 1000], // 纯数字+单位 m，不占 i18n
      mapReady: false,
      locating: false // 「定位」钮正在取 GPS（防连点）
    };
  },
  computed: {
    hintText() {
      return this.youHere
        ? this.$t('点地图选位置或拖动图钉，拖滑块改范围')
        : this.$t('点地图精修位置或拖动图钉，拖滑块改范围');
    },
    markers() {
      const m = {
        id: 1,
        latitude: this.lat,
        longitude: this.lng,
        width: 28,
        height: 36,
        anchor: { x: 0.5, y: 1 },
        draggable: true
      };
      // 有自定义图钉就用，没有就让高德用默认红图钉（App 端可靠）
      try { m.iconPath = PIN; } catch (e) { /* 忽略，用默认 */ }
      return [m];
    },
    circles() {
      return [{
        latitude: this.lat,
        longitude: this.lng,
        radius: this.radiusM,
        color: '#e4173d88',
        fillColor: '#e4173d22',
        strokeWidth: 2
      }];
    },
    // 偏离中心（centerLat/Lng）的真实距离（米）
    offsetMeters() {
      if (!this.centerLat) return 0;
      const dLat = (this.lat - this.centerLat) * 111320;
      const dLng = (this.lng - this.centerLng) * 111320 * Math.cos(this.centerLat * Math.PI / 180);
      return Math.round(Math.sqrt(dLat * dLat + dLng * dLng));
    },
    offsetText() {
      return this.$t('偏离中心 {d} 米', { d: this.offsetMeters });
    },
    radiusText() {
      return this.$t('半径 {r} 米', { r: Math.round(this.radiusM) });
    },
    // 编辑模式下图钉挪离了地点原坐标 → 读数行给一颗「回到原位」
    canBack() {
      return !this.youHere && !!this.centerLat && this.offsetMeters > 1;
    }
  },
  watch: {
    show(v) {
      if (v) this.open();
    }
  },
  methods: {
    noop() {},
    open() {
      this.lat = this.centerLat;
      this.lng = this.centerLng;
      this.radiusM = Math.max(30, Math.min(5000, Math.round(this.initRadius) || 200));
      this.scale = this.rToScale(this.radiusM);
      this.mapReady = false;
    },
    close() {
      this.$emit('close');
    },
    onMaskTap() {
      // 点遮罩（卡片外）= 取消，避免误触丢失选择还算合理（取消本就丢弃）
      this.close();
    },

    /** 半径（米）→ 地图缩放级别（高德 scale 3~20），让圆约占半屏 */
    rToScale(r) {
      if (r <= 100) return 18;
      if (r <= 200) return 17;
      if (r <= 500) return 16;
      if (r <= 1000) return 15;
      if (r <= 2000) return 14;
      return 13;
    },

    /** 从地图事件 detail 里安全取经纬度（不同平台字段顺序/有无不一，做兜底） */
    pickLL(detail) {
      if (!detail) return null;
      const lat = detail.latitude != null ? detail.latitude : detail.lat;
      const lng = detail.longitude != null ? detail.longitude : detail.lng;
      if (lat == null || lng == null) return null;
      return { lat: Number(lat), lng: Number(lng) };
    },

    // 点地图任意处 → 图钉移到该点（主交互，App 端可靠）
    onTapMap(e) {
      const ll = this.pickLL(e && e.detail);
      if (!ll) return;
      this.lat = ll.lat;
      this.lng = ll.lng;
    },
    // 拖图钉（增强）：平台支持时同步坐标
    onMarkerDrag(e) {
      const ll = this.pickLL(e && e.detail);
      if (!ll) return;
      this.lat = ll.lat;
      this.lng = ll.lng;
    },
    onUpdated() {
      this.mapReady = true;
    },

    /** 短提示（组件里也统一 toast，不弹系统对话框） */
    toast(title) {
      try { uni.showToast({ title: title, icon: 'none' }); } catch (e) { /* 忽略 */ }
    },

    // 地图右下角「定位」：取一次当前 GPS，图钉 + 视野一起归中过去
    locateMe() {
      if (this.locating) return;
      this.locating = true;
      loc.fetch().then((pos) => {
        this.locating = false;
        this.lat = pos.lat;
        this.lng = pos.lng;
        this.scale = this.rToScale(this.radiusM); // 归中后按半径重取缩放，圆保证看得全
        this.centerMap();
        this.toast(this.$t('已定位到当前位置'));
      }).catch((err) => {
        this.locating = false;
        this.toast(this.locateErrText(err));
      });
    },

    // 编辑模式：图钉拉回地点原坐标（撤销手滑 / 拖去看了别处）
    backToOrigin() {
      if (!this.centerLat) return;
      this.lat = this.centerLat;
      this.lng = this.centerLng;
      this.centerMap();
    },

    /**
     * 把视野拉回图钉（这个编辑器里图钉 = 地图中心）。
     * 平时 latitude/longitude prop 变了 <map> 自己会挪；但两种场景 prop 值
     * 看不出变化，必须显式 moveToLocation 拉一次：
     *   · 原地再定位 —— 新 GPS 和图钉只差几米，prop 几乎没动；
     *   · 拖走地图再点回来 —— prop 根本没变过，视野却在别处。
     */
    centerMap() {
      this.$nextTick(() => {
        try {
          const ctx = uni.createMapContext(this.mapId, this);
          if (ctx && ctx.moveToLocation) {
            ctx.moveToLocation({ latitude: this.lat, longitude: this.lng });
          }
        } catch (e) { /* 平台不支持就只靠 prop 那条路，主流程不受影响 */ }
      });
    },

    /** 定位失败要说得清是哪一类：没权限 / 定位服务关着 / 其它（与 range 页同一套口径） */
    locateErrText(err) {
      const code = Number(err && err.code) || 0;
      if (code === 2 || code === 12) return this.$t('没拿到定位权限');
      if (code === 11) return this.$t('手机定位服务没开');
      return this.$t('定位失败，换个地方再试一次');
    },

    setRadius(m) {
      this.radiusM = Math.max(30, Math.min(5000, Number(m) || 200));
      this.scale = this.rToScale(this.radiusM);
    },
    onSlide(e) {
      const v = Number((e && e.detail && e.detail.value) || 0);
      if (v > 0) this.radiusM = v;
    },
    zoom(out) {
      this.scale = Math.max(3, Math.min(20, this.scale + (out ? 1 : -1)));
    },

    confirm() {
      this.$emit('confirm', {
        lat: Number(this.lat.toFixed(7)),
        lng: Number(this.lng.toFixed(7)),
        r: Math.round(this.radiusM)
      });
    }
  }
};
</script>

<style>
.rm-mask {
  position: fixed; left: 0; top: 0; right: 0; bottom: 0;
  background: rgba(23, 32, 26, 0.42);
  display: flex; align-items: flex-end; justify-content: center;
  z-index: 90;
}

.rm-card {
  width: 100%;
  padding: 26rpx 24rpx calc(24rpx + env(safe-area-inset-bottom));
  border-radius: 32rpx 32rpx 0 0;
  background: #fffdf8;
  background: var(--bg, #fffdf8);
}

.rm-head { display: flex; flex-direction: column; margin-bottom: 16rpx; }
.rm-title { font-size: 30rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.rm-hint { margin-top: 8rpx; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

/* 原生 map 组件：只占位卡片上半部，下方按钮/滑块在它矩形之外，不会被原生层盖住 */
.rm-map {
  width: 100%;
  height: 440rpx;
  border-radius: 24rpx;
  overflow: hidden;
  border: 2rpx solid rgba(23, 32, 26, 0.07);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.07));
}

.rm-readout {
  display: flex; flex-wrap: wrap; gap: 14rpx;
  margin-top: 16rpx;
}
.rm-ro-item {
  font-size: 23rpx; color: #5a6560; color: var(--ink-2, #5a6560);
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
  padding: 8rpx 18rpx; border-radius: 999rpx;
}
.rm-ro-r { color: #bb1332; color: var(--brand-strong, #bb1332); }

/* 「回到原位」：读数行里的一颗可点 chip（撤销图钉移动） */
.rm-ro-back {
  color: #bb1332; color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  font-weight: 500;
}

/* 地图内右下角「定位」钮：cover-view 只吃基本定位/布局/文本样式 ——
   不用阴影 / 单边 border / background-image（写了也不生效）；
   不用 flex 做居中（支持不稳），文字用 line-height + text-align 兜住 */
.rm-locate {
  position: absolute;
  right: 16rpx;
  bottom: 16rpx;
  width: 88rpx;
  height: 88rpx;
  border-radius: 44rpx;
  background-color: #fffdf8;
  text-align: center;
}
.rm-locate-txt {
  font-size: 24rpx;
  font-weight: 600;
  color: #bb1332;
  line-height: 88rpx;
}
.rm-locate-busy { color: #98a19b; }

.rm-presets {
  display: flex; align-items: center; flex-wrap: wrap; gap: 14rpx;
  margin-top: 16rpx;
}
.rm-preset {
  font-size: 24rpx; color: #17201a; color: var(--ink-1, #17201a);
  padding: 12rpx 22rpx; border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
}
.rm-preset-hover { opacity: 0.7; }
.rm-zoom { margin-left: auto; display: flex; gap: 12rpx; }
.rm-zoom-btn {
  width: 60rpx; height: 60rpx; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 34rpx; font-weight: 600; color: #bb1332; color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
}

.rm-slider-row {
  display: flex; align-items: center; gap: 16rpx;
  margin-top: 16rpx;
}
.rm-slider-label { font-size: 24rpx; color: #5a6560; color: var(--ink-2, #5a6560); flex-shrink: 0; }
.rm-slider { flex: 1; }
.rm-slider-val { font-size: 24rpx; color: #bb1332; color: var(--brand-strong, #bb1332); flex-shrink: 0; min-width: 96rpx; text-align: right; }

.rm-btns { display: flex; gap: 18rpx; margin-top: 24rpx; }
.rm-btn {
  flex: 1; height: 88rpx; border-radius: 18rpx;
  display: flex; align-items: center; justify-content: center;
  font-size: 30rpx; font-weight: 600;
}
.rm-btn-hover { opacity: 0.85; }
.rm-btn.ghost {
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
  color: #5a6560; color: var(--ink-2, #5a6560);
}
.rm-btn.primary {
  background: #e4173d; background: var(--brand, #e4173d); color: #fff;
}
</style>
