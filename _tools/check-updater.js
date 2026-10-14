// _tools/check-updater.js - wgt 热更新（启动自检 → 比对 → 下载 → 安装 → 重启）校验
// 运行：node _tools/check-updater.js
//
// 守的是六件事：
//  1) 版本能比出新旧（'1.10' > '1.9' 这种字符串比较会翻车的地方）
//  2) 资产名的约定**两头一致** —— 发布脚本打出来的名字，客户端必须认得出来
//     （这是最容易悄悄断掉的一环：改了脚本没改解析，发出去的包没人认领）
//  3) 基座太老**绝不装 wgt**（老基座装新资源包 = 白屏，只能引导整包）
//  4) 启动自检失败必须静默、一天只查一次；用户手动点才允许报错
//  5) 每一步失败都有"去下载完整包"的出口，不能卡在"更新失败"上
//  6) **更新包只在 Wi-Fi 下走流量**：Wi-Fi 提前把包备好（不装），用户点头就能
//     立刻装完；蜂窝网络一律不下、且不许把他推去下 20MB 整包（那也一样吃流量）。
//
// plus / uni 全是假替身：这里是 node，装不了真包。
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const T = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const { load } = require('./lib/load.js');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
function eq(a, b, label) {
  const s1 = JSON.stringify(a), s2 = JSON.stringify(b);
  if (s1 === s2) ok(label + ' = ' + s2);
  else bad(label + ' 期望 ' + s2 + '，实际 ' + s1);
}

/* ---------------- mock ---------------- */
const kv = {};
const net = { release: null, reqFail: false, dlFail: false };
const log = { modal: [], toast: [], loading: [], clip: [], downloaded: [], installed: [], restarted: 0, opened: [] };
let modalAnswer = { confirm: true };

global.uni = {
  getStorageSync: (k) => (k in kv ? kv[k] : ''),
  setStorageSync: (k, v) => { kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; },
  showToast: (o) => log.toast.push(o),
  showLoading: (o) => log.loading.push(o),
  hideLoading: () => {},
  setClipboardData: (o) => log.clip.push(o),
  showModal: (o) => { log.modal.push(o); if (o && o.success) o.success(modalAnswer); },
  request: (o) => {
    net.reqCount = (net.reqCount || 0) + 1;
    if (net.reqFail) { o.fail({ errMsg: 'request:fail' }); return; }
    o.success({ statusCode: 200, data: net.release });
  },
  downloadFile: (o) => {
    log.downloaded.push(o && o.url);
    if (net.dlFail) { o.fail({ errMsg: 'download:fail' }); return; }
    o.success({ statusCode: 200, tempFilePath: '/tmp/x.wgt' });
    return { onProgressUpdate: (cb) => { cb({ progress: 42 }); cb({ progress: 100 }); } };
  },
  saveFile: (o) => { (o && o.success ? o.success({ savedFilePath: '/doc/x.wgt' }) : null); },
  getNetworkType: (o) => { o && o.success && o.success({ networkType: typeof net.type === 'string' ? net.type : 'wifi' }); },
  onNetworkStatusChange: (cb) => { (net.watchers = net.watchers || []).push(cb); }
};

// App 端那几个原生调用。versionCode 可以随时改，用来造"基座太老"的场景
const plus = {
  __net: 'wifi',        // 'wifi' | '4g' | 'none' | 'unknown' | 'ethernet'
  __fileGone: false,    // true = 之前下好的本地包已经不在了（被清缓存 / 系统回收）
  runtime: {
    appid: '__UNI__53285BF',
    version: '1.0.1',
    getProperty: (id, cb) => cb({ version: plus.runtime.version, versionName: plus.runtime.version, versionCode: plus.runtime.versionCode }),
    versionCode: 101,
    install(p, opt, onOk, onErr) {
      log.installed.push(p);
      if (plus.__installFail) onErr({ message: '安装失败' });
      else onOk();
    },
    restart() { log.restarted++; },
    openURL(u) { log.opened.push(u); }
  },
  // 本地文件在不在 —— 只有一个用途：验"之前下好的包还在不在"
  io: {
    resolveLocalFileSystemURL(p, onOk, onErr) {
      if (plus.__fileGone) { onErr({ code: 1 }); return; }
      onOk({});
    }
  },
  networkinfo: (() => {
    const C = {
      CONNECTION_UNKNOW: 0, CONNECTION_NONE: 1, CONNECTION_ETHERNET: 2,
      CONNECTION_WIFI: 3, CONNECTION_CELL2G: 4, CONNECTION_CELL3G: 5,
      CONNECTION_CELL4G: 6, CONNECTION_CELL5G: 7
    };
    const map = { unknown: 0, none: 1, ethernet: 2, wifi: 3, '2g': 4, '3g': 5, '4g': 6, '5g': 7 };
    return Object.assign({}, C, {
      getCurrentType() { return map[plus.__net] === undefined ? C.CONNECTION_WIFI : map[plus.__net]; }
    });
  })()
};

const settings = load('utils/settings.js');
const BI = load('data/build-info.js');
const updater = load('utils/updater.js', { settings, BUILD_INFO: BI.BUILD_INFO, plus });

/** 造一个 GitHub Release */
function release(assets, body) {
  return {
    tag_name: 'PWstudy',
    name: 'PWstudy',
    body: body || '',
    assets: (assets || []).map(a => (typeof a === 'string'
      ? { name: a, browser_download_url: 'https://dl/' + a, size: 300000 }
      : a))
  };
}

/* ---------- 1. 版本 ---------- */
console.log('== 1. 版本解析与比较 ==');
eq(updater.parseVersion('1.0.1'), { name: '1.0.1', code: 10001 }, "parseVersion('1.0.1')");
eq(updater.parseVersion('1.0 Beta'), { name: '1.0 Beta', code: 10000 }, "parseVersion('1.0 Beta')（带字母也能比）");
eq(updater.parseVersion('2.10.3'), { name: '2.10.3', code: 21003 }, "parseVersion('2.10.3')");
eq(updater.parseVersion('').code, 0, '空串 = 认不出来');
assert(updater.parseVersion('1.10').code > updater.parseVersion('1.9').code,
  '1.10 比 1.9 新（比字符串的话这里就反了）');
