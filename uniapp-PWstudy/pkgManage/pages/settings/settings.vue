<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('设置')" />

    <!-- ===== 外观：深色 / 主题色 / 背景（大胶囊，默认收起） ===== -->
    <view class="sec" :class="{ open: openSec === 'appearance' }">
      <view class="sec-head" data-k="appearance" @tap="toggleSec">
        <text class="sec-name">{{ $t('外观') }}</text>
        <text v-if="openSec !== 'appearance'" class="sec-hint">{{ secHint('appearance') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'appearance'">
        <view class="row" @tap="pickLocale">
          <view class="row-main">
            <text class="row-title">{{ $t('界面语言') }}</text>
            <text class="row-desc">{{ $t('切换后全界面文案跟随（单词释义不受影响）') }}</text>
          </view>
          <text class="row-value">{{ localeName }}</text>
        </view>
        <view class="sub-title">{{ $t('深色模式') }}</view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('深色模式') }}</text>
            <text class="row-desc">{{ darkHint }}</text>
          </view>
          <switch
            :checked="darkOn"
            :disabled="followSystem"
            :color="brandMain"
            @change="e => toggleDark(e.detail.value)"
          />
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('跟随系统') }}</text>
            <text class="row-desc">系统切换深浅时自动同步（当前系统：{{ systemDark ? $t('深色') : $t('浅色') }}）</text>
          </view>
          <switch :checked="followSystem" :color="brandMain" @change="e => toggleFollow(e.detail.value)" />
        </view>

        <view class="sub-title">{{ $t('主题色') }}</view>
        <view class="accent-row">
          <view
            v-for="a in accents"
            :key="a.key"
            class="accent"
            :class="{ active: accentKey === a.key }"
            :data-k="a.key"
            @tap="pickAccent"
          >
            <view class="accent-dot" :style="{ background: a.main }"></view>
            <text class="accent-name">{{ a.name }}</text>
          </view>
        </view>

        <view class="sub-title">{{ $t('背景') }}</view>
        <view class="bg-row">
          <view
            v-for="b in backgrounds"
            :key="b.key"
            class="bg-chip"
            :class="{ active: bgKey === b.key && !bgImage }"
            :style="{ background: bgSwatch(b) }"
            :data-k="b.key"
            @tap="pickBg"
          ><text class="bg-chip-name">{{ b.name }}</text></view>
          <!-- 自定义色：色块直接显示用户挑的那个颜色（深色下显示压暗变体） -->
          <view
            class="bg-chip"
            :class="{ active: bgKey === 'custom' && !bgImage }"
            :style="{ background: customSwatch }"
            @tap="pickCustomBg"
          ><text class="bg-chip-name">{{ $t('自定义') }}</text></view>
          <view class="bg-chip pick" @tap="chooseBg"><text class="bg-chip-name">{{ $t('相册') }}</text></view>
        </view>

        <!-- 自定义底色：快捷色板 + 色相 / 饱和度 / 明度 三根滑杆 -->
        <view class="cp" v-if="bgKey === 'custom'">
          <view class="cp-head">
            <view class="cp-dot" :style="{ background: customSwatch }"></view>
            <text class="cp-hex">{{ customHex }}</text>
            <text class="cp-reset" @tap="resetCustom">{{ $t('恢复默认') }}</text>
          </view>
          <view class="cp-sw">
            <view
              v-for="c in swatches"
              :key="c"
              class="cp-sw-item"
              :class="{ on: c === customHex }"
              :style="{ background: c }"
              :data-c="c"
              @tap="pickSwatch"
            ></view>
          </view>
          <view class="field slider-field">
            <text class="field-label">{{ $t('色相') }}</text>
            <slider
              class="slider"
              :min="0" :max="360" :step="1"
              :value="hsl.h"
              :active-color="brandMain"
              show-value
              @changing="e => onHsl('h', e, false)"
              @change="e => onHsl('h', e, true)"
            />
          </view>
          <view class="field slider-field">
            <text class="field-label">{{ $t('饱和度') }}</text>
            <slider
              class="slider"
              :min="0" :max="100" :step="1"
              :value="hsl.s"
              :active-color="brandMain"
              show-value
              @changing="e => onHsl('s', e, false)"
              @change="e => onHsl('s', e, true)"
            />
          </view>
          <view class="field slider-field">
            <text class="field-label">{{ $t('明度') }}</text>
            <slider
              class="slider"
              :min="20" :max="96" :step="1"
              :value="hsl.l"
              :active-color="brandMain"
              show-value
              @changing="e => onHsl('l', e, false)"
              @change="e => onHsl('l', e, true)"
            />
          </view>
          <view class="bg-hint">{{ $t('只改背景底色，卡片的磨砂玻璃与文字配色不变。明度别压太低，否则深色文字会读不清。深色模式下会自动换成同色相的压暗版本，不会为了深色丢掉你挑的颜色。') }}</view>
        </view>

        <view class="bg-actions" v-if="bgImage">
          <text class="bg-path">{{ $t('正在使用自定义图片') }}</text>
          <text class="bg-clear" @tap="clearBg">{{ $t('恢复预设') }}</text>
        </view>
        <view class="field slider-field">
          <text class="field-label">{{ bgImage ? $t('图片淡化') : $t('背景淡化') }}</text>
          <slider
            class="slider"
            :min="0"
            :max="0.7"
            :step="0.05"
            :value="mask"
            :active-color="brandMain"
            show-value
            @change="onMask"
          />
        </view>
        <view class="field slider-field">
          <text class="field-label">{{ bgImage ? $t('图片模糊') : $t('背景模糊') }}</text>
          <slider
            class="slider"
            :disabled="smooth"
            :min="0"
            :max="24"
            :step="1"
            :value="blur"
            :active-color="brandMain"
            show-value
            @change="onBlur"
          />
        </view>
        <view class="bg-hint">{{ $t('背景在最底层且固定不动：上下滑动时只有卡片、胶囊这些窗体在动。玻璃窗体透出背景的同时仍与背景分层；"淡化"在深色模式下叠的是黑色，用来给背景降亮度。') }}</view>
      </view>
    </view>

    <!-- ===== 流畅模式（低端机退路） ===== -->
    <view class="sec" :class="{ open: openSec === 'perf' }">
      <view class="sec-head" data-k="perf" @tap="toggleSec">
        <text class="sec-name">{{ $t('流畅模式') }}</text>
        <text v-if="openSec !== 'perf'" class="sec-hint">{{ secHint('perf') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'perf'">
        <!-- 画质档位：先按机器挑一档，下面三个维度还能单独微调 -->
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('画质档位') }}</text>
            <text class="row-desc">{{ qualityHint }}</text>
          </view>
        </view>
        <view class="seg-row">
          <view
            v-for="q in qualityList"
            :key="q.key"
            class="seg-item"
            :class="{ on: quality === q.key }"
            @tap="onQuality(q.key)"
          >{{ $t(q.name) }}</view>
        </view>

        <view class="seg-group">
          <text class="seg-label">{{ $t('毛玻璃') }}</text>
          <view class="seg-row">
            <view
              v-for="o in glassList"
              :key="o.v"
              class="seg-item"
              :class="{ on: fx.glass === o.v }"
              @tap="onFx('glass', o.v)"
            >{{ $t(o.n) }}</view>
          </view>
        </view>

        <view class="seg-group">
          <text class="seg-label">{{ $t('动效') }}</text>
          <view class="seg-row">
            <view
              v-for="o in motionList"
              :key="o.v"
              class="seg-item"
              :class="{ on: fx.motion === o.v }"
              @tap="onFx('motion', o.v)"
            >{{ $t(o.n) }}</view>
          </view>
        </view>

        <view class="seg-group">
          <text class="seg-label">{{ $t('阴影') }}</text>
          <view class="seg-row">
            <view
              v-for="o in shadowList"
              :key="o.v"
              class="seg-item"
              :class="{ on: fx.shadow === o.v }"
              @tap="onFx('shadow', o.v)"
            >{{ $t(o.n) }}</view>
          </view>
        </view>

        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('流畅模式') }}</text>
            <text class="row-desc">{{ $t('一键关掉全部特效：等价于切到「轻量」档，上面的细分会跟着重置') }}</text>
          </view>
          <switch :checked="smooth" :color="brandMain" @change="onSmooth" />
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('设备性能检测') }}</text>
            <text class="row-desc">{{ perfText }}</text>
          </view>
          <text class="row-action" @tap="reprobe">{{ $t('重新检测') }}</text>
        </view>
        <view class="bg-hint">{{ $t('只改变观感：背景与卡片依然半透明、分层的玻璃质感保留，只是不再逐帧实时模糊。不影响任何功能，也不会清除学习数据。背景是渐变时卡片本来就不做实时模糊（渐变模糊前后的观感一致），这笔开销全省掉了。') }}</view>
      </view>
    </view>

    <!-- ===== AI（大胶囊，连接参数默认收起） ===== -->
    <view class="sec" :class="{ open: openSec === 'ai' }">
      <view class="sec-head" data-k="ai" @tap="toggleSec">
        <text class="sec-name">AI</text>
        <text v-if="openSec !== 'ai'" class="sec-hint">{{ secHint('ai') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'ai'">
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('启用 AI 服务') }}</text>
            <text class="row-desc">{{ $t('开启后可用云端生成例句、点评与朗读') }}</text>
          </view>
          <switch :checked="ai.enabled" :color="brandMain" @change="e => setAI('enabled', e.detail.value)" />
        </view>

        <template v-if="ai.enabled">
          <view class="field">
            <text class="field-label">{{ $t('服务商') }}</text>
            <view class="chips">
              <view
                v-for="p in providers"
                :key="p.value"
                class="chip"
                :class="{ active: ai.provider === p.value }"
                @tap="selectProvider(p.value)"
              >{{ p.name }}</view>
            </view>
          </view>

          <!-- 状态校验 + 连通性测试：通过后明确显示"可正常使用" -->
          <view class="verify-box">
            <view class="verify-status" :class="status.cls">
              <text class="verify-dot"></text>
              <text class="verify-text">{{ status.text }}</text>
            </view>
            <button
              class="verify-btn"
              :class="{ disabled: !canTest }"
              :disabled="!canTest"
              @tap="runTest"
            >{{ testing ? $t('测试中…') : $t('测试连接') }}</button>
          </view>

          <view class="row adv-row" @tap="toggleAdv">
            <view class="row-main">
              <text class="row-title">{{ $t('连接参数') }}</text>
              <text class="row-desc">地址 / 密钥 / 模型{{ aiAdvanced ? '' : $t('（已配置则无需改动）') }}</text>
            </view>
            <text class="adv-toggle">{{ aiAdvanced ? $t('收起') : $t('展开') }}</text>
          </view>
          <template v-if="aiAdvanced">
            <view class="field">
              <text class="field-label">{{ $t('API 地址') }}</text>
              <input
                class="field-input"
                :value="ai.baseURL"
                :placeholder="$t('如 https://api.openai.com/v1')"
                @blur="e => setAI('baseURL', e.detail.value)"
              />
            </view>
            <view class="field">
              <text class="field-label">API Key</text>
              <input
                class="field-input"
                :value="ai.apiKey"
                :password="!showKey"
                :placeholder="$t('仅保存在本机，不会上传')"
                @blur="e => setAI('apiKey', e.detail.value)"
              />
              <text class="field-op" @tap="showKey = !showKey">{{ showKey ? $t('隐藏') : $t('显示') }}</text>
            </view>
            <view class="field">
              <text class="field-label">{{ $t('模型') }}</text>
              <input
                class="field-input"
                :value="ai.model"
                :placeholder="$t('例句生成用，如 gpt-4o-mini')"
                @blur="e => setAI('model', e.detail.value)"
              />
            </view>
            <view class="field" v-if="ai.provider === 'custom'">
              <view class="row-main">
                <text class="row-title">{{ $t('地址支持语音') }}</text>
                <text class="row-desc">{{ $t('若中转提供 /audio/speech，开启即可用云端音色（含中文）') }}</text>
              </view>
              <switch :checked="ai.customTTS" :color="brandMain" @change="e => setAI('customTTS', e.detail.value)" />
            </view>
            <block v-if="ttsSupported">
              <view class="field">
                <text class="field-label">{{ $t('语音模型') }}</text>
                <view class="chips">
                  <view
                    v-for="m in ttsModels"
                    :key="m"
                    class="chip"
                    :class="{ active: ai.ttsModel === m }"
                    @tap="setAI('ttsModel', m)"
                  >{{ m }}</view>
                </view>
              </view>
              <view class="field">
                <text class="field-label">{{ $t('或手填') }}</text>
                <input
                  class="field-input"
                  :value="ai.ttsModel"
                  :placeholder="$t('默认 tts-1')"
                  @blur="e => setAI('ttsModel', e.detail.value)"
                />
              </view>
            </block>
          </template>

          <!-- 用量：只统计本机实际发出去的调用，token 是估算值（看量级用，不对账） -->
          <view class="row">
            <view class="row-main">
              <text class="row-title">{{ $t('本月用量') }}</text>
              <text class="row-desc">{{ apiUsageText }}</text>
            </view>
          </view>

          <!-- 规划偏好：默认关。开了之后新目标的任务会附 AI 的资料/工具建议 -->
          <view class="row">
            <view class="row-main">
              <text class="row-title">{{ $t('规划时推荐学习资料') }}</text>
              <text class="row-desc">{{ $t('让 AI 在任务上附资料/工具建议（书名、App 等，不给链接）；只影响新生成的目标') }}</text>
            </view>
            <switch :checked="planRes" :color="brandMain" @change="e => setPlanRes(e.detail.value)" />
          </view>

          <!-- 时段安排：默认开。关掉 = 原来的纯任务规划（不再产出时段，已有的不删） -->
          <view class="row">
            <view class="row-main">
              <text class="row-title">{{ $t('规划时安排执行时段') }}</text>
              <text class="row-desc">{{ $t('让 AI 把任务排进早/中/晚，看得出来每个任务大概几点做；关掉就回到原来的纯任务规划，已经排好的时段不会丢') }}</text>
            </view>
            <switch :checked="planSlot" :color="brandMain" @change="e => setPlanSlot(e.detail.value)" />
          </view>

          <!-- 时段到点提醒：依附于上面的时段安排 -->
          <view class="row">
            <view class="row-main">
              <text class="row-title">{{ $t('时段到了提醒我') }}</text>
              <text class="row-desc">{{ $t('早上 08:00、中午 13:00、晚上 19:30 各催一次那个时段的事；关掉时段安排后这一项不起作用') }}</text>
            </view>
            <switch :checked="planSlotNotify" :color="brandMain" @change="e => setPlanSlotNotify(e.detail.value)" />
          </view>

          <view class="field-note" v-if="!ttsSupported">
            {{ $t('该服务商为文本大模型，不提供云端语音；朗读仍使用本地发音。') }}
          </view>
          <!-- ===== AI 功能分项开关（二级胶囊，默认收起） ===== -->
          <!-- App 里会调模型的地方差异极大：生成一份学习计划一次几千 token，
               AI 猜某个 App 是不是用来学习的一次才几十。以前只有总开关，
               想省钱只能整个关掉。这里逐项开放，用到哪开哪 ——
               列表由 services/ai-gate.js 的 AI_FEATURES 决定，按花钱从多到少排。 -->
          <view class="field-col">
            <view class="sub-head" @tap="toggleAiFn">
              <text class="sub-name">{{ $t('AI 功能') }}</text>
              <text v-if="aiFnOff" class="sub-hint dim">{{ $t('已关闭 {n} 项', { n: aiFnOff }) }}</text>
              <text v-else class="sub-hint">{{ $t('全部开启') }}</text>
              <text class="sub-arrow" :class="{ rot: aiFnOpen }">›</text>
            </view>
            <view class="sub-body" v-if="aiFnOpen">
              <view class="field-note">
                {{ $t('关掉的功能不再调用模型、不消耗额度；该有的本地兜底照旧（比如关了 AI 生成学习计划，改用本地模板排）。') }}
              </view>
              <view class="fn-ops">
                <text class="fn-op" :class="{ disabled: aiFnOff === 0 }" @tap="setAllFeatures(true)">{{ $t('全部开启') }}</text>
                <text class="fn-op" :class="{ disabled: aiFnOff >= aiFnList.length }" @tap="setAllFeatures(false)">{{ $t('全部关闭') }}</text>
              </view>
              <view class="row fn-row" v-for="f in aiFnList" :key="f.key">
                <view class="row-main">
                  <text class="row-title">{{ $t(f.name) }}</text>
                  <text class="row-desc">{{ $t(f.desc) }}</text>
                </view>
                <view class="fn-side">
                  <text class="fn-tag" :class="'lv-' + f.level">{{ $t(f.levelLabel) }}</text>
                  <switch :checked="f.on" :color="brandMain" @change="e => toggleFeature(f.key, e.detail.value)" />
                </view>
              </view>
              <view class="field-note">
                {{ $t('AI 朗读用的是「语音」里的独立开关，不在这里 —— 它决定要不要更自然的人声，跟生不生成内容是两回事。') }}
              </view>
            </view>
          </view>
        </template>
      </view>
    </view>

    <!-- ===== 语音（大胶囊） ===== -->
    <view class="sec" :class="{ open: openSec === 'voice' }">
      <view class="sec-head" data-k="voice" @tap="toggleSec">
        <text class="sec-name">{{ $t('语音') }}</text>
        <text v-if="openSec !== 'voice'" class="sec-hint">{{ secHint('voice') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'voice'">
        <view class="row">
          <view class="row-main">
            <text class="row-title" :class="{ muted: !aiReady }">{{ $t('使用 AI 朗读') }}</text>
            <text class="row-desc">{{ aiReady ? $t('更自然接近真人；失败自动回退本地发音') : $t('需先完成 AI 配置（地址 + 密钥）后才可使用') }}</text>
          </view>
          <switch :checked="voice.useAI && aiReady" :disabled="!aiReady" :color="brandMain" @change="e => setVoice('useAI', e.detail.value)" />
        </view>

        <template v-if="voice.useAI && aiReady">
          <block v-if="ttsSupported">
            <view class="field">
              <text class="field-label">{{ $t('音色') }}</text>
              <view class="chips">
                <view
                  v-for="v in voices"
                  :key="v"
                  class="chip"
                  :class="{ active: ai.ttsVoice === v }"
                  @tap="setAI('ttsVoice', v)"
                >{{ v }}</view>
              </view>
            </view>
            <view class="field slider-field">
              <text class="field-label">{{ $t('语速') }}</text>
              <slider
                class="slider"
                :min="0.5"
                :max="2"
                :step="0.1"
                :value="ai.ttsSpeed"
                :active-color="brandMain"
                show-value
                @change="e => setAI('ttsSpeed', e.detail.value)"
              />
            </view>
            <view class="field">
              <text class="field-label">{{ $t('试听音色') }}</text>
              <view class="try-row">
                <view class="try-btn" @tap="tryVoice('zh')">{{ $t('中文示例') }}</view>
                <view class="try-btn" @tap="tryVoice('en')">{{ $t('英文示例') }}</view>
              </view>
            </view>
            <view class="field-note">{{ $t('云端音色对中文的自然度通常明显好于手机自带引擎；首次约 1-2 秒，之后同句走缓存。') }}</view>
          </block>
          <view v-else class="field-note">{{ $t('当前服务商不支持云端语音，朗读将使用本地发音。') }}</view>
        </template>

        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('答题音效') }}</text>
            <text class="row-desc">{{ $t('答对 / 半对 / 答错各响一声') }}</text>
          </view>
          <switch :checked="voice.sfx !== false" :color="brandMain" @change="e => setVoice('sfx', e.detail.value)" />
        </view>
        <view v-if="voice.sfx !== false" class="row sfx-preview-row">
          <view class="row-main">
            <text class="row-desc">{{ $t('点一下试听') }}</text>
          </view>
          <view class="sfx-preview">
            <view class="sfx-dot ok" @tap="previewSfx('correct')">{{ $t('答对') }}</view>
            <view class="sfx-dot half" @tap="previewSfx('partial')">{{ $t('半对') }}</view>
            <view class="sfx-dot no" @tap="previewSfx('wrong')">{{ $t('答错') }}</view>
          </view>
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('英文朗读') }}</text>
            <text class="row-desc">{{ $t('关闭后英文题干不再自动朗读（点击仍可发音）') }}</text>
          </view>
          <switch :checked="voice.englishRead" :color="brandMain" @change="e => setVoice('englishRead', e.detail.value)" />
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('中文朗读') }}</text>
            <text class="row-desc">{{ $t('关闭后中文内容不再自动朗读（点击仍可发音）') }}</text>
          </view>
          <switch :checked="voice.chineseRead" :color="brandMain" @change="e => setVoice('chineseRead', e.detail.value)" />
        </view>
        <view class="field">
          <text class="field-label">{{ $t('整句朗读引擎') }}</text>
          <view class="chips">
            <view
              v-for="e in engines"
              :key="e.key"
              class="chip"
              :class="{ active: engineKey === e.key }"
              :data-k="e.key"
              @tap="setEngine"
            >{{ e.name }}</view>
          </view>
          <view class="field-note">
            {{ $t('系统语音一次合成整句，中间没有网络请求，听感连贯；在线发音遇到整句取不到时会退化为逐词连读，听起来一顿一顿。') }}
          </view>
        </view>

        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('系统语音状态') }}</text>
            <text class="row-desc">{{ engineStatusText }}</text>
          </view>
          <view class="row-action" @tap="recheckEngine">{{ $t('重新检测') }}</view>
        </view>

        <view class="field slider-field">
          <text class="field-label">{{ $t('本地语速') }}</text>
          <slider
            class="slider"
            :min="0.5"
            :max="2"
            :step="0.1"
            :value="voice.speed"
            :active-color="brandMain"
            show-value
            @change="e => setVoice('speed', e.detail.value)"
          />
        </view>
      </view>
    </view>

    <!-- ===== 通知（大胶囊） ===== -->
    <view class="sec" :class="{ open: openSec === 'notify' }">
      <view class="sec-head" data-k="notify" @tap="toggleSec">
        <text class="sec-name">{{ $t('通知') }}</text>
        <text v-if="openSec !== 'notify'" class="sec-hint">{{ secHint('notify') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'notify'">
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('每日学习提醒') }}</text>
            <text class="row-desc">{{ $t('仅在本机生效，不会推送服务器通知') }}</text>
          </view>
          <switch :checked="notifications.daily" :color="brandMain" @change="e => setNotifications('daily', e.detail.value)" />
        </view>
        <view class="field" v-if="notifications.daily">
          <text class="field-label">{{ $t('提醒时间') }}</text>
          <picker mode="time" :value="notifications.time" @change="e => setNotifications('time', e.detail.value)">
            <view class="picker-value">{{ notifications.time }}</view>
          </picker>
        </view>
      </view>
    </view>

    <!-- ===== 触感反馈（震动） ===== -->
    <view class="sec" :class="{ open: openSec === 'haptic' }">
      <view class="sec-head" data-k="haptic" @tap="toggleSec">
        <text class="sec-name">{{ $t('触感反馈') }}</text>
        <text v-if="openSec !== 'haptic'" class="sec-hint">{{ secHint('haptic') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'haptic'">
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('震动反馈') }}</text>
            <text class="row-desc">{{ $t('抽屉滑出、底部导航切换时轻轻震一下') }}</text>
          </view>
          <switch :checked="hapticOn" :color="brandMain" @change="e => setHapticOn(e.detail.value)" />
        </view>
        <view class="row" v-if="hapticOn" @tap="previewHaptic">
          <view class="row-main">
            <text class="row-title">{{ $t('试一下') }}</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
        <view class="row" v-if="hapticOn && hapticFail">
          <view class="row-main">
            <text class="row-desc">{{ $t('这一下没震成：多半是现在这个包里没打进震动权限，云打包一次就有了；本来就不带马达的设备也不会震。') }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- ===== AI 缓存（整体清除，不做逐条删除） ===== -->
    <view class="sec" :class="{ open: openSec === 'cache' }">
      <view class="sec-head" data-k="cache" @tap="toggleSec">
        <text class="sec-name">{{ $t('AI 缓存') }}</text>
        <text v-if="openSec !== 'cache'" class="sec-hint">{{ cacheHint }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'cache'">
        <view class="row" @tap="askClear('words')">
          <view class="row-main">
            <text class="row-title danger">{{ $t('清空缓存单词') }}</text>
            <text class="row-desc">搜索 / AI 释义缓存过的单词（{{ cacheStats.words }} 条）</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
        <view class="row" @tap="askClear('sentences')">
          <view class="row-main">
            <text class="row-title danger">{{ $t('清空缓存例句') }}</text>
            <text class="row-desc">练习与释义生成过的 AI 例句（{{ cacheStats.sentences }} 条）</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
      </view>
    </view>

    <!-- ===== 数据与账号（原「隐私」+「账号安全」合并，大胶囊） ===== -->
    <view class="sec" :class="{ open: openSec === 'data' }">
      <view class="sec-head" data-k="data" @tap="toggleSec">
        <text class="sec-name">{{ $t('数据与账号') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'data'">
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('本地存储学习数据') }}</text>
            <text class="row-desc">{{ $t('学习进度仅保存在本机，卸载即清除') }}</text>
          </view>
          <switch :checked="privacy.storeLocal" :color="brandMain" disabled />
        </view>
        <view class="row" @tap="clearLearningData">
          <view class="row-main">
            <text class="row-title danger">{{ $t('清除学习数据') }}</text>
            <text class="row-desc">{{ $t('删除全部目标、任务与专注记录，不可恢复') }}</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
        <view class="row" @tap="logout">
          <view class="row-main">
            <text class="row-title danger">{{ $t('退出登录') }}</text>
            <text class="row-desc">{{ $t('重置个人资料与设置（学习数据保留）') }}</text>
          </view>
          <text class="row-arrow">›</text>
        </view>
      </view>
    </view>

    <!-- ===== 伙伴 App（背单词）=====
         一个"可选增强"，不是必需步骤。四种状态走同一块区域：
           未安装 / 未决定 / 已关联 / 已关闭
         ⚠️ 这里的每一句话都必须能回答"不关联会怎样" —— 答案永远是"什么都不影响"，
            因为 PWstudy 本来就不是用户唯一的背单词入口（dock 里第三方 App 照常统计）。 -->
    <view class="sec" :class="{ open: openSec === 'partner' }">
      <view class="sec-head" data-k="partner" @tap="toggleSec">
        <text class="sec-name">{{ $t('伙伴 App') }}</text>
        <text v-if="openSec !== 'partner'" class="sec-hint">{{ secHint('partner') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'partner'">
        <!-- 说明块：先讲清它是什么、不关联会怎样，再谈按钮 -->
        <view class="pn-note">
          <text class="pn-note-tag">{{ $t('可选') }}</text>
          <text class="pn-note-text">{{ $t('关联后可以从 PWstudy 直接跳过去背单词，学完自动把时长和词数记回今天。不关联也完全不影响 —— 你在任何别的背单词 App 里花的时间，PWstudy 一样统计。') }}</text>
        </view>

        <!-- ① 没装：一个按钮都不给。给了也是点了没反应，不如明说"装了再来" -->
        <view class="row" v-if="!pn.installed">
          <view class="row-main">
            <text class="row-title">{{ $t('未检测到背单词 App') }}</text>
            <text class="row-desc">{{ $t('装上之后再回到这一页，关联入口会自动出现') }}</text>
          </view>
        </view>
        <view class="pn-actions" v-if="!pn.installed">
          <view class="pn-btn" @tap="refreshPartner">{{ $t('重新检测') }}</view>
        </view>

        <!-- ② 已关联：先把"链路真的通着"的证据摆出来，再给退出口 -->
        <block v-if="pn.installed && pn.state === 'linked'">
          <view class="row">
            <view class="row-main">
              <text class="row-title">{{ $t('已关联') }}</text>
              <text class="row-desc">{{ partnerStatText }}</text>
            </view>
            <text class="row-value pn-on">{{ $t('已关联') }}</text>
          </view>
          <view class="row" @tap="goPartner">
            <view class="row-main">
              <text class="row-title">{{ $t('去背单词') }}</text>
              <text class="row-desc">{{ $t('直接跳过去，学完自动回到这里') }}</text>
            </view>
            <text class="row-arrow">›</text>
          </view>
          <view class="row" @tap="askUnlink">
            <view class="row-main">
              <text class="row-title danger">{{ $t('取消关联') }}</text>
              <text class="row-desc">{{ $t('只断开跳转和回传，已经记下的时长与词数会保留') }}</text>
            </view>
            <text class="row-arrow">›</text>
          </view>
        </block>

        <!-- ③ 未决定 / 已关闭：一个接受键 + 一个拒绝键。
             拒绝只在"未决定"时出现 —— 已经关掉了还摆个「不用了」是多余的一次点击 -->
        <block v-if="pn.installed && pn.state !== 'linked'">
          <view class="row">
            <view class="row-main">
              <text class="row-title">{{ pn.state === 'declined' ? $t('已关闭') : $t('尚未关联') }}</text>
              <text class="row-desc">{{ pn.state === 'declined' ? $t('之前选过不用这个功能，随时可以重新打开') : $t('设备上检测到背单词 App，要不要打通？') }}</text>
            </view>
            <text class="row-value">{{ pn.state === 'declined' ? $t('已关闭') : $t('未设置') }}</text>
          </view>
          <view class="pn-actions">
            <view class="pn-btn primary" @tap="doLink">
              {{ pn.state === 'declined' ? $t('重新关联') : $t('关联') }}
            </view>
            <view class="pn-btn" v-if="pn.state !== 'declined'" @tap="doDecline">{{ $t('不用了') }}</view>
          </view>
        </block>
      </view>
    </view>

    <!-- ===== 开始前的几件事（首次用 App 时那一屏，随时可以重看） =====
         收在这个分区里而不是塞进「关于」：它是"要做事"的入口，不是信息展示。 -->
    <view class="sec" :class="{ open: openSec === 'start' }">
      <view class="sec-head" data-k="start" @tap="toggleSec">
        <text class="sec-name">{{ $t('开始前的几件事') }}</text>
        <text v-if="openSec !== 'start'" class="sec-hint">{{ secHint('start') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'start'">
        <view class="row" @tap="goStart">
          <view class="row-main">
            <text class="row-title">{{ $t('再看一遍') }}</text>
            <text class="row-desc">{{ $t('系统权限与「要不要被管着」那几个开关，一次性重新过一遍') }}</text>
          </view>
          <text class="row-value">›</text>
        </view>
      </view>
    </view>

    <!-- ===== 关于（大胶囊） ===== -->
    <view class="sec" :class="{ open: openSec === 'about' }">
      <view class="sec-head" data-k="about" @tap="toggleSec">
        <text class="sec-name">{{ $t('关于') }}</text>
        <text v-if="openSec !== 'about'" class="sec-hint">{{ secHint('about') }}</text>
        <text class="sec-arrow">›</text>
      </view>
      <view class="sec-body" v-if="openSec === 'about'">
        <!-- 版本行可点：连点若干下出彩蛋（tapVersion） -->
        <view class="row" @tap="tapVersion">
          <view class="row-main">
            <text class="row-title">{{ $t('版本') }}</text>
          </view>
          <text class="row-value">{{ version }}</text>
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('介绍') }}</text>
          </view>
          <text class="row-value">{{ $t('专注计时 · AI 学习规划 · 用时统计，全部离线') }}</text>
        </view>

        <!-- 更新：wgt 热更新为主，装不上（或动了原生）就走完整包 -->
        <view class="row" @tap="doCheckUpdate">
          <view class="row-main">
            <text class="row-title">{{ $t('检查更新') }}</text>
            <text class="row-desc">{{ $t('小改动走热更新（几百 KB，装完自动重启）；失败会给出去下载完整包的入口') }}</text>
          </view>
          <text class="row-value">{{ checking ? $t('检查中…') : '' }}</text>
        </view>
        <view class="row">
          <view class="row-main">
            <text class="row-title">{{ $t('启动时自动检查') }}</text>
            <text class="row-desc">{{ $t('一天最多一次，检查失败不弹任何东西；有更新才问你要不要装') }}</text>
          </view>
          <switch :checked="updateAuto" :color="brandMain" @change="e => setUpdateAuto(e.detail.value)" />
        </view>
        <view class="row" @tap="goRelease">
          <view class="row-main">
            <text class="row-title">{{ $t('下载完整安装包') }}</text>
            <text class="row-desc">{{ $t('热更新装不了（动了原生部分）或你想重装时，去这里拿最新的 APK') }}</text>
          </view>
          <text class="row-value">›</text>
        </view>
        <!-- 新手引导 · 重看：2026-10-14 回来。
             原来那版步骤全是背单词的（查词 / 开始背单词 / AI 指令），所以 10-10 撤掉了；
             现在 utils/onboarding.js 重写成 PWstudy 自己的闭环（定目标 → 日程 → 计时 → 收工 → 重排），
             点这里回首页立刻重放一遍。 -->
        <view class="row" @tap="replayGuide">
          <view class="row-main">
            <text class="row-title">{{ $t('新手引导') }}</text>
            <text class="row-desc">{{ $t('回首页重新走一遍功能介绍') }}</text>
          </view>
          <text class="row-value">{{ $t('重看 ›') }}</text>
        </view>
      </view>
    </view>

    <!-- ===== 支持 PWstudy（打赏）：独立挂在页面最外层底部 =====
         不放进任何折叠分组 —— 分组收起就看不见了，而打赏是常驻入口 -->
    <view class="card donate-card" @tap="openDonate">
      <view class="dc-main">
        <text class="dc-title">{{ $t('支持 PWstudy') }}</text>
        <text class="dc-desc">{{ $t('请作者喝一杯 · 支付宝 / 微信扫码') }}</text>
      </view>
      <text class="dc-arrow">{{ $t('打赏 ›') }}</text>
    </view>

    <!-- ===== App 交流群：群号常驻可见，点一下直接复制 =====
         和打赏卡一样挂在最外层底部：折叠分组收起后就找不到了 -->
    <view class="card qq-card" @tap="copyQQGroup">
      <view class="dc-main">
        <text class="dc-title">{{ $t('App 交流群') }}</text>
        <text class="dc-desc">{{ $t('QQ 群 · 点一下复制群号') }}</text>
      </view>
      <text class="dc-num">{{ qqGroup }}</text>
    </view>

    <!-- 危险操作确认 / 语言选择（统一弹窗，替代系统 showModal / showActionSheet） -->
    <app-dialog
      :show="confirm.show"
      :mode="confirm.mode"
      :title="confirm.title"
      :content="confirm.content"
      :confirm-text="confirm.confirmText"
      :items="confirm.items"
      :danger="confirm.danger"
      :seq="confirm.seq"
      @confirm="onConfirmYes"
      @cancel="confirm.show = false"
    />

    <!-- ===== 彩蛋：连点「版本」触发 =====
         fixed 浮层，挂在页面最外层（不随内容滚动）。
         材质直接复用 App.vue 的 .pop-mask/.pop-card，这里只写内容层。 -->
    <view v-if="eggShow" class="pop-mask egg-mask" @tap="closeEgg">
      <view class="pop-card egg-card" @tap.stop="noop">
        <!-- 撒花：纯 view + transform 位移，不用 Canvas/SVG
             —— 各端支持不一致，且原生组件脱离 CSS transform（首页切 tab 要整体滑） -->
        <view class="egg-rain">
          <text
            v-for="(p, i) in eggPieces"
            :key="'eg' + i"
            class="egg-piece"
            :style="p.style"
          >{{ p.ch }}</text>
        </view>
        <text class="egg-emoji">{{ eggEmoji }}</text>
        <text class="egg-title">{{ $t('彩蛋') }}</text>
        <text class="egg-line">{{ eggLine }}</text>
        <view class="egg-stats">
          <view v-for="(s, i) in eggStats" :key="'es' + i" class="egg-stat">
            <text class="egg-stat-k">{{ s.k }}</text>
            <text class="egg-stat-v">{{ s.v }}</text>
          </view>
        </view>
        <text class="egg-btn" @tap="closeEgg">{{ $t('收起来') }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import { t } from '../../../utils/i18n.js';
import { LOCALES, current as currentLocale, setLocale } from '../../../utils/i18n.js';
import * as settings from '../../../utils/settings'
import * as onboarding from '../../../utils/onboarding.js'
import * as timeslot from '../../../utils/timeslot.js'
import * as updater from '../../../utils/updater.js'
import * as partner from '../../../utils/partner.js'
// 只借它的"呼起伙伴 App"那一个函数；utils/link.js 同时被 App.vue 引着，不会重复打包
import { openPartner as openPartnerLink } from '../../../utils/link.js'
import * as pwreset from '../../../utils/pwreset.js'
import { stop as voiceStop, status as voiceStatus, resetVoice } from '../../../services/voice.js'
import { validateKeyFormat, testAIConnection } from '../../../services/ai-content.js'
import { PROVIDER_PRESETS, providerSupportsTTS, TTS_MODELS } from '../../../services/config.js'
import { AI_FEATURES, featureMap, setFeature, setAll as setAllAiFeatures, offCount } from '../../../services/ai-gate.js'
import { resetBreaker } from '../../../services/http.js'
import * as aiCache from '../../../utils/ai-cache.js'
import * as apiUsage from '../../../utils/api-usage.js'
import { speakSentence as aiSpeak } from '../../../services/voice.js'
import * as sfx from '../../../utils/sfx.js'
// 触感反馈（震动）：开关落盘 + 试一下（utils/haptic.js）
import * as haptic from '../../../utils/haptic.js'
// 只有几百字节的规模快照：设置页在分包里，不能为了显示几个数字去 import 语料本身
import { BUILD_INFO } from '../../../data/build-info.js'
import {
  BACKGROUNDS, ACCENTS, SWATCHES,
  CUSTOM_KEY, DEFAULT_CUSTOM,
  current as currentBg, setBackground, backgroundOf,
  currentAccent, setAccent,
  currentBgImage, currentMask, setMask, currentBlur, setBlur,
  currentCustomColor, setCustomColor,
  chooseBackgroundImage, clearBgImage,
  isDark, systemPrefersDark, currentDark, currentFollowSystem, setDark, setFollowSystem,
  currentSmooth, setSmooth
} from '../../../utils/theme.js'
import { hexToHsl, hslToHex, darkVariant } from '../../../utils/color.js'
import * as perf from '../../../utils/perf.js'
import * as setup from '../../../utils/setup.js'
import { QUALITY, glassText, motionText, shadowText } from '../../../utils/perf.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../../components/app-dialog/app-dialog.vue'

const TRY_TEXT = {
  zh: t('这个词的意思是不可避免的，中文发音应该更自然一些。'),
  en: 'This sentence should sound much more natural.'
}

// ---------------------------------------------------------------- 彩蛋
// 连点「关于 › 版本」触发。阈值 7 下、窗口 2.5 秒：
// 够长让人不至于手滑误触，够短不至于让人以为点了没反应。
const EGG_TAPS = 7
const EGG_WINDOW = 2500

// 台词：中文原文即 i18n key（见 i18n-en.js），英文态自动取译文。
// 第一次固定给 EGG_LINES[0]（ welcome 口吻），之后随机，让每次重开都不一样。
const EGG_LINES = [
  '被你找到了。这张卡就是全部彩蛋，没有下一层了。',
  '据说连点七下的人，四级都过了。',
  '词表是离线打包进 App 的 —— 断网、飞行模式、地铁里，照样能背。',
  '开发者也在用这个 App 背单词，进度比你慢。',
  '这行字是手敲的，不是 AI 生成的。值两毛。',
  '别翻了，隐藏功能就这一张卡；剩下的都是 bug。'
]
const EGG_EMOJIS = ['🎉', '✨', '🥚', '', '🍳', '🎈']

// 撒花：8 片，错开水平位置与启动延迟，避免"整排一起掉"的廉价感。
// 用 view + transform 而不是 Canvas —— 各端支持不一致，且原生组件脱离 CSS transform。
const EGG_PIECES = ['🎉', '✨', '🎊', '🥚', '⭐', '🎈', '✨', '🎉'].map((ch, i) => ({
  ch,
  style: 'left:' + (i * 11 + 6) + '%;animation-delay:' + (i * 0.19).toFixed(2) + 's'
}))

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      // App 交流群（QQ 群号）：点一下复制，不跳外链
      qqGroup: '1127534463',
      // 「开始前的几件事」收起时显示的缺项数（0 = 都已开启）
      startPending: 0,
      // 危险确认（confirm 模式）与语言选择（sheet 模式）共用一张弹窗
      confirm: {
        show: false, mode: 'confirm', title: '', content: '',
        confirmText: t('确定'), items: [], danger: true, seq: 0, action: ''
      },
      // 外观
      accents: ACCENTS,
      accentKey: 'rose',
      backgrounds: BACKGROUNDS,
      bgKey: 'sand',
      bgImage: '',
      mask: 0.35,
      blur: 0,
      // 自定义底色：色板 + 三根滑杆（HSL）
      swatches: SWATCHES,
      customHex: DEFAULT_CUSTOM,
      hsl: hexToHsl(DEFAULT_CUSTOM),
      // 大胶囊分组：一次只展开一个（'' 表示全部收起）
      openSec: '',
      darkOn: false,
      followSystem: false,
      systemDark: false,
      // AI
      ai: {},
      ttsModels: TTS_MODELS,
      showKey: false,
      aiAdvanced: false,
      providers: PROVIDER_PRESETS,
      voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
      testing: false,
      // 语音 / 通知 / 隐私
      voice: {},
      engines: [
        { key: 'auto', name: t('自动（系统优先）') },
        { key: 'native', name: t('只用系统语音') },
        { key: 'online', name: t('只用在线发音') }
      ],
      engineStatus: null,
      notifications: {},
      privacy: {},
      // 触感反馈：on = 总开关。hapticFail 只在"试过一次且没震成"时才亮 ——
      // 不能一进来就断言设备不支持（老包没打震动权限时是真机才知道的事）
      hapticOn: true,
      hapticFail: false,
      // 伙伴 App（背单词）：可选关联。四个状态全靠 pn.state + pn.installed 组合出来
      //   installed=false        → 未安装
      //   undecided / declined   → 未决定 / 已关闭
      //   linked                 → 已关联
      pn: { installed: false, state: 'undecided', min: 0, words: 0, sync: 'never', syncN: 0 },
      // AI 缓存：只暴露条数，内容按类别整体清除
      cacheStats: { words: 0, sentences: 0, updatedAt: 0 },
      apiUsageText: '',
      // 流畅模式：关闭毛玻璃模糊（低端机退路）
      smooth: false,
      perfText: t('未检测'),
      // 画质档位：'auto' 表示听性能检测的；下面三个维度可以在档位之上单独改
      quality: 'auto',
      fx: { glass: 'full', motion: 'full', shadow: 'full' },
      qualityList: [
        { key: 'auto', name: '自动' },
        { key: 'high', name: '高画质' },
        { key: 'clear', name: '清透' },
        { key: 'balanced', name: '均衡' },
        { key: 'lite', name: '轻量' },
        { key: 'eco', name: '省电' },
        { key: 'minimal', name: '极简' }
      ],
      glassList: [
        { v: 'full', n: '全部' },
        { v: 'key', n: '仅关键处' },
        { v: 'off', n: '关闭' }
      ],
      motionList: [
        { v: 'full', n: '完整' },
        { v: 'reduced', n: '精简' },
        { v: 'off', n: '关闭' }
      ],
      shadowList: [
        { v: 'full', n: '完整' },
        { v: 'slim', n: '收窄' },
        { v: 'none', n: '无' }
      ],
      version: BUILD_INFO.version,
      // AI 功能分项开关：默认收起；aiTick 是让 computed 跟着开关变化重算的响应式令牌
      aiFnOpen: false,
      aiTick: 0,
      // AI 规划偏好（任务附资料建议，默认关）
      planRes: false,
      // AI 规划偏好：时段安排（默认开）+ 时段到点提醒（默认开）
      planSlot: true,
      planSlotNotify: true,
      // 更新：启动时自动检查（默认开）
      updateAuto: true,
      checking: false,
      // 彩蛋
      eggShow: false,
      eggPieces: EGG_PIECES,
      eggEmoji: EGG_EMOJIS[0],
      eggLineKey: EGG_LINES[0],
      eggFound: 0,
      eggTaps: 0,
      eggLastAt: 0
    }
  },
  computed: {
    // 当前语言的显示名（如「简体中文」）
    localeName() {
      void this.__lang;   // 切语言后要跟着重算
      const k = currentLocale();
      const hit = LOCALES.filter(x => x.key === k)[0];
      return hit ? hit.name : k;
    },
    // 当前主题色的十六进制（用于 switch / slider / modal 等只接受色值的组件属性）
    brandMain() {
      const a = ACCENTS.find(x => x.key === this.accentKey)
      return a ? a.main : '#e4173d'
    },
    // 自定义色块：深色模式下显示压暗变体，和实际铺在屏幕上的底色一致
    customSwatch() {
      const hex = this.customHex || DEFAULT_CUSTOM;
      return this.darkOn ? darkVariant(hex) : hex;
    },
    ttsSupported() {
      return providerSupportsTTS(this.ai.provider);
    },
    // AI 是否已具备基本可用条件（总开关 + 地址 + 密钥）
    aiReady() {
      return !!(this.ai.enabled && this.ai.baseURL && this.ai.apiKey);
    },
    // AI 功能清单：把开关状态预先摊平成数组。
    // uni 模板（小程序端）不支持在插值里调用函数，所以这里一次性算好，
    // 模板只做属性读取。
    aiFnList() {
      void this.aiTick;
      const f = featureMap();
      return AI_FEATURES.map(x => ({
        key: x.key,
        name: x.name,
        desc: x.desc,
        level: x.level,
        levelLabel: x.levelLabel,
        on: f[x.key] !== false
      }));
    },
    aiFnOff() {
      void this.aiTick;
      return offCount();
    },
    // 彩蛋台词：存的是中文 key，译文在这里取 —— 弹窗开着时切语言也能跟着变
    eggLine() {
      void this.__lang;
      return t(this.eggLineKey);
    },
    // 彩蛋里的面板。只留 PWstudy 自己还讲得通的数字：
    // 「内置词条 / 考试词书 / 练习例句」那几行是背单词时代的语料规模，
    // 语料整簇挪出 App 之后（2026-10-10）它们描述的已经是不存在的东西，撤掉。
    eggStats() {
      void this.__lang;
      const B = BUILD_INFO;
      return [
        { k: t('版本'), v: B.version },
        { k: t('构建日期'), v: B.builtAt },
        { k: t('发现次数'), v: t('第 {n} 次', { n: this.eggFound }) }
      ];
    },
    // 收起时的缓存摘要：单词 / 例句 各多少条。
    // 必须是 computed —— 模板里 {{ cacheHint }} 是按属性取的，写在 methods 里
    // 会把函数本体渲染成 "function () { [native code] }"
    cacheHint() {
      void this.__lang;   // 摘要文案跟语言走，切语言要重算
      const n = (this.cacheStats.words || 0) + (this.cacheStats.sentences || 0);
      return n ? t('{n} 条', { n: n }) : t('暂无');
    },
    // 伙伴 App 的状态行：把"今天同步到多少"和"上次同步是多久之前"合成一句。
    // 为什么必须显示这两条：只写"已关联"的话，链接坏了用户根本发现不了 ——
    // 他会以为是今天没背，而不是通道断了。
    partnerStatText() {
      void this.__lang;
      const p = this.pn;
      const today = t('今天 {min} 分钟 · {words} 词', { min: p.min || 0, words: p.words || 0 });
      if (p.sync === 'never') return today + ' · ' + t('还没有同步记录');
      if (p.sync === 'min') {
        return today + ' · ' + (p.syncN < 1 ? t('刚刚同步') : t('{n} 分钟前同步', { n: p.syncN }));
      }
      if (p.sync === 'hour') return today + ' · ' + t('{n} 小时前同步', { n: p.syncN });
      return today + ' · ' + t('{n} 天前同步', { n: p.syncN });
    },
    // 档位说明：说清这档到底砍了什么，加上"当前是否有手工微调"
    qualityHint() {
      void this.__lang;
      const fx = perf.getFx() || {};
      const q = perf.currentQualityKey();
      const base = QUALITY[q] || QUALITY.high;
      const parts = [t(base.name)];
      parts.push(t(base.desc));
      // 三个维度里只要有一个偏离了档位默认值，就提示用户"已自定义"
      const off = [];
      if (fx.glass && fx.glass !== base.glass) off.push(t('毛玻璃') + '·' + glassText(fx.glass));
      if (fx.motion && fx.motion !== base.motion) off.push(t('动效') + '·' + motionText(fx.motion));
      if (fx.shadow && fx.shadow !== base.shadow) off.push(t('阴影') + '·' + shadowText(fx.shadow));
      if (off.length) parts.push(t('已自定义：{list}', { list: off.join(' / ') }));
      return parts.join(' · ');
    },
    // 输入格式校验（纯本地，不发请求）
    keyFormat() {
      return validateKeyFormat({
        baseURL: this.ai.baseURL,
        apiKey: this.ai.apiKey,
        model: this.ai.model
      });
    },
    canTest() {
      return !this.testing && !!this.ai.enabled && this.keyFormat.ok;
    },
    // 统一状态：idle（未验证）/ ok（可正常使用）/ warn（格式问题）/ fail（连接失败）
    status() {
      if (!this.ai.enabled) return { cls: 'idle', text: t('AI 服务已关闭') };
      if (!this.keyFormat.ok) return { cls: 'warn', text: this.keyFormat.reason };
      const v = this.ai.verify;
      if (v && v.sig === this.configSig()) {
        if (v.ok) {
          return { cls: 'ok', text: t('可正常使用') + (v.latency ? '（' + v.latency + ' ms）' : '') };
        }
        return { cls: 'fail', text: v.msg || t('连接失败') };
      }
      return { cls: 'idle', text: t('格式校验通过，点击「测试连接」验证') };
    },
    // 跟随系统时，深色开关显示的是"系统当前值"，不允许手动改
    darkHint() {
      // 跟随系统时把读到的值直接摆出来：读不到就是配置/内核问题，一眼能看出来
      if (this.followSystem) return t('已跟随系统 · 读取到') + (this.systemDark ? t('深色') : t('浅色'));
      return this.darkOn ? t('底色转深灰，文字转亮，背景图自动降亮度') : t('当前为浅色');
    },
    engineKey() {
      return this.voice.engine || 'auto';
    },
    engineStatusText() {
      const s = this.engineStatus;
      if (!s) return t('点击「重新检测」查看');
      if (!s.provider || s.provider === 'youdao-only') {
        return t('未启用系统语音（当前设置只用在线发音）');
      }
      if (!s.nativeReady) return t('系统语音未就绪，将回退在线发音');
      const l = s.lang || {};
      const zh = l.zh === false ? t('中文不可用') : t('中文可用');
      const en = l.en === false ? t('英文不可用') : t('英文可用');
      const head = t('系统语音已就绪 · {zh} / {en}', { zh: zh, en: en });
      return l.device ? head + t('（设备语言 {d}）', { d: l.device }) : head;
    }
  },
  onShow() {
    this.refresh()
    this.accentKey = currentAccent()
    this.bgKey = currentBg()
    this.bgImage = currentBgImage()
    this.customHex = currentCustomColor() || DEFAULT_CUSTOM
    this.hsl = hexToHsl(this.customHex)
    this.mask = currentMask()
    this.blur = currentBlur()
    this.darkOn = isDark()
    this.followSystem = currentFollowSystem()
    this.systemDark = systemPrefersDark()
    this.version = this.readVersion()
    // 从「开始前的几件事」退回来要重数一次（可能刚在那边开了权限）
    try { this.startPending = setup.pending().length } catch (e) { this.startPending = 0 }
  },
  methods: {
    // 背景色块：深色模式下显示压暗变体，与实际背景一致、各预设之间也能区分开
    bgSwatch(b) {
      return this.darkOn ? (b.darkCss || b.css) : b.css
    },
    // ---------- 大胶囊分组 ----------
    /** 重看「开始前的几件事」：只是打开那一屏，不动 firstRun 记账 ——
        清掉记账的话退回首页会被 shouldFirstRun 再拽回去一次，来回打转。 */
    goStart() {
      uni.navigateTo({ url: '/pkgManage/pages/start/start' })
    },
    toggleSec(e) {
      const k = e.currentTarget.dataset.k
      this.openSec = this.openSec === k ? '' : k
    },

    // 打赏页（设置 → 关于 → 支持 PWstudy）
    openDonate() {
      uni.navigateTo({ url: '/pkgManage/pages/donate/donate' })
    },
    // （replayGuide 随「新手引导」入口一起撤掉，见模板里那条注释）
    /**
     * 复制 QQ 群号。不跳外部链接 —— 只是把号码放进剪贴板，
     * 用户自己去 QQ 里加群；这样既不依赖任何第三方 SDK，也不会跳出 App。
     */
    copyQQGroup() {
      const n = String(this.qqGroup || '')
      try {
        uni.setClipboardData({ data: n })
        uni.showToast({ title: t('群号已复制'), icon: 'none' })
      } catch (e) {
        // 剪贴板不可用时至少把号码显示出来，用户还能手抄
        uni.showToast({ title: n, icon: 'none' })
      }
    },
    // 收起时在胶囊右侧显示一行摘要，展开后由内容自己表达
    secHint(k) {
      if (k === 'appearance') {
        const a = ACCENTS.find(x => x.key === this.accentKey)
        return (a ? a.name : '') + ' · ' + (this.darkOn ? t('深色') : t('浅色'))
      }
      if (k === 'ai') return this.ai.enabled ? (this.aiReady ? t('已开启') : t('待配置')) : t('未开启')
      if (k === 'voice') return this.voice.useAI && this.aiReady ? t('AI 朗读') : t('本地发音')
      if (k === 'notify') return this.notifications.daily ? this.notifications.time : t('已关闭')
      if (k === 'haptic') return this.hapticOn ? t('已开启') : t('已关闭')
      if (k === 'about') return 'v' + this.version
      if (k === 'cache') return this.cacheHint
      if (k === 'perf') return this.smooth ? t('已开启') : t('已关闭')
      // 「开始前的几件事」：收起时直接说还差几项 —— 拆开看才知道缺权限的话，
      // 这个分区就白摆在这了。
      if (k === 'start') {
        const n = Number(this.startPending) || 0
        return n ? n + ' ' + t('项待处理') : t('都已开启')
      }
      if (k === 'partner') {
        // 收起时一句话说清现在是哪一档；"未检测到"比"未安装"更准确 ——
        // 也有可能是装了但系统不让查（Android 11+ 包可见性），文案不给打包票
        if (!this.pn.installed) return t('未检测到')
        if (this.pn.state === 'linked') return t('已关联')
        if (this.pn.state === 'declined') return t('已关闭')
        return t('未设置')
      }
      return ''
    },

    // 画质档位：先按机器挑一档，下面三个维度还能单独微调
    loadFx() {
      try {
        this.quality = perf.rawQuality();
        const fx = perf.getFx() || {};
        this.fx = {
          glass: fx.glass || 'full',
          motion: fx.motion || 'full',
          shadow: fx.shadow || 'full'
        };
      } catch (e) {}
    },
    onQuality(k) {
      try { perf.setQuality(k, true); } catch (e) {}
      this.loadFx();
      this.smooth = currentSmooth();
      if (this.smooth) this.blur = 0;
      try { this.refreshAppTheme(); } catch (e) {}
    },
    // 单独改某一维（毛玻璃 / 动效 / 阴影）。
    // 值与档位默认值相同 → 那一维的"自定义"标记自动消失
    onFx(part, v) {
      try { perf.setFxPart(part, v); } catch (e) {}
      this.loadFx();
      try { this.refreshAppTheme(); } catch (e) {}
    },

    // 设备性能检测：立刻跑一次，跑完把结果和"要不要开流畅模式"一起写回。
    // rematch=true：重新检测的语义就是"按当前设备重新匹配画质"，
    // 旧的手动档位（可能是在别的机器上选的）一并清掉，回到自动。
    reprobe() {
      this.perfText = t('检测中…')
      // 让"检测中"先渲染出来，再跑阻塞主线程约 60ms 的测算
      setTimeout(() => {
        try {
          const r = perf.autoDowngrade(true, { rematch: true })
          this.smooth = !!r.smooth
          this.blur = this.smooth ? 0 : this.blur
        } catch (e) {}
        this.perfText = perf.summary().text
        // 重测会重写推荐的档位，界面上的档位选择要跟着变
        this.loadFx()
        try { this.refreshAppTheme() } catch (e) {}
      }, 60)
    },

    // 流畅模式：只影响观感（关掉毛玻璃模糊），不动任何数据
    onSmooth(e) {
      // 手动拨的开关：auto 置 false，之后自动检测不再覆盖这个选择
      this.smooth = setSmooth(e.detail.value, false)
      // 背景模糊在流畅模式下被强制归零，滑块要跟着回弹
      if (this.smooth) this.blur = 0
      // 根节点 class 变了要立刻重算，否则当前页要等下次 onShow 才生效
      try { this.refreshAppTheme() } catch (err) {}
    },

    // ---------- 伙伴 App（背单词）：可选关联 ----------
    // 三个源头每次重读：安装检测走系统、意愿存 settings、今天的数据在 pwstore。
    // 不缓存 —— 用户可能刚在后台装完/卸掉，进设置页就该看到最新的。
    refreshPartner() {
      try {
        const ago = partner.syncAgo()
        this.pn = {
          installed: partner.installed(),
          state: partner.state().state,
          min: partner.todayMin(),
          words: partner.todayWords(),
          sync: ago.unit,
          syncN: ago.n
        }
      } catch (e) {}
    },
    doLink() {
      partner.link()
      this.refreshPartner()
      uni.showToast({ title: t('已关联 · 过去背完会自动记回今天'), icon: 'none', duration: 2200 })
    },
    // 设置页主动点「不用了」= declined：和弹窗里那个选项同一个落点，之后不再自动问
    doDecline() {
      partner.unlink()
      this.refreshPartner()
      uni.showToast({ title: t('已关闭 · 随时可以在这里重新打开'), icon: 'none' })
    },
    askUnlink() {
      this.confirm = Object.assign(this.blankConfirm(), {
        show: true,
        title: t('取消关联'),
        content: t('之后两边不再互相跳转，也不再回传词数。已经记进今天的时长与词数会原样保留 —— 那是真实发生过的学习，不跟着关联一起删。'),
        confirmText: t('取消关联'),
        danger: false,
        action: 'unlink'
      })
    },
    // 从设置页过去不带具体任务：这里的意图是"想背一会儿"，不是"要完成某个任务"
    goPartner() {
      const ok = openPartnerLink(null, 25)
      if (!ok) uni.showToast({ title: t('没能打开背单词 App'), icon: 'none' })
    },

    // ---------- AI 缓存（按类别整体清除，不支持逐条删） ----------
    askClear(kind) {
      const isWord = kind === 'words'
      const n = isWord ? this.cacheStats.words : this.cacheStats.sentences
      if (!n) {
        uni.showToast({ title: isWord ? t('暂无缓存单词') : t('暂无缓存例句'), icon: 'none' })
        return
      }
      // 数量用占位符塞进整句里：英文语序和中文不一样，拼接出来的句子读不通
      const detail = isWord
        ? t('将删除 {n} 条缓存单词的定义，', { n: n })
        : t('将删除 {n} 条缓存例句，', { n: n })
      this.confirm = Object.assign(this.blankConfirm(), {
        show: true,
        title: isWord ? t('清空缓存单词') : t('清空缓存例句'),
        content: detail + t('不会影响当前词书与学习进度。缓存内容无法逐条删除，只能按类别清空。'),
        confirmText: t('清空'),
        action: isWord ? 'clear-words' : 'clear-sentences'
      })
    },

    doClear(kind) {
      if (kind === 'words') aiCache.clearWords()
      else aiCache.clearSentences()
      this.cacheStats = aiCache.stats()
      uni.showToast({
        title: kind === 'words' ? t('已清空缓存单词') : t('已清空缓存例句'),
        icon: 'success'
      })
    },
    // ---------- 外观 ----------
    pickAccent(e) {
      const key = e.currentTarget.dataset.k
      this.accentKey = key
      setAccent(key)
      this.refreshAppTheme()
    },
    pickBg(e) {
      const key = e.currentTarget.dataset.k
      this.bgKey = key
      this.bgImage = ''
      setBackground(key)
      this.refreshAppTheme()
    },
    // ---------- 自定义底色 ----------
    // 起点用"当前这一档的底色"：从某个预设切过来时不会突然跳到一个陌生颜色，
    // 滑杆也落在一个真实存在的颜色上。
    pickCustomBg() {
      const seed = currentCustomColor() || backgroundOf(this.bgKey, false).solid || DEFAULT_CUSTOM
      this.customHex = seed
      this.hsl = hexToHsl(seed)
      this.applyCustom(seed)
    },
    pickSwatch(e) {
      const c = e.currentTarget.dataset.c
      if (!c) return
      this.hsl = hexToHsl(c)
      this.applyCustom(c)
    },
    // 三根滑杆：拖动中只动预览（不写盘、不重算背景），松手才真正应用，
    // 否则一次拖动会连着写几十次 storage 并整屏重算背景。
    onHsl(k, e, commit) {
      const v = Number(e.detail.value)
      if (!isFinite(v)) return
      const h = { h: this.hsl.h, s: this.hsl.s, l: this.hsl.l }
      h[k] = Math.round(v)
      this.hsl = h
      const hex = hslToHex(h.h, h.s, h.l)
      if (commit) this.applyCustom(hex)
      else this.customHex = hex
    },
    applyCustom(hex) {
      // setCustomColor 顺手把 background 切到 custom 档并清掉背景图
      this.customHex = setCustomColor(hex)
      this.bgKey = CUSTOM_KEY
      this.bgImage = ''
      this.refreshAppTheme()
    },
    resetCustom() {
      this.hsl = hexToHsl(DEFAULT_CUSTOM)
      this.applyCustom(DEFAULT_CUSTOM)
    },
    async chooseBg() {
      const p = await chooseBackgroundImage()
      if (p) {
        this.bgImage = p
        this.mask = currentMask()
        this.blur = currentBlur()
        this.refreshAppTheme()
        uni.showToast({ title: t('已应用背景图'), icon: 'success' })
      }
    },
    clearBg() {
      clearBgImage()
      this.bgImage = ''
      this.refreshAppTheme()
    },
    onMask(e) {
      const v = Number(e.detail.value) || 0
      this.mask = v
      setMask(v)
      this.refreshAppTheme()
    },
    onBlur(e) {
      const v = Number(e.detail.value) || 0
      this.blur = v
      setBlur(v)
      this.refreshAppTheme()
    },
    toggleDark(v) {
      if (this.followSystem) return
      setDark(!!v)
      this.darkOn = isDark()
      this.refreshAppTheme()
    },
    toggleFollow(v) {
      setFollowSystem(!!v)
      this.followSystem = currentFollowSystem()
      this.darkOn = isDark()
      this.systemDark = systemPrefersDark()
      this.refreshAppTheme()
    },
    // ---------- AI ----------
    toggleAdv() {
      this.aiAdvanced = !this.aiAdvanced
    },
    // 试听云端音色：直接用当前配置朗读一句中/英示例（未配置会自动降级本地）
    tryVoice(lang) {
      try { voiceStop() } catch (e) {}
      aiSpeak(TRY_TEXT[lang] || TRY_TEXT.en, { lang })
    },
    refresh() {
      const s = settings.get()
      this.ai = Object.assign({}, s.ai)
      this.planRes = !!(s.plan && s.plan.res)
      // 时段两项的默认值在 utils/timeslot.js 里（老数据没字段 = 开），这里只负责显示
      this.planSlot = timeslot.enabled()
      this.planSlotNotify = timeslot.notifyOn()
      this.updateAuto = updater.autoEnabled()
      this.voice = Object.assign({}, s.voice)
      this.notifications = Object.assign({}, s.notifications)
      this.privacy = Object.assign({}, s.privacy)
      // 触感反馈（isEnabled 内部自带脏值兜底：读不到按"开"处理）
      this.hapticOn = haptic.isEnabled()
      this.refreshPartner()
      this.cacheStats = aiCache.stats()
      this.apiUsageText = apiUsage.brief()
      this.smooth = currentSmooth()
      this.perfText = perf.summary().text
      this.loadFx()
      this.readEngineStatus()
      // 彩蛋发现次数（老数据没有 egg 字段，兜 0）
      this.eggFound = ((s.egg || {}).found || 0)
    },
    // 配置指纹：地址/模型/密钥任一变化即视为"未验证"
    configSig() {
      return [this.ai.baseURL || '', this.ai.model || '', this.ai.apiKey || ''].join('|')
    },
    // ---------- AI 功能分项开关 ----------
    toggleAiFn() {
      this.aiFnOpen = !this.aiFnOpen;
    },
    toggleFeature(key, on) {
      setFeature(key, !!on);
      this.aiTick++;
    },
    setAllFeatures(on) {
      setAllAiFeatures(!!on);
      this.aiTick++;
    },

    setAI(key, value) {
      const patch = { [key]: value }
      // 影响可用性的字段变更后，清除上一次的验证结果
      if (key === 'baseURL' || key === 'apiKey' || key === 'model') {
        patch.verify = { sig: '', ok: false, msg: '', latency: 0, ts: 0 }
        // 换了地址 / 密钥 / 模型，之前攒下的失败记录就不再代表这个配置了，
        // 复位熔断，否则刚改好还得干等 60s 冷却
        resetBreaker()
      }
      settings.set({ ai: patch })
      this.refresh()
      // 密钥填完（格式通过）时自动校验一次，让"可正常使用"自动出现
      if (key === 'apiKey' && this.canTest) {
        this.runTest()
      }
    },
    // AI 规划偏好：任务要不要附资料/工具建议（settings.plan.res，默认关）
    setPlanRes(on) {
      settings.set({ plan: { res: !!on } })
      this.refresh()
    },
    // 时段安排：关掉后规划回到纯任务模式（已排好的时段留着，开回来还能看见）
    setPlanSlot(on) {
      timeslot.setEnabled(on)
      this.refresh()
    },
    // 时段到点提醒：依附于时段安排，单独可关
    setPlanSlotNotify(on) {
      timeslot.setNotifyOn(on)
      this.refresh()
    },
    // ---------- 更新 ----------
    setUpdateAuto(on) {
      updater.setAuto(on)
      this.refresh()
    },
    /** 手动检查：这次要给人一个明确结果（启动自检是静默的，这里不是） */
    doCheckUpdate() {
      if (this.checking) return
      this.checking = true
      try { uni.showLoading({ title: '检查中…', mask: true }) } catch (e) {}
      updater.manualCheck().then((r) => {
        this.checking = false
        try { uni.hideLoading() } catch (e) {}
        updater.showResult(r)
      }).catch((e) => {
        this.checking = false
        try { uni.hideLoading() } catch (e) {}
        // 手动点的必须说清楚为什么没查到，并给出去整包的出口。
        // 弹窗在 updater 里 —— 设置页不直接调系统弹窗（统一走 app-dialog，check-dialog 守着）
        try { updater.checkFailDialog((e && e.message) || '') } catch (err) {}
      })
    },
    /** 完整包：打开 GitHub 上的 Release 页（开不了浏览器会复制链接） */
    goRelease() {
      updater.openRelease()
    },
    /**
     * 重看新手引导：只清掉"看过了"这个标记，然后直接跳回首页 ——
     * 引导是在首页 onShow 里放的，光清标记而不回去，用户会觉得"点了没反应"。
     */
    replayGuide() {
      try { onboarding.restart() } catch (e) {}
      try { uni.switchTab({ url: '/pages/home/home' }) } catch (e) {}
    },
    // 一键选择预设：自动填入该服务商的地址/模型（自定义除外，留给用户手填）
    selectProvider(value) {
      const preset = PROVIDER_PRESETS.find(p => p.value === value)
      const patch = { provider: value, verify: { sig: '', ok: false, msg: '', latency: 0, ts: 0 } }
      if (preset && preset.value !== 'custom') {
        patch.baseURL = preset.baseURL
        patch.model = preset.model
        patch.ttsModel = preset.ttsModel
      }
      settings.set({ ai: patch })
      // 换服务商 = 换了地址，熔断记录同样作废
      resetBreaker()
      this.refresh()
    },
    // 连通性测试：真实调用一次（max_tokens=8），成功即写入"可正常使用"
    async runTest() {
      if (!this.canTest) return
      this.testing = true
      const sig = this.configSig()
      try {
        const r = await testAIConnection()
        settings.set({ ai: { verify: { sig, ok: true, msg: '', latency: r.latencyMs || 0, ts: Date.now() } } })
        this.refresh()
        uni.showToast({ title: t('可正常使用'), icon: 'success' })
      } catch (e) {
        const msg = (e && e.message) ? e.message : t('连接失败')
        settings.set({ ai: { verify: { sig, ok: false, msg, latency: 0, ts: Date.now() } } })
        this.refresh()
      } finally {
        this.testing = false
      }
    },
    setVoice(key, value) {
      settings.set({ voice: { [key]: value } })
      this.refresh()
      // 语速变化即时生效到本地 TTS
      if (key === 'speed') {
        try { voiceStop() } catch (e) {}
      }
      // 音效开关：打开时立即试听一声，否则用户不知道自己开了什么
      if (key === 'sfx' && value) {
        try { sfx.play('correct') } catch (e) {}
      }
    },
    // 试听三种音效（答对 / 半对 / 答错）
    previewSfx(kind) {
      try { sfx.play(kind) } catch (e) {}
    },
    setEngine(e) {
      const k = e && e.currentTarget ? e.currentTarget.dataset.k : ''
      if (!k) return
      settings.set({ voice: { engine: k } })
      try { voiceStop() } catch (err) {}
      this.refresh()
      this.readEngineStatus()
    },
    recheckEngine() {
      // 清掉"语言不可用 / 初始化失败"的缓存后重新预热，再读一次状态
      try { this.engineStatus = resetVoice() } catch (e) { this.readEngineStatus() }
      try { uni.showToast({ title: t('已重新检测'), icon: 'none', duration: 1200 }) } catch (e) {}
    },
    readEngineStatus() {
      try { this.engineStatus = voiceStatus ? voiceStatus() : null } catch (e) { this.engineStatus = null }
    },
    setNotifications(key, value) {
      settings.set({ notifications: { [key]: value } })
      this.refresh()
    },
    // ---------- 触感反馈（utils/haptic.js）----------
    // 改总开关并落盘；打开时顺手震一下，让用户立刻知道"这就是它"。
    setHapticOn(on) {
      haptic.setOn(on)
      this.hapticOn = !!on
      this.hapticFail = false
      if (this.hapticOn) this.previewHaptic()
    },
    // 试一下：真的震一次；没震成就把提示露出来（多半是包里没打震动权限）。
    // 有 API 又没报过错却没震成 → 多半是 MIN_GAP 连点窗口吃掉了，不算失败。
    previewHaptic() {
      let ok = false
      try { ok = haptic.tick('switch') } catch (e) { ok = false }
      if (ok) { this.hapticFail = false; return }
      if (!haptic.hasApi() || haptic.lastError()) this.hapticFail = true
    },
    readVersion() {
      // 三端统一显示 data/build-info.js 里的版本号（manifest.json 的 versionName 同步维护）。
      // 之前 App 端读 plus.runtime.version、其余端读 uni.getSystemInfoSync().appVersion ——
      // 后者在微信小程序里返回的是**微信自己的版本号**（如 8.0.5），跟本 App 毫不相干。
      return BUILD_INFO.version
    },
    // ---------- 彩蛋：连点「版本」 ----------
    // 前 3 下完全静默（手滑点两下不该有反应），第 4 下起提示还差几下，第 7 下开奖。
    tapVersion() {
      const now = Date.now()
      if (now - this.eggLastAt > EGG_WINDOW) this.eggTaps = 0
      this.eggLastAt = now
      this.eggTaps += 1
      if (this.eggTaps >= EGG_TAPS) {
        this.eggTaps = 0
        this.eggLastAt = 0
        this.openEgg()
        return
      }
      if (this.eggTaps >= 4) {
        const left = EGG_TAPS - this.eggTaps
        try { uni.showToast({ title: t('再点 {n} 下…', { n: left }), icon: 'none', duration: 900 }) } catch (e) {}
      }
    },
    openEgg() {
      const st = settings.get() || {}
      const found = ((st.egg || {}).found || 0) + 1
      // 计数落盘：只为了第 N 次打开时台词不一样，不影响任何功能
      try { settings.set({ egg: { found } }) } catch (e) {}
      this.eggFound = found
      // 第一次固定第一条（"被你找到了"的口吻），之后随机
      this.eggLineKey = found === 1
        ? EGG_LINES[0]
        : EGG_LINES[1 + Math.floor(Math.random() * (EGG_LINES.length - 1))]
      this.eggEmoji = EGG_EMOJIS[Math.floor(Math.random() * EGG_EMOJIS.length)]
      this.eggShow = true
      // 开奖音：两声 "叮叮"。走 sfx 是为了尊重设置里的音效开关（关掉就真的一点声都没有）
      try {
        sfx.play('correct')
        setTimeout(() => { try { sfx.play('correct') } catch (e) {} }, 190)
      } catch (e) {}
    },
    closeEgg() {
      this.eggShow = false
    },
    // 弹窗内部点一下不该穿透到遮罩把弹窗关掉（和结构里 app-dialog 的 noop 同款）
    noop() {},
    clearLearningData() {
      this.confirm = Object.assign(this.blankConfirm(), {
        show: true,
        title: t('清除学习数据'),
        content: t('将删除全部目标、任务、专注与每日统计，进行中的专注会立即停止且不记入统计。此操作不可恢复，建议先到「我的 → 数据备份」导出一份。确定继续？'),
        confirmText: t('清除'),
        action: 'clear'
      })
    },
    logout() {
      this.confirm = Object.assign(this.blankConfirm(), {
        show: true,
        title: t('退出登录'),
        content: t('将重置个人资料与全部设置（AI 配置、朗读偏好等），学习数据保留。确定继续？'),
        confirmText: t('退出'),
        action: 'logout'
      })
    },

    // 弹窗初始态：confirm（危险确认）与 sheet（选语言）共用一张卡片，
    // 每次开弹窗都从这张空白表起，避免上一轮的 items / mode 串味
    blankConfirm() {
      return {
        show: false, mode: 'confirm', title: '', content: '',
        confirmText: t('确定'), items: [], danger: true,
        seq: (this.confirm && this.confirm.seq || 0) + 1, action: ''
      }
    },

    // 语言选择：sheet 模式列出两档语言
    pickLocale() {
      this.confirm = Object.assign(this.blankConfirm(), {
        show: true,
        mode: 'sheet',
        danger: false,
        title: t('界面语言'),
        items: LOCALES.map(l => ({ label: l.name, key: l.key })),
        action: 'locale'
      })
    },

    // payload 语义随 mode 变：sheet → 选中下标，confirm → true
    onConfirmYes(payload) {
      const act = this.confirm.action
      const items = this.confirm.items || []
      this.confirm.show = false
      if (act === 'locale') {
        const pick = items[payload]
        if (pick && pick.key) {
          setLocale(pick.key)
          uni.showToast({ title: pick.label, icon: 'none' })
        }
        return
      }
      if (act === 'clear') {
        // 清的是 PWstudy 自己的库（目标/任务/专注/Dock/每日统计 + 规划会话 + 要点 + AI 缓存）；
        // AI 配置与外观属于偏好，走「退出登录」才清
        const gone = pwreset.clearAll()
        this.cacheStats = aiCache.stats()
        uni.showToast({ title: t(pwreset.summary(gone)), icon: 'none', duration: 2200 })
      } else if (act === 'logout') {
        settings.reset()
        this.refresh()
        uni.showToast({ title: t('已退出'), icon: 'success' })
      } else if (act === 'clear-words') {
        this.doClear('words')
      } else if (act === 'clear-sentences') {
        this.doClear('sentences')
      } else if (act === 'unlink') {
        partner.unlink()
        this.refreshPartner()
        uni.showToast({ title: t('已取消关联'), icon: 'none' })
      }
    }
  }
}
</script>

<style>
/* ===== 大胶囊分组 ===== */
/* 收起时 = 只有名字的悬浮胶囊（和顶栏/底栏同一套玻璃语言）；
   展开后 = 一张可调的大卡片，圆角从"全圆"过渡到"大圆角"。 */
/* ===== 支持 PWstudy（打赏）：最外层底部的独立卡 =====
   用大圆角胶囊的材质，但常驻可见 —— 折叠分组收起后就找不到了 */
.donate-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
  padding: 30rpx 34rpx;
  border-radius: 32rpx;
}

.dc-main { flex: 1; min-width: 0; }

.dc-title {
  display: block;
  font-size: 29rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

.dc-desc {
  display: block;
  margin-top: 8rpx;
  font-size: 23rpx;
  line-height: 1.5;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.dc-arrow {
  flex-shrink: 0;
  margin-left: 20rpx;
  font-size: 24rpx;
  font-weight: 500;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(228, 23, 61, 0.12);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.12);
}

/* 交流群：群号用衬线数字，和打赏卡的"箭头"区分开（它是要抄走的号码） */
.qq-card { align-items: center; }

.dc-num {
  flex-shrink: 0;
  margin-left: 20rpx;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 34rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.06);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
}

.sec {
  margin-bottom: 20rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  box-shadow: 0 10rpx 30rpx rgba(23, 32, 26, 0.07), 0 2rpx 6rpx rgba(23, 32, 26, 0.04);
  box-shadow: 0 10rpx 30rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.07), 0 2rpx 6rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.04);
  box-sizing: border-box;
  /* 圆角不做过渡：内容一出现卡片就变高了，此时如果圆角还在 999rpx→32rpx 的中间态，
     会看到"已经很高但四个角还是巨圆"的畸形卡片。改成瞬间切换，展开感交给内容生长。 */
}

