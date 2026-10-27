// utils/location.js - 学习范围：取定位、算距离、判定"在不在学习地点"
//
// 用户自己圈几个学习地点（家 / 图书馆 / 自习室），App 记下"这会儿在不在范围内"。
// 这批数据只有一个用途：告诉 AI "那段时间人客观不在场"，别把没学一律判成偷懒。
//
// ⚠️ 三条边界（改这块前先读，踩过就很难查）：
//
//   ① **不做后台持续定位**。
//      取一次定位要唤醒 GPS / 网络定位，是耗电动作；后台持续定位还要额外申请
//      ACCESS_BACKGROUND_LOCATION —— 那是应用商店重点审查的权限，国产 ROM 上
//      还各有各的限制（有的根本不给）。而我们真正需要的只是"哪几段人不在"，
//      不是轨迹。所以只在几个固定时刻取一次：
//        · 打开 App / 从后台切回前台
//        · 专注开始、专注结束
//        · 设置页手动点一次
//      采样稀疏是**设计**，不是精度缺陷。
//
//   ② **经纬度即用即弃，绝不落库，绝不上网**。
//      落库的只有"在 / 不在"这个布尔（见 pwstore.addRangeSample）。
//      喂给 AI 的只有时段与分钟数（见 harvest.rangeBlock），连地点名都不给。
//      这条是红线：一旦经纬度进了 daily，备份、统计、AI 上下文全都会带着它走。
//
//   ③ **只申请前台定位**（ACCESS_FINE_LOCATION / COARSE）。
//      用户不开这个功能，就一个权限都不申请；开了才申请（见 settings.range.on）。
//
// 「判定出去了」之后**不做任何打扰**：不弹窗、不暂停专注、不通知。
// 它只是一个事实记录，用来让 AI 的排期更懂事。

import * as settings from './settings.js';
import * as pw from './pwstore.js';
import * as apptime from './apptime.js';

/** 两次取样之间的最短间隔（毫秒）。采样稀疏是省电的关键，别调小。 */
const MIN_GAP_MS = 5 * 60 * 1000;
/** 一次定位最多等多久（毫秒）：拿不到就当"这次没测出来"，不阻塞调用方 */
const FETCH_TIMEOUT = 8000;
/** 缺省半径（米）：一栋楼 / 一个院子的量级 */
export const DEFAULT_RADIUS = 200;

/* ---------------- 配置 ---------------- */

function cfg() {
  try {
    const s = settings.get();
    return s && s.range ? s.range : { on: false, places: [] };
  } catch (e) {
    return { on: false, places: [] };
  }
}

function patch(p) {
  const c = cfg();
  settings.set({ range: Object.assign({}, c, p) });
}

/** 功能是否开着：总开关 + 至少圈了一个地点。**没开就一个权限都不申请**。 */
export function enabled() {
  const c = cfg();
  return !!c.on && Array.isArray(c.places) && c.places.length > 0;
}

/** 开关拨了但还没圈地点 → 界面上要能区分"没开"和"开了但没地点" */
export function on() {
  return !!cfg().on;
}

export function turnOn(v) {
  patch({ on: !!v });
}

export function places() {
  const c = cfg();
  return Array.isArray(c.places) ? c.places.slice() : [];
}

/**
 * 加一个学习地点。
 * @param {{name?:string,lat:number,lng:number,r?:number}} p
 */
export function addPlace(p) {
  const lat = Number(p && p.lat);
  const lng = Number(p && p.lng);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const list = places();
  const item = {
    id: 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36),
    name: String((p && p.name) || '').trim() || ('地点 ' + (list.length + 1)),
    lat: lat,
    lng: lng,
    r: Math.max(30, Math.min(5000, Math.round(Number(p && p.r) || DEFAULT_RADIUS)))
  };
  list.push(item);
  patch({ places: list });
  return item;
}

export function removePlace(id) {
  const list = places().filter(x => x.id !== id);
  patch({ places: list });
  return list;
}

export function renamePlace(id, name) {
  const list = places();
  const hit = list.filter(x => x.id === id)[0];
  if (!hit) return list;
  hit.name = String(name || '').trim() || hit.name;
  patch({ places: list });
  return list;
}

/** 半径（米） */
export function setRadius(id, r) {
  const list = places();
  const hit = list.filter(x => x.id === id)[0];
  if (!hit) return list;
  hit.r = Math.max(30, Math.min(5000, Math.round(Number(r) || DEFAULT_RADIUS)));
  patch({ places: list });
  return list;
}

