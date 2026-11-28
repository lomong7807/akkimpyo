package app.accountbook.api;

import io.swagger.v3.core.converter.ModelConverters;
import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.servers.Server;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springdoc.core.utils.SpringDocUtils;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import tools.jackson.databind.JsonNode;

/**
 * 문서 테스트({@link OpenApiDocTest})만 쓰는 springdoc 설정(ADR 003 결정 5~7). {@link Problem}과 {@link ErrorCode}가 패키지
 * 안에서만 보여 같은 패키지에 둔다. 오류 응답은 손으로 옮겨 적지 않고 이 둘에서 만든다.
 */
@TestConfiguration(proxyBeanMethods = false)
class OpenApiDocConfig {

    static final String BEARER = "bearer";
    static final String CLIENT_HEADER = "X-Akkimpyo-Client";
    static final String PROBLEM_JSON = "application/problem+json";

    static {
        // 요청 DTO의 JsonNode 필드는 값을 직접 검사하려고 받는 것이라 그 타입의 속성을 싣지 않는다. 필드의 모양은 어노테이션이 적는다.
        SpringDocUtils.getConfig().replaceWithSchema(JsonNode.class, new Schema<>());
    }

    @Bean
    OpenAPI openApi() {
        return new OpenAPI()
                .info(new Info().title("아낌표 API").version("v1"))
                .servers(List.of(new Server().url("/")))
                .components(new Components().addSecuritySchemes(BEARER, new SecurityScheme()
                        .type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")))
                .addSecurityItem(new SecurityRequirement().addList(BEARER));
    }

    @Bean
    OpenApiCustomizer errorResponses() {
        return openApi -> {
            Components components = openApi.getComponents();
            problemSchemas().forEach(components::addSchemas);
            statusCodes().forEach((status, codes) -> components.addResponses(responseName(status), new ApiResponse()
                    .description("code: " + codes)
                    .content(new Content().addMediaType(PROBLEM_JSON, new MediaType()
                            .schema(new Schema<>().$ref("#/components/schemas/Problem"))))));
            openApi.getPaths().forEach((path, item) -> item.readOperations().forEach(op -> attach(path, op)));
        };
    }

    /** 표의 조건으로 붙는 오류 응답(ADR 003 결정 7). 동작에 어노테이션으로 적은 것은 그대로 둔다. */
    private static void attach(String path, Operation op) {
        ApiResponses responses = op.getResponses();
        add(responses, 400);
        add(responses, 500);
        if (op.getSecurity() == null) {
            add(responses, 401);
        }
        if (path.startsWith("/api/v1/auth/")) {
            add(responses, 403);
            op.addParametersItem(new Parameter().in("header").name(CLIENT_HEADER).required(true)
                    .description("화면이 보낸 요청이라는 표시. 값은 보지 않는다")
                    .schema(new Schema<String>().type("string").types(Set.of("string"))));
        }
        if (op.getRequestBody() != null) {
            add(responses, 415);
        }
        if (path.contains("{")) {
            add(responses, 404);
        }
    }

    private static void add(ApiResponses responses, int status) {
        responses.computeIfAbsent(String.valueOf(status),
                key -> new ApiResponse().$ref("#/components/responses/" + responseName(status)));
    }

    static String responseName(int status) {
        return "Error" + status;
    }

    /** 상태마다 그 상태로 나가는 code 이름들. code가 늘면 문서가 따라 바뀐다. */
    static Map<Integer, String> statusCodes() {
        return Arrays.stream(ErrorCode.values()).collect(Collectors.groupingBy(code -> code.status().value(), TreeMap::new,
                Collectors.mapping(ErrorCode::name, Collectors.joining(", "))));
    }

    /** {@link Problem}의 스키마. {@code fieldErrors}와 {@code current}는 없을 때 빠지고 나머지는 늘 있다. */
    @SuppressWarnings("rawtypes")
    private static Map<String, Schema> problemSchemas() {
        Map<String, Schema> schemas = ModelConverters.getInstance(true).readAll(Problem.class);
        Schema<?> problem = schemas.get("Problem");
        problem.setRequired(problem.getProperties().keySet().stream()
                .filter(name -> !name.equals("fieldErrors") && !name.equals("current")).sorted().toList());
        Schema<?> field = schemas.get("InvalidField");
        field.setRequired(field.getProperties().keySet().stream().sorted().toList());
        ((Schema<?>) problem.getProperties().get("code"))
                .setDescription("오류 코드. 늘어날 수 있다. 모르는 code는 status로 처리한다");
        return schemas;
    }
}
