// utils/updater.js - 版本自检与 wgt 热更新
//
// 为什么需要它：每次发版都要手动传 APK 太笨重 —— 改个界面、修个 bug 也要用户去下
// 20MB 的整包，装完还得再点一次系统安装界面。wgt 只有几百 KB，装完自动重启，
// 用户几乎无感。**只有动了原生（权限 / 图标 / 启动图 / UTS 插件）才需要整包**。
//
// 服务端就是 GitHub Release（固定 tag `PWstudy`），没有自建服务器也没有数据库：
//   检查 → GET releases/latest，从 assets 里找 .wgt
//   版本 → 资产名 `PWstudy-<版本>[-n<原生基线>].wgt`，例 `PWstudy-1.0.1-n101.wgt`
//   整包 → 拿不到 wgt / 基座太老 / 下载或安装失败，一律引导去 Release 页
// 发版动作 = 把 wgt 拖进 Release（打包的活儿在 _tools/publish-wgt.js）。
//
// ⚠️ 四条纪律（每条都是踩出来的）：
//   1. **启动自检失败必须静默** —— 网络不通、GitHub 抽风都不许弹东西打扰用户；
//      只有用户手动点「检查更新」才允许报错。
//   2. **wgt 装完必须 `plus.runtime.restart()`** —— 不重启不生效，白装。
//   3. **基座太老绝不装 wgt** —— 老基座装上新资源包会白屏。所以资产名里带
//      `n<code>`（要求的原生基线），本地 versionCode 不够就直接引导整包。
//   4. **一切失败都有出口** —— 兜底永远是"去下载完整包"，不能卡在"更新失败"上
//      让用户什么也做不了。

import * as settings from './settings.js';
import { BUILD_INFO } from '../data/build-info.js';

/** 完整包的下载页（也是"更新失败"的兜底出口） */
export const RELEASE_URL = 'https://github.com/Arona-ovo/AI-Learning-Plan-APP-PWstudy/releases/tag/PWstudy';

/** 版本清单永远挂在这个 tag 上 */
export const RELEASE_TAG = 'PWstudy';

/**
 * 版本清单。**按 tag 精确取，不用 `/releases/latest`** —— latest 的语义是
 * "最新发布的那个非草稿、非预发布"，哪天仓库里多出一个 Release（哪怕只是顺手
 * 建了个 tag），它就漂走了，客户端会读到一份跟约定无关的清单。
 */
export const REPO_API = 'https://api.github.com/repos/Arona-ovo/AI-Learning-Plan-APP-PWstudy/releases/tags/' + RELEASE_TAG;

const CHECK_TIMEOUT = 8000;    // 检查要快：慢了就拖住启动
const DOWN_TIMEOUT = 120000;   // 下载可以慢（整包才大，wgt 一般几秒）
const PROP_TIMEOUT = 1500;     // 读本地版本信息等不了太久，拿不到就用 build-info 兜

/* ---------------- 版本 ---------------- */

/**
 * '1.0 Beta' / '1.2.3' / '1.0_Beta' → { name, code }
 *
 * code 是比较用的整数（x*10000 + y*100 + z，缺位补 0）。
 * 为什么不直接比字符串：'1.10' 字典序小于 '1.9'，但它是更新的版本。
 */
export function parseVersion(s) {
  const name = String(s == null ? '' : s).trim();
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(name);
  if (!m) return { name, code: 0 };
  return { name, code: Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3] || 0) };
}

/**
 * 资产名 → { version, code, minNative }；不是我们的更新包返回 null。
 * `PWstudy-1.0.1-n101.wgt` → { version:'1.0.1', code:10001, minNative:101 }
 * `n` 段省略 = 不挑基座（0）。
 */
function parseNamed(name, ext) {
  const m = new RegExp('^PWstudy-([0-9][\\w. ]*?)(?:-n(\\d+))?\\.' + ext + '$', 'i')
    .exec(String(name || '').trim());
  if (!m) return null;
  const v = parseVersion(m[1]);
  if (!v.code) return null;
  return { version: v.name, code: v.code, minNative: m[2] ? Number(m[2]) : 0 };
}

export function parseAssetName(name) {
  return parseNamed(name, 'wgt');
}

