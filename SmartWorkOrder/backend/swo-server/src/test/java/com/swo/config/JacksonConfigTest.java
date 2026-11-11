package com.swo.config;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class JacksonConfigTest {

    private final JsonMapper mapper = buildMapper();

    @Test
    void wrappedLongSerializedAsString() {
        String json = mapper.writeValueAsString(Map.of("id", 9007199254740993L));
        assertThat(json).isEqualTo("{\"id\":\"9007199254740993\"}");
    }

    @Test
    void primitiveLongStaysNumber() {
        String json = mapper.writeValueAsString(new Counts(12L));
        assertThat(json).isEqualTo("{\"total\":12}");
    }

    @Test
    void instantUsesIso8601() {
        String json = mapper.writeValueAsString(Map.of("at", Instant.parse("2026-11-11T00:00:00Z")));
        assertThat(json).isEqualTo("{\"at\":\"2026-11-11T00:00:00Z\"}");
    }

    private static JsonMapper buildMapper() {
        JsonMapper.Builder builder = JsonMapper.builder();
        new JacksonConfig().jacksonCustomizer().customize(builder);
        return builder.build();
    }

    static class Counts {

        private final long total;

        Counts(long total) {
            this.total = total;
        }

        public long getTotal() {
            return total;
        }
    }
}
