// utils/settings.js - 应用设置 / 个人资料 / 收藏 的本地状态
// 独立于学习进度（store.js），单独存一个 storage key，互不干扰。
// 所有 AI 相关密钥仅存于此处（或部署环境变量），源码不出现任何字面量密钥。

const KEY = 'fj_app_settings_v1';
let cache = null;

// 未设置昵称时的默认显示（与 pages/profile/profile.vue 的 DEFAULT_NICKNAME 保持一致）
const DEFAULT_NICKNAME = 'plana';
// 老版本沿用过的默认昵称，仅用于一次性迁移（arona 是上一个 App 的默认值）
const LEGACY_NICKNAMES = ['学习者', 'arona'];
// 出厂主题色换过几轮（blue → rose → teal → tomato → 回到 rose）、
// 出厂背景换过两轮（sakura → mint → sand）。只把"从没自己挑过"的那批迁到当前出厂色：
// 命中旧出厂值才算没挑过，用户亲手选的颜色一律不动。
const LEGACY_ACCENTS = ['blue', 'teal', 'tomato'];
const LEGACY_BACKGROUNDS = ['sakura', 'mint'];

function defaults() {
  return {
    // 界面语言：'zh' | 'en'（见 utils/i18n.js）。
    // zh 态直接显示中文原文，en 态查 utils/i18n-en.js —— 查不到就回退中文。
    locale: 'zh',
    // 个人资料（纯本地，无后端）；改默认值时记得同步 pages/profile/profile.vue 的 DEFAULT_NICKNAME
    profile: { avatar: '', nickname: DEFAULT_NICKNAME, account: '', bio: '' },
    // 收藏：{ type:'word'|'sentence', id, word?, en?, zh? }
    favorites: [],
    // 首页模块顺序（可自定义 / 收纳），id 见 utils/home-layout.ts 的 MODULES。
    // 默认留空 → 由 home-layout 的 defaultLayout() 决定，保证新增模块能自动出现在首页。
    // seenBuiltins：这张首页"见过"哪些内置卡（见 page-doc.js 的 ensureBuiltins），
    // 用来区分「新模块还没加进来」和「用户自己收纳掉了」—— 后者不能再塞回去。
    // 默认 null（不是 []）：表示"从没记过"= 老数据，新增模块才需要补进来。
    home: { layout: [], seenBuiltins: null },
    // 新手引导：字段先留着（历史上可能有用户存过），步骤与遮罩已随背单词
    // 一起挪到 _removed_vocab/，当前没有渲染方 —— 等 PWstudy 自己的引导回来再启用。
    // v 记步骤版本，以后改版可以据此让老用户再看一次；设置页可「重看」。
    onboarding: { done: false, v: 0, at: 0 },
    // 通知
    notifications: { daily: false, time: '20:00' },
    // 权限与后台保活向导（见 utils/setup.js / pkgManage/pages/setup/setup.vue）
    //   done    四项都过了（或用户主动跳过）→ 首页不再提醒
    //   promptAt 上次弹首次提醒的时间戳，避免每次进 App 都弹
    setup: { done: false, promptAt: 0 },
    // 彩蛋：连点设置 › 关于 › 版本 触发。found 只是"被发现过几次"的计数，
    // 纯粹为了让第 N 次打开时的台词不一样，不影响任何功能。
    egg: { found: 0 },
    // 隐私
    privacy: { storeLocal: true },
    // 伙伴 App（背单词 App）关联 —— 完整设计见 uniapp/docs/partner-link.md
    //   state      undecided 未决定 / linked 已关联 / declined 已关闭（用户主动不选）
    //   askedCount 已自动询问过几次（上限见 utils/partner.js 的 ASK_MAX，防骚扰）
    //   lastAskAt  上次自动询问时间戳（间隔不够就不问）
    //   lastSyncAt 上次真正收到回传数据的时间 —— 用来回答"关联了到底有没有在同步"
    // ⚠️ 取消关联落到 declined，而不是退回 undecided：
    //    否则下次启动又会重新弹一遍那张首次提示 —— 用户刚明确取消、转头又被问，最招人烦
    partner: { v: 1, state: 'undecided', askedCount: 0, lastAskAt: 0, linkedAt: 0, lastSyncAt: 0, lastWords: 0 },
    // 在线模式（以后接服务器用）。**现在没有服务器 → 默认关**，App 完全跑本地，
    // 功能一条不少（跟伙伴 App 联动同一个原则：可选增强，关了不缺功能）。
    // 服务端就绪后只要两步：填 baseUrl + 打开 enabled。这部分全是 JS/TS，
    // 走 wgt 就能更新 —— 服务端契约见 uniapp/docs/online-mode.md。
    //   deviceId   本机标识（多设备同步时区分来源），首次用到时生成
    //   userId     服务端侧的用户 id（登录后回写，不是本地 uuid）
    //   lastSyncAt 上次成功同步的时间戳（增量拉取的 since）
    //   lastError  上次同步的错误摘要 —— 用户问"为什么没同步上"时有的答
    online: { enabled: false, baseUrl: '', deviceId: '', userId: '', lastSyncAt: 0, lastError: '' },
    // 外观：主题色 / 背景（key 见 utils/theme.js 的 ACCENTS 与 BACKGROUNDS）
    theme: {
      // 主题色：绯红（rose，启动页同款）。红色调为主的定调 + 红只做小面积点缀：
      // 大按钮一律"淡红底 + 深红字 + 红描边"（见 App.vue 的 .btn-primary / .dlg-btn.primary），
      // 实心绯红只出现在进度条、开关、选中态这些小元素上 —— 大块实心红就是"像经期 App"的根源。
      accent: 'rose',
      background: 'sand', // 背景预设（暖砂渐变，PWstudy 出厂默认；'custom' = 用下面这个自定义色）
      bgColor: '',         // 自定义底色（#rrggbb；空 = 还没挑过，用 DEFAULT_CUSTOM）
      bgImage: '',         // 自定义背景图（本地路径，空则用预设）
      bgMask: 0.35,        // 背景图上的蒙版强度（0-0.8；浅色叠白、深色叠黑）
      bgBlur: 0,           // 背景模糊半径（px，0-24）
      dark: false,         // 深色模式（followSystem 为 true 时被系统值覆盖）
      followSystem: false, // 跟随系统深色模式
      font: 'system',      // 字体：system | serif | rounded（AI 指令 theme.set 可改）
      density: 'cozy'      // 密度：compact | cozy | relaxed（AI 指令 theme.set 可改）
    },
    // 性能：画质档位 + 流畅模式总开关 —— 低端机的退路，
    // 只影响观感，不改变任何功能与数据。
    //   smooth  旧的一刀切开关（== 档位里的 lightweight / minimal），保留做总开关
    //   其它探测字段（probed/auto/cpu/px/tier/score）由 utils/perf.js 首次探测写入
    //   manual  用户亲手拨过 → 自动检测不再改这个值
    //   quality 用户选的档位：'auto' 跟随探测结果，或 high/balanced/lite/minimal
    //   level   quality 解析后的实际档位（auto 消解掉）
    //   fx      合成后的三个维度 + 两级模糊半径，theme.js 直接读它下发 CSS 变量
    //   fxOverride 在档位之上单独改过的维度（改回档位默认值时该项会被删掉）
    performance: {
      smooth: false,
      probed: false,
      auto: false,
      manual: false,
      cpu: 0,
      px: 0,
      tier: '',
      score: 0,
      quality: 'auto',
      level: 'high',
      fx: { glass: 'full', motion: 'full', shadow: 'full', blurSm: 8, blurLg: 12, maxBgBlur: 24 },
      fxOverride: {}
    },
    // 朗读偏好
    voice: {
      chineseRead: true,   // 自动朗读中文
      englishRead: true,   // 自动朗读英文
      speed: 1.0,          // 本地语音语速（原生/有道）
      engine: 'auto',      // 整句朗读引擎：auto 系统优先 / native 只用系统 / online 只用在线
      useAI: false,        // 是否启用云端 AI 朗读
      sfx: true            // 答题音效（答对/半对/答错各一声，见 utils/sfx.js）
    },
    // 专注（番茄钟）行为
    //   notify   结束 / 中断时发系统通知，并常驻显示倒计时（默认开）
    //   sound    结束时响一声（复用 sfx 的 correct）
    //   vibe     结束时震动
    //   wakeLock 息屏保持 CPU（更准，但更费电，默认关）
    //   strict   严格模式：只在番茄进行中生效，切到非学习 App 就提醒（默认关）
    //   fgservice 前台服务保活：计时期间常驻前台服务，息屏/后台进程不被杀（默认开；
    //             需自定义基座/云打包才生效，标准基座自动降级为常驻通知）
    //   noise    专注白噪音音色：'' 关 | white | pink | brown | rain（默认关）
    focus: {
      notify: true,
      sound: true,
      vibe: true,
      wakeLock: false,
      // 严格模式：专注时打开非学习 App → 提醒，30 秒不回来本次作废（管记账）
      strict: false,
      // 强制模式：专注时打开非学习 App → 立刻把 PWstudy 拉回前台，连续 3 次作废（管行为）
      // 需要「使用情况访问」权限；原生拉回依赖 UTS 插件，标准基座下退化为"只提醒"
      forced: false,
      // 后台保活：计时期间常驻前台服务。默认开 —— 息屏被杀后台会直接毁掉计时准确性
      fgservice: true,
      noise: ''
    },
    // AI 规划偏好
    //   res  规划任务时让 AI 顺手附学习资料/工具建议（默认关：普通资料名不上网核实，
    //        但多少有参考价值；不想要噪音的用户保持关闭）
    //   slot 规划任务时把任务排进早 / 中 / 晚（默认开）。关掉 = 纯任务规划（原模式），
    //        只是不再产出时段，**已有时段数据不清**，随时开回来还在。见 utils/timeslot.js
    //   slotNotify 时段到了发一条"该开始了"（默认开）。slot 关着时它自然不起作用
    plan: {
      res: false,
      slot: true,
      slotNotify: true
    },
    // 更新（wgt 热更新 + 完整包兜底，见 utils/updater.js）
    //   auto        启动后自检一次（默认开；一天最多一次，失败静默）
    //   lastCheckAt 上次自检的日期（节流用）
    //   skip        用户点过「稍后」的版本号（当天不再拿同一个版本烦他）
    update: {
      auto: true,
      lastCheckAt: '',
      skip: '',
      // 上次检查到的可用更新（给「我的」页的红点和首页弹窗看）。
      // ⚠️ 为什么存 storage 而不是放内存：自检一天一次，节流期间根本不发请求 ——
      //    内存里的"有更新"会在重启之后莫名其妙没了，红点就闪一下又消失，
      //    比一直不亮还怪。
      // 红点怎么消失：**不靠"记一笔看过了"**，而是每次读的时候拿它跟本机版本比 ——
      // 装完新版，记的版本号自然就不再比本机新，红点自己没了。零维护，
      // 也不会有"标记漏清"这种脏数据。
      pending: { version: '', code: 0, minNative: 0, url: '', size: 0, notes: '', state: '' }
    },
    // AI 服务配置（统一服务层读取）
    ai: {
      enabled: false,
      provider: 'openai',  // openai | custom（均为 OpenAI 兼容接口）
      baseURL: '',
      apiKey: '',
      model: '',           // 大模型（例句生成），空则用环境变量默认
      ttsModel: '',        // 语音模型，空则默认 tts-1
      ttsVoice: 'alloy',   // 音色
      ttsSpeed: 1.0,       // 云端语速
      customTTS: false     // 仅 provider=custom 时生效：用户声明该地址提供 /audio/speech
    }
  };
}

