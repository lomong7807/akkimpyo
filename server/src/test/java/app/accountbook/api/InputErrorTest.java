package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.common.DuplicateAccountNameException;
import app.accountbook.common.DuplicateCategoryNameException;
import app.accountbook.common.DuplicateEmailException;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.InvalidStateException;
import app.accountbook.common.NotFoundException;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.user.PasswordHashBusyException;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import tools.jackson.databind.JsonNode;

/** 입력 오류와 서비스 예외가 ADR 002 4·5절의 code와 입력란으로 나간다(#12). */
@ApiErrorTest
class InputErrorTest {

    private static final String BODY = ErrorProbeController.PATH + "/body";
    private static final String QUERY = ErrorProbeController.PATH + "/query";
    private static final String THROW = ErrorProbeController.PATH + "/throw";

    @LocalServerPort int port;
    @Autowired ErrorProbeController probe;

    private ServerClient server;

    @BeforeEach
    void setUp() {
        server = new ServerClient(port);
    }

    // --- 400 VALIDATION_FAILED: 요청 본문 ---

    static Stream<Arguments> invalidBodies() {
        return Stream.of(
                argumentSet("필수 값이 없다", "{}", List.of("name:REQUIRED", "amount:REQUIRED")),
                argumentSet("필수 값이 null이다", "{\"name\":null,\"amount\":null}",
                        List.of("name:REQUIRED", "amount:REQUIRED")),
                argumentSet("글자가 공백뿐이다", "{\"name\":\" \",\"amount\":1}", List.of("name:REQUIRED")),
                argumentSet("글자가 길다", "{\"name\":\"여섯글자이름\",\"amount\":1}", List.of("name:TOO_LONG")),
                argumentSet("수가 작다", "{\"name\":\"a\",\"amount\":0}", List.of("amount:OUT_OF_RANGE")),
                argumentSet("수가 크다", "{\"name\":\"a\",\"amount\":101}", List.of("amount:OUT_OF_RANGE")),
                argumentSet("이메일 형식이 아니다", "{\"name\":\"a\",\"amount\":1,\"email\":\"x\"}",
                        List.of("email:INVALID_FORMAT")),
                argumentSet("정해진 글자가 아니다", "{\"name\":\"a\",\"amount\":1,\"code\":\"12\"}",
                        List.of("code:INVALID_FORMAT")),
                argumentSet("글자가 짧다", "{\"name\":\"a\",\"amount\":1,\"code\":\"a\"}", List.of("code:INVALID_FORMAT")),
                argumentSet("목록이 비었다", "{\"name\":\"a\",\"amount\":1,\"lines\":[]}", List.of("lines:REQUIRED")),
                argumentSet("값의 조합이 규칙에 맞지 않는다", "{\"name\":\"a\",\"amount\":1,\"code\":\"zz\"}",
                        List.of("allowed:NOT_ALLOWED")),
                argumentSet("목록 안의 값", "{\"name\":\"a\",\"amount\":1,\"lines\":[{\"amount\":1},{\"amount\":0}]}",
                        List.of("lines[1].amount:OUT_OF_RANGE")));
    }

    @ParameterizedTest
    @MethodSource("invalidBodies")
    void 본문의_검증_실패는_입력란마다_알린다(String json, List<String> expected) throws Exception {
        server.postJson(BODY, json).assertFieldErrors(expected.toArray(String[]::new));
    }

