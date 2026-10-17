# 自带搜索工具 rg / fd（Agent 的 grep / find）

Dela 内核（pi）的 `grep` / `find` 工具不在进程内实现，而是 spawn 外部的
ripgrep（`rg`）与 fd。用户机器上通常没有这两个程序：pi 自身的兜底是从
GitHub Releases 直连下载，大陆网络下大概率失败，失败后工具持续报错。
因此随包带上，主进程启动时把平台对应目录前插进 PATH，pi 的 PATH 探测会直接命中，
不再触发下载。Windows 使用本目录（打包后为 `resources/bin`），macOS 使用
`darwin-arm64` 或 `darwin-x64` 子目录（打包后为 `resources/bin/darwin-<arch>`）。接线见
`src/main/terminal/mingit.ts` 的 `prependRuntimePath()`。

| 工具   | 版本   | 来源                                                                                                       | 发布物 SHA256                                                      |
| ------ | ------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| rg.exe | 15.2.0 | <https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-pc-windows-msvc.zip> | `71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5` |
| fd.exe | 10.5.0 | <https://github.com/sharkdp/fd/releases/download/v10.5.0/fd-v10.5.0-x86_64-pc-windows-msvc.zip>            | `a227701b8551c35a9931d9f6da75503cf86d88e182d71fb849a70864c5d57cd7` |

macOS 发布物（沿用相同版本）：

| 文件            | 来源                                                                                                        | 发布物 SHA256                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| darwin-arm64/rg | <https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-aarch64-apple-darwin.tar.gz> | `3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4` |
| darwin-x64/rg   | <https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-apple-darwin.tar.gz>  | `af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1` |
| darwin-arm64/fd | <https://github.com/sharkdp/fd/releases/download/v10.5.0/fd-v10.5.0-aarch64-apple-darwin.tar.gz>            | `b67e1836c468e42e411984b56e52fa7abec08c2bd22c867398e7cc134aac5e12` |
| darwin-x64/fd   | <https://github.com/sharkdp/fd/releases/download/v10.5.0/fd-v10.5.0-x86_64-apple-darwin.tar.gz>             | `7e31028c62c6955877735d0406807aa484c2a5e6f86235a59e26c29c301da590` |

- Windows 架构为 x86_64-pc-windows-msvc；macOS 按 Electron 进程架构选择 Mach-O 文件。
- macOS 文件为未修改的官方发布二进制；2026-10-15 下载时核对了 GitHub Release API 的 asset digest。可执行权限为 0755，打包仅拷贝目标架构，不依赖用户安装 rg/fd。
- 许可证：ripgrep 双许可（UNLICENSE / MIT），fd 双许可（MIT / Apache-2.0），
  见同目录 `LICENSE-ripgrep-*.txt` 与 `LICENSE-fd-*.txt`，随应用一起分发。
  Mac 发布物中的四份许可证已逐字节核对，与现有许可证一致。

## 升级步骤

1. 从 release 页下载对应平台 zip/tar.gz，核对发布物 SHA256，取 `rg.exe` / `fd.exe` 或 `rg` / `fd` 覆盖对应目录；macOS 保留 0755 权限。
2. 更新本文件表格里的版本、来源与 SHA256。
3. 在 `CHANGELOG.md` 补一条变更记录。
