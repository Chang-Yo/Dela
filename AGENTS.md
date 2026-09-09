# Dela 开发约束

- 先读 `docs/technical-plan.md`。用户最新明确决定优先于规划；`background.md` 中无法取得 jAccount client_id 是固定约束。
- 单应用、单 package。`pnpm-workspace.yaml` 仅用于 pnpm 12 设置，不引入子包或 monorepo。
- 优先一个函数或现有文件；出现真实重复和多个调用方后才提取抽象，不预建 Manager/Service/Factory 等层级。
- renderer 不导入 main，不访问凭据和数据库；通过有限的 preload API 通信。Vite 不自动加载仓库 `.env`。
- 不读取或输出无关密钥，不提交 `.env`、mobileconfig、个人数据、日志和本地工具。打包只包含明确产物。
- 保持精确依赖与锁文件，使用 Node.js 24.21.0、pnpm 12.3.4；本机可先执行 `. ./scripts/use-local-tools.ps1`。
- 改动后执行相关检查。涉及构建或原生依赖时，验证 `pnpm build`、`pnpm smoke` 和打包后启动。
- 重要改动同步更新 README 和技术规划。区分已验证事实、待验证能力与产品设想，不能以占位结果宣称功能完成。