/**
 * 在小地图上微调某地点的位置与半径（零 SDK 的自绘编辑器用）。
 * 经纬度只在设置里存，不进 daily、不上网 —— 这条红线在 check-range 第 1/3 节守着。
 * @param {string} id
 * @param {{lat:number,lng:number,r:number}} g
 */
export function setPlaceGeom(id, g) {
  const list = places();
  const hit = list.filter(x => x.id === id)[0];
  if (!hit) return list;
  const lat = Number(g && g.lat);
  const lng = Number(g && g.lng);
  if (isFinite(lat) && isFinite(lng)) { hit.lat = lat; hit.lng = lng; }
  if (g && g.r != null) hit.r = Math.max(30, Math.min(5000, Math.round(Number(g.r) || DEFAULT_RADIUS)));
  patch({ places: list });
  return list;
}

/* ---------------- 权限 ---------------- */

function appPlus() {
  // #ifdef APP-PLUS
  return typeof plus !== 'undefined' && !!plus.android;
  // #endif
  return false;
}

/**
 * 有没有定位权限（实测，不猜）。
 *
 * 用 Activity.checkSelfPermission 而不是 uni.getSetting：后者在 App 端不覆盖
 * 运行时权限，问出来永远是"有"，然后第一次真取定位才失败 —— 那时候用户已经
 * 看着一个"已开启"的开关懵了。
 */
export function granted() {
  if (!appPlus()) return false;
  try {
    const activity = plus.android.runtimeMainActivity();
    const ok = (perm) => {
      try { return activity.checkSelfPermission(perm) === 0; } catch (e) { return false; }  // 0 = PERMISSION_GRANTED
    };
    return ok('android.permission.ACCESS_FINE_LOCATION') || ok('android.permission.ACCESS_COARSE_LOCATION');
  } catch (e) {
    return false;
  }
}

/** 跳到本机给权限的地方（应用详情页里那一项） */
export function openPermissionSettings() {
  try { return !!apptime.openAppDetails(); } catch (e) { return false; }
}

/* ---------------- 定位 ---------------- */

/**
 * WGS84 → GCJ02（国测局火星坐标）转换。
 * 高德底图 / 高德地图组件用的是 gcj02，学习地点坐标也统一存 gcj02，
 * 所以无论定位取回来是什么，最终都归一成 gcj02，地图和判定才对得上。
 * 中国境外原样返回（不偏移）。算法是公开的匀速偏移近似，几百米量级够用。
 */
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;
function outOfChina(lat, lng) {
  return (lng < 72.004 || lng > 137.8347) || (lat < 0.8293 || lat > 55.8271);
}
function gcjTransformLat(x, y) {
  let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  r += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  r += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return r;
}
function gcjTransformLng(x, y) {
  let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  r += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  r += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return r;
}
export function wgs84ToGcj02(lat, lng) {
  if (!isFinite(lat) || !isFinite(lng) || outOfChina(lat, lng)) return { lat: lat, lng: lng };
  let dLat = gcjTransformLat(lng - 105.0, lat - 35.0);
  let dLng = gcjTransformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180.0) / (GCJ_A / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}

/**
 * 取一次当前位置。
 * @returns {Promise<{lat:number,lng:number,acc:number}>}  坐标一律归一成 gcj02（和高德底图 / 已存地点一致）
 *
 * ⚠️ 取法的鲁棒性（2026-10-27 修"定位失败，换个地方再试一次"）：
 *   Android 上 uni.getLocation(type:'gcj02') 依赖 manifest 里配的高德 key
 *   （sdkConfigs.maps.amap.android）。一旦被 HBuilderX 打包时清掉 / key 失效，
 *   gcj02 取法人会直接 fail，界面就只剩一句"定位失败"。
 *   所以这里做了一串兜底（换了参数就救得回来的，绝不一上来就报错）：
 *     ① gcj02（快路径，key 正常时直接成功）
 *     ② wgs84（系统 GPS，**完全不依赖高德 key**）→ JS 转 gcj02   ← 关键兜底
 *     ③ gcj02 + 高精度（前两路都拿不到时，再用 GPS 高精度搏一次）
 *   只有"没权限(2/12)"或"定位服务关着(11)"才立刻放弃（换了参数也一样）；
 *   其余失败（含 key 失效）都换下一种取法。
 */
