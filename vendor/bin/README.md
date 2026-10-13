# 自带搜索工具 rg / fd（Agent 的 grep / find）

Dela 内核（pi）的 `grep` / `find` 工具不在进程内实现，而是 spawn 外部的
ripgrep（`rg`）与 fd。用户机器上通常没有这两个程序：pi 自身的兜底是从
GitHub Releases 直连下载，大陆网络下大概率失败，失败后工具持续报错。
因此随包带上，主进程启动时把本目录（打包后为 `resources/bin`）前插进
PATH，pi 的 PATH 探测会直接命中，不再触发下载。接线见
`src/main/terminal/mingit.ts` 的 `prependRuntimePath()`。

| 工具   | 版本   | 来源                                                                                                       | 发布物 SHA256                                                      |
| ------ | ------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| rg.exe | 15.2.0 | <https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-pc-windows-msvc.zip> | `71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5` |
| fd.exe | 10.5.0 | <https://github.com/sharkdp/fd/releases/download/v10.5.0/fd-v10.5.0-x86_64-pc-windows-msvc.zip>            | `a227701b8551c35a9931d9f6da75503cf86d88e182d71fb849a70864c5d57cd7` |

- 架构均为 x86_64-pc-windows-msvc，与安装包的 win-x64 对应。
- 许可证：ripgrep 双许可（UNLICENSE / MIT），fd 双许可（MIT / Apache-2.0），
  见同目录 `LICENSE-ripgrep-*.txt` 与 `LICENSE-fd-*.txt`，随应用一起分发。

## 升级步骤

1. 从 release 页下载新的 zip，记下发布物 SHA256，解压取 `rg.exe` / `fd.exe` 覆盖本目录。
2. 更新本文件表格里的版本、来源与 SHA256。
3. 在 `CHANGELOG.md` 补一条变更记录。
