-- 미분류 유일성(P-204)과 상위 카테고리 규칙(P-221), 이슈 #65.
-- 이미 어긋난 행(같은 장부·구분의 미분류 둘 이상, 상위가 다른 장부·다른 구분, 자기 자신이 상위)이 있으면 실패한다.
-- 그 행을 먼저 고친 뒤 다시 적용한다. 2단계 깊이 제한은 CHECK로 걸 수 없어 앱 검사로 둔다.

-- 같은 장부·같은 구분에 미분류(system)는 하나뿐이다.
CREATE UNIQUE INDEX uq_category_system ON category (ledger_id, kind) WHERE system;

ALTER TABLE category
    -- 복합 FK가 가리킬 대상. id가 이미 기본키라 새로 막는 것은 없다.
    ADD CONSTRAINT uq_category_id_ledger_kind UNIQUE (id, ledger_id, kind),
    -- V1의 이름 없는 단일 컬럼 FK(parent_id → category.id). 아래 복합 FK가 대신한다.
    DROP CONSTRAINT category_parent_id_fkey,
    -- 상위는 같은 장부·같은 구분이어야 한다. parent_id가 NULL(최상위)이면 검사하지 않는다(MATCH SIMPLE).
    -- 삭제·수정 동작은 V1과 같은 기본값(거부)이다.
    ADD CONSTRAINT fk_category_parent FOREIGN KEY (parent_id, ledger_id, kind)
        REFERENCES category (id, ledger_id, kind),
    ADD CONSTRAINT ck_category_parent_not_self CHECK (parent_id <> id);