assert(updater.parseVersion('1.0.1').code > updater.parseVersion('1.0').code, '1.0.1 比 1.0 新');

/* ---------- 2. 资产名：脚本打出来的，客户端要认得 ---------- */
console.log('== 2. 资产名约定（发布脚本 ↔ 客户端） ==');
eq(updater.parseAssetName('PWstudy-1.0.1-n101.wgt'), { version: '1.0.1', code: 10001, minNative: 101 },
  "parseAssetName('PWstudy-1.0.1-n101.wgt')");
eq(updater.parseAssetName('PWstudy-1.0.1.wgt').minNative, 0, '不带 n 段 = 不挑基座');
eq(updater.parseAssetName('PWstudy-2.0.0-n102.wgt').code, 20000, '版本号照常解析');
eq(updater.parseAssetName('__UNI__53285BF.wgt'), null, 'HBuilder 默认名不是我们的包 → 认不出来');
eq(updater.parseAssetName('PWstudy.apk'), null, 'APK 不走热更新');
eq(updater.parseAssetName('别的-1.0.1.wgt'), null, '前缀不对不认');
// 整包也要挑名字：Release 里常挂着云打包直接产出的默认名（只有时间戳）当占位
eq(updater.parseApkName('__UNI__53285BF__20261011204240.apk'), null,
  '云打包默认名的 APK（占位用）不认 —— 名字里没有版本号，判断不出新旧');
eq(updater.parseApkName('PWstudy-1.2.0.apk').code, 10200, "parseApkName('PWstudy-1.2.0.apk')");
eq(updater.parseApkName('PWstudy-1.0.1-n101.wgt'), null, 'wgt 不算整包');
eq(updater.parseApkName('app-release.apk'), null, '随便一个 APK 也不认');
// 两头对齐：脚本生成用的模板串，必须能被客户端这条正则解析出来
const pub = T('publish-wgt.js');
assert(/'PWstudy-' \+ ver \+ '-n' \+ nativeCode \+ '\.wgt'/.test(pub),
  '发布脚本按 PWstudy-<版本>-n<基线>.wgt 命名');
const sample = 'PWstudy-1.2.3-n101.wgt';
assert(updater.parseAssetName(sample) && updater.parseAssetName(sample).code === 10203,
  '脚本造出来的样例名，客户端解析得出来（' + sample + '）');

