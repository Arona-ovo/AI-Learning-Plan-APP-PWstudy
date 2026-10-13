# 在线模式（以后接服务器）设计

> 2026-10-13 搭基础。服务器还不存在，本文是**给将来接服务器的那份说明书**：
> 契约现在定死，服务端照着做就行；等服务端写完再来凑契约，两边都得改。

## 一、现在已有什么

这几块是之前就搭好的，接服务器时**不用动**：

| 文件 | 作用 |
|---|---|
| `repositories/types.ts` | 仓储抽象接口，已带 `findPendingSync` / `markSynced` / `SyncStatus` |
| `repositories/index.ts` | 仓储工厂（sqlite / kv）。注释里就写着"未来加 CloudRepository 只需实现同一组接口，业务层一行不用改" |
| `services/auth.ts` | 本地账号（注册 / 登录 / 会话），密码单向哈希，token 只存 plus 安全存储 |
| `services/account-sync.ts` | 登录后把收藏 / 答题镜像进仓储 —— **这三张表就是同步的数据源** |
| `services/http.js` | 统一请求：超时、错误归一化、按 origin 熔断、SSE 流式 |

## 二、这次补的（2026-10-13）

| 文件 | 作用 |
|---|---|
| `services/backend.ts` | **服务器通道的唯一入口**：开关、地址、凭证、设备标识、401 处理、降级 |
| `services/cloud-sync.ts` | 同步调度 + 服务端契约（push / pull、冲突策略） |
| `settings.online` | `enabled / baseUrl / deviceId / userId / lastSyncAt / lastError` |

设计原则：**在线模式是可选增强**。没服务器时开关关闭，所有调用立刻抛"未启用"，
调用方走本地逻辑 —— 功能一条不少（跟伙伴 App 联动同一个原则）。

## 三、怎么开（两步）

```js
import * as backend from '@/services/backend';

backend.setBaseUrl('https://api.example.com');  // 只认 http(s)，别的当场拒绝
backend.setEnabled(true);
```

开完之后业务层调 `backend.get/post`，拿不到就 catch —— `ServiceError` 上的
`degradable` 为 true，说明可以退回本地方案；`notConfigured` 为 true 说明
"压根没开/没登录"，**不该熔断也不该重试**。

## 四、服务端接口契约

### 同步

```
POST /sync/push
  请求  { deviceId, tables: { studyRecords: Row[], wordFavorites: Row[] } }
  响应  { applied: { studyRecords: uuid[], wordFavorites: uuid[] }, serverTime }
        ↑ 只回**确实收下**的 uuid —— 客户端按这个标记已同步，没列的下次再推

GET  /sync/pull?since=<毫秒时间戳>
  响应  { serverTime, tables: { studyRecords: Row[], wordFavorites: Row[] } }
```

`Row` 就是 `repositories/types.ts` 里的行结构（`uuid / user_id / created_at /
updated_at / is_deleted / sync_status` + 各表自己的字段）。

请求头固定带：
- `Authorization: Bearer <token>`（有凭证时）
- `x-device-id`：本机标识，多设备时区分来源
- `x-user-id`：服务端侧账号 id（登录后回写）

### 登录

`services/auth.ts` 现在是纯本地。要换成服务端账号时，**保留它的接口签名**
（`register / login / logout / session / isLoggedIn`），只把实现从
"查本地仓储"改成"调 `backend.post('/auth/login')` + 回写 token"。
业务层（登录页）一行不用改。

## 五、三条不能破的规矩

1. **users 表永远不参与同步。** 它带 `password_hash`，推上去等于把密码哈希
   交出去。账号资料以后要同步，单独开 `/me` 传昵称和头像，不复用这张表。
   （`cloud-sync.ts` 的 `SYNC_TABLES` 里没有 users，`check-online.js` 守着）
2. **服务端没确认收到的数据不许标记已同步。** `markSynced` 只在拿到 `applied`
   之后调用。宁可重复推，不能丢。
3. **拉下来的不能直接盖本地。** 按 `updated_at` 比，谁新用谁（last-write-wins）。
   本地更新就跳过远端那条，等下一次 push 带上去。

## 六、哪些走 wgt，哪些必须发 APK

接服务器这件事**大部分能走 wgt**（纯 JS/TS，不动原生）：

- 服务器通道、登录、数据同步、把 AI 规划搬到服务端代理 —— **wgt 就够**；
- 服务端下发配置 / 运营位 / 特性开关 —— **wgt 就够**。

⚠️ 下面这些**必须云打包 APK**，wgt 更新不了：

- 推送通知（要 `manifest.json` 权限 + 厂商通道）；
- 微信 / 手机号一键登录（要原生 SDK）；
- 内购、后台定位、任何新增 UTS / 原生插件。

也就是说：**先做纯 HTTP 的在线能力，可以一直保持"只发 wgt"**；
一旦要推送或第三方登录 SDK，那一版就得发整包。

## 七、校验

```bash
node _tools/check-online.js           # 在线模式基础（默认关闭 / 凭证 / 同步红线）
node _tools/_scratch/neg-online.js    # 反向测试
```
