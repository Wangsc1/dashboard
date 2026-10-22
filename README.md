# dashboard

运行于 iPhone **Scripting** 的 OpenWrt 与 Clash/Mihomo 管理面板，不是 Scriptable 脚本，也不是独立 iOS App。

## 功能

- **主页**：全宽 CPU、上传/下载双列、RAM/负载双列与磁盘容量卡；点击 CPU 打开实时总览及全部逻辑核详情。保留连接数和设置/关闭入口。
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

编辑已有 OpenWrt 连接时不显示右上保存；左上返回会先校验并保存最新本地草稿，再退出。无效地址/端口会留在当前页显示错误，旧设置和凭证不变；打开使用说明、切换 App 或卸载页面不会触发保存。使用官方 `navigationBarBackButtonHidden` 隐藏默认返回，明确走自定义返回动作，不依赖消失/卸载事件；原生边缘返回手势及工具栏承载仍需真机确认。继续调用原有本地 `saveController`，密码与密钥仍在 Keychain，编辑返回不执行连接测试或远程配置写入；添加 OpenWrt 页仍为显式保存并测试连接。Nikki 正文编辑的保存确认不变。

原生 Tab API 面向 iOS 18+；外观与手势由系统及 Scripting 版本决定。仓库配置了 `remoteResource`，实际导入和更新以 Scripting 的处理结果为准。配置编辑器的 CodeMirror/Lezer/YAML 静态 bundle 已嵌入现有 `dashboard-pages.tsx`；在线更新仍只需原有运行文件，不需 CDN、额外资源下载或在手机安装 npm 包。`editor/` 为构建源码、锁定依赖及许可证，非运行依赖。

## 1.5.166 更新

- 曲线改回非 Charts 绘制：主页与 CPU 详情共用的 `GridPlot` 恢复为 1.5.161 前已在设备上显示的单个 SVG 路径（沿用同一 `scrollPoints`/`smoothPath`），固定 60 点窗口，最新点在最右、历史不足时向右生长且不补零，保留虚线网格、上传/下载面积填充、颜色和 96/66/76pt 高度；不再使用 `Chart`/`LineChart`/`AreaChart`，也不使用 GeometryReader、重复 frame、Date 域或原生图表动画（1.5.162–165 的实机反馈是 Charts 未显示曲线且详情崩溃）。
- 为避免“卡顿”，不再有每帧计时器或 setState：SVG 仅在新样本到来时重建一次。限度：曲线每秒按样本步进更新，不再逐帧平滑滑动。
- 修负载条：LoadBars 改为与已正常显示的 RAM 条同类结构（HStack + 固定高度 RoundedRectangle，每格“空轨道 + 填充”两段高度和为 24），空值仍保留灰色底条。
- 保留 1.5.165 的 CPU 三项紧凑间距、RAM 页脚左右对齐和完整 CPU 读取。本地仅为模拟契约检查，真机显示、详情页能否进入与流畅度待验证。

## 1.5.165 更新

- RAM/负载容量条不再使用 `GeometryReader`：24 根圆角条为等宽弹性单元，固定 2pt 间距、单一 24pt 行高，卡片 12pt 垂直间距保证下方数值不被覆盖；RAM 按段数、负载按高度填色不变。
- RAM 的已用/总计分别严格靠条左右边缘，负载三列数值各自居中；CPU 的 SYS/USER/STEAL 改为左侧紧凑一组（列间距 22pt），右侧保留大号 CPU 占用，详情页共用同一组件。
- 曲线改用文档支持的 `chartXScale` 字符串数组固定 60 个类别，已有样本占最后 n 个位置：最新点始终在最右、历史不足时向右生长且左侧留空，不补零（LineChart/AreaChart 的 label 文档仅支持 string/Date，无数值 x；仍无 Date 域和手工刻度）。原生 `animation={{animation,value}}`（linear 0.9s，value 为样本和这一简单数值）已恢复，仅 running 时启用，集中于 `CHART_ANIMATION` 单一开关；**若恢复动画后再次崩溃，首先将其改为 false**。磁盘条与数据读取不变。本地仅为模拟契约检查，未做真机布局验证。

## 1.5.164 更新

