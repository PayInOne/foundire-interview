# foundire-interview

面试后端服务（internal API + RabbitMQ workers）。

## 本地开发

1) 复制并填写环境变量：`cp .env.example .env`
2) 安装依赖：`npm install`
3) 启动：`npm run dev`

## 运行方式

- HTTP: `GET /health`
- Internal: 所有 `/internal/*` 均需要 `Authorization: Bearer $INTERNAL_API_TOKEN`
  - `POST /internal/interviews/analyze`（入队 `interview_analyze`）
  - `POST /internal/interviews/questions`
  - `POST /internal/interviews/conversation`
  - `POST /internal/interviews/analyze-message`
  - `POST /internal/interviews/evaluate-topic`
- Worker: 检测到 `RABBITMQ_URL` 后自动启动 consumer
