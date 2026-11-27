#!/usr/bin/env bash
# 운영 DB를 처음 만들 때(빈 볼륨) postgres 이미지의 진입 스크립트가 한 번 부른다(compose.yaml의 db). 서버에는 owner가
# /opt/akkimpyo/deploy/db-init.sh로 설치한다. 이미 만든 DB에는 다시 돌지 않는다.
#
# 하는 일
# 1. 서버가 쓰는 역할(APP_DB_USER)을 슈퍼유저가 아닌 로그인 역할로 만들고 운영 DB(POSTGRES_DB)의 소유자로 둔다.
#    서버는 뜰 때 이 역할로 Flyway 마이그레이션을 적용한다.
# 2. 관리 역할(POSTGRES_USER, 슈퍼유저)의 비밀번호를 지운다. 컨테이너 안의 로컬 소켓으로만 쓴다(백업, owner).
#
# 마이그레이션용(소유자)과 앱용(DML만) 역할을 나누는 것은 dba의 정의(docs/db/)가 나온 뒤 다른 이슈에서 한다(#52 정정 코멘트).
# 그때 1의 역할이 마이그레이션용이 되고, 앱용 역할을 더한다.
#
# 진입 스크립트는 실행 권한이 없는 .sh를 source한다. 그래도 진입 스크립트의 셸 설정이 바뀌지 않게 괄호 함수 안에서 돈다.

init_app_role() (
  set -euo pipefail
  : "${POSTGRES_USER:?}" "${POSTGRES_DB:?}" "${APP_DB_USER:?APP_DB_USER가 없다}" "${APP_DB_PASSWORD:?APP_DB_PASSWORD가 없다}"
  if [[ $APP_DB_USER == "$POSTGRES_USER" ]]; then
    printf '오류: 서버가 쓰는 역할(%s)이 관리 역할과 같다\n' "$APP_DB_USER" >&2
    exit 1
  fi
  # 비밀번호는 psql 변수로 넘겨 명령줄과 로그에 남지 않게 한다. 실패한 문장을 로그에 싣지 않는다.
  psql -X -q -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    --set=app_user="$APP_DB_USER" --set=app_password="$APP_DB_PASSWORD" --set=db="$POSTGRES_DB" \
    --set=admin="$POSTGRES_USER" <<'SQL'
SET log_min_error_statement = panic;
CREATE ROLE :"app_user" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';
ALTER DATABASE :"db" OWNER TO :"app_user";
ALTER ROLE :"admin" PASSWORD NULL;
SQL
)

init_app_role