- 简化主页与 CPU 详情共用的原生图表配置：改为字符串类别 X、单次 `frame` 高度（CPU 96pt、流量 66pt、每核 76pt）、`chartYScale` 固定 0–100（CPU）或 0–流量上限，并移除固定 Date 域、手工 Date/数值轴刻度、`animation` 与重复 `frame` 修饰链。
- 有效样本少于 2 点时不渲染 Chart，仅保留固定高度占位；其余样本为真实采样，不补零。X 轴隐藏，保留无文字 Y 向虚线网格。
- RAM/负载/磁盘条图、白底灰卡、全部真实逻辑核与完整 CPU 读取不变。本地仅为模拟契约检查；**真机崩溃与曲线显示尚待验证，不能视为已修复**。

## 主页与 CPU 详情

主页按 CPU → 上传/下载 → RAM/负载 → 磁盘排序，不显示 Swap 或重复全宽负载。CPU 蓝色曲线，上传绿色、下载青色面积曲线，RAM 和负载共用头部、图表与双行底栏槽位，卡片等宽等高，随文本理想高度伸展而非固定裁切。主页与 CPU 详情统一使用 `systemBackground` 底色、`secondarySystemBackground` 灰卡，与其他页面一致并随系统适配深色，无渐变或阴影。RAM 仍以亮起的段数表示容量比例；负载为真实 1/5/15 分钟值（两位小数），每组每根淡色背景条从底部按负载/逻辑核数连续填充高度，非 CPU 百分比。低负载不取整为零、不设虚假最小高度；0 不填充，未知显示 `--`，超核数时仅柱高封顶，数值保留真实负载。磁盘只展示 LuCI 实际返回的根/overlay 挂载点、设备路径和容量，不推断硬件型号或 NVMe；已用细条按真实 used/size 连续填充，低于一段的比例也不量化。负载绿/橙/蓝按日夜采用更鲜明主色，仍不改变真实填充高度。

CPU 详情是原生大尺寸可下拉关闭 sheet（拖动指示器，无右上 X），系统版本/运行时间/Arch/逻辑核数/Kernel/Board、CPU 型号及总曲线，下方双列显示 `/proc/stat` 中全部唯一逻辑核 ID，无分页或重复物理分组。频率和缓存仅取每个逻辑核自身 `/proc/cpuinfo` 的 MHz/KB；未报告显示 `--`，不复制其他核字段、不使用 BogoMIPS 推断。只读认证 CGI download 流式读取固定路径 `/proc/cpuinfo`，最多 2MiB；5 秒刷新、单飞、不阻塞 1 秒使用率采样，失败后 15 秒重试。虚拟文件 size=0 不代表空文件，不用 stat 大小核验长度；只接受流读到 EOF、正 HTTP 长度一致且覆盖当前全部逻辑核的结果，截断、超限、权限或读取失败时舍弃元数据。该专用读取不改变 Nikki 文件路径核验。

主页与 CPU 详情的曲线自 1.5.166 起为单个 SVG 路径（见上文更新说明）；RAM/负载/磁盘条使用原生圆角形状，不使用 WebView 或 Canvas。CPU 固定 0–100 量程、无坐标文字虚线格、真实样本从右侧积累，统一原生 1.5pt 线宽。总曲线以官方 `animation` 属性做原生过渡（不调用 `withAnimation`）；每核按真实样本刷新，不建立 16ms 数字或 20fps JS 绘图订阅，避免滚动时多核持续重建图形。详情打开时冻结被遮挡主页图表的节点/数据（详情仍实时），关闭后接回最新样本；总览卡离屏也关闭原生动画；实际动画和滚动表现仍需真机确认。SYS/USER/STEAL 共用等宽弹性槽，总百分比独立靠右。

采样沿用唯一主页轮询，详情不再开启第二条请求流；后台、隐藏 Tab、导航离开或卸载停止采样/曲线动画，打开 CPU sheet 只暂停被遮挡主页的曲线。每个来源独立保存有界真实样本（不零填充）；URL/认证来源变化隔离历史和旧响应。首次、暂停恢复、重启、计数回退、热插拔或不可读时先建立 CPU 差分基线，显示未知而非伪造 0%。CPU 总量只累加前八项 jiffies（guest 已包含于 user/nice），USER=user+nice，SYS=system+irq+softirq，STEAL=steal，使用率剔除 idle+iowait；定义依据 Linux `/proc/stat`。

