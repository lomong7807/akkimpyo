package app.accountbook.ledger;

import java.util.UUID;

/** 사용자가 구성원인 장부 하나와 그 장부에서의 권한. */
public record LedgerMembership(UUID ledgerId, String name, LedgerRole role) {
}
