package app.accountbook.api;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.transaction.TransactionFilter;
import app.accountbook.transaction.TransactionKey;
import app.accountbook.transaction.TransactionListQuery;
import app.accountbook.transaction.TransactionScope;
import app.accountbook.transaction.TransactionScope.Day;
import app.accountbook.transaction.TransactionScope.Month;
import app.accountbook.transaction.TransactionScope.WholeLedger;
import app.accountbook.transaction.TransactionStatus;
import app.accountbook.transaction.TransactionType;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.util.MultiValueMap;

/**
 * 거래 목록의 쿼리 값(#15 응답 계약). 여기서는 형식만 보고, 틀린 입력란을 모두 모아 한 번에 알린다. 달·날짜·limit의 범위는
 * 장부 시간대의 오늘로 서비스가 본다. {@code month}와 {@code date}가 모두 없으면 장부 전체다. 정렬처럼 계약에 없는 쿼리
 * 이름은 무시한다. 같은 이름을 두 번 보내면 스프링이 쉼표로 이어 붙여 형식 오류가 된다. 있지만 빈 값({@code month=})도
 * 형식 오류다(없는 것으로 보지 않는다).
 *
 * <p>필터(#62): {@code accountId}, {@code categoryId}, {@code type}은 같은 이름을 여러 번 보내면 또는이고 한 이름에
 * {@value #MAX_FILTER_VALUES}개까지다(넘으면 {@code OUT_OF_RANGE}). 값을 쉼표로 나누지 않는다. {@code type}은 응답의
 * {@code type}과 같은 이름이고, {@code status}는 한 번만 받으며 응답의 {@code status} 가운데 1단계에서 고를 수 있는 것만
 * 받는다(F-219). 계좌·카테고리가 이 장부에 있는지는 서비스가 본다.
 *
 * @param after cursor의 키. 첫 쪽이면 null
 */
record TransactionListRequest(TransactionScope scope, TransactionFilter filter, int limit, TransactionKey after) {

    /** 필터 한 이름에 받는 값의 수(#62). */
    static final int MAX_FILTER_VALUES = 20;

