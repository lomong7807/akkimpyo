package app.accountbook.api;

import app.accountbook.category.Category;
import app.accountbook.category.CategoryService;
import app.accountbook.common.InvalidRequestException;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 장부의 카테고리(F-509, F-510, F-511). 구성원 확인은 {@link LedgerMemberInterceptor}가 먼저 하고 서비스가 한 번 더 한다. */
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

    /**
     * 201이고 본문은 목록의 항목과 같은 모양이다. 새 카테고리라 {@code children}은 비어 있다. {@code Location}은 이 카테고리의
     * 경로다. 응답할 수 없는 {@code Accept}와 JSON이 아닌 본문은 저장하기 전에 거절된다(ADR 002 5절).
     */
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<CategoryResponse> create(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                                            @RequestBody CategoryRequest request) {
        Category category = categoryService.create(actorId, ledgerId, request.command());
        return ResponseEntity.created(URI.create("/api/v1/ledgers/" + ledgerId + "/categories/" + category.getId()))
                .body(CategoryResponse.of(category, List.of()));
    }

    /**
     * 200이고 본문은 목록의 항목과 같은 모양이다. 최상위면 지금의 하위를 목록과 같은 순서로 담는다. 하위는 저장한 뒤 목록 조회로
     * 따로 구한다(ADR 004 결정 6). 이 장부의 카테고리가 아니면(내가 구성원인 다른 장부의 것, 없거나 지운 것) 본문이 틀려도 404다.
     */
    @PutMapping(path = "/{categoryId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    CategoryResponse rename(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                            @PathVariable UUID categoryId, @RequestBody CategoryRequest.Rename request) {
        CategoryRequest.Rename.Read read = request.read();
        Category category;
        try {
            category = categoryService.rename(actorId, ledgerId, categoryId, read.name());
        } catch (InvalidRequestException e) {
            throw read.explain(e);
        }
        return CategoryResponse.of(category, categoryService.list(actorId, ledgerId));
    }
}
