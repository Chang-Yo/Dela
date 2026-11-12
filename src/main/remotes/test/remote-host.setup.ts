import { existsSync } from 'node:fs';

// 真机远程套件的前置检查：没有 DELA_REMOTE_HOST 或随包 rg 就直接失败，
// 避免「整批用例被跳过」或「悄悄退回 Go 遍历」被当成通过。
export default function setup(): void {
  if (!process.env.DELA_REMOTE_HOST) {
    throw new Error(
      '真机远程套件需要 DELA_REMOTE_HOST（例如 root@1.2.3.4），可选 DELA_REMOTE_KEY 指定私钥',
    );
  }
  if (!existsSync('.build/remote-rg/rg-linux-amd64'))
    throw new Error('真机远程套件需要随包 rg，先运行 pnpm fetch:remote-rg');
}
