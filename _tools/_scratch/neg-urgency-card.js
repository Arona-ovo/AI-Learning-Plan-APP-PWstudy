/**
 * _tools/_scratch/neg-urgency-card.js —— check-urgency.js 第 7 节（卡片文案与图形）的反向测试
 *
 * 背景：2026-10-14 用户反馈"紧迫度卡一条长的、空空的，要加一行字"，
 * 于是把「卡内零中文」这条老约束改成「卡片头 + 三行读数，其余仍靠图形」。
 * 改护栏的同时必须证明它抓得到坏代码 —— 否则就是一条永远绿的自欺断言。
 *
 * ⚠️ 两条踩过的坑（跟 neg-apps-load.js 同源，别踩第二次）：
 *   ① 沙箱里 child_process.spawnSync 直接 EBUSY → 护栏只能**同进程 require**；
 *   ② 护栏自己会 process.exit → 这里换成"只记码不真退"，否则第一次注入就把
 *      测试进程自己干掉了。check-urgency.js 是 async IIFE，所以还要等几拍。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'uniapp-PWstudy');
const CHECK = path.join(__dirname, '..', 'check-urgency.js');
const FILES = {
  comp: path.join(ROOT, 'components', 'urgency-meter', 'urgency-meter.vue'),
  urgency: path.join(ROOT, 'utils', 'urgency.js')
};

const backup = {};
Object.keys(FILES).forEach(k => { backup[k] = fs.readFileSync(FILES[k], 'utf8'); });

/** 注入：把 old 换成 next。old 必须真在文件里，否则算测试写错了（不是护栏的锅）。 */
function swap(file, oldStr, next) {
  const src = backup[file];
  let o = oldStr;
  let n = next;
  if (src.indexOf('\r\n') >= 0) {          // 源码是 CRLF，注入片段写的是 \n
    o = oldStr.split('\n').join('\r\n');
    n = next.split('\n').join('\r\n');
  }
  if (src.indexOf(o) < 0) throw new Error('注入点找不到：' + oldStr.slice(0, 60));
  fs.writeFileSync(FILES[file], src.split(o).join(n));
}
function restore() {
  Object.keys(FILES).forEach(k => fs.writeFileSync(FILES[k], backup[k]));
}

const realExit = process.exit;
let exited = null;
const realLog = console.log;
const realErr = console.error;

process.exit = function (code) { exited = code; };

async function runCheck(mutations) {
  restore();
  mutations.forEach(m => swap(m[0], m[1], m[2]));
  exited = null;
  console.log = function () {};
  console.error = function () {};   // 护栏的 ✗ 行也别混进本测试的输出
  delete require.cache[require.resolve(CHECK)];
  try {
    require(CHECK);
  } catch (e) {
    // 护栏自己炸了也算"抓到"，但下面按退出码判，不单独放宽
  }
  for (let i = 0; i < 60 && exited === null; i++) {
    await new Promise(r => setTimeout(r, 20));
  }
  console.log = realLog;
  console.error = realErr;
  const code = exited;
  restore();
  return code;
}

let pass = 0;
let fail = 0;
async function shouldCatch(label, mutations) {
  const code = await runCheck(mutations);
  if (code === 1) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '（退出码 ' + code + '，应当为 1）'); }
}

(async () => {
  realLog('\n== 对照：不做任何注入时护栏必须是绿的 ==');
  const green = await runCheck([]);
  if (green === 0) { pass++; console.log('  ✓ 原样源码 → 护栏绿'); }
  else { fail++; console.log('  ✗ 原样源码 → 护栏应当是绿的，实际 ' + green); }

  realLog('\n== 1. 用户要的那"一行字"被删 ==');
  await shouldCatch('删掉整个卡片头', [
    ['comp', '    <view class="ug-head">\n      <text class="ug-title">{{ $t(\'今日紧迫程度\') }}</text>\n      <text class="ug-lv" :style="lvStyle">{{ levelText }}</text>\n      <view class="ug-help" hover-class="ug-help-press" @tap.stop="onHelp">?</view>\n    </view>', '']
  ]);
  await shouldCatch('标题不写「今日紧迫程度」', [
    ['comp', '{{ $t(\'今日紧迫程度\') }}', '{{ $t(\'今日\') }}']
  ]);
  await shouldCatch('标题裸中文（没套 $t，英文态裸奔）', [
    ['comp', '<text class="ug-title">{{ $t(\'今日紧迫程度\') }}</text>', '<text class="ug-title">今日紧迫程度</text>']
  ]);
  await shouldCatch('删掉档位胶囊', [
    ['comp', '      <text class="ug-lv" :style="lvStyle">{{ levelText }}</text>\n', '']
  ]);
  await shouldCatch('删掉 ? 按钮', [
    ['comp', '      <view class="ug-help" hover-class="ug-help-press" @tap.stop="onHelp">?</view>\n', '']
  ]);

  realLog('\n== 2. 三行读数被拆 ==');
  await shouldCatch('删掉分数', [
    ['comp', '          <text class="ug-score" :style="numStyle">{{ score }}</text>\n', '']
  ]);
  await shouldCatch('删掉那句人话', [
    ['comp', '          <text class="ug-hint" :style="numStyle">{{ hintText }}</text>\n', '']
  ]);
  await shouldCatch('"还剩几个"不再走 $t', [
    ['comp', '{{ $t(\'还剩 {n} 个\', { n: leftPomos }) }}', '还剩 {{ leftPomos }} 个']
  ]);
  await shouldCatch('删掉底部那行（还要多久 / 今天剩多久）', [
    ['comp', '        <view class="ug-foot">\n          <text class="ug-f1">{{ needText }}</text>\n          <text class="ug-f2">{{ availText }}</text>\n        </view>', '']
  ]);

  realLog('\n== 3. 脚本里的中文跑出 $t() ==');
  await shouldCatch('档位名改成模块级常量（不在 $t() 里）', [
    ['comp', '        this.$t(\'从容\'), this.$t(\'正常\'),', '        \'从容\', \'正常\',']
  ]);
  await shouldCatch('人话改成模块级常量（不在 $t() 里）', [
    ['comp', '        this.$t(\'时间还很宽裕\'), this.$t(\'按计划来就行\'),', '        \'时间还很宽裕\', \'按计划来就行\',']
  ]);

  realLog('\n== 4. 四个图形被文字顶掉（让步的边界） ==');
  await shouldCatch('删掉环', [
    ['comp', '      <view class="ug-ring" :style="ringStyle">\n        <view class="ug-inner">\n          <view class="ug-halo" :style="haloStyle"></view>\n          <view class="ug-core" :style="coreStyle"></view>\n        </view>\n      </view>', '']
  ]);
  await shouldCatch('删掉呼吸核心', [
    ['comp', '          <view class="ug-core" :style="coreStyle"></view>\n', '']
  ]);
  await shouldCatch('删掉专注方块', [
    ['comp', '              class="ug-blk"', '              class="ug-x"']
  ]);
  await shouldCatch('删掉时间条', [
    ['comp', '        <view class="ug-track">', '        <view class="ug-x">']
  ]);

  realLog('\n== 5. 档位胶囊的淡底 ==');
  await shouldCatch('LV_SOFT 少一档（胶囊底色对不上）', [
    ['urgency', "  'rgba(187, 19, 50, 0.14)'\n];", '];']
  ]);
  await shouldCatch('compute 不再返回 soft', [
    ['urgency', '    soft: LV_SOFT[level],\n', '']
  ]);

  restore();
  realLog('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  realExit(fail ? 1 : 0);
})();