function deepMerge(base, over) {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base)) return Array.isArray(over) ? over.slice() : base;
  if (typeof base === 'object' && base !== null && typeof over === 'object' && over !== null) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(over).forEach(k => {
      out[k] = (k in base) ? deepMerge(base[k], over[k]) : over[k];
    });
    return out;
  }
  return over;
}

function load() {
  try {
    const v = uni.getStorageSync(KEY);
    if (v && typeof v === 'object') {
      const st = deepMerge(defaults(), v);
      // 迁移：老版本把默认昵称写死成「学习者」，改默认值后老数据不会自动跟着变，
      // 所以读档时兜一次 —— 只动"从没改过昵称 / 昵称为空"的那批，
      // 用户自己设过的名字一律不动。
      const nick = st.profile && typeof st.profile.nickname === 'string'
        ? st.profile.nickname.trim() : '';
      // 连旧 App 的默认昵称（arona）也算"从没改过"，老用户升级后同样显示新默认值
      if (!nick || LEGACY_NICKNAMES.indexOf(nick) >= 0) {
        st.profile = Object.assign({}, st.profile, { nickname: DEFAULT_NICKNAME });
        // 同一批"从未个性化"的用户，主题色与背景一起迁到当前出厂色（见 LEGACY_ACCENTS）
        if (st.theme && LEGACY_ACCENTS.indexOf(st.theme.accent) >= 0) st.theme.accent = 'rose';
        if (st.theme && LEGACY_BACKGROUNDS.indexOf(st.theme.background) >= 0) st.theme.background = 'sand';
        cache = st;
        save();
      }
      return st;
    }
  } catch (e) {
    console.error('读取设置失败', e);
  }
  return defaults();
}

