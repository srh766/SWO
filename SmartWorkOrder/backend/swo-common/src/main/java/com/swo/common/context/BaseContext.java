package com.swo.common.context;

public final class BaseContext {

    private static final ThreadLocal<LoginUser> HOLDER = new ThreadLocal<>();

    private BaseContext() {
    }

    public static void set(LoginUser user) {
        HOLDER.set(user);
    }

    public static LoginUser get() {
        return HOLDER.get();
    }

    public static Long getUserId() {
        LoginUser user = HOLDER.get();
        return user == null ? null : user.getId();
    }

    public static void remove() {
        HOLDER.remove();
    }
}
