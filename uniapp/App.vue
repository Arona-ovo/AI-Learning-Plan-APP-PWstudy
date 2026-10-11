<script>
import * as settings from './utils/settings'
import * as theme from './utils/theme'
// 直接用叶子模块（不走 services/index.js 门面，避免启动链路依赖门面互操作）
import * as voice from './services/voice.js'
import * as auth from './services/auth'
import * as aiCache from './utils/ai-cache.js'
import { autoRegisterArgon2 } from './utils/argon2'
import { hideNativeTabBar } from './utils/nav.js'
import { autoDowngrade } from './utils/perf.js'
import * as usage from './utils/usage.js'
import * as sfx from './utils/sfx.js'
import { flush as pwFlush } from './utils/pwstore.js'
import * as apptime from './utils/apptime.js'
import * as link from './utils/link.js'

export default {
  onLaunch() {
    // 被 pwstudy:// 链接唤起（背单词 App 回跳 / 外部直达）：先处理启动参数，
    // 再挂上 newintent —— 应用已在后台时再被唤起走的是这个事件。
    // #ifdef APP-PLUS
    try {
      const bootArgs = plus.runtime.arguments
      // 启动参数里的跳转要等首页渲染完再执行，太早 navigateTo 会丢
      if (bootArgs) setTimeout(() => { try { link.handle(bootArgs) } catch (e) {} }, 900)
      plus.globalEvent.addEventListener('newintent', () => {
        try { link.handle(plus.runtime.arguments) } catch (e) {}
      })
    } catch (e) {}
    // #endif
    settings.init()
    // AI 底层缓存（独立于学习进度）：搜索 / 生成过的句子与释义都落这里
    try { aiCache.init() } catch (e) {}
    // 可选增强：host 已把 argon2 挂到全局时，口令哈希自动升级为 argon2id
    try { autoRegisterArgon2() } catch (e) { /* 未接入则保持内置 PBKDF2 */ }
    // 本地账号：打开数据库 + 恢复会话（异步、失败静默 —— 未登录不影响任何功能）
    try { auth.init() } catch (e) { /* ignore */ }
    // 恢复用户选择的全局背景（写在 CSS 变量 --app-bg 上）
    try { theme.init() } catch (e) {}
    // 底部导航改为自绘悬浮胶囊，App 端隐藏原生 tabBar（H5 由全局样式隐藏）
    hideNativeTabBar()
    // 预热：App 端提前绑定系统 TTS 引擎，消除首次点击"重听"时的初始化延迟
    try { if (voice.warmup) voice.warmup() } catch (e) {}
    // 性能探测：跑一次 CPU + 分辨率测算，偏弱的机器自动打开流畅模式。
    // 延迟到封面之后 —— 探测要占用主线程约 60ms，别和首屏渲染抢。
    try {
      setTimeout(() => { autoDowngrade(false) }, 1500)
    } catch (e) {}
  },
  onShow() {
    // App 从后台回前台后原生 tabBar 可能复现，补一次隐藏
    hideNativeTabBar()
    // 回到前台时重算外观：系统深浅色可能已在后台被切换（部分端没有 onThemeChange）
    try { theme.apply() } catch (e) {}
    // 停留时长起表（首页那张圆环卡读它）；内部每 30s 自己落一次盘
    try { usage.start() } catch (e) {}
    // 从 AppDock 跳去别的 App 后回到前台：结算那段前台计时
    try { apptime.onAppShow() } catch (e) {}
  },
  onHide() {
    // 应用切后台：立即停止所有发声（AI 语音 + 原生 TTS + InnerAudioContext）
    try { voice.stop() } catch (e) {}
    // 答题音效同样是 InnerAudioContext，切后台要一起掐掉
    try { sfx.stop() } catch (e) {}
    // 结算"在前台"这段时长（杀进程时 onHide 可能不来，靠 30s 的定时落盘兜底）
    try { usage.stop() } catch (e) {}
    // 把节流窗口里没落盘的数据一次性写下去：
    // 切后台是唯一能保证来的一次时机，之后随时可能被系统杀掉
    try { aiCache.flush() } catch (e) {}
    try { pwFlush() } catch (e) {}
  }
}
</script>

