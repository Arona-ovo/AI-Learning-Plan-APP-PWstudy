<template>
  <view class="container page-nav as-page" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('填写 API')" :back="true" />

    <!-- 为什么非得填：一句话说清"不填会怎样"，比一堆技术名词有用 -->
    <view class="card as-why">
      <text class="as-why-t">{{ $t('AI 是这个 App 的大脑') }}</text>
      <text class="as-why-b">{{ $t('定目标时把远期目标拆成每天的日程、收工时听你说一句就重排明天的安排、点评你今天跑得怎么样 —— 这些都要调大模型。填一次，以后不用再管。') }}</text>
      <view class="as-why-note">
        <text class="as-dot">·</text>
        <text class="as-why-k">{{ $t('密钥只存在这台手机上，直连你选的服务商，不经过我们') }}</text>
      </view>
      <view class="as-why-note">
        <text class="as-dot">·</text>
        <text class="as-why-k">{{ $t('不填也能用：专注计时、日程、统计都是本地的，只是 AI 那几处会停用') }}</text>
      </view>
    </view>

    <!-- 已经配好了：上来先给结论，别让人以为要重填 -->
    <view v-if="configured" class="card as-done">
      <view class="as-done-head">
        <text class="as-done-dot"></text>
        <text class="as-done-t">{{ $t('已经配置好了') }}</text>
        <text class="as-done-s">{{ maskedKey }}</text>
      </view>
      <text class="as-done-b">{{ $t('要换服务商或密钥，直接改下面几项再点保存。') }}</text>
    </view>

    <!-- ① 服务商 -->
    <view class="card as-sec">
      <view class="as-sec-head">
        <text class="as-no">1</text>
        <text class="as-sec-t">{{ $t('选服务商') }}</text>
      </view>
      <view class="as-chips">
        <view
          v-for="p in providers"
          :key="p.value"
          class="as-chip"
          :class="{ on: form.provider === p.value }"
          @tap="pickProvider(p)"
        >{{ p.name }}</view>
      </view>
      <text class="as-hint">{{ providerHint }}</text>
    </view>

    <!-- ② 密钥 -->
    <view class="card as-sec">
      <view class="as-sec-head">
        <text class="as-no">2</text>
        <text class="as-sec-t">{{ $t('粘贴 API Key') }}</text>
      </view>
      <view class="as-key">
        <input
          class="as-key-input"
          :value="form.apiKey"
          :password="!showKey"
          :placeholder="$t('sk- 开头的那一长串')"
          placeholder-class="as-ph"
          @input="onKeyInput"
        />
        <text class="as-key-eye" @tap="showKey = !showKey">{{ showKey ? $t('隐藏') : $t('显示') }}</text>
      </view>
      <view class="as-key-acts">
        <text class="as-link" @tap="pasteKey">{{ $t('从剪贴板粘贴') }}</text>
        <text v-if="keyPage" class="as-link" @tap="openKeyPage">{{ $t('去申请一个') }} ›</text>
      </view>
      <text v-if="keyWarn" class="as-warn">{{ keyWarn }}</text>
    </view>

    <!-- ③ 地址与模型：默认折叠。预设已经填好，绝大多数人不用动 -->
    <view class="card as-sec">
      <view class="as-adv-head" @tap="adv = !adv">
        <view class="as-sec-head as-sec-head-flat">
          <text class="as-no">3</text>
          <text class="as-sec-t">{{ $t('地址与模型') }}</text>
        </view>
        <text class="as-adv-t">{{ adv ? $t('收起') : $t('默认就行，点开可改') }}</text>
      </view>
      <template v-if="adv">
        <view class="as-field">
          <text class="as-label">{{ $t('API 地址') }}</text>
          <input
            class="as-input"
            :value="form.baseURL"
            :placeholder="$t('如 https://api.openai.com/v1')"
            placeholder-class="as-ph"
            @input="e => onField('baseURL', e)"
          />
        </view>
        <view class="as-field">
          <text class="as-label">{{ $t('模型') }}</text>
          <input
            class="as-input"
            :value="form.model"
            :placeholder="$t('如 gpt-4o-mini / deepseek-chat')"
            placeholder-class="as-ph"
            @input="e => onField('model', e)"
          />
        </view>
        <text class="as-hint">{{ $t('用的是 OpenAI 兼容接口；中转 / 自建地址填根地址即可，会自动补 /chat/completions。') }}</text>
      </template>
    </view>

    <!-- 测试结果：成功绿、失败红，失败时把原因原样摊开（"连接失败"四个字帮不上忙） -->
    <view v-if="result" class="card as-res" :class="result.ok ? 'as-res-ok' : 'as-res-bad'">
      <text class="as-res-t">{{ result.ok ? $t('测试通过') : $t('没测通') }}</text>
      <text class="as-res-b">{{ result.msg }}</text>
    </view>

    <button class="btn-primary as-go" :disabled="!canSave || busy" @tap="save">
      {{ busy ? $t('正在测试…') : (configured ? $t('保存并重新测试') : $t('测试并保存')) }}
    </button>
    <text class="as-foot">{{ $t('测通之后，AI 规划、对话、点评就都能用了。以后想改：我的 › 设置 › AI 服务。') }}</text>
  </view>