/**
 * 整包：只有按 `PWstudy-<版本>.apk` 命名的才认。
 *
 * 为什么必须挑名字：Release 里可能挂着别的 APK —— 比如 HBuilder 云打包直接产出的
 * `__UNI__53285BF__20261011204240.apk`（文件名里只有时间戳、**没有版本号**），
 * 这种常被拿来占位。认了它就等于拿猜的去告诉用户"你该重装了"，纯属吓人。
 */
export function parseApkName(name) {
  return parseNamed(name, 'apk');
}

function todayStr() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/**
 * 本地版本。App 端读**真实运行包** —— 装过 wgt 之后这里就是 wgt 的版本，
 * 拿它跟远端比才知道"这台机器是不是已经更新过了"。其它端回退 build-info。
 */
export function localVersion() {
  return new Promise((resolve) => {
    const base = parseVersion(BUILD_INFO.version);
    let settled = false;
    const give = (v) => { if (!settled) { settled = true; resolve(v); } };
    // #ifdef APP-PLUS
    try {
      plus.runtime.getProperty(plus.runtime.appid, (info) => {
        const p = parseVersion((info && (info.versionName || info.version)) || '');
        give({
          name: p.name || base.name,
          code: p.code || base.code,
          nativeCode: Number(info && info.versionCode) || 0
        });
      });
      // 拿不到（HBuilder 基座 / 回调不来）也不能卡住：超时就用 build-info
      setTimeout(() => give({ name: base.name, code: base.code, nativeCode: 0 }), PROP_TIMEOUT);
      return;
    } catch (e) {}
    // #endif
    give({ name: base.name, code: base.code, nativeCode: 0 });
  });
}

/* ---------------- 远端 ---------------- */

function fetchRelease() {
  return new Promise((resolve, reject) => {
    uni.request({
      url: REPO_API,
      method: 'GET',
      timeout: CHECK_TIMEOUT,
      header: { Accept: 'application/vnd.github+json' },
      success: (res) => {
        const code = res && res.statusCode;
        if (code && code >= 400) { reject(new Error('版本服务返回 ' + code)); return; }
        const d = res && res.data;
        if (!d || typeof d !== 'object') { reject(new Error('版本信息读不出来')); return; }
        // tag 对不上就是拿错清单了（比如以后接口改回 latest 漂到别的 Release 上），
        // 宁可当"没查到"，也不能拿别人的资产当我们的更新包
        if (d.tag_name && d.tag_name !== RELEASE_TAG) {
          reject(new Error('版本清单对不上（' + d.tag_name + '）'));
          return;
        }
        resolve(d);
      },
      fail: (e) => reject(new Error((e && e.errMsg) || '连不上版本服务'))
    });
  });
}

/** 从 Release 里挑一个包（wgt / apk），有多个时取版本号最大的 */
function pickAsset(rel, ext, parse) {
  let best = null;
  ((rel && rel.assets) || []).forEach((a) => {
    const p = parse(a && a.name);
    if (!p) return;
    const url = (a && a.browser_download_url) || '';
    if (!url) return;
    const item = {
      version: p.version, code: p.code, minNative: p.minNative, url,
      size: (a && a.size) || 0
    };
    if (!best || item.code > best.code) best = item;
  });
  return best;
}

/** 最新的 wgt（热更新用） */
export function pickWgt(rel) {
  return pickAsset(rel, 'wgt', parseAssetName);
}

/** 最新的整包（按约定命名的才算；占位用的默认名不算） */
export function pickApk(rel) {
  return pickAsset(rel, 'apk', parseApkName);
}

/** Release 说明里挑几行当更新日志（GitHub 的 body 是 markdown，原样展示就够了） */
function notesOf(rel) {
  const s = String((rel && rel.body) || '').trim();
  if (!s) return '';
  const lines = s.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  return lines.slice(0, 6).join('\n').slice(0, 300);
}

function sizeText(n) {
  if (!n) return '';
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
  return (Math.round((n / 1048576) * 10) / 10) + ' MB';
}

/* ---------------- 检查 ---------------- */

/**
 * 比对一次。
 * @param {{manual?:boolean}} opt manual=true 时忽略"跳过过这个版本"
 * @returns {Promise<{state:string, local:object, remote?:object, notes?:string}>}
 *   state: 'latest' 已是最新 | 'update' 有 wgt 可更 | 'native' 基座太老只能整包
 *          | 'apk'   远端只有整包、且它比本机新 | 'none' 没有可用的包
 *          | 'skip'  用户跳过过这个版本
 */
