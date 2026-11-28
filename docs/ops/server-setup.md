# 첫 배포용 서버 설치 절차

- 상태: 안(2026-11-27, devops). [PR #306](https://github.com/lomong7807/akkimpyo/pull/306)(운영 compose와 프록시)과 [PR #311](https://github.com/lomong7807/akkimpyo/pull/311)(배포 스크립트와 타이머)이 **머지되기 전**의 내용을 기준으로 썼다. 기준 커밋은 #306 `72bc85a`, #311 `6f4a893`이다. 두 PR이 바뀌면 이 문서를 맞춘다.
- 하는 사람: owner. 서버 접속, 설치, 첫 배포는 owner가 따로 OK한 뒤에 한다(#54 공통 규칙).
- 다루는 것: owner가 첫 배포 전에 처음 한 번 하는 일, 첫 배포, 배포 뒤 확인. 평소의 배포 운영은 [`deploy/deploy.md`](../../deploy/deploy.md)(#311), 백업은 [`deploy/backup.md`](../../deploy/backup.md), 주소는 [`domain.md`](domain.md)다.
- 표기
  - **확인**: 2026-11-27(KST)에 레포 파일이나 위 두 PR의 파일을 읽어 봤다. 두 PR에서 가져온 파일 이름, 경로, 명령은 따로 적지 않아도 확인이다.
  - **추정**: 확인한 것에서 미루어 생각했다.
  - **미확인**: 보지 못했다. 서버, Oracle Cloud 콘솔, DuckDNS, GitHub와 텔레그램의 설정 화면은 보지 않았다. 화면과 메뉴의 이름은 모두 미확인이다.
- 서버는 "춘천 리전 VM"이라고만 쓴다. 명령의 `<...>`는 owner가 채우는 자리다.

> **공개 레포다.** 비밀값(배포 키, 이미지 받기 토큰, 서명 키, DB 비밀번호, 텔레그램 토큰), 서버 IP, 개인 이메일을 레포, PR, 이슈, 채팅(봇 포함), 텔레그램 글, 화면 캡처 어디에도 적지 않는다. 값은 서버의 root 전용 파일에만 둔다.

## 0. 순서

| # | 할 일 | 하는 곳 | 끝났다는 표시 |
|---|---|---|---|
| 1 | 설치 전 확인 | Oracle 콘솔, 서버(보기만), 맥 | 1절의 항목을 모두 봤다 |
| 2 | 주소와 A 레코드 | DuckDNS나 도메인 등록처, 맥 | `dig`가 서버의 공인 IP 하나를 낸다 |
| 3 | 레포 사본, 메타데이터 차단 | 서버 | 브리지의 컨테이너에서 메타데이터가 `Connection refused` |
| 4 | 키와 토큰 | 서버, GitHub, 텔레그램 | 4절의 파일이 root 소유, 권한 600 |
| 5 | `/etc/akkimpyo/app.env` | 서버 | 필수 다섯 이름에 값이 있다 |
| 6 | 파일 설치 | 서버 | 배포 서비스의 첫 실행이 "할 일이 없다", 알림 시험이 온다 |
| 7 | 첫 배포 | GitHub(PR은 devops, 머지는 owner), 텔레그램, 서버 | 완료 알림, 관리 역할의 비밀번호가 비어 있다 |
| 8 | 배포 뒤 확인 | 아이폰, 맥, 서버 | 8절의 목록 |
| 9 | 되돌리기와 긴급 끄기를 알아 둔다 | - | - |

서버의 명령은 모두 root로 한다(`sudo -i`). 3절부터는 3.1에서 받은 레포 사본 폴더에서 한다.

## 1. 설치 전 확인

이 절에서 바꾸는 것은 Oracle 쪽 방화벽(1.3, 1.4)과, 없을 때만 넣는 호스트 도구(1.7)뿐이다. 나머지는 보기만 한다.

### 1.1 선행 조건

- [ ] 머지돼 있다: #17, #18, #21(본문 상한), #51, #53, #52(#306과 #311). 배포 PR 양식의 '첫 배포일 때만' 목록과 같다.
- [ ] owner의 age 공개키를 `deploy/backup-recipients.txt`에 넣는 PR이 머지돼 있다. 지금 main의 그 파일에는 자리만 있다(확인). 키 쌍은 `deploy/backup.md` '키 쌍 만들기'로 owner 맥에서 만든다. owner가 지문을 자기 키와 대조한 뒤 머지한다(#54 댓글).
- [ ] Object Storage의 버킷과 정책이 있다(`deploy/backup.md` 'Object Storage 설정').
- [ ] 가입 허용 목록 후속 PR(#52 범위 보강 23). 5.4를 본다. 없어도 배포는 되지만 owner도 가입할 수 없다.
- [ ] owner가 서버 설치를 OK했다.

### 1.2 같은 VM의 다른 서비스를 건드리지 않는다

이 VM에서는 owner의 prometheus와 grafana가 Docker로 돈다.

- 그 컨테이너, 네트워크, 볼륨, Docker 데몬 설정(`/etc/docker/daemon.json`)을 바꾸지 않는다.
- `docker system prune`, `docker image prune`, `docker volume prune`, `docker network prune`, `docker container prune`를 쓰지 않는다. 다른 서비스의 것과, 되돌리기에 쓸 아낌표의 바로 앞 판 이미지가 같이 지워진다(`deploy/deploy.md`).
- `systemctl restart docker`를 하지 않는다. owner의 컨테이너도 멈췄다 다시 뜬다(추정). 같은 이유로 docker 패키지를 올리지 않는다(추정).
- 아낌표의 것은 compose 프로젝트 `akkimpyo`의 것만 다룬다. 라벨 `com.docker.compose.project=akkimpyo`가 붙어 있고 이름이 `akkimpyo-`나 `akkimpyo_`로 시작한다.
- 호스트 방화벽에는 3절의 규칙 하나만 더한다. `iptables -F`처럼 규칙을 통째로 지우는 명령을 쓰지 않는다.

### 1.3 Oracle 쪽 방화벽에서 80·443을 연다

- 이 VM의 서브넷에 붙은 보안 목록(security list)과 VNIC에 붙은 네트워크 보안 그룹(NSG)을 모두 본다. 두 곳의 허용 규칙이 합쳐져 적용된다(추정). 콘솔의 메뉴 위치는 미확인이다.
- 들어오는 규칙: TCP 80과 TCP 443, 출발지 `0.0.0.0/0`. 인증서 발급(HTTP-01은 80, TLS-ALPN-01은 443)과 접속에 필요하다(`domain.md` 1절 5번). 지금 열려 있는지는 미확인이다.
- UDP 443은 열지 않는다. 프록시가 HTTP/3를 끈다(`deploy/Caddyfile`의 `protocols h1 h2`).
- 서버 안의 방화벽(iptables의 INPUT, ufw)은 바꾸지 않는다. Docker가 연 포트로 오는 연결은 INPUT이 아니라 FORWARD를 지난다(추정). 첫 배포 뒤 밖에서 닿지 않을 때 다시 본다(8절).
- 서버에서 80·443을 쓰는 것이 없는지 다시 본다. 비어 있다는 것은 owner 확인(2026-11-24)이고 그 뒤 바뀌었을 수 있다.

  ```
  ss -tlnp '( sport = :80 or sport = :443 )'                            # 머리글 줄만 나와야 한다
  docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E ':(80|443)->'   # 아무것도 없어야 한다
  ```

  쓰는 것이 있으면 진행하지 않고 devops에게 알린다. `PROXY_HTTP_PORT`, `PROXY_HTTPS_PORT`로 바꿀 수는 있지만 그러면 인증서를 받지 못할 수 있다(`deploy/env.example`).

### 1.4 다른 웹 앱(grafana, prometheus)의 포트를 닫는다

ADR 005 결정 6에 따라, 주소가 이름이든 IP든 같은 VM의 다른 웹 앱을 자기 포트로 밖에 내지 않는다. 쿠키와 사이트 판정은 포트로 나뉘지 않기 때문이다. 열려 있으면 닫은 뒤에 첫 배포를 한다(#54 댓글). 지금 열려 있는지는 미확인이다.

1. 서버에서 연 포트를 본다.

   ```
   docker ps --format 'table {{.Names}}\t{{.Ports}}'
   ss -tlnp
   ```

   `0.0.0.0:`, `[::]:`, `*:`로 시작하는 포트는 모든 주소에서 받는다. `127.0.0.1:`이면 서버 안에서만 받는다. SSH(22)는 이 조건의 대상이 아니다(ADR 005 결정 3).
2. Oracle 쪽 들어오는 규칙(1.3의 두 곳)에 22, 80, 443 밖의 포트가 있는지 본다.
3. 1이나 2에 나온 포트마다 맥에서 밖으로 닿는지 본다. 맥이 서버와 같은 망에 있지 않아야 한다.

   ```
   nc -vz -w 5 <서버 공인 IP> <포트>
   ```

   `succeeded`가 나오면 열려 있다. 시간이 다 돼 끝나면 Oracle 쪽에서 막힌 것으로 본다(추정).
4. 열려 있으면 owner가 닫는다. 권하는 방법은 Oracle 쪽 들어오는 규칙에서 그 포트를 지우는 것이다. 이 방법은 컨테이너 설정을 건드리지 않는다(추정, #54 댓글). 닫은 뒤 3을 다시 한다.
   - owner가 grafana를 밖에서 봐야 하면 SSH 터널로 본다. `ssh -L 3000:127.0.0.1:<grafana 포트> <서버>` 뒤 맥에서 `http://localhost:3000`을 연다(추정, 서버 안에서 그 포트가 열려 있을 때).
   - 80·443의 프록시 뒤에서 다른 등록 도메인 이름으로 내는 방법(ADR 005 결정 6)은 이 문서의 범위 밖이다.

### 1.5 공인 IP의 종류

- 콘솔의 인스턴스 화면에서, 붙은 VNIC의 공인 IPv4가 임시(ephemeral)인지 예약(reserved)인지 본다. 화면 이름은 미확인이다.
- 임시 주소는 인스턴스를 멈춰도 남지만 인스턴스를 지우면 없어진다. 임시 주소를 같은 값의 예약 주소로 바꿀 수는 없다(`domain.md` 5절, 9절). 이름을 쓰면 IP가 바뀌어도 A 레코드만 고치면 된다.
- 그대로 둘지는 owner가 정한다. IP 값은 이 문서에도 레포에도 적지 않는다.

### 1.6 스왑

```
swapon --show      # 아무것도 나오지 않으면 스왑이 없다
free -h
```

- 아낌표 컨테이너는 스왑을 쓰지 않는다. `deploy/compose.yaml`의 `memswap_limit`이 메모리 상한과 같다.
- 스왑을 보는 이유는 백업이다. 백업의 평문은 `/run`(메모리)에만 잠깐 있지만, 스왑이 켜져 있으면 스왑으로 나갈 수 있다(`deploy/backup.md`).
- 켜져 있어도 끄지 않는다. 다른 서비스에 영향이 있다. 그대로 둘지는 owner가 정한다.

### 1.7 호스트의 도구와 Docker 방화벽 방식

```
uname -m                                                # aarch64
docker compose version
docker info 2>/dev/null | grep -i 'firewall backend'    # iptables여야 3절의 DOCKER-USER 체인이 있다
git --version; ssh -V; flock --version; timeout --version | head -n 1
openssl version; curl --version | head -n 1
TZ=Asia/Seoul date +%z                                  # +0900 (tzdata가 있다)
```

- 배포 스크립트에는 docker(compose 플러그인), git, openssh-client, util-linux(flock), coreutils(timeout), tzdata가 필요하다(`deploy/deploy.md`). 백업에는 docker, openssl, tzdata, util-linux, curl이 필요하다(`deploy/backup.md`). 없는 것은 `apt-get install <패키지>`로 넣는다. docker 패키지는 1.2의 이유로 올리지 않는다.
- `Firewall Backend`가 `iptables`가 아니면(nftables) `DOCKER-USER` 체인이 없다(`deploy/backup.md`). 3절을 하지 않고 devops와 security에게 알린다.

### 1.8 journal 보존 기간

복원할 백업을 고를 때, `last-success`보다 앞선 백업의 이름은 `journalctl -u akkimpyo-backup`의 '올렸다:' 줄과 대조한다(#54 댓글). 그래서 journal이 35일치를 남기는지 본다.

```
journalctl --disk-usage
journalctl --output=short-iso --no-pager | head -n 2     # 가장 오래된 기록의 시각
uptime -s                                                # 마지막으로 켜진 시각
grep -h -E '^(Storage|SystemMaxUse|MaxRetentionSec)=' /etc/systemd/journald.conf /etc/systemd/journald.conf.d/*.conf 2>/dev/null
```

- 가장 오래된 기록이 35일보다 최근인데 서버가 그보다 오래 돌았으면 35일을 남기지 못한다. devops에게 알린다. 성공 기록을 파일로 남기는 것은 백업 스크립트의 후속이다(#54 댓글).
- journald 설정은 바꾸지 않는다. 다른 서비스의 로그 보관도 같이 바뀐다. 바꿀지는 owner가 정한다.

## 2. 주소와 A 레코드

owner가 아직 고르지 않았다. `domain.md`의 권장안은 DuckDNS 이름 하나다(9절). 정식 도메인을 첫 배포 전에 사면 DuckDNS가 필요 없다. 둘 중 고른 하나만 한다.

어느 쪽이든 지킬 것(`domain.md` 1절):

- 이름에 개인 정보를 넣지 않는다. 인증서를 받으면 이름이 인증서 투명성 기록에 공개된다.
- AAAA 레코드는 두지 않는다. 아낌표의 IPv6 경로는 보지 않았다(미확인).
- 임시 도메인의 HSTS에 `includeSubDomains`와 preload를 쓰지 않는다. 지금 `deploy/Caddyfile`은 `max-age=31536000`만 붙인다.

### 2.1 DuckDNS 이름(권장안)

1. duckdns.org에 소셜 계정으로 로그인한다. 그 계정의 2단계 인증을 켠다(`domain.md` 5절).
2. 이름을 하나 더한다.
3. IPv4 값을 서버의 공인 IP로 둔다. 처음 더할 때 지금 브라우저의 IP(맥의 IP)가 들어갈 수 있으니 서버 IP인지 본다(추정). IPv6 값은 비워 둔다.
4. DuckDNS 토큰은 서버, 레포, CI 어디에도 두지 않는다. IP를 자동으로 보내는 스크립트를 설치하지 않는다(`domain.md` 5절).

`WEB_ORIGIN`은 `https://<이름>.duckdns.org`다.

### 2.2 정식 도메인

1. 도메인을 산다. 그 등록 도메인에는 아낌표만 둔다. 하위 이름에 다른 앱을 두지 않는다(ADR 005 결정 6).
2. 등록처의 DNS에서, 쓸 이름(루트 `@`나 하위 이름 하나)의 A 레코드를 서버의 공인 IP로 둔다.
3. TTL은 처음에는 짧게(예: 300초) 둔다. IP를 고칠 일이 생기면 빨리 바뀐다(추정).

`WEB_ORIGIN`은 `https://<그 이름>`이다. 첫 배포 뒤 DuckDNS에서 정식 도메인으로 옮길 때는 `domain.md` 7절을 따른다.

### 2.3 확인(맥)

```
dig +short <이름> A       # 서버의 공인 IP 하나
dig +short <이름> AAAA    # 아무것도 없다
```

첫 배포 PR을 머지하기 전에 맞아야 한다. 이름이 서버를 가리키지 않는 채로 프록시가 뜨면 인증서 검증이 실패한다. 실패는 이름마다 1시간에 5번이 한도다(`domain.md` 4절).

## 3. 레포 사본과 인스턴스 메타데이터 차단

### 3.1 서버에 레포 사본을 받는다

설치할 파일은 이 사본에서 복사한다. 서버에서 도는 것은 복사한 파일뿐이다. 레포가 바뀌어도 서버의 파일은 바뀌지 않는다(#52 범위 보강 1).

```
sudo -i
umask 077
git clone https://github.com/lomong7807/akkimpyo.git /root/akkimpyo
cd /root/akkimpyo
git log -1 --format='%H %s'
```

- 나온 커밋이 GitHub에서 본 main의 최신 커밋과 같은지 본다. 이후 서버 명령의 `deploy/...` 같은 상대 경로는 이 폴더가 기준이다.
- 다시 설치할 때는 `git pull --ff-only` 뒤 같은 확인을 한다.

### 3.2 먼저 센다

백업은 VM의 instance principal로 올린다. 같은 VM의 어느 컨테이너든 메타데이터 주소(169.254.169.254)에 닿으면 같은 자격을 얻어 가짜 백업을 올릴 수 있다(#52 범위 보강 7). 그래서 막기 전에 owner의 다른 컨테이너가 메타데이터를 쓰는지 센다(`deploy/backup.md`). 아낌표 컨테이너가 뜨기 전이라 지금 세면 owner의 컨테이너만 센다.

```
iptables -I DOCKER-USER -d 169.254.169.254/32 -p tcp --dport 80   # 동작 없이 세기만 한다
iptables -L DOCKER-USER -v -n
```

며칠 뒤(기간은 owner가 정한다) `iptables -L DOCKER-USER -v -n`으로 그 줄의 `pkts`를 다시 본다.

- 0이면 그동안 브리지의 컨테이너가 메타데이터를 쓰지 않았다. 세는 규칙을 지우고 3.3으로 간다.
- 늘었으면 owner의 어느 컨테이너가 쓰고 있다. 막으면 그 기능이 멈춘다. 여기서 멈추고 owner가 정한다. devops와 security에게 알린다.

```
iptables -D DOCKER-USER -d 169.254.169.254/32 -p tcp --dport 80   # 세는 규칙을 지운다
```

### 3.3 막는다

```
iptables -I DOCKER-USER -d 169.254.169.254/32 -p tcp --dport 80 -j REJECT
iptables -L DOCKER-USER -n --line-numbers
```

**TCP 80만 막는다.** Oracle Cloud에서는 같은 주소가 DNS(53)와 NTP(UDP 123)이기도 하다. 주소 전체를 막으면 브리지의 컨테이너에서 DNS와 NTP가 끊긴다(#52 정정 댓글, `deploy/backup.md`). VM의 프로세스와 `--network host`인 컨테이너(백업의 올리기 포함)는 이 규칙을 지나지 않는다.

### 3.4 재부팅 뒤에도 남긴다(안)

iptables로 넣은 규칙은 재부팅하면 없어진다(추정). 그래서 Docker가 뜬 뒤 `DOCKER-USER` 체인에 이 규칙을 다시 넣는 systemd 단위를 둔다. **이 단위는 이 문서의 안이다. security 검토 전이고 실제 VM에서 돌려 보지 않았다.**

```
cat >/etc/systemd/system/akkimpyo-metadata-block.service <<'EOF'
[Unit]
Description=아낌표: Docker 브리지에서 인스턴스 메타데이터(169.254.169.254, TCP 80)로 가는 요청을 막는다
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'iptables -C DOCKER-USER -d 169.254.169.254/32 -p tcp --dport 80 -j REJECT 2>/dev/null || iptables -I DOCKER-USER -d 169.254.169.254/32 -p tcp --dport 80 -j REJECT'

[Install]
WantedBy=docker.service
EOF
chmod 644 /etc/systemd/system/akkimpyo-metadata-block.service
systemctl daemon-reload
systemctl enable --now akkimpyo-metadata-block.service
iptables -L DOCKER-USER -n --line-numbers     # 169.254.169.254 줄이 하나만 있다
```

- 규칙이 이미 있으면(`-C`로 찾는다) 다시 넣지 않는다. 3.3에서 넣은 것과 겹치지 않는다.
- Docker가 다시 뜨면 `PartOf` 때문에 이 단위도 다시 돌아 규칙을 확인한다(추정).
- 한계(추정): 재부팅 때 Docker가 컨테이너를 다시 띄운 뒤에 이 단위가 돈다. 그 사이 몇 초는 막히지 않는다.
- `netfilter-persistent save`로 `/etc/iptables/rules.v4`에 저장하는 방법은 쓰지 않는다. Docker가 만든 규칙까지 같이 저장된다(추정).
- 일부러 재부팅하지 않는다. 다음 재부팅 뒤 `systemctl status akkimpyo-metadata-block.service`와 `iptables -L DOCKER-USER -n`으로 규칙이 하나 있는지 본다.

### 3.5 확인

`deploy/backup.md`의 확인 명령에 DNS와 호스트 네트워크 확인을 더했다. 백업이 쓰는 OCI CLI 이미지(받는 크기 약 200MB)를 받는다.

```
image=$(sed -n 's/^DEFAULT_OCI_CLI_IMAGE=//p' deploy/bin/backup-lib.sh)
probe="import urllib.request as u; print(u.urlopen(u.Request('http://169.254.169.254/opc/v2/instance/', headers={'Authorization': 'Bearer Oracle'}), timeout=5).status)"

docker run --rm --entrypoint python3 "$image" -c "$probe"                  # 브리지: Connection refused
docker run --rm --entrypoint python3 "$image" -c "import socket; print(socket.gethostbyname('github.com'))"   # 브리지: IP 주소가 나온다(DNS가 된다)
docker run --rm --network host --entrypoint python3 "$image" -c "$probe"   # 호스트 네트워크: 200
```

- 첫째는 `Connection refused`, 셋째는 `200`이어야 한다. 막기 전에는 첫째도 `200`이다(`deploy/backup.md`).
- 응답 본문은 출력하지 않는다. 상태 코드만 낸다.
- 실제 VM에서의 결과는 미확인이다. 격리된 Docker 29.9.2에서는 같은 결과였다(#52 정정 댓글).

## 4. 키와 토큰

### 4.1 원칙

| 값 | 만드는 곳 | 서버에서 두는 곳 | 소유, 권한 |
|---|---|---|---|
| 레포 읽기 전용 배포 키(개인키) | 서버 | `/etc/akkimpyo/deploy-key` | root, 600 |
| 이미지 받기 토큰(패키지가 비공개일 때만) | GitHub 화면 | `/etc/akkimpyo/docker/config.json` | root, 600(추정) |
| 텔레그램 봇 토큰, chat id | 텔레그램 | `/etc/akkimpyo/telegram.env` | root, 600 |
| access token 서명 키 | 서버(5절) | `/etc/akkimpyo/app.env` | root, 600 |
| DB 비밀번호 | 서버(5절) | `/etc/akkimpyo/app.env` | root, 600 |
| 백업 age 개인키 | owner 맥 | 서버에 두지 않는다(`deploy/backup.md`) | - |

- 서버에서 만들 수 있는 값은 서버에서 만들어 바로 파일에 넣는다. 화면에 내지 않는다.
- 브라우저나 텔레그램에서 받는 값은 `read -rs`로 붙여 넣는다. 화면에 나오지 않고 셸 기록에는 명령만 남는다. 값을 `echo 값`이나 `--password 값`처럼 명령줄에 쓰지 않는다.
- 값을 채팅(봇 포함), 이슈, PR, 메모 앱, 텔레그램의 다른 대화에 붙이지 않는다. 맥에서 클립보드 기록 앱을 쓰면 그 기록에서 지운다.
- 서버 접속 키는 GitHub에 두지 않는다(#54).

먼저 폴더를 만든다.

```
install -d -m 700 /etc/akkimpyo
```

### 4.2 레포 읽기 전용 배포 키

`deploy/deploy.md` '서버 설치'의 1번이다.

```
ssh-keygen -t ed25519 -N '' -C akkimpyo-deploy -f /etc/akkimpyo/deploy-key
stat -c '%U %a' /etc/akkimpyo/deploy-key      # root 600
cat /etc/akkimpyo/deploy-key.pub
```

- 나온 공개키를 GitHub 레포의 Settings > Deploy keys에 넣는다. **"Allow write access"는 켜지 않는다.** 화면은 미확인이다. 제목에 IP를 넣지 않는다(예: `akkimpyo-deploy 춘천 VM`).
- 타이머가 사람 없이 쓰므로 암호(passphrase)를 두지 않는다. 개인키는 서버 밖으로 옮기지 않는다.
- 이 키로 받아지는지는 6.3의 첫 실행에서 본다.

### 4.3 이미지 받기 토큰

ghcr.io의 `akkimpyo-server`와 `akkimpyo-web` 패키지가 **둘 다 공개면 토큰이 필요 없다**(`deploy/deploy.md`). 이 절을 건너뛴다. 공개 여부는 미확인이다. owner가 GitHub의 패키지 설정(visibility)에서 본다.

서버에서 로그인 없이 받아 보는 것으로도 알 수 있다(추정). digest는 main의 최근 Image 실행 요약에 있다.

```
tmp=$(mktemp -d)
docker --config "$tmp" pull --quiet ghcr.io/lomong7807/akkimpyo-server@sha256:<서버 digest>   # 받아지면 공개
docker --config "$tmp" pull --quiet ghcr.io/lomong7807/akkimpyo-web@sha256:<웹 digest>
rm -r "$tmp"
```

`denied`나 `unauthorized`가 나오면 비공개다. 비공개면 토큰을 만든다.

1. GitHub에서 classic personal access token을 만든다. 권한은 `read:packages` 하나만 고른다. ghcr.io는 fine-grained 토큰을 받지 않는다(추정).
   - 이 토큰은 이 레포만이 아니라 owner 계정이 읽을 수 있는 패키지를 모두 읽는다(추정). 쓰기와 지우기는 못 한다.
   - 만료일을 정하고 달력에 적는다. 만료되면 배포가 "배포 파일이 바뀌었지만 교체하지 않는다"(이미지를 받지 못했다)로 멈춘다(`deploy/deploy.md` '알림').
2. 서버에 넣는다. `deploy/deploy.md` '서버 설치'의 2번이고, 토큰 파일은 `read -rs`로 만든다.

   ```
   install -d -m 700 /etc/akkimpyo/docker
   read -rs -p 'ghcr 토큰: ' t; echo; printf '%s' "$t" >/root/ghcr-token; unset t
   docker --config /etc/akkimpyo/docker login ghcr.io --username <GitHub 사용자> --password-stdin </root/ghcr-token
   rm /root/ghcr-token
   stat -c '%U %a' /etc/akkimpyo/docker/config.json    # root 600(추정)
   ```

   `Login Succeeded`가 나와야 한다. "credentials are stored unencrypted" 경고는 예상한 것이다. 파일은 root만 읽는다.
3. 배포 서비스는 `DOCKER_CONFIG=/etc/akkimpyo/docker`로 이 파일을 쓴다. 서비스가 `ProtectHome=yes`라 `/root/.docker`를 보지 못하기 때문이다.

### 4.4 텔레그램 알림 봇

알림 전용 봇을 새로 만든다. 다른 용도의 봇과 같이 쓰지 않는다. 그룹에 넣지 않고 owner와의 1:1 대화로만 쓴다. 배포와 백업 알림이 이 봇으로 간다.

1. 텔레그램 앱에서 @BotFather에게 `/newbot`을 보내고 이름을 정한다. BotFather가 토큰을 보낸다. 화면은 미확인이다.
2. 만든 봇에게 owner 계정으로 아무 글(`/start`)이나 하나 보낸다. chat id를 찾는 데 쓴다.
3. 서버에서 파일을 만든다.

   ```
   install -m 600 /dev/null /etc/akkimpyo/telegram.env
   read -rs -p '텔레그램 봇 토큰: ' t; echo; printf 'TELEGRAM_BOT_TOKEN=%s\n' "$t" >/etc/akkimpyo/telegram.env; unset t

   # chat id: 2번에서 보낸 글로 찾는다. 토큰은 명령줄이 아니라 curl 설정으로 넘긴다(notify-telegram과 같은 방식).
   t=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' /etc/akkimpyo/telegram.env)
   curl --disable --silent --fail --max-time 20 \
     --config <(printf 'url = "https://api.telegram.org/bot%s/getUpdates"\n' "$t") |
     grep -oE '"chat":\{"id":-?[0-9]+' | head -n 1 | sed 's/.*://; s/^/TELEGRAM_CHAT_ID=/' >>/etc/akkimpyo/telegram.env
   unset t

   sed 's/=.*/=(값)/' /etc/akkimpyo/telegram.env    # TELEGRAM_BOT_TOKEN=(값), TELEGRAM_CHAT_ID=(값) 두 줄
   stat -c '%U %a' /etc/akkimpyo/telegram.env       # root 600
   ```

   - `TELEGRAM_CHAT_ID` 줄이 없으면 봇에게 글을 다시 보내고 `t=$(...)`부터 다시 한다. 응답의 모양(공백 없는 JSON)은 추정이다.
   - `deploy/bin/notify-telegram`은 이 파일이 root 소유, 권한 600이 아니거나 두 값의 형식이 틀리면 보내지 않는다.
4. BotFather가 보낸 토큰 글은 서버에 넣은 뒤 텔레그램에서 지운다.
5. 보내기 시험은 6.2에서 `notify-telegram`을 설치한 뒤에 한다.

**6.2에서 `deploy/backup.md`의 `install -m 600 /dev/null /etc/akkimpyo/telegram.env` 줄을 다시 하지 않는다.** 하면 이 파일이 비워진다.

### 4.5 서명 키와 DB 비밀번호

5.2에서 `app.env`에 바로 만든다. 따로 만들거나 적어 두지 않는다.

## 5. `/etc/akkimpyo/app.env`

### 5.1 이름

`deploy/env.example`(#306)의 이름 그대로다. 배포 스크립트는 허용 목록(`deploy/env.allowlist`)에 없는 이름, 같은 이름 두 번, 필수 이름의 빈 값이 있으면 배포하지 않는다(`deploy/deploy.md` 'env 파일 검사').

| 이름 | 필수 | 값(자리) | 메모 |
|---|---|---|---|
| `WEB_ORIGIN` | 필수 | `https://<이름>` | 2절에서 정한 이름. 소문자로, 포트·경로·끝 빗금 없이 쓴다. 서버의 우리 출처이자 프록시의 사이트 주소다 |
| `DB_URL` | 필수 | `jdbc:postgresql://db:5432/accountbook` | 고정값. `logServerErrorDetail` 같은 연결 설정을 붙이지 않는다 |
| `DB_USERNAME` | 필수 | `accountbook` | 서버가 쓰는 DB 역할. `postgres`가 아닌 이름 |
| `DB_PASSWORD` | 필수 | `<openssl rand -hex 32의 출력>` | 서버에서 바로 파일로 넣는다 |
| `ACCESS_TOKEN_SIGNING_KEY` | 필수 | `<openssl rand -base64 32의 출력>` | 서버에서 바로 파일로 넣는다. 로컬과 다른 값이다 |
| `PROXY_HTTP_PORT` | 선택 | 비워 둔다(기본 80) | 다른 서비스와 겹칠 때만 바꾼다 |
| `PROXY_HTTPS_PORT` | 선택 | 비워 둔다(기본 443) | 위와 같다 |
| `ACCESS_LOG_KEEP_DAYS` | 선택 | 비워 둔다(기본 14) | 접근 로그(IP가 남는다)를 남겨 두는 날 수. #23에서 정하는 값으로 바꾼다 |

- 넣지 않는 것: `SERVER_IMAGE`, `WEB_IMAGE`, `SW_DISABLE`(배포 파일에서 온다), `SPRING_PROFILES_ACTIVE`, `JDK_JAVA_OPTIONS`(compose에 고정돼 있다).
- 형식: `이름=값` 한 줄에 하나. 값에 따옴표, 공백, `$`를 쓰지 않는다.
- 선택 이름은 빈 값이어도 배포 스크립트가 거부하지 않는다. 빈 값을 검사하는 것은 필수 다섯 이름뿐이다(#311 스크립트).

### 5.2 채우기

PR #306 본문의 명령이다(`deploy/env.example`에 적힌 예와 같은 방식). 마지막 줄의 `<정한 이름>`을 바꿔 넣고 실행한다.

```
install -m 600 deploy/env.example /etc/akkimpyo/app.env
sed -i "s|^DB_PASSWORD=\$|DB_PASSWORD=$(openssl rand -hex 32)|" /etc/akkimpyo/app.env
sed -i "s|^ACCESS_TOKEN_SIGNING_KEY=\$|ACCESS_TOKEN_SIGNING_KEY=$(openssl rand -base64 32)|" /etc/akkimpyo/app.env
sed -i 's|^DB_URL=$|DB_URL=jdbc:postgresql://db:5432/accountbook|; s|^DB_USERNAME=$|DB_USERNAME=accountbook|' /etc/akkimpyo/app.env
sed -i 's|^WEB_ORIGIN=$|WEB_ORIGIN=https://<정한 이름>|' /etc/akkimpyo/app.env
```

- 값은 화면에 나오지 않는다. 셸 기록에는 `$(openssl ...)`라는 글자만 남는다.
- **첫 줄은 처음 한 번만 한다.** 다시 하면 채운 값이 모두 지워진다.
- DB를 만든 뒤 `DB_PASSWORD`만 바꾸면 서버가 DB에 접속하지 못한다. DB의 역할도 `ALTER ROLE`로 바꿔야 한다(`deploy/env.example`). 서명 키를 바꾸면 발급된 access token이 모두 무효가 된다. 바꾸는 절차는 #54의 `docs/ops/secrets.md`가 다룬다(아직 없다).
- 두 값의 사본을 다른 곳에 두지 않는다.

### 5.3 값을 내지 않고 확인한다

```
grep -v -E '^[[:space:]]*(#|$)' /etc/akkimpyo/app.env | sed -E 's/=.+$/=(값 있음)/; s/=$/=(비어 있음)/'
grep '^WEB_ORIGIN=' /etc/akkimpyo/app.env      # 비밀값이 아니다. 주소가 맞는지 눈으로 본다
stat -c '%U %a' /etc/akkimpyo/app.env          # root 600
```

필수 다섯 이름이 `(값 있음)`, 선택 세 이름이 `(비어 있음)`이어야 한다. compose로 하는 검사는 6.4에 있다.

### 5.4 `SIGNUP_ALLOWLIST`(후속 PR)

- 서버는 `SIGNUP_ALLOWLIST`(쉼표로 나눈 이메일이나 `@도메인`)에 있는 이메일의 가입만 받는다. 없거나 비면 아무도 가입할 수 없다. 이메일도 `@도메인`도 아닌 항목이 있으면 서버가 뜨지 않는다(확인: main의 `server/src/main/java/app/accountbook/user/SignupAllowlist.java`).
- #306에는 이 이름이 없다. `deploy/env.allowlist`, `deploy/env.example`, compose의 서버 환경 변수에 이 이름을 더하는 일은 **#52 범위 보강 23의 후속 PR로 더해진다.** 그 PR을 설치하기 전에 app.env에 넣으면 배포 스크립트가 "허용 목록에 없는 이름"으로 배포를 거부한다(#311의 env 검사).
- 후속 PR이 머지되면, 그 PR이 바꾼 파일을 6.1처럼 다시 설치한 뒤 값을 넣는다.

  ```
  sed -i '/^SIGNUP_ALLOWLIST=/d' /etc/akkimpyo/app.env
  read -r -p 'SIGNUP_ALLOWLIST(가입할 이메일): ' v; printf 'SIGNUP_ALLOWLIST=%s\n' "$v" >>/etc/akkimpyo/app.env; unset v
  ```

- 값은 개인 이메일이다. 레포, PR, 이슈, 알림에 적지 않는다. 서버의 이 파일에만 둔다(#52 범위 보강 23).
- owner의 이메일 하나만 넣는다. owner 밖의 이메일은 승인 방식 전환(#55)이 끝나기 전에 넣지 않는다. 누구나 주소를 만들 수 있는 공용 메일 도메인을 `@도메인`으로 넣으면 그 도메인을 쓰는 누구나 가입할 수 있다.
- 첫 배포 전에 넣는 것을 권한다. 첫 배포 뒤에 넣으면 서버 컨테이너가 다시 만들어질 때(다음 배포) 반영된다(추정). 그 전에는 owner도 가입할 수 없으므로 8절의 로그인 확인을 미룬다.

## 6. 파일 설치

`deploy/deploy.md`가 정한 순서대로 한다: #306의 설치 → 백업 설치 → 배포 스크립트 설치. 3.1의 레포 사본 폴더에서 root로 한다. 서버의 파일은 모두 root 소유이고 레포에서 자동으로 바뀌지 않는다. 바꾸려면 owner가 다시 설치한다.

### 6.1 운영 compose와 그 파일(#306)

```
install -d -m 755 /opt/akkimpyo/deploy
install -m 644 deploy/compose.yaml deploy/Caddyfile deploy/env.allowlist /opt/akkimpyo/deploy/
install -m 755 deploy/db-init.sh /opt/akkimpyo/deploy/
```

- #306 본문의 설치 명령 중 `/etc/akkimpyo`와 `app.env`는 4·5절에서 했다.
- compose는 `Caddyfile`과 `db-init.sh`를 자기와 같은 폴더(`./`)에서 붙인다. 셋을 같은 폴더에 둔다.

### 6.2 백업(`deploy/backup.md`)

`deploy/backup.md`를 따른다. 여기에는 그 문서와 다르게 하는 것만 적는다.

1. '서버 설치 전 조건'의 1(메타데이터 차단)은 3절에서 했다. 2(복원 훈련 전용 읽기 사용자)는 첫 복원 훈련 전까지 한다(8절).
2. 'Object Storage 설정'과 '키 쌍 만들기'가 끝나 있어야 한다(1.1).
3. '서버 설치'의 명령 블록에서 다르게 하는 것:
   - `install -m 600 /dev/null /etc/akkimpyo/telegram.env` 줄은 **하지 않는다**(4.4에서 만들었다).
   - `backup.env`를 설치한 뒤 `OCI_NAMESPACE`와 `OCI_BUCKET`을 채운다. 비밀값은 아니지만 레포에 적지 않는다.

     ```
     sed -i 's|^OCI_NAMESPACE=$|OCI_NAMESPACE=<네임스페이스>|; s|^OCI_BUCKET=$|OCI_BUCKET=<버킷>|' /etc/akkimpyo/backup.env
     ```

   - `systemctl daemon-reload`까지 한 뒤 알림 시험을 한다. 텔레그램에 '알림 시험'이 와야 한다. 배포는 시작 알림을 보내지 못하면 교체하지 않는다(#311).

     ```
     echo '알림 시험' | /opt/akkimpyo/bin/notify-telegram
     ```

   - 첫 백업(`systemctl start akkimpyo-backup.service`)과 타이머 켜기(`systemctl enable --now akkimpyo-backup.timer akkimpyo-backup-check.timer`)는 **첫 배포 뒤 8절에서 한다.** 지금은 DB 컨테이너가 없어 백업이 "돌고 있는 DB 컨테이너가 하나가 아니다"로 실패하고 알린다(확인: `deploy/bin/backup`).

### 6.3 배포 스크립트와 타이머(#311)

`deploy/deploy.md` '서버 설치'의 3~5번이다. 1·2번은 4.2, 4.3에서 했다.

```
install -m 755 deploy/bin/deploy /opt/akkimpyo/bin/
install -m 644 deploy/github-known-hosts /opt/akkimpyo/deploy/
install -m 644 deploy/systemd/akkimpyo-deploy.service deploy/systemd/akkimpyo-deploy.timer /etc/systemd/system/
systemctl daemon-reload

systemctl start akkimpyo-deploy.service
journalctl -u akkimpyo-deploy -o cat

systemctl enable --now akkimpyo-deploy.timer
systemctl list-timers 'akkimpyo*'
```

- 첫 실행의 마지막 줄은 `main에 deploy/production.env 가 없다. 할 일이 없다`여야 한다. 이것으로 배포 키, GitHub 호스트 키, 그리고 서비스의 격리 설정(`ProtectSystem=strict`, `ProtectHome=yes`) 아래의 git과 ssh를 본다. 격리 아래의 docker는 첫 배포(7.2)에서 처음 쓴다(추정: 배포 파일이 없으면 docker를 부르지 않는다).
- 날 만한 실패 문구(#311 스크립트): `GitHub 호스트 키 파일이 없다`, `... 이 root 소유, 권한 600인 파일이 아니다`, `명령이 없다: ...`, `시간대 자료(tzdata)가 없다`. ssh가 `Permission denied`면 4.2의 공개키가 GitHub에 없거나 다른 레포에 들어간 것이다(추정).
- 배포 스크립트는 같은 폴더의 `notify-telegram`과 `/opt/akkimpyo/bin/backup`을 부른다. 그래서 6.2를 먼저 한다.
- 타이머는 켜지고 1분 뒤, 그 뒤로는 앞의 실행이 끝나고 5분마다 돈다.

### 6.4 설치 뒤 확인

```
stat -c '%U %a %n' /etc/akkimpyo /etc/akkimpyo/* /opt/akkimpyo/deploy/* /opt/akkimpyo/bin/*
stat -c '%U %a %n' /etc/akkimpyo/docker/config.json      # 비공개 패키지일 때만
SERVER_IMAGE=x WEB_IMAGE=x SW_DISABLE=no docker compose --project-name akkimpyo \
  --file /opt/akkimpyo/deploy/compose.yaml --env-file /etc/akkimpyo/app.env config --quiet && echo 'compose 변수 통과'
```

| 경로 | 소유, 권한 |
|---|---|
| `/etc/akkimpyo` | root 700 |
| `/etc/akkimpyo/app.env`, `deploy-key`, `telegram.env`, `backup.env` | root 600 |
| `/etc/akkimpyo/deploy-key.pub`, `backup-recipients.txt` | root 644 |
| `/etc/akkimpyo/docker`(비공개 패키지일 때) | root 700. 안의 `config.json`은 600(추정) |
| `/opt/akkimpyo/deploy/compose.yaml`, `Caddyfile`, `env.allowlist`, `github-known-hosts` | root 644 |
| `/opt/akkimpyo/deploy/db-init.sh` | root 755 |
| `/opt/akkimpyo/bin/deploy`, `backup`, `backup-check`, `notify-telegram` | root 755 |
| `/opt/akkimpyo/bin/backup-lib.sh` | root 644 |

- compose 검사는 필수 변수(`${이름:?}`)가 모두 있는지만 본다. `--quiet`라 값을 내지 않는다(추정). 이미지 자리의 `x`는 검사용이고 아무것도 띄우지 않는다.

## 7. 첫 배포

### 7.1 첫 배포 PR

- devops가 만든다. `deploy/production.env`를 처음 만드는 PR이고 그 파일 하나만 바꾼다. 다른 파일을 같이 바꾸면 Deploy PR 검사가 실패한다(`.github/workflows/deploy-pr.yml`).
- 파일은 정확히 네 줄이다(`deploy/deploy.md` '배포 파일'). digest는 배포할 커밋의 Image 실행 요약에서 고른다(배포 PR 양식의 '고르는 법').

  ```
  SERVER_IMAGE=ghcr.io/lomong7807/akkimpyo-server@sha256:<소문자 16진수 64자>
  WEB_IMAGE=ghcr.io/lomong7807/akkimpyo-web@sha256:<소문자 16진수 64자>
  ROLLBACK_SAFE=yes
  SW_DISABLE=no
  ```

- 본문은 양식 [`.github/PULL_REQUEST_TEMPLATE/deploy.md`](../../.github/PULL_REQUEST_TEMPLATE/deploy.md)다. '첫 배포일 때만' 네 칸(선행 이슈, 다른 웹 앱의 포트, 메타데이터 차단, 되돌아갈 이전 이미지가 없음)은 이 문서의 1.1, 1.4, 3절에 맞춰 채운다.
- 첫 배포에는 되돌아갈 이전 이미지가 없다. 상태 확인이 실패하면 `ROLLBACK_SAFE`와 상관없이 멈춘다(양식).
- owner는 머지하기 전에 1~6절이 끝났는지 본다. 특히 2.3(이름이 서버를 가리킨다), 6.2(알림 시험이 왔다), 6.3(첫 실행이 "할 일이 없다"), 5.4(가입 허용 목록)다.
- 머지는 owner가 한다.

### 7.2 머지 뒤에 일어나는 일

| 때(추정) | 서버가 하는 일 | owner가 할 일 |
|---|---|---|
| 머지 뒤 5분 안 | 타이머가 main의 배포 파일을 받아 형식을 본다. env 파일을 검사하고 두 이미지를 받는다 | - |
| 그 직후 | **시작 알림**: "배포 파일이 바뀌었다. 10분 뒤(…) 교체한다." 커밋, PR 번호, 서버·웹 digest(`없음(첫 배포) → sha256:…`), `SW_DISABLE`, 마이그레이션(`첫 배포라 모두 적용된다: …`), `ROLLBACK_SAFE` | 커밋, PR 번호, digest가 머지한 PR과 같은지 본다. 다르거나 PR 번호가 없으면 10분 안에 `systemctl stop akkimpyo-deploy.timer` |
| 알림 뒤 10~15분 | 교체: env 파일 다시 검사 → 직전 백업은 건너뛴다(DB가 아직 없다) → DB가 처음 뜨며 `db-init.sh`가 돈다 → 서버가 뜨며 Flyway가 스키마를 만든다 → 상태 확인(최대 약 2분) → 프록시가 뜨고 인증서를 받는다 | 진행을 보려면 아래 명령 |
| 끝 | **완료 알림**: "배포가 끝났다." 직전 백업 `없음(DB 컨테이너가 없다. 첫 배포)`, 걸린 시간 | 7.3을 한다 |

```
journalctl -u akkimpyo-deploy -o cat -f                        # 진행을 본다(Ctrl-C로 나온다)
docker ps --filter label=com.docker.compose.project=akkimpyo
cat /var/lib/akkimpyo-deploy/history
```

- "배포 파일이 바뀌었지만 교체하지 않는다"가 오면 알림에 적힌 이유(env 파일의 이름, 이미지 받기)를 고친다. 다음 확인 때 다시 본다.
- "배포가 실패했고 되돌아갈 이전 판이 없어 멈췄다"가 오면 `journalctl -u akkimpyo-deploy -o cat`, `docker logs akkimpyo-server-1`, `docker logs akkimpyo-db-1`을 본다. DB를 처음 만드는 데서 실패했으면 7.4로 간다. 로그를 남에게 보일 때는 비밀값이 없는지 먼저 본다.
- 인증서를 받지 못하면(7.3의 프록시 로그) 1.3과 2.3을 다시 본다. Caddy가 스스로 다시 시도한다. `caddy-data` 볼륨을 지우지 않는다(`domain.md` 1절 6번, 발급 한도).
- compose 명령(`docker compose ps`, `logs`)은 이미지 변수 없이는 멈춘다. `docker ps`와 `docker logs akkimpyo-…-1`을 쓴다(#306).

### 7.3 첫 기동 확인

```
docker exec akkimpyo-db-1 psql -X -U postgres -d postgres -c 'SHOW data_checksums' -c 'SHOW log_error_verbosity'
docker exec akkimpyo-db-1 psql -X -U postgres -d postgres -At -c \
  "SELECT rolname, rolsuper, rolpassword IS NULL FROM pg_authid WHERE rolname IN ('postgres', 'accountbook') ORDER BY rolname"
docker logs akkimpyo-proxy-1 2>&1 | grep -i 'certificate obtained'
```

기대하는 결과:

- `data_checksums`는 `on`, `log_error_verbosity`는 `terse`다.
- 역할은 두 줄이다.
  - `accountbook|f|f`: 슈퍼유저가 아니고 비밀번호가 있다.
  - `postgres|t|t`: 슈퍼유저이고 **비밀번호가 비어 있다**.
- 프록시 로그에 이름의 인증서를 받았다는 줄(`certificate obtained successfully`)이 있다.

관리 역할(`postgres`)의 비밀번호가 비어 있는지 보는 이유(dba, #306 검토): `db-init.sh`가 중간에 실패하면 initdb는 끝난 상태로 남아 다음 기동에서 다시 돌지 않는다. 그러면 관리 역할에 `DB_PASSWORD`가 남아, 프로젝트 네트워크 안에서 TCP로 슈퍼유저 접속이 된다. 이 확인은 비밀번호 해시를 출력하지 않는다(`IS NULL`의 참·거짓만 낸다).

`postgres|t|f`가 나오거나 `accountbook` 줄이 없으면 7.4로 간다.

### 7.4 실패했을 때: DB 볼륨을 다시 만든다

**첫 기동이라 데이터가 없을 때만** owner가 한다. 데이터가 있으면 하지 않고 devops와 dba에게 알린다. 그때 역할을 고치는 방법은 dba가 정한다.

1. 데이터가 없는지 본다.

   ```
   docker exec akkimpyo-db-1 psql -X -U postgres -d accountbook -At -c 'SELECT count(*) FROM users'
   ```

   `0`이거나 `relation "users" does not exist`면 데이터가 없다. DB 컨테이너가 떠 있지 않아 볼 수 없으면, 첫 배포 뒤 아무도 가입하지 않았을 때만 계속한다.
2. 배포를 멈추고 아낌표의 세 컨테이너와 `db-data` 볼륨만 지운다.

   ```
   systemctl stop akkimpyo-deploy.timer
   flock --nonblock /var/lib/akkimpyo-deploy/lock true && echo '돌고 있는 배포가 없다'
   docker stop akkimpyo-proxy-1 akkimpyo-server-1 akkimpyo-db-1
   docker rm akkimpyo-proxy-1 akkimpyo-server-1 akkimpyo-db-1
   docker volume ls --filter label=com.docker.compose.project=akkimpyo
   docker volume rm "$(docker volume ls --quiet --filter label=com.docker.compose.project=akkimpyo --filter label=com.docker.compose.volume=db-data)"
   ```

   - `flock` 줄에서 아무것도 나오지 않으면 배포가 돌고 있다. 끝날 때까지 기다린 뒤 다시 본다.
   - 없는 컨테이너는 오류가 나도 넘어간다. 첫 배포가 중간에 멈췄을 수 있다.
   - **`caddy-data`(인증서, 접근 로그), `caddy-config`, `assets-prev`는 지우지 않는다.**
3. 다시 배포하게 한다.

   ```
   rm -f /var/lib/akkimpyo-deploy/failed
   systemctl start akkimpyo-deploy.timer
   ```

   도는 컨테이너가 없으므로 스크립트는 배포 파일과 다르다고 보고, 시작 알림을 다시 보낸 뒤 10분 뒤 교체한다(추정: #311 스크립트의 비교와 `failed` 처리를 읽고). 7.2와 7.3을 다시 본다.
4. 두 번째도 실패하면 되풀이하지 않는다. `docker logs akkimpyo-db-1`에 비밀값이 없는지 본 뒤 devops와 dba에게 보인다.

## 8. 배포 뒤 확인 목록

맥의 명령에서 `<이름>`은 2절의 이름이다. 맥의 명령은 `site`를 정한 같은 셸에서 이어서 한다. 서버의 명령은 root로 한다.

- [ ] **아이폰 Safari에서 경고 없이 열린다.** `https://<이름>/`을 연다. 인증서 경고나 위험 사이트 경고가 없어야 한다. 경고 없이 열린다는 것은 추정이고 실기기는 미확인이다(`domain.md` 3절). 홈 화면에 추가해 한 번 연다.
- [ ] **밖에서 닿는 포트**(맥).

  ```
  nc -vz -w 5 <이름> 80                       # succeeded
  nc -vz -w 5 <이름> 443                      # succeeded
  nc -vz -w 5 <이름> <1.4에서 닫은 포트>      # 닿지 않는다
  ```

- [ ] **로그인.** 아이폰에서 `/signup`으로 5.4의 이메일로 가입하고 로그인한다. Safari와 홈 화면 앱은 저장소가 따로라 각각 로그인한다(`domain.md` 6절). 허용 목록 밖의 이메일로는 가입이 안 된다. 5.4가 아직이면 이 칸은 미룬다.
- [ ] **보안·캐시 헤더**(맥).

  ```
  site=https://<이름>
  for p in / /api/v1/me /actuator/health; do
    echo "== $p"
    curl -sS -o /dev/null -D - "$site$p" |
      grep -i -E '^(HTTP/|strict-transport-security:|x-content-type-options:|x-frame-options:|content-security-policy:|cache-control:|server:|via:|x-request-id:)'
  done
  echo "== http"
  curl -sS -o /dev/null -D - "http://<이름>/" | grep -i -E '^(HTTP/|location:|server:)'
  ```

  | 주소 | 상태 | 볼 것 |
  |---|---|---|
  | `/` | 200 | `strict-transport-security: max-age=31536000`(`includeSubDomains`, `preload` 없음), `x-content-type-options: nosniff`, `x-frame-options: DENY`, `content-security-policy: frame-ancestors 'none'`, `cache-control: no-cache`, `x-request-id` 있음, `server`와 `via` 없음 |
  | `/api/v1/me`(토큰 없이) | 401 | 위와 같은 보안 헤더. `cache-control`은 서버 값(`no-cache, no-store, max-age=0, must-revalidate`) 그대로 |
  | `/actuator/health` | 404 | 밖에는 내지 않는다. 보안 헤더와 `cache-control: no-store` |
  | `http://<이름>/` | 308 | `location: https://<이름>/`, `server` 없음 |

- [ ] **정적 파일**(맥).

  ```
  asset=$(curl -sS "$site/" | grep -oE '/assets/[^"]+\.js' | head -n 1)
  curl -sS -o /dev/null -D - "$site$asset" | grep -i -E '^(HTTP/|cache-control:)'           # 200, public, max-age=31536000, immutable
  curl -sS -o /dev/null -w '%{http_code}\n' "$site/assets/x.js"                            # 404 (index.html로 넘기지 않는다)
  curl -sS -o /dev/null -D - "$site/manifest.webmanifest" | grep -i -E '^(HTTP/|content-type:|cache-control:)'   # application/manifest+json, no-cache
  ```

- [ ] **`/sw.js`는 no-cache**(맥).

  ```
  curl -sS -o /dev/null -D - "$site/sw.js" | grep -i -E '^(HTTP/|cache-control:|content-type:)'   # 200, no-cache, text/javascript
  curl -sS -o /dev/null -w '%{http_code}\n' "$site/sw-x.js"                                       # 404
  ```

- [ ] **아낌표 서버 컨테이너도 메타데이터에 닿지 않는다**(서버). 3.3의 규칙이 아낌표 네트워크(사용자 정의 브리지)에도 걸리는지 본다. 격리된 Docker에서는 사용자 정의 브리지도 막혔다(`deploy/backup.md`).

  ```
  docker exec akkimpyo-server-1 curl -sS --max-time 5 -o /dev/null -w '%{http_code}\n' \
    -H 'Authorization: Bearer Oracle' http://169.254.169.254/opc/v2/instance/
  ```

  `Connection refused`가 나와야 한다.
- [ ] **백업 첫 실행과 권한**(서버, `deploy/backup.md`). 6.2에서 미룬 것이다.

  ```
  systemctl start akkimpyo-backup.service
  journalctl -u akkimpyo-backup -o cat              # '올렸다: daily/akkimpyo-…KST.tar.age' 줄이 있다
  systemctl enable --now akkimpyo-backup.timer akkimpyo-backup-check.timer
  systemctl list-timers 'akkimpyo*'                 # backup, backup-check, deploy 세 타이머
  ```

  그다음 `deploy/backup.md` '권한 확인'의 여섯 명령을 한다. 첫째만 성공하고 나머지는 거부돼야 한다. 이 권한 확인은 DB가 필요 없으므로, 정책을 넣은 뒤라면 첫 배포 전에 해도 된다. 파일 권한은 6.4의 표로 다시 본다.
- [ ] **로그인 한 번의 비밀번호 해시가 0.5초 이하다**(#20).
  1. 먼저 서버 접속 없이 본다. 맥 브라우저의 개발자 도구 Network에서 `POST /api/v1/auth/login`의 서버 응답 대기 시간을 본다.
  2. 프록시 접근 로그의 처리 시간(초)을 본다(서버). 로그인을 다섯 번쯤 한 뒤 뒤쪽 값을 본다. 서버가 뜬 직후의 첫 요청은 느릴 수 있다(추정).

     ```
     docker exec akkimpyo-proxy-1 cat /data/access-log/access.log |
       grep -F '"uri":"/api/v1/auth/login"' | grep -oE '"duration":[0-9.e-]+' | tail -n 5
     ```

     처리 시간에는 해시 시간이 들어 있으므로, 처리 시간이 0.5초 이하면 해시도 0.5초 이하다. 접근 로그 줄에는 IP가 있으니 처리 시간만 꺼내 본다.
  3. 0.5초를 넘으면 security와 perf에게 값을 알린다. 값을 바꾸는 판단은 두 봇이 한다. 네트워크 시간이 섞여 판단이 안 되면, 서버 안에서 해시만 따로 재는 방법은 owner OK를 받아 그때 정한다(#54 댓글).
- [ ] **알림이 온다.** 시작 알림과 완료 알림(7.2), 6.2의 알림 시험이 왔다. 백업은 실패할 때만 알린다(`deploy/backup.md` '알림').
- [ ] **배포 서비스가 격리 아래에서 돌았다.** `journalctl -u akkimpyo-deploy -o cat`에 첫 배포가 오류 없이 "배포가 끝났다"까지 있다. 격리 설정 아래의 docker는 여기서 처음 확인된다(#311의 남은 위험).
- [ ] **첫 복원 훈련.** owner가 실제 지출을 넣기 전에 운영 백업으로 한 번 통과한다(#54 댓글). `deploy/backup.md`의 '복원 훈련'과 '서버 설치 전 조건' 2(훈련 전용 읽기 사용자)를 따른다.

## 9. 되돌리기와 긴급 끄기

평소의 방법은 `deploy/deploy.md`(#311)와 배포 PR 양식에 있다. 여기에는 어디를 볼지만 적는다.

| 상황 | 할 일 | 볼 곳 |
|---|---|---|
| 시작 알림을 받았는데 내가 머지한 배포가 아니거나 잘못 머지했다 | 10분 안에 배포 PR을 되돌리는 PR(Revert)을 머지한다. 급하면 서버에서 `systemctl stop akkimpyo-deploy.timer` | `deploy/deploy.md` '알림', 양식 '되돌리는 방법' |
| 교체가 끝난 배포를 되돌린다 | 배포 PR을 되돌리는 PR을 머지한다. 다시 빌드하지 않고 이전 digest로 간다. 이미 적용된 마이그레이션은 되돌리지 않는다 | 양식 '되돌리는 방법', `deploy/deploy.md` 첫머리의 '한계' |
| 이전 앱이 새 스키마에서 뜨지 않는다 | 백업 복원. 자동으로 하지 않는다 | `docs/db/restore-runbook.md` |
| 배포를 멈추고 다시 켠다(복원할 때 등). 실패한 배포 파일로 다시 한다. 이력을 본다 | `systemctl stop akkimpyo-deploy.timer`, `systemctl start akkimpyo-deploy.timer`, `rm /var/lib/akkimpyo-deploy/failed`, `cat /var/lib/akkimpyo-deploy/history` | `deploy/deploy.md` '운영' |
| 알림마다 할 일 | - | `deploy/deploy.md` '알림' |
| 새 판이 열리지 않거나 옛 판이 계속 보이고, 앱을 되돌려도 풀리지 않는다(service worker 긴급 끄기) | `SW_DISABLE=yes`로 바꾸는 배포 PR을 머지한다. 이미지 digest는 그대로 둔다. 고친 판을 배포한 뒤 `SW_DISABLE=no` 배포 PR을 낸다 | `deploy/deploy.md` '배포 파일', 양식 'SW_DISABLE', #52 범위 보강 22 |

첫 배포에서만 다른 점(추정, #311 스크립트를 읽고):

- 되돌아갈 이전 이미지가 없다. 상태 확인이 실패하면 멈춘다.
- 첫 배포 PR을 되돌리면 main에 배포 파일이 없어진다. 스크립트는 "할 일이 없다"로 끝나고, 돌고 있는 컨테이너는 그대로 둔다.
- 그래서 첫 배포의 앱을 밖에서 급히 닫으려면 `docker stop akkimpyo-proxy-1`을 한다. 스크립트는 멈춘 컨테이너도 지금 판으로 보므로(`docker ps --all`로 찾는다) 타이머가 다시 띄우지 않는다. 다시 열 때는 `docker start akkimpyo-proxy-1`이나 고친 배포 PR이다.

## 10. owner가 정할 것과 미확인

### owner가 정할 것

| 정할 것 | 절 |
|---|---|
| 주소: DuckDNS 이름(권장안)과 정식 도메인 중 무엇으로 첫 배포를 할지 | 2, `domain.md` 9절 |
| ghcr.io 패키지가 공개인지(패키지 설정에서 본다). 비공개면 토큰과 그 만료일 | 4.3 |
| grafana·prometheus 포트가 열려 있으면 어떻게 닫을지 | 1.4 |
| 메타데이터를 세는 기간, 쓰는 컨테이너가 있을 때 어떻게 할지 | 3.2 |
| 재부팅 뒤에도 메타데이터 규칙을 남기는 단위(안)를 쓸지(security 검토 뒤) | 3.4 |
| 공인 IP가 임시면 그대로 둘지 | 1.5 |
| 스왑이 켜져 있으면 그대로 둘지 | 1.6 |
| journal이 35일을 남기지 못하면 어떻게 할지 | 1.8 |

### 미확인

- Oracle 콘솔: 보안 목록과 NSG의 지금 규칙, 80·443이 밖에서 닿는지, 메뉴의 이름과 위치
- 서버: grafana·prometheus 포트가 밖에 열려 있는지, 공인 IP의 종류, 스왑, journal 보존 기간, Docker의 방화벽 방식
- ghcr.io 패키지의 공개 여부, classic 토큰만 받는지
- DuckDNS, GitHub(Deploy keys, 토큰, 패키지 설정), 텔레그램(BotFather) 화면
- 실제 VM에서: 메타데이터 차단의 결과(3.5), 재부팅 뒤 규칙을 남기는 단위(3.4), 서비스 격리 아래의 docker·git·ssh, 공개 인증서 발급, 밖에서 80·443으로 닿는지
- 아이폰 실기기에서 경고 없이 열리는지, 운영 VM의 로그인 해시 시간
- `SIGNUP_ALLOWLIST` 후속 PR의 실제 파일과 명령(5.4)
- `docker compose config --quiet`가 값을 전혀 내지 않는지(6.4), 텔레그램 `getUpdates` 응답의 모양(4.4)
