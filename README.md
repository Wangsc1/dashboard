# dashboard

运行于 iPhone **Scripting** 的 OpenWrt 与 Clash/Mihomo 管理面板，不是 Scriptable 脚本，也不是独立 iOS App。

## 功能

- **主页**：OpenWrt 实时上下行速率与曲线、累计流量、连接数、内存、运行时间和负载。
- **代理**：策略组与节点列表、切换、测速、排序、代理提供者更新。
- **规则**：内核规则查询、规则提供者查看与更新。与 Nikki 的「附加规则」分开。
- **连接**：活动/已关闭记录、流量速率、详情、搜索排序、同源/同域名筛选、断开连接。已关闭记录只来自本脚本连续观察，不生成设备历史。
- **更多**：版本与可读取的运行时间、内核运行配置、核心/DNS工具，以及 Nikki 配置、订阅、附加规则和服务管理。
- **设置**：多控制器、浅色/深色/跟随系统、显示与测速偏好、本地安全日志；路由器详情提供网络接口、在线设备、Docker、FRP 和软件管理入口。

支持从 OpenClash / Nikki / MihomoTProxy 读取代理控制器配置，也可手动填写控制器端口和密钥。具体能力取决于插件、内核版本及设备 ACL，不将其他插件当作 Nikki 调用。

## 导入与连接

