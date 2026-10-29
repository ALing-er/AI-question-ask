# AI 问答平台

多用户 AI 对话平台：注册登录、多模型切换、流式输出、会话历史、用户隔离、管理员后台、角色设定、自定义音色、百炼语音输入与朗读、默认联网搜索。

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Python 3.10 · FastAPI · SQLAlchemy 2.0 · SQLite |
| 前端 | React 19 · Vite 8 · TypeScript · Tailwind CSS 4 |
| 模型 | OpenAI 兼容协议（DeepSeek 可用，火山方舟待开通） |

## 目录

```
ai-qa/
├── app/
│   ├── main.py              应用入口：lifespan / 中间件 / 路由挂载 / SPA 托管
│   ├── schemas.py           请求与响应模型
│   ├── core/                基础设施
│   │   ├── config.py        配置（读 .env）
│   │   ├── tokens.py        上下文 token 估算
│   │   ├── security.py      bcrypt + JWT
│   │   ├── deps.py          鉴权 / 管理员 / 会话归属
│   │   ├── errors.py        统一错误码与异常处理
│   │   └── logging_setup.py 结构化日志 + request_id 上下文
│   ├── db/                  数据库层
│   │   ├── __init__.py      会话接口转发
│   │   ├── session.py       引擎 / 会话 / UTCDateTime / 启动补列
│   │   └── models.py        User / Conversation / Message / Persona / CustomVoice / AuditLog
│   ├── providers/           模型适配层（base / openai_compat / registry）
│   ├── services/            业务服务
│   │   ├── voice.py         百炼 TTS / ASR / 声音设计
│   │   ├── audit.py         审计日志写入
│   │   └── bootstrap.py     种子管理员
│   └── routers/             auth / conversations / models / chat / admin / personas / system / voice
├── config/models.yaml       模型清单（加模型只改这里）
├── data/app.db              SQLite（运行时生成）
├── logs/app.log             运行日志（运行时生成）
├── start.bat / start.ps1    一键启动
└── frontend/
    ├── dist/                生产构建产物（由 FastAPI 托管）
    └── src/
        ├── api.ts           REST + SSE 客户端
        ├── types.ts         共享类型
        ├── App.tsx main.tsx 路由与入口
        ├── store/auth.ts    登录态
        ├── pages/           Login / Register / Chat / Admin
        ├── components/      会话列表 / 消息气泡 / Markdown / 输入框 / 模型选择 / 角色弹窗
        └── utils/speech.ts  浏览器录音与 TTS 播放
```

## 启动

一键启动（推荐）：

```powershell
双击 start.bat
```

脚本会检查依赖、校验端口、启动前后端并打开浏览器。

手动启动，后端（终端 1）：

```powershell
cd D:\ALing_project\ai-qa
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --port 8000
```

前端（终端 2）：

```powershell
cd D:\ALing_project\ai-qa\frontend
npm run dev
```

浏览器打开 <http://127.0.0.1:5173>。

前端 `/api` 请求通过 Vite 代理转发到 `127.0.0.1:8000`，开发期不需要处理跨域。

生产模式（FastAPI 单进程托管前端）：

```powershell
cd D:\ALing_project\ai-qa\frontend
npm run build

cd D:\ALing_project\ai-qa
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --port 8000
```

构建产物存在时，FastAPI 会自动托管 `frontend/dist` 并提供 SPA 路由回退。

## 账号

种子管理员来自 `.env`：`admin` / `Admin@123456`（**上线前务必修改**）。
普通用户可在页面上自助注册；管理员登录后左侧栏会出现「管理后台」入口。

## 模型配置

`config/models.yaml`：

```yaml
providers:
  - id: bailian
    name: 阿里云百炼
    enabled: true
    base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
    api_key_env: BAILIAN_API_KEY
    models:
      - id: qwen3.8-max
        name: 通义千问 3.8 Max
        fallback: deepseek-chat      # 这个模型失败时切到谁
        search: true                 # 支持百炼内置联网搜索
```

新增模型只改这个文件，不用动代码。

**前端可选模型**：

| 供应商 | 模型 | 联网 |
|---|---|---|
| 阿里云百炼 | `qwen3.8-flash`（默认） | ✅ |
| DeepSeek | `deepseek-chat` | — |

其余模型（`qwen3.8-max`、`deepseek-v4-pro-0813`、`kimi-k3`、`deepseek-reasoner`）在 `models.yaml` 标了 `hidden: true`：不出现在下拉框，但仍可被已有会话和 fallback 链路使用。

