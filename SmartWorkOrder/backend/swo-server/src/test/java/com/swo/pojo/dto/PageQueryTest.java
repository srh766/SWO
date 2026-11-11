package com.swo.pojo.dto;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class PageQueryTest {

    @Test
    void usesDefaults() {
        PageQuery query = new PageQuery();
        assertThat(query.normalizedPage()).isEqualTo(1);
        assertThat(query.normalizedPageSize()).isEqualTo(20);
        assertThat(query.getOffset()).isZero();
    }

    @Test
    void normalizesInvalidValues() {
        PageQuery query = new PageQuery();
        query.setPage(0);
        query.setPageSize(-5);
        query.normalize();
        assertThat(query.getPage()).isEqualTo(1);
        assertThat(query.getPageSize()).isEqualTo(20);
    }

    @Test
    void capsPageSizeAt100() {
        PageQuery query = new PageQuery();
        query.setPageSize(1000);
        assertThat(query.normalizedPageSize()).isEqualTo(100);
    }

    @Test
    void calculatesOffset() {
        PageQuery query = new PageQuery();
        query.setPage(3);
        query.setPageSize(10);
        assertThat(query.getOffset()).isEqualTo(20);
    }
}
