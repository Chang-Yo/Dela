# 设置页接口

设置页只暴露具体、已实现的操作；renderer 不读取已存凭据或数据库。

| 界面位置                               | 操作                 | 受控 API                                                     | 实际行为                                                                                                                                            |
| -------------------------------------- | -------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 外观 › 主题                            | 读取/保存主题        | `dela.settings.getTheme()` / `setTheme(theme)`               | `theme` 只接受 `system`、`light`、`dark`，保存到本地 SQLite；主进程同步 Electron `nativeTheme`，renderer 用 `html.light` / `html.dark` 切换 token。 |
| 数据与服务 › Canvas                    | 配置、替换令牌、断开 | `dela.canvas.configure()` / `syncCourses()` / `disconnect()` | 令牌先经 Canvas profile 请求验证，再由主进程用 `safeStorage` 加密保存；连接后同步课程列表，断开会删除令牌但保留已缓存资料。                         |
| 数据与服务 › 致远一号                  | 配置模型与 API Key   | `dela.workspace.getChat()` / `configureModel()`              | 可选模型固定为 Qwen、DeepSeek、MiniMax；密钥经 `safeStorage` 保存，不回传 renderer。                                                                |
| 数据与服务 › 工作目录                  | 选择位置             | `dela.workspace.chooseDirectory()` / `getState()`            | 调用系统目录选择器并保存目录；只影响之后新建的顶层内容和课程文件，不迁移已有文件。                                                                  |
| 数据与服务 › 学校邮箱 / 教学信息服务网 | 打开相应配置页       | `dela.mail` / `dela.timetable`                               | 这两项已有独立、完整的连接与断开流程，因此设置页明确显示为「前往」而不复制表单。                                                                    |
