# shellcheck shell=bash
# backup, backup-check, scripts/restore-drill이 source해서 같이 쓰는 함수다. 따로 실행하지 않는다.
# restore-drill은 macOS 기본 bash(3.2)에서도 돌아야 하므로 여기에는 bash 4 이상 문법을 쓰지 않는다.

LIB_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

# 올리기와 내려받기에 쓰는 OCI CLI 3.96.3(태그 20261118). arm64와 amd64를 묶은 인덱스의 digest다.
DEFAULT_OCI_CLI_IMAGE=ghcr.io/oracle/oci-cli@sha256:9c5c874d84c4fdfad82827ca30f97e3993533820cd0a732a96401add4f71d9b6

log() {
  printf '%s\n' "$*" >&2
}

die() {
  log "오류: $*"
  exit 1
}

# --- integrity-checks.sql 읽기 ---

# sql_section 파일 제목: "-- [제목]"으로 시작하는 구역만 낸다. 제목이 같은 구역이 여럿이면 모두 낸다.
sql_section() {
  awk -v title="-- [$2]" '
    /^-- \[/ { on = (index($0, title) == 1) }
    on { print }
  ' "$1"
}

# check_numbers 파일: 점검 쿼리 번호를 한 줄에 하나씩 낸다.
check_numbers() {
  sed -n 's/^-- \[점검 \([0-9][0-9]*\)\].*/\1/p' "$1"
}

# manifest_script 파일: 명세표를 만드는 psql 입력을 낸다. 백업과 복원이 같은 글자를 내도록 출력 형식을 고정한다.
manifest_script() {
  cat <<'SQL'
\set ON_ERROR_STOP on
\pset format csv
\pset tuples_only off
\pset null '(null)'
SET TIME ZONE 'UTC';
SET datestyle = 'ISO, YMD';
SQL
  sql_section "$1" 명세표
}

# --- 판정 ---

# week_sunday epoch: 그 시각이 속한 주의 일요일 날짜(한국 시각). 한 주는 일요일에 시작한다.
week_sunday() {
  local dow
  dow=$(TZ=Asia/Seoul date -d "@$1" +%w)
  TZ=Asia/Seoul date -d "@$(($1 - dow * 86400))" +%F
}

# is_stale 지금 마지막: 마지막 성공에서 26시간이 넘게 지났다.
is_stale() {
  (($1 - $2 > 26 * 3600))
}

# shrank 이전 지금: 크기가 20% 넘게 줄었다.
shrank() {
  (($2 * 100 < $1 * 80))
}

# --- 서버 설정과 상태 ---

# shellcheck disable=SC2034  # 이 파일을 source하는 스크립트가 쓴다.
set_defaults() {
  COMPOSE_PROJECT=akkimpyo
  COMPOSE_DB_SERVICE=db
  BACKUP_DB_NAME=''
  BACKUP_DB_USER=''
  AGE_BIN=/opt/akkimpyo/bin/age
  AGE_RECIPIENTS_FILE=/etc/akkimpyo/backup-recipients.txt
  INTEGRITY_SQL_FILE=/opt/akkimpyo/share/integrity-checks.sql
  OCI_NAMESPACE=''
  OCI_BUCKET=''
  OCI_CLI_IMAGE=$DEFAULT_OCI_CLI_IMAGE
  BACKUP_WORK_DIR=/run/akkimpyo-backup
  BACKUP_STATE_DIR=/var/lib/akkimpyo-backup
  BACKUP_LOCK_WAIT_SECONDS=600
  BACKUP_LOCAL_DIR=''
  TELEGRAM_ENV_FILE=/etc/akkimpyo/telegram.env
}

# 설정 파일은 셸로 실행하지 않고 "이름=값" 줄만 읽는다. 모르는 이름이 있으면 멈춘다.
load_config() {
  local file=${BACKUP_ENV_FILE:-/etc/akkimpyo/backup.env} line key
  [[ -r $file ]] || die "설정 파일을 읽을 수 없다: $file"
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    [[ $line =~ ^([A-Z_]+)=(.*)$ ]] || die "$file: '이름=값' 형식이 아닌 줄이 있다"
    key=${BASH_REMATCH[1]}
    case $key in
      COMPOSE_PROJECT | COMPOSE_DB_SERVICE | BACKUP_DB_NAME | BACKUP_DB_USER | \
        AGE_BIN | AGE_RECIPIENTS_FILE | INTEGRITY_SQL_FILE | \
        OCI_NAMESPACE | OCI_BUCKET | OCI_CLI_IMAGE | \
        BACKUP_WORK_DIR | BACKUP_STATE_DIR | BACKUP_LOCK_WAIT_SECONDS | BACKUP_LOCAL_DIR | \
        TELEGRAM_ENV_FILE)
        printf -v "$key" '%s' "${BASH_REMATCH[2]}"
        ;;
      *) die "$file: 모르는 변수 $key" ;;
    esac
  done <"$file"
}

# state_get 파일 이름: 상태 파일에서 값을 읽는다. 파일이나 이름이 없으면 빈 값이다.
state_get() {
  if [[ -r $BACKUP_STATE_DIR/$1 ]]; then
    sed -n "s/^$2=//p" "$BACKUP_STATE_DIR/$1"
  fi
}

# state_put 파일: 표준 입력으로 상태 파일을 바꾼다. 쓰다가 끊겨도 이전 내용이 남는다.
state_put() {
  cat >"$BACKUP_STATE_DIR/$1.partial"
  mv -- "$BACKUP_STATE_DIR/$1.partial" "$BACKUP_STATE_DIR/$1"
}

# notify: 표준 입력의 글을 보낸다.
notify() {
  TELEGRAM_ENV_FILE=$TELEGRAM_ENV_FILE "$LIB_DIR/notify-telegram"
}
