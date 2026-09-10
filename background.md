# Background

## 密钥文件在 `.env`和`knowledge/`的部分文件中

其中：

- `Jaccount_username`代表自己的交大Jaccount账户名
- `Jaccount_password`代表自己的交大Jaccount账户密码
- `Canvas_access_token`代表Canvas网页服务的访问令牌
- `Zimbra_mobileconfig_filepath`代表学校邮箱服务（基于Zimbra）的 mobileconfig 文件
- `ZHIYUAN_API_KEY`代表自己致远一号大模型服务的API KEY
- `ZHIYUAN_BASE_URL`代表致远一号服务的BASE_URL
  目前可用的模型id和对应的模型是：
  - `deepseek-chat`: Deepseek-V4-Flash（常规模式） 上下文 256k
  - `deepseek-reasoner`: Deepseek-V4-Flash（深度思考模式） 上下文 256k
  - `qwen`：Qwen-3.8-Flash 上下文 256k
  - `minimax`：MiniMax-2.7 上下文 192k

其中有关致远一号服务的调用接口格式可以参照如下（主要是OPENAI格式）：

```bash
curl --location --request POST 'https://models.sjtu.edu.cn/api/v1/chat/completions' \
--header 'Accept: application/json' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer <your-api-key>' \
--data '{
  "model": "deepseek-chat",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "请介绍上海交通大学"
    }
  ],
  "stream": false,
  "max_tokens": 1024
}'
```

已知：

- 我已经是交大学生，上面的密钥文件全是我个人的数据
- Jaccount接入申请已经停止，不存在任何途径可以申请到对应的 `client_id`

## 相关资料

在`knowledge/SJTU_API_References.md`中，详细记录了能够搜集到的所有的和交大开放API以及交大相关学生信息服务的文档或相关项目。是开发时的主要参考依据。

## 长期目标

桌面端app + Android端app

## 配色方案定义

这是CSS格式导出的配色方案。

```
@media (prefers-color-scheme: light) {
  :root {
    --text-50: #f4f4f1;
    --text-100: #e8e8e3;
    --text-200: #d1d1c7;
    --text-300: #babaab;
    --text-400: #a3a38f;
    --text-500: #8c8c73;
    --text-600: #70705c;
    --text-700: #545445;
    --text-800: #38382e;
    --text-900: #1c1c17;
    --text-950: #0e0e0b;

    --background-50: #f8f5ec;
    --background-100: #f1ebda;
    --background-200: #e4d6b4;
    --background-300: #d6c28f;
    --background-400: #c9ae69;
    --background-500: #bb9944;
    --background-600: #967b36;
    --background-700: #705c29;
    --background-800: #4b3d1b;
    --background-900: #251f0e;
    --background-950: #130f07;

    --primary-50: #f8f6ec;
    --primary-100: #f2edd9;
    --primary-200: #e4dbb4;
    --primary-300: #d7c98e;
    --primary-400: #cab668;
    --primary-500: #bda442;
    --primary-600: #978335;
    --primary-700: #716328;
    --primary-800: #4b421b;
    --primary-900: #26210d;
    --primary-950: #131007;

    --secondary-50: #f4f3f0;
    --secondary-100: #e9e8e2;
    --secondary-200: #d3d0c5;
    --secondary-300: #bdb9a8;
    --secondary-400: #a7a28b;
    --secondary-500: #918a6e;
    --secondary-600: #746f58;
    --secondary-700: #575342;
    --secondary-800: #3a372c;
    --secondary-900: #1d1c16;
    --secondary-950: #0f0e0b;

    --accent-50: #f6f4ef;
    --accent-100: #edeade;
    --accent-200: #dbd4bd;
    --accent-300: #c9bf9c;
    --accent-400: #b7aa7b;
    --accent-500: #a4945b;
    --accent-600: #847748;
    --accent-700: #635936;
    --accent-800: #423b24;
    --accent-900: #211e12;
    --accent-950: #100f09;

  }
}
@media (prefers-color-scheme: dark) {
  :root {
    --text-50: #0e0e0b;
    --text-100: #1c1c17;
    --text-200: #38382e;
    --text-300: #545445;
    --text-400: #70705c;
    --text-500: #8c8c73;
    --text-600: #a3a38f;
    --text-700: #babaab;
    --text-800: #d1d1c7;
    --text-900: #e8e8e3;
    --text-950: #f4f4f1;

    --background-50: #130f07;
    --background-100: #251f0e;
    --background-200: #4b3d1b;
    --background-300: #705c29;
    --background-400: #967b36;
    --background-500: #bb9944;
    --background-600: #c9ae69;
    --background-700: #d6c28f;
    --background-800: #e4d6b4;
    --background-900: #f1ebda;
    --background-950: #f8f5ec;

    --primary-50: #131007;
    --primary-100: #26210d;
    --primary-200: #4b421b;
    --primary-300: #716328;
    --primary-400: #978335;
    --primary-500: #bda442;
    --primary-600: #cab668;
    --primary-700: #d7c98e;
    --primary-800: #e4dbb4;
    --primary-900: #f2edd9;
    --primary-950: #f8f6ec;

    --secondary-50: #0f0e0b;
    --secondary-100: #1d1c16;
    --secondary-200: #3a372c;
    --secondary-300: #575342;
    --secondary-400: #746f58;
    --secondary-500: #918a6e;
    --secondary-600: #a7a28b;
    --secondary-700: #bdb9a8;
    --secondary-800: #d3d0c5;
    --secondary-900: #e9e8e2;
    --secondary-950: #f4f3f0;

    --accent-50: #100f09;
    --accent-100: #211e12;
    --accent-200: #423b24;
    --accent-300: #635936;
    --accent-400: #847748;
    --accent-500: #a4945b;
    --accent-600: #b7aa7b;
    --accent-700: #c9bf9c;
    --accent-800: #dbd4bd;
    --accent-900: #edeade;
    --accent-950: #f6f4ef;

  }
}
```