<style>
/* 全局样式（设计令牌见 DESIGN.md · 简约高级） */
/* 背景统一读 --app-bg：由 utils/theme.js 在启动/切换时写入，支持纯色与渐变。
   它处于最底层，半透明玻璃卡片、顶部胶囊、底部胶囊都会透出这层背景。 */
page {
  background: var(--app-bg, #e4e9e4);
  /* 不写 background-attachment: fixed —— 这层只是兜底，真正的背景由下面
     .app-root::before 的 fixed 层在画，它永远盖在这层之上。
     而 fixed 背景在 Android WebView 上会逼着主线程逐帧重绘，是已知的滚动掉帧源，
     既然看不见就没必要付这笔开销。回弹露底由 uni.setBackgroundColor 兜住。 */
  min-height: 100vh;
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-size: 28rpx;
  line-height: 1.6;
  letter-spacing: 0.5rpx;
  font-family: -apple-system, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif;
}

/* 字体可由 AI 指令 theme.set{font} 切换。
   注意：--app-font 是 theme.rootStyle() 挂在**页面根节点**上的，CSS 变量只向下继承，
   所以这条只能写在根节点类（.app-root / .container）上，写在上面的 page 上取不到值。 */
.app-root,
.container,
.cover {
  font-family: var(--app-font, -apple-system, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif);
}

.container {
  padding: 32rpx 28rpx;
  box-sizing: border-box;
  /* 根节点兜底承担背景（App 端靠 inline style 挂背景图/深色底），撑满一屏 */
  min-height: 100vh;
}

/* ===== 背景层：滚动时纹丝不动 =====
   要求：上下滑动时只有窗体（卡片 / 胶囊）在动，背景不跟着走。
   做法：背景不画在会滚动的内容上，而是画在 position: fixed 的独立层里（::before / ::after），
   根节点自己再带一份同款背景作为兜底（某端不吃 inline 自定义属性时仍能生效；
   流畅模式下这份改成随内容滚动，避开 fixed 背景的逐帧重绘）。
   两层都是视口大小，滚动 / 回弹都不会露出白底。
   注意：根节点必须是层叠上下文，负 z-index 的伪元素才会落在"根节点背景之上、内容之下"。 */
.app-root {
  position: relative;
  z-index: 0;
}

/* 两层 fixed 背景：滚动时纹丝不动，只有窗体（卡片 / 胶囊）在动。
   变量由根节点 inline style 下发（App 端逻辑层没有 document，写不了 CSS 变量）；
   万一某端不吃 inline 自定义属性，根节点自己的背景（见 theme.rootStyle）就是兜底，结果一致。 */
.app-root::before,
.app-root::after {
  content: '';
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: -2;
  pointer-events: none;
}

/* 背景层：纯色 / 渐变 / 自定义图 */
.app-root::before {
  background-color: var(--bg-color, transparent);
  background-image: var(--bg-img, none);
  background-size: cover;
  background-position: center center;
  background-repeat: no-repeat;
}

/* 蒙版层：淡化（--bg-mask）+ 背景模糊（--bg-blur 走 backdrop-filter）。
   它盖在背景层之上、所有内容之下 —— 所以自定义图 / 渐变同样能被淡化和模糊，
   而卡片这些窗体在它之上，不会被蒙版洗白。 */
.app-root::after {
  z-index: -1;
  background: var(--bg-mask, transparent);
  /* 直接吃完整的 filter 值（theme.js 在模糊为 0 时下发 none）。
     写成 blur(0px) 也会建立 backdrop root 并逐帧读背景 —— 那正是要躲开的开销。 */
  -webkit-backdrop-filter: var(--bg-blur, none);
  backdrop-filter: var(--bg-blur, none);
}

/* 启动封面自带全屏底色，不叠背景层与蒙版 */
.cover.app-root::before,
.cover.app-root::after {
  display: none;
}

/* H5：让 body / html 也跟随背景变量，避免滚动到边缘时露出白底 */
/* #ifdef H5 */
html,
body {
  background: var(--app-bg, #e4e9e4);
  background-attachment: fixed;
  /* 切 tab 时内容会从屏幕外滑入，瞬间撑宽文档 → 禁止横向滚动条闪一下 */
  overflow-x: hidden;
}
/* #endif */

/* ===== 深色模式 ===== */
/* 主流做法不是"整体反色"，而是做六件事（页面样式已全部写成 var(--x, 原值)，
   所以这里只重定义变量，不需要逐条覆盖每个页面的类）：
   ① 底色用 #121212 一档的深灰（纯黑会让玻璃卡片和背景糊在一起，OLED 上更明显）
   ② 文本三档反转  ③ 半透明面板换成深色半透明
   ④ 发丝边从"白"改成"极淡的白"（直接沿用浅色的白边会非常刺眼）
   ⑤ 主色提亮，保证深色底上的对比度  ⑥ 背景图/渐变降亮度（蒙版由白改黑） */
/* ===== 窗体表面（浮在背景之上） =====
   卡片 / 胶囊 / 顶栏 / 底栏都是"浮在背景之上的窗体"：半透明表面 + backdrop-filter 模糊，
   能透出背景又和背景分层（这就是毛玻璃）。
   注意：窗体本身随页面滚动，但背景是固定不动的 —— 见下方 page 的固定背景层。 */
.app-dark {
  --ink-1: #eaf0ed;
  --ink-2: #a7b3ae;
  --ink-3: #74807b;
  --surface-rgb: 46, 52, 48;
  --hairline: rgba(255, 255, 255, 0.09);
  --neutral-rgb: 255, 255, 255;
  --shadow-rgb: 0, 0, 0;
  --solid: #1c211e;
  /* 打卡走势：红涨绿跌在深底上要提亮，否则红色会发闷、绿色会偏灰 */
  --ck-up: #ff7a7d;
  --ck-down: #4ade80;
  background: #121513;
  color: #eaf0ed;
}

/* App 端逻辑层没有 DOM，写不了 CSS 变量，主色的深色档只能在 CSS 里备一份。
   取值与 utils/theme.js 的 ACCENTS.*Dark 保持一致。 */
.app-dark.acc-blue { --brand: #6f9bff; --brand-strong: #9dbcff; --brand-rgb: 111, 155, 255; }
.app-dark.acc-teal { --brand: #2dd4bf; --brand-strong: #5eead4; --brand-rgb: 45, 212, 191; }
.app-dark.acc-green { --brand: #4ade80; --brand-strong: #86efac; --brand-rgb: 74, 222, 128; }
.app-dark.acc-purple { --brand: #a78bfa; --brand-strong: #c4b5fd; --brand-rgb: 167, 139, 250; }
.app-dark.acc-amber { --brand: #fbbf24; --brand-strong: #fcd34d; --brand-rgb: 251, 191, 36; }
.app-dark.acc-tomato { --brand: #f4755a; --brand-strong: #f9a189; --brand-rgb: 244, 117, 90; }
.app-dark.acc-rose { --brand: #f97c8a; --brand-strong: #fda6b0; --brand-rgb: 249, 124, 138; }
.app-dark.acc-graphite { --brand: #9aa7a0; --brand-strong: #c2ccc6; --brand-rgb: 154, 167, 160; }

/* ===== 顶部导航栏 ===== */
/* 已去掉原来的实色蓝条：导航栏底色与页面背景一致，标题/返回键转深色，
   视觉上不再出现"蓝色框"，同时保留原生返回与标题能力。 */
/* #ifdef H5 */
uni-page-head,
.uni-page-head {
  background-color: #e4e9e4 !important;
  box-shadow: none !important;
}

uni-page-head::after,
.uni-page-head::after,
uni-page-head::before,
.uni-page-head::before {
  display: none !important;
}
/* #endif */

/* ===== 系统弹窗统一圆角（H5） ===== */
/* uni.showModal / showActionSheet / showToast 在 H5 端是 DOM 渲染的，可以整体接管样式，
   与页面卡片共用同一套圆角、发丝边、投影与深色变量。
   App 端这三个 API 是原生弹窗（系统自绘圆角），CSS 管不到。 */
/* #ifdef H5 */
uni-modal .uni-modal {
  border-radius: 32rpx !important;
  overflow: hidden;
  background: #ffffff;
  background: var(--solid, #ffffff);
  box-shadow: 0 24rpx 64rpx rgba(23, 32, 26, 0.18);
  box-shadow: 0 24rpx 64rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.18);
}

uni-modal .uni-modal__hd,
uni-modal .uni-modal__title {
  padding-top: 40rpx;
}

uni-modal .uni-modal__title,
uni-modal .uni-modal__bd {
  color: #17201a;
  color: var(--ink-1, #17201a);
}

uni-modal .uni-modal__bd {
  padding: 24rpx 40rpx 40rpx;
  line-height: 1.65;
}

uni-modal .uni-modal__ft {
  border-top: 2rpx solid rgba(23, 32, 26, 0.08);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.08);
}

uni-modal .uni-modal__btn {
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  font-weight: 500;
}

uni-modal .uni-modal__btn_primary {
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  font-weight: 600;
}

/* 操作菜单（showActionSheet）同样圆角化 */
uni-actionsheet .uni-actionsheet {
  border-radius: 32rpx !important;
  overflow: hidden;
  background: #ffffff;
  background: var(--solid, #ffffff);
}

uni-actionsheet .uni-actionsheet__cell {
  color: #17201a;
  color: var(--ink-1, #17201a);
}

/* 轻提示（showToast）胶囊化 */
uni-toast .uni-toast,
uni-toast .uni-sample-toast {
  border-radius: 999rpx !important;
  background: rgba(23, 32, 26, 0.82);
  color: #ffffff;
}
/* #endif */

/* ===== 统一弹窗 =====
   全 App 的确认框 / 操作菜单 / 输入框共用这一套（组件见 components/app-dialog）。
   之前每个页面各抄一份 .pop-mask/.pop-card，宽高 padding 各不相同，
   改一处漏一处 —— 现在收敛到这里，页面只写自己的内容类。 */
.pop-mask {
  position: fixed;
  left: 0; top: 0; right: 0; bottom: 0;
  background: rgba(23, 32, 26, 0.38);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.38);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.pop-card {
  width: 76%;
  background: rgba(255, 255, 255, 0.82);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.82);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.75);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.75));
  border-radius: 32rpx;
  padding: 48rpx 40rpx 36rpx;
  text-align: center;
  box-shadow: 0 20rpx 60rpx rgba(23, 32, 26, 0.16);
  box-shadow: 0 20rpx 60rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.16);
}

.dlg-title {
  text-align: center;
  font-size: 30rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.dlg-input {
  margin-top: 28rpx;
  /* 卡片整体居中，输入框要显式左对齐，否则光标和文字都跑中间 */
  text-align: left;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 18rpx 22rpx;
  font-size: 27rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.dlg-err {
  margin-top: 14rpx;
  font-size: 23rpx;
  color: #e5484d;
  text-align: center;
}

.dlg-btns {
  display: flex;
  margin-top: 32rpx;
}

.dlg-btn {
  flex: 1;
  height: 76rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 27rpx;
  font-weight: 500;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  border-radius: 999rpx;
}

.dlg-btn.ghost {
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  margin-right: 18rpx;
}

.dlg-btn.primary {
  /* 主按钮不做实心大色块：淡红底 + 深红字 + 红描边（和启动页"红只做点缀"一个思路），
     实心主色留给进度条、开关、选中态这些小元素 */
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  border: 2rpx solid rgba(228, 23, 61, 0.4);
  border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.4);
}

/* 危险操作（删除 / 重置 / 退出）：统一用 --danger，不再各写各的红色 */
.dlg-btn.danger {
  color: #ffffff;
  background: #e5484d;
}

.dlg-btn.ghost:active { opacity: 0.75; }
.dlg-btn.primary:active { opacity: 0.86; }
.dlg-btn.danger:active { opacity: 0.86; }

/* 不支持 backdrop-filter 的端：调实表面，避免"半透明但没模糊"的糊底观感 */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .pop-card {
    background: rgba(var(--surface-rgb, 255, 255, 255), 0.94);
  }
}

/* ===== bg-flat：背景是平滑渐变时，卡片不做实时模糊 =====
   backdrop-filter 的成本 = 每一帧都要把窗体背后的像素读回来做一次高斯模糊。
   卡片数量多、面积大，滚动时每张卡的背景区域都在变 → 每帧重算 N 次，这是掉帧主因。
   但背景预设全是平滑渐变：渐变本身就是低频信号，**模糊后的渐变和原渐变肉眼没有差别**，
   这笔开销买不到任何观感。所以没有自定义背景图时（theme.js 下发 bg-flat）：
     ① 卡片 / 玻璃面板：只留半透明，关掉模糊 → 层次感不变，开销归零
     ② 顶栏 / 底栏胶囊 / 弹窗：面积小且叠在滚动内容之上（模糊才有意义），保留
   自定义背景图时不加这个类 —— 照片有高频细节，模糊才看得出差别。 */
.bg-flat,
.bg-flat *,
.bg-flat *::before,
.bg-flat *::after {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

/* 例外：这些是浮在滚动内容之上的固定窗体，成本可控且模糊有意义 */
.bg-flat .fnb,
.bg-flat .fnb-search,
.bg-flat .ftb,
.bg-flat .pop-card,
.bg-flat .dlg-input,
.bg-flat .dlg-btn.ghost {
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%)) !important;
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%)) !important;
}

/* ===== 流畅模式（低端机的退路） =====
   只做三件事，不牺牲"半透明玻璃"的观感：
     ① backdrop-filter 全树置 none —— 这是唯一真正的绘制热点，
        每一帧都要把窗体背后的区域重做一次高斯模糊
     ② 表面调实到 0.94 —— 没有模糊打底，太透会和背景糊在一起，
        调实后文字清晰，同时仍能透出背景色 → 层次感保留
     ③ 过渡 / 动效缩短 —— 反馈还在，但不拖帧
   背景层本身不动（fixed），不参与逐帧重绘，所以不在这里动它。 */
.perf-smooth,
.perf-smooth::before,
.perf-smooth::after,
.perf-smooth *,
.perf-smooth *::before,
.perf-smooth *::after {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

/* 无模糊 → 表面调实，保证可读性 */
.perf-smooth .card,
.perf-smooth .glass,
.perf-smooth .pop-card {
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.94);
  box-shadow: 0 6rpx 18rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.07);
}

/* 大半径投影同样是逐帧的模糊计算（12rpx~64rpx 的 blur 每帧都要重画），
   流畅模式下一并收小：层次还在，但不再吃 GPU 带宽 */
.perf-smooth .card,
.perf-smooth .glass,
.perf-smooth .ftb,
.perf-smooth .fnb,
.perf-smooth .pop-card {
  box-shadow: 0 4rpx 12rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.07) !important;
}

.perf-smooth .page-slide { transition-duration: 120ms; }
.perf-smooth .ftb-ind { transition-duration: 120ms; }
.perf-smooth .slide-in-right,
.perf-smooth .slide-in-left { animation-duration: 140ms; }

/* ===== 画质档位：毛玻璃 / 动效 / 阴影 三档 =====
   三档由 utils/perf.js 探测后写进 settings.performance.fx，theme.rootClass() 落成
   下面的 fx-* class；毛玻璃半径走 --glass-sm / --glass-lg 两个变量下发，所以项目里
   那 112 处 backdrop-filter 不用逐个改，换档只是换变量值。
   与「流畅模式」的区别：流畅模式是一刀切的总开关，档位是梯度下调，
   中端机可以只砍一半开销而保留玻璃层次。两者叠加时以更严的为准。 */

/* 毛玻璃 = 仅关键处（轻量档）：变量已经全树关掉，这里只给大面积且常年浮在滚动
   内容之上的窗体恢复模糊 —— 面积小、数量固定（顶栏 / 底栏 / 弹窗），成本可控，
   而它们恰好是"玻璃感"最容易被察觉的位置。卡片那种数量多、面积随内容变的
   一律不模糊，那才是掉帧的主因。 */
.fx-glass-key .fnb,
.fx-glass-key .ftb,
.fx-glass-key .pop-card {
  /* 走变量而不是写死 12px：这些窗体虽然在 every档都保留模糊，
     但半径仍要跟着画质档走（例如高画质档会给更大的 blur） */
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%)) !important;
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%)) !important;
}