.sec.open { border-radius: 32rpx; }

.sec-head {
  display: flex;
  align-items: center;
  height: 96rpx;
  padding: 0 40rpx;
}

.sec-name {
  flex: 1;              /* 占满剩余空间：没有摘要的分组（数据与账号）箭头也不会贴到标题上 */
  font-size: 30rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.sec-hint {
  margin-left: auto;
  margin-right: 18rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.sec-arrow {
  font-size: 34rpx;
  line-height: 1;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  transition: transform 220ms ease;
}

.sec.open .sec-arrow {
  transform: rotate(90deg);
  color: #e4173d;
  color: var(--brand, #e4173d);
}

/* 展开：内容从 0 高度长出来（max-height 动画，起点由 CSS 动画第一帧给出，不需要 JS 量高度）。
   用"起步快"的 ease-out，视觉上 200ms 左右就到位，剩下的时长只是把 max-height 推到上限，
   不再有可见变化——既有展开感又不拖沓。收起走 v-if 直接移除，零延迟、最跟手。 */
.sec-body {
  padding: 0 40rpx 40rpx;
  overflow: hidden;
  animation: sec-open 260ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

@keyframes sec-open {
  from {
    max-height: 0;
    padding-bottom: 0;
    opacity: 0;
    transform: translateY(-8rpx);
  }
  to {
    max-height: 4000rpx;
    padding-bottom: 40rpx;
    opacity: 1;
    transform: none;
  }
}

/* 系统开启"减少动效"时直接就位 */
@media (prefers-reduced-motion: reduce) {
  .sec-body { animation: none; }
}

.sec-body .row:last-child { border-bottom: none; }
.sec-body .field:last-child { border-bottom: none; }

.section-title {
  font-size: 32rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  margin: 32rpx 0 20rpx;
}

.group { padding: 8rpx 36rpx; }

.sub-title {
  font-size: 24rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  letter-spacing: 1rpx;
  padding: 24rpx 0 4rpx;
}

/* 主题色：一行小圆点 */
.accent-row {
  display: flex;
  flex-wrap: wrap;
  padding: 12rpx 0 8rpx;
}

.accent {
  width: 20%;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 18rpx;
}

.accent-dot {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(255, 255, 255, 0.9);
  border: 4rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.9));
  box-shadow: 0 4rpx 12rpx rgba(23, 32, 26, 0.1);
  box-shadow: 0 4rpx 12rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.1);
  transition: transform 180ms ease;
}

.accent.active .accent-dot { transform: scale(1.12); }

.accent-name {
  margin-top: 10rpx;
  font-size: 20rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.accent.active .accent-name {
  color: var(--brand-strong, #bb1332);
  font-weight: 600;
}

/* 背景：横向胶囊色板 + 相册入口 */
.bg-row {
  display: flex;
  flex-wrap: wrap;
  padding: 12rpx 0 8rpx;
}

.bg-chip {
  width: 30%;
  height: 88rpx;
  border-radius: 20rpx;
  margin: 0 3% 16rpx 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 3rpx solid rgba(255, 255, 255, 0.85);
  border: 3rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.85));
  box-shadow: 0 4rpx 14rpx rgba(23, 32, 26, 0.06);
  box-shadow: 0 4rpx 14rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.06);
  overflow: hidden;
}

