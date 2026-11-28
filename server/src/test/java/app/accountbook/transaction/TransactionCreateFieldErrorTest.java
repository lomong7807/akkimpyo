package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import app.accountbook.account.AccountService;
import app.accountbook.account.AccountType;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.user.User;
import java.time.LocalDate;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 만들기가 거부할 때 어느 입력란의 어떤 이유인지(#14의 {@code fieldErrors}, ADR 002 4절). API는 이것을 그대로 내보낸다.
 * 이 장부에 없거나 그사이 지워진 계좌·카테고리는 404가 아니라 그 입력란의 {@code NOT_FOUND}다.
 */
@IntegrationTest
class TransactionCreateFieldErrorTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final String DEVICE = "iphone.safari";

    @Autowired TransactionService transactionService;
    @Autowired AccountService accountService;
    @Autowired CategoryService categoryService;
    @Autowired Fixtures fixtures;

    User owner;
    UUID ledgerId;
    UUID cash;
    UUID bank;
    UUID removedAccount;
    UUID food;
    UUID salary;
    UUID removedCategory;
    UUID othersCash;
    UUID othersFood;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
        bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, DAY).getId();
        removedAccount = fixtures.account(owner, ledgerId, "지운계좌", AccountType.CASH, 0, DAY).getId();
        accountService.delete(owner.getId(), ledgerId, removedAccount);
        food = category(owner, ledgerId, "식비", CategoryKind.EXPENSE);
        salary = category(owner, ledgerId, "급여", CategoryKind.INCOME);
        removedCategory = category(owner, ledgerId, "지운분류", CategoryKind.EXPENSE);
        categoryService.delete(owner.getId(), ledgerId, removedCategory, null, null);

        User other = fixtures.user("other@example.com");
        UUID otherLedger = fixtures.personalLedgerId(other);
        othersCash = fixtures.account(other, otherLedger, "남의현금", AccountType.CASH, 0, DAY).getId();
        othersFood = category(other, otherLedger, "남의식비", CategoryKind.EXPENSE);
    }

    @TestFactory
    Stream<DynamicTest> 거부는_입력란과_이유를_담는다() {
        return Stream.of(
                rejected("id:REQUIRED", () -> expense(null, cash, null, 1_000)),
                rejected("occurredOn:REQUIRED", () -> new Entry(UUID.randomUUID(), TransactionType.EXPENSE, null,
                        null, cash, null, 1_000, null, null, null, null)),
                rejected("occurredOn:OUT_OF_RANGE", () -> new Entry(UUID.randomUUID(), TransactionType.EXPENSE,
                        LocalDate.of(1999, 12, 31), null, cash, null, 1_000, null, null, null, null)),
                rejected("type:REQUIRED", () -> new Entry(UUID.randomUUID(), null, DAY, null, cash, null, 1_000,
                        null, null, null, null)),
                rejected("amount:OUT_OF_RANGE", () -> expense(UUID.randomUUID(), cash, null, 0)),
                rejected("amount:OUT_OF_RANGE", () -> expense(UUID.randomUUID(), cash, null, 10_000_000_000L)),
                rejected("amount:OUT_OF_RANGE", () -> transfer(cash, bank, 0)),
                rejected("refundKind:NOT_ALLOWED", () -> new Entry(UUID.randomUUID(), TransactionType.INCOME, DAY, null,
                        cash, null, 1_000, RefundKind.REFUND, null, null, null)),
                rejected("accountId:REQUIRED", () -> expense(UUID.randomUUID(), null, null, 1_000)),
                rejected("fromAccountId:REQUIRED", () -> transfer(null, bank, 1_000)),
                rejected("toAccountId:REQUIRED", () -> transfer(cash, null, 1_000)),
                rejected("toAccountId:NOT_ALLOWED", () -> transfer(cash, cash, 1_000)),
                rejected("accountId:NOT_FOUND", () -> expense(UUID.randomUUID(), UUID.randomUUID(), null, 1_000)),
                rejected("accountId:NOT_FOUND", () -> expense(UUID.randomUUID(), removedAccount, null, 1_000)),
                rejected("accountId:NOT_FOUND", () -> expense(UUID.randomUUID(), othersCash, null, 1_000)),
                rejected("fromAccountId:NOT_FOUND", () -> transfer(removedAccount, bank, 1_000)),
                rejected("toAccountId:NOT_FOUND", () -> transfer(cash, othersCash, 1_000)),
                rejected("categoryId:NOT_FOUND", () -> expense(UUID.randomUUID(), cash, UUID.randomUUID(), 1_000)),
                rejected("categoryId:NOT_FOUND", () -> expense(UUID.randomUUID(), cash, removedCategory, 1_000)),
                rejected("categoryId:NOT_FOUND", () -> expense(UUID.randomUUID(), cash, othersFood, 1_000)),
                rejected("categoryId:NOT_ALLOWED", () -> expense(UUID.randomUUID(), cash, salary, 1_000)),
                rejected("categoryId:NOT_ALLOWED", () -> new Entry(UUID.randomUUID(), TransactionType.INCOME, DAY,
                        null, cash, food, 1_000, null, null, null, null)));
    }

    @TestFactory
    Stream<DynamicTest> 기기_값의_형식_오류는_deviceId_입력란이다() {
        return Stream.of("", "a phone", "iphone.safari\n", "가".repeat(3), "a".repeat(65))
                .map(device -> dynamicTest("[" + device + "]", () -> {
                    InvalidRequestException e = catchThrowableOfType(InvalidRequestException.class,
                            () -> transactionService.createOrReplay(owner.getId(), ledgerId,
                                    expense(UUID.randomUUID(), cash, null, 1_000), device));
                    assertThat(e.field()).isEqualTo(TransactionService.DEVICE_ID_FIELD).isEqualTo("deviceId");
                    assertThat(e.errors()).hasSize(1);
                    assertThat(e.code().name()).isEqualTo("INVALID_FORMAT");
                }));
    }

    private DynamicTest rejected(String expected, Supplier<TransactionCommand> cmd) {
        return dynamicTest(expected, () -> {
            InvalidRequestException e = catchThrowableOfType(InvalidRequestException.class,
                    () -> transactionService.createOrReplay(owner.getId(), ledgerId, cmd.get(), DEVICE));
            assertThat(e).as("거부된다").isNotNull();
            assertThat(e.errors()).extracting(error -> error.field() + ":" + error.code()).containsExactly(expected);
        });
    }

    private Entry expense(UUID id, UUID accountId, UUID categoryId, long amount) {
        return new Entry(id, TransactionType.EXPENSE, DAY, null, accountId, categoryId, amount, null, null, null,
                null);
    }

    private static Transfer transfer(UUID from, UUID to, long amount) {
        return new Transfer(UUID.randomUUID(), DAY, null, from, to, amount, null);
    }

    private UUID category(User actor, UUID ledger, String name, CategoryKind kind) {
        return categoryService.create(actor.getId(), ledger, new CategoryCommand(name, kind, null)).getId();
    }
}
