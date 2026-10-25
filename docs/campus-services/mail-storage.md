# 邮件与存储服务

[← Wiki 首页](README.md) · [← 学习与社区](learning-community.md) · [下一页：网络与部署 →](network-deployment.md) · [安全与合规](security.md)

本页说明交大邮箱和交大云盘的数据路径。邮箱支持标准协议与 Open API；云盘目前只记录官方网页端和客户端能力。

## 交大邮箱

**服务能力**

交大邮箱支持标准 IMAP 收信和 SMTP 发信。开发者可以直接连接个人邮箱，也可以在取得 Open API scope 后使用 Mail API。

**凭证如何获取**

IMAP 和 SMTP 路线：

1. jAccount 开通后，学校自动开通同名邮箱。
2. 邮箱地址通常为“jAccount 账号@sjtu.edu.cn”。
3. 使用本人邮箱密码登录邮件协议服务。
4. IMAP 服务器为 mail.sjtu.edu.cn，SSL/TLS 端口为 993。
5. SMTP 服务器为 mail.sjtu.edu.cn，SSL/TLS 端口为 465。

Open API 路线：

1. 申请 jAccount 应用。
2. 按需要申请 read_mails、send_mails 等 Mail API scope。
3. 用户完成 OAuth 授权后取得 Access Token。

**数据如何获取**

1. 使用 IMAP 建立 TLS 连接并登录。
2. 列出邮箱文件夹，记录文件夹路径和 UIDVALIDITY。
3. 按 UID 增量读取邮件头、正文、附件、日期、发件人和收件人。
4. 使用 IMAP Flag 更新已读等状态。
5. 使用 SMTP TLS 连接发送正文和附件。
6. 使用 Open API 时，可按未读、已读或全部邮件读取，并使用对应接口发送邮件或修改状态。

**可获得的数据范围**

- 邮箱文件夹
- 邮件主题、发件人、收件人和时间
- 文本或 HTML 正文
- 附件
- 已读、未读和其他 IMAP 状态
- 草稿和已发送邮件
- 邮件发送结果

**可以构建的服务**

- 个人邮件客户端
- 未读邮件提醒
- 邮件搜索和归档
- 附件下载与分类
- 课程通知聚合
- 基于本人邮件的摘要和问答
- 自动生成但由用户确认发送的邮件草稿

**服务入口与参考资料**

- [交大邮箱服务](https://net.sjtu.edu.cn/xxfw/dzyj.htm)
- [交大邮箱服务器参数](https://net.sjtu.edu.cn/info/1191/2699.htm)
- [Mail API](https://developer.sjtu.edu.cn/api/mail.html)

## 交大云盘 Pan

**服务能力**

Pan 提供个人空间、交大空间、文件上传下载、共享、协作、历史版本、文件收集和本地同步。

**凭证如何获取**

1. 打开[交大云盘](https://pan.sjtu.edu.cn/)或安装官方客户端。
2. 点击 jAccount 登录。
3. 完成登录后进入本人个人空间和已经获权的交大空间。
4. 官方客户端复用同一账号建立同步任务。

**数据如何获取**

官方公开资料提供两条数据使用路径：

1. 在网页端浏览、搜索、上传、下载、共享和管理文件。
2. 在 PC 客户端选择本地文件夹和云端文件夹，创建双向同步或单向备份任务。

当前公开手册没有提供读取个人空间目录的第三方开发者 API 申请流程。因此本指南不把社区项目使用的私有 Web 接口写成稳定契约。

**可获得的数据范围**

- 个人空间文件和文件夹
- 本人获权访问的交大空间
- 文件元数据和历史版本
- 共享链接和共享权限
- 文件收集任务
- 客户端同步状态

**可以构建的服务**

基于当前公开路径，可以使用官方客户端构建个人文件同步、备份和协作流程。第三方程序自动读取目录、上传或删除文件仍待补证，需取得公开接口文档或完成独立验证后补充。

**服务入口与参考资料**

- [交大云盘](https://pan.sjtu.edu.cn/)
- [Pan 登录说明](https://pan.sjtu.edu.cn/pandoc/login.html)
- [Pan 基础文件操作](https://pan.sjtu.edu.cn/pandoc/file-operation.html)
- [Pan 同步盘操作](https://pan.sjtu.edu.cn/pandoc/sync.html)
- [交大云盘服务说明](https://net.sjtu.edu.cn/xxfw/jBoxjdyp.htm)

---

[← 上一页：学习与社区](learning-community.md) · [下一页：网络与部署 →](network-deployment.md)
