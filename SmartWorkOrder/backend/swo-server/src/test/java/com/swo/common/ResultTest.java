package com.swo.common;

import com.swo.common.result.PageResult;
import com.swo.common.result.Result;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ResultTest {

    @Test
    void successUsesZeroCode() {
        Result<Void> result = Result.success();
        assertThat(result.getCode()).isZero();
        assertThat(result.getMessage()).isEqualTo("操作成功");
        assertThat(result.getData()).isNull();
    }

    @Test
    void successCarriesData() {
        Result<String> result = Result.success("ok");
        assertThat(result.getCode()).isZero();
        assertThat(result.getData()).isEqualTo("ok");
    }

    @Test
    void errorCarriesCodeAndMessage() {
        Result<Void> result = Result.error(409, "冲突");
        assertThat(result.getCode()).isEqualTo(409);
        assertThat(result.getMessage()).isEqualTo("冲突");
    }

    @Test
    void errorDefaultsTo500() {
        assertThat(Result.error("失败").getCode()).isEqualTo(500);
    }

    @Test
    void pageResultKeepsPaginationFields() {
        PageResult<String> result = PageResult.of(List.of("a"), 25, 2, 10);
        assertThat(result.getRecords()).containsExactly("a");
        assertThat(result.getTotal()).isEqualTo(25);
        assertThat(result.getPage()).isEqualTo(2);
        assertThat(result.getPageSize()).isEqualTo(10);
    }
}
