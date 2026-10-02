# DSH SSH Workspace

通过 SSH 在远程 Linux/macOS 电脑上使用 DSH 项目。本机负责界面和会话，远端负责项目文件、搜索和 Bash 命令。

## 使用

在 DSH 插件页面使用 GitHub 地址安装：

```text
https://github.com/Very12345/dsh-ssh-workspace
```

也可以用官方 CLI 向指定 profile 安装：

```powershell
dsh plugin --profile desktop add github:Very12345/dsh-ssh-workspace
```

包中已提交可运行 JavaScript，Git URL 安装不需要 `prepare`、`postinstall` 或构建脚本。最低宿主接口为 DSH 0.2 系列，Node.js 22.15 及以上。

1. 在系统终端确认 `ssh 你的别名` 可以免交互登录，主机密钥已确认；加密密钥需要先加入 `ssh-agent`。
2. 打开 **设置 → 远程工作区**，从 SSH config 添加电脑，或者手动填写地址、用户名、端口。支持密钥文件路径和跳板机。
3. 首次连接点击 **初始化环境**。插件从微软官方下载固定版本 VS Code CLI 1.140.0，保存到远端 `~/.dsh-ssh-workspace`，运行 Agent Host；无需安装 VS Code 桌面界面或在远端安装 DSH。下载及运行环境遵循 [Microsoft VS Code Server 条款](https://code.visualstudio.com/docs/remote/vscode-server)。
4. 新建项目时，在原有目录浏览器顶部的 **电脑** 下拉框中选择 **本机电脑** 或 SSH 电脑，浏览目录并点击 **打开**。本机系统原生选择器保持原样，在电脑选择行点击 **选择文件夹** 后打开。
5. 远程项目使用 Bash，并沿用 DSH 原生的 **只读 / 工作区内修改 / 完全访问** 会话权限。无需为普通项目操作切换到完全访问；超出权限的操作仍使用工具层原生审批，单次批准不修改会话默认值。标准/创造/PTC 使用原生 Bash 提权参数；极简沿用官方持久终端的会话权限切换机制。

SSH config 使用系统 OpenSSH 解释连接选项，包含 `Host`、`Include`、`IdentityFile`、`ProxyJump`。通配符不会作为可选电脑；未找到的别名可手动添加。可以在设置页指定另一份配置文件。插件只读 SSH config，不写回它，不读取私钥内容，不保存密码。

目录浏览器沿用官方 DSH 的双栏布局、面包屑、路径编辑、新建文件夹和隐藏文件开关。插件只在标题上方加一行电脑下拉框；手动添加与初始化电脑在设置页完成。

## 行为与边界

- 标准、创造/cordis、PTC 和极简模式均提供远程 Bash；PTC 保持 `run_code` 工具呈现方式，极简模式保留持久 Shell 状态。
- 文件读写和原生 `glob` / `grep` 在远端执行。远端需要 Bash、`curl`、`tar` 和 `rg`；Linux x64/arm64、macOS Intel/Apple Silicon 是初始化支持的架构。
- 本机项目继续调用 DSH 原有沙箱执行器。只给远程会话安装工具覆盖，其他工具、原生审批及本机目录选择保留。
- 远程文件与 Bash/持久终端执行同一会话策略。只读禁止写入；工作区内修改允许项目目录和远端临时目录；完全访问按 SSH 账户权限执行。会话切换及单次原生审批的范围保持不变。
- Linux 在远端探测 Bubblewrap，不可用时使用随包提供、经过摘要校验的 DeepSeek 官方 Landlock runner 0.1.2；macOS 使用 Seatbelt。runner 上传到远端插件缓存，不需 sudo 或修改系统安全设置。沙箱不可用时受限命令会明确报错，不会自动升级权限。旧内核的部分隔离状态沿用官方探测结果，并通过命令结果报告。
- 远程项目的 AGENTS.md / CLAUDE.md 规则发现以所选远端项目目录为边界，不沿本机占位目录向上查找项目根；本机项目继续使用原有发现规则。
- 每个远程项目对应一个本机占位目录。它用于 DSH 工作区身份和会话记录，不会把远程文件同步到本机。项目显示名称包含电脑名称。
- 移除电脑会停止其连接并撤销工作区执行路由，保留 DSH 项目/会话历史与占位目录；以后访问这些项目会明确报错，不会转为本机执行。
- 已维护的 Git Bash 开关仅作用于本机项目，远程项目由本插件接管，避免两个插件注册同名工具。
- 桌面操作和浏览器插件仍控制 DSH 所在的本机。远端 Windows、文件实时监听、SSH 密码弹窗和远程桌面不在本版本范围内。
- Agent Host 采用 AHP 0.9 协议；自带其他版本的运行环境遇到不兼容会报错。初始化使用已验证的固定 CLI 版本。

连接和映射保存在 DSH home 的 `ssh-workspace/catalog.json`，占位目录位于 `ssh-workspace/projects/`。这些属于本地用户数据，不进仓库。

远程工作区的文件夹图标右上角显示连接状态：灰色未连接、黄色连接中、绿色已连接、红色已断开。悬停状态点可查看说明。本机工作区不加标记。状态每 5 秒刷新，已有 AHP 连接每 15 秒做一次只读心跳，心跳最多等待 4 秒；状态查询不启动新的 SSH 连接，也不等待卡住的初始化任务。断开后，下次项目操作会按原有连接逻辑尝试恢复。

## 开发与验证

这是独立仓库，不属于父目录 npm workspace。

```powershell
npm ci --ignore-scripts
npm run setup-sdk
npm test
npm run build:client
npm run smoke:ui
npm pack --dry-run
```

`setup-sdk` 临时安装测试用 DSH SDK 并恢复清单，运行依赖和锁文件保持独立。UI 测试在 Windows 默认使用已安装 Edge；其他平台先运行 `npx playwright install chromium`。也可以设置 `DSH_UI_BROWSER_CHANNEL`。截图只保存于忽略的 `.tmp/ui/`。

经明确授权后可运行真实 SSH 测试（只在随机 `/tmp` 目录写入并清理）：

```powershell
$env:DSH_SSH_TEST_TARGET='你的测试别名'
node test/live-smoke.mjs
```

[实现与验证记录](docs/ARCHITECTURE.md) 包含传输来源、路由设计、维护修改及联调范围。

## 许可

本插件的原创代码为 MIT。`src/provider/` 中的传输代码基于 [Yan-Zero/dsh-remote-ssh](https://github.com/Yan-Zero/dsh-remote-ssh) 的 Apache-2.0 源码快照；目录浏览器组件来自 DeepSeek 官方 DSH 0.2.0-rc.2，MIT 许可见 `DIRECTORY-BROWSER-LICENSE`。原始版本、修改范围及许可见 `NOTICE` 和 `PROVIDER-LICENSE`。Linux Landlock 预编译 runner 的许可见 `LANDLOCK-LICENSE`，配套审计源码许可见 `LANDLOCK-SOURCE-LICENSE`。不分发 Microsoft VS Code 二进制文件。