export function fetch() {
  return new Promise((resolve, reject) => {
    if (typeof uni === 'undefined' || !uni.getLocation) {
      reject({ code: -1, msg: '当前平台不支持定位' });
      return;
    }
    const attempts = [
      { type: 'gcj02', isHighAccuracy: false },
      { type: 'wgs84', isHighAccuracy: false },   // 不依赖高德 key 的系统 GPS 兜底
      { type: 'gcj02', isHighAccuracy: true }
    ];
    let idx = 0;
    const tryOne = () => {
      if (idx >= attempts.length) {
        reject({ code: 14, msg: '定位超时' });
        return;
      }
      const opt = attempts[idx++];
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        tryOne();   // 这种取法超时 → 换下一种
      }, FETCH_TIMEOUT);
      uni.getLocation({
        type: opt.type,
        isHighAccuracy: opt.isHighAccuracy,
        geocode: false,
        success: (res) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const lat = Number(res && res.latitude);
          const lng = Number(res && res.longitude);
          if (!isFinite(lat) || !isFinite(lng)) {
            tryOne();   // 拿到空坐标 → 换下一种取法
            return;
          }
          const out = opt.type === 'wgs84' ? wgs84ToGcj02(lat, lng) : { lat: lat, lng: lng };
          resolve({ lat: out.lat, lng: out.lng, acc: Number(res.accuracy) || 0 });
        },
        fail: (e) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const code = Number(e && (e.errCode || e.code)) || 0;
          // 2 / 12 = 没授权；11 = 定位服务关着。这两个换了参数也救不了，直接报
          if (code === 2 || code === 12 || code === 11) {
            reject({ code: code, msg: (e && (e.errMsg || e.message)) || '定位失败' });
            return;
          }
          tryOne();   // 其余（含高德 key 失效导致的 gcj02 失败）→ 换下一种取法
        }
      });
    };
    tryOne();
  });
}

/** 两点球面距离（米）。Haversine —— 几百米的量级下够准了。 */
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (x) => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 给定坐标在不在任一学习地点内（顺带回最短距离，界面上要显示"离最近的地点还有多远"） */
export function insideAt(lat, lng) {
  const list = places();
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const d = distanceM(lat, lng, list[i].lat, list[i].lng);
    if (best < 0 || d < best) best = d;
    if (d <= (Number(list[i].r) || DEFAULT_RADIUS)) {
      return { inside: true, dist: Math.round(d), place: list[i].name };
    }
  }
  return { inside: false, dist: best < 0 ? -1 : Math.round(best), place: '' };
}

/* ---------------- 判定并落库 ---------------- */

function lastCheckAt() {
  return Number(cfg().lastCheckAt) || 0;
}

/**
 * 取一次定位 → 判定 → 落一条（只在状态翻转时真的写库）。
 *
 * 节流：距上次取样不到 MIN_GAP_MS 就跳过，除非 force。
 * 专注开始 / 结束这两个时刻用 force —— 那才是"人到底在不在"最该记的点，
 * 哪怕离上次只过了两分钟。
 *
 * @param {boolean} [force] 忽略节流
 * @returns {Promise<{ok:boolean,inside?:boolean,dist?:number,place?:string,reason?:string}>}
 *          ok=false 时 reason 说明为什么没测出来（没开 / 没权限 / 定位失败 / 被节流）
 */
export function checkNow(force) {
  if (!enabled()) return Promise.resolve({ ok: false, reason: 'off' });
  if (!granted()) return Promise.resolve({ ok: false, reason: 'noperm' });
  if (!force && Date.now() - lastCheckAt() < MIN_GAP_MS) {
    return Promise.resolve({ ok: false, reason: 'throttled' });
  }
  return fetch().then((pos) => {
    const r = insideAt(pos.lat, pos.lng);
    // ⚠️ 只把布尔交下去：经纬度到这里为止，函数返回后就不存在了
    pw.addRangeSample(pw.today(), r.inside, Date.now());
    patch({ lastCheckAt: Date.now(), lastInside: !!r.inside, lastDist: r.dist });
    return { ok: true, inside: !!r.inside, dist: r.dist, place: r.place };
  }).catch((e) => {
    return { ok: false, reason: 'fail', code: (e && e.code) || 0, msg: (e && e.msg) || '' };
  });
}

/** 上次判定的结果（界面显示用；没测过返回 null） */
export function lastState() {
  const c = cfg();
  if (!c.lastCheckAt) return null;
  return { at: c.lastCheckAt, inside: !!c.lastInside, dist: Number(c.lastDist) || 0 };
}