export async function check(opt) {
  const r = await checkRaw(opt);
  // 顺手把"有没有新版本"落到 storage：红点和首页弹窗都读它。
  // ⚠️ skip 那条不动 —— 用户说过"这个版本别烦我"，但"有新版本"这个事实还在，
  //    只是不亮红点、不弹窗。下次发新版本，版本号变了自然又会亮。
  if (r.state === 'update' || r.state === 'native' || r.state === 'apk') savePending(r);
  else if (r.state === 'latest' || r.state === 'none') clearPending();
  return r;
}

async function checkRaw(opt) {
  const o = opt || {};
  const local = await localVersion();
  const rel = await fetchRelease();
  const remote = pickWgt(rel);
  const notes = notesOf(rel);

  if (remote && local.code < remote.code) {
    // 基座太老：wgt 里改不了原生，装上去只会白屏 —— 必须整包
    if (remote.minNative && local.nativeCode && local.nativeCode < remote.minNative) {
      return { state: 'native', local, remote, notes };
    }
    if (!o.manual) {
      try {
        const u = settings.get().update || {};
        if (u.skip === remote.version) return { state: 'skip', local, remote, notes };
      } catch (e) {}
    }
    return { state: 'update', local, remote, notes };
  }

  // 没有可热更的：看看有没有**更新的整包**（只认按约定命名的，占位包不算）
  const apk = pickApk(rel);
  if (apk && local.code < apk.code) return { state: 'apk', local, remote: apk, notes };
  // 连个 wgt 都没有 = 这一版压根没放热更新包；本机又已经不比它旧 → 别打扰
  if (!remote) return { state: 'none', local, notes };
  return { state: 'latest', local, remote, notes };
}

function markChecked() {
  try { settings.set({ update: { lastCheckAt: todayStr() } }); } catch (e) {}
}
function markSkip(v) {
  try { settings.set({ update: { skip: String(v || ''), lastCheckAt: todayStr() } }); } catch (e) {}
}

/* ---------------- 待更新状态（红点 / 首页弹窗） ---------------- */

/**
 * 待更新状态。
 *
 * `downloadPath` = 已经下到本地、等待安装的包路径（Wi-Fi 下提前下好的那种）。
 * 它必须写在 EMPTY_PENDING **里面**：settings.set 是 deepMerge，清 pending 时
 * 漏了这个字段，旧路径就会残留下来 —— 下一次比对会拿着一个指向旧包（甚至已被
 * 系统回收）的路径去安装，白屏或装回旧版本。
 */
const EMPTY_PENDING = { version: '', code: 0, minNative: 0, url: '', size: 0, notes: '', state: '', downloadPath: '' };

/** 记一笔"有个新版本等着装" */
function savePending(r) {
  try {
    const v = r.remote || {};
    // 同一个版本之前已经下好了，别把它丢掉 —— 重查一次就把几百 KB 作废太浪费，
    // 而且用户已经看过一次更新弹窗，再让他等一遍下载会更不想更。
    const old = (settings.get().update || {}).pending || {};
    const keep = (old.code && old.code === (v.code || 0) && old.downloadPath) ? old.downloadPath : '';
    settings.set({
      update: {
        pending: {
          version: v.version || '', code: v.code || 0, minNative: v.minNative || 0,
          url: v.url || '', size: v.size || 0, notes: r.notes || '', state: r.state || '',
          downloadPath: keep
        }
      }
    });
  } catch (e) {}
}

/** 记下"这个版本的包已经下好了"（只对当前 pending 的版本生效，别串台） */
function markDownloaded(code, path) {
  try {
    const p = (settings.get().update || {}).pending;
    if (!p || !p.code || p.code !== code) return;
    settings.set({ update: { pending: Object.assign({}, p, { downloadPath: path }) } });
  } catch (e) {}
}

export function clearPending() {
  try { settings.set({ update: { pending: EMPTY_PENDING } }); } catch (e) {}
}

