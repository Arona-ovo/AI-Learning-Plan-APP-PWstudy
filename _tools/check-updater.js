// _tools/check-updater.js - wgt 热更新（启动自检 → 比对 → 下载 → 安装 → 重启）校验
// 运行：node _tools/check-updater.js
//
// 守的是五件事：
//  1) 版本能比出新旧（'1.10' > '1.9' 这种字符串比较会翻车的地方）
//  2) 资产名的约定**两头一致** —— 发布脚本打出来的名字，客户端必须认得出来
//     （这是最容易悄悄断掉的一环：改了脚本没改解析，发出去的包没人认领）
//  3) 基座太老**绝不装 wgt**（老基座装新资源包 = 白屏，只能引导整包）
//  4) 启动自检失败必须静默、一天只查一次；用户手动点才允许报错
//  5) 每一步失败都有"去下载完整包"的出口，不能卡在"更新失败"上
//
// plus / uni 全是假替身：这里是 node，装不了真包。
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');
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
    if (net.reqFail) { o.fail({ errMsg: 'request:fail' }); return; }
    o.success({ statusCode: 200, data: net.release });
  },
  downloadFile: (o) => {
    log.downloaded.push(o && o.url);
    if (net.dlFail) { o.fail({ errMsg: 'download:fail' }); return; }
    o.success({ statusCode: 200, tempFilePath: '/tmp/x.wgt' });
    return { onProgressUpdate: (cb) => { cb({ progress: 42 }); cb({ progress: 100 }); } };
  },
  saveFile: (o) => { (o && o.success ? o.success({ savedFilePath: '/doc/x.wgt' }) : null); }
};

// App 端那几个原生调用。versionCode 可以随时改，用来造"基座太老"的场景
const plus = {
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
  }
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
    console.log('== 5. 启动自检（一天一次 + 失败静默） ==');
    settings.set({ update: { auto: true, lastCheckAt: '', skip: '' } });
    net.reqFail = false;
    net.release = release(['PWstudy-1.0.2-n101.wgt']);
    modalAnswer = { confirm: false };          // 用户点「稍后」
    log.modal.length = 0;
    return updater.autoCheck().then(() => {
      eq(log.modal.length, 1, '有更新 → 弹一次确认（不静默装）');
      const u = settings.get().update || {};
      eq(u.skip, '1.0.2', '点「稍后」记下了这个版本');
      // 只清掉"跳过"、留着节流标记 —— 否则第二次走的是 skip 分支，
      // 验的就不是"一天一次"了（反向测试里被抓出来过）
      settings.set({ update: { skip: '' } });
      return updater.autoCheck();
    }).then(() => {
      eq(log.modal.length, 1, '同一天第二次启动 → 不再弹（一天一次）');
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
const noneBlk = block(up, "r.state === 'none'");
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

main().then(() => {
  console.log(fail === 0 ? '\n热更新校验全部通过' : '\n失败 ' + fail + ' 项 ✗');
  process.exit(fail ? 1 : 0);
}, (e) => {
  bad('跑挂了：' + (e && (e.stack || e.message)));
  process.exit(1);
});
