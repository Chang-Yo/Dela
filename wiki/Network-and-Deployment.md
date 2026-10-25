# 网络与部署服务

[← Wiki 首页](https://github.com/Chang-Yo/Dela/wiki) · [← 邮件与存储](https://github.com/Chang-Yo/Dela/wiki/Mail-and-Storage) · [下一页：AI 与计算 →](https://github.com/Chang-Yo/Dela/wiki/AI-and-Compute) · [安全与合规](https://github.com/Chang-Yo/Dela/wiki/Security-and-Compliance)

本页汇总校园网络接入、云资源、域名网站和网络短信。办理入口与自动化接口并不等价，请先确认每项服务的入口性质。

## 交大 VPN

**服务能力**

交大 VPN 让校外设备进入校园网络环境。它提供网络可达性，不直接提供业务数据。

**凭证如何获取**

1. jAccount 开通后，学生和教职工可使用同名 VPN 账号。
2. 从[交大 VPN 服务页](https://net.sjtu.edu.cn/wlfw/VPN.htm)下载当前客户端。
3. 使用本人 jAccount 登录。

**数据如何获取**

1. 安装官方 VPN 客户端。
2. 登录并建立连接。
3. 连接成功后访问原本要求校园网的服务。
4. 数据仍由目标服务自身的登录会话、Token 或 API 提供。

**可获得的数据范围**

VPN 本身不返回课程、邮件或校务数据。它只让设备访问当前账号本来能够访问的校内网络资源。

**可以构建的服务**

- 校外访问校内 API
- 校外连接模型和计算平台
- 校外访问教学、科研和部门内部服务
- 为本地开发环境建立校园网连接

**服务入口与参考资料**

- [交大 VPN](https://net.sjtu.edu.cn/wlfw/VPN.htm)

## jCloud 交大云

**服务能力**

jCloud 提供云主机、磁盘、对象存储、数据库、网络和安全组等资源，可承载校园服务后端。

**凭证如何获取**

1. 打开[jCloud 控制台](https://home.jcloud.sjtu.edu.cn/auth/login/?next=/)，使用 jAccount 登录。
2. 进入需要管理的项目；没有资源时，先在控制台申请资源和配额。
3. 调用 REST API 时，在当前项目中点击“获取 Token”并复制项目级 Token。
4. 项目 Token 有效期为 6 小时。过期后回到控制台重新获取。
5. 登录云主机时，使用平台提供的账号或自行配置的 SSH 密钥。

**数据如何获取**

1. 在控制台查看项目获批的主机、磁盘、数据库、对象存储和网络。
2. 自动化管理云主机时，向 `https://home.jcloud.sjtu.edu.cn:8774` 下的 `v2.1` REST API 发起 HTTPS 请求，并在请求头中携带 `X-Auth-Token`。
3. 按 API 中心的资源路径查询、创建、修改或删除云主机，并管理开关机、重启、网络、磁盘、安全组、SSH 密钥、浮动 IP、快照、配额和控制台日志。
4. 通过 SSH 管理云主机和读取项目文件。
5. 使用数据库、对象存储或其他资源自身的连接凭据访问数据。
6. Token 失效时重新从当前项目获取，不能把项目 Token 当作长期密钥。

**可获得的数据范围**

- 项目云主机和运行状态
- 磁盘与对象存储
- 数据库实例
- 网络、安全组和公网配置
- 项目成员权限
- 操作记录、配额和工单

**可以构建的服务**

- 校园网站和 API 后端
- 数据库与对象存储服务
- 科研或教学应用部署
- 个人或团队开发测试环境
- 需要校园网络资源的后台任务

**服务入口与参考资料**

- [jCloud 交大云](https://net.sjtu.edu.cn/wlfw/jCloudjdy.htm)
- [jCloud 控制台](https://home.jcloud.sjtu.edu.cn/auth/login/?next=/)
- [jCloud 文档中心](https://jcloud.sjtu.edu.cn/document/detail.html)
- [jCloud Token 认证](https://jcloud.sjtu.edu.cn/document/detail.html?id=1175&mod=api)
- [jCloud API 概览](https://jcloud.sjtu.edu.cn/document/detail.html?id=1172)
- [jCloud REST 调用方法](https://jcloud.sjtu.edu.cn/document/detail.html?id=1174&mod=api)
- [网站校外访问说明](https://net.sjtu.edu.cn/info/1208/3001.htm)

## 校园域名与网站服务

**服务能力**

网络信息中心提供 sjtu.edu.cn 子域名、网站群、网站建设、证书和备案支持。

**凭证如何获取**

1. 确认网站归属单位、负责人和用途。
2. 申请、取消或变更域名，以及申请网站群建站时，打开[域名、站群建站申请或变更](https://form.sjtu.edu.cn/infoplus/form/nicman_dns_and_virtualhost/start?locale=zh)，使用 jAccount 登录后填写表单。
3. 也可以登录交我办，在“服务大厅 → 信息服务”中搜索同名流程。
4. 申请 SSL 证书部署或校园网站反向代理时，将域名、网站负责人、服务器 IP 和联系电话发送到 `dns@sjtu.edu.cn`。
5. 审核通过后取得域名管理、站点后台或服务器配置权限。

**数据如何获取**

1. 在交我办“我的信息资源 → 应用资源 → 域名”中查看已获批域名并发起后续变更。
2. 通过同一表单申请新增、取消、负责人信息修改、解析变更或网站群建站。
3. 将获批域名解析到目标主机或网站群，再通过网站群后台、服务器或部署系统发布内容。
4. 需要 SSL 证书或反向代理时，按邮件办理结果完成服务器配置。

该服务的正式自动化边界就是交我办流程、网站群后台和邮件办理。官方没有承诺通用域名管理 API，因此不再把它列为缺失接口。

**可获得的数据范围**

- 已申请域名和解析配置
- 网站空间与站点设置
- HTTPS 证书
- 备案或审核状态
- 网站内容和发布记录

**可以构建的服务**

- 学院、实验室或课程网站
- 校园服务入口
- 校内业务系统前端
- 活动、社团或科研项目网站
- 使用学校域名的 API 服务

**服务入口与参考资料**

- [域名和网站服务](https://net.sjtu.edu.cn/wlfw/ym.htm)
- [域名、站群建站申请或变更](https://form.sjtu.edu.cn/infoplus/form/nicman_dns_and_virtualhost/start?locale=zh)
- [域名申请说明](https://net.sjtu.edu.cn/info/1222/5048.htm)
- [网站建设说明](https://net.sjtu.edu.cn/info/1222/5038.htm)
- [SSL 证书部署说明](https://net.sjtu.edu.cn/info/1222/5078.htm)
- [校园网站反向代理说明](https://net.sjtu.edu.cn/info/1222/5088.htm)

## 网络短信服务

**服务能力**

网络短信服务为获批的校园业务提供短信发送能力。

**凭证如何获取**

1. 确认业务责任部门、发送用途、接收对象和预计发送量。
2. 下载并填写[上海交通大学短信平台申请表](https://net.sjtu.edu.cn/images/sms.doc)。
3. 由单位签字盖章后，将表格线下提交到网络信息中心；该服务目前仅面向部门，每单位限一个集体账号。
4. 收到开通通知后，使用集体账号登录[网络短信平台](http://sms.sjtu.edu.cn/)。
5. 如果使用 Open API Notification 服务，则另外申请对应通知 scope 和短信发送资格。

**数据如何获取**

该服务以发送为主。公开页面没有披露统一的短信接口契约；取得开通材料后，应按服务方提供的接口提交接收号码和内容，并保存消息 ID、发送时间和状态。

**可获得的数据范围**

- 短信发送请求
- 服务方返回的消息标识
- 开通材料中提供的发送状态
- 应用自身保存的发送记录

**可以构建的服务**

- 校园事务通知
- 服务状态提醒
- 经批准的身份验证短信
- 重要流程的到期提醒

接口请求格式、状态查询和限流信息仍待取得真实开通材料后补充。

**服务入口与参考资料**

- [网络短信服务](https://net.sjtu.edu.cn/xxfw/wldx.htm)
- [短信平台申请表](https://net.sjtu.edu.cn/images/sms.doc)
- [网络短信平台](http://sms.sjtu.edu.cn/)
- [Notification API](https://developer.sjtu.edu.cn/api/notification.html)

---

[← 上一页：邮件与存储](https://github.com/Chang-Yo/Dela/wiki/Mail-and-Storage) · [下一页：AI 与计算 →](https://github.com/Chang-Yo/Dela/wiki/AI-and-Compute)