/**
 * 当前等着装的更新（没有则 null）。
 *
 * 判据是**拿记下的版本号跟本机比** —— 装完新版之后它自然就不再比本机新，
 * 顺手清掉。这就是红点"自动消失"的全部机制，不需要额外记"看过了"。
 */
export function pending() {
  return localVersion().then(async (local) => {
    let p = null;
    try { p = (settings.get().update || {}).pending; } catch (e) {}
    if (!p || !p.version || !p.code) return null;
    if (local && local.code >= p.code) { clearPending(); return null; }
    // 记下的本地包路径不一定还在（清缓存 / 换机恢复 / 系统回收）。**在这里统一验一遍**
    // 是唯一合适的时机：pending() 是红点、首页弹窗、预下载共同的入口，过这一道之后
    // 后面所有地方拿到 downloadPath 都可以当"文件真的在"，不用各自再异步查一遍
    // —— 那会让 askUpdate 变成异步，调用它的页面全都要跟着 await。
    if (p.downloadPath && !(await fileUsable(p.downloadPath))) {
      clearDownloadPath(p.code);
      p = Object.assign({}, p, { downloadPath: '' });
    }
    return Object.assign({}, p, { local: local });
  }).catch(() => null);
}

/** 本地包没了：只清路径，pending 其余字段留着（"有新版本"这件事还是要继续盯着） */
function clearDownloadPath(code) {
  try {
    const p = (settings.get().update || {}).pending;
    if (!p || !p.code || p.code !== code) return;
    settings.set({ update: { pending: Object.assign({}, p, { downloadPath: '' }) } });
  } catch (e) {}
}

/** 红点要不要亮：有新版本 **且** 用户没对这个版本说过"不再提示" */
export function hasUpdate() {
  return pending().then((p) => {
    if (!p) return false;
    try { return (settings.get().update || {}).skip !== p.version; } catch (e) { return true; }
  });
}

let prompted = false;   // 本次进程已经弹过了 —— 切个 tab 回来又弹一遍是骚扰

/**
 * 首页 onShow 调用：有可用更新就弹一次。
 *
 * 三个不弹：① 本次进程弹过了；② 用户对这版说过"不再提示"；
 * ③ 页面上有别的事在办（权限引导 / 关联询问）—— 那些比更新重要，让它先。
 * 第 ③ 条只有页面知道，所以从外面传进来。
 *
 * @param {{busy?:boolean}} opt busy=true 表示此刻有别的弹窗/询问在场，让路
 */
export function promptOnce(opt) {
  const o = opt || {};
  if (o.busy) return Promise.resolve(false);
  if (prompted) return Promise.resolve(false);
  return pending().then((p) => {
    if (!p) return false;
    try { if ((settings.get().update || {}).skip === p.version) return false; } catch (e) {}
    // 先记账再弹：不管用户点哪个，这一轮都算"问过了"
    prompted = true;
    if (p.state === 'update') {
      askUpdate({ state: 'update', remote: p, notes: p.notes, local: p.local });
      return true;
    }
    if (p.state === 'native' || p.state === 'apk') {
      askFull({ state: p.state, remote: p, notes: p.notes, local: p.local });
      return true;
    }
    return false;
  }).catch(() => false);
}

/**
 * 启动自检：一天一次，失败静默，有更新才打扰。
 * 只在 App 端有意义（其它端装不了 wgt）—— 非 App 端直接返回 null。
 */
export async function autoCheck() {
  // #ifdef APP-PLUS
  try {
    const u = settings.get().update || {};
    if (u.auto === false) return null;
    if (u.lastCheckAt === todayStr()) {
      // 今天查过了：那次可能不在 Wi-Fi、包没下成 —— 趁这次启动补一下。
      // ⚠️ 节流只挡**联网查版本**，不挡"用已有信息把包准备好"。
      try { await prefetch() } catch (e) {}
      return null;
    }
    const r = await check();
    markChecked();
    // 清单拿到了就把包备好，等用户点头时装得上（prefetch 内部只在 Wi-Fi 动，失败也静默）
    try { await prefetch() } catch (e) {}
    // **这里不弹窗**：启动瞬间糊一张卡片容易打断首屏，而且此刻判断不了
    // "页面上有没有别的事在办"。弹窗统一交给首页 onShow 的
    // updater.promptOnce() —— 那儿才看得见当前在忙什么，也才好排队。
    return r;
  } catch (e) {
    return null;   // 静默：网络不通不该弹"检查失败"
  }
  // #endif
  return null;
}

