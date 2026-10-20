# dashboard

在 iPhone「Scripting」中管理 OpenWrt 路由器，并自动获取其上 OpenClash / Nikki / MihomoTProxy 的 Clash 控制器。

- 添加 OpenWrt：名称、地址、端口、HTTPS、LuCI 用户名和密码；选择插件并开启“自动获取配置”。
- 自动获取：登录后通过 ubus 读取插件配置里的控制器端口和密钥，无需手填。关闭后可手动填端口与密钥。
- 概览：WAN 实时速度与累计流量、连接数、型号、运行时间、负载、内存；代理的速度、连接、运行模式。
- 页面：网络接口、在线设备、策略组（切换/测速）、连接（断开）、规则、内核配置。

使用：运行脚本 → 设置 → 添加 OpenWrt。密码和密钥存 Keychain。
