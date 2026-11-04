// utils/tutor.js - 补习班打卡：当天有补习固定安排时，主页给一个"到课打卡"入口
//
// 背景（2026-11-04 用户要求）：
//   补习班是"客观占用的时段"（日历标注 type=tutor，见 utils/calmark.js），
//   以前还要在地图上选个"上课地点"来辅助判断"人是否在场"—— 那套地图选点
//   只能拖不能搜、定位也漂，太简陋，已砍掉。
//   现在判断"到底有没有去上课"不靠定位，靠**打卡**：主页当天有补习班就显示
//   一个打卡按钮，点一下记"这天到课了"、可取消；同时也能在旁边起一段自由专注。
//
// 数据落库：pwstore 的 daily[YYYY-MM-DD].tutorCheck = { markerId: 时间戳 }。
//   只存"哪个补习班、哪天打了卡"，没有定位、没有轨迹 —— 和 location.js 的红线一致。
//
// 打卡的用途只有一个：喂给 AI 让它别把"补习日"误判成"没学习"。
//   打卡**不计专注时长**（它不是一段专注，是"这天有客观的学习发生"的信号）。

import * as calmark from './calmark.js'
import * as pw from './pwstore.js'

/** 当天覆盖到的补习固定安排（calmark 里 type=tutor 的标注，含名称与时间） */
export function todayTutors() {
  const t = pw.today()
  const p = String(t).split('-')
  let map
  try { map = calmark.byMonth(Number(p[0]), Number(p[1])) } catch (e) { map = {} }
  const list = map[t] || []
  return list.filter(m => m && m.type === 'tutor')
}

/** 某天的打卡表（副本） */
export function checks(date) {
  const d = pw.get().daily[date || pw.today()]
  return (d && d.tutorCheck) || {}
}

/** 某个补习班今天打过卡没有 */
export function isChecked(date, id) {
  return !!checks(date)[id]
}

/** 翻转打卡状态，返回新的状态（true=已打卡） */
export function toggle(date, id) {
  const st = pw.get()
  const key = date || pw.today()
  if (!st.daily[key]) st.daily[key] = { focusMin: 0, pomo: 0, byApp: {}, byHour: {} }
  const d = st.daily[key]
  if (!d.tutorCheck) d.tutorCheck = {}
  if (d.tutorCheck[id]) {
    delete d.tutorCheck[id]
    pw.touch()
    pw.flush()
    return false
  }
  d.tutorCheck[id] = Date.now()
  pw.touch()
  pw.flush()
  return true
}

/**
 * 给 AI 的"今日补习"上下文。
 * 打卡的意义在这里：AI 知道"他今天客观上在补习班（有学习发生）"，
 * 没打卡不代表没学，只是没确认 —— 别据此判他偷懒或下调任务量。
 */
export function tutorBlock() {
  const list = todayTutors()
  if (!list.length) return ''
  const ck = checks(pw.today())
  const lines = ['【今日补习 / 固定安排（本人上课的时段，客观有学习发生）】']
  list.forEach(m => {
    const on = !!ck[m.id]
    lines.push('- ' + (m.label || '补习') + (m.time ? '（' + m.time + '）' : '') +
      (on ? '：已打卡到课' : '：还没打卡'))
  })
  lines.push('- 这些时段他客观在上课，不是偷懒、不是能力下降；没打卡不代表没学，只是没确认。' +
    '不要据此下调任务量，也不要在反馈里说"投入不足"。')
  return lines.join('\n')
}