/** 手动检查（设置页）：这次要给人一个明确结果，包括"已经是最新" */
export async function manualCheck() {
  const r = await check({ manual: true });
  markChecked();
  return r;
}

/* ---------------- 下载 / 安装 ---------------- */

/* ---------- 网络：更新包只在 Wi-Fi 下走流量 ---------- */

const CELLULAR = ['2g', '3g', '4g', '5g', 'cellular'];

/**
 * 这个网络能不能用来下更新包。
 *
 * ⚠️ 蜂窝网络一律不许。更新包是用户**没主动要**的东西，拿他的流量去下，
 *   下完还只是告诉他"可以更新了" —— 这笔流量花得不值，账单是他在付。
 *   所以只要不是 Wi-Fi（有线网也算有保证），就拦下来让他连 Wi-Fi。
 *
 * ⚠️ unknown 必须放行：部分机型 / 模拟器 / 没给网络权限时会返回 unknown，
 *   这时候**不能把更新永久锁死** —— 一拦他就再也更不了了。放过去走正常下载，
 *   真下不动自然会落到既有的"去下载完整包"兜底上。
 *
 * @param {string} type 'wifi' | 'cellular' | 'none' | 'unknown'
 */
export function canDownloadNetwork(type) {
  if (type === 'wifi' || type === 'ethernet' || type === 'wired') return { ok: true, type: type, why: '' };
  if (type === 'none') return { ok: false, type: 'none', why: 'none' };
  if (type === 'cellular' || CELLULAR.indexOf(type) >= 0) return { ok: false, type: type, why: 'cellular' };
  return { ok: true, type: type || 'unknown', why: '' };
}

/**
 * 当前网络类型。**同步** —— 弹窗的按钮文案要用它，一旦异步，
 * askUpdate / showResult 的调用契约就得跟着改成 await，
 * 页面上一堆 `showResult(r)` 就地取值的地方全要动，不值。
 *
 * App 端 `plus.networkinfo.getCurrentType()` 本来就是同步的，直接用它；
 * 读不出来按 unknown 处理（放行，不做无限等待）。
 */
function netTypeSync() {
  // #ifdef APP-PLUS
  try {
    const P = plus.networkinfo;
    const t = P.getCurrentType();
    if (t === P.CONNECTION_WIFI || t === P.CONNECTION_ETHERNET) return 'wifi';
    if (t === P.CONNECTION_NONE) return 'none';
    if (t === P.CONNECTION_UNKNOW) return 'unknown';
    return 'cellular';                 // CELL2G / CELL3G / CELL4G / CELL5G
  } catch (e) {}
  // #endif
  return 'unknown';
}

/** 当前网络能不能下更新包（同步） */
export function network() {
  return canDownloadNetwork(netTypeSync());
}

/* ---------- 本地包还在不在 ---------- */

/**
 * 之前下好的包还在不在。
 *
 * 为什么非要验一遍：`uni.saveFile` 存的是持久路径，但用户清缓存 / 换机恢复 /
 * 系统回收都可能让它失效。不验就直接 install，拿到的是"安装失败"，
 * 而真正的问题是"那个文件已经没了" —— 走一遍补下载才是对的解法。
 */
function fileUsable(path) {
  return new Promise((resolve) => {
    if (!path) { resolve(false); return; }
    // #ifdef APP-PLUS
    try {
      plus.io.resolveLocalFileSystemURL(path, () => resolve(true), () => resolve(false));
      return;
    } catch (e) { resolve(false); return; }
    // #endif
    resolve(false);
  });
}

function persist(tempPath) {
  return new Promise((resolve) => {
    try {
      uni.saveFile({
        tempFilePath: tempPath,
        success: (r) => resolve((r && r.savedFilePath) || tempPath),
        fail: () => resolve(tempPath)
      });
    } catch (e) { resolve(tempPath); }
  });
}

