package app.accountbook.api;

import app.accountbook.category.CategoryService;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 장부의 카테고리(F-509, #34). 구성원 확인은 {@link LedgerMemberInterceptor}가 먼저 하고 서비스가 한 번 더 한다. */
@RestController
@RequestMapping(path = "/api/v1/ledgers/{ledgerId}/categories", produces = MediaType.APPLICATION_JSON_VALUE)
class CategoryController {

    private final CategoryService categoryService;

    CategoryController(CategoryService categoryService) {
        this.categoryService = categoryService;
    }

    /**
     * 최상위를 지출 먼저 다음 수입으로, 구분 안에서는 미분류가 맨 뒤이고 나머지는 만든 순서(같으면 id)다.
     * 하위는 상위의 {@code children}에 만든 순서로 든다. 카테고리를 한 번에 읽어 수와 상관없이 조회 횟수가 같다.
     */
    @GetMapping
    CategoryResponse.Items list(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId) {
        return CategoryResponse.Items.of(categoryService.list(actorId, ledgerId));
    }
}
