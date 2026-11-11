export interface Page<T> { records: T[]; total: number; page: number; pageSize: number }
export interface Department { id: string; name: string; code: string; status: string; version: number }
export interface Role { id: string; code: string; name: string; description: string; permissions: string[] }
export interface Person { id: string; name: string }
export interface User extends Person { username: string; department: Department | null; roles: Role[]; status: string; version: number; permissions: string[] }
export interface Category { id: string; name: string; code: string; description: string; defaultDepartment?: Person | null; status: string; version: number }
export interface Ticket { id: string; number: string; title: string; description: string; category: Person; priority: string; status: string; requester: Person; department: Person; assignee: Person | null; createdAt: string; updatedAt: string; version: number; solution: string | null; resolvedAt: string | null; closedAt: string | null }
export interface Comment { id: string; content: string; author: Person; createdAt: string }
export interface TicketLog { id: string; action: string; operator: Person; createdAt: string; fromStatus: string | null; toStatus: string | null; reason: string | null; description: string }
export interface Review { reviewer: Person | null; comment: string | null; reviewedAt: string | null }
export interface Article { id: string; title: string; content: string; scope: string; department: Person; status: string; author: Person; createdAt: string; updatedAt: string; publishedAt: string | null; version: number; sourceTicket: { id: string; number: string } | null; review: Review | null }
export interface DocumentInfo extends Omit<Article, 'content' | 'sourceTicket'> { fileName: string; format: string; sizeBytes: number }
export interface IndexStatus { contentVersion: number; status: string; taskId: string | null; retryCount: number; errorSummary: string | null; updatedAt: string | null }
export interface Recommendation { type: 'ARTICLE' | 'DOCUMENT' | 'TICKET'; id: string; title: string; excerpt: string; reason: string }
export interface Chat { id: string; title: string; type: string; version: number; createdAt: string; updatedAt: string; generation: { messageId: string; status: string } | null }
export interface Reference { id: string; type: 'ARTICLE' | 'DOCUMENT'; sourceId: string; title: string; contentVersion: number; excerpt: string | null; available: boolean }
export interface Feedback { satisfaction: string | null; resolved: boolean | null; reason: string | null }
export interface ToolResult { id: string; name: string; status: string; summary: string; results: Recommendation[] }
export interface Message { id: string; chatId: string; role: string; content: string; status: string; references: Reference[]; toolResults: ToolResult[]; actionIds: string[]; feedback: Feedback | null; createdAt: string }
export interface AgentAction { id: string; chatId: string; type: string; parameters: { title: string; description: string; categoryId: string; categoryName: string; priority: string }; status: string; expiresAt: string; ticket: { id: string; number: string } | null; errorSummary: string | null }
export interface TicketStats { total: number; statusDistribution: { status: string; count: number }[]; categoryDistribution: { categoryId: string; categoryName: string; count: number }[]; averageResolutionSeconds: number | null }
export interface AiStats { callCount: number; successCount: number; successRate: number | null; averageDurationMs: number | null; knownInputTokens: number | null; knownOutputTokens: number | null; unknownUsageCallCount: number; cacheHits: number; cacheEligibleRequests: number; cacheHitRate: number | null; feedbackCount: number; answerCount: number; resolvedFeedbackCount: number; unresolvedFeedbackCount: number; selfServiceResolutionRate: number | null; feedbackCoverageRate: number | null }
export interface AiCall { id: string; capability: string; chatId: string | null; ticketId: string | null; model: string; durationMs: number; inputTokens: number | null; outputTokens: number | null; result: string; errorSummary: string | null; createdAt: string }
