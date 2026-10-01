# 实现与验证

## 路由

`cordis.patch.yml` 把原生文件系统、子进程、spill 和平台 Shell 放入私有 Cordis realm。桥接只导出这些服务实例；根 realm 使用路由服务。本机路径回到原生实现。远程占位目录绑定一个主机与绝对 POSIX 目录，文件目标包含工作区 ID 和远端文件 URI。

远程会话绑定执行世界，Shell 显式 workdir 不能把执行切换到本机。普通本机 POSIX 路径即使和远端目录相同，也不会被猜成远程路径。已登记的占位路径及其子路径属于远程空间；移除后保存独立 tombstone，生成的 UUID 目录也保持保留。因此移除映射后重启不能悄悄写入本机占位目录。共享 projects 目录的 `.git` 等管理探测路径不作为工作区别名。

原生工具在 agent scope 中覆盖，只对远程项目生效。标准/创造/PTC 用原生 Bash 工具；极简使用原生 persistent Bash 工具与 AHP PTY。根服务及工具参数保持原生的沙箱/审批接口。目录选择使用 DSH 官方 directoryFlow 插槽，priority=-100；单个插槽数字较小的实现优先。原生目录 picker 服务不被禁用。

## 上游与维护修改

传输快照：Yan-Zero/dsh-remote-ssh 0.2.4，commit `21d727cbe24fbae283196e5101adb3de2bdd9157`。快照已转换为可直接执行的 ESM，所有带来源标头的 JS 保留 Apache-2.0 授权。直接维护这些 JS 文件，不需要安装上游已撤回的 npm 包。

主要修改：

- 去掉远程 dsh-host backend 与其未发布依赖，保留 AHP 文件系统、子进程、PTY、spill 和搜索适配。
- AHP 客户端固定 0.9.0；删除未经本版本测试的前向版本宣告。
- 使用插件自己的原子 JSON catalog，兼容当前 DSH 的 Config-derived settings API。
- 初始化更新主机记录，保留工作区；主机配置变更销毁旧连接。
- 适配当前 ShellExecutor.execute/result/observed API，提供增量后台输出及超时/取消。
- 保留本机沙箱，移除上游全局完全访问与 approval=never 设置。
- 本机路由不按远端 POSIX 目录猜测；已删除占位目录跨重启拒绝执行，包括自定义别名。
- 官方 agent-instructions 的 findProjectRoot 通过可撤销的模块加载适配，在远程会话中以所选项目目录为边界，避免沿 Windows 占位路径向本机祖先查找 `.git`；本机项目保持官方的向上发现行为。
- 用可撤销的运行时兼容适配让已维护 Git Bash switch 跳过远程 Agent；保留其本机 enabled 设置，不改动该插件文件。
- 自己提供设置页、手动添加、SSH config 导入；项目目录使用官方 DirectoryBrowser 组件快照，只增加 headerExtra 属性、标题上方插入位置及独立 CSS tag ID。电脑选择收在一行下拉框内，本机系统弹窗仍调用原始 IPC pick。React 文本渲染不拼接用户 HTML。

## 联调范围

本地测试验证 SSH 参数约束、Host/Include 发现、配置重载、并发选择同一项目、移除后的路由、当前 DSH scoped tools/PTC 呈现、本机策略保留、包中不存在安装构建脚本。UI 测试验证明暗主题、手动添加、顶部电脑下拉框、原生 pick、官方双栏目录组件的新建文件夹/隐藏文件、插槽优先级、窄屏与 Esc 关闭。另有快照差异测试约束组件仅改动上述三个位置。

在用户授权的 Linux SSH 测试机器上验证：连接与目录浏览、中文/空格文件名的写入和读取、cwd/rg、超时终止、四种模式的原生工具远程执行、极简持久环境变量、原生打包 ripgrep 经远程 subprocess 运行、主机移除后的拒绝执行、主动关闭专用 SSH tunnel 后重新连接。所有读写在随机命名的专用 `/tmp/dsh-ssh-workspace-*` 测试目录内进行，并在 finally 中清理。

macOS 已提供平台初始化分支，尚未进行真实 macOS SSH 联调。实际 Agent 的模型自主规划、所有第三方插件组合与网络中断时远端子孙进程的完全清理不由这些测试证明。

0.1.2 回归验证包含：父目录 `.git` 探测、UUID 保留、自定义别名移除后重启、官方 SDK 规则加载、本机祖先规则发现及桌面宿主 SDK 对已选真实 SSH 项目的规则启动。

## 0.1.3 远端权限执行

远程命令不再硬性要求完全访问。每次调用保留原生 SandboxPolicy.resolve 的模式、工作区和单次批准，映射到远端 canonical 目录后执行。Linux 沿用官方的 Bubblewrap → Landlock 选择顺序；macOS 用 Seatbelt。Landlock runner 来自 @deepseek-ai/node-addon-system-linux-{x64,arm64} 0.1.2 的发布包，完整 SHA-256 在 remote-sandbox.js 与资产测试中固定。上传与执行探测属于插件控制流程，运行时不编译源码、不修改用户命令、不调用 sudo。

读取/写入策略与官方一致：只读不给持久写路径；工作区内修改允许项目和平台临时目录；完全访问保留账户权限。文件写工具与命令共享 canonical writable roots。极简持久终端使用远端 sandbox provider，原生 mode fence 在会话权限切换时重建 PTY。批准后的单次执行使用批准模式，不覆盖会话的 standing mode。沙箱拒绝与 runner 故障分别按原生 result.sandbox.denied / runnerFailed 报告；部分隔离状态如实保留。

在真实 Linux SSH 主机上验证了只读读取、项目写入、只读拒写、项目外拒写、显式完全访问、四种模式的 workspace-write 及极简持久变量。该主机的 Bubblewrap 因 UID map 权限不可用，Landlock 探测为 partial；实测文件内容写限制有效。macOS 实机与旧 ABI 未覆盖的文件效果仍不由此测试证明。
