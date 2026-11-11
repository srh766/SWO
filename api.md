# 企业智能工单与知识库助手 API 接口文档

> 版本 2.0 · 77 个对外接口、10 个内部接口。接口契约已对齐 [执行计划](plan/plan.md#L1625)，实现情况以代码和真实联调为准。

- [通用约定](#1-通用约定)
- [枚举与数据结构](#2-枚举与数据结构)
- [对外接口](#3-对外接口)
- [内部接口](#4-内部接口)
- [SSE](#5-sse)

## 1. 通用约定

### 1.1 请求、响应与认证

- 对外路径以 `/api` 开头；除登录外携带 `Authorization: Bearer <accessToken>`。JWT 只存前端运行时内存，不放 URL，刷新后重新登录。
- JSON 请求使用 `Content-Type: application/json`；GET/DELETE 不使用 body，DELETE 的 `version/reason` 放 query，文本须 URL 编码。
- 普通响应为 `{ code, message, data }`：成功 `code=0`，失败 `code=HTTP 状态码、data=null`；参数校验可带 `errors: {field,message}[]`。文件流和 SSE 不套此外壳。
- 创建成功 201，普通操作 200，接受索引重建 202；各接口成功响应列只写 `data` 类型。
- 所有 ID 为字符串，数据库 BIGINT ID 序列化为十进制字符串；`requestId` 为 UUID。时间为带时区的 ISO 8601，存储使用 UTC。
- `?` 表示可省略，`T | null` 表示字段存在但允许空值；数组为空用 `[]`，无关联用 `null`。数量、字节数、token 为非负整数，比率为 `0..1` 或 `null`。
- 分页默认 `page=1、pageSize=20`，均为正整数；单页上限建议 100，超限处理实现时统一。`startAt` 包含、`endAt` 不包含，同时传须满足前者小于后者。
- 修改操作发送最近读取的 `version`，冲突 409。知识仅一个 `version`，兼作乐观锁和索引内容版本；`IndexStatus.contentVersion` 是建索引时的版本，重建请求须等于知识当前版本。
- `requestId` 绑定当前用户及操作，重试复用，主动新操作更换；创建工单、工单转知识、Agent 确认须幂等。生成请求重试关联原状态，不能重复生成或计费。
- 角色、身份、归属和检索范围由 Java 校验；筛选参数、前端按钮和模型工具参数均不能扩大权限。失败保留输入，不自动重试写操作。

### 1.2 错误码

| HTTP / code | 场景 |
|---:|---|
| 400 | 参数缺失、格式错误、业务校验失败；字段错误可带 errors |
| 401 | 未登录、密码错误、令牌失效、账号停用或已退出；重新登录 |
| 403 | 权限或数据范围不足 |
| 404 | 资源不存在或不可见 |
| 409 | 版本、状态、重复资源或业务约束冲突；刷新后决定是否提交 |
| 422 | AI 返回非法分类或优先级；改为手动选择 |
| 429 | AI 限流；按 Retry-After 提示 |
| 500 | 未预期服务异常 |
| 503 | AI/模型不可用；普通提单与业务处理继续 |

```json
{"code":409,"message":"工单已被其他人处理，请刷新后重试","data":null}
```

### 1.3 权限与状态

- 员工查看本人提交的工单；处理人员查看本部门、本人负责的跨部门及本人提交工单；管理员查看全部。关闭和重开始终只允许提交人。
- 知识维护者为处理人员和管理员；处理人员仅维护本部门，员工只读授权已发布知识。PUBLIC 表示全部已登录用户，DEPARTMENT 表示归属部门；管理员可维护全部知识，但新建知识归属仍取本人部门。
- 会话、消息反馈和 Agent 操作仅所有者可访问；AI 统计仅管理员可访问。具体权限标识见第 2 章和接口表。

| 操作 | 前置状态 | 结果与限制 |
|---|---|---|
| 创建 | 无 | 待处理；提交人取当前用户，初始处理部门取分类路由 |
| 领取 | 待处理、未指派 | 处理中；本部门处理人员领取给自己 |
| 指派 | 待处理或处理中 | 处理中；管理员指定启用的目标部门及处理人员，并记录原因 |
| 解决 | 处理中 | 已解决；当前处理人或管理员提交解决方案 |
| 关闭 | 已解决 | 已关闭；仅工单提交人确认 |
| 重新打开 | 已解决 | 待处理；仅提交人说明未解决原因，清空当前指派，保留历史 |
| 逻辑删除 | 已关闭 | 仅管理员；保留业务记录与操作日志 |

知识文章与文档共用 `DRAFT`（草稿）、`PENDING_REVIEW`（待审核）、`PUBLISHED`（已发布）状态；驳回、撤回后返回草稿。

已发布内容不得直接改正文、文件或可见范围，须先撤回再编辑、提交审核。撤回和删除立即从授权检索集合中排除，异步清理旧索引。初期保留全局唯一内容版本，发布后索引必须匹配当前版本。

### 1.4 文件与索引

- multipart 使用 FormData，由客户端生成 boundary；file 为单文件部分，title/scope/version 为文本部分。仅 TXT/Markdown，业务强制不超过 10 MiB（10,485,760 字节），Spring 接收上限 12 MB；校验扩展名和实际文本，存储名由服务端生成。
- 下载返回 `Content-Type`（TXT 为 `text/plain; charset=utf-8`，Markdown 为 `text/markdown; charset=utf-8`）及 `Content-Disposition: attachment; filename*=UTF-8''<编码文件名>`。认证后读 Blob，先处理错误 JSON，不返回磁盘路径或含 JWT 的下载 URL；文档正文通过此下载接口获取。
- 正文、文件及范围仅草稿可改，待审核或已发布内容须先撤回。批准意见可省略，驳回/撤回原因必填；管理员允许审核自己维护的内容并留痕。
- 发布与索引状态独立，202 只表示接受。任务在 Java/MySQL 持久化，同内容同版本去重；撤回/删除立即排除授权检索，异步清理旧索引。无索引为 NOT_INDEXED，失败使用 errorSummary/retryCount 展示并重建。

## 2. 枚举与数据结构

以下类型用于定义 JSON 字段；接口响应引用这些结构，列表投影与详情字段不混用。

```ts
type Id = string; // 数据库 BIGINT 自增 ID 序列化为十进制字符串
type DateTime = string; // 带时区 ISO 8601
type Version = number; // 非负整数
type RequestId = string; // UUID

type ApiResponse<T> = {
  code: number;
  message: string;
  data: T;
};
type ApiError = {
  code: number;
  message: string;
  data: null;
  errors?: { field: string; message: string }[];
};
type Page<T> = {
  records: T[];
  total: number;
  page: number;
  pageSize: number;
};
type PageQuery = { page?: number; pageSize?: number };
type TimeQuery = { startAt?: DateTime; endAt?: DateTime };
```

### 2.1 枚举与权限标识

枚举字段仅接受下列值。`Role.code` 使用角色枚举，`Role.id` 仍为独立的字符串 ID。

```ts
type RoleCode = 'EMPLOYEE' | 'HANDLER' | 'ADMIN';
type EnableStatus = 'ENABLED' | 'DISABLED';
type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
type TicketStatus = 'PENDING' | 'PROCESSING' | 'RESOLVED' | 'CLOSED';
type TicketView = 'mine' | 'pending' | 'assigned' | 'all';
type KnowledgeScope = 'PUBLIC' | 'DEPARTMENT';
type KnowledgeStatus = 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED';
type DocumentFormat = 'TXT' | 'MARKDOWN';
type IndexState = 'NOT_INDEXED' | 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
type ChatType = 'KNOWLEDGE' | 'AGENT';
type MessageRole = 'USER' | 'ASSISTANT';
type MessageStatus = 'PENDING' | 'GENERATING' | 'COMPLETED' | 'STOPPED' | 'INTERRUPTED' | 'FAILED';
type ToolName = 'search_tickets' | 'search_knowledge' | 'prepare_ticket';
type ToolState = 'RUNNING' | 'COMPLETED' | 'FAILED';
type ActionType = 'CREATE_TICKET';
type ActionState = 'PENDING' | 'EXECUTING' | 'EXECUTED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
type Satisfaction = 'SATISFIED' | 'DISSATISFIED';
type RecommendationType = 'ARTICLE' | 'DOCUMENT' | 'TICKET';
type ReferenceType = 'ARTICLE' | 'DOCUMENT';
type AiCapability = 'KNOWLEDGE_CHAT' | 'AGENT' | 'TICKET_SUGGESTIONS'
  | 'TICKET_SUMMARY' | 'TICKET_DRAFT' | 'SIMILAR_SEARCH' | 'INDEX';
type AiResult = 'SUCCESS' | 'FAILED';
type Permission = 'ticket:create' | 'ticket:read' | 'ticket:handle'
  | 'ticket:assign' | 'ticket:delete' | 'knowledge:read'
  | 'knowledge:maintain' | 'knowledge:review' | 'user:manage'
  | 'system:manage' | 'stats:ai' | 'chat:use';
```

权限标识集合及固定角色的基准分配如下，权限字段的 JSON 表示仍为字符串数组。`system:manage` 用于部门、分类与固定角色的管理页面，`chat:use` 覆盖本人知识问答和 Agent；不是新增 API 或动态权限设计器。

| `Role.code` | `permissions` 基准集合 |
|---|---|
| `EMPLOYEE` | `ticket:create`、`ticket:read`、`knowledge:read`、`chat:use` |
| `HANDLER` | `ticket:create`、`ticket:read`、`ticket:handle`、`knowledge:read`、`knowledge:maintain`、`chat:use` |
| `ADMIN` | `ticket:create`、`ticket:read`、`ticket:handle`、`ticket:assign`、`ticket:delete`、`knowledge:read`、`knowledge:maintain`、`knowledge:review`、`user:manage`、`system:manage`、`stats:ai`、`chat:use` |

用户实际权限由服务端结合当前启用状态和角色计算。操作还须满足部门、资源归属和状态约束；例如管理员也只有在自己是提交人时才能关闭、重开工单，不能仅凭权限标识绕过该限制。

### 2.2 共享实体结构

以下给出所有被逐接口表引用的完整字段。`Person` 是 `{id,name}` 轻量关联结构，亦用于分类和部门的轻量关联。

#### 账号、部门与分类

```ts
type Person = { id: Id; name: string };
type Department = {
  id: Id;
  name: string;
  code: string;
  status: EnableStatus;
  version: Version;
};
type Role = {
  id: Id;
  code: RoleCode;
  name: string;
  description: string;
  permissions: Permission[];
};
type User = {
  id: Id;
  username: string;
  name: string;
  department: Department | null;
  roles: Role[];
  status: EnableStatus;
  version: Version;
  permissions: Permission[];
};
type Category = {
  id: Id;
  name: string;
  code: string;
  description: string;
  defaultDepartment?: Person | null;
  status: EnableStatus;
  version: Version;
};
type LoginResult = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: DateTime;
  user: User;
};
```

`permissions` 在当前前端 `User` 类型中为必填，因此所有返回 `User` 的接口均带该数组；`GET /api/auth/me` 返回当前用户实际权限。密码、密码哈希与凭据不属于 `User` 字段。

`User.department` 可为 `null`，页面按未分配部门处理。`Category.defaultDepartment` 为条件字段：管理员响应包含该字段（可为 `null`），非管理员响应省略。前端类型按这些字段规则消费响应；真实后端仍须遵循相同契约。

#### 工单、评论、日志与推荐

```ts
type TicketSummary = {
  id: Id;
  number: string;
  title: string;
  category: Person;
  priority: Priority;
  status: TicketStatus;
  requester: Person;
  department: Person;
  assignee: Person | null;
  createdAt: DateTime;
  updatedAt: DateTime;
  version: Version;
};
type TicketDetail = TicketSummary & {
  description: string;
  solution: string | null;
  resolvedAt: DateTime | null;
  closedAt: DateTime | null;
};
type Comment = {
  id: Id;
  content: string;
  author: Person;
  createdAt: DateTime;
};
type TicketLog = {
  id: Id;
  action: string;
  operator: Person;
  createdAt: DateTime;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus | null;
  reason: string | null;
  description: string;
};
type Recommendation = {
  type: RecommendationType;
  id: Id;
  title: string;
  excerpt: string;
  reason: string;
};
type TicketCreated = {
  id: Id;
  number: string;
  status: TicketStatus;
  version: Version;
};
```

`TicketDetail` 对应前端完整的 `Ticket`；列表按批准方案返回 `TicketSummary` 投影，不保证含详情正文、方案和时间字段，消费者须按列表投影处理。`TicketLog.action` 为业务动作字符串，`description` 为服务端生成的纯文本说明，不是 HTML；动作具体编码在后端实现时统一，不在此擅自扩展枚举。推荐只通过 `type/id` 打开既有授权资源，不提供可直接信任的外部 URL。

#### 知识、审核与索引

```ts
type Review = {
  reviewer: Person | null;
  comment: string | null;
  reviewedAt: DateTime | null;
};
type ArticleSummary = {
  id: Id;
  title: string;
  scope: KnowledgeScope;
  department: Person;
  status: KnowledgeStatus;
  author: Person;
  createdAt: DateTime;
  updatedAt: DateTime;
  publishedAt: DateTime | null;
  version: Version;
};
type ArticleDetail = ArticleSummary & {
  content: string;
  sourceTicket: { id: Id; number: string } | null;
  review: Review | null;
};
type DocumentInfo = {
  id: Id;
  title: string;
  fileName: string;
  format: DocumentFormat;
  sizeBytes: number;
  scope: KnowledgeScope;
  department: Person;
  status: KnowledgeStatus;
  author: Person;
  createdAt: DateTime;
  updatedAt: DateTime;
  publishedAt: DateTime | null;
  version: Version;
  review: Review | null;
};
type IndexStatus = {
  contentVersion: Version;
  status: IndexState;
  taskId: Id | null;
  retryCount: number;
  errorSummary: string | null;
  updatedAt: DateTime | null;
};
type IndexAccepted = { taskId: Id; status: 'PENDING' };
```

`ArticleDetail` 对应前端 `Article`，文章列表使用 `ArticleSummary` 投影。`DocumentInfo` 完整展开了前端由文章类型派生的字段，不含 `content`、`sourceTicket`，不返回磁盘路径；其列表和详情均用此结构。新建知识的归属部门由服务端取当前用户部门，本次不扩展管理员跨部门新建能力。`PUBLIC` 指所有已登录用户，`DEPARTMENT` 指归属部门，不允许随意指定分享部门。

#### 会话、消息、引用、反馈与 Agent

```ts
type Chat = {
  id: Id;
  title: string;
  type: ChatType;
  version: Version;
  createdAt: DateTime;
  updatedAt: DateTime;
  generation: { messageId: Id; status: MessageStatus } | null;
};
type Reference = {
  id: Id;
  type: ReferenceType;
  sourceId: Id;
  title: string;
  contentVersion: Version;
  excerpt: string | null;
  available: boolean;
};
type Feedback = {
  satisfaction: Satisfaction | null;
  resolved: boolean | null;
  reason: string | null;
};
type ToolResult = {
  id: Id;
  name: ToolName;
  status: ToolState;
  summary: string;
  results: Recommendation[];
};
type Message = {
  id: Id;
  chatId: Id;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  references: Reference[];
  toolResults: ToolResult[];
  actionIds: Id[];
  feedback: Feedback | null;
  createdAt: DateTime;
};
type AgentAction = {
  id: Id;
  chatId: Id;
  type: ActionType;
  parameters: {
    title: string;
    description: string;
    categoryId: Id;
    categoryName: string;
    priority: Priority;
  };
  status: ActionState;
  expiresAt: DateTime;
  ticket: { id: Id; number: string } | null;
  errorSummary: string | null;
};
type StopResult = { messageId: Id; status: MessageStatus };
```

`Reference.id` 标识引用，`sourceId` 标识来源资源，不能混用。失效来源返回 `available=false`、`excerpt=null`，不经历史响应泄露旧片段；详情和下载仍重新校验权限。`Feedback` 的 `null` 表示未选择，`resolved=false` 表示明确未解决，二者不同。`ToolResult.summary` 只描述工具执行结果，不暴露模型内部思维。`AgentAction.parameters` 是服务端已校验的规范化参数，前端确认时不能回传修改后的参数；`status=EXECUTED` 时 `ticket` 非空，尚无执行结果时为 `null`。

#### 统计与调用明细

```ts
type TicketStats = {
  total: number;
  statusDistribution: { status: TicketStatus; count: number }[];
  categoryDistribution: { categoryId: Id; categoryName: string; count: number }[];
  averageResolutionSeconds: number | null;
};
type AiStats = {
  callCount: number;
  successCount: number;
  successRate: number | null;
  averageDurationMs: number | null;
  knownInputTokens: number | null;
  knownOutputTokens: number | null;
  unknownUsageCallCount: number;
  cacheHits: number;
  cacheEligibleRequests: number;
  cacheHitRate: number | null;
  feedbackCount: number;
  answerCount: number;
  resolvedFeedbackCount: number;
  unresolvedFeedbackCount: number;
  selfServiceResolutionRate: number | null;
  feedbackCoverageRate: number | null;
};
type AiCall = {
  id: Id;
  capability: AiCapability;
  chatId: Id | null;
  ticketId: Id | null;
  model: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  result: AiResult;
  errorSummary: string | null;
  createdAt: DateTime;
};
```

平均处理时长单位为秒：只统计当前已解决或已关闭工单，从创建到最近一次标记已解决的时长平均值；重新打开尚未解决者不计，没有样本为 `null`。`durationMs`、`averageDurationMs` 单位为毫秒，无调用样本的平均耗时为 `null`。

比率分母为零时一律 `null`，有分母但分子为零才是 `0`：`successRate=successCount/callCount`，`cacheHitRate=cacheHits/cacheEligibleRequests`，`selfServiceResolutionRate=resolvedFeedbackCount/(resolvedFeedbackCount+unresolvedFeedbackCount)`，`feedbackCoverageRate=feedbackCount/answerCount`。`feedbackCount` 为有当前反馈的回答数，同一回答修改反馈不重复计数；`resolvedFeedbackCount`、`unresolvedFeedbackCount` 分别只计 `resolved=true/false`，未选择不进入自助解决率分母。`answerCount` 为统计范围内回答数，不能把“未提工单”算作已解决。

`inputTokens/outputTokens=null` 表示供应商未提供该用量；已知 token 小计仅累计已知部分，没有可知输入或输出用量时相应小计为 `null`，明确返回零才可计零。`unknownUsageCallCount` 同时标明用量不完整的调用数，展示小计时不得宣称全部用量已知。统计与明细不返回完整提示词、私密正文、模型密钥或未经确认的费用字段。

## 3. 对外接口

权限和状态同时校验。路径中的 ID 均为 `Id`；请求未注明的位置不得自定身份或范围。通用错误见 1.2，仅在约束中补充特有情形。

### 登录与个人账号

| 编号 / 名称 | 方法与路径 | 权限 / 范围 | 请求 | HTTP / data | 关键约束 |
|---|---|---|---|---|---|
| A01 登录 | `POST /api/auth/login` | 未登录可用；公开 | JSON `{ username: string; password: string }` | 200；`LoginResult` | 账号须启用，密码校验失败不得返回密码或哈希；本项目不开放注册。 |
| A02 当前用户 | `GET /api/auth/me` | 登录用户；登录 | 无 | 200；`User`（当前用户及实际权限） | 返回用户、部门、角色和权限标识。 |
| A03 退出登录 | `POST /api/auth/logout` | 登录用户；登录 | 无 | 200；`null` | 将当前 JWT 的 jti 写入 Redis 黑名单，失效时间与令牌剩余有效期一致。 |
| A04 修改本人密码 | `PUT /api/auth/password` | 登录用户；登录 | JSON `{ oldPassword: string; newPassword: string }` | 200；`null`；本人现有令牌失效，重新登录 | 校验旧密码后递增 token_version，使本人全部旧令牌失效，成功后重新登录。 |

### 用户管理

| 编号 / 名称 | 方法与路径 | 权限 / 范围 | 请求 | HTTP / data | 关键约束 |
|---|---|---|---|---|---|
| U01 用户分页查询 | `GET /api/users` | 管理员；`user:manage` | query `PageQuery & { username?: string; name?: string; departmentId?: Id; roleId?: Id; status?: EnableStatus }` | 200；`Page<User>` | 用户名、姓名、部门、角色、状态；也用于筛选处理人员。 |
| U02 用户详情 | `GET /api/users/{id}` | 管理员；`user:manage` | 无 body | 200；`User` | 返回资料、部门、角色；不返回密码哈希。 |
| U03 创建用户 | `POST /api/users` | 管理员；`user:manage` | JSON `{ username: string; name: string; departmentId: Id; password: string; roleIds: Id[] }` | 201；`User` | 用户名唯一，部门启用，角色集合非空且有效；用户与角色关系在同一事务保存。 |
| U04 修改用户资料 | `PATCH /api/users/{id}` | 管理员；`user:manage` | JSON `{ name: string; departmentId: Id; version: Version }` | 200；`User` | 只改姓名和部门；有未完成指派时禁止调部门。 |
| U05 启用或禁用用户 | `PUT /api/users/{id}/status` | 管理员；`user:manage` | JSON `{ status: EnableStatus; version: Version }` | 200；`User` | 停用立即使已有凭据失效；有未完成指派或属于最后一个启用管理员时禁止停用。 |
| U06 分配角色 | `PUT /api/users/{id}/roles` | 管理员；`user:manage` | JSON `{ roleIds: Id[]; version: Version }` | 200；`User` | roleIds 为角色 ID；替换角色集合并及时生效，不能移除最后一个可用管理员。 |
| U07 重置用户密码 | `PUT /api/users/{id}/password` | 管理员；`user:manage` | JSON `{ newPassword: string }` | 200；`null`；目标用户旧令牌失效 | 重置密码使目标用户全部旧令牌失效；操作日志不记录密码。 |

### 部门管理

| 编号 / 名称 | 方法与路径 | 权限 / 范围 | 请求 | HTTP / data | 关键约束 |
|---|---|---|---|---|---|
| D01 查询部门 | `GET /api/departments` | 管理员；`system:manage` | query `{ name?: string; status?: EnableStatus }` | 200；`Department[]`，不分页 | 返回部门列表，支持名称与状态筛选；首月使用平级部门。 |
| D02 创建部门 | `POST /api/departments` | 管理员；`system:manage` | JSON `{ name: string; code: string }` | 201；`Department` | 名称、编码；编码唯一。 |
| D03 修改部门 | `PATCH /api/departments/{id}` | 管理员；`system:manage` | JSON `{ name: string; version: Version }` | 200；`Department` | 名称、版本。 |
| D04 启用或停用部门 | `PUT /api/departments/{id}/status` | 管理员；`system:manage` | JSON `{ status: EnableStatus; version: Version }` | 200；`Department` | 存在启用用户、启用分类或未完成工单时禁止停用。 |

### 角色权限

| 编号 / 名称 | 方法与路径 | 权限 / 范围 | 请求 | HTTP / data | 关键约束 |
|---|---|---|---|---|---|
| R01 查询固定角色 | `GET /api/roles` | 管理员；`user:manage` | 无 | 200；`Role[]`，固定角色及权限说明 | 返回员工、处理人员、管理员及对应权限说明。 |

### 工单分类

| 编号 / 名称 | 方法与路径 | 权限 / 范围 | 请求 | HTTP / data | 关键约束 |
|---|---|---|---|---|---|
| C01 查询分类 | `GET /api/ticket-categories` | 登录用户；`ticket:create` | query `{ name?: string; status?: EnableStatus }` | 200；`Category[]`；非管理员不含 `defaultDepartment` | 非管理员仅返回启用项并省略 defaultDepartment，筛选参数不能扩大可见范围。 |
| C02 创建分类 | `POST /api/ticket-categories` | 管理员；`system:manage` | JSON `{ name: string; code: string; defaultDepartmentId: Id; description: string }` | 201；`Category`，含管理路由字段 | 名称、编码、默认处理部门、说明。 |
| C03 修改分类 | `PATCH /api/ticket-categories/{id}` | 管理员；`system:manage` | JSON `{ name: string; description: string; defaultDepartmentId: Id; version: Version }` | 200；`Category`，含管理路由字段 | 分类路由变更只影响后续新工单，历史工单通过指派调整。 |
| C04 启用或停用分类 | `PUT /api/ticket-categories/{id}/status` | 管理员；`system:manage` | JSON `{ status: EnableStatus; version: Version }` | 200；`Category`，含管理路由字段 | 状态、版本；停用不改变历史工单。 |

### 工单业务

| 编号 / 名称 | 方法与路径 | 权限 / 范围 | 请求 | HTTP / data | 关键约束 |
|---|---|---|---|---|---|
| T01 创建工单 | `POST /api/tickets` | 登录用户；`ticket:create` | JSON `{ title: string; description: string; categoryId: Id; priority: Priority; requestId: RequestId }` | 201；`TicketCreated`，新建时 `status='PENDING'` | 提交人取当前用户，处理部门取启用分类路由；不接受客户端自定提交人或处理人。以 ticket(requester_id, request_id) 唯一约束实现幂等，重试返回原工单。 |
| T02 工单分页与工作台 | `GET /api/tickets` | 登录用户，按范围；`ticket:read` | query `PageQuery & TimeQuery & { view?: TicketView; keyword?: string; status?: TicketStatus; categoryId?: Id }`；view 默认 mine | 200；`Page<TicketSummary>` | view 可省略，默认 mine；all 仅管理员可用。mine/pending/assigned 仍受当前用户数据范围限制。 |
| T03 工单详情 | `GET /api/tickets/{id}` | 有权查看该工单者；`ticket:read` | 无 body | 200；`TicketDetail` | 返回提交人、处理部门、处理人、状态、解决方案、版本。 |
| T04 领取工单 | `POST /api/tickets/{id}/claim` | 本部门处理人员；`ticket:handle` | JSON `{ version: Version }` | 200；`TicketDetail` | 仅本部门处理人员领取 PENDING 且未指派工单；乐观锁保证竞争领取只有一次成功。 |
| T05 分配或转派 | `POST /api/tickets/{id}/assign` | 管理员；`ticket:assign` | JSON `{ departmentId: Id; assigneeId: Id; reason: string; version: Version }` | 200；`TicketDetail` | 仅待处理或处理中工单可指派；目标部门与人员启用，人员属于目标部门且具备处理角色。 |
| T06 标记已解决 | `POST /api/tickets/{id}/resolve` | 当前处理人或管理员；`ticket:handle` | JSON `{ solution: string; version: Version }` | 200；`TicketDetail` | 仅 PROCESSING，当前处理人或管理员操作；保存解决方案、解决时间及日志。 |
| T07 确认关闭 | `POST /api/tickets/{id}/close` | 工单提交人；`ticket:read` + 提交人 | JSON `{ version: Version }` | 200；`TicketDetail` | 仅提交人确认 RESOLVED 工单，管理员身份不能绕过提交人限制。 |
| T08 重新打开 | `POST /api/tickets/{id}/reopen` | 工单提交人；`ticket:read` + 提交人 | JSON `{ reason: string; version: Version }` | 200；`TicketDetail`，待处理且 `assignee=null` | 仅提交人重开 RESOLVED 工单；退回 PENDING，清空指派并保留历史，CLOSED 不可重开。 |
| T09 评论列表 | `GET /api/tickets/{id}/comments` | 有权查看该工单者；`ticket:read` | query `PageQuery` | 200；`Page<Comment>` | 评论按时间正序返回；必须先校验工单可见范围。 |
| T10 添加评论 | `POST /api/tickets/{id}/comments` | 提交人、当前处理人或管理员；`ticket:read` | JSON `{ content: string }` | 201；`Comment` | 仅提交人、当前处理人或管理员评论；已关闭工单只读。 |
| T11 操作时间线 | `GET /api/tickets/{id}/logs` | 有权查看该工单者；`ticket:read` | 无 body | 200；`TicketLog[]`，按时间升序 | 不分页，按时间正序返回操作记录。 |
| T12 逻辑删除工单 | `DELETE /api/tickets/{id}` | 管理员；`ticket:delete` | query `{ version: Version; reason: string }`；无 body | 200；`null` | version 与 reason 均放 query，reason 须 URL 编码；仅管理员逻辑删除 CLOSED 工单，保留日志。 |
| T13 转为知识草稿 | `POST /api/tickets/{id}/knowledge-draft` | 有权处理该工单的处理人员或管理员；`ticket:handle` + `knowledge:maintain` | JSON `{ title: string; content: string; scope: KnowledgeScope; requestId: RequestId }` | 201；`{ articleId: Id }` | 仅对有处理权限的 RESOLVED/CLOSED 工单人工整理草稿；以 knowledge_article(author_id, request_id) 唯一约束幂等，同请求返回同一 articleId，不额外调用模型。 |

### 知识文章

| 编号 / 名称 | 方法与路径 | 权限 / 范围 | 请求 | HTTP / data | 关键约束 |
|---|---|---|---|---|---|
| K01 文章列表与搜索 | `GET /api/knowledge/articles` | 登录用户，按范围；`knowledge:read` | query `PageQuery & { keyword?: string; status?: KnowledgeStatus }` | 200；`Page<ArticleSummary>` | 关键词、状态、分页；员工仅查授权已发布文章。 |
| K02 文章详情 | `GET /api/knowledge/articles/{id}` | 有权查看者；`knowledge:read` | 无 body | 200；`ArticleDetail` | 标题、正文、范围、状态、版本、源工单标识。 |
| K03 创建文章草稿 | `POST /api/knowledge/articles` | 知识维护者；`knowledge:maintain` | JSON `{ title: string; content: string; scope: KnowledgeScope }` | 201；`ArticleDetail`，`status='DRAFT'` | 创建 DRAFT，归属部门取当前用户；不扩展管理员跨部门新建能力。 |
| K04 修改文章草稿 | `PATCH /api/knowledge/articles/{id}` | 有权维护者；`knowledge:maintain` | JSON `{ title: string; content: string; scope: KnowledgeScope; version: Version }` | 200；`ArticleDetail` | 仅 DRAFT 可改正文与范围；version 用作乐观锁，也是后续索引的内容版本。 |
| K05 逻辑删除文章 | `DELETE /api/knowledge/articles/{id}` | 有权维护者；`knowledge:maintain` | query `{ version: Version }`；无 body | 200；`null` | version 放 query，无 JSON body；仅草稿可逻辑删除，已发布内容须先撤回。 |
| K06 提交文章审核 | `POST /api/knowledge/articles/{id}/submit` | 有权维护者；`knowledge:maintain` | JSON `{ version: Version }` | 200；`ArticleDetail`，`status='PENDING_REVIEW'` | DRAFT → PENDING_REVIEW，使用最近读取的 version。 |
| K07 批准文章发布 | `POST /api/knowledge/articles/{id}/approve` | 管理员；`knowledge:review` | JSON `{ version: Version; comment?: string }` | 200；`ArticleDetail`，`status='PUBLISHED'` | 审核通过后设置 PUBLISHED 与 publishedAt，创建索引任务；允许管理员审核自己的内容并留痕。 |
| K08 驳回文章 | `POST /api/knowledge/articles/{id}/reject` | 管理员；`knowledge:review` | JSON `{ version: Version; reason: string }` | 200；`ArticleDetail`，`status='DRAFT'` | 驳回退回 DRAFT，reason 必填。 |
| K09 撤回文章 | `POST /api/knowledge/articles/{id}/withdraw` | 有权维护者；`knowledge:maintain` | JSON `{ version: Version; reason: string }` | 200；`ArticleDetail`，`status='DRAFT'` | 待审核或已发布内容退回 DRAFT，reason 必填；立即排除授权检索，异步清理旧版本索引。 |

### 知识文档

| 编号 / 名称 | 方法与路径 | 权限 / 范围 | 请求 | HTTP / data | 关键约束 |
|---|---|---|---|---|---|
| F01 文档列表与搜索 | `GET /api/knowledge/documents` | 登录用户，按范围；`knowledge:read` | query `PageQuery & { fileName?: string; status?: KnowledgeStatus; indexStatus?: IndexState }` | 200；`Page<DocumentInfo>` | 文件名、状态、索引状态、分页。 |
| F02 文档详情 | `GET /api/knowledge/documents/{id}` | 有权查看者；`knowledge:read` | 无 body | 200；`DocumentInfo` | 名称、格式、大小、范围、状态、版本、审核信息。 |
| F03 上传文档草稿 | `POST /api/knowledge/documents` | 知识维护者；`knowledge:maintain` | multipart `{ file: File; title: string; scope: KnowledgeScope }` | 201；`DocumentInfo`，`status='DRAFT'` | 单个 TXT/Markdown 文件强制不超过 10 MiB（10,485,760 字节）；校验扩展名与实际文本内容，存储文件名由服务端生成。 |
| F04 修改文档元数据 | `PATCH /api/knowledge/documents/{id}` | 有权维护者；`knowledge:maintain` | JSON `{ title: string; scope: KnowledgeScope; version: Version }` | 200；`DocumentInfo` | 仅 DRAFT 可修改；归属部门与存储路径不可由客户端改变。 |
| F05 替换文档文件 | `PUT /api/knowledge/documents/{id}/file` | 有权维护者；`knowledge:maintain` | multipart `{ file: File; version: Version }` | 200；`DocumentInfo`，更新 version | 仅 DRAFT 可替换文件；校验 version、10 MiB 上限及文本内容，更新同一个 version，不引入独立内容计数器。 |
| F06 下载原文件 | `GET /api/knowledge/documents/{id}/file` | 有权查看者；`knowledge:read` | 无 body，携带 Bearer 认证 | 200；原文件字节流，不套 JSON；响应头见 1.4 | 返回受控文件流，提供 Content-Type 与 Content-Disposition，不套 JSON；下载前重新校验权限，不返回磁盘路径。 |
| F07 逻辑删除文档 | `DELETE /api/knowledge/documents/{id}` | 有权维护者；`knowledge:maintain` | query `{ version: Version }`；无 body | 200；`null` | version 放 query，无 JSON body；仅 DRAFT 可逻辑删除。 |
| F08 提交文档审核 | `POST /api/knowledge/documents/{id}/submit` | 有权维护者；`knowledge:maintain` | JSON `{ version: Version }` | 200；`DocumentInfo`，`status='PENDING_REVIEW'` | DRAFT → PENDING_REVIEW，使用最近读取的 version。 |
| F09 批准文档发布 | `POST /api/knowledge/documents/{id}/approve` | 管理员；`knowledge:review` | JSON `{ version: Version; comment?: string }` | 200；`DocumentInfo`，`status='PUBLISHED'` | 审核发布后创建索引任务，发布成功不代表索引已完成。 |
| F10 驳回文档 | `POST /api/knowledge/documents/{id}/reject` | 管理员；`knowledge:review` | JSON `{ version: Version; reason: string }` | 200；`DocumentInfo`，`status='DRAFT'` | 驳回退回 DRAFT，reason 必填。 |
| F11 撤回文档 | `POST /api/knowledge/documents/{id}/withdraw` | 有权维护者；`knowledge:maintain` | JSON `{ version: Version; reason: string }` | 200；`DocumentInfo`，`status='DRAFT'` | 待审核或已发布退回 DRAFT，reason 必填；立即排除检索，异步清理旧版本索引。 |

### 知识索引

| 编号 / 名称 | 方法与路径 | 权限 / 范围 | 请求 | HTTP / data | 关键约束 |
|---|---|---|---|---|---|
| I01 查看文章索引状态 | `GET /api/knowledge/articles/{id}/index-status` | 有权维护者；`knowledge:maintain` | 无 body | 200；`IndexStatus` | contentVersion 是建立索引时对应的知识 version；未建立索引返回 NOT_INDEXED，不伪造成功。 |
| I02 重建文章索引 | `POST /api/knowledge/articles/{id}/reindex` | 有权维护者；`knowledge:maintain` | JSON `{ contentVersion: Version }` | 202；`IndexAccepted`，仍套普通 JSON 外壳 | 仅已发布文章；请求 contentVersion 必须等于当前 version，同内容同版本任务去重，202 只表示接受。 |
| I03 查看文档索引状态 | `GET /api/knowledge/documents/{id}/index-status` | 有权维护者；`knowledge:maintain` | 无 body | 200；`IndexStatus` | contentVersion 是建立索引时对应的知识 version；重试次数与失败摘要以持久化任务为准。 |
| I04 重建文档索引 | `POST /api/knowledge/documents/{id}/reindex` | 有权维护者；`knowledge:maintain` | JSON `{ contentVersion: Version }` | 202；`IndexAccepted`，仍套普通 JSON 外壳 | 仅已发布文档；请求 contentVersion 必须等于当前 version，同内容同版本任务去重，202 只表示接受。 |

### 会话与反馈

| 编号 / 名称 | 方法与路径 | 权限 / 范围 | 请求 | HTTP / data | 关键约束 |
|---|---|---|---|---|---|
| Q01 会话列表 | `GET /api/chats` | 登录用户，仅本人；`chat:use` | query `PageQuery & { type?: ChatType }` | 200；`Page<Chat>`，仅本人 | 只返回本人的会话，支持 KNOWLEDGE/AGENT 类型筛选。 |
| Q02 创建会话 | `POST /api/chats` | 登录用户；`chat:use` | JSON `{ title: string; type: ChatType }` | 201；`Chat` | 标题、类型 `KNOWLEDGE` 或 `AGENT`；返回会话 ID。 |
| Q03 会话详情 | `GET /api/chats/{id}` | 会话所有者；`chat:use` | 无 body | 200；`Chat` | 仅所有者读取，generation 返回当前生成状态，不通过切换页面隐式停止生成。 |
| Q04 修改会话标题 | `PATCH /api/chats/{id}` | 会话所有者；`chat:use` | JSON `{ title: string; version: Version }` | 200；`Chat` | 仅所有者改标题并校验 version。 |
| Q05 删除会话 | `DELETE /api/chats/{id}` | 会话所有者；`chat:use` | 无 body | 200；`null`；先终止生成并使未执行操作失效 | 仅所有者逻辑删除；先终止进行中的生成，再使未执行的待确认操作失效。 |
| Q06 消息历史 | `GET /api/chats/{id}/messages` | 会话所有者；`chat:use` | query `PageQuery` | 200；`Page<Message>` | page=1 返回最新一页，默认 20 条，页内按时间正序；page=2 返回更早一页并正序。历史引用须重新校验当前可见性。 |
| Q07 发起知识问答 | `POST /api/chats/{id}/messages` | 本人知识问答会话；`chat:use` | JSON `{ question: string; requestId: RequestId }` | 200；`text/event-stream`，结构见第 5 章，仅本人 `KNOWLEDGE` 会话 | 仅本人 KNOWLEDGE 会话；每会话同时最多一个生成，不同请求占用时 409。同 requestId 关联原生成，不能重复启动或计费；先 meta 再正文，SSE 见第 5 章。 |
| Q08 停止当前生成 | `POST /api/chats/{id}/messages/{messageId}/stop` | 会话所有者；`chat:use` | 无 body | 200；`StopResult`，返回服务端实际状态 | 仅会话所有者停止指定回答及上游任务；重复停止不报错，已结束则返回实际终态。 |
| Q09 提交或修改反馈 | `POST /api/messages/{id}/feedback` | 消息所属用户；`chat:use` | JSON `Feedback` | 200；`Feedback`，覆盖当前反馈 | 仅本人 ASSISTANT 回答可反馈；三个字段均传递，null 表示未选择；覆盖当前反馈，不重复增加计数。 |

### 工单 AI 辅助

| 编号 / 名称 | 方法与路径 | 权限 / 范围 | 请求 | HTTP / data | 关键约束 |
|---|---|---|---|---|---|
| H01 分类与优先级建议 | `POST /api/tickets/ai-suggestions` | 登录用户；`ticket:create` | JSON `{ title: string; description: string }` | 200；`{ categoryId: Id; priority: Priority; reason: string }` | 只返回建议，不写工单；分类必须属于启用白名单，优先级属于枚举；AI 不可用 503，模型输出非法分类或优先级 422。 |
| H02 生成工单摘要 | `POST /api/tickets/{id}/ai-summary` | 有权处理该工单者；`ticket:handle` | JSON `{ focus?: string }`，无侧重点时传 `{}` | 200；`{ summary: string }` | 由 Java 读取已授权正文和评论，Python 不凭任意工单 ID 读取业务数据；只返回摘要。 |
| H03 生成回复草稿 | `POST /api/tickets/{id}/ai-draft` | 有权处理该工单者；`ticket:handle` | JSON `{ intent: string }` | 200；`{ draft: string }` | 只返回可编辑草稿，不自动评论或解决工单。 |
| H04 提交前相似推荐 | `POST /api/tickets/similar` | 登录用户；`ticket:create` | JSON `{ title: string; description: string }` | 200；`{ knowledge: Recommendation[]; tickets: Recommendation[] }` | knowledge 仅 ARTICLE/DOCUMENT，tickets 仅 TICKET，分别执行权限过滤；AI 失败不阻塞普通提单。 |

### Agent 助手

| 编号 / 名称 | 方法与路径 | 权限 / 范围 | 请求 | HTTP / data | 关键约束 |
|---|---|---|---|---|---|
| G01 发起 Agent 对话 | `POST /api/agent/messages` | 登录用户，仅本人 Agent 会话；`chat:use` | JSON `{ chatId: Id; question: string; requestId: RequestId }` | 200；`text/event-stream`，结构见第 5 章，仅本人 `AGENT` 会话 | 仅本人 AGENT 会话；Java 编排最多 5 轮工具调用，Python 只推理。SSE 与知识问答共用事件并增加 tool/action。 |
| G02 查看待确认操作 | `GET /api/agent/actions/{id}` | 操作所属用户；`chat:use` | 无 body | 200；`AgentAction` | 仅操作所有者读取服务端已校验的规范化参数与执行状态。 |
| G03 确认创建工单 | `POST /api/agent/actions/{id}/confirm` | 操作所属用户；`chat:use` | JSON `{ requestId: RequestId }` | 200；`AgentAction`；执行成功为 `EXECUTED` 且带同一 `ticket` | body 仅 requestId，参数来自服务端记录；校验归属、会话、有效期与权限。agent_action(owner_id, confirm_request_id) 唯一，同操作重复确认返回同一工单。 |
| G04 取消待确认操作 | `POST /api/agent/actions/{id}/cancel` | 操作所属用户；`chat:use` | 无 body | 200；`AgentAction` | 重复取消不重复修改；已执行操作不能取消，过期或已删除会话中的操作不得执行。 |

### 业务与 AI 统计

| 编号 / 名称 | 方法与路径 | 权限 / 范围 | 请求 | HTTP / data | 关键约束 |
|---|---|---|---|---|---|
| S01 工单业务统计 | `GET /api/stats/tickets` | 登录用户，按数据范围；`ticket:read` | query `TimeQuery` | 200；`TicketStats`，仅当前用户授权范围 | 统计当前用户授权工单；平均解决时长按 2.2 定义，以秒返回，无样本为 null。 |
| S02 AI 使用统计 | `GET /api/stats/ai` | 管理员；`stats:ai` | query `TimeQuery & { capability?: AiCapability }` | 200；`AiStats`，仅管理员 | 仅管理员；比率分母为零返回 null，未知 token 不当零，反馈覆盖率与自助解决率同时返回。 |
| S03 AI 调用明细 | `GET /api/ai/calls` | 管理员；`stats:ai` | query `PageQuery & TimeQuery & { capability?: AiCapability; result?: AiResult }` | 200；`Page<AiCall>`，仅管理员 | 仅管理员；不返回完整提示词、私密正文、密钥或未经确认的费用。 |

### 会话与 Agent 补充规则

- 消息历史返回已保存正文、状态、引用、工具结果和操作 ID；引用重新校验当前权限。失效来源 `available=false、excerpt=null`，旧全文不得通过历史答案继续泄露。
- 每会话最多一个生成，不同请求占用返回 409；相同 requestId 关联原状态，不重复启动。重放机制待实现确认，前端不自动重试生成 POST，恢复通过会话详情与历史完成。
- 停止使用 meta 返回的回答 messageId，取消上游；切换会话不等于停止，退出、删除或主动取消连接须取消生成。无终止事件的断线先显示中断，再核对历史。
- Agent 确认只传 requestId，参数取服务端已保存记录；修改须取消后重新生成。过期、取消、会话删除时禁止执行，重复确认已执行操作返回同一工单，HTTP 200 仍须检查操作状态。

## 4. 内部接口

- 仅服务内网可达，不经 Nginx 暴露；请求头 `X-Internal-Token`，服务端常量时间比较。字段 camelCase，ID 为字符串，时间 ISO 8601 UTC。
- 通用错误：400 参数、401 内部认证、404 记录不存在、409 版本/状态冲突、500/503 执行异常。错误摘要不含密钥和私密正文；SSE 建流后用 error，文件直接返回字节。
- 以下保留已确定字段；嵌套结构、必填/可空规则和标记“待冻结”的响应由 Java/FastAPI 负责人联调前统一，普通 JSON 外壳也待统一。

| 编号 / 提供方 | 方法与路径 | 请求 | 成功响应 | 关键约束 |
|---|---|---|---|---|
| P01 / FastAPI | `POST /internal/index-jobs` | JSON：`jobId, contentType, contentId, contentVersion, sourceUrl, title, departmentId, scope, publishedAt`。`contentType=ARTICLE\|DOCUMENT`。 | 202，表示任务已接受；接受响应的完整结构待冻结。 | 同 jobId 幂等；sourceUrl 只允许指向约定的内部 J01 来源，不能读取任意外部 URL 或本地路径。Java 在 MySQL 持久化业务任务、超时与重试，Python 执行状态丢失不等于索引成功。 |
| P02 / FastAPI | `GET /internal/index-jobs/{jobId}` | path `{ jobId: Id }`；无 body。 | 200；字段 `status, chunks, error, startedAt, finishedAt`；枚举与可空规则待冻结。 | 记录丢失返回不存在，由 Java 决定超时重派；Java 持久化最终状态与重试信息。 |
| P03 / FastAPI | `DELETE /internal/indexes/{type}/{id}` | path `{ type: ReferenceType; id: Id }`；query `{ version: Version }`；无 body。 | 成功响应状态与结构待冻结；语义为指定版本索引清理完成。 | 只删除精确版本，不得清理同内容的新版本；重复删除应保持相同业务结果。 |
| P04 / FastAPI | `POST /internal/knowledge/search` | JSON：`query, userId, departmentId, allowedScopes, topK, mode`；嵌套结构与可空规则待冻结。 | 200；召回片段与分数（chunks + scores）；片段字段及排序结构待冻结。 | 身份与范围仅来自 Java 的可信上下文；向量、关键词检索应用同一部门/范围过滤，返回当前已发布版本。 |
| P05 / FastAPI | `POST /internal/chat/generate` | JSON：`question, history, context, requestId`；history/context 结构待冻结。 | 200；SSE `delta/done/error`，帧载荷待双方冻结；Java 对外补齐 meta、引用和持久化消息标识。 | 输入上下文由 Java 授权；取消外部生成时取消上游模型调用，不重复发起相同请求。 |
| P06 / FastAPI | `POST /internal/tickets/suggestions` | JSON：`title, description, categories`；categories 是 Java 提供的启用分类白名单，元素结构待冻结。 | 200；`{ categoryId: Id; priority: Priority; reason: string }`。 | 输出分类与优先级必须合法，Java 再次验证；非法输出对外 H01 返回 422，服务不可用返回 503。 |
| P07 / FastAPI | `POST /internal/tickets/summary` | JSON：`ticket, focus`；ticket 是 Java 已授权读取的正文、评论与解决方案，具体结构待冻结。 | 200；摘要文本；是否使用 `{ summary: string }` 及响应外壳待冻结。 | 不得凭任意工单 ID 直接读取业务库，只使用 Java 传入的授权上下文。 |
| P08 / FastAPI | `POST /internal/tickets/reply-draft` | JSON：`ticket, intent`；ticket 上下文结构待冻结。 | 200；回复草稿文本；是否使用 `{ draft: string }` 及响应外壳待冻结。 | 不自动写评论或变更工单状态，结果交给用户编辑采用。 |
| P09 / FastAPI | `POST /internal/agent/steps` | JSON：`question, history, tools, context`；嵌套结构待冻结。 | 200；返回 answer 或 toolCall；互斥判别字段、工具参数和结构待冻结。 | Java 编排最多 5 轮；仅允许 search_tickets、search_knowledge、prepare_ticket，写工单必须经过 G03 人工确认。 |
| J01 / Java | `GET /internal/knowledge/{type}/{id}/source` | path `{ type: ReferenceType; id: Id }`；query `{ version: Version }`；无 body。 | 200；文章 JSON `{ title: string; content: string; version: Version; departmentId: Id; scope: KnowledgeScope }`；文档为文件字节，元信息响应头待冻结。 | 只允许任务指定的内容与版本；任务来源校验方式待冻结。不接受任意路径或外部 URL，不返回密码与磁盘路径。 |

Agent 工具循环由 Java 编排，最多 5 轮：P09 推理 → search_tickets 调 TicketService、search_knowledge 调 P04、prepare_ticket 调 AgentActionService.prepare → 结果回传 P09。只保存待确认操作，建单统一由 G03 执行；模型参数不能自定身份、角色或权限范围。

## 5. SSE

`POST /api/chats/{id}/messages` 与 `POST /api/agent/messages` 均使用 POST 携带 JSON 请求体、`Authorization` 和 `Accept: text/event-stream`；前端使用支持读取响应流的 fetch。建流成功为 HTTP 200、`Content-Type: text/event-stream; charset=utf-8`，不使用普通 JSON 响应外壳。建流前的认证、权限、占用或限流错误用相应 HTTP 状态和 `ApiError`；建流之后的失败用 `error` 事件。

标准 SSE 帧由 `event: <名称>`、一个或多个 `data:` 行和结尾空行组成，可带 `id:`；事件 `id` 为字符串，不等于消息 ID，提供它不代表已经实现自动续传。多行 `data:` 按 SSE 规则用换行拼接后解析 JSON；UTF-8 字节、行和事件可跨任意网络块。每 15 秒发送 `: heartbeat` 注释行，心跳不作为业务事件。响应设置 `Cache-Control: no-cache`、`X-Accel-Buffering: no`，代理关闭 SSE 缓冲。

```ts
type MetaEvent = {
  chatId: Id;
  messageId: Id;
  status: 'GENERATING';
};
type DeltaEvent = { text: string };
type ReferencesEvent = { items: Reference[] };
type ToolEvent = ToolResult;
type ActionEvent = { actionId: Id };
type DoneEvent = {
  messageId: Id;
  status: 'COMPLETED' | 'STOPPED';
  durationMs: number;
};
type ErrorEvent = {
  messageId: Id | null;
  code: string;
  message: string;
  retryable: boolean;
};
```

| `event` | `data` 结构 | 顺序与消费规则 |
|---|---|---|
| `meta` | `MetaEvent` | 本次生成先发送，返回服务端保存的回答 ID；后续停止接口使用此 ID |
| `delta` | `DeltaEvent` | 按接收顺序追加 `text`，不能把每块当作完整回答 |
| `references` | `ReferencesEvent` | 用 `items` 替换完整引用集合，空数组表示清空 |
| `tool` | `ToolEvent` | 仅 Agent 使用；按相同 `id` 更新工具状态与结果，不展示内部思维 |
| `action` | `ActionEvent` | 仅 Agent 使用；参数完整校验并保存后才发出，随后读取操作详情 |
| `done` | `DoneEvent` | 正常或显式停止的终止事件，结束当前流并更新消息终态 |
| `error` | `ErrorEvent` | 建流后的失败终止事件；尚无回答 ID 时允许 `messageId=null`，展示错误并核对历史 |

普通问答使用 `meta/delta/references/done/error`；Agent 复用这些事件并可增加 `tool/action`。`ErrorEvent.code` 为字符串错误标识，与普通 JSON 响应的数字 `code` 不混用；`retryable` 只表示可由用户决定重试，不授权客户端自动重新生成。已建流但尚未能建立回答记录时，可以直接发送 `messageId=null` 的 `error`。

示例为普通问答的一次完整事件序列；各 `data` 行均为独立事件的 JSON，换行和空行属于 SSE 帧结构。

```text
event: meta
data: {"chatId":"12","messageId":"88","status":"GENERATING"}

event: delta
data: {"text":"请先检查设备连接。"}

event: references
data: {"items":[{"id":"501","type":"ARTICLE","sourceId":"3","title":"连接检查","contentVersion":1,"excerpt":"确认设备已连接。","available":true}]}

event: done
data: {"messageId":"88","status":"COMPLETED","durationMs":1250}

```

收到 `done/error` 才能确认该流已经以约定事件终止；没有终止事件的 EOF 显示 `INTERRUPTED`，不能伪装完成或自动重新发起问题，再通过 `GET /api/chats/{id}` 和 `GET /api/chats/{id}/messages` 核对持久化结果。显式停止最终按服务端状态展示，连接关闭或取消须让上游生成及时取消。