/* 动效 = 精简（均衡 / 轻量档）：保留反馈，只把时长压短 */
.fx-motion-reduced .page-slide,
.fx-motion-reduced .ftb-ind { transition-duration: 140ms; }
.fx-motion-reduced .slide-in-right,
.fx-motion-reduced .slide-in-left { animation-duration: 160ms; }
/* 纯装饰的循环动画停掉：引导挖洞的呼吸描边、封面光晕 —— 它们在 offscreen
   也照样逐帧跑，停了对信息传达没有任何损失 */
.fx-motion-reduced .gd-hole,
.fx-motion-reduced .ring,
.fx-motion-reduced .float { animation: none !important; }
/* 紧迫度卡的光晕是装饰（核心那一下呼吸才是"有多赶"的信号），
   停掉光晕不影响读图；核心呼吸与时间条的闪烁一律保留 —— 它们跟加载指示器
   一样是语义信号，关了用户就看不出今天排不排得下。 */
.fx-motion-reduced .ug-halo,
.fx-motion-reduced .urg-alarm .ug-ring { animation: none !important; }
.fx-motion-reduced .ug-need { transition-duration: 140ms; }

/* 动效 = 关闭（极简档）：不再有任何过渡与动画。
   注意：加载指示器（.sr-spin / .spin / .fnb-rotate / .cmd-rotate 等）一律不关 ——
   那是"正在忙"的语义信号，关掉用户会以为程序卡死。这里只显式列出装饰性的动画。 */