</template>

<script>
// pkgManage/pages/ai-setup - 填 API 的专用页（第一次用、以及首页那张提醒卡都落到这里）
//
// 为什么单开一页，而不是把人指到「设置 › AI 服务」：
//   那边的路径是 开关（默认关）→ 展开「连接参数」→ 四个输入框，四层折叠；
//   新用户在里面迷路的概率远高于配完的概率。这里把它压成三步：
//   选服务商（预设带好了地址和模型）→ 粘 Key → 测通保存。
//
// 复用而非重写：服务商预设 / 地址归一 / 格式校验 / 真连通测试全部走 services/
// （PROVIDER_PRESETS、chatEndpoint、validateKeyFormat、testAIConnection），
// 与设置页同一套判定 —— 免得"这边说可用、那边说不通"。
import { t } from '../../../utils/i18n.js'
import * as settings from '../../../utils/settings.js'
import { PROVIDER_PRESETS, providerPreset } from '../../../services/config.js'
import { validateKeyFormat, testAIConnection } from '../../../services/ai-content.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

// 各家申请 Key 的控制台地址。Key 永远是用户自己申请，我们不代发、不代管。
const KEY_PAGES = {
  openai: 'https://platform.openai.com/api-keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
  moonshot: 'https://platform.moonshot.cn/console/api-keys',
  qwen: 'https://bailian.console.aliyun.com/?tab=model#/api-key'
}

/**
 * 读当前落盘的 AI 配置。
 * ⚠️ 写成模块级函数而不是 method：`data()` 里要读它，而 data 里 `this` 上有没有
 *    methods 取决于 Vue 的初始化顺序（Vue 3 是先 methods 后 data，能跑，但这是实现
 *    细节）。模块函数没有这个悬念。
 */
function readAI() {
  try {
    return Object.assign({}, (settings.get() && settings.get().ai) || {})
  } catch (e) {
    return {}
  }
}

