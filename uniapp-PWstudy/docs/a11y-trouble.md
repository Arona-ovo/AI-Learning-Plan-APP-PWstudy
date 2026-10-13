# 无障碍护卫：故障处置与红线

> 2026-10-12 真机事故后写。现象：**打包安装后，在系统设置里打开无障碍开关，
> 返回 APP 就死机（APP 和整机一起卡住）**。

## 一、为什么会发生

无障碍服务（`PFGuardService`）是**系统**创建并绑定的，不是我们自己 `startService` 的：

1. 用户在系统设置里一打开开关 → `system_server` 立刻 bind 它；
2. 这时 APP 进程常常是**裸**的：uni 的 Application / Activity 还没起来，
   UTS 运行时也可能没初始化过，进程里唯一活着的组件就是这个服务；
3. 服务在绑定过程中抛任何异常 → 系统判定"服务崩了" → **杀掉整个 APP 进程** → 重新 bind → 再崩；
4. 循环起来，system_server 也在反复重试，**整机跟着卡** —— 用户看到的就是"死机"，
   而不是普通闪退。

两个放大器：

- `a11yEnabled()` 里同步调 `AccessibilityManager.getEnabledAccessibilityServiceList()`，
  那是同步 Binder 调用。系统正在等我们服务的 `onServiceConnected` 回调（在主线程），
  我们的主线程又在等系统返回列表 → **Binder 死锁**，界面冻住。
- 配置里 `canRetrieveWindowContent=true` + 每次窗口变化调 `getWindows()`：
  系统要为每次窗口变化构建整棵可交互窗口树再跨进程送过来，低端机上明显掉帧。

## 二、代码里的四道红线（`_tools/check-uts.js` 第 8 节静态守着）

1. 服务的四个回调（`onServiceConnected` / `onAccessibilityEvent` / `onUnbind` / `onDestroy`）
   各包一层 `try`，**异常绝不能冒到系统那边**；
2. 回调里不碰 `console.*`（裸进程里 UTS 日志桥可能未初始化）；
3. 不调 `getWindows()`，配置里 `canRetrieveWindowContent=false`；
4. 跨进程查询只走后台线程（`A11yQueryThread`），主线程零 IPC。

## 三、保险丝：服务自己会躺平

即使上面都做到了，仍可能有 ROM 特定的崩法。所以插件数着**窗口期内的 bind 次数**（落盘）：

- 60 秒内被 bind 超过 2 次 → 判定为崩循环 → `a11yTripped = true`；
- 之后服务变成空壳：不碰任何状态、不收事件，但**不阻止系统 bind**（阻止不了）；
- 界面通过 `apptime.a11ySafe()` 拿到这个状态，如实告诉用户"这台手机起不来"，
  并给「再试一次」（`apptime.resetA11y()` 清计数）。
- 服务稳定连上 30 秒后会把计数清零，避免历史累计误伤。

## 四、手机已经卡住了怎么办（应急）

按"能不能进系统"分两种：

**能进设置（只是 APP 打不开）**：设置 → 无障碍 → 已下载的服务 → 关掉「PWstudy 专注护卫」。

**连系统都卡 / APP 一启动就卡**：用电脑 adb 直接改系统的无障碍开关（不需要 root）：

```bash
# 1. 先看看现在系统里到底开了哪些无障碍服务
adb shell settings get secure enabled_accessibility_services

# 2. 清空（最省事，会把其它无障碍服务一起关掉，事后重新开即可）
adb shell settings put secure enabled_accessibility_services ""
adb shell settings put secure accessibility_enabled 0

# 3. 只想关 PWstudy 这一个：把第 1 步的输出里
#    "com.PWstudy/uts.sdk.modules.pwstudyFocus.PFGuardService" 那段删掉再写回去
adb shell settings put secure enabled_accessibility_services "<剩下那些，用冒号分隔>"

# 4. 兜底：实在不行就卸了重装
adb uninstall com.PWstudy
```

## 五、定位时要抓什么

```bash
# 复现后一次性导出（别用 -c 实时刷，卡住的时候日志会被冲掉）
adb logcat -d > d:\logcat.txt

# 重点看这四类：
#   1. AndroidRuntime / FATAL EXCEPTION —— 服务崩在哪一行
#   2. AccessibilityManagerService / bindService —— 系统是不是在反复 bind
#   3. ANR in com.PWstudy —— 主线程被什么 Binder 调用堵住（traces 里看主线程栈）
#   4. am_proc_died / am_proc_start —— 进程重启频率（崩循环的直接证据）
```

顺带确认资源有没有打进去（meta-data 指向的 xml 找不到也会让服务起不来）：

```bash
aapt2 dump resources <your.apk> | grep -i pw_accessibility
adb shell dumpsys accessibility | grep -A3 pwstudy
```

## 六、再出问题时的排查顺序

1. 先按第四节把开关关掉，确认手机恢复；
2. 抓 logcat，看是**服务崩溃**（FATAL EXCEPTION 在服务类里）还是**主线程 ANR**（Binder 等待）；
3. 崩溃 → 看服务回调里又加了什么"可能抛异常"的调用，补 `try` 或挪出回调；
4. ANR → 看主线程栈里停在哪个 Binder 调用上，挪到 `A11yQueryThread` 那类后台线程；
5. 都正常但服务连不上（`a11yActive()` 一直 false）→ 查 res 资源与 meta-data（第五节）。