    static Stream<Arguments> wrongTypes() {
        return Stream.of(
                argumentSet("수 자리에 글자", "{\"name\":\"a\",\"amount\":\"abc\"}", "amount:INVALID_FORMAT"),
                argumentSet("글자로 적은 수", "{\"name\":\"a\",\"amount\":\"5\"}", "amount:INVALID_FORMAT"),
                argumentSet("정수 자리에 소수", "{\"name\":\"a\",\"amount\":1.9}", "amount:INVALID_FORMAT"),
                argumentSet("글자 자리에 수", "{\"name\":1,\"amount\":1}", "name:INVALID_FORMAT"),
                argumentSet("정해진 값 자리에 수", "{\"name\":\"a\",\"amount\":1,\"kind\":0}", "kind:INVALID_FORMAT"),
                argumentSet("목록 안에 글자로 적은 수", "{\"name\":\"a\",\"amount\":1,\"lines\":[{\"amount\":\"1\"}]}",
                        "lines[0].amount:INVALID_FORMAT"),
                argumentSet("수 자리에 객체", "{\"name\":\"a\",\"amount\":{}}", "amount:INVALID_FORMAT"),
                argumentSet("글자 자리에 객체", "{\"name\":{},\"amount\":1}", "name:INVALID_FORMAT"),
                argumentSet("날짜가 아니다", "{\"name\":\"a\",\"amount\":1,\"occurredOn\":\"2026-02-30\"}",
                        "occurredOn:INVALID_FORMAT"),
                argumentSet("정해진 값이 아니다", "{\"name\":\"a\",\"amount\":1,\"kind\":\"C\"}", "kind:INVALID_FORMAT"),
                argumentSet("목록 자리에 글자", "{\"name\":\"a\",\"amount\":1,\"lines\":\"x\"}", "lines:INVALID_FORMAT"),
                argumentSet("목록 안의 값", "{\"name\":\"a\",\"amount\":1,\"lines\":[{\"amount\":1},{\"amount\":\"x\"}]}",
                        "lines[1].amount:INVALID_FORMAT"),
                argumentSet("long에 담기지 않는 수", "{\"name\":\"a\",\"amount\":99999999999999999999}",
                        "amount:OUT_OF_RANGE"),
                argumentSet("본문이 배열", "[]", ":INVALID_FORMAT"),
                argumentSet("본문이 글자", "\"text\"", ":INVALID_FORMAT"));
    }

    @ParameterizedTest
    @MethodSource("wrongTypes")
    void JSON은_읽히지만_값의_형이_틀리면_그_입력란의_오류다(String json, String expected) throws Exception {
        server.postJson(BODY, json).assertFieldErrors(expected);
    }

    // --- 400 VALIDATION_FAILED: 쿼리 값 ---

    static Stream<Arguments> invalidQueries() {
        return Stream.of(
                argumentSet("없다", "", "version:REQUIRED"),
                argumentSet("비었다", "?version=", "version:INVALID_FORMAT"),
                argumentSet("정수가 아니다", "?version=1.5", "version:INVALID_FORMAT"),
                argumentSet("int에 담기지 않는다", "?version=99999999999", "version:INVALID_FORMAT"),
                argumentSet("UUID가 아니다", "?version=1&cursor=x", "cursor:INVALID_FORMAT"),
                argumentSet("쿼리 이름이 인자 이름과 다르다", "?version=1&limit=x", "limit:INVALID_FORMAT"),
                argumentSet("상한을 넘는다", "?version=1&limit=101", "limit:OUT_OF_RANGE"));
    }

    @ParameterizedTest
    @MethodSource("invalidQueries")
    void 쿼리_값의_오류는_쿼리_이름으로_알린다(String query, String expected) throws Exception {
        server.get(QUERY + query).assertFieldErrors(expected);
    }

    @Test
    void 쿼리와_본문의_검증_실패를_함께_알린다() throws Exception {
        server.postJson(ErrorProbeController.PATH + "/query-and-body?limit=101", "{\"name\":\"a\",\"amount\":0}")
                .assertFieldErrors("limit:OUT_OF_RANGE", "amount:OUT_OF_RANGE");
    }

    // --- 404 NOT_FOUND ---

