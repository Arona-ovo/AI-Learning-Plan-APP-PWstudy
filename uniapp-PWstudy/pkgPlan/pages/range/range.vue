<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('学习范围')" :back="true" />

    <!-- 这功能是什么 / 不做什么 -->
    <view class="card">
      <view class="pc-title">{{ $t('这是干什么的') }}</view>
      <view class="pc-txt">{{ intro }}</view>
      <view class="pc-note">{{ privacy }}</view>
      <view class="pc-note">{{ sampling }}</view>
    </view>

    <!-- 总开关 -->
    <view class="card">
      <view class="sw-row">
        <view class="sw-main">
          <text class="sw-title">{{ $t('记录我在不在学习范围') }}</text>
          <text class="sw-sub">{{ $t('关着的时候一个定位权限都不申请') }}</text>
        </view>
        <switch :checked="on" color="#e4173d" @change="toggle" />
      </view>
    </view>

    <!-- 权限：只在开关打开后才出现（关着的人不该被要求授权） -->
    <view class="card" v-if="on && !granted">
      <view class="pc-perm" @tap="openPerm">
        <text class="pc-perm-txt">{{ $t('还没给定位权限') }}</text>
        <text class="pc-perm-btn">{{ $t('去开启 ›') }}</text>
      </view>
      <view class="pc-txt">{{ $t('不给定位就记不了。只会申请「使用期间」的定位，不会要后台定位。') }}</view>
    </view>

    <!-- 地点列表 -->
    <view class="card" v-if="on">
      <view class="card-head">
        <text class="card-title">学习地点（{{ places.length }}）</text>
        <!-- 取定位是"慢动作"（最多 8 秒一次、三种取法最多轮三遍）：
             光把文字换成「定位中…」看着像卡住了，加一颗转圈把"在干活"说清楚。
             2026-10-29 用户要求。 -->
        <view class="card-more add-loc" @tap="openAdd">
          <view v-if="locating" class="loc-spin"></view>
          <text>{{ locating ? $t('定位中…') : $t('＋ 加地点') }}</text>
        </view>
      </view>

      <view v-if="!places.length" class="pc-txt">
        {{ $t('还没圈地点。站到常学习的地方，点右上角把它加进来。') }}
      </view>

      <view v-for="p in places" :key="p.id" class="pl-row">
        <view class="pl-main">
          <view class="pl-name">{{ p.name }}</view>
          <view class="pl-meta">
            <text class="pl-chip" @tap="openEdit(p)">{{ p.r }} 米 ›</text>
          </view>
        </view>
        <text class="pl-rename" @tap.stop="askRename(p)">{{ $t('改名') }}</text>
        <text class="pl-del" @tap.stop="askRemove(p)">{{ $t('删除') }}</text>
      </view>
    </view>

    <!-- 当前状态 -->
    <view class="card" v-if="on">
      <view class="card-head">
        <text class="card-title">{{ $t('现在在哪') }}</text>
        <text class="card-more" @tap="refreshNow">{{ checking ? $t('看一眼…') : $t('刷新') }}</text>
      </view>
      <view v-if="state" class="now-row">
        <view class="now-dot" :class="{ out: !state.inside }"></view>
        <text class="now-txt">{{ state.inside ? $t('在学习范围内') : $t('不在学习范围内') }}</text>
      </view>
      <view v-else class="pc-txt">{{ $t('还没测过。点右上角「刷新」看一眼。') }}</view>
      <!-- 距离只在"不在范围内"时才说：在范围内还报个数，看着像在炫耀定位准 -->
      <view v-if="state && !state.inside && state.dist > 0" class="pc-txt">{{ distLine }}</view>
      <view class="pc-txt">{{ todayLine }}</view>
    </view>

    <app-dialog
      :show="dlg.show"
      :title="dlg.title"
      :content="dlg.content"
      :confirm-text="dlg.confirmText"
      :mode="dlg.mode"
      :items="dlg.items"
      :danger="dlg.danger"
      :value="dlg.value"
      :placeholder="dlg.placeholder"
      :seq="dlg.seq"
      @confirm="onDlgYes"
      @cancel="dlg.show = false"
    />

    <!-- 小地图编辑器：加地点 / 微调位置与范围（真地图，见 components/range-map） -->
    <range-map
      :show="map.show"
      :center-lat="map.lat"
      :center-lng="map.lng"
      :init-radius="map.r"
      :you-here="map.youHere"
      @confirm="onMapConfirm"
      @close="map.show = false"
    />
  </view>
</template>

<script>
import { t } from '../../../utils/i18n.js'
import * as pw from '../../../utils/pwstore.js'
import * as loc from '../../../utils/location.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../../components/app-dialog/app-dialog.vue'
import RangeMap from '../../../components/range-map/range-map.vue'