/** 下载更新包。onProgress(0-100) */
export function download(url, onProgress) {
  return new Promise((resolve, reject) => {
    if (!url) { reject(new Error('更新包地址为空')); return; }
    const task = uni.downloadFile({
      url: url,
      timeout: DOWN_TIMEOUT,
      success: (res) => {
        if (!res || res.statusCode !== 200 || !res.tempFilePath) { reject(new Error('下载失败')); return; }
        // temp 路径可能被系统回收：先转成持久路径再装（官方建议，踩过）
        persist(res.tempFilePath).then(resolve, () => resolve(res.tempFilePath));
      },
      fail: (e) => reject(new Error((e && e.errMsg) || '下载失败'))
    });
    if (task && task.onProgressUpdate && onProgress) {
      task.onProgressUpdate((r) => {
        if (r && typeof r.progress === 'number') onProgress(r.progress);
      });
    }
  });
}

export function install(path) {
  return new Promise((resolve, reject) => {
    // #ifdef APP-PLUS
    try {
      plus.runtime.install(path, { force: true }, () => resolve(true),
        (e) => reject(new Error((e && e.message) || '安装失败')));
      return;
    } catch (err) { reject(err); return; }
    // #endif
    reject(new Error('当前运行环境不支持热更新'));
  });
}

/** 装完必须重启才生效 */
export function restart() {
  // #ifdef APP-PLUS
  try { plus.runtime.restart(); return true; } catch (e) {}
  // #endif
  return false;
}

/**
 * 下载 → 安装 → 重启。任何一步失败都抛出，由调用方引导"去下载完整包"。
 */
export async function applyUpdate(r, onProgress) {
  const rm = r.remote || {};
  // ① 已经下好了 → 直接装，不再走一遍流量
  if (rm.downloadPath && (await fileUsable(rm.downloadPath))) {
    if (onProgress) onProgress(100);
    await install(rm.downloadPath);
    restart();
    return true;
  }
  // ② 没下好 → 先看网络允不允许下
  const net = await network();
  if (!net.ok) {
    const msg = net.why === 'none'
      ? '当前没有联网，连上 Wi-Fi 后再更新'
      : '你现在用的是移动网络，为了不占流量，更新包只在 Wi-Fi 下下载';
    const e = new Error(msg);
    e.why = net.why;                     // 带标记：这条不走"更新失败→去下载整包"那条兜底
    throw e;
  }
  const path = await download(rm.url, onProgress);
  if (rm.code) markDownloaded(rm.code, path);   // 装不上又没重启时，下次还能直接命中
  await install(path);
  restart();
  return true;
}

/* ---------------- Wi-Fi 下先把包准备好 ---------------- */

/**
 * Wi-Fi 下把更新包先拉到本地，**不安装**。
 *
 * 为什么"静默下载"不等于"静默安装"：省掉的只是用户盯着进度条那几秒，
 * 装不装依然要他点头（弹窗在 askUpdate）。这两件事是分开的，缺一个都不成立。
 *
 * ⚠️ 只预下载热更包（state === 'update'）：整包本来就要带用户去浏览器下，
 *    后台偷偷拉个 20MB 的 APK 只会白占空间。
 * ⚠️ 非 Wi-Fi / 下载失败都静默返回 —— 纪律 1：用户没主动点更新，就没资格打扰他。
 */
export async function prefetch() {
  const p = await pending();
  if (!p || p.state !== 'update') return null;
  if (p.downloadPath && (await fileUsable(p.downloadPath))) return p;
  const net = await network();
  if (!net.ok) return null;              // 移动网络或没网：什么都不做，等 Wi-Fi 再说
  try {
    const path = await download(p.url);
    markDownloaded(p.code, path);
    return Object.assign({}, p, { downloadPath: path });
  } catch (e) {
    return null;                         // 预下载失败也静默（纪律 1）
  }
}

let wifiWatched = false;

/**
 * 连上 Wi-Fi 时自动补一次预下载。
 *
 * 为什么单独要它：自检是一天一次、手动检查要用户点 —— 都不是"刚连上 Wi-Fi"
 * 这个最该下包的时刻。挂在 launch 上一次就够（内部幂等）。
 */
export function watchWifi() {
  // #ifdef APP-PLUS
  if (wifiWatched) return false;
  wifiWatched = true;
  try {
    uni.onNetworkStatusChange((r) => {
      if (!r || !r.isConnected) return;
      const t = r.networkType;
      if (t === 'wifi' || t === 'ethernet') { try { prefetch() } catch (e) {} }
    });
    return true;
  } catch (e) { return false; }
  // #endif
  return false;
}

