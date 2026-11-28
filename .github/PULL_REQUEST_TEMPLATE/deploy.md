<!--
배포 PR 양식(#52). PR을 만들 때 주소 끝에 ?expand=1&template=deploy.md 를 붙이면 이 양식이 들어간다.
- 이 PR은 deploy/production.env 한 파일만 바꾼다. 다른 파일을 같이 바꾸면 Deploy PR 검사가 실패한다.
- 머지하면 서버가 5분 안에 변경을 보고 텔레그램으로 알린 뒤, 10분 뒤에 교체한다. 그 사이에 이 PR을 되돌리면 교체하지 않는다.
- 비밀값, 서버 주소, 토큰을 적지 않는다(공개 레포).
-->

## 대상

- 대상 커밋(main): `<커밋 SHA 40자>`
- 서버 digest: `sha256:<64자>`
- 웹 digest: `sha256:<64자>`
- 이 digest를 만든 Image 실행: <실행 링크> (그 실행의 커밋: `<커밋 SHA>`)

digest 고르는 법(#52 범위 보강 4):

1. 대상 커밋에 Image 실행이 있으면 그 실행 요약의 digest를 쓴다.
2. 없으면(문서만 바뀐 커밋) 그 앞의 가장 가까운 **성공한** Image 실행의 digest를 쓴다.
3. 그 사이에 **실패한** Image 실행이 있으면 더 앞의 digest를 쓰지 않는다(옛 코드가 나간다). 실패한 실행을 다시 돌려 성공시킨 뒤 그 digest를 쓴다.

```
gh run list --workflow image.yml --branch main --limit 20 --json databaseId,headSha,conclusion,url
```

## 마이그레이션

- [ ] 없음
- [ ] 있음: `V..__....sql` (지금 운영 커밋과 대상 커밋 사이)

```
git diff --no-renames --name-status <운영 커밋> <대상 커밋> -- server/src/main/resources/db/migration
```

- 바로 전 판 앱이 새 스키마에서 그대로 도는가(dba 기준, `docs/db/migration-standards.md`):

서버의 시작 알림에도 두 이미지의 커밋 사이 마이그레이션 변경이 나온다. 이 칸과 다르면 교체 전에 이 PR을 되돌린다.

## ROLLBACK_SAFE

- 값: `yes` / `no`
- 이유:
- `no`이면 되돌리는 방법(되돌리는 SQL을 다음 번호 마이그레이션으로 이전 코드와 같이 내기, 또는 백업 복원):

`yes`면 교체 뒤 상태 확인이 실패할 때 서버가 이전 이미지로 자동으로 되돌린다. `no`면 되돌리지 않고 멈춰서 알린다.
이전 이미지로 돌아가도 이미 적용된 마이그레이션은 그대로다(스키마는 되돌리지 않는다).

## SW_DISABLE

- 값: `no` (service worker를 끄는 배포가 아니면 `no`)
- `yes`이면 이유와 다시 `no`로 돌릴 배포 계획:

## 되돌리는 방법

- 이 PR을 되돌리는 PR(GitHub의 Revert)을 머지한다. 이미지를 다시 빌드하지 않는다. 서버는 다시 알리고 10분 뒤 이전 digest로 바꾼다.
- 시작 알림 뒤 10분 안이면 되돌리는 PR을 머지하는 것만으로 교체가 일어나지 않는다. 급하면 서버에서 `systemctl stop akkimpyo-deploy.timer`.
- 이미 적용된 마이그레이션은 되돌리지 않는다. 이전 앱이 새 스키마에서 뜨지 않으면 백업 복원이 필요하다(`docs/db/restore-runbook.md`).

## 직전 백업

서버의 배포 스크립트가 교체 직전에 백업한다(`/opt/akkimpyo/bin/backup`). 백업이 실패하면 교체하지 않는다. 사람이 따로 뜨지 않는다.
완료 알림에 올린 백업 객체 이름이 나온다.

## 점검

- [ ] 이 PR은 `deploy/production.env` 한 파일만 바꾼다
- [ ] 두 digest가 위 Image 실행의 요약과 같다
- [ ] 머지한 뒤 텔레그램 시작 알림의 커밋, PR 번호, digest, 마이그레이션이 이 PR과 같은지 본다

### 첫 배포일 때만

- [ ] 선행 이슈가 모두 머지됐다: #17, #18, #21(본문 상한), #51, #53, #52
- [ ] 같은 VM의 다른 웹 앱(grafana, prometheus)이 자기 포트로 밖에 열려 있지 않다(`docs/ops/domain.md` 1절 4번)
- [ ] 메타데이터 주소의 TCP 80을 Docker 브리지에서 막았다(`deploy/backup.md`)
- [ ] 되돌아갈 이전 이미지가 없다. 상태 확인이 실패하면 `ROLLBACK_SAFE`와 상관없이 멈춘다
