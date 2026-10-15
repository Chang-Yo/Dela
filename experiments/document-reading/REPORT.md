# 文档读取 skill 实验

日期：2026-10-15。环境：Windows x64、CPU、Python 3.12.10。

## 结论

建议默认采用 **文档读取 skill + MarkItDown + 页面/嵌入图片回退**。Docling 可作为需要本地 OCR 的可选工具，暂不随 Dela 默认分发。

这是选型阶段的历史记录。文档读取现已接入设置页和资源命令，当前架构见 `docs/DEVELOPMENT.md`；本报告以下内容描述实验时的实现和验收范围。

实验时：这是工具与 skill 脚本实验，不是已完成的 Dela 功能迁移。Pi 自动选择 skill、Canvas/附件临时文件交接、应用内图片消息、安装包升级与干净机器启动尚未验收。现有 GUI 预览和 Agent 读取代码未改动。

## 样本与方法

- 用户提供的 XLSX、PPTX、PDF 各一个，始终在原位置只读。
- 生成六个样本：多工作表/合并单元格/无缓存公式 XLSX；重排页序、备注、图片页 PPTX；普通 DOCX；仅变更命名空间前缀的 DOCX；中文双页 PDF；纯图片扫描 PDF。
- Office 参考文字由 openpyxl 和 python-pptx 读取。PDF 先用 PDFium 检查文本层；用户 PDF 无文本层，查看渲染页后人工选取九个可见文字片段。
- 归一化 Unicode、HTML 实体和空白后检查参考片段是否出现。该指标是**选定参考文字的覆盖率**，不衡量表格结构、图片理解、版式、幻觉或所有遗漏，不能称为通用准确率。
- 每个工具在同一进程连续转换每份文件两次；另外用独立 CLI 进程测 skill 的完整执行耗时。
- 基线直接调用 Dela 的 `parseDocumentFile`，绕过已知的 `read_resource` DOCX/PPTX 分支遗漏，因此基线表现比实际 Agent 入口更乐观。
- 原文件、提取正文、页面图片、日志、模型和工具环境只放在被忽略的 `.tools/document-eval/`。本报告只记录统计与合成样本标识。

## 内容结果

| 项目                          | Dela 现有解析函数   | MarkItDown 0.1.8   | Docling 2.139.0                         |
| ----------------------------- | ------------------- | ------------------ | --------------------------------------- |
| 用户 XLSX：11 个参考字段      | 不支持              | 11/11              | 11/11                                   |
| 用户 PPTX：230 段参考文字     | 230/230             | 230/230            | 230/230                                 |
| 用户图片 PDF                  | 无文本              | 无文本，需要看图   | 9 个可见片段命中 7 个，手写英文标语遗漏 |
| 合成 XLSX：9 个参考片段       | 不支持              | 9/9                | 9/9                                     |
| 合成 PPTX 正文与重排页序      | 正文齐全，页序错误  | 正文齐全，页序正确 | 正文齐全，页序正确                      |
| 合成 PPTX 备注                | 遗漏                | 保留               | 遗漏                                    |
| 普通 DOCX 正文/表格：7 个片段 | 7/7                 | 7/7                | 7/7                                     |
| 变更命名空间前缀 DOCX         | 空正文              | 7/7                | 转换失败                                |
| 中文双页 PDF：5 个片段        | 1/5；第一页正文遗漏 | 5/5                | 5/5                                     |
| 生成扫描 PDF                  | 无文本              | 无文本，需要看图   | 4 个片段命中 3 个；编号中的 O 识别成 0  |
| DOCX 页眉                     | 遗漏                | 遗漏               | 遗漏                                    |
| 无缓存 XLSX 公式              | 不支持              | 未保留公式         | 未保留公式                              |

Docling 的 PPTX 初次字符串检查只有 229/230；核对后发现差异只是 `<` 被输出为 `&lt;`。计分已修正实体解码，两者实际参考文字均齐全。

两者默认转换都没有读取合成 PPTX 图片内的编号。Docling 的 PDF OCR 能力不等于 Office 内嵌图片会自动 OCR。

本实验 skill 用 MarkItDown 的 `keep_data_uris=True` 获取内嵌图片，再落盘并替换为相对图片链接。用户 PPTX 提取出 22 张图片，生成 PPTX 提取出一张图片。未解释图片前，返回 `visual_content_unread`。

用户 PDF 经 skill 返回 `needs_visual_read` 和一张页面图片。已人工查看页面确认可读；没有把“生成图片”计为 OCR 成功，也没有测量其他模型读图的准确率和费用。

## 使用体验与性能

已准备好依赖后，独立运行 skill 的测量包含 Python 启动、库导入、转换、落盘和 JSON 输出：

| 输入      | skill 完整耗时 | 输出                            |
| --------- | -------------- | ------------------------------- |
| 用户 XLSX | 1.515 秒       | Markdown                        |
| 用户 PPTX | 1.855 秒       | Markdown + 22 张图片            |
| 用户 PDF  | 1.686 秒       | 明确提示需要视觉读取 + 页面图片 |

以上不包含 Agent 的选择、模型推理和工具往返耗时，也不是多轮统计的 p95。

工具内部转换的第二次调用：MarkItDown 用户 XLSX 约 0.01 秒、PPTX 约 0.10 秒；Docling 约 0.01 秒、1.00 秒。Docling 用户 PDF 在模型已下载、进程内已初始化时约 3.96 秒；新进程首次初始化 PDF 流程约 14.64 秒。首次下载模型并初始化时，该 PDF 调用测得约 60 秒。

