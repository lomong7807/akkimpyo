package app.accountbook.api;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;
import org.springframework.util.MultiValueMap;

/**
 * 중복 경고의 쿼리 값(#59 응답 계약). 여기서는 형식만 보고, 틀린 입력란을 모두 모아 한 번에 알린다(#15와 같다). 금액의 범위와
 * 가맹점의 글자는 조회가 거래를 저장할 때와 같은 규칙으로 본다. 있지만 빈 값({@code occurredOn=})과 같은 이름을 두 번 보낸
 * 것은 형식 오류다. 가맹점은 쉼표로 이어 붙이면 다른 가맹점이 되므로 값을 모두 받아 본다. 가맹점이 없으면 빈 가맹점과 같다.
 *
 * @param exclude 결과에서 뺄 거래. 없으면 null
 */
record TransactionDuplicateRequest(LocalDate occurredOn, long amount, String payee, UUID exclude) {

    /** 열 자리까지라 long을 넘지 않는다. 부호와 쉼표는 받지 않는다. */
    private static final Pattern AMOUNT = Pattern.compile("[0-9]{1,10}");

    static TransactionDuplicateRequest of(MultiValueMap<String, String> query) {
        List<InvalidRequestException> errors = new ArrayList<>();
        Optional<LocalDate> occurredOn = value(query, "occurredOn", true, TransactionRequest.DATE, LocalDate::parse,
                "occurredOn은 YYYY-MM-DD입니다.", errors);
        Optional<Long> amount = value(query, "amount", true, AMOUNT, Long::parseLong, "amount는 양의 정수입니다.",
                errors);
        Optional<UUID> exclude = value(query, "exclude", false, TransactionRequest.UUID_TEXT, UUID::fromString,
                "exclude는 거래 id입니다.", errors);
        List<String> payee = query.getOrDefault("payee", List.of());
        if (payee.size() > 1) {
            errors.add(new InvalidRequestException("payee", FieldErrorCode.INVALID_FORMAT,
                    "payee는 한 번만 보낼 수 있습니다."));
        }
        if (!errors.isEmpty()) {
            throw InvalidRequestException.ofAll(errors);
        }
        return new TransactionDuplicateRequest(occurredOn.orElseThrow(), amount.orElseThrow(),
                payee.isEmpty() ? null : payee.getFirst(), exclude.orElse(null));
    }

    /** 한 번 보낸 값을 읽는다. 없으면 빈 값이고 {@code required}면 {@code REQUIRED}를 더한다. */
    private static <T> Optional<T> value(MultiValueMap<String, String> query, String field, boolean required,
                                         Pattern shape, Function<String, T> parser, String message,
                                         List<InvalidRequestException> errors) {
        List<String> values = query.getOrDefault(field, List.of());
        if (values.isEmpty()) {
            if (required) {
                errors.add(new InvalidRequestException(field, FieldErrorCode.REQUIRED, "꼭 보내야 하는 값입니다."));
            }
            return Optional.empty();
        }
        Optional<T> parsed = values.size() == 1
                ? TransactionListRequest.parsed(shape, values.getFirst(), parser) : Optional.empty();
        if (parsed.isEmpty()) {
            errors.add(new InvalidRequestException(field, FieldErrorCode.INVALID_FORMAT, message));
        }
        return parsed;
    }
}
