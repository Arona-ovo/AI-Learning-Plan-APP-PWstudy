<template>
  <view class="container page-nav backup-page" :class="appTheme" :style="appBgStyle">
    <float-navbar title="数据备份" :back="true" />

    <view class="card">
      <view class="card-head">
        <text class="card-title">当前数据量</text>
      </view>
      <view class="stat-row">
        <view class="stat">
          <text class="sv">{{ stat.goals }}</text>
          <text class="sl">目标</text>
        </view>
        <view class="stat">
          <text class="sv">{{ stat.tasks }}</text>
          <text class="sl">任务</text>
        </view>
        <view class="stat">
          <text class="sv">{{ stat.sessions }}</text>
          <text class="sl">番茄</text>
        </view>
        <view class="stat">
          <text class="sv">{{ stat.days }}</text>
          <text class="sl">有记录天数</text>
        </view>
      </view>
      <view class="tip">数据只存在这台手机上。换机、清缓存、卸载前，先导出一份。</view>
    </view>

    <!-- 导出 -->
    <view class="card">
      <view class="card-head">
        <text class="card-title">导出</text>
        <text class="card-more">{{ sizeText }}</text>
      </view>
      <button class="btn-primary bk-btn" @tap="doExport">生成备份 JSON</button>
      <button class="btn-ghost bk-btn" :disabled="!json" @tap="doCopy">复制到剪贴板</button>
      <button class="btn-ghost bk-btn" :disabled="!json" @tap="doSaveFile">另存为文件</button>
      <textarea
        v-if="json"
        class="bk-json"
        :value="json"
        disabled
        :maxlength="-1"
      />
      <view v-if="json" class="hint">上面这段就是全部数据，粘到备忘录/微信收藏里也行。</view>
    </view>

    <!-- 导入 -->
    <view class="card">
      <view class="card-head">
        <text class="card-title">导入</text>
        <text class="card-more" @tap="doPaste">从剪贴板粘贴</text>
      </view>
      <textarea
        class="bk-input"
        v-model="incoming"
        :maxlength="-1"
        placeholder="把备份的 JSON 粘到这里"
        placeholder-style="color:#a8b0ab;font-size:25rpx"
      />
      <view v-if="parsed.ok" class="pk-ok">
        识别到 {{ parsed.summary.goals }} 个目标 · {{ parsed.summary.tasks }} 个任务 ·
        {{ parsed.summary.sessions }} 个番茄 · {{ parsed.summary.days }} 天记录
      </view>
      <view v-else-if="parsed.error" class="pk-err">{{ parsed.error }}</view>

      <view class="seg">
        <text class="seg-opt" :class="{ 'seg-on': mode === 'merge' }" @tap="mode = 'merge'">合并（推荐）</text>
        <text class="seg-opt" :class="{ 'seg-on': mode === 'replace' }" @tap="mode = 'replace'">整包覆盖</text>
      </view>
      <view class="hint">合并：只补进不存在的目标/记录，你现在的数据不会丢。整包覆盖：用备份完全替换现有数据。</view>

      <button class="btn-primary bk-btn" :disabled="!parsed.ok" @tap="doImport">
        导入（{{ mode === 'merge' ? '合并' : '覆盖' }}）
      </button>
    </view>

    <app-dialog
      :show="dlg.show"
      :title="dlg.title"
      :content="dlg.content"
      :confirm-text="dlg.confirmText"
      :danger="dlg.danger"
      :seq="dlg.seq"
      @confirm="onDlgYes"
      @cancel="dlg.show = false"
    />
  </view>
</template>

