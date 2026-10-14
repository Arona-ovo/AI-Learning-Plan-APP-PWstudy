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
      // 远端声明的大小 —— 校验第 ① 层就靠它。GitHub 的 assets[].size 是准的，
      // 断了/被截断的包在这一层就被拦下，不用把坏包装进去才知道
      size: (a && a.size) || 0,
      // 同名 `.sha256` 摘要文件（发布者可选挂的），没有就是 '' → 跳过摘要那一层
      digestUrl: digestUrlOf(rel, a && a.name)
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
    // 基座太老：wgt 里改不了原生，装上去只会白屏 —— 必须整包。
    // Release 里挂了整包的话把它挑出来（这样整包也能提前下好，用户点一下就装）；
    // 没挂就还是那个 wgt —— packageOf 会因为"不是真 APK"返回 null，
    // 于是既不下载也不安装，走浏览器那条老路。绝不许把 wgt 装到老基座上。
    if (remote.minNative && local.nativeCode && local.nativeCode < remote.minNative) {
      const apk = pickApk(rel);
      return { state: 'native', local, remote: apk || remote, notes };
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
const EMPTY_PENDING = { version: '', code: 0, minNative: 0, url: '', size: 0, notes: '', state: '', downloadPath: '', digestUrl: '' };

/** 记一笔"有个新版本等着装" */
function savePending(r) {
  try {
    const v = r.remote || {};
    // 同一个版本之前已经下好了，别把它丢掉 —— 重查一次就把几百 KB 作废太浪费。
    // 路径的权威来源是**下载任务**（dl），pending 里这只是个影子，方便弹窗直接读。
    const old = (settings.get().update || {}).pending || {};
    const d = dlGet();
    let keep = '';
    if (old.code && old.code === (v.code || 0)) {
      keep = (d && d.code === (v.code || 0) && d.state === 'done' && d.path)
        ? d.path : (old.downloadPath || '');
    }
    settings.set({
      update: {
        pending: {
          version: v.version || '', code: v.code || 0, minNative: v.minNative || 0,
          url: v.url || '', size: v.size || 0, notes: r.notes || '', state: r.state || '',
          digestUrl: v.digestUrl || '',
          downloadPath: keep
        }
      }
    });
  } catch (e) {}
}

export function clearPending() {
  try { settings.set({ update: { pending: EMPTY_PENDING } }); } catch (e) {}
}

/**
 * 把 check 的结果（或记下的 pending）翻译成一个"要下的包" —— APK/WGT 共用同一份。
 *
 * ⚠️ kind 由**文件后缀**定，不由 state 定：state 说的是"该走哪条 UI 路径"
 *    （装资源包还是装整包），而 `native` 那条路上 remote 可能仍然是 wgt
 *    （Release 里没挂整包）。拿 state 猜后缀，就会把 wgt 当 APK 下下来装 ——
 *    老基座装上新资源包 = 白屏，这是第 3 条纪律，不能破。
 */
function packageOf(r) {
  const rm = (r && r.remote) || r || {};
  const st = (r && r.state) || rm.state || '';
  if (!rm.code || !rm.url) return null;
  const isApk = /\.apk(\?|$)/i.test(String(rm.url));
  // 基座太老 / 只有整包：必须是**真的 APK**才有的下。没有 → 返回 null，
  // 让调用方走"去浏览器下载"那条路，别偷偷下个 wgt 装上去。
  if ((st === 'native' || st === 'apk') && !isApk) return null;
  return {
    kind: isApk ? 'apk' : 'wgt', version: rm.version || '', code: rm.code, url: rm.url,
    size: rm.size || 0, digestUrl: rm.digestUrl || '', sha256: rm.sha256 || ''
  };
}

/** 记下的待更新信息 —— 不管本地包下好没下好，下载链路读它 */
function storedPending() {
  return localVersion().then((local) => {
    let p = null;
    try { p = (settings.get().update || {}).pending; } catch (e) {}
    if (!p || !p.version || !p.code) return null;
    // 本机已经不比它旧 = 装过了 → 顺手清掉。这就是红点"自动消失"的全部机制，
    // 不需要额外记"看过了"。
    if (local && local.code >= p.code) { clearPending(); return null; }
    return Object.assign({}, p, { local: local });
  }).catch(() => null);
}

/**
 * 当前等着装的更新（没有则 null）—— **红点和弹窗都只看它**。
 *
 * ★ 关键判据：光"远端有新版本"不算数，必须**本地已经有一份校验通过的包**。
 *   下载是静默做的，没准备好之前连红点都不亮 —— 红点的语义是"点一下就能装完"，
 *   不是"有个新版本你装不上"。
 *
 * 本机版本比对那条（装完就自动消失）见 storedPending。
 */
export function pending() {
  return storedPending().then(async (p) => {
    if (!p) return null;
    const item = packageOf(p);
    if (!item) return null;
    const path = await readyLocal(item);
    if (!path) return null;              // 没下好 / 校验没过 → 不亮、不弹
    return Object.assign({}, p, { downloadPath: path, ready: true });
  }).catch(() => null);
}

/**
 * 本地有没有这个包的**完整可用**副本（只判定，不下网）。
 * 判据：任务记的 code/kind/url 全对得上 + state 是 done + 文件还在 + 重新校验通过。
 * （url 也要比：发布者重传过同名包的话，内容已经换了，旧的不能再复用。）
 */
async function readyLocal(item) {
  const d = dlGet();
  if (!d || !d.path || d.state !== 'done') return '';
  if (d.code !== item.code || d.kind !== item.kind) return '';
  if (d.url && item.url && d.url !== item.url) return '';
  if (!(await fileUsable(d.path))) { dlSet({ path: '', state: '' }); return ''; }
  const v = await verifyFile(d.path, item);
  if (!v.ok) {
    // 记着的是"下好了"，实际已经不对了（清缓存改过 / 上次写坏了）→ 删掉重来。
    // 别拿坏包去装：装失败弹的是系统那句"解析包错误"，用户根本不知道该干什么。
    await removeFile(d.path);
    dlSet({ path: '', state: 'failed', tries: (d.tries || 0) + 1 });
    return '';
  }
  return d.path;
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

/* ---------- 网络 ---------- */

const CELLULAR = ['2g', '3g', '4g', '5g', 'cellular'];

/**
 * 这个网络能不能用来下更新包。
 *
 * **只有完全没网才拦** —— Wi-Fi 和移动数据都放行。更新是后台静默做的，
 * 用户看不见进度也看不见提示，所以"什么时候下"不该由网络类型来替他决定；
 * 真正会打扰他的东西（红点、弹窗）要等包在本地校验通过之后才出现，
 * 那时候下载早结束了。
 *
 * ⚠️ unknown 必须放行：部分机型 / 模拟器 / 没给网络权限时会返回 unknown，
 *   一拦就等于把更新永久锁死。
 *
 * @param {string} type 'wifi' | 'cellular' | 'none' | 'unknown'
 */
export function canDownloadNetwork(type) {
  if (type === 'none') return { ok: false, type: 'none', why: 'none' };
  if (type === 'wifi' || type === 'ethernet' || type === 'wired') return { ok: true, type: type, why: '' };
  if (type === 'cellular' || CELLULAR.indexOf(type) >= 0) return { ok: true, type: type, why: 'cellular' };
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

/** 本地文件的大小。不在 / 读不出来都算"不能用"（size -1） */
function fileStat(p) {
  return new Promise((resolve) => {
    if (!p) { resolve({ ok: false, size: -1 }); return; }
    try {
      uni.getFileSystemManager().getFileInfo({
        filePath: p,
        success: (r) => resolve({ ok: true, size: Number(r && r.size) || 0 }),
        fail: () => resolve({ ok: false, size: -1 })
      });
      return;
    } catch (e) {}
    resolve({ ok: false, size: -1 });
  });
}

/**
 * 读文件中间一段字节（校验要用）。
 * 为什么不全量读：整包 20MB，只为了看开头 4 个字节读进来太蠢。
 */
function readBytes(p, offset, len) {
  return new Promise((resolve) => {
    if (!p || len <= 0) { resolve(null); return; }
    try {
      uni.getFileSystemManager().readFile({
        filePath: p, position: offset, length: len,
        success: (r) => {
          const d = r && r.data;
          if (!d) { resolve(null); return; }
          if (typeof d === 'string') { resolve(strBytes(d)); return; }
          try { resolve(new Uint8Array(d)); } catch (e) { resolve(null); }
        },
        fail: () => resolve(null)
      });
      return;
    } catch (e) {}
    resolve(null);
  });
}

/** 个别端把二进制给成 latin1 字符串，转回字节 */
function strBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** 删一个本地文件（下新包之前清旧的、校验失败清残缺的，都靠它） */
function removeFile(p) {
  return new Promise((resolve) => {
    if (!p) { resolve(false); return; }
    // #ifdef APP-PLUS
    try {
      plus.io.resolveLocalFileSystemURL(p, (e) => {
        try { e.remove(() => resolve(true), () => resolve(false)); }
        catch (err) { resolve(false); }
      }, () => resolve(false));
      return;
    } catch (err) {}
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

/* ---------------- 完整性校验 ---------------- */

/**
 * 超过这个体积就不在本地算摘要了 —— 整包 20MB 读进内存再逐字节滚一遍，
 * 换来的只是"跟远端对上了"，不值。交给下面的第 ② 层和系统安装时的验签。
 */
const SHA256_MAX = 8 * 1024 * 1024;

const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function ror(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
function hex8(n) { const s = (n >>> 0).toString(16); return ('00000000' + s).slice(-8); }

/** 纯 JS sha256（只为校验更新包，不碰业务数据） */
export function sha256Hex(bytes) {
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const n = bytes.length;
  const blocks = (((n + 8) / 64) | 0) + 1;      // 末尾 8 字节存长度，另外至少 1 字节填充
  const buf = new Uint8Array(blocks * 64);
  buf.set(bytes, 0);
  buf[n] = 0x80;
  const bits = n * 8;
  const hi = Math.floor(bits / 4294967296), lo = bits % 4294967296;
  const e = blocks * 64;
  buf[e - 8] = (hi >>> 24) & 0xff; buf[e - 7] = (hi >>> 16) & 0xff;
  buf[e - 6] = (hi >>> 8) & 0xff;  buf[e - 5] = hi & 0xff;
  buf[e - 4] = (lo >>> 24) & 0xff; buf[e - 3] = (lo >>> 16) & 0xff;
  buf[e - 2] = (lo >>> 8) & 0xff;  buf[e - 1] = lo & 0xff;
  const w = new Uint32Array(64);
  for (let b = 0; b < blocks; b++) {
    const o = b * 64;
    for (let i = 0; i < 16; i++) {
      w[i] = ((buf[o + i * 4] << 24) | (buf[o + i * 4 + 1] << 16) |
              (buf[o + i * 4 + 2] << 8) | buf[o + i * 4 + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ror(x, 7) ^ ror(x, 18) ^ (x >>> 3);
      const s1 = ror(y, 17) ^ ror(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b1 = H[1], c = H[2], d = H[3], f1 = H[4], g1 = H[5], h1 = H[6], i1 = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ror(f1, 6) ^ ror(f1, 11) ^ ror(f1, 25);
      const ch = ((f1 & g1) ^ (~f1 & h1)) >>> 0;
      const t1 = (i1 + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
      const maj = ((a & b1) ^ (a & c) ^ (b1 & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      i1 = h1; h1 = g1; g1 = f1; f1 = (d + t1) >>> 0;
      d = c; c = b1; b1 = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b1) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + f1) >>> 0; H[5] = (H[5] + g1) >>> 0;
    H[6] = (H[6] + h1) >>> 0; H[7] = (H[7] + i1) >>> 0;
  }
  return H.map(hex8).join('');
}

/** 摘要文本 → 纯 hex（兼容 `hash  filename` 和带引号的写法） */
function normHex(s) {
  const m = /[0-9a-fA-F]{64}/.exec(String(s || ''));
  return m ? m[0].toLowerCase() : '';
}

/** zip 的结尾标记 EOCD（PK\x05\x06）。尾巴可能带注释，所以在整段里找 */
function hasEocd(b) {
  for (let i = 0; i + 3 < b.length; i++) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) return true;
  }
  return false;
}

/**
 * 校验本地包完不完整。三层，从便宜到贵，过了才算"能用"：
 *
 *   ① 大小  —— 跟远端 assets[].size 对。断了、被代理截断的，这一层就拦住。
 *   ② 结构  —— zip 的开头 PK\x03\x04 + 结尾的 EOCD。wgt 和 apk 都是 zip，
 *              所以两条路径共用这一层。专治"大小刚好对但内容是半个包"
 *              （缓存服务偶尔会回一个截短的 200）。
 *   ③ 摘要  —— Release 里挂了同名 `.sha256` 才算；没挂就跳过，不因为没摘要判失败。
 *
 * **APK 的签名不在这里验**：plus.runtime.install 装 APK 时，Android 的
 * PackageInstaller 必然验签，签不对根本装不上，弹的是系统自己的"解析包错误"。
 * 我们要做的是别拿残缺包去触发它 —— 也就是上面三层。
 *
 * @returns {Promise<{ok:boolean, why:string, size:number, want?:number}>}
 *   why: 'gone' 不在 | 'size' 大小不对 | 'format' 不是 zip | 'truncated' 被截断
 *        | 'sha256' 摘要对不上 | 'read' 读不出来
 */
export async function verifyFile(p, item) {
  const st = await fileStat(p);
  if (!st.ok || st.size <= 0) return { ok: false, why: 'gone', size: st.size };
  const want = Number(item && item.size) || 0;
  if (want > 0 && st.size !== want) return { ok: false, why: 'size', size: st.size, want: want };
  const head = await readBytes(p, 0, 4);
  if (!head || head.length < 4 ||
      !(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) {
    return { ok: false, why: 'format', size: st.size };
  }
  const tail = await readBytes(p, Math.max(0, st.size - 22), 22);
  if (!tail || !hasEocd(tail)) return { ok: false, why: 'truncated', size: st.size };
  const want256 = normHex(item && item.sha256);
  if (want256 && st.size <= SHA256_MAX) {
    const buf = await readBytes(p, 0, st.size);
    if (!buf || buf.length !== st.size) return { ok: false, why: 'read', size: st.size };
    if (sha256Hex(buf) !== want256) return { ok: false, why: 'sha256', size: st.size };
  }
  return { ok: true, why: '', size: st.size };
}

/* ---------------- 下载任务：全局单一实例 + 持久化 + 校准 ---------------- */

/** 下载状态记在哪：见 settings.js 的 update.dl（跟 pending 分开存，别互相冲掉） */
function dlGet() {
  try { return (settings.get().update || {}).dl || null; } catch (e) { return null; }
}

function dlSet(patch) {
  try {
    const cur = dlGet() || {};
    settings.set({ update: { dl: Object.assign({}, cur, patch) } });
  } catch (e) {}
}

const EMPTY_DL = { code: 0, kind: '', version: '', url: '', size: 0, path: '', state: '', tries: 0, startedAt: 0 };

function dlReset() {
  try { settings.set({ update: { dl: EMPTY_DL } }); } catch (e) {}
}

/** 内存里的"正在下"—— 单实例的第一道闸（第二道是持久化的 state） */
let inflight = null;

/** 远端挂的摘要文件（`<资产名>.sha256`），没有就返回 '' */
export function digestUrlOf(rel, assetName) {
  const want = String(assetName || '') + '.sha256';
  const list = (rel && rel.assets) || [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a && a.name === want && a.browser_download_url) return a.browser_download_url;
  }
  return '';
}

/** 拉摘要文件的文本 → hex 串。拿不到就 ''（没摘要不算失败） */
function fetchDigest(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(''); return; }
    try {
      uni.request({
        url: url, method: 'GET', timeout: CHECK_TIMEOUT,
        success: (res) => resolve(normHex((res && res.data) || '')),
        fail: () => resolve('')
      });
    } catch (e) { resolve(''); }
  });
}

/**
 * 本地有没有这个包的**完整可用**副本。有就直接复用，一次网都不上。
 * 判据：记下的 code/kind/url 全都对得上 + 文件还在 + 重新校验通过。
 * （url 也要比：发布者重传过同名包的话，文件内容已经换了。）
 */
async function reuseIfReady(item) {
  const path = await readyLocal(item);   // 跟红点判据同一份逻辑，别两边各写一套
  return path ? Object.assign({}, item, { path: path }) : null;
}

/**
 * 下新包之前清场。
 *
 * 两件事：① 上次那个**别的版本**的包已经没用了，删掉（不然 _doc 里会堆一串
 * 历史 APK）；② 同一个版本停在 `downloading` —— 说明上次进程被杀了，
 * 留下的是个残缺包，不可信，删掉重新下（这就是"进程重启后重新校准"）。
 */
async function cleanStale(item) {
  const d = dlGet();
  if (!d || !d.code) return;
  const same = d.code === item.code && d.kind === item.kind;
  const stale = !same || (d.url && item.url && d.url !== item.url) || d.state === 'downloading';
  if (stale && d.path) await removeFile(d.path);
  if (stale) dlSet({ path: '', state: '' });
}

/**
 * 保证本地有一份完整可用的包 —— **APK 与 WGT 两条路径共用这一套**。
 *
 * 三道闸：
 *   ① 单实例：同一个包正在下就直接复用那个 Promise，绝不开第二路；
 *      换目标了才把旧的作废（旧的结果不再被采用，但也拦不住它写完文件 ——
 *      真写完也会被下一次 cleanStale 当旧包清掉）。
 *   ② 去重：本地已经有一份**校验通过**的同版本包 → 直接返回，一次网都不上。
 *   ③ 校准：下之前先清场（旧包 / 残缺包），下完再校验，过了才落 state='done'。
 *
 * ⚠️ 全程静默：不弹窗、不 toast、不红点。失败一律返回 null，
 *    由"包没准备好 → 不提示"这条规则自然消化掉。
 *
 * @param {{kind:string, version:string, code:number, url:string, size:number, sha256?:string, digestUrl?:string}} item
 * @returns {Promise<null|object>} 拿到的是 { ...item, path }
 */
export function ensurePackage(item, onProgress) {
  const it = item || {};
  if (!it.url || !it.code) return Promise.resolve(null);
  const key = it.code + '|' + (it.kind || '') + '|' + it.url;
  if (inflight && inflight.key === key) return inflight.promise;   // ① 同一个包：复用
  inflight = null;                                                 // 换目标：旧的作废
  const clear = () => { if (inflight && inflight.key === key) inflight = null; };
  const p = runEnsure(it, onProgress).then((r) => { clear(); return r; },
                                           (e) => { clear(); throw e; });
  inflight = { key: key, promise: p };
  return p;
}

async function runEnsure(item, onProgress) {
  // ② 本地已有完整副本 → 复用
  const ready = await reuseIfReady(item);
  if (ready) return ready;
  // ③ 下之前先清场
  await cleanStale(item);
  const net = network();
  if (!net.ok) return null;                       // 没网：静默，等下次
  let sha = normHex(item.sha256);
  if (!sha && item.digestUrl) sha = await fetchDigest(item.digestUrl);
  dlSet({
    code: item.code, kind: item.kind || '', version: item.version || '',
    url: item.url, size: item.size || 0, sha256: sha,
    state: 'downloading', path: '', startedAt: Date.now()
  });
  let path = '';
  try {
    path = await download(item.url, onProgress);
  } catch (e) {
    const d = dlGet() || {};
    dlSet({ state: 'failed', path: '', tries: (d.tries || 0) + 1 });
    return null;
  }
  const v = await verifyFile(path, Object.assign({}, item, { sha256: sha }));
  if (!v.ok) {
    // 残缺/损坏 → 删掉，不留着占地方，也不让它有机会被当成"已下好"
    await removeFile(path);
    const d = dlGet() || {};
    dlSet({ state: 'failed', path: '', tries: (d.tries || 0) + 1 });
    return null;
  }
  dlSet({ state: 'done', path: path, size: v.size, tries: 0 });
  return Object.assign({}, item, { path: path, sha256: sha, size: v.size });
}

/**
 * 把更新包准备好 → 安装 → 重启。**APK 与 WGT 走的是同一条路**（ensurePackage）。
 *
 * 已经下好就直接装（一次网都不上）；没下好就当场下（用户点了确认，这时走流量
 * 是他自己的意思）。任何一步失败都抛出，由调用方引导"去下载完整包"。
 */
export async function applyUpdate(r, onProgress) {
  const item = packageOf(r);
  if (!item) { throw new Error('没有可用的更新包'); }
  const got = await ensurePackage(item, onProgress);
  if (!got) {
    // 静默下载那一路失败是**不吭声**的（纪律 1）；但这里是用户点了「立即更新」，
    // 点了没反应比报错更糟，所以给一句话，并且区分"没网"和"包没准备好"
    const net = network();
    const e = new Error(net.ok ? '更新包还没准备好，稍后再试一次' : '当前没有联网，连上网络后再更新');
    e.why = net.ok ? '' : (net.why || 'none');
    throw e;
  }
  if (onProgress) onProgress(100);
  await install(got.path);
  // wgt 不重启不生效；APK 是**系统安装器**接管的，这时候重启会把它打断，
  // 用户看到的是"安装被取消"，比不重启糟得多
  if (got.kind === 'wgt') restart();
  return true;
}

/* ---------------- 后台静默地把包准备好 ---------------- */

/**
 * 把更新包先拉到本地、**校验通过**放好，**不安装**。
 *
 * 为什么"静默下载"不等于"静默安装"：省掉的只是用户盯着进度条那几秒和那一下
 * 加载，装不装依然要他点头（弹窗在 askUpdate）。这两件事分开，缺一个都不成立。
 *
 * 全程不弹窗、不 toast、不红点 —— 没下好就当没这事，下次再校准。
 * wgt 和 apk 都下：整包虽然大，但"用户点更新时要等 20MB"比"提前占着 20MB"
 * 难受得多，空间换时间，装完就清。
 */
export async function prefetch() {
  const p = await storedPending();
  if (!p) return null;
  const item = packageOf(p);
  if (!item) return null;
  const got = await ensurePackage(item);
  // 没准备好就返回 null —— 调用方（红点 / 弹窗）照"没有可装的"处理，一声不吭
  if (!got) return null;
  return Object.assign({}, p, { downloadPath: got.path, ready: true });
}

let netWatched = false;

/**
 * 网络一通就补一次准备动作。
 *
 * 为什么单独要它：自检一天一次、手动检查要用户点 —— 都不是"刚连上网"这个
 * 最该下包的时刻。挂在 launch 上一次就够（内部幂等）。
 * 蜂窝网也触发：现在的规矩是两种网都能下，断网重连当然也算。
 */
export function watchNetwork() {
  // #ifdef APP-PLUS
  if (netWatched) return false;
  netWatched = true;
  try {
    uni.onNetworkStatusChange((r) => {
      if (!r || !r.isConnected) return;
      try { prefetch() } catch (e) {}
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
 * 没网时的提示（现在只有这一种网络拦法：蜂窝网也能下，见 canDownloadNetwork）。
 *
 * ⚠️ **不许落到 failDialog**：那条路会劝用户"去下载完整包"，而他的问题不是包坏了，
 *    是当下连不上网 —— 给他一个下载按钮，点下去还是失败，只会更莫名其妙。
 */
export function netHint() {
  uni.showModal({
    title: '没有联网',
    content: '当前没有联网。连上网络后回到这里，点一下就能更新。',
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

/** 这个包本地有没有已校验通过的副本 —— 同步读下载任务（弹窗文案要用，不能异步） */
function cachedPath(rm) {
  try {
    const d = dlGet();
    if (!d || !d.code || d.code !== (rm && rm.code) || d.state !== 'done') return '';
    return d.path || '';
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
    // 没网 ≠ 包坏了：这时给"去下载完整包"是害他（点下去一样下不动）
    if (why === 'none') { netHint(); return false; }
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

/**
 * 基座太老（或远端只有整包）：只能整包。
 *
 * 整包走的是**同一套**静默下载 + 校准，所以也可能已经下好了 —— 那就别再让人
 * 去浏览器等 20MB，直接装本地那份（装 APK 是系统安装器接管，见 applyUpdate）。
 * 没下好才带他去 Release 页。
 */
export function askFull(r) {
  const v = (r.remote && r.remote.version) || '';
  const cached = !!cachedPath(r.remote);
  uni.showModal({
    title: '需要更新到完整包',
    content: '新版本 ' + v + ' 要更新的原生基座，热更新装不了。' +
      (cached ? '安装包已经下好了，点一下转到系统安装界面就行，数据都在。'
              : '下载完整安装包覆盖安装即可，数据都在。'),
    confirmText: cached ? '立即安装' : '去下载',
    cancelText: '不再提示',
    success: (res) => {
      if (!res) return;
      if (!res.confirm) { markSkip(v); return; }
      if (cached) runUpdate(r);          // 装不动会兜底回"去下载整包"
      else openRelease();
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