/* ---------------- 出口：去下载完整包 ---------------- */

/**
 * 打开 Release 页（完整包）。开不了浏览器就把链接复制到剪贴板 ——
 * 兜底的兜底：至少用户能自己粘到浏览器里。
 */
export function openRelease() {
  // #ifdef APP-PLUS
  try { plus.runtime.openURL(RELEASE_URL); return true; } catch (e) {}
  // #endif
  try {
    if (typeof window !== 'undefined' && window.open) {
      window.open(RELEASE_URL, '_blank');
      return true;
    }
  } catch (e) {}
  try {
    uni.setClipboardData({ data: RELEASE_URL });
    uni.showToast({ title: '已复制下载页链接，粘到浏览器打开', icon: 'none' });
  } catch (e) {}
  return false;
}

/**
 * 手动检查失败（连不上 / 版本信息读不出来）。
 * 放在这里而不是页面里：设置页不许直接调系统弹窗（check-dialog.js 守着，统一走
 * components/app-dialog），而这类"更新链路内部"的提示本来就归 updater 管。
 */
export function checkFailDialog(msg) {
  uni.showModal({
    title: '没查到版本信息',
    content: (msg || '连不上版本服务') + '。可以直接去下载完整安装包。',
    confirmText: '去下载',
    cancelText: '知道了',
    success: (res) => { if (res && res.confirm) openRelease(); }
  });
}

/** 更新失败时那个弹窗：说清出什么事了，并给出去整包的按钮 */
export function failDialog(msg) {
  uni.showModal({
    title: '更新没装上',
    content: (msg || '下载或安装失败了') + '。可以去下载完整安装包，装完数据都在。',
    confirmText: '去下载',
    cancelText: '知道了',
    success: (res) => { if (res && res.confirm) openRelease(); }
  });
}

/**
 * 网络不允许下载时的提示。
 *
 * ⚠️ **不许落到 failDialog**：那条路会劝用户"去下载完整包"，而整包 20MB，
 *    在移动网络下等于把他往同一个坑里再推一次。他的问题不是包坏了，
 *    是当下这个网络不能下 —— 所以出口只有"连上 Wi-Fi 再来"，不给下载按钮。
 */
export function netHint(why) {
  const noNet = why === 'none';
  uni.showModal({
    title: noNet ? '没有联网' : '请在 Wi-Fi 下更新',
    content: noNet
      ? '当前没有联网。连上 Wi-Fi 后回到这里，点一下就能更新。'
      : '你现在用的是移动网络。为了不占你的流量，更新包只在 Wi-Fi 下下载 —— 连上 Wi-Fi 后回到这里就行。',
    confirmText: '知道了',
    showCancel: false
  });
}

/* ---------------- 交互 ---------------- */

function toast(title) {
  try { uni.showToast({ title, icon: 'none', duration: 2200 }); } catch (e) {}
}

/**
 * 有更新时的确认弹窗：明示版本、大小、更新说明，用户确认后才装。
 *
 * 合规那条红线是**不许静默安装**：包可以在 Wi-Fi 下提前下好，但装不装必须他点头。
 * 下载和授权是两件事，弹窗要说的也就是这两件事。
 */
export function askUpdate(r) {
  showAsk(r, prepareAsk(r));
  return r;
}

/** 这个包的本地缓存路径 —— 可能是调用方带来的（pending），也可能要自己去 pending 里查 */
function cachedPath(rm) {
  try {
    const p = (settings.get().update || {}).pending;
    if (!p || !p.code || p.code !== (rm && rm.code)) return '';
    return p.downloadPath || '';
  } catch (e) { return ''; }
}

/**
 * 弹窗要说的两件事：① 包下好了没（决定按钮写「立即更新」还是「下载并安装」）；
 * ② 现在这个网络能不能下（决定要不要提前警告他"。
 *
 * 两个判定都必须是**同步**的：downloadPath 由 pending() 校验过（见那里），
 * 网络走 plus.networkinfo 的同步接口 —— 这样 askUpdate 的返回值还是 r，
 * 页面上一堆 `showResult(r)` 不用改成 await。
 */
