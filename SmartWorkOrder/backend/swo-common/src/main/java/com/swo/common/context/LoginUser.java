package com.swo.common.context;

import lombok.Builder;
import lombok.Data;

import java.util.List;
import java.util.Set;

@Data
@Builder
public class LoginUser {

    private Long id;
    private String username;
    private String name;
    private Long departmentId;
    private String departmentName;
    private List<String> roles;
    private Set<String> permissions;
    private Integer tokenVersion;
}