    @ParameterizedTest
    @ValueSource(strings = {"/ledgers/not-a-uuid", "/ledgers/123", "/ledgers/%20", "/codes/toolong"})
    void 경로의_값이_형식에_맞지_않으면_없는_자원과_같다(String path) throws Exception {
        server.get(ErrorProbeController.PATH + path).assertProblem(404, "Not Found", "NOT_FOUND");
    }

    @Test
    void 없는_것과_구성원이_아닌_것과_형식이_틀린_것을_구분할_수_없다() throws Exception {
        probe.willThrow(new NotFoundException());
        Reply notFound = server.get(THROW).assertProblem(404, "Not Found", "NOT_FOUND");
        probe.willThrow(new NotLedgerMemberException());
        Reply notMember = server.get(THROW).assertProblem(404, "Not Found", "NOT_FOUND");
        Reply notUuid = server.get(ErrorProbeController.PATH + "/ledgers/not-a-uuid");
        Reply noPath = server.get("/api/v1/ledgers/" + UUID.randomUUID());

        assertThat(Stream.of(notFound, notMember, notUuid, noPath).map(InputErrorTest::withoutRequestId))
                .containsOnly(withoutRequestId(notFound));
        assertThat(Stream.of(notFound, notMember, notUuid, noPath).map(reply -> reply.headers().keySet()))
                .containsOnly(notFound.headers().keySet());
    }

    // --- 서비스의 예외 ---

    @Test
    void 입력란을_담은_서비스의_입력_오류는_그_입력란으로_알린다() throws Exception {
        probe.willThrow(new InvalidRequestException("amount", FieldErrorCode.OUT_OF_RANGE, "금액이 큽니다."));

        server.get(THROW).assertFieldErrors("amount:OUT_OF_RANGE");
    }

    @Test
    void 본문_전체의_입력_오류는_빈_입력란으로_알린다() throws Exception {
        probe.willThrow(new InvalidRequestException(InvalidRequestException.WHOLE_BODY, FieldErrorCode.NOT_ALLOWED,
                "미분류는 바꿀 수 없습니다."));

        server.get(THROW).assertFieldErrors(":NOT_ALLOWED");
    }

    /** 입력란과 무관한 상태 오류는 400이 아니라 입력란 없는 409다(ADR 002 5절, #14). 문구는 나가지 않는다. */
    @Test
    void 상태_오류는_409_INVALID_STATE다() throws Exception {
        probe.willThrow(new InvalidStateException("이미 삭제된 거래입니다."));

        Reply reply = server.get(THROW).assertProblem(409, "Conflict", "INVALID_STATE");

        assertThat(reply.body()).doesNotContain("이미 삭제된 거래입니다.");
    }

    static Stream<Arguments> duplicates() {
        return Stream.of(
                argumentSet("계좌 이름", new DuplicateAccountNameException(), "name:DUPLICATE"),
                argumentSet("카테고리 이름", new DuplicateCategoryNameException(), "name:DUPLICATE"),
                argumentSet("이메일", new DuplicateEmailException(), "email:DUPLICATE"));
    }

    @ParameterizedTest
    @MethodSource("duplicates")
    void 겹치는_값은_그_입력란의_DUPLICATE다(Exception exception, String expected) throws Exception {
        probe.willThrow(exception);

        server.get(THROW).assertFieldErrors(expected);
    }

    @Test
    void 비밀번호_해시의_상한은_429이고_1초_뒤에_다시_보내라고_알린다() throws Exception {
        probe.willThrow(BeanUtils.instantiateClass(PasswordHashBusyException.class));

        Reply reply = server.get(THROW).assertProblem(429, "Too Many Requests", "TOO_MANY_REQUESTS");

        assertThat(reply.header("Retry-After")).isEqualTo("1");
    }

    private static List<String> withoutRequestId(Reply reply) {
        JsonNode problem = reply.json();
        return problem.propertyNames().stream()
                .filter(name -> !name.equals("requestId"))
                .sorted()
                .map(name -> name + "=" + problem.get(name))
                .toList();
    }
}
