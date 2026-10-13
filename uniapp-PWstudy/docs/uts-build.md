# UTS 插件：为什么云打包会挂 + 怎么在本地先发现

> 适用：`uni_modules/pwstudy-focus`（前台服务 / 后台看门狗 / 无障碍护卫）。
> 一句话：**UTS 里写得很自然的代码，转成 Kotlin 才炸**。而云打包一轮 3-30 分钟，
> 失败也要 24s 才出日志 —— 所以先本地转一遍，再看生成物。

---

## 一、本地把 .uts 转成 .kt（秒级）

```bash
"C:/Users/33156/Documents/HBuilderX.5.26.2026091802/HBuilderX/plugins/node18/node.exe" _tools/uts-to-kotlin.js
# 产物：_tools/_scratch/_kt/index.kt，并顺手扫一遍已知的坑
```

- 走的是 HBuilderX **自带**的那个编译器（`plugins/uniapp-uts-v1 → @dcloudio/uts` 的 native binding），
  跟云打包用的是同一套，不会有"本地过、云端挂"的偏差
- ⚠️ **必须用 HBuilderX 的 node18 跑**：binding 是按那个 ABI 编的，用别的 node 版本直接 panic
- ⚠️ 它只做**转译**，不做 Kotlin 的类型检查 —— 生成物对不对，最终还是要一次云打包确认；
  但下面这几类坑一眼就能看出来，能省掉绝大多数往返

## 二、四类"能写但编不过"（2026-10-13 一次云打包全炸出来）

| UTS 写法 | 生成的 Kotlin | 报错 |
| --- | --- | --- |
| `Number(x)` | `Number(x)` | Cannot create an instance of an abstract class / Too many arguments for 'constructor(): Number' |
| `String(p!)`（p 是 CharSequence） | `String(p!!)` | None of the following candidates is applicable（String 只收 StringBuffer/StringBuilder/ByteArray/CharArray） |
| `let x = 0` 再被 `: Int` 函数 return | `var x: Number` | Return type mismatch: expected 'Int', actual 'Number' |
| Int 常量赋给 long 字段 / 传给 `Thread.sleep()` | `= A11Y_NOTIFY_MS` | Argument type mismatch: actual type is 'Int', but 'Long' was expected |
| `AccessibilityServiceInfo.FLAG_DEFAULT` | 同名 | Unresolved reference 'FLAG_DEFAULT'（**叫 `DEFAULT`**） |

对应修法：

- Long → Int 的正路是 `(x as Number).toInt()`；**更好的是别碰 Long**
  （SharedPreferences 的 `bind_at`/`bind_n` 改用 `getInt`/`putInt`，纪元秒与计数都在 Int 范围内）
- CharSequence → String 用 `x.toString()`
- 要当 Int 用的顶层计数一律写 `let x: Int = 0`
- long 位置**只写字面量**（Kotlin 对字面量按目标类型推断，对 Int 常量不放宽）
- `AccessibilityServiceInfo.DEFAULT`（与 `res/xml` 的 `android:accessibilityFlags="flagDefault"` 对齐）

## 三、为什么这些代码以前从没炸过

`PFGuardService` 是系统按清单创建的，源码里没人 `new` 过 → UTS 把它（连同只被它用到的
`bumpBind` / `buildGuardInfo`）**整块剪掉**了。所以这些代码从来没进过 Kotlin 编译器。
一旦用 `keepGuardClass()` 把它钉进产物（见 `check-uts.js` 第 9 节），
它们第一次编译 —— 一次性炸出 5 类错误。

**推论：以后任何"以前没被编译过"的代码第一次进包，都要先本地转一遍。**

## 四、守卫

- `_tools/check-uts.js` 第 9 节：`extends` 必须带 `constructor(){super();}`、清单声明的类
  必须在源码里被引用（防剪枝）
- `_tools/check-uts.js` 第 10 节：上面那四类写法（Number/String/裸 let 返回 Int/long 传常量/FLAG_DEFAULT）
- 反向测试 `_tools/_scratch/neg-uts.js`（9 条，故意改坏 → 确认真会红，还原后仍绿）
- `_tools/uts-to-kotlin.js`：本地转译 + 扫生成物

## 五、云打包前检查清单

1. `node _tools/check-uts.js` → 全绿
2. HBuilderX 的 node18 跑 `_tools/uts-to-kotlin.js` → 没有 ⚠
3. `node _tools/check-native-assets.js` → 全绿
   （⚠️ **每次云打包后 HBuilderX 会把 `app-plus.splashscreen` 的
   `alwaysShowBeforeRender` 写回 false、`waiting` 写回 true**，打包前记得改回来，
   详见 `docs/native-assets.md` 第 2.4 节）
4. 打包