.fx-motion-off .page-slide,
.fx-motion-off .ftb-ind,
.fx-motion-off .gd-tip { transition: none !important; }
.fx-motion-off .slide-in-right,
.fx-motion-off .slide-in-left,
.fx-motion-off .gd-hole,
.fx-motion-off .ring,
.fx-motion-off .float,
.fx-motion-off .load-fill { animation: none !important; }
/* 同上：光晕与告急光环停掉，核心呼吸（ug-core）与"排不下"的闪烁（ug-need-over）
   保留 —— 这两条是这张卡要说的话，不是装饰。 */
.fx-motion-off .ug-halo,
.fx-motion-off .urg-alarm .ug-ring { animation: none !important; }
.fx-motion-off .ug-need { transition: none !important; }

/* 阴影 = 收窄（均衡 / 轻量档）：大半径投影同样是逐帧高斯，半径压到三分之一 */
.fx-shadow-slim .card,
.fx-shadow-slim .glass,
.fx-shadow-slim .ftb,
.fx-shadow-slim .fnb,
.fx-shadow-slim .pop-card {
  box-shadow: 0 4rpx 12rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.07) !important;
}

/* 阴影 = 无（极简档）：靠发丝边把窗体从背景里分出来，避免完全糊在一起 */
.fx-shadow-none .card,
.fx-shadow-none .glass,
.fx-shadow-none .ftb,
.fx-shadow-none .fnb,
.fx-shadow-none .pop-card {
  box-shadow: none !important;
  border-color: rgba(var(--shadow-rgb, 23, 32, 26), 0.1);
}