<script>
import * as backup from '../../../utils/backup.js'
import * as pw from '../../../utils/pwstore.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../../components/app-dialog/app-dialog.vue'

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      stat: { goals: 0, tasks: 0, sessions: 0, days: 0 },
      json: '',
      sizeText: '',
      incoming: '',
      mode: 'merge',
      parsed: { ok: false, error: '', summary: null },
      // 统一弹窗（components/app-dialog）：导入是不可撤销的操作，确认要用危险色
      dlg: { show: false, title: '', content: '', confirmText: '确定', danger: false, seq: 0, action: '', payload: null }
    }
  },
  onShow() {
    this.refreshStat()
  },
  watch: {
    incoming(v) {
      const r = backup.parseJSON(v)
      this.parsed = r.ok
        ? { ok: true, error: '', summary: r.summary }
        : { ok: false, error: r.error, summary: null }
    }
  },
  methods: {
    refreshStat() {
      const st = pw.get()
      const goals = Array.isArray(st.goals) ? st.goals : []
      this.stat = {
        goals: goals.length,
        tasks: goals.reduce((n, g) => n + ((g && g.tasks) ? g.tasks.length : 0), 0),
        sessions: Array.isArray(st.sessions) ? st.sessions.length : 0,
        days: st.daily ? Object.keys(st.daily).length : 0
      }
    },
    doExport() {
      const text = backup.toJSON()
      if (!text) {
        uni.showToast({ title: '导出失败', icon: 'none' })
        return
      }
      this.json = text
      this.sizeText = (text.length / 1024).toFixed(1) + ' KB'
      uni.showToast({ title: '已生成', icon: 'success' })
    },
    doCopy() {
      if (backup.copy(this.json)) uni.showToast({ title: '已复制', icon: 'success' })
      else uni.showToast({ title: '复制失败', icon: 'none' })
    },
    doSaveFile() {
      const p = backup.saveToFile(this.json)
      if (p) uni.showToast({ title: '已保存到应用目录：' + p, icon: 'none', duration: 2500 })
      else uni.showToast({ title: '当前端不支持存文件，用复制吧', icon: 'none' })
    },
    doPaste() {
      backup.paste(t => {
        if (t) {
          this.incoming = t
          uni.showToast({ title: '已粘贴', icon: 'none' })
        } else {
          uni.showToast({ title: '剪贴板是空的', icon: 'none' })
        }
      })
    },
    doImport() {
      const r = backup.parseJSON(this.incoming)
      if (!r.ok) {
        uni.showToast({ title: r.error, icon: 'none' })
        return
      }
      const isReplace = this.mode === 'replace'
      this.ask({
        title: isReplace ? '整包覆盖？' : '合并导入？',
        content: isReplace
          ? '现有数据会被备份完全替换，且无法撤销。'
          : '只补进备份里有、你现在没有的数据。',
        confirmText: '导入',
        danger: true,
        action: 'import',
        payload: r.payload
      })
    },
    // ---------- 统一弹窗 ----------
    ask(cfg) {
      this.dlg = Object.assign(
        { show: true, title: '', content: '', confirmText: '确定', danger: false, action: '', payload: null },
        cfg || {},
        { seq: (this.dlg && this.dlg.seq || 0) + 1 }
      )
    },
    onDlgYes() {
      const act = this.dlg.action
      const payload = this.dlg.payload
      this.dlg.show = false
      if (act !== 'import') return
      const res = backup.applyPayload(payload, this.mode)
      if (!res.ok) {
        uni.showToast({ title: res.error || '导入失败', icon: 'none' })
        return
      }
      this.refreshStat()
      uni.showToast({
        title: '导入完成：+' + res.added.goals + ' 目标 / +' + res.added.sessions + ' 番茄',
        icon: 'success',
        duration: 2200
      })
    }
  }
}
</script>

<style>
.backup-page { min-height: 100vh; padding-bottom: 60rpx; }
.stat-row { display: flex; }
.stat { flex: 1; text-align: center; }
.sv { display: block; font-size: 40rpx; font-weight: 600; color: var(--ink-1, #17201a); font-family: Georgia, serif; }
.sl { display: block; margin-top: 6rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.tip { margin-top: 20rpx; font-size: 22rpx; line-height: 1.7; color: var(--ink-2, #5a6560); }
.hint { margin-top: 14rpx; font-size: 22rpx; line-height: 1.7; color: var(--ink-3, #98a19b); }

.bk-btn { margin-top: 18rpx; }

.bk-json {
  margin-top: 20rpx;
  width: 100%; height: 320rpx;
  box-sizing: border-box;
  padding: 18rpx 20rpx;
  border-radius: 14rpx;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
  font-size: 20rpx; line-height: 1.5;
  color: var(--ink-2, #5a6560);
}
.bk-input {
  width: 100%; height: 260rpx;
  box-sizing: border-box;
  padding: 20rpx 22rpx;
  border-radius: 16rpx;
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
  font-size: 25rpx; line-height: 1.6;
  color: var(--ink-1, #17201a);
}

.pk-ok {
  margin-top: 16rpx; padding: 14rpx 18rpx;
  border-radius: 12rpx;
  background: rgba(59, 109, 17, 0.12);
  font-size: 23rpx; line-height: 1.6; color: #3b6d11;
}
.pk-err {
  margin-top: 16rpx; padding: 14rpx 18rpx;
  border-radius: 12rpx;
  background: rgba(229, 72, 77, 0.12);
  font-size: 23rpx; line-height: 1.6; color: #e5484d;
}

.seg { display: flex; margin-top: 20rpx; }
.seg-opt {
  flex: 1; text-align: center;
  padding: 16rpx 0;
  font-size: 25rpx;
  color: var(--ink-2, #5a6560);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
}
.seg-opt:first-child { border-radius: 14rpx 0 0 14rpx; }
.seg-opt:last-child { border-radius: 0 14rpx 14rpx 0; margin-left: -2rpx; }
.seg-on { color: #ffffff; background: var(--brand, #e11d48); border-color: transparent; }
</style>
