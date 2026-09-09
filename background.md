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
