package app.accountbook.api;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.transaction.CategorySuggestionQuery;
import io.swagger.v3.oas.annotations.Parameter;
import java.util.List;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 가맹점별 최근 카테고리 제안(P-219, #61). 구성원 확인은 {@link LedgerMemberInterceptor}가 먼저 하고 조회가 한 번 더 한다. */
@RestController
@RequestMapping(path = "/api/v1/ledgers/{ledgerId}/category-suggestions", produces = MediaType.APPLICATION_JSON_VALUE)
class CategorySuggestionController {

    private static final String PAYEE = "payee";

    private final CategorySuggestionQuery categorySuggestionQuery;

    CategorySuggestionController(CategorySuggestionQuery categorySuggestionQuery) {
        this.categorySuggestionQuery = categorySuggestionQuery;
    }

    /**
     * {@code GET ?payee=...} → {@code { "categoryId": uuid | null }}(#61 응답 계약). {@code payee}가 없으면 빈 가맹점과 같다.
     * 같은 이름을 두 번 보내면 형식 오류다. 스프링이 쉼표로 이어 붙이면 다른 가맹점이 되므로 값을 모두 받아 본다.
     * 구성원이 아니면 {@code payee}가 틀려도 {@link LedgerMemberInterceptor}가 먼저 404로 답한다.
     */
    @GetMapping
    CategorySuggestionResponse suggestCategories(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                                       @Parameter(hidden = true) @RequestParam MultiValueMap<String, String> query) {
        List<String> payee = query.getOrDefault(PAYEE, List.of());
        if (payee.size() > 1) {
            throw new InvalidRequestException(PAYEE, FieldErrorCode.INVALID_FORMAT, "payee는 한 번만 보낼 수 있습니다.");
        }
        return new CategorySuggestionResponse(categorySuggestionQuery
                .suggest(actorId, ledgerId, payee.isEmpty() ? null : payee.getFirst())
                .orElse(null));
    }
}