/* ---------- 3. 比对 ---------- */
console.log('== 3. 比对结果 ==');
function main() {
  const steps = [];
  const run = () => steps.reduce((p, f) => p.then(f), Promise.resolve());

  steps.push(() => {
    net.release = release(['PWstudy-1.0.1-n101.wgt']);
    plus.runtime.version = '1.0.1';
    plus.runtime.versionCode = 101;
    return updater.check().then(r => eq(r.state, 'latest', '版本相同 → 已是最新'));
  });

  steps.push(() => {
    net.release = release(['PWstudy-1.0.2-n101.wgt'], '修了收工页的错别字');
    return updater.check().then(r => {
      eq(r.state, 'update', '有新版本 → 可热更');
      eq(r.remote.version, '1.0.2', '远端版本');
      assert(/修了收工页的错别字/.test(r.notes || ''), '更新说明带上了（' + (r.notes || '') + '）');
      assert(r.remote.size > 0 && !!r.remote.url, '带了下载地址与大小');
    });
  });

  // 基座太老：这是安全红线，装上去会白屏
  steps.push(() => {
    net.release = release(['PWstudy-1.0.2-n999.wgt']);
    log.installed.length = 0;
    return updater.check().then(r => {
      eq(r.state, 'native', '基座太老 → 只能整包（绝不装 wgt）');
      eq(log.installed.length, 0, '没有去装');
    });
  });

  // 整包：只有按 `PWstudy-<版本>.apk` 命名的才算，占位的默认名一律不认
  steps.push(() => {
    net.release = release(['__UNI__53285BF__20261011204240.apk']);
    return updater.check({ manual: true }).then(r => {
      eq(r.state, 'none', '只有占位 APK → 没有可用的包');
      assert(!r.remote, '认不出来的包不许当"新版本"塞给用户');
    });
  });
  steps.push(() => {
    net.release = release(['PWstudy-1.0.2.apk']);
    return updater.check({ manual: true }).then(r => {
      eq(r.state, 'apk', '远端有更新的整包 → 引导整包');
      eq(r.remote.version, '1.0.2', '整包版本号');
    });
  });

  // APK 和 wgt 放在同一个 Release 里：各走各的路，谁也不碍着谁
  steps.push(() => {
    net.release = release([
      '__UNI__53285BF__20261011204240.apk',   // 占位包
      'PWstudy-9.9.9.apk',                    // 比本机新的整包
      'PWstudy-1.0.2-n101.wgt'                // 热更包
    ]);
    return updater.check({ manual: true }).then(r => {
      eq(r.state, 'update', 'Release 里同时有 APK → 照样走热更（wgt 优先）');
      eq(r.remote.version, '1.0.2', '拿出来的是 wgt，不是那个 9.9.9 的整包');
    });
  });
  steps.push(() => {
    // apk 比本机旧，本机又已经热更到 wgt 那个版本了 → 不该被这个旧整包打扰
    net.release = release(['PWstudy-1.0.2-n101.wgt', 'PWstudy-1.0.1.apk']);
    plus.runtime.version = '1.0.2';
    return updater.check({ manual: true }).then(r => {
      eq(r.state, 'latest', '本机已是最新 wgt 的版本 → 不再被更旧的提示打扰');
    });
  });
  steps.push(() => {
    // 反过来：整包比已装的 wgt 版本还新 → 确实该提示装整包
    net.release = release(['PWstudy-1.0.2-n101.wgt', 'PWstudy-1.0.9.apk']);
    plus.runtime.version = '1.0.2';
    return updater.check({ manual: true }).then(r => {
      eq(r.state, 'apk', '整包比已装的还新 → 提示装完整包');
      eq(r.remote.version, '1.0.9', '拿出来的是整包');
    });
  });
  steps.push(() => {
    plus.runtime.version = '1.0.1';
    return Promise.resolve();
  });

  // 跳过过的版本
  steps.push(() => {
    net.release = release(['PWstudy-1.0.2-n101.wgt']);
    settings.set({ update: { skip: '1.0.2' } });
    return updater.check().then(r => eq(r.state, 'skip', '用户点过「稍后」→ 不再烦他'));
  });
  steps.push(() => {
    return updater.check({ manual: true }).then(r => eq(r.state, 'update', '手动检查忽略「跳过」'));
  });
  steps.push(() => { settings.set({ update: { skip: '' } }); return Promise.resolve(); });

  // 多个 wgt 取最新的那个
  steps.push(() => {
    net.release = release(['PWstudy-1.0.1-n101.wgt', 'PWstudy-1.0.3-n101.wgt']);
    return updater.check({ manual: true }).then(r => eq(r.remote.version, '1.0.3', '有多个包时取最新的'));
  });

  /* ---------- 4. 下载 → 安装 → 重启 ---------- */
  steps.push(() => {
    console.log('== 4. 下载 → 安装 → 重启 ==');
    net.release = release(['PWstudy-1.0.2-n101.wgt']);
    log.downloaded.length = 0;
    log.installed.length = 0;
    log.restarted = 0;
    return updater.check({ manual: true }).then(r => updater.applyUpdate(r)).then(() => {
      eq(log.downloaded.length, 1, '下载了一次');
      eq(log.installed.length, 1, '安装了一次');
      eq(log.restarted, 1, '装完必须重启（不重启不生效）');
    });
  });

  // 安装失败 → 必须抛出，交给调用方引导整包（不能静默吞掉）
  steps.push(() => {
    plus.__installFail = true;
    log.modal.length = 0;
    net.release = release(['PWstudy-1.0.2-n101.wgt']);
    return updater.check({ manual: true })
      .then(r => updater.applyUpdate(r))
      .then(() => bad('安装失败却没有抛错'))
      .catch(e => {
        ok('安装失败会抛出来（' + (e && e.message) + '）');
        // 兜底：光有个按钮不算出口，**点了得真的打开整包页**才算
        // （只断言按钮文字的话，把 openRelease 删了也照样绿 —— 反向测试抓到过）
        modalAnswer = { confirm: true };
        log.opened.length = 0;
        updater.failDialog(e.message);
        const m = log.modal[log.modal.length - 1];
        assert(!!m && m.confirmText === '去下载', '失败弹窗有「去下载」按钮');
        assert(log.opened.indexOf(updater.RELEASE_URL) >= 0, '点「去下载」真的打开整包页');
        // 手动检查失败（连不上版本服务）走的是另一个弹窗，同样要验
        log.opened.length = 0;
        updater.checkFailDialog('连不上');
        const m2 = log.modal[log.modal.length - 1];
        assert(!!m2 && m2.confirmText === '去下载', '手动检查失败也有「去下载」出口');
        assert(log.opened.indexOf(updater.RELEASE_URL) >= 0, '它点了也真的打开整包页');
      });
  });
  steps.push(() => { plus.__installFail = false; return Promise.resolve(); });

  // 下载失败同理
  steps.push(() => {
    net.dlFail = true;
    net.release = release(['PWstudy-1.0.2-n101.wgt']);
    return updater.check({ manual: true })
      .then(r => updater.applyUpdate(r))
      .then(() => bad('下载失败却没有抛错'), e => ok('下载失败会抛出来（' + e.message + '）'));
  });
  steps.push(() => { net.dlFail = false; return Promise.resolve(); });

  /* ---------- 5. 启动自检：节流 + 静默 ---------- */
  steps.push(() => {
    console.log('== 5. 启动自检（一天一次 + 失败静默 + 只记录不弹窗） ==');
    settings.set({ update: { auto: true, lastCheckAt: '', skip: '' } });
    net.reqFail = false;
    net.release = release(['PWstudy-1.0.2-n101.wgt']);
    modalAnswer = { confirm: false };
    log.modal.length = 0;
    net.reqCount = 0;
    return updater.autoCheck().then(() => {
      eq(log.modal.length, 0, '自检**不弹窗**（弹窗交给首页 onShow 统一排队）');
      return updater.pending();
    }).then((p) => {
      assert(!!p && p.version === '1.0.2', '有更新记进了 pending（红点和弹窗都读它）');
      return updater.autoCheck();
    }).then(() => {
      // 直接数请求次数：比看弹窗更能说明"真的没再查第二次"
      eq(net.reqCount, 1, '同一天第二次启动 → 不再发请求（一天一次）');
    });
  });

  steps.push(() => {
    // 清掉节流再验"失败静默"
    settings.set({ update: { lastCheckAt: '', skip: '' } });
    net.reqFail = true;
    log.modal.length = 0;
    log.toast.length = 0;
    return updater.autoCheck().then(() => {
      eq(log.modal.length, 0, '自检失败 → 一个弹窗都没有');
      eq(log.toast.length, 0, '自检失败 → 也不 toast（静默）');
    });
  });
  steps.push(() => {
    net.reqFail = false;
    settings.set({ update: { auto: false, lastCheckAt: '' } });
    log.modal.length = 0;
    return updater.autoCheck().then(() => {
      eq(log.modal.length, 0, '开关关掉 → 压根不查');
    });
  });
  steps.push(() => { settings.set({ update: { auto: true } }); return Promise.resolve(); });

  /* ---------- 5.5 清单接口：只认固定 tag ---------- */
  steps.push(() => {
    // 哪天仓库里多出一个 Release（latest 会漂到它身上），客户端不能把它的资产
    // 当成我们的更新包
    net.release = release(['PWstudy-9.9.9-n101.wgt']);
    net.release.tag_name = 'v2-别的-release';
    log.modal.length = 0;
    return updater.manualCheck().then(
      () => bad('拿到别的 tag 的清单，却当成我们的更新包用了'),
      (e) => ok('tag 对不上 → 不认（' + e.message + '）')
    ).then(() => {
      eq(log.modal.length, 0, '也没弹出更新确认');
      net.release = null;
    });
  });

  /* ---------- 6. 手动检查的结果展示 ---------- */
  steps.push(() => {
    console.log('== 6. 手动检查要给明确结果 ==');
    net.release = release(['PWstudy-1.0.1-n101.wgt']);
    log.toast.length = 0;
    return updater.manualCheck().then(r => {
      updater.showResult(r);
      eq(log.toast.length, 1, '已是最新也会说一句（手动点必须有反馈）');
      assert(/已经是最新版/.test(log.toast[0].title), '文案：' + log.toast[0].title);
    });
  });
  steps.push(() => {
    // 基座太老 → 引导整包
    net.release = release(['PWstudy-1.0.9-n999.wgt']);
    log.modal.length = 0;
    modalAnswer = { confirm: true };
    return updater.manualCheck().then(r => {
      eq(r.state, 'native', '手动检查也能识别"只能整包"');
      updater.showResult(r);
      const m = log.modal[log.modal.length - 1];
      assert(!!m && /完整包/.test(m.title), '弹窗说明要装完整包（' + (m && m.title) + '）');
    });
  });
  steps.push(() => {
    // 远端只有更新的整包（没有 wgt）
    net.release = release(['PWstudy-1.0.3.apk']);
    log.modal.length = 0;
    log.opened.length = 0;
    modalAnswer = { confirm: true };
    return updater.manualCheck().then(r => {
      eq(r.state, 'apk', '手动检查能识别"只有更新的整包"');
      updater.showResult(r);
      const m = log.modal[log.modal.length - 1];
      assert(!!m && /完整包/.test(m.title), '整包也弹"要装完整包"（' + (m && m.title) + '）');
      assert(log.opened.indexOf(updater.RELEASE_URL) >= 0, '点「去下载」真的打开整包页');
    });
  });
  steps.push(() => {
    // 占位 APK：我们并不知道那个包是什么，不许把人指过去
    net.release = release(['__UNI__53285BF__20261011204240.apk']);
    log.modal.length = 0;
    log.toast.length = 0;
    log.opened.length = 0;
    modalAnswer = { confirm: true };
    return updater.manualCheck().then(r => {
      eq(r.state, 'none', '手动检查：只有占位包 → none');
      updater.showResult(r);
      eq(log.modal.length, 0, '没有可用的包时不弹下载弹窗');
      eq(log.opened.length, 0, '也没有把人指去下载页（那个包来路不明）');
      eq(log.toast.length, 1, '只 toast 一句');
      assert(/没有可用的更新包/.test(log.toast[0] && log.toast[0].title || ''),
        '文案：' + (log.toast[0] && log.toast[0].title));
    });
  });

  /* ---------- 6.5 红点与首页弹窗 ---------- */
  steps.push(() => {
    console.log('== 6.5 红点 / 首页弹窗 ==');
    // 红点怎么消失：装完新版 → 记下的版本号不再比本机新 → pending 自己清空
    net.release = release(['PWstudy-1.0.2-n101.wgt']);
    plus.runtime.version = '1.0.1';
    settings.set({ update: { skip: '' } });
    return updater.manualCheck()
      .then(() => updater.pending())
      .then((p) => {
        assert(!!p && p.version === '1.0.2', '先记下 1.0.2（红点亮着）');
        return updater.hasUpdate();
      })
      .then((v) => {
        eq(v, true, '红点亮着');
        plus.runtime.version = '1.0.2';          // 假装装完了
        return updater.pending();
      })
      .then((p) => {
        eq(p, null, '装完新版 pending 自动清空 —— 红点就是这么消失的');
        return updater.hasUpdate();
      })
      .then((v) => eq(v, false, '红点灭了（全程没记过「看过了」这笔账）'));
  });

  /* ---------- 6.8 预下载：只在 Wi-Fi 下；用户点确认时最好已经备好 ---------- */
  const cleanPending = { version: '', code: 0, minNative: 0, url: '', size: 0, notes: '', state: '', downloadPath: '' };
  const resetUpdate = (patch) => settings.set({ update: Object.assign({ pending: cleanPending, skip: '', lastCheckAt: '' }, patch || {}) });

  steps.push(() => {
    console.log('== 6.8 Wi-Fi 下先把包准备好（不安装） ==');
    plus.__net = 'wifi';
    plus.__fileGone = false;
    plus.runtime.version = '1.0.1';
    net.release = release(['PWstudy-1.0.4-n101.wgt']);
    resetUpdate();
    log.downloaded.length = 0;
    log.installed.length = 0;
    return updater.manualCheck().then(() => {
      eq(log.downloaded.length, 0, '查清单这一步什么都不下');
      eq(log.installed.length, 0, '也不偷偷装');
      return updater.prefetch();
    }).then((p) => {
      assert(!!p && !!p.downloadPath, 'Wi-Fi 下把包拉到本地了（' + (p && p.downloadPath) + '）');
      eq(log.downloaded.length, 1, '下载只发生了一次');
      return updater.prefetch();
    }).then(() => {
      eq(log.downloaded.length, 1, '已经下好了 → 不再重复下一遍');
      return updater.pending();
    }).then((p) => {
      assert(!!p && !!p.downloadPath, '路径写进了 pending —— 弹窗文案就照它写');
    });
  });

  steps.push(() => {
    console.log('== 6.8b 已经下好 → 点一下直接装，不再走流量 ==');
    return updater.pending().then((p) => {
      log.downloaded.length = 0;
      log.installed.length = 0;
      const before = log.restarted;
      return updater.runUpdate({ state: 'update', remote: p, notes: '' }).then((v) => {
        eq(v, true, '装上去了');
        eq(log.downloaded.length, 0, '★ 一次网都没上（用的就是本地那份）');
        eq(log.installed[log.installed.length - 1], '/doc/x.wgt', '装的是那份本地包');
        assert(log.restarted > before, '装完重启了（wgt 不重启不生效）');
      });
    });
  });

  steps.push(() => {
    console.log('== 6.8c 本地包被回收 → 不硬装，重新下 ==');
    plus.__fileGone = true;
    return updater.pending().then((p) => {
      assert(!!p && !p.downloadPath, '失效的路径被清掉了（不许拿空路径说"已经下好了"）');
      plus.__fileGone = false;
      log.downloaded.length = 0;
      return updater.prefetch();
    }).then((p) => {
      assert(!!p && !!p.downloadPath, '重新下好了');
      eq(log.downloaded.length, 1, '补下载发生了一次');
    });
  });

  steps.push(() => {
    console.log('== 6.8d 移动网络：不预下载，点了也不动他的流量 ==');
    plus.__net = '4g';
    plus.runtime.version = '1.0.1';
    net.release = release(['PWstudy-1.0.5-n101.wgt']);
    resetUpdate();
    log.downloaded.length = 0;
    log.opened.length = 0;
    log.modal.length = 0;
    return updater.manualCheck().then(() => updater.prefetch()).then(() => {
      eq(log.downloaded.length, 0, '移动网络下一次网都不上');
      return updater.pending();
    }).then((p) => {
      assert(!!p && !p.downloadPath, '没有本地包');
      return updater.runUpdate({ state: 'update', remote: p, notes: '' });
    }).then((v) => {
      eq(v, false, '没装成');
      eq(log.downloaded.length, 0, '★ 他的移动流量一分没花');
      const m = log.modal[log.modal.length - 1];
      assert(!!m && /Wi-Fi/.test(m.title), '弹的是"请在 Wi-Fi 下更新"（' + (m && m.title) + '）');
      eq(log.opened.length, 0, '★ 没把他推去下 20MB 的整包（那等于同一个坑再跳一次）');
    });
  });

  steps.push(() => {
    console.log('== 6.8e 网络类型判定 ==');
    eq(updater.canDownloadNetwork('wifi').ok, true, 'wifi → 放行');
    eq(updater.canDownloadNetwork('ethernet').ok, true, '有线网 → 放行');
    eq(updater.canDownloadNetwork('4g').ok, false, '4g → 拦下');
    eq(updater.canDownloadNetwork('5g').why, 'cellular', '5g 也归属蜂窝');
    eq(updater.canDownloadNetwork('2g').why, 'cellular', '2g 同上');
    eq(updater.canDownloadNetwork('none').why, 'none', '没网单独一个标记');
    // unknown 必须放行：读不出网络类型的机型上，一拦就等于永远不许更新
    eq(updater.canDownloadNetwork('unknown').ok, true, 'unknown → 放行（不许把更新锁死）');
    return Promise.resolve();
  });

  steps.push(() => {
    console.log('== 6.8f 弹窗文案跟着"下好没 / 能不能下"变 ==');
    plus.runtime.version = '1.0.1';
    net.release = release(['PWstudy-1.0.6-n101.wgt']);
    resetUpdate();
    // ① 移动网络、包还没下 —— 点之前就该知道一会儿要 Wi-Fi
    plus.__net = '4g';
    log.modal.length = 0;
    return updater.manualCheck().then((r) => {
      updater.showResult(r);
      const m1 = log.modal[log.modal.length - 1];
      assert(!!m1 && /移动网络/.test(m1.content), '当场说明是移动网络、只 Wi-Fi 能下');
      eq(m1.confirmText, '下载并安装', '没下好 → 按钮写「下载并安装」');
      // ② 连上 Wi-Fi 下好之后 → 同一张卡该说"点一下就装完"
      plus.__net = 'wifi';
      return updater.prefetch();
    }).then((p) => {
      log.modal.length = 0;
      updater.askUpdate({ state: 'update', remote: p, notes: '' });
      const m2 = log.modal[log.modal.length - 1];
      eq(m2.confirmText, '立即更新', '已经下好 → 按钮写「立即更新」');
      assert(/已经下好了/.test(m2.content), '文案说清不用再下载');
      return Promise.resolve();
    });
  });

  steps.push(() => {
    console.log('== 6.8g 挂一次监听，别重复挂 ==');
    const before = (net.watchers || []).length;
    const first = updater.watchWifi();
    const second = updater.watchWifi();
    eq(first, true, '第一次挂上了');
    eq(second, false, '第二次是空操作（幂等）');
    eq((net.watchers || []).length, before + 1, '监听器只多了一个');
    // 连上 Wi-Fi → 自动补下载；连上蜂窝网 → 什么都不做
    const push = net.watchers[net.watchers.length - 1];
    plus.__net = '4g';
    log.downloaded.length = 0;
    push({ isConnected: true, networkType: '4g' });
    plus.__net = 'wifi';
    plus.runtime.version = '1.0.1';
    net.release = release(['PWstudy-1.0.7-n101.wgt']);
    resetUpdate();
    return updater.manualCheck().then(() => {
      log.downloaded.length = 0;
      push({ isConnected: true, networkType: 'wifi' });
      return new Promise((res) => setTimeout(res, 0));
    }).then(() => {
      eq(log.downloaded.length, 1, '连上 Wi-Fi 那一刻把包补下来了');
    });
  });

  steps.push(() => {
    resetUpdate();
    plus.__net = 'wifi';
    plus.__fileGone = false;
    return Promise.resolve();
  });

  steps.push(() => {
    // 有别的事在场 → 不抢（必须在"已经弹过"之前测：promptOnce 一次进程只弹一回）
    plus.runtime.version = '1.0.1';
    net.release = release(['PWstudy-1.0.2-n101.wgt']);
    settings.set({ update: { skip: '' } });
    log.modal.length = 0;
    return updater.manualCheck()
      .then(() => updater.promptOnce({ busy: true }))
      .then((v) => {
        eq(v, false, '有别的事在场 → 让路（这次不弹，下次进首页再说）');
        eq(log.modal.length, 0, '没弹出东西来');
      });
  });

  steps.push(() => {
    log.modal.length = 0;
    modalAnswer = { confirm: false };
    return updater.promptOnce({}).then((a) => {
      assert(a === true, 'promptOnce 弹了一次');
      eq(log.modal.length, 1, '弹窗出现了');
      return updater.promptOnce({});
    }).then((b) => {
      eq(b, false, '第二次 promptOnce 不再弹（本次进程只弹一次）');
      eq(log.modal.length, 1, '确实没有多弹一遍');
    });
  });

  steps.push(() => {
    // 「不再提示」= 记下这个版本；红点也跟着不亮（一个动作、两个效果）
    net.release = release(['PWstudy-1.0.3-n101.wgt']);
    settings.set({ update: { skip: '' } });
    log.modal.length = 0;
    modalAnswer = { confirm: false };
    return updater.manualCheck().then((r) => {
      updater.showResult(r);
      const u = settings.get().update || {};
      eq(u.skip, '1.0.3', '点「不再提示」记下了这个版本');
      return updater.hasUpdate();
    }).then((v) => eq(v, false, '说过不再提示 → 红点也不亮'));
  });

  /* ---------- 7. 设置默认值 ---------- */
  console.log('== 7. 默认值与开关 ==');
  eq(settings.defaults().update.auto, true, '启动自检默认开');
  eq(settings.defaults().update.skip, '', '默认没跳过任何版本');
  eq(updater.autoEnabled(), true, 'autoEnabled 读得到');
  eq(updater.setAuto(false), false, 'setAuto 写回');
  eq(updater.setAuto(true), true, '再开回来');

  return run();
}

