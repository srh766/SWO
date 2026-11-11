# Smart Work Order

企业智能工单与知识库助手，使用 Spring Boot 实现业务服务，FastAPI 实现 AI 能力，Vue 实现管理与交互界面。

项目目标：员工提交问题或查询知识，处理人员完成工单处理并沉淀知识，AI 基于授权知识提供带引用的回答；无法解决时准备工单，经用户确认后创建。

## 项目状态

目前处于开发阶段，主要精力投入 Java 业务与 FastAPI AI 功能，前端以现有页面的接口联调和必要调整为主。

| 模块 | 当前状态 | 下一步 |
|---|---|---|
| 前端 | 已有页面、API 封装、Mock 与 SSE 解析 | 按模块接入真实接口，完成权限和异常交互验证 |
| Java 后端 | 已有 Maven 三模块骨架和部分公共层 | 建表、认证授权、业务接口、AI 服务对接 |
| FastAPI | 已建目录，文件为占位 | 服务入口、模型适配、索引检索、问答与 Agent 推理 |
| 部署 | 已建目录，配置为占位 | Docker Compose、Nginx、环境模板与部署验证 |

空文件表示待实现内容。前端 Mock 能运行，不代表后端业务或 AI 已实现。

## 技术栈与职责

| 层次 | 技术 | 职责 |
|---|---|---|
| 前端 | Vue 3、TypeScript、Vite、Element Plus、Pinia | 页面、表单、权限展示、SSE 消费 |
| 业务服务 | Java 21、Spring Boot 4.0.9、MyBatis、MySQL 8、Redis 7 | 认证、权限、工单、知识、事务、会话与 AI 调用管理 |
| AI 服务（规划） | Python、FastAPI、Milvus、jieba、BM25 | 内容切分、向量化、混合检索、生成与工具推理 |
| 部署（规划） | Docker Compose、Nginx | 服务启动、反向代理、持久化与健康检查 |

浏览器统一访问 Spring Boot，由 Java 校验身份和数据权限后调用 FastAPI。Python 不直接写业务表、不签发 JWT；模型不能绕过用户确认创建工单。

## 需要实现的功能

| 模块 | 目标功能 |
|---|---|
| 账号与组织 | 登录、退出、改密，用户、部门、固定角色和工单分类管理，三角色权限与数据范围控制 |
| 工单闭环 | 创建、筛选、详情、领取、指派、解决、关闭、重开、评论、操作日志和逻辑删除 |
| 知识管理 | 文章与 TXT/Markdown 文档维护、审核发布、驳回撤回、受控下载、工单转知识草稿 |
| 知识问答 | 已发布知识索引、向量与关键词混合检索、流式回答、来源引用、多轮问答、停止生成和会话历史 |
| 工单 AI 辅助 | 分类与优先级建议、工单摘要、回复草稿、相似知识及工单推荐 |
| Agent 助手 | 查询授权工单与知识、准备建单参数、用户确认建单、取消及防重复执行 |
| 运行与交付 | 工单统计、AI 调用与反馈统计、缓存限流、异常降级、部署及演示验收 |

接口范围为 **77 个对外接口、10 个内部接口**，具体字段与约束见 [API 文档](api.md)。

## 三人分工

A、B、C 为角色代称，可按团队成员能力分配。每人负责自己模块从接口实现到测试和联调的完整交付。

| 成员 | 主责 | 主要交付 |
|---|---|---|
| A：Java 基础与工单 | 公共层、认证授权、工单主链路、业务统计 | 三角色登录与越权拦截；完整工单闭环；工单统计；后期负责 Java AI 客户端、会话消息、SSE 转发、停止生成与运行控制 |
| B：Java 管理与知识 | 数据库结构、用户/部门/分类管理、文章与文档、审核和知识沉淀 | 建表与开发数据；管理接口；知识维护和审核闭环；文件存储与下载；后期负责 Java 索引任务、内部知识源接口、工单 AI 辅助入口与 Agent 确认执行 |
| C：FastAPI 与 AI | 模型调用、索引检索、RAG 问答、Agent 推理、部署 | FastAPI 服务；知识入库与混合检索；带引用的流式问答；工单辅助生成；受限工具推理；评测样本、Compose 与 Nginx 部署 |

### 协作边界

- **A 维护公共层与认证约定**：统一响应、异常、上下文、JSON 序列化、权限拦截。B 使用这些能力实现各业务的数据范围校验。
- **B 统筹数据库脚本**：各模块负责人提交自己的表结构需求与变更，统一更新建表和开发数据脚本；每人使用本地数据库。
- **Java 与 Python 先定内部契约**：身份与范围由 Java 生成，模型上下文由 Java 授权；C 负责检索和生成，A/B 负责业务校验及持久化。
- **Agent 由 Java 编排和执行工具**：C 提供推理结果，B 保存待确认操作并在确认后调用工单服务，A 提供认证和工单创建能力。
- **前端按模块分担联调**：A 对接账号与工单，B 对接管理与知识，C 联合 A/B 验证问答、辅助建议和 Agent 页面。暂不投入大规模页面重做。
- **共享配置改动提前同步**：涉及公共类型、依赖、接口字段或数据库结构时，在合入前通知其他成员。

### 推进顺序