function init() {
  cache = load();
  if (!cache.profile.account) {
    cache.profile.account = 'local_' + Math.random().toString(36).slice(2, 10);
    save();
  }
}

function get() {
  if (!cache) cache = load();
  return cache;
}

function save() {
  try { uni.setStorageSync(KEY, cache); } catch (e) { console.error('保存设置失败', e); }
}

// patch 形式更新（浅层合并即可，调用方传完整子对象）
function set(patch) {
  const next = deepMerge(get(), patch);
  cache = next;
  save();
  return next;
}

function reset() {
  cache = defaults();
  try { uni.removeStorageSync(KEY); } catch (e) {}
  // 重置后补一个本地账号
  init();
  return cache;
}

// ---------- 收藏 ----------
function favorites() {
  return get().favorites || [];
}

function isFavorite(type, id) {
  return favorites().some(f => f.type === type && f.id === id);
}

function addFavorite(item) {
  const list = favorites();
  if (list.some(f => f.type === item.type && f.id === item.id)) return list;
  list.push(item);
  set({ favorites: list });
  return list;
}

function removeFavorite(type, id) {
  const list = favorites().filter(f => !(f.type === type && f.id === id));
  set({ favorites: list });
  return list;
}

function toggleFavorite(item) {
  return isFavorite(item.type, item.id) ? removeFavorite(item.type, item.id) : addFavorite(item);
}

export {
  init, get, set, save, reset,
  defaults,
  favorites, isFavorite, addFavorite, removeFavorite, toggleFavorite
};