    private static final Pattern MONTH = Pattern.compile("[0-9]{4}-[0-9]{2}");
    private static final Pattern DATE = Pattern.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}");
    /** 아홉 자리까지라 int를 넘지 않는다. 범위(1~50) 밖은 서비스의 {@code OUT_OF_RANGE}다. */
    private static final Pattern INTEGER = Pattern.compile("[+-]?[0-9]{1,9}");
    /** 승인 대기({@code PENDING})는 3단계에서 더한다(F-219). */
    private static final Set<TransactionStatus> STATUSES = Set.of(TransactionStatus.POSTED, TransactionStatus.CANCELED);

    /** @param query 모든 쿼리 값. 필터는 여기서 이름마다 보낸 값을 모두 읽는다 */
    static TransactionListRequest of(UUID ledgerId, String month, String date, String limit, String cursor,
                                     MultiValueMap<String, String> query) {
        List<InvalidRequestException> errors = new ArrayList<>();
        Optional<TransactionScope> scope = scope(month, date, errors);
        Optional<TransactionFilter> filter = filter(query, errors);
        Optional<Integer> size = limit == null ? Optional.of(TransactionListQuery.MAX_LIMIT)
                : parsed(INTEGER, limit, Integer::parseInt);
        if (size.isEmpty()) {
            errors.add(invalidFormat("limit", "limit은 정수입니다."));
        }
        Optional<TransactionKey> after = Optional.empty();
        // 범위나 필터를 읽지 못했으면 cursor가 그 목록의 것인지 알 수 없어 보지 않는다.
        if (cursor != null && scope.isPresent() && filter.isPresent()) {
            after = TransactionCursor.decode(cursor, ledgerId, scope.get(), filter.get());
            if (after.isEmpty()) {
                errors.add(invalidFormat("cursor", "이 목록에서 받은 cursor가 아닙니다."));
            }
        }
        if (!errors.isEmpty()) {
            throw InvalidRequestException.ofAll(errors);
        }
        return new TransactionListRequest(scope.orElseThrow(), filter.orElseThrow(), size.orElseThrow(),
                after.orElse(null));
    }

    /** 필터의 형식. 틀린 이름이 하나라도 있으면 비어 있다. */
    private static Optional<TransactionFilter> filter(MultiValueMap<String, String> query,
                                                      List<InvalidRequestException> errors) {
        int before = errors.size();
        Set<UUID> accountIds = values(query, "accountId",
                text -> parsed(TransactionRequest.UUID_TEXT, text, UUID::fromString), "accountId는 계좌 id입니다.", errors);
        Set<UUID> categoryIds = values(query, "categoryId",
                text -> parsed(TransactionRequest.UUID_TEXT, text, UUID::fromString), "categoryId는 카테고리 id입니다.",
                errors);
        Set<TransactionType> types = values(query, "type", text -> named(TransactionType.values(), text),
                "type은 EXPENSE, INCOME, TRANSFER입니다.", errors);
        List<String> status = query.getOrDefault("status", List.of());
        Optional<TransactionStatus> chosen = status.size() == 1
                ? named(TransactionStatus.values(), status.getFirst()).filter(STATUSES::contains) : Optional.empty();
        if (!status.isEmpty() && chosen.isEmpty()) {
            errors.add(invalidFormat("status", "status는 한 번만 보내고 POSTED나 CANCELED입니다."));
        }
        return errors.size() > before ? Optional.empty()
                : Optional.of(new TransactionFilter(accountIds, categoryIds, types, chosen.orElse(null)));
    }

    /** 한 이름으로 보낸 값들. 개수가 넘거나 하나라도 읽지 못하면 그 이름의 오류를 더하고 비어 있다. */
    private static <T> Set<T> values(MultiValueMap<String, String> query, String field,
                                     Function<String, Optional<T>> parser, String message,
                                     List<InvalidRequestException> errors) {
        List<String> texts = query.getOrDefault(field, List.of());
        if (texts.size() > MAX_FILTER_VALUES) {
            errors.add(new InvalidRequestException(field, FieldErrorCode.OUT_OF_RANGE,
                    "한 이름에 " + MAX_FILTER_VALUES + "개까지 보낼 수 있습니다."));
            return Set.of();
        }
        List<Optional<T>> parsed = texts.stream().map(parser).toList();
        if (parsed.stream().anyMatch(Optional::isEmpty)) {
            errors.add(invalidFormat(field, message));
            return Set.of();
        }
        return parsed.stream().map(Optional::orElseThrow).collect(Collectors.toUnmodifiableSet());
    }

    /** 이름이 글자 그대로(대소문자 포함) 같은 값. */
    private static <E extends Enum<E>> Optional<E> named(E[] values, String text) {
        return Arrays.stream(values).filter(value -> value.name().equals(text)).findFirst();
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
            Optional<TransactionScope> parsed = date(date).<TransactionScope>map(Day::new);
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

    /** {@code date} 쿼리 값({@code YYYY-MM-DD}). 내보내기의 기간(#57)도 같은 형식으로 읽는다. 틀리면 빈 값이다. */
    static Optional<LocalDate> date(String text) {
        return parsed(DATE, text, LocalDate::parse);
    }

    /** {@link #month}가 읽지 못한 값의 오류. */
    static InvalidRequestException invalidMonth() {
        return invalidFormat("month", "month는 YYYY-MM입니다.");
    }

    /** 모양이 맞고 값으로 읽히면 그 값. 13월, 평년의 2월 29일처럼 모양만 맞는 글자도 형식 오류다. */
    static <T> Optional<T> parsed(Pattern shape, String text, Function<String, T> parser) {
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
