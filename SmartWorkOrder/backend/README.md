# Smart Work Order 后端

当前为 Spring Boot 初始化工程，尚未实现业务接口。

## 技术与依赖

- Java 21、Maven
- Spring Boot 4.0.9
- Spring Security
- MyBatis Spring Boot Starter 4.0.1
- MySQL、SQL Server JDBC 驱动
- Lombok、Spring Boot DevTools

## 目录

```text
backend/
├─ pom.xml
├─ .mvn/wrapper/maven-wrapper.properties
└─ src/
   ├─ main/
   │  ├─ java/com/swo/backend/BackendApplication.java
   │  └─ resources/application.yaml
   └─ test/java/com/swo/backend/BackendApplicationTests.java
```

## 当前状态

- 已有应用启动类和默认上下文加载测试。
- 配置文件仅设置应用名称 `backend`，尚未配置数据库连接。
- 尚未引入 Web、Redis 依赖。
- 尚无 Controller、Service、Mapper 和实体类。
- 尚未验证构建、启动和测试结果。
