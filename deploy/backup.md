# DB 백업과 복원 훈련

설계 기준은 [docs/db/backup-restore.md](../docs/db/backup-restore.md)(dba)다. 이 문서는 설치와 운영 방법이다.

매일 03:30(한국 시각)에 DB 전체를 `pg_dump -Fc`로 덤프하고, age 공개키로 암호화해 OCI Object Storage에 올린다.
배포 스크립트(#52)도 교체 직전에 같은 스크립트를 부른다.

**한계.** 시점 복구는 안 된다. 마지막 백업 뒤의 입력, 최대 24시간치를 잃을 수 있다. 1단계에서 owner가 받아들인 위험이다.

## 파일

| 파일 | 서버에서의 위치 | 역할 |
|---|---|---|
| `bin/backup` | `/opt/akkimpyo/bin/` | 덤프, 확인, 암호화, 올리기. 실패하면 알린다 |
| `bin/backup-check` | `/opt/akkimpyo/bin/` | 성공한 백업이 26시간 넘게 없으면 알린다. 못 보낸 알림을 다시 보낸다 |
| `bin/notify-telegram` | `/opt/akkimpyo/bin/` | 표준 입력의 글을 텔레그램으로 보낸다 |
| `bin/backup-lib.sh` | `/opt/akkimpyo/bin/` | 위 스크립트와 `scripts/restore-drill`이 같이 쓰는 함수 |
| `systemd/akkimpyo-backup*` | `/etc/systemd/system/` | 매일 03:30 백업, 매시간 점검 |
| `backup.env.example` | `/etc/akkimpyo/backup.env` | 설정. 비밀값은 없다 |
| `backup-recipients.txt` | `/etc/akkimpyo/backup-recipients.txt` | 암호화에 쓸 age 공개키. **지금은 자리만 있고 owner가 넣는다** |
| `docs/db/integrity-checks.sql` | `/opt/akkimpyo/share/` | 명세표 쿼리(dba) |
| `scripts/restore-drill` | 서버에 두지 않는다 | 복원 훈련. owner 맥에서 돌린다 |

서버의 파일은 모두 root 소유다. 레포의 내용으로 자동으로 바뀌지 않는다. 바꾸려면 owner가 다시 설치한다.

## 올라가는 것

`akkimpyo-<한국 시각>KST.tar.age` 하나와 그 sha256 파일이다. `daily/`에 올리고, 그 주(일요일 시작)의 첫 성공 백업은 `weekly/`에도 올린다.
평소에는 일요일 백업이고, 일요일 백업이 실패했으면 그 주의 다음 성공 백업이 대신한다.

| 안에 든 파일 | 내용 |
|---|---|
| `db.dump` | `pg_dump -Fc` 전체 DB |
| `globals.sql` | `pg_dumpall --globals-only`(역할) |
| `manifest.txt` | 명세표. 덤프와 같은 스냅샷에서 만든다 |
| `meta.txt` | 덤프 시각, DB 이름, PostgreSQL 버전, 덤프 크기 |
| `integrity-checks.sql` | 명세표를 만들 때 쓴 쿼리 |
| `SHA256SUMS` | 위 파일들의 sha256 |

`pg_restore --list`는 목차만 읽어 뒤가 잘린 덤프도 통과한다(확인함). 그래서 `pg_restore --file=/dev/null`로 전체를 한 번 더 읽는다.

## Object Storage 설정 (owner, 콘솔)

`<구획>`, `<버킷>` 같은 값은 owner가 정한다. 문장은 Oracle 문서를 옮긴 것이고 **콘솔에 넣어 보지는 않았다.** 넣은 뒤 아래 [권한 확인](#권한-확인)을 한다.

1. **구획과 버킷.** 백업 전용 구획에 버킷을 하나 만든다. Standard 등급, 비공개, **버전 관리는 켜지 않는다**(이유는 아래).
2. **동적 그룹** `akkimpyo-backup-vm`. 규칙은 이 VM 하나만 가리킨다.

   ```
   instance.id = '<VM의 OCID>'
   ```
3. **정책: 서버는 새 객체를 만들기만 한다.** 덮어쓰기, 읽기, 목록 보기, 삭제 권한을 주지 않는다.

   ```
   Allow dynamic-group akkimpyo-backup-vm to manage objects in compartment <구획> where all {target.bucket.name='<버킷>', target.object.name='daily/*', any {request.permission='OBJECT_CREATE'}}
   Allow dynamic-group akkimpyo-backup-vm to manage objects in compartment <구획> where all {target.bucket.name='<버킷>', target.object.name='weekly/*', any {request.permission='OBJECT_CREATE'}}
   ```

   IAM 정책은 더해진다. 이 VM이 속한 다른 동적 그룹이나 `any-user` 정책이 이 구획에 더 넓은 권한을 주고 있지 않은지 본다.
4. **정책: 수명 주기 규칙이 지울 수 있게 한다.** 루트 구획에 만든다.

   ```
   Allow service objectstorage-ap-chuncheon-1 to manage object-family in compartment <구획> where any {request.permission='BUCKET_INSPECT', request.permission='BUCKET_READ', request.permission='OBJECT_INSPECT', request.permission='OBJECT_UPDATE_TIER', request.permission='OBJECT_DELETE', request.permission='OBJECT_VERSION_DELETE'}
   ```
5. **수명 주기 규칙 두 개.** 대상 Objects, 동작 Delete.

   | 이름 | 접두어 필터(inclusion prefix) | 일수 |
   |---|---|---|
   | delete-daily | `daily/` | 7 |
   | delete-weekly | `weekly/` | 33 |
6. **보존 규칙(retention rule), 권장.** 기간 7일, **잠그지 않는다.** 올린 뒤 7일 동안은 owner의 실수나 잘못된 수명 주기 설정으로도 지워지거나 덮어써지지 않는다.
   7일 안에 지우려면 규칙부터 지워야 한다. 잠그면 누구도 풀 수 없으므로 잠그지 않는다.
7. **용량 한도(quota), 권장.** VM이 침해되면 공격자도 객체를 만들 수 있다. 구획에 한도를 두면 무료 한도를 넘겨 채우지 못한다. 예: 5GB.

   ```
   Set object-storage quota storage-bytes to 5000000000 in compartment <구획>
   ```

### 보관 일수의 근거

조건은 "매일 7개, 매주 4개, 가장 오래된 것이 35일"이다. 35일은 탈퇴한 사람의 데이터가 백업에 남는 최장 기간이라 넘으면 안 되는 값으로 본다.
수명 주기는 올린 시각을 다음 UTC 자정으로 올린 뒤 일수를 세고, 하루에 한 번 돈다. 그래서 실제로 지워지는 나이는 일수보다 최대 2일 길다(올림 1일 + 실행 간격 1일).

| 규칙 | 지워지는 나이(03:30 백업) | 남아 있는 개수 | 판단 |
|---|---|---|---|
| daily 6일 | 6.2~7.2일 | 6~8 | 7개에 못 미치는 때가 있다 |
| **daily 7일** | 7.2~8.2일 | 7~9 | 채택 |
| weekly 27일 | 27.2~28.2일 | 3~5 | 4개에 못 미치는 때가 있다 |
| weekly 28일 | 28.2~29.2일 | 4~5 | 된다. 여유가 없다 |
| **weekly 33일** | 33.2~34.2일, 아무 때나 올려도 최대 35일 | 4~5 | 채택. 35일을 넘지 않는 가장 큰 값 |
| weekly 35일 | 35.2~36.2일, 최대 37일 | 5~6 | 35일을 넘는다 |

개수는 백업이 매번 성공했을 때다. 배포 직전 백업은 `daily/`에 더해진다.
Oracle은 수명 주기 실행이 "best-effort"라 더 걸릴 수 있다고 적는다. 그래서 35일은 문서에 적힌 정상 동작 기준이다.

### 버전 관리를 켜지 않는 이유

- 보존 규칙과 같이 쓸 수 없다.
- 버전 관리를 켠 버킷에서는 수명 주기의 삭제가 이전 버전을 남긴다. 실제로 지우려면 "이전 버전 삭제" 규칙이 더 필요하고 그만큼 보관이 길어진다.
- 서버에는 덮어쓰기와 삭제 권한이 없어, 버전 관리가 서버로부터 더 막아 주는 것이 없다.

### 올리는 도구로 OCI CLI 컨테이너를 쓰는 이유

| 방법 | 판단 |
|---|---|
| **공식 OCI CLI 이미지, digest 고정** | 채택. 호스트에 설치하는 것이 없고, 객체 생성 권한만으로 올라간다(대역 서버로 요청을 확인). 이미지가 크다(arm64 받기 약 200MB) |
| OCI CLI를 호스트에 설치 | Python과 의존성을 호스트에 깔고 갱신해야 한다 |
| rclone | instance principal은 되지만 올린 뒤 HEAD를 보낸다(소스 확인). 읽기 권한이 필요하다 |
| 사전 인증 URL과 curl | 만들려면 덮어쓰기 권한까지 필요하고, URL이 서버에 오래 가는 비밀값이 된다 |

CLI를 `--force`로 부르는 것은 올리기 전 HEAD(읽기 권한이 필요)를 건너뛰려는 것이다. 덮어쓰기는 IAM이 막는다.
여러 조각 올리기는 덮어쓰기와 읽기 권한이 필요해 `--no-multipart`로 한 번에 올린다(최대 50GiB).

## 키 쌍 만들기 (owner, 맥)

```
brew install age
age-keygen -o akkimpyo-backup.key
```

- 화면에 나온 공개키(`age1...`)를 `deploy/backup-recipients.txt`에 넣는 PR을 올리고, 서버의 `/etc/akkimpyo/backup-recipients.txt`에 복사한다.
- 개인키 파일은 owner만 오프라인으로 가진다. 레포, 서버, CI에 두지 않는다.
- **개인키를 잃으면 백업을 아무도 풀 수 없다.** 서로 다른 곳에 두 벌 두거나, 키 쌍을 하나 더 만들어 공개키를 두 줄 넣는다.

## 서버 설치 (owner가 따로 OK한 뒤)

레포를 받은 폴더에서 root로 실행한다.

```
install -d -m 755 /opt/akkimpyo/bin /opt/akkimpyo/share
install -d -m 700 /etc/akkimpyo

# age 1.3.2 (arm64)
curl -fsSLo /tmp/age.tar.gz https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-arm64.tar.gz
echo '6b8dc4333c53a5a57c9e5834e3a48f92605d7154014cd07269ff3327db5d37f4  /tmp/age.tar.gz' | sha256sum -c -
tar -xzf /tmp/age.tar.gz -C /opt/akkimpyo/bin --no-same-owner --strip-components=1 age/age
rm /tmp/age.tar.gz

install -m 755 deploy/bin/backup deploy/bin/backup-check deploy/bin/notify-telegram /opt/akkimpyo/bin/
install -m 644 deploy/bin/backup-lib.sh /opt/akkimpyo/bin/
install -m 644 docs/db/integrity-checks.sql /opt/akkimpyo/share/
install -m 644 deploy/systemd/akkimpyo-backup* /etc/systemd/system/
install -m 644 deploy/backup-recipients.txt /etc/akkimpyo/
install -m 600 deploy/backup.env.example /etc/akkimpyo/backup.env   # 값을 채운다
install -m 600 /dev/null /etc/akkimpyo/telegram.env                 # TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID 두 줄을 넣는다

systemctl daemon-reload
systemctl start akkimpyo-backup.service      # 첫 백업. 올리기 이미지를 받느라 몇 분 걸릴 수 있다
journalctl -u akkimpyo-backup -o cat
echo '알림 시험' | /opt/akkimpyo/bin/notify-telegram
systemctl enable --now akkimpyo-backup.timer akkimpyo-backup-check.timer
systemctl list-timers 'akkimpyo*'
```

호스트에 필요한 것은 docker, openssl, tzdata, util-linux(flock), curl이다. Ubuntu 서버에는 보통 있다.

평문은 메모리(`/run`, tmpfs)에만 잠깐 있다. 스왑이 켜져 있으면 스왑으로 나갈 수 있으므로 `swapon --show`로 확인한다.

### 권한 확인

정책을 넣은 뒤 서버에서 한 번 한다. 진짜 백업이 아니라 시험 객체(`daily/permission-check`)로 확인한다. 이 객체는 수명 주기 규칙이 지운다.

```
image=$(sed -n 's/^DEFAULT_OCI_CLI_IMAGE=//p' /opt/akkimpyo/bin/backup-lib.sh)
oci() { docker run --rm --network host --volume /etc/hostname:/upload:ro "$image" --auth instance_principal os object "$@" -ns <네임스페이스> -bn <버킷>; }

oci put --name daily/permission-check --file /upload --force --no-multipart   # 성공해야 한다
oci put --name daily/permission-check --file /upload --force --no-multipart   # 덮어쓰기. 거부돼야 한다
oci put --name other/permission-check --file /upload --force --no-multipart   # 다른 접두어. 거부돼야 한다
oci list                                                                      # 거부돼야 한다
oci get --name daily/permission-check --file -                                # 거부돼야 한다
oci delete --name daily/permission-check --force                              # 거부돼야 한다
```

VM 안의 모든 프로세스와 컨테이너가 같은 instance principal 자격을 얻을 수 있다. 그래서 VM이 침해되면 공격자는 백업 버킷에 객체를 **만들 수는** 있다(읽기, 덮어쓰기, 삭제는 못 한다).

## 알림

| 조건 | 보내는 것 |
|---|---|
| 백업 실패(어느 단계든) | `backup` |
| 덤프 크기가 직전보다 20% 넘게 줄었다(백업은 올라간다) | `backup` |
| 성공한 백업이 26시간 넘게 없다 | `backup-check`(매시간 점검, 같은 문제는 6시간마다) |

보내지 못한 알림은 `/var/lib/akkimpyo-backup/unsent-alerts`에 남고 `backup-check`가 다시 보낸다.
서버가 통째로 죽으면 두 알림 모두 나가지 않는다. 서버 밖의 감시가 따로 필요하다.

## 배포 스크립트에서 부르기

```
object=$(/opt/akkimpyo/bin/backup | tail -n 1) || 중단
```

- 종료 코드 0이면 성공이고 표준 출력 마지막 줄이 올린 객체 이름이다. 파이프로 받을 때는 `set -o pipefail`이 필요하다.
- 다른 백업이 돌고 있으면 최대 10분 기다렸다가 새로 백업한다.
- 새 스키마에 맞춘 `integrity-checks.sql`은 마이그레이션이 끝난 **뒤에** 설치한다. 먼저 설치하면 직전 백업의 명세표가 실패해 배포가 막힌다.
  명세표 쿼리가 스키마와 맞지 않으면 덤프는 올리고 실패로 끝낸다.

## 복원 훈련 (owner, 맥)

매월 한 번, 그리고 조각이 끝날 때. Docker, age, JDK 21이 필요하다. 운영에 배포된 커밋을 체크아웃하고 돌린다.

```
OCI_NAMESPACE=<네임스페이스> OCI_BUCKET=<버킷> \
  scripts/restore-drill --identity <개인키 파일> --keep-copy ~/akkimpyo-backup-copy
```

- `~/.oci/config`의 owner 계정으로 내려받는다. 콘솔에서 받은 파일로 하려면 `--file <파일>.tar.age`를 준다(`.sha256`도 같은 폴더에 둔다).
- 통과하면 0으로 끝나고, `docs/db/backup-restore.md`의 훈련 기록에 넣을 줄을 출력한다.
- `--keep-copy`는 암호화된 파일 하나만 남긴다. 이 사본도 덤프 시각부터 35일 안에 지워야 한다. 다음 훈련이 옛 사본을 지운다. 훈련을 거르면 직접 지운다.
- 실제 복구 절차는 [docs/db/backup-restore.md](../docs/db/backup-restore.md) 10절이다. 파일을 푸는 명령은 이렇다.

  ```
  age --decrypt --identity <개인키 파일> akkimpyo-....tar.age | tar -xf -
  ```

## 시험

```
deploy/tests/run
```

Docker와 서버 빌드용 JDK만 있으면 된다. 자기가 띄운 컨테이너와 볼륨만 지운다. CI에서는 관련 파일이 바뀐 PR에서만 돈다(`.github/workflows/backup-test.yml`).
