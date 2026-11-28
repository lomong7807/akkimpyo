package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.support.HttpServerTest;
import app.accountbook.support.SignedInUser;
import app.accountbook.support.TestAccessTokens;
import io.swagger.v3.oas.annotations.media.Schema;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.BiConsumer;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 문서 테스트(ADR 003 결정 8). 문서를 켠 서버에서 받은 문서가 커밋한 {@code server/openapi.json}과 같고 결정 5~7을 지키는지 본다.
 * 다르면 새 문서를 {@code server/build/openapi.json}에 쓰고 실패한다. 갱신은 {@code server/}에서 {@value #UPDATE}다.
 */
@HttpServerTest
@Import(OpenApiDocConfig.class)
@TestPropertySource(properties = {
        "springdoc.api-docs.enabled=true",
        "springdoc.paths-to-match=/api/v1/**",
        "springdoc.writer-with-order-by-keys=true",
        "springdoc.writer-with-default-pretty-printer=true",
        "springdoc.override-with-generic-response=false",
        "springdoc.default-produces-media-type=application/json",
        "springdoc.model-converters.java-nullable-property-customizer.enabled=true"})
class OpenApiDocTest {

    static final String UPDATE = "./gradlew test --tests app.accountbook.api.OpenApiDocTest; cp build/openapi.json openapi.json";
    private static final List<String> FORBIDDEN = List.of("app.accountbook", "java.", "springframework", "localhost",
            "127.0.0.1", "jdbc:", "Exception", "eyJ", "/Users/");
    private static final Set<String> METHODS = Set.of("get", "put", "post", "delete", "patch");

    @LocalServerPort int port;
    @Autowired @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping mappings;
    @Autowired PostgreSQLContainer postgres;

    private static String document;

    private String document() throws Exception {
        if (document == null) {
            ServerClient.Reply reply = ServerClient.signedIn(port, SignedInUser.ID, Instant.now()).get("/v3/api-docs");
            assertThat(reply.status()).isEqualTo(200);
            assertThat(reply.header("Content-Type")).startsWith("application/json");
            document = reply.body();
        }
        return document;
    }

    private JsonNode root() throws Exception {
        return JsonMapper.shared().readTree(document());
    }

    @Test
    void 문서가_커밋한_파일과_같다() throws Exception {
        Path committed = Path.of("openapi.json");
        String expected = Files.exists(committed) ? Files.readString(committed) : "";
        if (!expected.equals(document())) {
            Files.writeString(Files.createDirectories(Path.of("build")).resolve("openapi.json"), document());
        }
        assertThat(document()).as("server/openapi.json이 코드와 다르다. server/에서 갱신한다: " + UPDATE)
                .isEqualTo(expected);
    }

    @Test
    void 모든_ref가_가리키는_것이_있다() throws Exception {
        JsonNode root = root();
        List<String> missing = new ArrayList<>();
        walk(root, "", (pointer, node) -> {
            JsonNode ref = node.get("$ref");
            if (ref != null && (!ref.asString().startsWith("#/") || root.at(ref.asString().substring(1)).isMissingNode())) {
                missing.add(pointer + " -> " + ref.asString());
            }
        });
        assertThat(missing).isEmpty();
    }

    @Test
    void api_v1의_컨트롤러_동작이_모두_있고_operationId는_메서드_이름이다() throws Exception {
        JsonNode paths = root().get("paths");
        List<String> expected = new ArrayList<>();
        apiOperations().forEach((info, method) -> info.getPathPatternsCondition().getPatternValues().forEach(path ->
                info.getMethodsCondition().getMethods().forEach(verb -> {
                    JsonNode op = paths.path(path).path(verb.name().toLowerCase(Locale.ROOT));
                    assertThat(op.isMissingNode()).as(verb + " " + path).isFalse();
                    assertThat(op.get("operationId").asString()).isEqualTo(method.getMethod().getName());
                    var codes = op.get("responses").propertyNames();
                    assertThat(codes).as(verb + " " + path).contains("400", "500")
                            .anyMatch(code -> code.startsWith("2"));
                    expected.add(method.getMethod().getName());
                })));
        List<String> documented = operations(paths).stream().map(op -> op.get("operationId").asString()).toList();
        assertThat(documented).doesNotHaveDuplicates().containsExactlyInAnyOrderElementsOf(expected);
    }

    @Test
    void 요청_응답_타입의_이름이_겹치지_않는다() {
        Set<Class<?>> types = new HashSet<>();
        apiOperations().values().forEach(method -> {
            reach(method.getMethod().getGenericReturnType(), types);
            Arrays.stream(method.getMethodParameters()).filter(p -> p.hasParameterAnnotation(RequestBody.class))
                    .forEach(p -> reach(p.getGenericParameterType(), types));
        });
        Map<String, List<String>> byName = types.stream().collect(Collectors.groupingBy(OpenApiDocTest::schemaName,
                Collectors.mapping(Class::getName, Collectors.toList())));
        assertThat(byName.values()).allSatisfy(classes -> assertThat(classes).hasSize(1));
    }

    @Test
    void 내부_정보와_비밀값이_없다() throws Exception {
        assertThat(document()).doesNotContain(FORBIDDEN.toArray(String[]::new))
                .doesNotContain(TestAccessTokens.encodedKey(), postgres.getPassword());
    }

    /** 예시는 0개다. 이름이 example인 속성은 세지 않는다. default는 쿼리 값에만 쓴다(ADR 003 결정 5). */
    @Test
    void 예시가_없고_default는_쿼리_값에만_있다() throws Exception {
        JsonNode root = root();
        List<String> found = new ArrayList<>();
        walk(root, "", (pointer, node) -> {
            if (pointer.endsWith("/properties")) {
                return;
            }
            node.propertyNames().stream().filter(name -> name.equals("example") || name.equals("examples"))
                    .forEach(name -> found.add(pointer + "/" + name));
            if (node.has("default") && !(pointer.matches("/paths/[^/]+/[^/]+/parameters/\\d+/schema")
                    && root.at(pointer.substring(0, pointer.length() - "/schema".length())).path("in")
                    .asString().equals("query"))) {
                found.add(pointer + "/default");
            }
        });
        assertThat(found).isEmpty();
    }

    @Test
    void 비밀번호_필드는_쓰기_전용이다() throws Exception {
        List<String> passwords = new ArrayList<>();
        root().path("components").path("schemas").properties().forEach(schema ->
                schema.getValue().path("properties").properties().stream()
                        .filter(property -> property.getKey().toLowerCase(Locale.ROOT).contains("password"))
                        .forEach(property -> {
                            passwords.add(schema.getKey() + "." + property.getKey());
                            assertThat(property.getValue().path("format").asString()).isEqualTo("password");
                            assertThat(property.getValue().path("writeOnly").asBoolean()).isTrue();
                        }));
        assertThat(passwords).isNotEmpty();
    }

    /** 문서의 공개 동작(빈 security)과 필터 체인의 공개 목록이 같다(ADR 003 결정 7). */
    @Test
    void 공개_동작이_필터_체인의_공개_목록과_같다() throws Exception {
        JsonNode paths = root().get("paths");
        List<String> documented = new ArrayList<>();
        List<String> permitted = new ArrayList<>();
        paths.properties().forEach(path -> path.getValue().properties().stream()
                .filter(verb -> METHODS.contains(verb.getKey())).forEach(verb -> {
                    String name = verb.getKey().toUpperCase(Locale.ROOT) + " " + path.getKey();
                    if (verb.getValue().has("security") && verb.getValue().get("security").isEmpty()) {
                        documented.add(name);
                    }
                    MockHttpServletRequest request = new MockHttpServletRequest(verb.getKey().toUpperCase(Locale.ROOT),
                            path.getKey().replaceAll("\\{[^}]+}", SignedInUser.ID.toString()));
                    if (Arrays.stream(SecurityConfig.PUBLIC).anyMatch(matcher -> matcher.matches(request))) {
                        permitted.add(name);
                    }
                }));
        long apiMatchers = Arrays.stream(SecurityConfig.PUBLIC)
                .filter(matcher -> !matcher.matches(new MockHttpServletRequest("GET", "/actuator/health"))).count();
        assertThat(documented).isNotEmpty().containsExactlyInAnyOrderElementsOf(permitted).hasSize((int) apiMatchers);
    }

    private Map<RequestMappingInfo, HandlerMethod> apiOperations() {
        return mappings.getHandlerMethods().entrySet().stream()
                .filter(entry -> entry.getKey().getPathPatternsCondition().getPatternValues().stream()
                        .allMatch(path -> path.startsWith("/api/v1/")))
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    }

    private static List<JsonNode> operations(JsonNode paths) {
        List<JsonNode> operations = new ArrayList<>();
        paths.forEach(path -> path.properties().stream().filter(verb -> METHODS.contains(verb.getKey()))
                .forEach(verb -> operations.add(verb.getValue())));
        return operations;
    }

    /** 컨트롤러가 주고받는 우리 타입과 그 안의 타입. springdoc은 이름이 같은 타입을 조용히 하나로 합친다. */
    private static void reach(Type type, Set<Class<?>> types) {
        if (type instanceof ParameterizedType parameterized) {
            Arrays.stream(parameterized.getActualTypeArguments()).forEach(argument -> reach(argument, types));
        } else if (type instanceof Class<?> c && c.isArray()) {
            reach(c.getComponentType(), types);
        } else if (type instanceof Class<?> c && c.getPackageName().startsWith("app.accountbook") && types.add(c)
                && c.isRecord()) {
            Arrays.stream(c.getRecordComponents()).forEach(component -> reach(component.getGenericType(), types));
        }
    }

    private static String schemaName(Class<?> type) {
        Schema schema = type.getAnnotation(Schema.class);
        return schema != null && !schema.name().isEmpty() ? schema.name() : type.getSimpleName();
    }

    /** 객체마다 그 JSON pointer와 함께 부른다. */
    private static void walk(JsonNode node, String pointer, BiConsumer<String, JsonNode> visit) {
        if (node.isObject()) {
            visit.accept(pointer, node);
            node.properties().forEach(entry ->
                    walk(entry.getValue(), pointer + "/" + entry.getKey().replace("~", "~0").replace("/", "~1"), visit));
        } else if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) {
                walk(node.get(i), pointer + "/" + i, visit);
            }
        }
    }
}