.bg-chip:nth-child(3n) { margin-right: 0; }

.bg-chip.active {
  border-color: var(--brand, #e4173d);
  box-shadow: 0 6rpx 18rpx rgba(var(--brand-rgb, 228, 23, 61), 0.24);
}

.bg-chip-name {
  font-size: 22rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  /* 深色模式下色块变深，给标签加一圈浅描边保持分离感 */
  border: 2rpx solid rgba(255, 255, 255, 0.35);
  border-radius: 999rpx;
  padding: 2rpx 16rpx;
}

.bg-chip.pick {
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border-style: dashed;
}

.bg-chip.pick .bg-chip-name {
  color: var(--brand-strong, #bb1332);
  background: transparent;
}

.bg-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4rpx 0 8rpx;
}

.bg-path { font-size: 22rpx; color: #5a6560; }
.bg-path { font-size: 22rpx; color: var(--ink-2, #5a6560); }

.bg-clear {
  font-size: 24rpx;
  color: var(--brand-strong, #bb1332);
}

.bg-hint {
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  line-height: 1.6;
  padding: 4rpx 0 24rpx;
}

/* ===== 自定义底色：色板 + 三根滑杆 =====
   六列排布：6 × 15% + 5 × 2% = 100%，第 6n 个去掉右边距。
   选中的那格用主色描边 + 一圈外发光，比"打勾"省地方。 */
.cp {
  padding: 20rpx 22rpx 6rpx;
  margin: 4rpx 0 8rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.5);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.5);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
}

.cp-head {
  display: flex;
  align-items: center;
}

.cp-dot {
  width: 44rpx;
  height: 44rpx;
  margin-right: 14rpx;
  border-radius: 50%;
  border: 2rpx solid rgba(23, 32, 26, 0.12);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.12));
}

/* ---------- 伙伴 App（可选关联） ----------
   说明块：一行小标签 + 一段正文。不用卡片也不加边框 ——
   这块内容的作用是"降低决策压力"，视觉上越轻越好，别做成第二个任务。 */
.pn-note {
  display: flex;
  align-items: flex-start;
  margin: 0 0 18rpx;
  padding: 18rpx 20rpx;
  border-radius: 16rpx;
  background: rgba(23, 32, 26, 0.035);
}
.pn-note-tag {
  flex-shrink: 0;
  margin-right: 12rpx;
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  font-size: 20rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  background: rgba(23, 32, 26, 0.06);
}
.pn-note-text {
  flex: 1;
  font-size: 24rpx;
  line-height: 1.65;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
.pn-actions {
  display: flex;
  align-items: center;
  margin-top: 18rpx;
}
.pn-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 168rpx;
  height: 72rpx;
  margin-right: 16rpx;
  padding: 0 30rpx;
  border-radius: 999rpx;
  border: 1rpx solid rgba(23, 32, 26, 0.12);
  border: 1rpx solid var(--hairline, rgba(23, 32, 26, 0.12));
  font-size: 27rpx;
  font-weight: 500;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  text-indent: 2rpx;   /* 补字距：和项目里其它按钮保持一致 */
}
/* 主行动键走出厂 tint 模式（淡红底 + 深红字 + 红描边），不写实心红 */
.pn-btn.primary {
  background: rgba(var(--brand-rgb), 0.1);
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  border-color: rgba(var(--brand-rgb), 0.4);
}
/* 已关联的标记：小圆点 + 字，比整块底色更轻 */
.pn-on {
  display: flex;
  align-items: center;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
}
.pn-on::before {
  content: "";
  display: block;
  width: 12rpx;
  height: 12rpx;
  margin-right: 10rpx;
  border-radius: 50%;
  background: #e4173d;
  background: var(--brand, #e4173d);
}

/* hex 用等宽的衬线体：和项目里"英文走 Georgia"的习惯一致，也不会跳动 */
.cp-hex {
  flex: 1;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 28rpx;
  letter-spacing: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.cp-reset {
  font-size: 24rpx;
  padding: 6rpx 10rpx;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
}

.cp-reset:active { opacity: 0.5; }

.cp-sw {
  display: flex;
  flex-wrap: wrap;
  margin: 16rpx 0 6rpx;
}

.cp-sw-item {
  width: 15%;
  height: 56rpx;
  margin: 0 2% 14rpx 0;
  border-radius: 14rpx;
  box-sizing: border-box;
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
}

.cp-sw-item:nth-child(6n) { margin-right: 0; }

.cp-sw-item.on {
  border-color: #e4173d;
  border-color: var(--brand, #e4173d);
  box-shadow: 0 0 0 4rpx rgba(228, 23, 61, 0.18);
  box-shadow: 0 0 0 4rpx rgba(var(--brand-rgb, 228, 23, 61), 0.18);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.07);
  border-bottom: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.group .row:last-child { border-bottom: none; }

.row-main { flex: 1; min-width: 0; margin-right: 20rpx; }

.row-title { display: block; font-size: 30rpx; color: #17201a; }
.row-title { display: block; font-size: 30rpx; color: var(--ink-1, #17201a); }

.row-title.danger { color: #e5484d; }

.row-desc { display: block; margin-top: 6rpx; font-size: 22rpx; color: #98a19b; line-height: 1.5; }
.row-desc { display: block; margin-top: 6rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); line-height: 1.5; }

/* 答题音效试听：三个小胶囊，颜色跟练习页的判定色一致（对=蓝 / 半对=琥珀 / 错=红） */
/* 贴紧上面的开关行，视觉上算同一组（分隔线保留，跟其它行一致） */
.sfx-preview-row { padding-top: 12rpx; }
.sfx-preview { display: flex; flex-shrink: 0; gap: 12rpx; }
.sfx-dot {
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  font-size: 24rpx;
  font-weight: 500;
  border: 2rpx solid transparent;
}
/* 用半透明底色而不是实底：深色模式下这几个小标签才不会变成突兀的亮块 */
.sfx-dot.ok {
  color: #3b74ff;
  background: rgba(228, 23, 61, 0.14);
  border-color: rgba(228, 23, 61, 0.3);
}
.sfx-dot.half {
  color: #d98324;
  background: rgba(247, 144, 9, 0.16);
  border-color: rgba(247, 144, 9, 0.34);
}
.sfx-dot.no {
  color: #e5484d;
  background: rgba(229, 72, 77, 0.14);
  border-color: rgba(229, 72, 77, 0.3);
}

.row-value { font-size: 24rpx; color: #5a6560; flex-shrink: 0; text-align: right; }
.row-value { font-size: 24rpx; color: var(--ink-2, #5a6560); flex-shrink: 0; text-align: right; }

.row-arrow { font-size: 32rpx; color: #c8cdc9; flex-shrink: 0; }

/* 行内文字按钮（如"重新检测"） */
.row-action {
  flex-shrink: 0;
  font-size: 24rpx;
  font-weight: 500;
  letter-spacing: 1rpx;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
}
.row-action:active { opacity: 0.6; }

.adv-row { border-top: 2rpx solid rgba(23, 32, 26, 0.07); }
.adv-row { border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07); }

.adv-toggle {
  font-size: 24rpx;
  color: var(--brand-strong, #bb1332);
  flex-shrink: 0;
}

.field {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.07);
  border-bottom: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.field:last-child { border-bottom: none; }

.field-note {
  font-size: 22rpx;
  color: #f79009;
  line-height: 1.5;
  padding: 4rpx 0 20rpx;
}

.row-title.muted { color: #b0b7b2; }

/* ===== 画质档位：分段控件 =====
   三个选项以内可以横排一行，七个（含"自动"）也放得下 —— rpx 随屏宽等比缩放，
   每格约 87rpx，最长项「高画质」72rpx 恒放得下；等宽 flex 文字短时自然留白。 */
.seg-group {
  padding: 18rpx 0 6rpx;
  border-bottom: 1rpx solid rgba(var(--shadow-rgb, 23, 32, 26), 0.06);
}

.seg-label {
  display: block;
  font-size: 26rpx;
  color: var(--ink-2, #5a6560);
  margin-bottom: 14rpx;
}

.seg-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 4rpx 0 18rpx;
}

.seg-item {
  flex: 1;
  min-width: 0;
  text-align: center;
  padding: 12rpx 0;
  font-size: 24rpx;
  line-height: 1.2;
  border-radius: 16rpx;
  color: var(--ink-2, #5a6560);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.62);
  border: 1rpx solid rgba(var(--shadow-rgb, 23, 32, 26), 0.08);
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}

.seg-item:active { opacity: 0.7; }

/* 选中态：用 --brand 而不是写死主色 —— 换强调色 / 切深色时会跟着变
   （深色档的主色由 App.vue 的 .app-dark.acc-* 提供，比浅色档提亮一档） */
.seg-item.on {
  background: var(--brand, #e4173d);
  border-color: var(--brand, #e4173d);
  color: #fff;
  font-weight: 500;
}

/* ===== 状态校验 + 测试连接 ===== */
.verify-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 0 8rpx;
}

.verify-status {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  margin-right: 20rpx;
}

.verify-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: #c8cdc9;
  flex-shrink: 0;
  margin-right: 12rpx;
}

.verify-text { font-size: 24rpx; color: #98a19b; line-height: 1.4; }
.verify-text { font-size: 24rpx; color: var(--ink-3, #98a19b); line-height: 1.4; }

.verify-status.ok .verify-dot { background: var(--brand-strong, #bb1332); }
.verify-status.ok .verify-text { color: var(--brand-strong, #bb1332); font-weight: 600; }

.verify-status.warn .verify-dot { background: #f79009; }
.verify-status.warn .verify-text { color: #b54708; }

.verify-status.fail .verify-dot { background: #e5484d; }
.verify-status.fail .verify-text { color: #e5484d; }

.verify-btn {
  flex-shrink: 0;
  height: 68rpx;
  line-height: 68rpx;
  padding: 0 32rpx;
  font-size: 24rpx;
  color: var(--brand-strong, #bb1332);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.3);
  border-radius: 999rpx;
}

.verify-btn::after { border: none; }

.verify-btn.disabled {
  color: #b0b7b2;
  background: rgba(255, 255, 255, 0.4);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.4);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border-color: rgba(23, 32, 26, 0.1);
  border-color: rgba(var(--neutral-rgb, 23, 32, 26), 0.1);
}

.field-label { width: 150rpx; font-size: 26rpx; color: #5a6560; flex-shrink: 0; }
.field-label { width: 150rpx; font-size: 26rpx; color: var(--ink-2, #5a6560); flex-shrink: 0; }

/* 输入块 / 选择器：与卡片同一套玻璃语言 */
.field-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 14rpx 20rpx;
  font-size: 26rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.field-op { font-size: 24rpx; color: var(--brand, #e4173d); margin-left: 16rpx; flex-shrink: 0; }

/* 试听按钮 */
.try-row { display: flex; flex: 1; }

.try-btn {
  flex: 1;
  text-align: center;
  font-size: 24rpx;
  color: var(--brand-strong, #bb1332);
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.3);
  border-radius: 999rpx;
  padding: 12rpx 0;
  margin-right: 16rpx;
}
.try-btn:last-child { margin-right: 0; }
.try-btn:active { background: rgba(var(--brand-rgb, 228, 23, 61), 0.12); }

.slider-field { align-items: center; }

.slider { flex: 1; margin: 0; }

.chips { display: flex; flex-wrap: wrap; flex: 1; }

.chip {
  background: rgba(255, 255, 255, 0.66);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.66);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  font-size: 22rpx;
  border-radius: 999rpx;
  padding: 8rpx 24rpx;
  margin: 0 12rpx 12rpx 0;
  transition: background 200ms ease, color 200ms ease;
}

.chip.active {
  background: #e4173d;
  background: var(--brand, #e4173d);
  color: #ffffff;
  font-weight: 600;
  border-color: #e4173d;
  border-color: var(--brand, #e4173d);
}

.picker-value {
  flex: 1;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 14rpx 20rpx;
  font-size: 26rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

/* ===== 彩蛋（连点「关于 › 版本」） =====
   遮罩与卡片的材质直接复用 App.vue 的 .pop-mask/.pop-card（全 App 弹窗唯一来源），
   这里只写内容层，不改那两个类的尺寸/圆角/内边距。 */
.egg-mask { z-index: 120; }

/* 卡片内要裁掉飘出边界的撒花，所以自己开 overflow —— .pop-card 不能为它开 */
.egg-card {
  position: relative;
  overflow: hidden;
  padding-top: 60rpx;
}

.egg-rain {
  position: absolute;
  left: 0; right: 0; top: 0; bottom: 0;
  /* 撒花只是背景，不能挡住底下按钮的点击 */
  pointer-events: none;
}

.egg-piece {
  position: absolute;
  top: -40rpx;
  font-size: 28rpx;
  opacity: 0;
  animation: egg-fall 1.9s linear infinite;
}

@keyframes egg-fall {
  0% { transform: translateY(0) rotate(0deg); opacity: 0; }
  12% { opacity: 1; }
  100% { transform: translateY(560rpx) rotate(320deg); opacity: 0; }
}

.egg-emoji {
  display: block;
  font-size: 74rpx;
  line-height: 1.15;
  animation: egg-pop 520ms cubic-bezier(0.22, 1.2, 0.36, 1) both;
}

@keyframes egg-pop {
  0% { transform: scale(0.4); opacity: 0; }
  60% { transform: scale(1.14); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

.egg-title {
  display: block;
  margin-top: 10rpx;
  font-size: 32rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.egg-line {
  display: block;
  margin-top: 14rpx;
  font-size: 25rpx;
  line-height: 1.6;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

.egg-stats {
  margin-top: 30rpx;
  padding-top: 22rpx;
  border-top: 2rpx solid rgba(23, 32, 26, 0.08);
  border-top: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
}

.egg-stat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10rpx 0;
}

.egg-stat-k {
  font-size: 24rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

/* 数字用衬线：和正文的无衬线拉开，一眼看出是"读数" */
.egg-stat-v {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 27rpx;
  font-weight: 500;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.egg-btn {
  display: block;
  margin-top: 32rpx;
  padding: 16rpx 0;
  border-radius: 999rpx;
  font-size: 27rpx;
  font-weight: 500;
  letter-spacing: 1rpx;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.12);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.12);
}
</style>
