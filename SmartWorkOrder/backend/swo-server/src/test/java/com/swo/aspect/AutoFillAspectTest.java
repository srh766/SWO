package com.swo.aspect;

import com.swo.annotation.AutoFill;
import com.swo.common.context.BaseContext;
import com.swo.common.context.LoginUser;
import com.swo.common.enumeration.OperationType;
import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.reflect.MethodSignature;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AutoFillAspectTest {

    private final AutoFillAspect aspect = new AutoFillAspect();

    @AfterEach
    void clearContext() {
        BaseContext.remove();
    }

    @Test
    void insertFillsAllCommonFields() throws Exception {
        BaseContext.set(LoginUser.builder().id(9L).build());
        Sample sample = new Sample();

        aspect.autoFill(joinPoint("insert", sample));

        assertThat(sample.getCreateTime()).isNotNull();
        assertThat(sample.getUpdateTime()).isNotNull();
        assertThat(sample.getCreateUser()).isEqualTo(9L);
        assertThat(sample.getUpdateUser()).isEqualTo(9L);
    }

    @Test
    void updateOnlyFillsUpdateFields() throws Exception {
        BaseContext.set(LoginUser.builder().id(9L).build());
        Sample sample = new Sample();

        aspect.autoFill(joinPoint("update", sample));

        assertThat(sample.getCreateTime()).isNull();
        assertThat(sample.getUpdateTime()).isNotNull();
        assertThat(sample.getCreateUser()).isNull();
        assertThat(sample.getUpdateUser()).isEqualTo(9L);
    }

    @Test
    void insertSkipsMissingSetters() throws Exception {
        BaseContext.set(LoginUser.builder().id(9L).build());
        CreateTimeOnly entity = new CreateTimeOnly();

        assertThatCode(() -> aspect.autoFill(joinPoint("insert", "CreateTimeOnly", entity)))
                .doesNotThrowAnyException();
        assertThat(entity.getCreateTime()).isNotNull();
    }

    private JoinPoint joinPoint(String methodName, Object entity) throws NoSuchMethodException {
        return joinPoint(methodName, "Sample", entity);
    }

    private JoinPoint joinPoint(String methodName, String typeName, Object entity) throws NoSuchMethodException {
        Class<?> type = "Sample".equals(typeName) ? Sample.class : CreateTimeOnly.class;
        Method method = type.getMethod(methodName);
        MethodSignature signature = mock(MethodSignature.class);
        when(signature.getMethod()).thenReturn(method);
        JoinPoint joinPoint = mock(JoinPoint.class);
        when(joinPoint.getSignature()).thenReturn(signature);
        when(joinPoint.getArgs()).thenReturn(new Object[]{entity});
        return joinPoint;
    }

    static class Sample {

        private Instant createTime;
        private Instant updateTime;
        private Long createUser;
        private Long updateUser;

        @AutoFill(OperationType.INSERT)
        public void insert() {
        }

        @AutoFill(OperationType.UPDATE)
        public void update() {
        }

        public Instant getCreateTime() {
            return createTime;
        }

        public void setCreateTime(Instant createTime) {
            this.createTime = createTime;
        }

        public Instant getUpdateTime() {
            return updateTime;
        }

        public void setUpdateTime(Instant updateTime) {
            this.updateTime = updateTime;
        }

        public Long getCreateUser() {
            return createUser;
        }

        public void setCreateUser(Long createUser) {
            this.createUser = createUser;
        }

        public Long getUpdateUser() {
            return updateUser;
        }

        public void setUpdateUser(Long updateUser) {
            this.updateUser = updateUser;
        }
    }

    static class CreateTimeOnly {

        private Instant createTime;

        @AutoFill(OperationType.INSERT)
        public void insert() {
        }

        public Instant getCreateTime() {
            return createTime;
        }

        public void setCreateTime(Instant createTime) {
            this.createTime = createTime;
        }
    }
}
