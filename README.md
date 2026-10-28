# AI 问答平台

多用户 AI 对话平台：注册登录、多模型切换、流式输出、会话历史、用户隔离、管理员后台。

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Python 3.10 · FastAPI · SQLAlchemy 2.0 · SQLite |
| 前端 | React 19 · Vite 8 · TypeScript · Tailwind CSS 4 |
| 模型 | OpenAI 兼容协议（DeepSeek 可用，火山方舟待开通） |

## 目录

```
ai-qa/
├── backend 部分就在根目录
│   ├── app/
│   │   ├── main.py          应用入口
│   │   ├── config.py        配置（读 .env）
│   │   ├── db.py            引擎 / 会话 / UTCDateTime
│   │   ├── models.py        User / Conversation / Message
│   │   ├── schemas.py       请求响应模型
│   │   ├── security.py      bcrypt + JWT
│   │   ├── deps.py          鉴权 / 管理员 / 会话归属
│   │   ├── errors.py        统一错误码
│   │   ├── logging_config.py 结构化日志
│   │   ├── bootstrap.py     种子管理员
│   │   ├── audit.py         审计日志写入
│   │   ├── providers/       模型适配层
│   │   └── routers/         auth / conversations / models / chat / admin / system
│   ├── config/models.yaml   模型清单（加模型只改这里）
│   ├── data/app.db          SQLite
│   ├── logs/app.log
│   └── start.bat / start.ps1 一键启动
└── frontend/
    ├── dist/               生产构建产物（由 FastAPI 托管）
    └── src/
        ├── api.ts           REST + SSE 客户端
        ├── store/auth.ts    登录态
        ├── pages/           Login / Register / Chat / Admin
        └── components/      会话列表 / 消息气泡 / 输入框 / 模型选择 / 人设弹窗
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
```

新增模型只改这个文件，不用动代码。

**当前可用**：

| 供应商 | 模型 | 状态 |
|---|---|---|
| DeepSeek | `deepseek-chat`、`deepseek-reasoner` | ✅ |
| 阿里云百炼 | `qwen3.8-max`、`qwen3.8-flash`、`deepseek-v4-pro-0813`、`kimi-k3` | ✅ |
| 火山方舟 | 豆包系列 | ⚠️ key 有效但模型未开通 |

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
| POST | `/api/chat/stream` | 流式对话（SSE） |
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
