package com.swo.common.constant;

public final class MessageConstant {

    private MessageConstant() {
    }

    public static final String LOGIN_FAILED = "用户名、密码错误或账号不可用";
    public static final String ACCOUNT_DISABLED = "账号已停用";
    public static final String TOKEN_INVALID = "登录状态无效，请重新登录";
    public static final String FORBIDDEN = "无权执行此操作";
    public static final String NOT_FOUND = "资源不存在或不可访问";
    public static final String CONFLICT = "数据已被更新，请刷新后重试";
    public static final String DUPLICATE = "数据已存在，请勿重复提交";
    public static final String TICKET_STATUS_INVALID = "当前工单状态不允许此操作";
    public static final String KNOWLEDGE_STATUS_INVALID = "当前知识状态不允许此操作";
    public static final String FILE_INVALID = "文件格式或内容不合法";
    public static final String AI_UNAVAILABLE = "AI 服务暂时不可用";
}
