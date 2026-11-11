package com.swo.pojo.dto;

import lombok.Data;

import java.io.Serializable;

@Data
public class PageQuery implements Serializable {

    private Integer page = 1;
    private Integer pageSize = 20;

    public int normalizedPage() {
        return page == null || page < 1 ? 1 : page;
    }

    public int normalizedPageSize() {
        if (pageSize == null || pageSize < 1) {
            return 20;
        }
        return Math.min(pageSize, 100);
    }

    public int getOffset() {
        return (normalizedPage() - 1) * normalizedPageSize();
    }

    public void normalize() {
        this.page = normalizedPage();
        this.pageSize = normalizedPageSize();
    }
}