九份样本各跑两次、同进程批量转换的观测内存峰值：MarkItDown 约 153 MiB，Docling 约 1.52 GiB。不是逐文件内存，也不是理论上限。

实际遇到的部署摩擦：Docling 因机器代理使用 SOCKS 而缺少 `socksio`，第一次 PDF 流程失败；在隔离环境补齐后重跑成功。模型下载还触发 Windows 无 symlink 权限的缓存提示。无需修改系统权限即可继续运行，但不能将开发者机器上的成功等同于普通用户开箱即用。

## 分发成本

依赖由安装后的 distribution 文件清单收集，排除用于生成样本的额外工具，使用 ZIP deflate level 6 实际压缩。单位为 MiB/GiB；NSIS 安装包增量尚未实测。

| 项目                               | MarkItDown      | Docling CPU                                   |
| ---------------------------------- | --------------- | --------------------------------------------- |
| 收集到的工具及传递依赖             | 42 个           | 96 个                                         |
| 依赖文件未压缩                     | 218.6 MiB       | 1022.1 MiB                                    |
| 依赖文件 ZIP                       | 78.9 MiB        | 322.4 MiB                                     |
| 独立 Python 3.12.10 embeddable ZIP | 10.6 MiB        | 未组装便携包                                  |
| 本次额外模型下载                   | 无 OCR/版面模型 | HF 缓存约 505.5 MiB，RapidOCR 模型约 61.0 MiB |

MarkItDown 自身的 Magika 识别依赖及 ONNX Runtime 已计入上述体积，不能把它理解为纯 Python、零模型依赖的小工具。

实验组装了 Windows x64 便携目录：官方 embeddable Python + 收集的工具依赖 + skill。已通过该目录内的 `python.exe` 处理真实 PDF 和 PPTX，无需系统 Python、uv 或 pip 参与执行。Python 使用 `_pth` 指定自己的 site-packages。ZIP 解压到另一目录后，在移除 Python/venv 环境变量、PATH 仅保留 Windows 系统目录的子进程中，XLSX 转换通过。该新目录首次执行耗时 14.333 秒，明显高于已准备环境的 1–2 秒；字节码生成、文件缓存与杀毒扫描的各自影响未分离。

便携包实测 **89.5 MiB ZIP / 240.1 MiB 解压文件**（93,894,108 / 251,736,564 字节）。字节数记录在 `.tools/document-eval/data/portable.json`；包文件为 `document-reading-windows-x64.zip`。它包含第三方安装元数据与随包许可证，但尚未完成完整传递依赖许可证审计、下载校验/更新机制、NSIS 集成或干净 Windows VM 验收，不应直接作为正式发布产物。

建议首次使用时由 Dela 准备固定版本的便携工具包；skill 只调用已准备好的 Python，不让 Agent 自由安装/升级依赖。若要求完全离线开箱即用，则随安装包分发，成本需要明确接受。Docling 若提供，作为独立可选增强下载，并另行管理模型。

## 解耦边界

1. Dela 保留 Canvas/邮件/工作区的资源获取，将可读取的本地文件交给工具。临时文件的生存期需覆盖整个子进程调用，结束后清理。
2. skill 负责选择文字提取、查看图片、处理空正文、检查遗漏和按需读取输出。
3. 成熟工具负责格式识别与解析；不把格式表、ZIP/XML 解析搬到另一份脚本里重写。
4. Pi 继续使用已有 bash/read/grep 能力；保留现有图片消息通道，避免 skill 为调用视觉模型重复取得凭据。
5. GUI 预览保持独立。用户点击文件不应触发模型调用。

当前 skill 用现有 `copy_file_to_project` 取得 Canvas/附件文件会创建项目副本；正式迁移应提供临时获取文件的受控命令，避免为了阅读污染项目目录。本实验没有新增该产品接口。

## 验证与限制

- 已验证：九份文件的 skill 脚本运行；缺失文件与无效页码明确失败；指定 PDF 页渲染；空正文回退；PPTX 图片落盘；skill 格式校验；便携 Python 运行。
- 未验证：Pi 自动触发和多轮工具使用质量；视觉模型准确率/费用；复杂图表与版式；超大文件、混合扫描 PDF 完整性；Canvas/邮件完整链路；严格断网环境与干净 VM；正式安装包与更新。
- 没有运行全仓测试、应用生产构建或应用打包：本次只增加隔离实验，没有改动应用运行代码或打包配置。
- 旧 Office 不作为本轮目标。没有为了格式覆盖安装 Tika 或增加 Java 运行时。

## 记录保留范围

正式实现接入后，已移除一次性评测脚本、重复的实验 skill、依赖清单与统计 JSON。本报告保留选型依据；当前脚本与固定依赖见 `src/main/documents/skill`，安装和使用流程见开发文档。以上测量是当时的实验结果，不代表当前完整 Agent 链路的验收。

参考：[MarkItDown](https://github.com/microsoft/markitdown)、[Docling](https://github.com/docling-project/docling)、[Agent Skills 脚本实践](https://agentskills.io/skill-creation/using-scripts)、[Python Windows embeddable runtime](https://docs.python.org/3.12/using/windows.html#the-embeddable-package)。skill 与实验脚本是 Dela 自编实现，没有复制 Anthropic 文档 skills。