/* ===== 切页动画：只在动画期间提升为合成层 =====
   .page-slide 是一个整页大小的容器，动画时每一帧都要重新光栅化它下面的所有内容
   （尤其里面有毛玻璃卡片）。动画开始前挂 will-change 让它单独成层，动画结束
   class 被摘掉（见 tab-slide-mixin），will-change 随即消失 —— 不会长期占着显存。 */
.slide-in-right,
.slide-in-left {
  will-change: transform;
  backface-visibility: hidden;
}

/* ===== 悬浮 tabBar（components/float-tabbar）===== */
/* H5：原生 tabBar 用 CSS 直接隐藏，零闪烁；App 端见 utils/nav.js */
/* #ifdef H5 */
uni-tabbar,
.uni-tabbar,
.uni-tabbar-bottom {
  display: none !important;
}
/* #endif */

/* tab 页底部留白，保证最后一个元素能滚出悬浮胶囊的遮挡区。
   env(safe-area-inset-bottom) 在安卓 WebView 上常常是 0，所以再叠一份
   逻辑层算好的 --safe-bottom（utils/insets.js → theme.rootStyle() 下发）。 */
.page-tabbar {
  padding-bottom: calc(220rpx + var(--safe-bottom, 0px) + constant(safe-area-inset-bottom));
  padding-bottom: calc(220rpx + var(--safe-bottom, 0px) + env(safe-area-inset-bottom));
}

