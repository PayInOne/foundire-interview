# foundire-interview

面试后端服务（internal API + RabbitMQ workers）。

## 本地开发

1) 复制并填写环境变量：`cp .env.example .env`
2) 安装依赖：`npm install`
3) 启动：`npm run dev`

## 运行方式

- HTTP: `GET /health`
- Internal: 所有 `/internal/*` 均需要 `Authorization: Bearer $INTERNAL_API_TOKEN`
  - `POST /internal/interview-codes/verify`
  - `POST /internal/interview-codes/use`
  - `POST /internal/interviews/create`
  - `GET /internal/interviews/:id`
  - `GET /internal/interviews/:id/state`
  - `PUT /internal/interviews/:id/state`
  - `POST /internal/interviews/analyze`（入队 `interview_analyze`）
  - `POST /internal/interviews/questions`
  - `POST /internal/interviews/conversation`
  - `POST /internal/interviews/analyze-message`
  - `POST /internal/interviews/evaluate-topic`
  - `POST /internal/interviews/heartbeat`
  - `POST /internal/interviews/transcript`
  - `POST /internal/interviews/livekit/start`
  - `POST /internal/interviews/livekit/stop`
  - `POST /internal/interviews/cleanup`
  - `POST /internal/livekit/token`
  - `POST /internal/livekit/webhook`
  - `GET /internal/azure-speech/token`
  - `POST /internal/azure-speech/token`
  - `POST /internal/azure-speech/recognize`
  - `POST /internal/azure-tts`
  - `POST /internal/liveavatar/create-custom-session`
  - `POST /internal/liveavatar/keep-alive`
  - `POST /internal/liveavatar/end-session`
  - `GET /internal/digital-human/config`
  - `GET /internal/did/agent`
  - `POST /internal/did/stream`
  - `DELETE /internal/did/stream`
  - `POST /internal/did/sdp`
  - `POST /internal/did/talk`
- Worker: 检测到 `RABBITMQ_URL` 后自动启动 consumer
