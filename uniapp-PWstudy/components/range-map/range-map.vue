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
           改范围：下方滑块 / 快捷档；归中：读数行右侧的「定位」（见 2026-10-29 的说明）。
           ⚠️ 手势要显式打开：enable-scroll / enable-zoom 不写，部分内核默认是关的 ——
              现象就是"地图能看不能拖"，用户以为卡死了。
           ⚠️ :key="mapSeq"：归中失败时靠换 key 重挂原生地图（App 端没有别的可靠办法），
              见 recenter()。 -->
      <map
        class="rm-map"
        :id="mapId"
        :key="mapSeq"
        :latitude="lat"
        :longitude="lng"
        :scale="scale"
        :markers="markers"
        :circles="circles"
        :show-location="true"
        :enable-scroll="true"
        :enable-zoom="true"
        :enable-rotate="false"
        :enable-overlooking="false"
        @tap="onTapMap"
        @markerdrag="onMarkerDrag"
        @updated="onUpdated"
      ></map>

      <!-- 读数 -->
      <view class="rm-readout">
        <text class="rm-ro-item rm-ro-r">{{ radiusText }}</text>
        <text class="rm-ro-item" v-if="offsetMeters > 1">{{ offsetText }}</text>
        <text class="rm-ro-item rm-ro-back" v-if="canBack" @tap="backToOrigin">{{ $t('回到原位') }}</text>
        <!-- 定位（2026-10-29 从地图里挪出来）：原来是地图右下角的 cover-view，
             两个毛病 —— 原生地图不认容器圆角，按钮右半边被方形边界切掉；而且
             App 端 cover-view 的点击偶发不派发，"点了没反应"。放到读数行里，
             点击走普通 view，和旁边几颗 chip 同一套命中区域。 -->
        <text
          class="rm-ro-item rm-ro-loc"
          :class="{ 'rm-ro-busy': locating }"
          @tap="locateMe"
        >{{ locating ? $t('定位中…') : $t('定位') }}</text>
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
      // 换 key 就重挂原生地图：App 端"把视野挪到某点"没有 100% 可靠的接口，
      // 归中后实测没挪动就用它兜底（见 recenter）。
      mapSeq: 1,
      lat: 0,
      lng: 0,
      radiusM: 200,
      scale: 16,
      presetMeters: [100, 200, 500, 1000], // 纯数字+单位 m，不占 i18n
      mapReady: false,
      locating: false // 「定位」正在取 GPS（防连点）
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
        // ★ 这两个数字是**物理像素**，不是 rpx：原来写 28/36，在 3 倍屏上只有
        //   9dp 宽，缩成地图上一个看不清的小红点（2026-10-29 真机截图实锤）。
        //   48×60 ≈ 16×20dp，和系统地图的图钉一个量级。
        width: 48,
        height: 60,
        anchor: { x: 0.5, y: 1 },
        draggable: true
      };
      // 有自定义图钉就用，没有就让高德用默认红图钉（App 端可靠）
      try { m.iconPath = PIN; } catch (e) { /* 忽略，用默认 */ }
      return [m];
    },
    circles() {
      // ★ 描边必须够粗才有"圈"的样子：strokeWidth 单位是物理像素，写 2 在 3 倍屏上
      //   只有 0.7dp —— 真机上几乎看不见（截图里只剩一条发丝红线）。
      //   填充也别太淡：底图本身就偏粉，13% 的红铺上去等于没有。
      // ⚠️ 颜色保留 8 位十六进制（后两位是 alpha，uni 文档规定的格式）：
      //   6 位在部分内核上会被当成不合法色值整条丢掉 —— 那就又看不见圈了。
      return [{
        latitude: this.lat,
        longitude: this.lng,
        radius: this.radiusM,
        color: '#e4173dff',
        fillColor: '#e4173d33',
        strokeWidth: 4
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
      else clearTimeout(this._ctrT); // 关掉就别再回来改地图状态（组件常驻，定时器得自己收）
    }
  },
  beforeDestroy() {
    clearTimeout(this._ctrT);
    this._ctrT = null;
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

    // 「定位」：取一次当前 GPS，图钉 + 视野一起归中过去
    locateMe() {
      if (this.locating) return;
      this.locating = true;
      loc.fetch().then((pos) => {
        this.locating = false;
        this.lat = pos.lat;
        this.lng = pos.lng;
        this.scale = this.rToScale(this.radiusM); // 归中后按半径重取缩放，圆保证看得全
        this.recenter();
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
      this.recenter();
    },

    /**
     * 把视野拉回图钉（这个编辑器里图钉 = 地图中心）。
     *
     * 为什么这么绕（2026-10-29 真机反馈"点定位不生效"）：
     *   · 平时 latitude/longitude prop 变了 <map> 自己会挪，但**"定位到当前位置"
     *     恰恰是最不会变值的那种情况** —— 加地点时图钉本来就是按 GPS 放的，
     *     再取一次只差几米，prop 几乎没动，于是屏幕上什么都不发生；
     *   · 只好靠 moveToLocation 显式拉视野。可它在部分机型上是空操作
     *     （地图的"我的位置"图层没起来时，高德直接忽略这次调用，不报错）。
     * 所以：先按文档调 moveToLocation，**再实测一次视野中心**；
     *   没挪到位就换 key 重挂地图 —— 原生视图按当前 lat/lng/scale 重建，一定到位。
     *   健康的机型上走不到重挂那一步，不会有白闪。
     */
    recenter() {
      this.$nextTick(() => {
        let ctx = null;
        try { ctx = uni.createMapContext(this.mapId, this); } catch (e) { ctx = null; }
        if (ctx && ctx.moveToLocation) {
          try { ctx.moveToLocation({ latitude: this.lat, longitude: this.lng }); } catch (e) { /* 下面实测兜底 */ }
        }
        clearTimeout(this._ctrT);
        const wantLat = this.lat;
        const wantLng = this.lng;
        this._ctrT = setTimeout(() => {
          this._ctrT = null;
          if (!ctx || !ctx.getCenterLocation) { this.remountMap(); return; }
          try {
            ctx.getCenterLocation({
              success: (res) => {
                const d = loc.distanceM(Number(res.latitude), Number(res.longitude), wantLat, wantLng);
                // 20 米容差：GPS 抖动 + 视口中心取整；超过就认为视野没跟过去
                if (!(d <= 20)) this.remountMap();
              },
              fail: () => this.remountMap()
            });
          } catch (e) { this.remountMap(); }
        }, 320);
      });
    },

    /** 换 key 重挂原生地图（视野按当前 lat/lng/scale 重建）—— 归中失败时的兜底 */
    remountMap() {
      this.mapReady = false;
      this.mapSeq += 1;
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
  display: flex; flex-wrap: wrap; align-items: center; gap: 12rpx;
  margin-top: 14rpx;
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
/* 「定位」：推到读数行最右（原来是地图里的 cover-view，见模板注释） */
.rm-ro-loc {
  margin-left: auto;
  color: #bb1332; color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  font-weight: 600;
  padding: 8rpx 24rpx;
}
.rm-ro-busy { color: #98a19b; color: var(--ink-3, #98a19b); }

.rm-presets {
  display: flex; align-items: center; flex-wrap: wrap; gap: 12rpx;
  margin-top: 12rpx;
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
  margin-top: 14rpx;
}
.rm-slider-label { font-size: 24rpx; color: #5a6560; color: var(--ink-2, #5a6560); flex-shrink: 0; }
.rm-slider { flex: 1; }
.rm-slider-val { font-size: 24rpx; color: #bb1332; color: var(--brand-strong, #bb1332); flex-shrink: 0; min-width: 96rpx; text-align: right; }

.rm-btns { display: flex; gap: 18rpx; margin-top: 20rpx; }
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
