# dashboard

在 iPhone「Scripting」中管理 OpenWrt 与 Clash（Mihomo / OpenClash）控制器。

- OpenWrt：通过 LuCI 的 ubus 接口登录（地址填 LuCI 后台，用户名/密码为 LuCI 账号），显示 WAN 实时速度与累计流量、连接数、型号、运行时间、负载、内存、网络接口、DHCP 在线设备。
- Clash：填 external-controller 地址与 Secret，支持实时速度、运行模式、策略组切换与测速、连接列表与断开、规则预览、内核配置。
- 主屏与锁屏小组件显示当前控制器概览。

使用：运行脚本 → 设置 → 添加控制器。密码/密钥存 Keychain。