/* ---------- 8. 接线（源码） ---------- */
console.log('== 8. 接线：启动自检 / 设置页两个入口 ==');
const app = R('App.vue');
const setSrc = R('pkgManage/pages/settings/settings.vue');
const setTpl = setSrc.slice(0, setSrc.indexOf('\n<script')).replace(/<!--[\s\S]*?-->/g, '');
const setSc = setSrc.slice(setSrc.indexOf('\n<script'), setSrc.indexOf('\n<style'));
assert(/import \* as updater from '\.\/utils\/updater\.js'/.test(app), 'App.vue 引了 updater');
assert(/updater\.autoCheck\(\)/.test(app), 'App.vue 启动自检');
// 延迟写在 setTimeout 的第二个参数上（在调用的后面），别只往前找
assert(/updater\.autoCheck\(\)[\s\S]{0,40}?,\s*3000\s*\)/.test(app),
  '自检延迟 3 秒（不和首屏抢主线程）');
assert(/检查更新/.test(setTpl) && /@tap="doCheckUpdate"/.test(setTpl), '设置页有「检查更新」');
assert(/下载完整安装包/.test(setTpl) && /@tap="goRelease"/.test(setTpl), '设置页有「下载完整安装包」');
assert(/启动时自动检查/.test(setTpl) && /setUpdateAuto/.test(setTpl), '设置页有自检开关');
assert(/updater\.manualCheck\(\)/.test(setSc), '手动检查走 updater.manualCheck');
assert(/updater\.openRelease\(\)/.test(setSc), '「下载完整安装包」走 updater.openRelease');
assert(/updater\.setAuto\(on\)/.test(setSc), '开关写回设置');
assert(/updater\.showResult\(r\)/.test(setSc), '结果统一交给 showResult（页面不各写一套弹窗）');
assert(updater.RELEASE_URL === 'https://github.com/Arona-ovo/AI-Learning-Plan-APP-PWstudy/releases/tag/PWstudy',
  '整包页面指向固定 tag 的 Release');

