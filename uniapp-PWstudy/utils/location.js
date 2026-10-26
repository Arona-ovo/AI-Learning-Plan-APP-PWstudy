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
 * 取一次当前位置。
 * @returns {Promise<{lat:number,lng:number,acc:number}>}
 */
export function fetch() {
  return new Promise((resolve, reject) => {
    if (typeof uni === 'undefined' || !uni.getLocation) {
      reject({ code: -1, msg: '当前平台不支持定位' });
      return;
    }
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      // ⚠️ 不能复用 uni 的 12：那是"没授权"的码（2 / 12 同类），超时挤进去会被
      // 界面误报成"没拿到定位权限"，用户白去设置页翻一圈。超时单独占 14。
      reject({ code: 14, msg: '定位超时' });
    }, FETCH_TIMEOUT);
    uni.getLocation({
      type: 'gcj02',
      isHighAccuracy: false,      // 只需要"在不在几百米内"，高精度没必要，也更慢更耗电
      geocode: false,
      success: (res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const lat = Number(res && res.latitude);
        const lng = Number(res && res.longitude);
        if (!isFinite(lat) || !isFinite(lng)) {
          reject({ code: 13, msg: '定位结果不可用' });
          return;
        }
        resolve({ lat: lat, lng: lng, acc: Number(res.accuracy) || 0 });
      },
      fail: (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // errCode 各家不完全一致：2 / 12 是"没授权"，11 是"定位服务关着"
        const code = Number(e && (e.errCode || e.code)) || 0;
        reject({ code: code, msg: (e && (e.errMsg || e.message)) || '定位失败' });
      }
    });
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