/* 使用自定义悬浮顶栏（components/float-navbar）的页面：顶部预留状态栏 + 胶囊高度。
   custom 导航栏在 App 端是沉浸式的 —— 状态栏盖在页面上，这一块必须自己让出来，
   否则内容顶到时钟/电量下面，那一带还点不动（点击被系统状态栏吃掉）。
   --status-bar-height 由 theme.rootStyle() 按机型实测下发（见 utils/insets.js）；
   页面根节点漏了这个类就会重现上面的重叠，所以新增页面务必带上 page-nav。 */
.page-nav {
  padding-top: calc(var(--status-bar-height, 0px) + 136rpx);
}

/* ===== 统一视觉语言：悬浮窗体 ===== */
/* 所有"方框/卡片"与顶部、底部胶囊共用一套令牌：
   半透明表面（--surface-rgb）+ 背景模糊（backdrop-filter）+ 投影 + 发丝边 + 大圆角。
   窗体是浮在背景之上的独立层：能透出背景、和背景分层，但自身始终保持在背景"前面"。 */
.card {
  background: #ffffff;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border-radius: 28rpx;
  padding: 40rpx 36rpx;
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
  box-shadow: 0 12rpx 36rpx rgba(23, 32, 26, 0.1), 0 2rpx 8rpx rgba(23, 32, 26, 0.05);
  box-shadow: 0 12rpx 36rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.1), 0 2rpx 8rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.05);
  box-sizing: border-box;
}