新增访问仅为既有认证后的只读 ubus：`system info/board`、`network.device status`、`network.interface dump`、`luci getMountPoints`、`file read`（`/proc/stat`、`/etc/openwrt_release` 和 CPU/SOC 类型 thermal zone）及 `file list /sys/class/thermal`，以及已有认证下的 `cgi-download /proc/cpuinfo`（需要该路径和 CGI download 的只读 ACL，不扩大权限）。温度只采纳有 CPU/SOC/package 类型且范围合理的毫摄氏度，不将 GPU 或任意未知传感器当 CPU。ACL 不允许或字段缺失时降级未知；不安装包、不修改权限、路由器配置或执行 shell。磁盘容量和系统静态信息约每分钟更新，其余与已有实时采样同频。

## 代理页模式

策略组上方新增「代理模式」与原生分段选择器，依次为 **规则模式 / 直连模式 / 全局模式**；策略组列表前有与代理来源一致的「策略组」标题。复用 `loadConfig` / `setMode`，只 PATCH 内核的 `mode`，再 GET 核验实际模式，不自动选择或切换模式。分段选择器从首帧起常驻显示三项；读取中、失败或未知模式时不选中任何一项（使用不匹配任何项的占位值）且不可点击，不显示读取文案；失败保留错误提示并可重试读取。切换同步锁定并行点击，失败也回读恢复真实模式；若无法核验则清除选中（三项仍显示、不可点击）并明确提示，不重放写入。每个来源在内存中保留最近一次回读确认的模式：切回页面立即显示并静默重读，首次无缓存时三项显示但不可点击直至读到真实模式；静默失败保留旧值，读到未知模式则清除。切换期间选择器保持挂载、骨架不变，只乐观显示目标值并临时禁用，不显示切换文案；无法回读确认时才清除选中。回读确认为 global 时自动显示 GLOBAL 策略组，其他、未知或失败状态隐藏（不改写旧 `showGlobal` 偏好，也不影响隐藏组设置）。来源变化、隐藏和卸载会阻止旧回调发起新切换，已发出的请求仍绑定原来源，不会被改投新设备。

代理页右上菜单删除「显示Global代理组」及「全部更新」，保留节点排序、展示全部代理组、显示代理来源和显示隐藏组（置于菜单最后），以及各提供商卡片单独刷新；规则页的全部更新不变。GLOBAL 可见性仍遵循既有 `showGlobal` 偏好（默认关闭），不因切换全局模式自动改变；因此偏好关闭时 GLOBAL 卡片仍隐藏，不能在此卡片选择 GLOBAL 节点。

## 代理测速

测速参照 Zashboard 关闭独立测速时的路径：统一使用全局配置的测速 URL，不使用策略组或提供者自己的测试链接。节点测速共用 5 个并发名额，传给内核的超时为 `min(2000, 全局测速超时)` 毫秒；HTTP 请求另留响应传输余量。嵌套组解析到当前实际节点，提供者节点使用对应的 `healthcheck` 接口，普通节点使用 `delay` 接口，返回一个便更新一个；失败不再追加整组重测，不测速拒绝类型节点。只合并正在排队或进行中的相同请求，完成后再次点击仍会重新测。

读取策略组时同时合并提供者的协议与延迟历史，已有延迟不因提供者节点缺席于 `/proxies` 而丢失或无谓补测；嵌套延迟的显示仍遵循既有偏好。点击闪电完成后刷新节点元数据，最近一次脚本测速结果仍按来源保留在内存中。该实现路径经过模拟验证，不代表已达到与浏览器相同的实测耗时。

## Nikki 原生管理

