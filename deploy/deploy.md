# 배포 스크립트와 타이머

배포 PR(`deploy/production.env` 한 파일만 바꾸는 PR)을 main에 머지하면 서버가 그 이미지로 바꾼다(#52, 1단계 방식).
이 문서는 설치와 운영 방법이다. 운영 compose와 프록시 설정은 [compose.yaml](compose.yaml)과 [Caddyfile](Caddyfile)(PR #306)이다.

**한계.** 이전 이미지로 돌아가도 이미 적용된 마이그레이션은 그대로다(스키마는 되돌리지 않는다). 이전 이미지가 새 스키마에서 뜨지 않으면 백업 복구가 필요하고, 스크립트는 자동으로 복구하지 않고 멈춰서 알린다.
마이그레이션은 지금 새 서버가 뜰 때 Flyway가 적용한다. 마이그레이션을 배포의 별도 단계로 떼고 DB 역할을 나누는 일은 dba의 정의가 나온 뒤에 한다(#52 정정 댓글).

## 파일

| 파일 | 서버에서의 위치 | 역할 |
|---|---|---|
| `bin/deploy` | `/opt/akkimpyo/bin/` | 배포 파일을 보고 교체한다. 타이머가 인자 없이 부른다 |
| `systemd/akkimpyo-deploy.service`, `.timer` | `/etc/systemd/system/` | 앞의 실행이 끝나고 5분마다 한 번 |
| `github-known-hosts` | `/opt/akkimpyo/deploy/` | GitHub의 SSH 호스트 키(`gh api meta`의 값, 2026-11-27 확인) |
| `compose.yaml`, `Caddyfile`, `db-init.sh`, `env.allowlist` | `/opt/akkimpyo/deploy/` | 운영 compose와 그 파일들(PR #306). 스크립트는 이 사본만 쓴다 |
| (서버에만) | `/etc/akkimpyo/app.env` | 비밀값과 운영 값(root, 600). 이름은 `env.example` |
| (서버에만) | `/etc/akkimpyo/deploy-key` | 레포 읽기 전용 배포 키의 개인키(root, 600) |
| (서버에만) | `/etc/akkimpyo/docker/config.json` | ghcr.io 이미지 받기 토큰(읽기 전용). 패키지가 공개면 없어도 된다 |
| (서버에만, 없어도 된다) | `/etc/akkimpyo/deploy.env` | 설정. 없으면 아래 기본값이 운영 값이다 |
| (서버에만) | `/var/lib/akkimpyo-deploy/` | 상태와 이력(root, 700) |

서버의 파일은 모두 root 소유이고 레포의 내용으로 자동으로 바뀌지 않는다. 스크립트, compose, 허용 목록을 바꾸려면 owner가 다시 설치한다.
서버에 필요한 자격은 레포 읽기 전용 배포 키와 이미지 받기 토큰 둘뿐이다. 둘 다 레포와 GitHub Actions에 없다.

## 배포 파일

`deploy/production.env`는 정확히 이 네 줄이다. 다른 줄(주석, 빈 줄 포함), 다른 순서, 태그, 다른 저장소, CR, 끝의 공백이 있으면 서버는 배포하지 않고 알린다.
CI(`.github/workflows/deploy-pr.yml`)도 같은 코드(`deploy/bin/deploy --check`)로 본다.

```
SERVER_IMAGE=ghcr.io/lomong7807/akkimpyo-server@sha256:<소문자 16진수 64자>
WEB_IMAGE=ghcr.io/lomong7807/akkimpyo-web@sha256:<소문자 16진수 64자>
ROLLBACK_SAFE=yes
SW_DISABLE=no
```

- `ROLLBACK_SAFE`: 교체 뒤 상태 확인이 실패할 때 이전 이미지로 되돌려도 되는가(범위 보강 11). `no`면 되돌리지 않고 멈춘다.
- `SW_DISABLE`: `yes`면 프록시가 `/sw.js`에 `/sw-off.js`를 낸다(범위 보강 22). 이 값만 바꾸면 프록시만 다시 만든다.
- 배포 PR 양식은 [.github/PULL_REQUEST_TEMPLATE/deploy.md](../.github/PULL_REQUEST_TEMPLATE/deploy.md)다. PR 주소 끝에 `?expand=1&template=deploy.md`를 붙인다.

## 한 번 돌 때 일어나는 일

1. **잠금.** `/var/lib/akkimpyo-deploy/lock`을 잡지 못하면(다른 배포가 돈다) 아무것도 하지 않고 끝난다. 진행 중인 배포는 끊지 않는다.
2. **가져오기.** 배포 키로 main을 bare 저장소(`/var/lib/akkimpyo-deploy/repo.git`)에 받는다. 작업 트리가 없고, `deploy/production.env`의 내용만 읽는다. 파일을 꺼내 실행하지 않는다.
3. **형식 검사.** 틀리면 알리고 끝난다. 기다리던 배포가 있으면 취소한다.
4. **비교.** 지금 도는 서버·프록시 컨테이너의 이미지 이름(digest)과 프록시의 `SW_DISABLE`이 배포 파일과 같으면 끝난다. `ROLLBACK_SAFE`만 바뀐 것은 교체할 것이 없다.
5. **처음 본 변경.** 먼저 교체할 수 있는지 본다(env 파일 검사, 두 이미지 받기). 안 되면 알리고 기다리지 않는다. 되면 **시작 알림**을 보낸다. 보내지 못하면 기다리기 시작하지 않고 다음 확인 때 다시 보낸다.
6. **기다리기.** 시작 알림 뒤 10분(`WAIT_SECONDS`)이 지난 첫 확인 때 교체한다. 그 사이 파일이 다시 바뀌면 새 값으로 다시 알리고 다시 기다린다. 지금 도는 값으로 돌아가면 취소를 알린다.
7. **교체.**
   1. env 파일을 다시 검사한다(아래).
   2. 교체 직전 백업(`/opt/akkimpyo/bin/backup`). 실패하면 교체하지 않는다. DB 컨테이너가 아직 없으면(첫 배포) 건너뛴다.
   3. 웹이 바뀌면 지금 웹 컨테이너의 `/srv/assets` 안의 파일을 `assets-prev` 볼륨으로 옮긴다(볼륨은 한 판만 갖는다, 범위 보강 21).
   4. **서버를 먼저** 바꾸고 상태 확인을 통과한 뒤에 프록시를 바꾼다. 서버가 실패하면 새 웹과 service worker가 나가지 않는다.
   5. 상태 확인: 서버 컨테이너 안에서 `GET /actuator/health`(이미지의 curl, 호스트 포트 없음). HTTP 200이고 최상위 `status`가 `UP`이면 통과. 5초 간격으로 24번. 한 요청은 35초까지 기다린다. DB가 내려가 있으면 서버가 DB를 30초 기다린 뒤 503을 내기 때문이다(PR #306에서 30.1초). `UP`이 아닌 답을 3번 받으면 남은 횟수를 기다리지 않는다.
   6. 프록시가 돌고 3초 뒤에도 다시 시작하지 않았는지 본다. 교체 뒤 도는 이미지와 `SW_DISABLE`이 배포 파일과 같은지 다시 본다.
8. **실패하면.** `ROLLBACK_SAFE=yes`이고 이전 판이 있으면 이전 이미지로 되돌리고(같은 순서와 assets 규칙) 알린다. `no`이거나 첫 배포면 되돌리지 않고 멈춰서 알린다. 어느 쪽이든 그 배포 파일은 `failed`에 남아 다시 하지 않는다.
9. **끝나면.** 이력에 한 줄, 완료 알림. 아낌표 이미지 중 지금 판과 바로 앞 판만 남기고 지운다(`docker image rm 저장소@digest`). `docker system prune`이나 `docker image prune`은 쓰지 않는다.

compose는 이렇게 부른다. 이미지와 `SW_DISABLE`은 검사한 값만 셸 환경으로 넘기고 나머지는 env 파일에서만 온다.

```
SERVER_IMAGE=... WEB_IMAGE=... SW_DISABLE=... docker compose --progress plain --project-name akkimpyo \
  --file /opt/akkimpyo/deploy/compose.yaml --env-file /etc/akkimpyo/app.env up --detach --no-build --pull missing server|proxy
```

### env 파일 검사(범위 보강 13)

교체 전에 `/etc/akkimpyo/app.env`를 읽어 본다. 걸리면 **이름만** 알리고 값은 어디에도 내지 않는다.

- 파일이 root 소유, 권한 600이다. 허용 목록은 root만 고칠 수 있다.
- 주석과 빈 줄 밖의 줄은 모두 `이름=값`이고, 이름은 허용 목록(`/opt/akkimpyo/deploy/env.allowlist`)에 있다. 같은 이름이 두 번 나오지 않는다.
- `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`, `ACCESS_TOKEN_SIGNING_KEY`, `WEB_ORIGIN`이 있고 비어 있지 않다. 이 다섯 이름은 허용 목록에도 있어야 한다.
- `WEB_ORIGIN`은 `https://`로 시작한다. `DB_URL`에 `logServerErrorDetail`이 없다(대소문자 무시). `SPRING_PROFILES_ACTIVE`에 `local`이 없다(이 이름은 허용 목록에 없어 그것만으로도 걸린다).

## 알림

모두 `[아낌표 배포]`로 시작한다. 보내지 못한 결과 알림은 `/var/lib/akkimpyo-deploy/unsent.*`에 남고 다음 실행이 다시 보낸다.

| 알림 | 언제 | owner가 할 일 |
|---|---|---|
| 배포 파일이 바뀌었다. N분 뒤 교체한다 | 변경을 처음 봤을 때. 커밋, PR 번호, 이전·새 digest, `SW_DISABLE`, 마이그레이션(두 서버 이미지의 커밋 사이 변경), `ROLLBACK_SAFE` | **내가 머지한 배포가 아니면** 10분 안에 main의 배포 파일을 되돌리거나 `systemctl stop akkimpyo-deploy.timer`. PR 번호가 없거나 이미지의 커밋이 main에 없다는 줄도 같은 신호다 |
| 기다리는 동안 배포 파일이 다시 바뀌었다 | 위와 같다 | 위와 같다 |
| 대기 중이던 배포를 취소했다 | 파일이 지금 도는 값으로 돌아갔을 때 | 없다 |
| 배포 파일이 바뀌었지만 교체하지 않는다 | 교체 준비(env 검사, 이미지 받기)가 안 될 때. 같은 글은 6시간에 한 번 | 이유를 고친다. 다음 확인 때 다시 본다 |
| 배포 파일을 받지 않는다 | 형식이 틀렸을 때. 같은 글은 6시간에 한 번 | 고치는 배포 PR |
| 배포가 끝났다 | 성공. 직전 백업 객체 이름, 걸린 시간 | 없다 |
| 교체하지 않았다(env 검사, 이미지 받기, 직전 백업, assets) | 교체 전 단계의 실패. 아무것도 바뀌지 않았다 | 고친 뒤 `rm /var/lib/akkimpyo-deploy/failed` |
| 이전 이미지로 되돌렸다 | 상태 확인이 실패하고 `ROLLBACK_SAFE=yes` | 원인을 본다. 되돌리는 배포 PR(Revert)을 머지해 배포 파일을 지금 도는 값에 맞춘다 |
| 되돌렸지만 되돌린 판도 확인을 통과하지 못했다 | 위에서 되돌린 판도 실패 | 서버 로그를 본다. 백업 복구가 필요할 수 있다(`docs/db/restore-runbook.md`) |
| 되돌리지 않고 멈췄다 | `ROLLBACK_SAFE=no`이거나 첫 배포 | 배포 PR 본문의 되돌리는 방법을 따른다 |
| 교체 중에 예상하지 못하게 끝났다 | 스크립트 오류나 신호 | 도는 컨테이너를 본다 |
| N분째 배포 파일을 받아 오지 못한다 | 가져오기가 30분 넘게 실패 | 배포 키, GitHub 호스트 키, 네트워크 |

## 레포에서 가져오는 방법

| 방법 | 판단 |
|---|---|
| **레포 읽기 전용 배포 키(SSH) + `git fetch`** | 채택. 레포 하나만 읽고 사람 계정에 묶이지 않으며 만료가 없다. 개인키는 서버에서 만들어 서버 밖으로 나가지 않는다. 커밋, PR 번호(squash 커밋 제목의 `(#번호)`), 마이그레이션 변경을 git으로 알 수 있다 |
| fine-grained 토큰 + REST API | owner 계정에 묶이고 만료가 있다. 커밋·PR 정보를 얻으려면 요청이 여럿이다 |
| `raw.githubusercontent.com`(공개 레포라 자격 없이) | 캐시로 늦을 수 있고(추정) 커밋 정보가 없다. 레포를 비공개로 바꾸면 끊긴다 |
| GitHub Actions가 서버로 밀어 넣기 | 서버 접속 키를 GitHub에 둬야 한다(#52 공통 규칙에 어긋난다) |

호스트 키는 `github-known-hosts`로 고정하고 `StrictHostKeyChecking=yes`로 붙는다. GitHub가 호스트 키를 바꾸면 가져오기가 실패하고 30분 뒤 알린다. `gh api meta --jq '.ssh_keys[]'`로 새 키를 확인해 파일을 다시 설치한다.

## 서버 설치 (owner가 따로 OK한 뒤)

PR #306의 설치(compose, Caddyfile, db-init.sh, 허용 목록, app.env)와 `deploy/backup.md`의 백업 설치를 먼저 끝낸다. 레포를 받은 폴더에서 root로 실행한다.

```
# 1. 레포 읽기 전용 배포 키. 개인키는 서버에서 만들고 밖으로 옮기지 않는다.
ssh-keygen -t ed25519 -N '' -C akkimpyo-deploy -f /etc/akkimpyo/deploy-key
cat /etc/akkimpyo/deploy-key.pub
#    이 공개키를 GitHub 레포 Settings > Deploy keys에 넣는다. "Allow write access"는 켜지 않는다.

# 2. 이미지 받기 토큰(ghcr.io 패키지가 비공개일 때). read:packages만 있는 토큰을 파일로 받아 표준 입력으로 넣는다.
install -d -m 700 /etc/akkimpyo/docker
docker --config /etc/akkimpyo/docker login ghcr.io --username <GitHub 사용자> --password-stdin </경로/토큰파일
rm /경로/토큰파일

# 3. 스크립트, 호스트 키, 단위 파일
install -m 755 deploy/bin/deploy /opt/akkimpyo/bin/
install -m 644 deploy/github-known-hosts /opt/akkimpyo/deploy/
install -m 644 deploy/systemd/akkimpyo-deploy.service deploy/systemd/akkimpyo-deploy.timer /etc/systemd/system/
systemctl daemon-reload

# 4. 한 번 돌려 본다. 배포 파일이 아직 없으면 "할 일이 없다"로 끝난다.
systemctl start akkimpyo-deploy.service
journalctl -u akkimpyo-deploy -o cat

# 5. 타이머를 켠다.
systemctl enable --now akkimpyo-deploy.timer
systemctl list-timers 'akkimpyo*'
```

호스트에 필요한 것은 docker(compose 플러그인), git, openssh-client, util-linux(flock), coreutils(timeout), tzdata다.
서비스는 `ProtectSystem=strict`, `ProtectHome=yes`로 돈다. 그래서 이미지 받기 토큰을 `/root/.docker`가 아니라 `/etc/akkimpyo/docker`에 둔다.

## 운영

```
# 이력: 시각, 결과, 서버·웹 digest, SW_DISABLE, 커밋, 걸린 초, 단계
cat /var/lib/akkimpyo-deploy/history

# 멈추기(복원할 때, docs/db/restore-runbook.md). 돌고 있는 배포는 끊지 않으므로 끝났는지 본다.
systemctl stop akkimpyo-deploy.timer
systemctl is-active akkimpyo-deploy.service      # inactive나 failed면 돌고 있지 않다
flock --nonblock /var/lib/akkimpyo-deploy/lock true && echo '돌고 있는 배포가 없다'

# 다시 켜기
systemctl start akkimpyo-deploy.timer

# 실패한 배포 파일로 다시 하기(원인을 고친 뒤). 다시 알리고 10분 기다린 뒤 교체한다.
rm /var/lib/akkimpyo-deploy/failed

# 도는 컨테이너. compose 명령은 이미지 변수 없이는 멈추므로 docker로 본다(PR #306).
docker ps --filter label=com.docker.compose.project=akkimpyo
docker logs akkimpyo-server-1
```

- 새 스키마에 맞춘 `integrity-checks.sql`은 마이그레이션이 든 배포가 끝난 **뒤에** 설치한다(`deploy/backup.md`).
- 바로 앞 판의 서버·웹 이미지는 이름표 없는 이미지(dangling)로 남는다. 서버에서 `docker image prune`을 돌리면 되돌리기에 쓸 이미지가 지워진다. 그 명령을 쓰지 않는다.

### 설정(`/etc/akkimpyo/deploy.env`, 없어도 된다)

`이름=값` 줄만 읽고 모르는 이름이 있으면 멈춘다. 시험이 이 파일로 경로와 시간을 바꾼다.

| 이름 | 기본값 |
|---|---|
| `WAIT_SECONDS` | `600` |
| `HEALTH_TRIES`, `HEALTH_INTERVAL_SECONDS`, `HEALTH_REQUEST_SECONDS` | `24`, `5`, `35` |
| `PROXY_WAIT_SECONDS` | `60` |
| `FETCH_ALERT_AFTER_SECONDS` | `1800` |
| `REPO_URL`, `REPO_BRANCH` | `git@github.com:lomong7807/akkimpyo.git`, `main` |
| `SERVER_REPOSITORY`, `WEB_REPOSITORY` | `ghcr.io/lomong7807/akkimpyo-server`, `ghcr.io/lomong7807/akkimpyo-web` |
| `COMPOSE_PROJECT`, `COMPOSE_FILE_PATH`, `ENV_ALLOWLIST_FILE`, `APP_ENV_FILE` | `akkimpyo`, `/opt/akkimpyo/deploy/compose.yaml`, `/opt/akkimpyo/deploy/env.allowlist`, `/etc/akkimpyo/app.env` |
| `DEPLOY_KEY_FILE`, `KNOWN_HOSTS_FILE`, `TELEGRAM_ENV_FILE` | `/etc/akkimpyo/deploy-key`, `/opt/akkimpyo/deploy/github-known-hosts`, `/etc/akkimpyo/telegram.env` |
| `DEPLOY_STATE_DIR`, `BACKUP_BIN`, `HEALTH_URL` | `/var/lib/akkimpyo-deploy`, `/opt/akkimpyo/bin/backup`, `http://127.0.0.1:8080/actuator/health` |

### ghcr.io의 옛 이미지 (안, owner 확정 전)

범위 보강 4의 정리 정책 안이다. 자동으로 지우는 것은 만들지 않았다.

- 배포 이력(`history`)에 나온 digest와 최근 20번의 Image 실행이 만든 것은 지우지 않는다. 되돌리기와 되돌리는 배포 PR에 쓴다.
- 그 밖의 것은 owner가 GitHub의 패키지 화면에서 지운다. 지우기 전에 서버의 `history`에 없는지 본다.

## 시험

```
deploy/tests/deploy-run
```

Docker(buildx, compose 플러그인)만 있으면 된다. 운영 compose 대신 시험용 최소 compose(`tests/deploy-fixture/compose.yaml`)와 작은 이미지(가짜 서버·웹)를 쓴다.
레포는 시험 안의 git 저장소(가짜 ssh가 `git-upload-pack`으로 잇는다), 레지스트리는 시험 안에서 호스트 네트워크의 127.0.0.1에만 띄운 것, 텔레그램과 백업은 가짜다.
운영 서버, GitHub, ghcr.io에 접속하지 않는다. 자기가 만든 컨테이너, 볼륨, 네트워크, 이미지만 지운다. CI에서는 `.github/workflows/backup-test.yml`의 `deploy` job이다.

확인하지 않은 것: 실제 VM의 systemd에서 서비스의 격리 설정(`ProtectSystem=strict` 등) 아래 docker, git, ssh가 도는지(시험은 `systemd-analyze verify`까지), 실제 GitHub 배포 키와 ghcr.io 토큰으로 받기, 텔레그램 실제 전송(전송기는 PR #129에서 시험).