export default {
  components: { FloatNavbar },
  data() {
    const ai = readAI()
    // 预设自带的地址/模型先垫上：绝大部分人只需要粘一个 Key
    const preset = providerPreset(ai.provider) || PROVIDER_PRESETS[0]
    return {
      providers: PROVIDER_PRESETS,
      form: {
        provider: preset ? preset.value : 'openai',
        baseURL: ai.baseURL || (preset ? preset.baseURL : ''),
        apiKey: ai.apiKey || '',
        model: ai.model || (preset ? preset.model : '')
      },
      showKey: false,
      adv: false,          // 地址与模型默认折叠：预设已经填好，别一上来摆四个框
      busy: false,
      result: null         // { ok, msg }
    }
  },
  computed: {
    configured() {
      const ai = readAI()
      return !!(ai.enabled && ai.apiKey)
    },
    maskedKey() {
      const k = String(this.form.apiKey || '')
      if (k.length <= 10) return k ? '••••' : ''
      return k.slice(0, 4) + '••••' + k.slice(-4)
    },
    keyPage() {
      return KEY_PAGES[this.form.provider] || ''
    },
    providerHint() {
      const p = providerPreset(this.form.provider)
      if (!p) return ''
      if (p.value === 'custom') {
        return t('任何 OpenAI 兼容的地址都行，包括自己搭的或中转服务；地址和模型要自己填。')
      }
      if (p.value === 'qwen') return t('阿里云百炼的兼容模式，地址已填好，只要 Key。')
      return t('地址和模型已按这家填好，只要粘一个 Key。')
    },
    /** 当前输入的格式问题（地址/密钥/模型任一处不对就直说，别等点了保存才报） */
    keyWarn() {
      const f = validateKeyFormat({
        baseURL: this.form.baseURL,
        apiKey: this.form.apiKey,
        model: this.form.model
      })
      // 还没开始填就别红着脸催人（空密钥时 validateKeyFormat 也会报"未填写"）
      if (f.ok) return ''
      if (!String(this.form.apiKey || '').trim() && !String(this.form.baseURL || '').trim()) return ''
      return f.reason
    },
    canSave() {
      return validateKeyFormat({
        baseURL: this.form.baseURL,
        apiKey: this.form.apiKey,
        model: this.form.model
      }).ok
    }
  },
  onLoad() {
    // 上次测过且配置没变：直接把结论摆出来（换一家 / 改一个字都会清掉，见 save 里的 sig）
    try {
      const ai = readAI()
      const v = ai.verify
      if (v && v.ok && v.sig === this.sig()) {
        this.result = { ok: true, msg: t('上一次测试通过') + (v.latency ? '（' + v.latency + ' ms）' : '') }
      }
    } catch (e) {}
  },
  methods: {
    /** 配置指纹：与设置页同一套口径，改了任何一项，旧的测试结论就作废 */
    sig() {
      const ai = readAI()
      return [ai.baseURL || '', ai.model || '', ai.apiKey || ''].join('|')
    },
    /** 换服务商：地址和模型跟着换成这家的（旧模型名在别家根本不存在），Key 保留 */
    pickProvider(p) {
      this.form.provider = p.value
      this.form.baseURL = p.baseURL || ''
      this.form.model = p.model || ''
      this.result = null
      if (p.value === 'custom') this.adv = true   // 自定义必须自己填地址，直接把折叠打开
    },
    onKeyInput(e) {
      this.form.apiKey = String((e && e.detail && e.detail.value) || '').trim()
      this.result = null
    },
    onField(key, e) {
      this.form[key] = String((e && e.detail && e.detail.value) || '').trim()
      this.result = null
    },
    /** 从剪贴板粘：比在手机上长按输入框选粘贴稳，尤其是从电脑上复制的 */
    pasteKey() {
      try {
        uni.getClipboardData({
          success: (res) => {
            const v = String((res && res.data) || '').trim()
            if (!v) {
              this.toast(t('剪贴板是空的'))
              return
            }
            this.form.apiKey = v
            this.result = null
            this.toast(t('已粘贴'))
          },
          fail: () => this.toast(t('读不到剪贴板，手动粘贴一下'))
        })
      } catch (e) {
        this.toast(t('读不到剪贴板，手动粘贴一下'))
      }
    },
    /** 去官网申请 Key：能开浏览器就开，开不了就把地址复制到剪贴板（别让人只看到一句"失败"） */
    openKeyPage() {
      const url = this.keyPage
      if (!url) return
      // #ifdef APP-PLUS
      try { plus.runtime.openURL(url); return } catch (e) {}
      // #endif
      try {
        if (typeof window !== 'undefined' && window.open) { window.open(url, '_blank'); return }
      } catch (e) {}
      try {
        uni.setClipboardData({ data: url })
        this.toast(t('已复制申请页地址，粘到浏览器打开'))
      } catch (e) {
        this.toast(t('没能打开浏览器'))
      }
    },
    /** 先落盘再测：testAIConnection 读的是 settings，不先写进去测的会是上一份配置 */
    async save() {
      if (!this.canSave || this.busy) return
      this.busy = true
      this.result = null
      const url = String(this.form.baseURL || '').trim().replace(/\/+$/, '')
      const ai = {
        // 点了保存就等于"我要用"：总开关一起打开（设置页那个开关默认关，是这里最容易漏的一步）
        enabled: true,
        provider: this.form.provider,
        baseURL: url,
        apiKey: String(this.form.apiKey || '').trim(),
        model: String(this.form.model || '').trim(),
        // 换了配置，旧的验证结论立即作废
        verify: { sig: '', ok: false, msg: '', latency: 0, ts: 0 }
      }
      try {
        settings.set({ ai })
      } catch (e) {}
      try {
        const r = await testAIConnection()
        const latency = (r && r.latencyMs) || 0
        this.writeVerify(true, '', latency)
        this.result = { ok: true, msg: t('可正常使用') + (latency ? '（' + latency + ' ms）' : '') }
        this.toast(t('配好了'))
        // 停一下让人看清"测试通过"，再退回上一页（引导 / 首页 / 设置都可能是上一页）
        setTimeout(() => { this.back() }, 700)
      } catch (e) {
        const msg = (e && e.message) ? e.message : t('连接失败')
        this.writeVerify(false, msg, 0)
        this.result = { ok: false, msg }
      } finally {
        this.busy = false
      }
    },
    writeVerify(ok, msg, latency) {
      try {
        settings.set({ ai: { verify: { sig: this.sig(), ok: !!ok, msg: msg || '', latency: latency || 0, ts: Date.now() } } })
      } catch (e) {}
    },
    toast(title) {
      try { uni.showToast({ title, icon: 'none', duration: 1800 }) } catch (e) {}
    },
    back() {
      try {
        uni.navigateBack({
          fail: () => { uni.switchTab({ url: '/pages/home/home' }) }
        })
      } catch (e) {
        try { uni.switchTab({ url: '/pages/home/home' }) } catch (e2) {}
      }
    }
  }
}
</script>