/* ---------- 8.2 红点与首页弹窗的接线 ---------- */
console.log('== 8.2 红点与首页弹窗的接线 ==');
// 先剥整行注释：注释里提到的名字会被自己的正则命中（硬约束）
const upSrc = R('utils/updater.js').replace(/^\s*\/\/.*$/gm, '');
const home = R('pages/home/home.vue').replace(/^\s*\/\/.*$/gm, '');
const prof = R('pages/profile/profile.vue').replace(/^\s*\/\/.*$/gm, '');

const autoBlk = block(upSrc, 'export async function autoCheck()');
assert(!!autoBlk && !/askUpdate/.test(autoBlk), '自检只记录 pending、**不弹窗**（弹窗交给首页排队）');
assert(/savePending\(r\)/.test(upSrc) && /clearPending\(\)/.test(upSrc), '检查结果会记进 / 清掉 pending');
assert('pending' in settings.defaults().update, 'update.pending 落在 storage（不是内存变量）');
assert(/function pending\(\)[\s\S]{0,300}local\.code >= p\.code/.test(upSrc),
  'pending 每次读都跟本机版本比 —— 红点就是靠这个自动消失的');
assert(/if \(prompted\) return Promise\.resolve\(false\)/.test(upSrc), 'promptOnce 本次进程只弹一次');
assert(/if \(o\.busy\) return Promise\.resolve\(false\)/.test(upSrc), 'promptOnce 看到 busy 就让路');
assert(/skip === p\.version/.test(upSrc), '说过「不再提示」的版本既不弹窗也不亮红点');

