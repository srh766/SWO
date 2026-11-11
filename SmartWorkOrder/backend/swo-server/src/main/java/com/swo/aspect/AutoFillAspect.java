package com.swo.aspect;

import com.swo.annotation.AutoFill;
import com.swo.common.constant.AutoFillConstant;
import com.swo.common.context.BaseContext;
import com.swo.common.enumeration.OperationType;
import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;
import org.aspectj.lang.annotation.Pointcut;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.stereotype.Component;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.time.Instant;

@Aspect
@Component
public class AutoFillAspect {

    @Pointcut("execution(* com.swo.mapper.*.*(..)) && @annotation(com.swo.annotation.AutoFill)")
    public void autoFillPointCut() {
    }

    @Before("autoFillPointCut()")
    public void autoFill(JoinPoint joinPoint) {
        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        AutoFill autoFill = signature.getMethod().getAnnotation(AutoFill.class);
        Object[] args = joinPoint.getArgs();
        if (args == null || args.length == 0 || args[0] == null) {
            return;
        }
        Object entity = args[0];
        Instant now = Instant.now();
        Long userId = BaseContext.getUserId();
        try {
            if (autoFill.value() == OperationType.INSERT) {
                invoke(entity, AutoFillConstant.SET_CREATE_TIME, Instant.class, now);
                invoke(entity, AutoFillConstant.SET_UPDATE_TIME, Instant.class, now);
                invoke(entity, AutoFillConstant.SET_CREATE_USER, Long.class, userId);
                invoke(entity, AutoFillConstant.SET_UPDATE_USER, Long.class, userId);
            } else {
                invoke(entity, AutoFillConstant.SET_UPDATE_TIME, Instant.class, now);
                invoke(entity, AutoFillConstant.SET_UPDATE_USER, Long.class, userId);
            }
        } catch (ReflectiveOperationException exception) {
            throw new IllegalStateException("公共字段自动填充失败", exception);
        }
    }

    private void invoke(Object target, String methodName, Class<?> parameterType, Object value)
            throws InvocationTargetException, IllegalAccessException {
        Method method = findPublicMethod(target.getClass(), methodName, parameterType);
        if (method != null) {
            method.invoke(target, value);
        }
    }

    private Method findPublicMethod(Class<?> type, String methodName, Class<?> parameterType) {
        try {
            return type.getMethod(methodName, parameterType);
        } catch (NoSuchMethodException exception) {
            return null;
        }
    }
}