三个管理入口及订阅/规则编辑器使用普通导航；配置文件编辑单独用全屏导航呈现。配置和订阅采用中性浅灰卡片，适配深色，没有自定义动画。更多页快捷管理与服务管理仅将 MorePanel 的业务参数由 `padding` 改名为 `contentInset`，避免与宿主通用修饰属性同名；内部原生链仍为 `padding(12) → frame({minWidth:0,maxWidth:"infinity"}) → background`，顺序、数值及样式不变。此前分层和改链均未解决用户反馈的每侧 12pt 内缩；本次改名是对组件外层属性冲突假设的最小可证伪修正，不代表根因已确认或实际对齐已通过验收。测试新增未展开函数组件边界的属性检查；既有算宽测试仅覆盖自建纯模型，不证明宿主修饰规则。是否消除内缩仍须真机截图复验。快捷入口均分可用宽度、高度统一 88pt，固定图标槽和文字槽居中，保留原图标与配色；服务按钮未改。

### 附加规则

右上角省略号图标菜单（无障碍名称「操作」）提供排序、总开关与添加规则；支持编辑、删除和空状态。操作真实 UCI `rule.type/matcher/node/enabled/no_resolve` 与 `mixin.rule`；排序保留非规则 section 的位置，编辑保留未知字段。域名、CIDR、端口等基本输入会校验，复杂规则的最终合法性仍由 Mihomo 判断。

### 订阅

支持新增、编辑、删除和确认更新。编辑按每次导航进入的订阅快照预填名称、URL、User Agent 和优先级；返回后重进或切换订阅不会复用旧草稿。新增才使用空名称/URL及 `clash / remote` 默认值。User Agent 使用 Nikki 的实际值 `clash / clash.meta / mihomo`，优先级使用 `remote / local`；保留 `info_url` 等未知或未编辑字段。

卡片为中性链条徽标、独立大号名称、截断 URL、clock 图标相对更新时间及紧凑编辑/更新/删除按钮，深浅适配。三种操作均为纯图标、无操作文字，使用官方 Button 的单一自定义 children 标签构造，不与 title/systemImage 混用，并保留无障碍名称。卡片更新复用代理来源的 34pt 圆形刷新标签，但使用中性色；订阅与配置卡片的编辑复用同一 34pt `pencil` 图标标签。列表下不再显示独立刷新操作及说明注释。支持设备日期时间、ISO 日期和 Unix 时间戳；无时区日期按本机时区解释，无法解析时显示「未知」。

更新调用 `luci.nikki.update_subscription`，会访问订阅地址并覆盖下载文件，包括对该文件的本地编辑。删除当前选用订阅会被拒绝；普通删除与 LuCI 一致，仅删除该订阅设置，保留已下载文件。

### 配置文件

纵向卡片列表展示本地/订阅来源、两行名称、实际 mtime、大小和 UCI 当前选用勾选标记；与订阅复用相同的全宽 Panel、18pt 内边距与圆角，不设固定或最小卡片高度，不再横向分页或显示滑动提示。右上刷新为纯图标，保留原生工具栏承载，不叠加自绘圆底。列表保留来源顺序：本地目录返回顺序在前，订阅按 UCI index 排在后；新增订阅位于订阅列表末尾，本地上传文件的位置由目录接口决定，不保证全局末尾。不再显示卡片“当前选用”文字或底部说明注释；配置编辑页不显示选用状态等额外信息行。点击卡片确认选用，提交 `config.profile = file:<name> / subscription:<id>`。勾选标记不是已核验的内核运行状态。

列表不读取配置正文。配置编辑采用官方 `fullScreenCover` 独立呈现全屏 `NavigationStack`，不再依赖 Tab 内页面隐藏标签栏来冒充全屏。栈初始化路径为 `["file"]`，编辑器是原生 destination，保留系统返回按钮与右滑。右上角原生工具栏有圆形纯图标保存按钮（单一 Image 标签、交由原生工具栏圆形承载、无障碍名称「保存」；无自绘 Circle 背景或固定圆形 frame，避免原生玻璃圆环叠底，不将文字挤成椭圆）；无改动、未就绪、来源变化或保存中禁用。配置文件返回不自动保存：使用已经收到的完整 `editorChanged` 正文保留来源内存草稿，不在返回/卸载时查询 WebView，不弹覆盖确认、不发远端写入。导航 path 弹出到根即独立关闭 fullScreenCover，根页 onAppear 为同样的幂等兜底；不再显示或无限等待“正在完成返回”。其他订阅/规则等编辑页的返回保存约定不变。