[在 Scripting 中导入](https://scripting.fun/import_scripts?urls=["https%3A%2F%2Fgithub.com%2FWangsc1%2Fdashboard"])

1. 导入后运行脚本，从主页右上角进入控制器管理，添加 OpenWrt。
2. 填写自己的 **LuCI 后台地址、端口、用户名和密码**，不是代理控制器地址。
3. 选择插件。自动获取配置会读取相应插件的代理 API 端口和密钥；关闭后可手动填写。
4. 使用底部 **主页 / 代理 / 规则 / 连接 / 更多** 切换页面，详情页由系统导航返回。

原生 Tab API 面向 iOS 18+；外观与手势由系统及 Scripting 版本决定。仓库配置了 `remoteResource`，实际导入和更新以 Scripting 的处理结果为准。运行实现仍在原有源文件中，没有新增必须单独下载的运行模块。

## Nikki 原生管理

三个管理入口及编辑器均为普通导航新页面，不使用 sheet。配置和订阅采用中性浅灰卡片，适配深色，没有自定义动画。

### 附加规则

右上角「操作」菜单提供排序、总开关与添加规则；支持编辑、删除和空状态。操作真实 UCI `rule.type/matcher/node/enabled/no_resolve` 与 `mixin.rule`；排序保留非规则 section 的位置，编辑保留未知字段。域名、CIDR、端口等基本输入会校验，复杂规则的最终合法性仍由 Mihomo 判断。

### 订阅

支持新增、编辑、删除和确认更新。User Agent 使用 Nikki 的实际值 `clash / clash.meta / mihomo`，优先级使用 `remote / local`；保留 `info_url` 等未知或未编辑字段。

更新调用 `luci.nikki.update_subscription`，会访问订阅地址并覆盖下载文件，包括对该文件的本地编辑。删除当前选用订阅会被拒绝；普通删除与 LuCI 一致，仅删除该订阅设置，保留已下载文件。

### 配置文件

横向分页卡片展示本地/订阅来源、名称、实际 mtime、大小和 UCI 当前选用标记。点击卡片确认选用，提交 `config.profile = file:<name> / subscription:<id>`。勾选标记不是已核验的内核运行状态。

列表不读取配置正文。打开编辑页后才完整加载，使用等宽多行输入；未修改时保存禁用。保留 UTF-8 与换行，保存后完整回读核对，失败保留当前草稿。

### 权限与重要限制

- **UCI 提交不能保证「只保存、不生效」**：标准 rpcd 的 `uci.commit` 会发出 `config.change`，Nikki 注册了自动重载触发器。所有 UCI 提交前都会确认可能重载、断流，以及远程优先订阅可能重新下载；脚本不再额外发送重复重载请求。需要手动应用时可单独使用更多页的服务管理。若必须持久保存且绝不重载，需要另外的上游接口/权限方案。
- **完整读取**：使用 LuCI `/cgi-bin/cgi-download`，复用已有登录，并核对 UTF-8 字节数及前后元信息。不使用可能截断或超限的 `file.read`，无完整下载权限时明确失败。
- **路径保护**：仅允许指定 Nikki 目录的 YAML 文件，拒绝路径穿越、冒号和非普通文件。以并行 `file.lstat` 核验 `/etc` 起的全部祖先均为目录、目标为普通文件，不接受符号链接，不信任会跟随链接的目录列表。已核对的设备支持此接口及 CGI 完整下载，正常选用/编辑不依赖被禁止的 `file.exec`。仅当全部路径均报告不存在 `lstat` 方法时，才兼容回退至固定 `/bin/busybox` + 参数数组 `readlink -f` 核对规范路径，不经过 shell；权限拒绝、缺失路径或混合异常不触发回退。无法安全核验则拒绝操作，不修改设备 ACL。
- **写入不是原子替换**：按 Nikki 官方协议分成最多 8192 UTF-8 字节的块，保持原文件权限并回读核对；中途失败可能留下部分文件。界面会要求不要重载、先核对并恢复，草稿仍保留。
- **并发保护有边界**：按来源串行写入，检查旧快照与未提交改动，不提交或清理别人的 pending UCI。写操作固定 session，不重放 add/append/commit。设备端没有可用的原子 CAS，编辑时仍应避免同时通过 LuCI、订阅更新器或其他进程修改同一对象。

## 数据与操作边界

密码、控制器密钥和自定义请求头使用 Keychain；连接信息与显示偏好保存在脚本本地。订阅 URL、UCI 快照和配置正文仅供当前内存中的管理操作，不写入普通日志、Storage、云备份或公开文件。

本地「运行日志」是脚本的安全事件摘要，不是 OpenWrt `logread` 或代理内核日志。日志不接收请求/响应正文、任意异常原文、URL、密码、密钥或 session；复制日志也只使用这些摘要。

「代理配置」修改的是所选内核的**当前运行配置**，只 PATCH 已读取且实际修改的字段；开关/选项自动保存，文本在结束编辑后校验保存。它不等于 Nikki UCI 或配置文件编辑，插件重启后可能覆盖。服务启动/停止/重启/重载可能断流；请求返回不等于已经成功加载配置，界面会区分已发送与未核验。

## 开发与验证

使用 Scripting 官方组件与全局 API，不依赖 Scriptable。管理界面核对了官方 `navigationDestination`、多行 `TextField`、分页 `TabView` 和等宽字体文档。

本地模拟测试：

```sh
node tests/run.cjs
node tests/nikki-management.cjs
node tests/chart-download.cjs
git diff --check
```

测试默认使用 `/tmp/chk/node_modules/typescript`，可通过 `TYPESCRIPT_PATH` 指定已有 TypeScript 包。业务类型检查使用 `tests/business-stub.d.ts`、`--lib es2020 --jsx preserve --noEmit`；桩缺少的官方 `Divider` 仅需在临时声明中补充，不修改产品 API 迁就桩。

专项测试覆盖 CRUD、排序、取消零写入、权限、来源隔离、脏会话、失败草稿、超过 256KiB 文件的完整读取、UTF-8 分块保存、CRLF/尾部回读、截断拒绝及部分写入失败。所有网络、存储和 UI hooks 都是内存模拟；**模拟及类型检查不等于手机布局、手势或真实设备权限验证**。仍需真机确认导航往返、原生分页、长文本输入、深色布局和 CGI/ACL/服务兼容性。

接口依据：

- [Nikki 固定源码](https://github.com/nikkinikki-org/OpenWrt-nikki/tree/78e1a751d55ed0762811f054ee699049473da7b8)：LuCI 管理表单、RPC、ACL、文件协议与 init 重载触发器。
- [rpcd 源码](https://github.com/openwrt/rpcd/tree/d99f703e4035d03fbcfbada3cb697db346c2b984)：`file.c / uci.c`；OpenWrt24.10 使用的 `bba95191ff2f22c9118a1ba1355b83afaa277ae3` 同样在 commit 时发出配置事件。
- [cgi-io 源码](https://github.com/openwrt/cgi-io/tree/31cb3c89f02d918d7f17bf62a80c852fc38a1ca1)：完整文件下载。
- [Scripting 官方文档](https://scriptingapp.github.io/)。
