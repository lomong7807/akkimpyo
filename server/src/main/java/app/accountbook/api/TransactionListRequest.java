package app.accountbook.api;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.transaction.TransactionKey;
import app.accountbook.transaction.TransactionListQuery;
import app.accountbook.transaction.TransactionScope;
import app.accountbook.transaction.TransactionScope.Day;
import app.accountbook.transaction.TransactionScope.Month;
import app.accountbook.transaction.TransactionScope.WholeLedger;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;

/**
 * 거래 목록의 쿼리 값(#15 응답 계약). 여기서는 형식만 보고, 틀린 입력란을 모두 모아 한 번에 알린다. 달·날짜·limit의 범위는
 * 장부 시간대의 오늘로 서비스가 본다. {@code month}와 {@code date}가 모두 없으면 장부 전체다. 정렬처럼 계약에 없는 쿼리
 * 이름은 무시한다. 같은 이름을 두 번 보내면 스프링이 쉼표로 이어 붙여 형식 오류가 된다. 있지만 빈 값({@code month=})도
 * 형식 오류다(없는 것으로 보지 않는다).
 *
 * @param after cursor의 키. 첫 쪽이면 null
 */
record TransactionListRequest(TransactionScope scope, int limit, TransactionKey after) {

    private static final Pattern MONTH = Pattern.compile("[0-9]{4}-[0-9]{2}");
    private static final Pattern DATE = Pattern.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}");
    /** 아홉 자리까지라 int를 넘지 않는다. 범위(1~50) 밖은 서비스의 {@code OUT_OF_RANGE}다. */
    private static final Pattern INTEGER = Pattern.compile("[+-]?[0-9]{1,9}");

    static TransactionListRequest of(UUID ledgerId, String month, String date, String limit, String cursor) {
        List<InvalidRequestException> errors = new ArrayList<>();
        Optional<TransactionScope> scope = scope(month, date, errors);
        Optional<Integer> size = limit == null ? Optional.of(TransactionListQuery.MAX_LIMIT)
                : parsed(INTEGER, limit, Integer::parseInt);
        if (size.isEmpty()) {
            errors.add(invalidFormat("limit", "limit은 정수입니다."));
        }
        Optional<TransactionKey> after = Optional.empty();
        // 범위를 읽지 못했으면 cursor가 그 범위의 것인지 알 수 없어 보지 않는다.
        if (cursor != null && scope.isPresent()) {
            after = TransactionCursor.decode(cursor, ledgerId, scope.get());
            if (after.isEmpty()) {
                errors.add(invalidFormat("cursor", "이 목록에서 받은 cursor가 아닙니다."));
            }
        }
        if (!errors.isEmpty()) {
            throw InvalidRequestException.ofAll(errors);
        }
        return new TransactionListRequest(scope.orElseThrow(), size.orElseThrow(), after.orElse(null));
    }

    private static Optional<TransactionScope> scope(String month, String date, List<InvalidRequestException> errors) {
        if (month != null && date != null) {
            errors.add(new InvalidRequestException("date", FieldErrorCode.NOT_ALLOWED,
                    "month와 date는 함께 쓸 수 없습니다."));
            return Optional.empty();
        }
        if (month != null) {
            Optional<YearMonth> parsed = month(month);
            if (parsed.isEmpty()) {
                errors.add(invalidMonth());
            }
            return parsed.<TransactionScope>map(Month::new);
        }
        if (date != null) {
            Optional<TransactionScope> parsed = parsed(DATE, date, text -> new Day(LocalDate.parse(text)));
            if (parsed.isEmpty()) {
                errors.add(invalidFormat("date", "date는 YYYY-MM-DD입니다."));
            }
            return parsed;
        }
        return Optional.of(new WholeLedger());
    }

    /** {@code month} 쿼리 값({@code YYYY-MM}). 달력의 날짜별 합계(#66)도 같은 형식으로 읽는다. 틀리면 빈 값이다. */
    static Optional<YearMonth> month(String text) {
        return parsed(MONTH, text, YearMonth::parse);
    }

    /** {@link #month}가 읽지 못한 값의 오류. */
    static InvalidRequestException invalidMonth() {
        return invalidFormat("month", "month는 YYYY-MM입니다.");
    }

    /** 모양이 맞고 값으로 읽히면 그 값. 13월, 평년의 2월 29일처럼 모양만 맞는 글자도 형식 오류다. */
    private static <T> Optional<T> parsed(Pattern shape, String text, Function<String, T> parser) {
        if (!shape.matcher(text).matches()) {
            return Optional.empty();
        }
        try {
            return Optional.of(parser.apply(text));
        } catch (DateTimeException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    private static InvalidRequestException invalidFormat(String field, String message) {
        return new InvalidRequestException(field, FieldErrorCode.INVALID_FORMAT, message);
    }
}
