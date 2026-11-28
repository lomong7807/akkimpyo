package app.accountbook.api;

import app.accountbook.category.Category;
import app.accountbook.category.CategoryService;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotFoundException;
import app.accountbook.transaction.DeviceIds;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 장부의 카테고리(F-509, F-510, F-511, F-512). 구성원 확인은 {@link LedgerMemberInterceptor}가 먼저 하고 서비스가 한 번 더
 * 한다.
 */
@RestController
@RequestMapping(path = "/api/v1/ledgers/{ledgerId}/categories", produces = MediaType.APPLICATION_JSON_VALUE)
class CategoryController {

    /** 삭제의 옮길 곳. 서비스가 옮길 곳 오류를 알리는 입력란과 같은 이름이다. */
    private static final String TARGET_PARAM = "targetCategoryId";

    private final CategoryService categoryService;

    CategoryController(CategoryService categoryService) {
        this.categoryService = categoryService;
    }

    /**
     * 최상위를 지출 먼저 다음 수입으로, 구분 안에서는 미분류가 맨 뒤이고 나머지는 만든 순서(같으면 id)다.
     * 하위는 상위의 {@code children}에 만든 순서로 든다. 카테고리를 한 번에 읽어 수와 상관없이 조회 횟수가 같다.
     */
    @GetMapping
    CategoryResponse.Items listCategories(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId) {
        return CategoryResponse.Items.of(categoryService.list(actorId, ledgerId));
    }

    /**
     * 201이고 본문은 목록의 항목과 같은 모양이다. 새 카테고리라 {@code children}은 비어 있다. {@code Location}은 이 카테고리의
     * 경로다. 응답할 수 없는 {@code Accept}와 JSON이 아닌 본문은 저장하기 전에 거절된다(ADR 002 5절).
     */
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<CategoryResponse> createCategory(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
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
    CategoryResponse renameCategory(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
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

    /**
     * 지우기 전에 보일 영향(F-512, #35). 옮겨질 거래 수(하위, 휴지통, 취소한 거래 포함, 거래 단위)와 함께 지워질 하위 수다. 미분류는
     * 409 {@code INVALID_STATE}, 이 장부의 카테고리가 아니면 404다. 하위 수는 목록을 따로 읽어 센다(이름 바꾸기와 같다).
     */
    @GetMapping("/{categoryId}/deletion-impact")
    CategoryDeletionImpactResponse getCategoryDeletionImpact(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                                                  @PathVariable UUID categoryId) {
        long transactionCount = categoryService.countAffectedTransactions(actorId, ledgerId, categoryId);
        return CategoryDeletionImpactResponse.of(categoryId, transactionCount, categoryService.list(actorId, ledgerId));
    }

    /**
     * 지운다(F-512, P-222, #35). 204다. 카테고리와 하위의 거래(휴지통, 취소 포함)를 {@code targetCategoryId}로, 없으면 같은
     * 구분의 미분류로 옮기고 하위도 지운다. 기기 값은 거래 쓰기(#14)와 같은 헤더로 받고 없으면 {@code unknown}이다.
     *
     * <p>검사 순서: 이 장부의 카테고리인지(404) → 형식(400, 옮길 곳이 UUID가 아님과 기기 값을 함께) → 옮길 곳(400, 서비스) →
     * 미분류(409 {@code INVALID_STATE}, 서비스). 기기 값은 서비스가 옮기기 직전에야 보므로 여기서 먼저 본다.
     */
    @DeleteMapping("/{categoryId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void deleteCategory(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId, @PathVariable UUID categoryId,
                @RequestParam(name = TARGET_PARAM, required = false) String target,
                @RequestHeader(name = TransactionController.DEVICE_HEADER, required = false) String device) {
        List<InvalidRequestException> errors = new ArrayList<>();
        UUID targetId = targetOf(target, errors);
        String deviceId = deviceOf(device, errors);
        if (!errors.isEmpty()) {
            requireInLedger(actorId, ledgerId, categoryId);
            throw InvalidRequestException.ofAll(errors);
        }
        categoryService.delete(actorId, ledgerId, categoryId, targetId, deviceId);
    }

    /** 형식 오류보다 404가 먼저다(이름 바꾸기와 같다). 형식이 맞으면 서비스가 잠근 뒤 보므로 형식이 틀렸을 때만 부른다. */
    private void requireInLedger(UUID actorId, UUID ledgerId, UUID categoryId) {
        if (categoryService.list(actorId, ledgerId).stream().noneMatch(found -> found.getId().equals(categoryId))) {
            throw new NotFoundException();
        }
    }

    /** 없으면 null(미분류로 옮긴다). 비었거나 여러 번 보냈거나(쉼표로 이어진다) UUID가 아니면 형식 오류다. */
    private static UUID targetOf(String text, List<InvalidRequestException> errors) {
        if (text == null) {
            return null;
        }
        if (TransactionRequest.UUID_TEXT.matcher(text).matches()) {
            return UUID.fromString(text);
        }
        errors.add(new InvalidRequestException(TARGET_PARAM, FieldErrorCode.INVALID_FORMAT,
                "옮길 카테고리 id는 UUID입니다."));
        return null;
    }

    /** 거래 쓰기(#14)와 같은 규칙이고, 오류는 받은 자리인 헤더의 이름으로 알린다. */
    private static String deviceOf(String header, List<InvalidRequestException> errors) {
        if (header == null) {
            return TransactionController.UNKNOWN_DEVICE;
        }
        try {
            DeviceIds.requireValidFormat(header);
        } catch (InvalidRequestException e) {
            errors.add(new InvalidRequestException(TransactionController.DEVICE_HEADER, e.code(), e.getMessage()));
        }
        return header;
    }
}
