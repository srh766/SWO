package com.swo.config;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.Configuration;

@Configuration
@MapperScan("com.swo.mapper")
public class MyBatisConfig {
}