### 联网搜索

默认模型 `qwen3.8-flash` 默认开启百炼内置搜索，问天气、新闻这类实时信息会自动检索：

- 请求体带 `enable_search: true` + `search_options.forced_search: false`，闲聊不搜、实时信息才搜
- 聊天页「联网：开/关」可一键关闭，关闭后不传搜索参数
- 只对 `models.yaml` 里标了 `search: true` 的模型生效；降级到不支持搜索的模型时自动不带参数
- `/api/models` 返回 `supports_search`，下拉框里显示「· 联网」
- 默认模型由 `DEFAULT_MODEL_ID` 控制，前端首次进入优先选中它

### 备用模型（自动降级）

每个模型可以配 `fallback`，写一个或多个都行，**支持跨供应商**：

```yaml
      - id: deepseek-chat
        name: DeepSeek Chat
        fallback:
          - qwen3.8-max
          - qwen3.8-flash
```

触发条件：主模型在**吐出第一个字之前**失败（连不上、超时、429 限流、密钥无效、模型未开通）。系统会自动按链切换，用户无感知，日志里记 `event=model_fallback`。

一旦已经开始输出内容就不再切换——否则一条回答会前后风格不一致。

**为什么需要跨供应商**：同一家厂商限流时，它旗下的其他模型通常也一起限流，用自己兜底没有意义。

## 语音

- 语音输入：Composer 录音 → `/api/voice/asr`（百炼 `qwen3-asr-flash`）
- 语音输出：消息「朗读」/ 自动朗读 → `/api/voice/tts`
- 默认音色只保留 Cherry；角色设定里可用音色提示词生成自定义音色
- 自定义音色走百炼声音设计，绑定 `qwen-audio-3.1-tts-flash`，创建免费、合成按量计费
- 依赖 `BAILIAN_API_KEY`；模型可用 `BAILIAN_TTS_MODEL` / `BAILIAN_ASR_MODEL` / `BAILIAN_DESIGN_TTS_MODEL` 调整

## 验收记录

测试与验收结果保留在 [`docs/需求分析.md`](docs/需求分析.md) 中；对应的一次性测试脚本已移除。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册（返回 token） |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出（撤销当前 token） |
| GET | `/api/auth/me` | 当前用户 |
| PATCH | `/api/auth/password` | 改密码（旧 token 全失效） |
| GET | `/api/system/config` | 公开配置（注册开关、消息长度等） |
| GET | `/api/models` | 可用模型 |
| GET/POST | `/api/conversations` | 会话列表（支持 `q` 搜索）/ 新建 |
| GET/PATCH/DELETE | `/api/conversations/{id}` | 详情 / 改名换模型改人设 / 软删 |
| GET | `/api/conversations/{id}/export` | 导出 Markdown |
| GET | `/api/conversations/{id}/messages` | 消息列表（含 reasoning） |
| POST | `/api/chat/stream` | 流式对话（SSE，`web_search` 默认 `true`） |
| GET/POST | `/api/personas` | 我的角色 / 创建角色 |
| PATCH/DELETE | `/api/personas/{id}` | 更新 / 删除角色 |
| POST | `/api/personas/beautify` | 大模型美化角色提示词 |
| POST | `/api/personas/voice-prompt` | 根据角色生成/美化音色描述 |
| GET | `/api/voice/voices` | 默认音色 + 我的自定义音色 |
| POST | `/api/voice/design` | 用提示词生成自定义音色并试听 |
| POST | `/api/voice/tts` | 文本转语音（WAV） |
| POST | `/api/voice/asr` | 上传音频识别文字 |
| GET | `/api/admin/users` | 用户列表（管理员） |
| PATCH | `/api/admin/users/{id}` | 启用 / 禁用（管理员） |
| POST | `/api/admin/users/{id}/reset-password` | 重置密码（管理员） |
| DELETE | `/api/admin/users/{id}` | 删除用户（管理员） |
| GET | `/api/admin/stats` | 平台统计（管理员） |
| GET | `/api/admin/audit-logs` | 审计日志（管理员） |

SSE 事件：`meta` → `delta`* →（`reasoning`*）→ `usage` → `done`，出错走 `error`。`reasoning` 与 `usage` 都会落库。

## 待办

- [ ] 用量限额（每人每日次数 / token）
- [ ] 火山方舟模型开通后的接入验证
- [ ] 会话标题模型生成
- [ ] 全文检索（SQLite FTS5）