/* 通用窗体块：分段器 / 输入框 / 气泡 / 弹窗 / 内嵌面板等非 .card 方框 */
.glass {
  background: #ffffff;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
  border-radius: 20rpx;
  box-shadow: 0 6rpx 20rpx rgba(23, 32, 26, 0.07);
  box-shadow: 0 6rpx 20rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.07);
}

/* 不支持 backdrop-filter 的端：把表面调实一点，避免"半透明但没模糊"的糊底观感 */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .card,
  .glass {
    background: rgba(var(--surface-rgb, 255, 255, 255), 0.94);
  }
}

/* ===== tab 页内容左右滑动 =====
   切 tab 时内容区按方向滑入：目标索引更大 → 从右滑入，更小 → 从左滑入。
   手势拖拽时 .dragging 关掉过渡让内容跟手，松手后靠默认过渡弹回。
   动画放完必须摘掉 class（见 utils/tab-slide-mixin.js），
   让 transform 归零 —— 否则 fixed 元素会一直以包裹层为参照。 */
.page-slide {
  transition: transform 200ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.page-slide.dragging {
  transition: none;
  /* 跟手期间整页随手指平移，同样让它单独成层（松手摘掉 class 即失效） */
  will-change: transform;
  backface-visibility: hidden;
}

.slide-in-right {
  animation: slide-in-right 260ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.slide-in-left {
  animation: slide-in-left 260ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

@keyframes slide-in-right {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

@keyframes slide-in-left {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}

@media (prefers-reduced-motion: reduce) {
  .page-slide,
  .ftb-ind {
    transition: none !important;
  }
  .slide-in-right,
  .slide-in-left {
    animation: none !important;
  }
}

/* 主按钮（各页的主行动键：开始专注 / 生成计划 / 提交收工…）
   与 .dlg-btn.primary 同一套"淡红底 + 深红字"处理，不再用实心大红块 */
.btn-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  border: 2rpx solid rgba(228, 23, 61, 0.4);
  border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.4);
  border-radius: 999rpx;
  font-size: 32rpx;
  font-weight: 500;
  letter-spacing: 2rpx;
  text-indent: 2rpx;
  height: 96rpx;
}
.btn-primary::after { border: none; }
.btn-primary[disabled] {
  background: #a9c3ff;
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.45);
  color: #ffffff;
}

/* 幽灵按钮：胶囊形 + 半透明玻璃，与底部导航栏同一语言 */
.btn-ghost {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  border: 2rpx solid rgba(228, 23, 61, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.34);
  border-radius: 999rpx;
  font-size: 32rpx;
  font-weight: 500;
  letter-spacing: 2rpx;
  text-indent: 2rpx;
  height: 96rpx;
}
.btn-ghost::after { border: none; }

/* 标签 */
.tag {
  font-size: 22rpx;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  padding: 6rpx 18rpx;
  border-radius: 999rpx;
  display: inline-block;
  flex-shrink: 0;
}

/* 进度条：轨道做成内凹的浅槽，与玻璃面板协调 */
.progress-track {
  height: 12rpx;
  background: rgba(23, 32, 26, 0.08);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.08);
  border-radius: 999rpx;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: #e4173d;
  background: var(--brand, #e4173d);
  border-radius: 999rpx;
  transition: width 0.3s ease;
}
</style>