底部修正：原先原生 `systemBackground` 与深色编辑器底色不同，且底部状态行会挤占编辑区。本次统一为编辑器同色背景，仅背景通过官方 `ignoresSafeArea={{regions:"container",edges:"bottom"}}` 延伸至底部容器安全区；文字交互与 WebView 不忽略安全区/键盘，顶部状态栏、原生导航及 Home 指示器保留。状态提示移到编辑区上方，无底部 footer 或 tab 可见性占位修饰。不猜测 padding，也不使用未公开的 WebView inset 属性。该修正不等于真机底部留白已通过验收：若仍有明显大于 Home 区的空白，需要截图区分宿主 WebView inset、系统工具栏与页面背景边界。

正文为无卡片框的本地 CodeMirror 6 编辑区（与 [Sub-Store cmView](https://github.com/sub-store-org/Sub-Store-Front-End/blob/master/src/views/editCode/cmView.vue) 同系）：等宽字体、固定行号、活动行底色、缩进线与层级折叠箭头，长行横向滚动不折行；紧凑工具栏提供撤销、重做、查找/替换、全部折叠/展开。Lezer YAML 提供结构化解析/高亮/折叠；普通标量另由 `yaml` 的 YAML 1.2 解析器识别类型，仅用于可视区着色（键蓝、数字橙、布尔/空值红、字符串绿、注释灰），不序列化、不格式化正文。浅色/深色/系统外观均适配。没有上传、清空或云端操作。采用 Scripting 官方 `WebViewController` / `WebView` 的临时隔离容器和本地 HTML，以 CSP 禁止外部资源；无网络编辑器、网页存储或外发逻辑，离开保存结束后调用 `dispose()`。版本及 MIT 许可见 `editor/package-lock.json`、`editor/THIRD_PARTY_NOTICES.txt`。

从首帧（包括 native onAppear 前）显示随主题的中性加载面板；WebView 始终挂载但完全透明且禁用交互，只有完整正文的页面握手完成后显露。实际出现后才读取正文；正文经完整性核验后独立保留，不把 `loadHTML()` Promise 结束当作脚本就绪。正文读取 20 秒、编辑器初始化 10 秒未完成会明确报错并允许重试；已完整读取的正文在编辑器失败时提供原生只读恢复显示，不允许保存未初始化的正文。保持 UTF-8、缩进、原有 CRLF/LF/CR 及尾部空行；逐个编辑变更保留未触及的原始换行，新增换行采用正文第一个换行的形式，撤销/重做通过历史反向 effect 恢复原字节。保存读取完整文档快照而非可视区/折叠 DOM；中文输入法组合期间先请求结束输入，未结束则拒绝快照，宿主超时不写入，过期请求不会锁住新编辑。

只有点击保存才读取最新完整快照并确认远端覆盖、分块写入及完整回读，不自动应用/重载。保存成功留在编辑器，更新已保存基线和状态，可继续编辑再保存。保存期间返回：尚未确认执行的操作被关闭标记阻止，不再写入；已明确确认并开始的写入只执行一次，导航立即退出，控制器独立等待完整回读/失败处理后释放，不在已退出的编辑页误报保存成功。快照/确认等待可被返回取消；cleanup 先执行不会抢走随后 onDisappear 的关闭通知。取消确认、保存失败时按来源/文件在本次脚本内存保留完整草稿，重进恢复且保留原始远端基线，远端并发改动仍会拒绝覆盖；退出脚本不会持久保存草稿。输入、导航复用、失败恢复和完整快照有定向回归，移动尺寸 Chromium 亦验证高亮、折叠、搜索、横滚、中文/emoji、组合输入屏障和 4 万行完整缓冲。**不等于 WKWebView/真机验收**；iPhone 原生全屏返回/右滑、状态栏/键盘安全区、中文候选词提交和长文滚动性能仍需真机确认。

接口依据：[官方当前 WebViewController](https://scriptingapp.github.io/guide/Device%20Capabilities/WebViewController.md) 列出 `ephemeral`、支持 Promise 回执的消息处理器，并要求取返回值时使用 `return`；[WebView 示例](https://scriptingapp.github.io/guide/Views/WebView.md) 则使用表达式。保存快照通过消息桥回传，不依赖两种求值方式的返回值差异，快照对整个 `evaluateJavaScript → 消息回包` 调用链设 5 秒限时，解锁另限时 500ms，超时拒绝写入。当前没有目标 App 同步的官方 `.d.ts` 或宿主实现；测试 stub 只作本地检查，不证明用户安装版本支持这些 API。

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

使用 Scripting 官方组件与全局 API，不依赖 Scriptable。管理界面核对了官方 `navigationDestination`、多行 `TextField`、`frame`、链式 `modifiers`、自定义标签 `Menu` 和等宽字体文档。

本地测试（首次在 `editor/` 执行 `npm ci`，安装仅供构建/测试的 jsdom、Playwright；浏览器测试另需可用的 Chromium 或 `CHROMIUM_PATH`）：

```sh
node tests/run.cjs
node tests/nikki-management.cjs
node tests/nikki-editors.cjs
node tests/nikki-file-lifecycle.cjs
node tests/nikki-editor-browser.cjs
node tests/proxy-mode.cjs
node tests/chart-download.cjs
node tests/home-dashboard.cjs
node tests/cpuinfo-complete.cjs
node tests/cpu-details-performance.cjs
node tests/home-polish.cjs
git diff --check
```

编辑器重建：`cd editor && npm ci && npm run build`，将静态 bundle 更新到 `dashboard-pages.tsx` 的生成标记内，不新增手机运行文件。测试可用 `JSDOM_PATH` / `PLAYWRIGHT_PATH` 指定已安装的包。

测试默认使用 `/tmp/chk/node_modules/typescript`，可通过 `TYPESCRIPT_PATH` 指定已有 TypeScript 包。业务类型检查使用 `tests/business-stub.d.ts`、`--lib es2020 --jsx preserve --noEmit`；桩缺少的官方 `Divider` 仅需在临时声明中补充，不修改产品 API 迁就桩。

代理模式专项覆盖真实模式/未知状态、切换失败回读、结果不一致、并行点击、来源及可见性隔离和菜单项精确删除；分段外观与实际触控仍待真机确认。专项测试覆盖 CRUD、排序、取消零写入、权限、来源隔离、脏会话、失败草稿、超过 256KiB 文件的完整读取、UTF-8 分块保存、CRLF/尾部回读、截断拒绝及部分写入失败。所有网络、存储和 UI hooks 都是内存模拟；**模拟及类型检查不等于手机布局、手势或真实设备权限验证**。仍需真机确认导航往返、原生分页、长文本输入、深色布局和 CGI/ACL/服务兼容性。

接口依据：

- [Nikki 固定源码](https://github.com/nikkinikki-org/OpenWrt-nikki/tree/78e1a751d55ed0762811f054ee699049473da7b8)：LuCI 管理表单、RPC、ACL、文件协议与 init 重载触发器。
- [rpcd 源码](https://github.com/openwrt/rpcd/tree/d99f703e4035d03fbcfbada3cb697db346c2b984)：`file.c / uci.c`；OpenWrt24.10 使用的 `bba95191ff2f22c9118a1ba1355b83afaa277ae3` 同样在 commit 时发出配置事件。
- [cgi-io 源码](https://github.com/openwrt/cgi-io/tree/31cb3c89f02d918d7f17bf62a80c852fc38a1ca1)：完整文件下载。
- [Scripting 官方文档](https://scriptingapp.github.io/)。

CPU 元数据读取依据：[rpcd file.c 固定源码](https://github.com/openwrt/rpcd/blob/d99f703e4035d03fbcfbada3cb697db346c2b984/file.c) 的 `RPC_FILE_MIN_SIZE=4096`、`rpc_file_read()` 对 size=0 单次 `read()`；[cgi-io main_download](https://github.com/openwrt/cgi-io/blob/master/main.c) 对 size=0 循环读至 EOF。25KiB/16 核真实格式 fixture 复现旧 4KiB 路径仅解析出前部核心；这证实代码路径风险，不代表已确认用户真机运行的 rpcd 版本或实际响应。
