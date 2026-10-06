import { SectionHeader } from '../SectionHeader';

/**
 * 设置 › 隐私条款：逐条陈述当前实现的数据事实（依据 src/main 的实际实现整理）。
 * 正式隐私条款尚未定稿，本页只描述现状，不含承诺、营销表述与法律措辞；
 * 实现发生变化时必须同步核对本页每一条陈述。
 */
export function PrivacySection() {
  return (
    <div className="grid gap-5" data-setting-id="privacy">
      <SectionHeader title="隐私条款" />
      <p className="text-xs leading-relaxed text-muted-foreground">
        本页说明当前版本实际如何处理你的数据，内容依据本版本的代码实现整理，供你核对现状。正式的隐私条款尚未定稿：本页不是法律文件，也不代表对后续版本的承诺。
      </p>

      <section className="grid gap-3 rounded-xl border bg-card p-5 max-md:p-4">
        <h2 className="text-sm font-medium">数据保存在本机</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          应用没有远程数据库：对话、资料与凭据都写在本机。界面不直接读写数据库与凭据文件，只通过预加载接口请求主进程。
        </p>
        <ul className="grid list-disc gap-1 pl-4 text-xs leading-relaxed text-muted-foreground">
          <li>
            Electron 应用数据目录（userData）下的 SQLite 数据库 dela.db：对话与消息、Agent
            运行记录、邮件与课程等同步数据、笔记与文件的索引、通知、各项设置。
          </li>
          <li>
            同一目录下的加密凭据文件：llm-providers.bin（模型服务地址与 API
            Key）、mail-credentials.bin（邮箱地址与密码）、canvas-token.bin（Canvas
            访问令牌）、shuiyuan-key.bin（水源 User API
            Key、用户名与绑定时间）、campus-session.bin（教学信息服务网的登录会话
            Cookie）。旧版单凭据文件 model-credential.bin 在迁移为多提供商配置后删除。
          </li>
          <li>
            工作目录（默认「文档/Dela」，可在 设置 › 工作区 更改）中的文件：笔记的 Markdown
            正文与其中的图片、导入的文件、从 Canvas
            下载的课程文件（courses/），以及导出到「预览导出」文件夹的 PDF。
          </li>
          <li>
            其他本机文件：对话中发送的图片（chat-media/）、邮件草稿（mail-drafts/）、数据库升级前自动生成的备份（dela-before-*.db）。
          </li>
        </ul>
        <p className="text-xs leading-relaxed text-muted-foreground">
          邮件、课程、课表与作业是学校服务的本地副本，可重新同步获取。邮箱密码不写入数据库：数据库里只有邮箱地址、服务器与端口。
        </p>
      </section>

      <section className="grid gap-3 rounded-xl border bg-card p-5 max-md:p-4">
        <h2 className="text-sm font-medium">凭据如何保护</h2>
        <ul className="grid list-disc gap-1 pl-4 text-xs leading-relaxed text-muted-foreground">
          <li>
            凭据文件用 Electron safeStorage
            加密后写入，解密能力由操作系统保管；系统不支持加密时，应用拒绝读写并给出提示。
          </li>
          <li>
            写入先落临时文件再原子替换；旧文件无法解密时，先备份为「原文件名.unreadable-随机串.bak」再写入新内容，不因重新配置而删除。
          </li>
          <li>
            API Key 与令牌只在主进程内使用：界面拿到的模型服务配置不含密钥字段；邮箱、Canvas
            与水源只返回连接状态、邮箱地址或用户名，不含密码与令牌。
          </li>
          <li>
            密钥不进入模型消息：请求时由主进程把 API Key 放进 HTTP
            请求头，发给模型的内容是对话与资料文本。
          </li>
        </ul>
      </section>

      <section className="grid gap-3 rounded-xl border bg-card p-5 max-md:p-4">
        <h2 className="text-sm font-medium">运行 Agent 时发送到模型服务的内容</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          只有在你发送消息、让它继续执行，或在设置中检测密钥时，才会请求模型服务。请求由主进程直接发出，界面不持有密钥。
        </p>
        <ul className="grid list-disc gap-1 pl-4 text-xs leading-relaxed text-muted-foreground">
          <li>系统提示词，以及已启用 Skills 的名称与描述索引。</li>
          <li>
            你在 设置 › 自定义指令 的 Instruction
            中填写的文字（留空则不发送），它会随每次请求一并发出。
          </li>
          <li>当前会话的历史消息；较早历史已生成摘要时，摘要一并发送。</li>
          <li>
            本轮引用的资料内容（按需读取的笔记、课程文件、邮件等正文）、附件正文、你输入的文字与图片。
          </li>
          <li>工具执行结果会随后续轮次继续发回同一服务。</li>
        </ul>
        <p className="text-xs leading-relaxed text-muted-foreground">
          这些内容发往 设置 › 模型供应商
          中启用的地址。数据保存在本机不等于在本机推理：应答由你选择的模型服务产生，内容发出后如何保存由该服务决定，本应用不控制。
        </p>
      </section>

      <section className="grid gap-3 rounded-xl border bg-card p-5 max-md:p-4">
        <h2 className="text-sm font-medium">应用会联网的位置</h2>
        <ul className="grid list-disc gap-1 pl-4 text-xs leading-relaxed text-muted-foreground">
          <li>模型服务：设置 › 模型供应商 中配置的地址；对话、历史摘要与密钥检测都请求这里。</li>
          <li>学校邮箱 mail.sjtu.edu.cn：IMAP 993 收信、SMTP 465 发信，使用你保存的邮箱密码。</li>
          <li>
            Canvas oc.sjtu.edu.cn：使用你保存的访问令牌；下载文件时可能重定向到
            s3.jcloud.sjtu.edu.cn 的签名地址。
          </li>
          <li>教学信息服务网 i.sjtu.edu.cn：使用登录窗口取得的会话 Cookie。</li>
          <li>水源社区 shuiyuan.sjtu.edu.cn：使用绑定时取得的 User API Key。</li>
          <li>
            联网搜索：把搜索词发往项目自建的 SearXNG 实例，地址在代码中固定为
            http://47.117.158.218:8778/search（明文 HTTP，无传输加密）。
          </li>
          <li>
            读取网页：抓取模型指定的任意公网地址，只允许 http/https 与 80/443
            端口；内网、环回与链路本地地址被拒绝，每一跳重定向都会重新做 DNS 校验。
          </li>
          <li>
            界面直接加载的远程图片：邮件正文图片默认显示（可在邮件页切换为隐藏），水源楼层中的站内图片经主进程代理取回，站外图片与头像由界面直接加载。
          </li>
        </ul>
        <p className="text-xs leading-relaxed text-muted-foreground">
          上述内置能力（联网搜索、读取网页等）可在 设置 › 内置能力
          中逐项关闭；少数被其他工具依赖的能力固定开启，在该页只读展示。
        </p>
      </section>

      <section className="grid gap-3 rounded-xl border bg-card p-5 max-md:p-4">
        <h2 className="text-sm font-medium">应用没有的功能</h2>
        <ul className="grid list-disc gap-1 pl-4 text-xs leading-relaxed text-muted-foreground">
          <li>
            没有账号服务器：不需要注册或登录 Dela 账号，代码中也没有把数据上传到项目服务器的接口。
          </li>
          <li>
            没有云同步：换一台设备不会自动带上你的数据，迁移需要自行拷贝工作目录与应用数据目录。
          </li>
          <li>
            没有使用统计与崩溃上报：依赖中没有统计分析或崩溃上报的第三方服务，主进程的对外请求只有上面列出的几类。
          </li>
        </ul>
      </section>

      <section className="grid gap-3 rounded-xl border bg-card p-5 max-md:p-4">
        <h2 className="text-sm font-medium">本机记录了什么</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          应用运行时不写日志文件（开发模式的控制台输出只打印在终端，不落盘）。Agent
          每次执行会在本机数据库留一条运行记录，包含：
        </p>
        <ul className="grid list-disc gap-1 pl-4 text-xs leading-relaxed text-muted-foreground">
          <li>运行 id、状态、所属会话与项目、开始与结束时间。</li>
          <li>请求摘要：这条消息的前 200 个字符，以及引用资料与附件的名称。</li>
          <li>工具步骤：工具名、状态、开始与结束时间；整次运行失败时另记一条错误信息。</li>
        </ul>
        <p className="text-xs leading-relaxed text-muted-foreground">
          工具的参数与结果全文不写进运行记录（保存在会话消息里）；运行记录不含邮箱密码、Canvas
          令牌、水源密钥或模型 API Key，也不会作为上下文发给模型。
        </p>
      </section>
    </div>
  );
}
