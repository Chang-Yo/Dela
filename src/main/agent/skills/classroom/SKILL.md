---
name: classroom
description: 交大课堂录像：查询课程节次，按时间范围读取语音识别文稿，批量保存完整文稿
---

# 课堂语音文稿

复用 Dela 的校园登录；已连接 Canvas 时会自动登录。仍提示登录失效时，请用户在课堂视频页面登录，不索取 Cookie、JWT 或 cURL。

## 命令（Bash 内 dela）

- `dela list_classroom_courses '{"query":"课程关键词"}'`：已连接 Canvas 时查与「资料」相同的已同步课程，否则查本学期视频课程；支持 offset/limit 分页。
- `dela list_classroom_videos '{"courseId":123,"source":"canvas"}'`：查 Canvas 课程录像节次，同样支持分页。未连接 Canvas 时查询结果没有 source，后续命令也省略 source。
- `dela read_classroom_transcript '{"videoId":456,"startSeconds":600,"endSeconds":900}'`：读取 10–15 分钟的文稿，不写文件，不要求工作区。
- `dela download_classroom_transcripts '{"courseId":123,"source":"canvas","videoIds":[456,457],"directory":"/本机绝对路径"}'`：逐节保存完整 TXT。Windows 目录使用 `C:/...`。

## 指引

- 先查询真实课程和录像 ID，不猜测编号；将课程结果中的 id 和 source 原样传给后续命令。Canvas 课程 ID、视频教学班 ID 与录像 ID 各自独立。
- 读取默认只取前五分钟，返回与时间区间重叠的完整段落。单次默认 6000 字符、最多 12000 字符；有 nextOffset 时保持原时间范围并续读，读完后按需使用 nextStartSeconds 进入后续区间。不要连续拉完整学期充满上下文。
- available=false 表示暂无文稿；available=true 而 text 为空表示该区间无匹配内容。网络或登录错误不等于暂无文稿。识别文本可能有误，引用时注明课程、节次和时间。
- 只有用户要求保存时才下载。目标是本机目录，必须来自用户明确指定的位置或已经明确的本地项目，不根据界面当前选中项猜测。无工作区时优先只读，需要下载先明确目录；远程项目不要把远端路径传给本机下载命令。
- 下载不截取时间范围，每项返回 saved/unavailable/failed。已有文件不会覆盖；只针对需要的节次重试。
- `dela help '{"command":"read_classroom_transcript"}'` 查看参数，不确定时先查 help。