export default {
  components: { FloatNavbar, AppDialog, RangeMap },
  data() {
    return {
      on: false,
      granted: false,
      places: [],
      state: null,          // 上次判定结果（location.lastState）
      todayOutMin: 0,
      locating: false,      // 正在取定位（加地点）
      checking: false,      // 正在刷新状态
      // 待建的地点：取到定位后先存这儿，等用户起完名字再落库
      draft: null,
      // 小地图编辑器：show / 中心参考 GPS / 初始半径 / 是否"你在这"模式
      map: { show: false, lat: 0, lng: 0, r: 200, youHere: false, editId: '' },
      dlg: {
        show: false, mode: 'confirm', title: '', content: '', confirmText: '',
        danger: false, action: '', id: '', items: [], value: '', placeholder: '', seq: 0
      }
    }
  },
  computed: {
    intro() {
      return t('圈出你常学习的地方（家、图书馆、自习室）。打开 App、开始和结束专注时，各看一眼你在不在那儿 —— 之后 AI 排任务会绕开「人不在」的时段，也不会把你没做完的事算成偷懒。')
    },
    privacy() {
      return t('只记「在 / 不在」，不记你去过哪：定位拿到就用完即弃，坐标不会写进学习记录，也不会发给 AI。AI 只看到「14:00-16:00 不在」这种时段，看不到地点名，更看不到坐标。')
    },
    sampling() {
      return t('不会一直在后台定位：最多 5 分钟看一次，关掉下面的开关就彻底停。')
    },
    todayOutText() {
      const m = Math.round(this.todayOutMin || 0);
      if (!m) return '0 ' + t('分钟');
      if (m < 60) return m + ' ' + t('分钟');
      const h = Math.floor(m / 60);
      const r = m % 60;
      // 复用通用的「小时 / 分钟」译文（'分' 没有单独译文，英文态会掉回中文）
      return h + ' ' + t('小时') + (r ? ' ' + r + ' ' + t('分钟') : '');
    },
    distLine() {
      if (!this.state || !(this.state.dist > 0)) return '';
      const m = this.state.dist;
      // 单位用 m / km 而不是"米 / 公里"：数字后面跟中文单位在英文态下会混成
      // "1.2 公里" 这种半中半英，看着别扭
      return t('距最近的学习地点') + ' ' + (m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m');
    },
    todayLine() {
      return t('今天不在范围内合计') + ' ' + this.todayOutText;
    }
  },
  onShow() {
    this.refresh();
  },
  methods: {
    refresh() {
      this.on = loc.on();
      this.granted = loc.granted();
      this.places = loc.places();
      this.state = loc.lastState();
      try {
        const s = pw.rangeSummary(pw.today(), 1);
        this.todayOutMin = s ? s.outMin : 0;
      } catch (e) {
        this.todayOutMin = 0;
      }
    },

    /** 开关：打开时立刻看一眼（force，不受 5 分钟节流限制） */
    toggle(e) {
      const v = !!(e && e.detail && e.detail.value);
      loc.turnOn(v);
      this.on = v;
      this.granted = loc.granted();
      if (v && this.granted && this.places.length) this.refreshNow();
    },

    openPerm() {
      loc.openPermissionSettings();
    },

    /**
     * 「＋ 加地点」：先取当前 GPS 当中心，再开小地图让用户拖动图钉微调位置、拖圆环改半径。
     * 取到定位先不落库 —— 小地图确认后再问名字（弹窗），用户取消了就什么都不留。
     */
    openAdd() {
      if (this.locating) return;
      if (!loc.granted()) {
        this.granted = false;
        uni.showToast({ title: t('请先给定位权限'), icon: 'none' });
        return;
      }
      this.locating = true;
      loc.fetch().then((pos) => {
        this.locating = false;
        this.map = { show: true, lat: pos.lat, lng: pos.lng, r: loc.DEFAULT_RADIUS, youHere: true };
      }).catch((err) => {
        this.locating = false;
        // 失败要说得清是哪一类：没权限 / 定位服务关着 / 超时，三件事修法完全不同
        const code = Number(err && err.code) || 0;
        const msg = (code === 2 || code === 12) ? t('没拿到定位权限') :
          (code === 11 ? t('手机定位服务没开') : t('定位失败，换个地方再试一次'));
        uni.showToast({ title: msg, icon: 'none' });
      });
    },

    /** 微调已有地点：以地点自身坐标为中心开小地图（图钉=地点，可拖动精修） */
    openEdit(p) {
      this.map = { show: true, lat: p.lat, lng: p.lng, r: p.r, youHere: false, editId: p.id };
    },

    /** 小地图确认：加地点 → 存草稿并问名字；微调 → 直接改写位置与半径 */
    onMapConfirm(res) {
      const add = this.map.youHere;
      const id = this.map.editId;
      this.map.show = false;
      if (add) {
        // 加地点模式：用 draft 承接坐标+半径，再问名字
        this.draft = { lat: res.lat, lng: res.lng, r: res.r };
        this.ask({
          mode: 'input',
          title: t('给这个地点起个名'),
          placeholder: t('例如：家 / 图书馆 / 自习室'),
          value: '',
          confirmText: t('保存'),
          action: 'addPlace'
        });
      } else {
        loc.setPlaceGeom(id, res);
        this.refresh();
      }
    },

    askRename(p) {
      this.ask({
        mode: 'input',
        title: t('改名'),
        placeholder: t('例如：家 / 图书馆'),
        value: p.name,
        confirmText: t('保存'),
        action: 'rename',
        id: p.id
      });
    },

    askRemove(p) {
      this.ask({
        title: t('删除'),
        content: p.name,
        confirmText: t('删除'),
        danger: true,
        action: 'remove',
        id: p.id
      });
    },

    refreshNow() {
      if (this.checking) return;
      this.checking = true;
      loc.checkNow(true).then((r) => {
        this.checking = false;
        this.refresh();
        if (!r.ok) {
          const msg = r.reason === 'noperm' ? t('没拿到定位权限') :
            r.reason === 'off' ? t('先打开开关并圈一个地点') : t('定位失败，稍后再试');
          uni.showToast({ title: msg, icon: 'none' });
        }
      });
    },

    // ---------- 统一弹窗 ----------
    ask(cfg) {
      this.dlg = Object.assign(
        { show: true, mode: 'confirm', title: '', content: '', confirmText: t('确定'),
          danger: false, action: '', id: '', items: [], value: '', placeholder: '' },
        cfg || {},
        { seq: (this.dlg && this.dlg.seq || 0) + 1 }
      );
    },
    /** payload：sheet → 下标；input → 文本；confirm → true */
    onDlgYes(payload) {
      const act = this.dlg.action;
      const id = this.dlg.id;
      this.dlg.show = false;
      if (act === 'addPlace') {
        const name = String(payload || '').trim();
        if (this.draft) loc.addPlace({ name: name, lat: this.draft.lat, lng: this.draft.lng, r: this.draft.r });
        this.draft = null;
        this.refresh();
        this.refreshNow();
      } else if (act === 'rename') {
        const name = String(payload || '').trim();
        if (name) loc.renamePlace(id, name);
        this.refresh();
      } else if (act === 'remove') {
        loc.removePlace(id);
        this.refresh();
      }
    }
  }
}
</script>

<style>
.card { margin-bottom: var(--app-gap, 20rpx); }

.pc-title { font-size: 29rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }

.pc-txt {
  margin-top: 14rpx;
  font-size: 24rpx;
  line-height: 1.8;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

/* 隐私 / 边界这类"先说清楚"的话：淡底卡片，避免被当成普通说明一扫而过 */
.pc-note {
  margin-top: 14rpx;
  padding: 16rpx 20rpx;
  border-radius: 14rpx;
  background: rgba(124, 58, 237, 0.08);
  font-size: 23rpx;
  line-height: 1.75;
  color: #5b3fa8;
}

.pc-perm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 22rpx;
  border-radius: 16rpx;
  background: rgba(247, 144, 9, 0.12);
}

.pc-perm-txt { font-size: 26rpx; color: #8a5800; font-weight: 500; }

.pc-perm-btn {
  font-size: 26rpx;
  font-weight: 600;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
}

.sw-row { display: flex; align-items: center; justify-content: space-between; }

.sw-main { flex: 1; min-width: 0; padding-right: 20rpx; }

.sw-title { display: block; font-size: 30rpx; color: #17201a; color: var(--ink-1, #17201a); }

.sw-sub {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18rpx;
}

.card-title { font-size: 28rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }

.card-more { font-size: 25rpx; color: #bb1332; color: var(--brand-strong, #bb1332); }
/* 「＋ 加地点 / 定位中…」：转圈 + 文字一行（转圈只在取定位时出现） */
.add-loc { display: flex; align-items: center; }
.loc-spin {
  width: 24rpx; height: 24rpx;
  margin-right: 10rpx;
  border-radius: 50%;
  border: 3rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.2);
  border-top-color: var(--brand, #e4173d);
  animation: loc-spin 0.8s linear infinite;
}
@keyframes loc-spin { to { transform: rotate(360deg); } }

.pl-row {
  display: flex;
  align-items: center;
  padding: 22rpx 0;
  border-top: 2rpx solid rgba(23, 32, 26, 0.07);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.pl-main { flex: 1; min-width: 0; }

.pl-name { font-size: 27rpx; color: #17201a; color: var(--ink-1, #17201a); }

.pl-meta { margin-top: 8rpx; display: flex; align-items: center; }

.pl-chip {
  font-size: 22rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
}

.pl-rename {
  flex: none;
  margin-left: 20rpx;
  font-size: 24rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.pl-del {
  flex: none;
  margin-left: 24rpx;
  font-size: 24rpx;
  color: #e5484d;
  color: var(--danger, #e5484d);
}

.now-row { display: flex; align-items: center; margin-bottom: 8rpx; }

.now-dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  background: #2f9e6d;
  margin-right: 14rpx;
  flex: none;
}

.now-dot.out { background: #f79009; }

.now-txt { font-size: 27rpx; color: #17201a; color: var(--ink-1, #17201a); }
</style>