| 阶段 | A | B | C | 验收目标 |
|---|---|---|---|---|
| 1. 统一基础 | 公共层、认证与权限 | 建表、开发数据、管理基础 | FastAPI 骨架、模型连通、开发环境 | 前端可演示，Java 基础可用，AI 调用链可验证 |
| 2. 完成业务 | 工单闭环与统计 | 知识、文档、审核与沉淀 | 用测试语料开发索引、检索和问答 | 关闭 AI 后仍可完整演示业务 |
| 3. 接入 AI | 会话、SSE、停止生成 | 索引任务、知识源、辅助入口 | 授权检索、引用、多轮及辅助生成 | 问答有依据、引用可访问、权限不越界 |
| 4. 完成交付 | 缓存限流、调用记录、回归 | Agent 确认、反馈统计配合、业务回归 | Agent 推理、评测、部署 | 三人从干净环境部署并走通完整演示 |

C 从第一阶段就开始 AI 开发，使用测试语料和约定请求结构与 Java 并行推进。具体逐日任务见 [执行计划](plan/plan.md)。

## 目录

```text
.
├── README.md
├── api.md                       # 接口契约
├── plan/                        # 执行计划
└── SmartWorkOrder/
    ├── frontend/                # Vue 页面与 Mock
    ├── backend/
    │   ├── swo-common/          # 公共结果、异常、上下文等
    │   ├── swo-pojo/            # Entity、DTO、VO
    │   └── swo-server/          # Controller、Service、Mapper
    ├── ai-service/              # FastAPI 与 AI 能力
    ├── deploy/                  # 容器与代理配置
    └── docs/                    # 后续验收、部署、评测材料
```

## 本地开发

以下命令从仓库根目录执行，使用 PowerShell。基础环境为 JDK 21、Maven 3.9+、Node.js 20.19+（或兼容的 22.12+）、MySQL 8 和 Redis 7；AI 开发按计划使用 Python 3.11/3.12、Milvus 2.4.x。

### 前端 Mock 演示

```powershell
cd SmartWorkOrder/frontend
npm ci
npm run dev
```

打开终端显示的本地地址，默认端口为 5173。开发配置默认 `VITE_DEMO=true`，无需启动后端。

| Mock 角色 | 用户名 | 密码 |
|---|---|---|
| 员工 | employee | Demo123! |
| 处理人员 | handler | Demo123! |
| 管理员 | admin | Demo123! |

以上仅为前端演示账号，真实后端账号待开发数据初始化后确认。联调时在前端目录创建被 Git 忽略的 `.env.development.local`，设置 `VITE_DEMO=false`，必要时覆盖 `API_TARGET`，然后重启开发服务器。

### Java 编译与启动

先在本地 MySQL 创建数据库：

```sql
CREATE DATABASE swo DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

在新的 PowerShell 窗口中，从仓库根目录执行：

```powershell
$env:DB_USERNAME="你的数据库用户名"
$env:DB_PASSWORD="你的数据库密码"
# Redis 默认连接 127.0.0.1:6379；启用密码时另设 REDIS_PASSWORD
cd SmartWorkOrder/backend
mvn -DskipTests install
mvn -f swo-server/pom.xml spring-boot:run
```

后端默认端口 8080。当前建表与种子数据脚本为空，启动只用于基础服务开发，业务功能需随阶段补齐；配置中的 `spring.sql.init.mode=never`，后续建表脚本需按约定显式执行。

常用环境变量：`DB_URL`、`DB_USERNAME`、`DB_PASSWORD`、`REDIS_HOST`、`REDIS_PORT`、`REDIS_PASSWORD`、`JWT_SECRET`、`AI_BASE_URL`、`AI_INTERNAL_TOKEN`。数据库默认连接本地 `swo`，AI 地址默认 `http://127.0.0.1:8000`。

真实密码、模型密钥和个人配置通过环境变量注入，不提交仓库。JWT 与内部令牌的默认值仅供开发，部署时必须替换；Java 的 AI_INTERNAL_TOKEN 与 Python 内部认证值须一致。Spring Boot 默认不会自动读取项目中的 `.env` 文件。

### AI 与部署

目前 FastAPI 入口、依赖清单和 Compose 配置均为空，尚无可用启动流程。由 C 先补齐依赖、入口、健康检查及环境模板，再提供经验证的启动命令。Milvus standalone 需要配套 etcd 与 MinIO；部署时内部接口只在服务网络开放，Nginx 为 SSE 关闭缓冲。

## 验证与协作

前端检查在前端目录执行：

```powershell
npm run typecheck
npm test
npm run build
```

后端检查在 backend 目录执行 `mvn test`。现有基础设施测试连接真实 MySQL/Redis，运行前准备数据库、凭据和 Redis；AI 测试与端到端验收随功能补齐。

团队使用同一远程仓库，`main` 保持可运行，每项任务从最新主分支创建 `feature/功能名`，通过 Pull Request 或 Merge Request 检查后合入。提交前检查变更，只包含本任务文件；不要提交密钥、依赖目录、构建产物和个人 IDE 配置。

接口调整同步 [api.md](api.md)，表结构调整同步数据库脚本，验收以真实接口和角色账号走通业务为准。每个阶段至少验证正常流程、越权访问、状态/版本冲突和 AI 不可用时的降级行为。
