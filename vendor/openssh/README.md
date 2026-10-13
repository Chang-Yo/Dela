# 自带 OpenSSH 客户端（回退用）

Dela 的远程项目优先使用系统 OpenSSH（`%WINDIR%\System32\OpenSSH\ssh.exe`，其次
`%ProgramFiles%\OpenSSH\ssh.exe`）。系统里没有时，回退到这个目录里的客户端。
探测顺序见 `src/main/remotes/transport.ts` 的 `binaryCandidates`。

| 项目 | 值                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------ |
| 来源 | <https://github.com/PowerShell/Win32-OpenSSH/releases/tag/10.0.0.0p2-Preview>                    |
| 文件 | `OpenSSH-Win64.zip`（SHA256 `23F50F3458C4C5D0B12217C6A5DDFDE0137210A30FA870E98B29827F7B43ABA5`） |
| 版本 | `OpenSSH_for_Windows_10.0p2`，LibreSSL 4.2.0                                                     |
| 许可 | 见同目录 `LICENSE.txt` 与 `NOTICE.txt`（BSD 系，允许随应用分发）                                 |

这里只放客户端要用的两个文件：

- `ssh.exe`：命令行客户端本体。
- `libcrypto.dll`：`ssh.exe` 唯一的非系统依赖。两者的导入表里其余 DLL
  （advapi32、crypt32、kernel32、secur32、user32、userenv、ws2_32、bcrypt、ntdll）
  都是 Windows 自带的；没有 VC++ 运行库依赖（静态 CRT），所以不需要再带别的文件。

不带 `moduli`：实测 Win32-OpenSSH 不读可执行文件旁边的 `moduli`（放一个损坏的也不报错），
DH-GEX 用内置默认组，带上是死重量。

不带 `sshd.exe`、`ssh-keygen.exe`、`scp.exe`、`sftp.exe`：Dela 只用 `ssh` 建连接与跑命令，
不用 SFTP（见 `docs/DEVELOPMENT.md` §4），也不生成密钥。

## 升级步骤

1. 从上面的 release 页下载新的 `OpenSSH-Win64.zip`，记下 SHA256。
2. 解压后把 `ssh.exe`、`libcrypto.dll`、`LICENSE.txt`、`NOTICE.txt` 覆盖到本目录。
3. 改本文件里的版本、来源与 SHA256，并在安装包上验证一次真实连接（见下）。
4. 在 `CHANGELOG.md` 补一条变更记录。

## 验证回退真的能用

系统里有 OpenSSH 时 `binaryCandidates` 会先命中系统路径，看不出回退是否可用。
把这两个文件单独复制到一个空目录直接跑即可：

```powershell
.\ssh.exe -V
.\ssh.exe -i C:\Users\<你>\.ssh\id_ed25519 -o BatchMode=yes root@<主机> "uname -sr"
```