function prepareAsk(r) {
  const rm = r.remote || {};
  const cached = !!((rm && rm.downloadPath) || cachedPath(rm));
  const net = cached ? null : network();
  return { cached: cached, why: net ? net.why : '' };
}

function showAsk(r, info) {
  const v = r.remote || {};
  const size = sizeText(v.size);
  const lines = [];
  lines.push('新版本 ' + v.version + (size ? '（' + size + '）' : ''));
  if (r.notes) lines.push('', r.notes);
  lines.push('');
  // 三种情况给的说法不一样：能不能当场装完，用户点之前就该知道
  if (info.cached) {
    lines.push('更新包已经下好了，点一下就装完，不用再下载。装完会自动重启一次，学习数据不受影响。');
  } else if (info.why === 'cellular') {
    lines.push('当前是移动网络。为了不占你的流量，更新包只在 Wi-Fi 下下载 —— 连上 Wi-Fi 回到这里就行。');
  } else if (info.why === 'none') {
    lines.push('当前没有联网，连上网络后回到这里就能更新。');
  } else {
    lines.push('需要下载更新包，建议在 Wi-Fi 下进行。装完会自动重启一次，学习数据不受影响。');
  }
  uni.showModal({
    title: '有新版本',
    content: lines.join('\n').slice(0, 480),
    confirmText: info.cached ? '立即更新' : '下载并安装',
    cancelText: '不再提示',
    success: (res) => {
      if (!res || !res.confirm) { markSkip(v.version); return; }
      runUpdate(r);
    }
  });
}

/** 带进度的安装流程（弹窗/loading 都在这里，页面不用各写一份） */
export function runUpdate(r) {
  const dlg = { last: -1 };
  try { uni.showLoading({ title: '正在准备更新', mask: true }); } catch (e) {}
  const tick = (p) => {
    const n = Math.max(0, Math.min(100, Math.round(p || 0)));
    if (n === dlg.last) return;
    dlg.last = n;
    try {
      uni.showLoading({ title: n < 100 ? ('下载更新 ' + n + '%') : '安装中…', mask: true });
    } catch (e) {}
  };
  return applyUpdate(r, tick).then(() => {
    try { uni.hideLoading(); } catch (e) {}
    return true;
  }).catch((e) => {
    try { uni.hideLoading(); } catch (e) {}
    const why = e && e.why;
    // 网络不让下 ≠ 包坏了：这时给"去下载完整包"是害他（整包更大，一样吃流量）
    if (why === 'cellular' || why === 'none') { netHint(why); return false; }
    failDialog((e && e.message) || '');
    return false;
  });
}

/** 手动检查的结果展示（设置页用） */
export function showResult(r) {
  if (!r) { toast('没查到版本信息'); return r; }
  if (r.state === 'latest') { toast('已经是最新版 ' + r.local.name); return r; }
  if (r.state === 'update') { askUpdate(r); return r; }
  if (r.state === 'native') { askFull(r); return r; }
  if (r.state === 'apk') { askFull(r); return r; }
  if (r.state === 'none') {
    // 一个包都没认出来（Release 里常挂着一个**占位**用的 APK —— 云打包直接产出的
    // `__UNI__53285BF__时间戳.apk`，名字里没有版本号，我们判断不出它新不新）。
    // 这种情况**不给下载入口**：拿猜的去让人装一个来路不明的包，比不说更糟。
    toast('版本页里没有可用的更新包');
    return r;
  }
  toast('已经是最新版 ' + r.local.name);
  return r;
}

/** 基座太老（或远端只有整包）：只能整包 */
function askFull(r) {
  uni.showModal({
    title: '需要更新到完整包',
    content: '新版本 ' + (r.remote && r.remote.version ? r.remote.version : '') +
      ' 要更新的原生基座，热更新装不了。下载完整安装包覆盖安装即可，数据都在。',
    confirmText: '去下载',
    cancelText: '不再提示',
    success: (res) => {
      if (!res) return;
      if (res.confirm) openRelease();
      else markSkip(r.remote && r.remote.version);
    }
  });
}

/** 设置页开关：启动时自动检查 */
export function autoEnabled() {
  try {
    const u = settings.get().update || {};
    return u.auto !== false;
  } catch (e) { return true; }
}

export function setAuto(on) {
  try { settings.set({ update: { auto: !!on } }); } catch (e) {}
  return autoEnabled();
}