assert(/import \* as updater from '\.\.\/\.\.\/utils\/updater\.js'/.test(home), '首页引了 updater');
// 带 this. ：方法定义本身也叫 maybeUpdatePrompt，只写方法名的话删掉调用照样绿
assert(/this\.maybeUpdatePrompt\(\)/.test(home), '首页 onShow 会问一次更新');
assert(/updater\.promptOnce\(\{ busy:/.test(home), '「忙不忙」由页面传给 updater（只有页面知道）');

assert(/import \* as updater from '\.\.\/\.\.\/utils\/updater\.js'/.test(prof), '「我的」页引了 updater');
assert(/class="dot-update"/.test(prof) && /v-if="updateDot"/.test(prof), '设置行右侧有红点');
assert(/updater\.hasUpdate\(\)/.test(prof), '红点判据走 updater.hasUpdate');
assert(/refreshUpdateDot\(\)/.test(prof), '每次进「我的」重读一次红点');
assert(/\.dot-update[\s\S]{0,140}width: 8px/.test(prof), '红点 8px');

/* ---------- 9. 发布脚本 ---------- */
console.log('== 9. 发布脚本 _tools/publish-wgt.js ==');
assert(/unpackage\/dist\/build\/app-plus/.test(pub), 'wgt 源目录是 app-plus 产物');
assert(/manifest\.json'\)/.test(pub) && /没有根目录的 manifest\.json/.test(pub), '校验根目录必须有 manifest.json');
assert(/verifyZip/.test(pub), '打完自己验一遍包没坏');
assert(/versionCode/.test(pub) && /n' \+ nativeCode/.test(pub), '原生基线写进包名');
assert(/--bump/.test(pub), '支持自动抬版本');
assert(/data\/build-info\.js/.test(pub) && /_vocab/.test(pub), '抬版本同步三处（manifest / build-info / _vocab）');
assert(/--dry/.test(pub), '支持空跑');
assert(/RELEASE_URL/.test(pub), '打完打印上传指引');
// 包内版本必须跟着文件名走：包里那个 manifest.json 是"发行那一刻"的值，
// 不跟文件名对齐的话，装完 App 还报旧版本 → 客户端以为没装上，每次启动再提示一遍
// 断言**调用点**（只断言函数存在的话，把调用删了照样绿）
assert(/alignInnerVersion\(entries, ver, nativeCode\)/.test(pub), '打 wgt 时对齐包内版本');
assert(/readZipEntry\(outPath, 'manifest\.json'\)/.test(pub), '打完把包内 manifest.json 读回来自验');
// --no-sync：整包与热更包不在同一条编号线上时，脚本不许顺手把源码版本抬走
// —— 抬了 manifest 就跟你在云打包界面填的对不上
assert(/--no-sync/.test(pub), '支持 --no-sync（整包与 wgt 不同号时用）');
assert(/!has\('--no-sync'\)/.test(pub), '同步源码版本那段真的被 --no-sync 挡住');
// --bump 的两代坑（都在同一个位置上，别再改回去）：
//   ① 早期怕它**静默回退到 1.0.0**，打出 1.0.1 这种比当前还旧的包 —— 客户端判定
//      "已是最新"，用户永远收不到更新，日志还一切正常。
//   ② 2026-10-14：改成用宽松解析兜底之后，`1.3beta` 被当成 `1.3.0` 抬成 `1.3.1`，
//      再**写回** manifest / build-info / _vocab 三处 —— 填在云打包界面的名字被顶掉。
//      结论：版本号只能认严格的 x.y.z，认不出就 fail 让人明确输入，绝不替他猜。
// 断言**调用点**，只断言函数存在会被绕过
assert(/const cur = parseVer\(from\);/.test(pub), '--bump 的版本来源是严格的 parseVer');
assert(!/parseVer\(from\) \|\| looseVer\(from\)/.test(pub), '--bump 不拿宽松解析兜底（会把版本写成另一个）');
assert(!/const cur = [^;]*looseVer/.test(pub), '--bump 不拿 looseVer 的猜测当当前版本');
assert(!/\{ a: 1, b: 0, c: 0 \}/.test(pub), '--bump 不许静默回退到 1.0.0（会打出更旧的包）');
assert(/if \(!cur\)[\s\S]{0,120}fail\(/.test(pub), '--bump 认不出版本号就报错，不自己猜');

/* ---------- 10. 源码：认不出就不许指路 ---------- */
console.log('== 10. 占位包 / 清单接口（源码） ==');
// 先剥行注释（自己的正则会命中注释里的示例代码），再按函数/分支切块匹配
const upRaw = R('utils/updater.js');
const up = upRaw.replace(/\/\/[^\n]*/g, '');
function block(src, head) {
  const i = src.indexOf(head);
  if (i < 0) return '';
  const j = src.indexOf('{', i);
  if (j < 0) return '';
  let d = 0, k = j;
  for (; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) break; }
  }
  return src.slice(j, k + 1);
}
// ⚠️ head 要写全到 `if (...)`：check() 里也有一个 `r.state === 'none'`
// （clearPending 那条分支），只写半句会切到那个更早的位置上去
const noneBlk = block(up, "if (r.state === 'none') {");
assert(!!noneBlk, 'showResult 里有 none 分支');
assert(/toast\(/.test(noneBlk), 'none 分支只 toast 一句');
assert(!/openRelease|showModal/.test(noneBlk), 'none 分支不给下载入口、不弹窗（那包来路不明）');
assert(/parseApkName/.test(up) && /parseNamed\(name, 'apk'\)/.test(up), '整包走自己的解析（挑名字）');
assert(/Release 里可能挂着别的 APK/.test(upRaw), '为什么必须挑名字写在注释里');
// 清单接口：latest 的语义是"最新发布的非草稿非预发布"，多一个 Release 就漂走。
// 直接断言运行时常量（扫源码会被注释里那句"不用 latest"骗到 —— 块注释没剥掉）
assert(updater.RELEASE_TAG === 'PWstudy', '有固定 tag 常量');
assert(updater.REPO_API.indexOf('/releases/tags/' + updater.RELEASE_TAG) > 0,
  '清单接口按 tag 精确取（不是 /releases/latest）');

/* ---------- 11. 源码：更新包只在 Wi-Fi 下走流量 ---------- */
console.log('== 11. 预下载与网络门禁（源码） ==');
// `up` 已在第 10 节剥掉行内注释，这里直接用
const upCode = up;

/**
 * 抠出一个顶层函数的函数体 —— **按花括号配平**，不靠字符数凑（第 15·22 条）。
 *
 * ⚠️ 四种形态：export async / export / async / 裸 function。顺序必须长在前，
 *    否则 `function prefetch(` 会先命中 `export async function prefetch(` 里的子串。
 * ⚠️ 仓库是 CRLF：这里的匹配不跨行，但凡是写到 \n 的一律要 \r?\n（第 17 条）。
 */
function fnBody(src, name) {
  const heads = [
    'export async function ' + name + '(',
    'export function ' + name + '(',
    'async function ' + name + '(',
    'function ' + name + '('
  ];
  let open = -1;
  for (let k = 0; k < heads.length; k++) {
    const at = src.indexOf(heads[k]);
    if (at < 0) continue;
    open = src.indexOf('{', at + heads[k].length);
    break;
  }
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src.charAt(i);
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}

// ① EMPTY_PENDING 必须**显式**带 downloadPath。settings.set 是 deepMerge，
//    漏了它的话 clearPending() 清不掉旧路径 —— 下一次会拿着一个指向旧包（
//    甚至已经被系统回收）的路径去安装。
const emptyBlk = (upCode.match(/const EMPTY_PENDING = \{([\s\S]*?)\}/) || [])[1] || '';
assert(/downloadPath:\s*''/.test(emptyBlk),
  'EMPTY_PENDING 里显式写了 downloadPath（deepMerge 下不写就清不掉）');

// ② 网络判定必须**同步**。异步会让 askUpdate/showResult 的调用契约变成 await，
//    页面上一堆 showResult(r) 就地取值的地方全得改 —— 而这个信息 Plus 端本来就有同步接口。
const netFn = fnBody(upCode, 'netTypeSync');
assert(!!netFn && /getCurrentType\(\)/.test(netFn), 'netTypeSync 走 plus.networkinfo 的同步接口');
assert(!/getNetworkType\(/.test(upCode), '不许再用异步的 uni.getNetworkType 决定弹窗文案');

// ③ 蜂窝网络必须拦，unknown 必须放行（一拦就是永久不许更新）
const judge = fnBody(upCode, 'canDownloadNetwork');
assert(!!judge && /none/.test(judge) && /why:\s*'cellular'/.test(judge), '判定里区分了没网与蜂窝');
assert(/cellular'\]\[\s\S]*indexOf|CELLULAR\.indexOf/.test(upCode) || /CELLULAR/.test(upCode),
  '蜂窝网络走 CELLULAR 名单');

// ④ prefetch 只下载、绝不安装（合规红线是"不许静默安装"）
const pre = fnBody(upCode, 'prefetch');
assert(!!pre && !/install\(/.test(pre), 'prefetch 里没有 install（下载 ≠ 安装）');
assert(!!pre && !/restart\(/.test(pre), 'prefetch 里也没有 restart');
assert(!!pre && /state !== 'update'/.test(pre), '只预下载热更包（整包不去后台偷着拉）');

// ⑤ applyUpdate 必须先认缓存，再谈下载
const apd = fnBody(upCode, 'applyUpdate');
assert(!!apd && apd.indexOf('downloadPath') < apd.indexOf('await download('),
  'applyUpdate 先查本地缓存的包，命中就直接装');
assert(!!apd && /e\.why = net\.why/.test(apd), '拦下来那个错误带 why 标记');

// ⑥ runUpdate 要把"网络不允许"和"包坏了"分开处理
const run = fnBody(upCode, 'runUpdate');
assert(!!run && /netHint\(why\)/.test(run), '网络类失败走 netHint，不是 failDialog');
assert(!!run && /failDialog/.test(run), '其它失败仍然给"去下载完整包"的出口');

// ⑦ netHint 不许给下载按钮 —— 那时给"去下整包"等于把他推回同一个坑
const hint = fnBody(upCode, 'netHint');
assert(!!hint && /showCancel:\s*false/.test(hint), 'netHint 只留一个「知道了」');
assert(!!hint && !/openRelease/.test(hint), 'netHint 不给下载入口（整包更大，一样吃流量）');

// ⑧ watchWifi 幂等（挂在 launch 上会被反复调用）
const wf = fnBody(upCode, 'watchWifi');
assert(!!wf && /if \(wifiWatched\) return false/.test(wf), 'watchWifi 幂等');

// ⑨ pending() 里要顺手校验本地文件还在不在
const pd = fnBody(upCode, 'pending');
assert(!!pd && /fileUsable\(/.test(pd), 'pending() 会验一遍本地包还在不在');
assert(!!pd && /clearDownloadPath/.test(pd), '失效的路径被清掉，不是硬装');

// ⑩ App.vue 得把监听挂上 —— 自检一天只有一次，连上 Wi-Fi 才是最该下包的时刻
assert(/updater\.watchWifi\(\)/.test(R('App.vue')), 'App.vue 挂了 watchWifi');

// ⑪ 门禁的**前提权限**：没有 ACCESS_NETWORK_STATE，plus.networkinfo 只能读出
//    unknown，而 unknown 是放行的 —— 移动网络照样下，整个功能等于没做，
//    而且日志上一片安静，最难查的那类 bug。
const mf = JSON.parse(R('manifest.json'));
const perms = ((((mf['app-plus'] || {}).distribute || {}).android || {}).permissions) || [];
assert(perms.some(p => /ACCESS_NETWORK_STATE/.test(String(p))),
  'manifest 声明了 ACCESS_NETWORK_STATE（没有它网络类型只能读出 unknown）');
assert(perms.some(p => /android\.permission\.INTERNET/.test(String(p))), '有联网权限');

main().then(() => {
  console.log(fail === 0 ? '\n热更新校验全部通过' : '\n失败 ' + fail + ' 项 ✗');
  process.exit(fail ? 1 : 0);
}, (e) => {
  bad('跑挂了：' + (e && (e.stack || e.message)));
  process.exit(1);
});