<style>
.as-page { padding-bottom: 60rpx; }

/* ---------- 开场说明 ---------- */
.as-why { padding: 32rpx 32rpx 28rpx; margin-bottom: 20rpx; }
.as-why-t {
  display: block;
  font-size: 30rpx; font-weight: 600;
  color: #17201a; color: var(--ink-1, #17201a);
}
.as-why-b {
  display: block; margin-top: 14rpx;
  font-size: 25rpx; line-height: 1.75;
  color: #5a6560; color: var(--ink-2, #5a6560);
}
.as-why-note { display: flex; margin-top: 12rpx; }
.as-dot { color: #98a19b; color: var(--ink-3, #98a19b); font-size: 25rpx; margin-right: 10rpx; }
.as-why-k {
  flex: 1;
  font-size: 23rpx; line-height: 1.6;
  color: #98a19b; color: var(--ink-3, #98a19b);
}

/* ---------- 已配置横幅 ---------- */
.as-done { padding: 26rpx 30rpx; margin-bottom: 20rpx; }
.as-done-head { display: flex; align-items: center; }
.as-done-dot {
  width: 14rpx; height: 14rpx; border-radius: 50%;
  background: #3b9d11; margin-right: 14rpx; flex-shrink: 0;
}
.as-done-t { font-size: 27rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.as-done-s {
  margin-left: auto;
  font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b);
}
.as-done-b {
  display: block; margin-top: 8rpx;
  font-size: 23rpx; line-height: 1.6;
  color: #5a6560; color: var(--ink-2, #5a6560);
}

/* ---------- 分步卡片 ---------- */
.as-sec { padding: 30rpx 32rpx; margin-bottom: 20rpx; }
.as-sec-head { display: flex; align-items: center; }
.as-sec-head-flat { flex: 1; min-width: 0; }
.as-no {
  width: 36rpx; height: 36rpx; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  margin-right: 14rpx; flex-shrink: 0;
  font-size: 20rpx; font-weight: 600;
  color: #bb1332; color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
}
.as-sec-t { font-size: 28rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }

.as-chips { display: flex; flex-wrap: wrap; margin-top: 20rpx; }
.as-chip {
  padding: 0 24rpx; height: 60rpx; line-height: 60rpx;
  margin: 0 14rpx 14rpx 0;
  border-radius: 999rpx;
  font-size: 25rpx;
  color: #5a6560; color: var(--ink-2, #5a6560);
  background: rgba(23, 32, 26, 0.04);
  background: rgba(var(--shadow-rgb, 23, 32, 26), 0.04);
  border: 2rpx solid transparent;
}
/* 选中态是"选中"语义，允许用淡红底 + 深红字（与设置页 chip 同口径） */
.as-chip.on {
  color: #bb1332; color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  border-color: rgba(228, 23, 61, 0.4);
  border-color: rgba(var(--brand-rgb, 228, 23, 61), 0.4);
}
.as-hint {
  display: block; margin-top: 6rpx;
  font-size: 22rpx; line-height: 1.6;
  color: #98a19b; color: var(--ink-3, #98a19b);
}
.as-warn {
  display: block; margin-top: 12rpx;
  font-size: 22rpx; line-height: 1.6;
  color: #e5484d;
}

/* ---------- 密钥输入 ---------- */
.as-key {
  display: flex; align-items: center;
  margin-top: 20rpx; padding: 0 24rpx;
  height: 88rpx;
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
}
.as-key-input {
  flex: 1; min-width: 0;
  font-size: 26rpx;
  color: #17201a; color: var(--ink-1, #17201a);
}
.as-key-eye {
  flex-shrink: 0; margin-left: 16rpx; padding: 8rpx 0 8rpx 12rpx;
  font-size: 23rpx;
  color: #bb1332; color: var(--brand-strong, #bb1332);
}
.as-key-acts { display: flex; align-items: center; margin-top: 14rpx; }
.as-link {
  font-size: 23rpx; margin-right: 28rpx;
  color: #bb1332; color: var(--brand-strong, #bb1332);
}

/* ---------- 高级项 ---------- */
.as-adv-head { display: flex; align-items: center; justify-content: space-between; }
.as-adv-t { flex-shrink: 0; margin-left: 16rpx; font-size: 23rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
.as-field { margin-top: 20rpx; }
.as-label {
  display: block; margin-bottom: 10rpx;
  font-size: 23rpx;
  color: #5a6560; color: var(--ink-2, #5a6560);
}
.as-input {
  height: 84rpx; padding: 0 24rpx;
  border-radius: 20rpx;
  font-size: 26rpx;
  color: #17201a; color: var(--ink-1, #17201a);
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
}
.as-ph { color: #a8b0ab; }

/* ---------- 结果 ---------- */
.as-res { padding: 26rpx 30rpx; margin-bottom: 20rpx; }
.as-res-ok { border-color: rgba(59, 157, 17, 0.35); }
.as-res-bad { border-color: rgba(229, 72, 77, 0.4); }
.as-res-t {
  display: block;
  font-size: 27rpx; font-weight: 600;
  color: #17201a; color: var(--ink-1, #17201a);
}
.as-res-ok .as-res-t { color: #3b9d11; }
.as-res-bad .as-res-t { color: #e5484d; }
.as-res-b {
  display: block; margin-top: 8rpx;
  font-size: 24rpx; line-height: 1.65;
  color: #5a6560; color: var(--ink-2, #5a6560);
  word-break: break-all;
}

.as-go { margin-top: 10rpx; }
.as-foot {
  display: block; margin-top: 20rpx;
  text-align: center;
  font-size: 22rpx; line-height: 1.6;
  color: #98a19b; color: var(--ink-3, #98a19b);
}
</style>
