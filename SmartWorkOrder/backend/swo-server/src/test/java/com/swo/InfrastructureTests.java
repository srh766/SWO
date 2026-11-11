package com.swo;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Duration;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
class InfrastructureTests {

    @Autowired
    JdbcTemplate jdbcTemplate;

    @Autowired
    StringRedisTemplate redisTemplate;

    @Test
    void mysqlConnectionWorks() {
        assertEquals(1, jdbcTemplate.queryForObject("SELECT 1", Integer.class));
    }

    @Test
    void redisReadWriteWorks() {
        String key = "test:connection:" + UUID.randomUUID();
        try {
            redisTemplate.opsForValue().set(key, "ok", Duration.ofSeconds(30));
            assertEquals("ok", redisTemplate.opsForValue().get(key));
        } finally {
            redisTemplate.delete(key);
        }
    }
}
