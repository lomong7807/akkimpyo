# 도메인: 첫 배포의 임시 주소와 정식 도메인으로 바꾸기

- 상태: 제안(2026-11-25). owner가 정할 것은 9절에 있다.
- 다루는 것: 도메인을 정하기 전 첫 배포에 쓸 임시 주소. 사용자는 owner 한 명이고 아이폰 홈 화면 웹앱으로 쓴다.
- 지킬 조건의 원본은 [ADR 005](../adr/005-deployment-topology.md) 결정 6과 [#54](https://github.com/lomong7807/akkimpyo/issues/54) 댓글이다.
- 표기
  - **확인**: 2026-11-25(KST)에 원문이나 원본 파일을 열어 봤다. 링크는 10절에 있다.
  - **추정**: 확인한 것에서 미루어 생각했다.
  - **미확인**: 보지 못했다.
- 서버에 접속하거나 계정을 만들거나 인증서를 발급해 보지 않았다. 이 서버와 아이폰에서의 실제 동작은 모두 추정이나 미확인이다.
- 프록시 설정과 환경 변수의 실제 이름은 #52가 머지된 뒤 이 문서에 맞춰 넣는다.

## 1. 어느 주소든 먼저 지킬 것

1. **가입 허용 목록(P-102)을 인증서 발급보다 먼저 켠다.** 인증서를 받으면 호스트 이름이 인증서 투명성 기록에 공개된다. Let's Encrypt는 발급한 인증서를 모두 그 기록에 올린다([확인][le-ct]). 주소를 숨겨서 지키는 것은 기대하지 않는다.
2. **이름에 개인 정보를 넣지 않는다.** 위와 같은 이유다. DuckDNS 약관 4항도 사람 이름과 같은 이름을 등록하지 말라고 한다([확인][duck-tac]).
3. **임시 도메인에는 HSTS의 `includeSubDomains`와 preload를 쓰지 않는다**(#54, #52). preload 목록은 올리면 쉽게 되돌릴 수 없고 빼는 데 몇 달이 걸린다([확인][preload]).
4. **grafana, prometheus의 포트를 밖에 열지 않는다.** 이름을 써도 그 이름은 이 서버의 IP를 가리키므로, 다른 앱의 포트가 밖에 열려 있으면 `우리이름:포트`로도 열린다(추정). 쿠키는 포트로 나뉘지 않고([RFC 6265 8.5절, 확인][rfc6265]) 사이트 판정에도 포트가 들어가지 않는다([HTML 표준, 확인][html-site]). 표준은 http와 https를 다른 사이트로 보지만(확인) 아이폰이 그대로 따르는지는 미확인이다. ADR 001의 `Origin` 확인은 포트까지 보므로 남는다. ADR 005는 포트 조건을 IP 방식에만 적었다. 이름에도 지키자는 것은 이 문서의 제안이고 architect 확인이 필요하다. 지금 그 포트가 열려 있는지는 미확인이다.
5. **80과 443이 밖에서 닿아야 한다.** HTTP-01은 80만, TLS-ALPN-01은 443만 쓴다([확인][le-chal]). 서버에서 두 포트가 비어 있는 것은 owner 확인(2026-11-24)이다. Oracle 쪽 방화벽(보안 목록 등)에서 열려 있어 밖에서 닿는지는 미확인이다.
6. **Caddy의 인증서 저장 볼륨을 지우지 않는다.** 지우고 다시 받기를 되풀이하면 4절의 한도에 걸린다.

## 2. 후보와 뺀 것

| 후보 | 판단 | 이유 |
|---|---|---|
| DuckDNS(`duckdns.org`) | 권장 | PSL(Public Suffix List)에 있다. 읽은 공식 문서(5절)에 고정 IP를 막는 조건이 없다 |
| deSEC(`dedyn.io`) | 뺌 | PSL에 있지만 바뀌는 IP를 위한 서비스다. 가입 화면 원본은 "IP를 주기적으로 갱신해야 한다"를 조건으로 두고([확인][desec-signup]), deSEC 포럼에서 운영 쪽은 IP가 바뀌지 않으면 용도 밖이라 끊을 수 있다고 답했다([확인][desec-talk], 2023-02-13 글) |
| No-IP(`ddns.net`) | 뺌 | PSL에 있지만 무료 이름은 30일마다 손으로 확인해야 한다. 놓치면 DNS에서 빠지고, 회수 기간이 지나면 남이 그 이름을 가져갈 수 있다([확인][noip]) |
| IP 주소용 인증서 | 권하지 않음 | 3절, 4절 |
| sslip.io류 | 뺌 | PSL에 없다(확인). 그 도메인을 쓰는 모든 사람이 같은 등록 도메인이 되어 ADR 005 결정 6에 맞지 않는다 |

PSL은 [publicsuffix.org의 원본][psl]에서 확인했다. 판은 `2026-11-24_16-45-31_UTC`다. `duckdns.org`, `dedyn.io`, `ddns.net`은 PRIVATE 구역에 각각 한 줄씩 있고 `sslip.io`, `nip.io`는 없다. `duckdns.org`는 2015-07-09에 들어갔다([확인][psl-duck]).

애플 기기의 목록도 봤다. WebKit은 `_CFHostIsDomainTopLevel`로 판정하고([확인][webkit-psl]), macOS 27.0.1에서 이 함수는 위 세 도메인에 참, `sslip.io`와 `nip.io`에 거짓을 돌려줬다(확인). 아이폰도 같다고 본다(추정).

## 3. 비교

deSEC과 No-IP는 2절의 이유로 빼고, 남은 둘을 비교한다.

| 항목 | DuckDNS 이름 | IP 주소용 인증서 |
|---|---|---|
| 비용 | 무료([확인][duck-faq]). 인증서도 무료 | 인증서 무료 |
| 준비할 것 | DuckDNS 계정, 이름 하나, A 레코드. 80·443 열기. Caddy는 사이트 주소에 이름만 적으면 HTTP-01과 TLS-ALPN-01로 받는다([확인][caddy-auto]) | 80·443 열기. Caddy에 발급자, `shortlived` 프로필, `default_sni`를 따로 적어야 한다(4절) |
| 아이폰에서 경고 없이 열리는지 | 열린다(추정). Let's Encrypt의 기본 사슬은 ISRG Root X1로 끝나고([확인][le-chains]) iOS 10 이상이 믿는다([확인][le-compat]). 실기기는 미확인. 무료 이름이 브라우저의 위험 사이트 경고에 걸릴 수 있다(5절) | 미확인. 애플 문서는 "SAN에 서버의 DNS 이름이 있어야 한다"고만 하고 IP는 말하지 않는다([확인][apple-tls]) |
| 쿠키(SameSite=Strict) 조건 | 맞다. `우리이름.duckdns.org`가 우리만의 등록 도메인이다(목록 확인, 아이폰은 추정). Domain을 두지 않으므로 다른 DuckDNS 이름과 섞이지 않는다 | IP가 곧 사이트다([확인][html-site]). **같은 IP에서 다른 앱을 어떤 포트로도 밖에 내지 않을 때만** 맞다(ADR 005) |
| 다른 앱과의 격리 | 다른 DuckDNS 사용자는 다른 사이트다(확인). 같은 서버의 다른 앱은 1절 4번을 지켜야 한다 | 같은 IP의 모든 앱이 같은 사이트다. grafana를 IP로 열면 바로 어긋난다 |
| 유지 조건 | 정해진 만료 기간을 찾지 못했다(5절) | 인증서를 160시간마다 새로 받아야 한다([확인][le-ga]). 서버 IP가 바뀌면 주소가 바뀐다 |
| 갱신이 막혔을 때의 여유 | 90일짜리는 약 30일(계산). 2027-02-10부터 64일짜리라 약 21일(계산) | 약 53시간(계산) |
| HSTS | 쓸 수 있다(1절 3번) | 쓸 수 없다. 브라우저는 IP 주소를 HSTS 대상으로 기억하지 않는다([RFC 6797 8.1.1절, 확인][rfc6797]) |
| 위험 | 무료 서비스의 장애, 이름을 잃는 것, 위험 사이트 경고(5절) | 짧은 갱신 주기, 포트 조건이 깨지는 것, 주소가 바뀌는 것 |

여유는 Caddy가 쓰는 CertMagic이 기간의 1/3이 남았을 때 갱신을 시작하는 것([확인][cm-renew])과 인증서 기간([확인][le-profiles], [확인][le-45])으로 계산했다. ARI를 쓰면 더 일찍 갱신될 수 있다.

IP 방식을 권하지 않는 이유(#54 댓글)는 SameSite가 포트를 구분하지 않기 때문이다. 이 서버에는 owner의 prometheus와 grafana가 같이 돈다. 그 포트가 밖에 열려 있으면 이 방식은 쓰지 않는다. 열려 있는지는 미확인이다.

## 4. 인증서: Let's Encrypt와 Caddy

### 발급 한도

출처는 [Let's Encrypt 한도 문서][le-rate](2026-08-05 판, 확인)다. 등록 도메인은 PSL로 정하고, IPv4는 주소 하나를 등록 도메인처럼 센다.

| 한도 | 값 | DuckDNS 이름 | IP 주소 |
|---|---|---|---|
| 등록 도메인당 새 인증서 | 7일에 50개 | `우리이름.duckdns.org`가 단위라 다른 DuckDNS 사용자와 나눠 쓰지 않는다 | 그 IPv4 주소가 단위다 |
| 같은 이름 묶음의 인증서 | 7일에 5개, 34시간마다 1개 회복. 예외 신청 없음 | 같다 | 같다 |
| 검증 실패 | 이름마다 계정마다 1시간에 5번 | 같다 | 같다 |

- 실제로 걸릴 만한 것은 두 번째와 세 번째다. 설정을 시험할 때는 스테이징을 쓴다. Caddy는 다시 시도할 때 스스로 스테이징으로 바꾼다([확인][caddy-auto]).
- ARI로 하는 갱신은 모든 한도에서 빠진다(확인). Caddy 2.11.9가 쓰는 CertMagic 0.25.6은 ARI를 쓴다([확인][cm-renew]).

### Caddy와 도메인 이름

- HTTP-01(80)과 TLS-ALPN-01(443)을 기본으로 켜 두고, 하나가 실패하면 다른 것으로 넘어간다([확인][caddy-auto]). 둘 중 하나만 닿아도 받을 수 있다(추정).
- Let's Encrypt가 안 되면 ZeroSSL로 시도하고, 그래도 안 되면 최대 30일 동안 다시 시도한다([확인][caddy-auto]).
- 80과 443을 둘 다 못 쓰면 DNS-01만 남는다. 표준 Caddy에는 DuckDNS 모듈이 없어 [따로 넣어 빌드][caddy-duck]해야 하고 DuckDNS 토큰을 서버에 둬야 한다. Let's Encrypt는 DNS 자격을 웹 서버에 두면 위험이 커진다고 적는다([확인][le-chal]). 쓰지 않는다.

### Caddy와 IP 주소

- Let's Encrypt의 IP 인증서는 `shortlived` 프로필(160시간)로만 받고 DNS-01은 쓸 수 없다([확인][le-ga], [확인][le-profiles], [확인][le-chal]).
- Caddy 문서는 IP를 공개 인증서 대상이 아니라고 적고 자체 인증서를 쓴다([확인][caddy-auto]). 그대로 두면 아이폰에서 경고가 난다(추정). Caddy 2.11.9 소스의 주석은 IP 인증서를 받으려면 그것을 지원하는 발급자를 따로 적으라고 하고([확인][caddy-src]), CertMagic 0.25.6은 Let's Encrypt에 IP 인증서를 요청할 수 있다([확인][cm-ip]). `profile`은 실험 기능이다([확인][caddy-tls]).
- 클라이언트는 IP로 접속할 때 이름(SNI)을 보내지 않는다([RFC 6066, 확인][rfc6066]). 이때 CertMagic은 접속을 받은 쪽의 IP에 맞는 인증서를 먼저 찾고, 없으면 `default_sni`를 쓴다([확인][cm-sni]). 컨테이너 안에서는 그 IP가 공인 IP가 아니므로 `default_sni`를 적어야 한다(추정).

## 5. DuckDNS의 유지 조건과 위험

| 항목 | 내용 |
|---|---|
| 만료 | [FAQ][duck-faq], [API 설명][duck-spec], [약관][duck-tac](2018-12-14), [개인정보 안내][duck-priv](2020-01-28)에 "며칠 갱신이 없으면 지운다"는 규칙이 없다(확인). 개인정보 안내 7항은 사용자와 DNS 항목이 더는 활성이 아니게 된 뒤 약 1년 데이터를 두고 1년에 한 번 정리한다고 적는다(확인). "활성"이 무엇인지는 미확인이다 |
| 갱신 | 바뀌지 않는 IP면 다시 보낼 필요가 없다(추정). 몇 달에 한 번 웹 화면에서 값이 그대로인지 본다 |
| 정지와 회수 | 약관을 어기면 계정이나 이름을 지우거나 잠그거나 가져갈 수 있고, 예고 없이 정지할 수 있다(약관 1항, 확인). 보증은 없다(6항, 확인) |
| 운영 주체 | 엔지니어 두 명이 AWS에서 돌린다([확인][duck-about]). `duckdns.org`의 등록 만료는 2029-04-12다([RDAP, 확인][duck-rdap]) |
| 장애 | 이름 서버가 멈추면 새 접속과 인증서 갱신이 함께 막힌다(추정). A 레코드 TTL은 60초다(예시 이름 `test.duckdns.org` 조회, 확인). 2025-11-18에 이름 서버 9대가 모두 응답하지 않았다는 글이 있다([사용자 글][le-duck]). 2026-11-25 15:41 KST에는 9대 모두 정상으로 답했다(확인, 한 번 조회). 운영자가 낸 장애 기록은 찾지 못했다(미확인) |
| 이름을 빼앗기는 것 | DNS를 DuckDNS가 쥔다. 로그인은 소셜 계정으로 한다(개인정보 안내 1항, 확인). 토큰만 있으면 A 레코드를 바꿀 수 있다(API 설명, 확인). 빼앗기면 남이 그 이름으로 인증서를 받아 로그인 화면을 흉내 낼 수 있다(추정). DNSSEC은 없다(확인) |
| 위험 사이트 경고 | DuckDNS 이름이 Chrome에서 위험 사이트로 표시됐다는 글이 있다([사용자 글][ha-duck], 2021~2022). No-IP도 Google Safe Browsing 오탐이 있다고 안내한다([확인][noip-deceptive]). Safari에서의 빈도는 미확인이다 |
| 막는 망 | DNS 필터나 회사 망이 동적 DNS 이름을 막는 일이 있다(추정). owner가 쓰는 망에서는 미확인이다 |

위험을 줄이는 방법: DuckDNS 토큰을 서버, 레포, CI에 두지 않는다. A 레코드는 owner가 웹 화면에서 한 번 넣는다. 로그인에 쓰는 계정의 2단계 인증을 켠다.

서버의 공인 IP가 임시(ephemeral)인지 예약(reserved)인지는 미확인이다. 임시 주소는 인스턴스를 멈춰도 남지만 인스턴스를 지우면 없어진다([확인][oci-ip]). 이름을 쓰면 A 레코드만 고치면 되고, IP 방식은 주소 자체가 바뀐다.

## 6. 정식 도메인으로 바꿀 때 바뀌는 것

| 대상 | 바뀌는 것 |
|---|---|
| 로그인 쿠키 | Domain 속성이 없어 옛 호스트에만 간다(ADR 005). 새 주소에서는 다시 로그인한다. 옛 쿠키는 로그아웃하지 않으면 최대 30일 브라우저에 남는다(ADR 001) |
| 우리 출처 값 | 서버는 운영 출처를 하나만 받는다(ADR 001 결정 5). 이 값을 같이 바꾸지 않으면 `/api/v1/auth` 요청이 403 `ORIGIN_NOT_ALLOWED`다. 두 주소로 동시에 로그인할 수 없다 |
| 홈 화면 아이콘 | 매니페스트의 `id`와 `start_url`은 `/home`이라 파일은 그대로다(확인, main `1292a69`). 앱의 정체는 시작 주소와 같은 출처의 URL이므로 새 도메인은 다른 앱이다([확인][manifest]). 옛 아이콘은 옛 주소를 연다(추정). 지우고 새 주소에서 다시 추가한다 |
| 웹앱 저장소 | IndexedDB는 출처마다 따로다([확인][idb]). 보내지 않은 입력과 읽기용 사본은 옮겨지지 않는다. 홈 화면 앱은 Safari의 일부가 아니다([확인][webkit-home]). Safari와 홈 화면 앱에서 각각 로그아웃한다 |
| 오프라인 화면 | 오프라인으로 열리는 기능(P-902)이 들어간 뒤에는 옛 아이콘이 서버 없이도 옛 화면을 열 수 있다(추정). 아이콘을 지워야 하는 이유다 |
| HSTS | 호스트 이름마다 따로 기억한다([RFC 6797 8.2절, 확인][rfc6797-host]). 옛 이름의 기록은 `max-age`가 지날 때까지 남지만 새 이름에는 영향이 없다 |
| 인증서 | 새 이름으로 새로 받는다. 옛 인증서는 설정에서 이름을 빼면 갱신되지 않고 만료된다(추정). 새 이름도 인증서 투명성 기록에 공개된다. 한도는 따로 센다(4절) |
| 주소가 든 링크 | 초대(P-304), 열람 링크(P-311), 문자 전송 주소(P-508)가 있는 단계에서 바꾸면 이미 보낸 링크가 끊긴다(추정). 1단계에는 없다 |
| 바뀌지 않는 것 | DB의 데이터, access token 서명 키 |

## 7. 정식 도메인으로 바꾸는 절차

1단계, owner 한 명일 때의 절차다. 실행은 owner가 따로 승인한 뒤에 한다. 2단계 뒤에 바꾸면 다른 사용자에게 알리는 단계를 더해 다시 쓴다.

1. (owner) 도메인을 산다. 그 등록 도메인에는 아낌표만 둔다(ADR 005).
2. (owner) A 레코드를 서버의 공인 IP로 두고, 밖에서 그 이름이 풀리는지 본다.
3. (devops) 프록시의 사이트 주소와 서버의 "우리 출처" 값을 바꾸는 PR을 준비한다. 둘은 함께 바꾼다. 서버에 설치된 사본은 owner가 바꾼다(#52).
4. (owner) 모든 기기에서 아래 순서를 지킨다. 로그아웃하면 대기열이 지워지므로(ADR 006 결정 6, 7) 순서를 바꾸지 않는다.
   1. "보내지 않은 입력"이 0건인지 본다. 남아 있으면 보낸다.
   2. 로그아웃한다. Safari와 홈 화면 앱에서 각각 한다.
   3. 홈 화면 아이콘을 지운다.
5. (owner) 3번을 적용하고 프록시와 서버를 다시 띄운다.
6. (owner, devops) 확인한다.
   - 새 주소가 아이폰 Safari에서 경고 없이 열린다.
   - 로그인과 갱신이 되고 쿠키 속성이 ADR 005와 같다.
   - HSTS 값이 의도한 값이다. 정식 도메인의 값은 그때 정한다.
   - 옛 주소에서는 로그인이 되지 않는다.
7. (owner) 새 주소에서 로그인하고 홈 화면에 다시 추가한다. 4번에서 로그아웃하지 못한 기기가 있으면 비밀번호를 바꾼다. 지금 기기를 뺀 로그인이 모두 폐기된다(P-108).
8. (owner) 새 주소를 며칠 쓴 뒤 옛 이름의 A 레코드를 비운다. 이름은 적어도 30일 동안 지우지 않는다. 남이 그 이름을 가져가면 옛 아이콘과 남은 쿠키가 그 사람의 서버로 갈 수 있다(추정).

- 옛 주소에서 새 주소로 넘겨주기(redirect)는 두지 않는다. 사용자가 한 명이고, 홈 화면 앱에서 다른 출처로 넘어갈 때 iOS가 어떻게 여는지 미확인이기 때문이다.
- 되돌리기: 8번을 하기 전이면 3번의 두 값을 옛 주소로 돌린다. 데이터는 서버에 있으므로 다시 로그인하면 된다. 그 사이 새 주소의 기기에 쌓인 보내지 않은 입력은 먼저 보낸다.

## 8. 미확인

- VM: 80·443이 밖에서 닿는지(서버에서 비어 있는 것은 owner 확인, 2026-11-24. Oracle 쪽 방화벽은 미확인), grafana·prometheus 포트가 밖에 열려 있는지, 공인 IP가 임시인지 예약인지
- 아이폰 실기기: DuckDNS 주소와 IP 인증서가 경고 없이 열리는지, PSL 판정과 http·https 사이트 구분, 홈 화면 앱에서 다른 출처로 넘어갈 때의 동작, 옛 아이콘의 동작
- DuckDNS: 쓰지 않는 이름의 만료 기간과 "활성"의 뜻, 지운 이름을 남이 가져갈 수 있는지, 지금 되는 로그인 방법과 이름 개수 한도, 운영자가 낸 장애 기록
- DuckDNS 이름이 Safari의 사기성 사이트 경고나 owner가 쓰는 망에서 막히는 일이 있는지
- Caddy 2.11.9로 IP 인증서를 실제로 받는 것
- 정식 도메인의 가격

## 9. 권장안과 owner가 정할 것

**권장안: DuckDNS 이름 하나를 쓰고, Caddy가 Let's Encrypt의 기본 프로필로 HTTP-01·TLS-ALPN-01 인증서를 받게 한다.** 1절의 여섯 조건을 지키고 DuckDNS 토큰은 서버에 두지 않는다. 아이폰에서 위험 사이트 경고가 나오거나 DuckDNS 장애가 반복되면 정식 도메인을 사는 것을 앞당긴다.

owner가 정할 것

| 구분 | 정할 것 |
|---|---|
| 돈이 드는 것 | 정식 도메인을 언제 살지. 첫 배포 전에 사면 DuckDNS 계정과 7절의 절차가 필요 없다 |
| 계정을 만드는 것 | DuckDNS 계정을 만들지, 어느 소셜 계정으로 로그인할지(2단계 인증을 켠 것). DuckDNS는 이메일과 IP를 저장한다(개인정보 안내, 확인) |
| 이름 | 공개돼도 되는 이름. 개인 정보를 넣지 않는다 |
| 서버에서 볼 것 | 8절의 VM 미확인 세 가지(80·443이 밖에서 닿는지, 다른 앱의 포트, 공인 IP 종류). grafana·prometheus 포트가 밖에 열려 있으면 닫을지(1절 4번). 공인 IP가 임시이면 그대로 둘지. 임시 주소를 같은 값의 예약 주소로 바꿀 수는 없다([확인][oci-ip]) |

## 10. 출처

모두 2026-11-25(KST)에 열어 봤다. Caddy와 CertMagic 소스는 PR #110의 Caddy 2.11.9에 맞춘 판이다.

| 주제 | 링크 |
|---|---|
| PSL | [원본 목록][psl], [duckdns.org를 넣은 커밋][psl-duck], [WebKit의 판정 코드][webkit-psl] |
| Let's Encrypt | [한도][le-rate], [프로필][le-profiles], [검증 방식][le-chal], [IP·6일 인증서 공개][le-ga], [인증서 기간 단축][le-45], [인증서 투명성][le-ct], [사슬][le-chains], [호환성][le-compat] |
| Caddy | [자동 HTTPS][caddy-auto], [tls 지시문][caddy-tls], [IP 발급자 판정 소스(2.11.9)][caddy-src], [DuckDNS 모듈][caddy-duck] |
| CertMagic 0.25.6 | [IP 인증서][cm-ip], [SNI가 없을 때][cm-sni], [갱신 시점과 ARI][cm-renew] |
| DuckDNS | [FAQ][duck-faq], [API 설명][duck-spec], [약관][duck-tac], [개인정보 안내][duck-priv], [소개][duck-about], [RDAP][duck-rdap], [장애 사용자 글][le-duck], [위험 사이트 사용자 글][ha-duck] |
| 다른 무료 이름 | [deSEC 가입 화면 원본][desec-signup], [deSEC 운영자 글][desec-talk], [No-IP 만료][noip], [No-IP 위험 사이트 경고][noip-deceptive] |
| 쿠키, HSTS, 웹앱 | [RFC 6265][rfc6265], [HTML 표준의 사이트][html-site], [RFC 6797][rfc6797], [HSTS preload][preload], [RFC 6066][rfc6066], [매니페스트 `id`][manifest], [IndexedDB 저장 단위][idb], [WebKit 홈 화면 앱][webkit-home], [애플 인증서 요구 사항][apple-tls] |
| 서버 | [Oracle Cloud 공인 IP][oci-ip] |

[psl]: https://publicsuffix.org/list/public_suffix_list.dat
[psl-duck]: https://github.com/publicsuffix/list/commit/a79d808f5e
[webkit-psl]: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/cocoa/PublicSuffixStoreCocoa.mm
[le-rate]: https://letsencrypt.org/docs/rate-limits/
[le-profiles]: https://letsencrypt.org/docs/profiles/
[le-chal]: https://letsencrypt.org/docs/challenge-types/
[le-ga]: https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability
[le-45]: https://letsencrypt.org/2025/12/02/from-90-to-45
[le-ct]: https://letsencrypt.org/docs/ct-logs/
[le-chains]: https://letsencrypt.org/certificates/
[le-compat]: https://letsencrypt.org/docs/certificate-compatibility/
[caddy-auto]: https://caddyserver.com/docs/automatic-https
[caddy-tls]: https://caddyserver.com/docs/caddyfile/directives/tls
[caddy-src]: https://github.com/caddyserver/caddy/blob/v2.11.9/caddyconfig/httpcaddyfile/tlsapp.go
[caddy-duck]: https://github.com/caddy-dns/duckdns
[cm-ip]: https://github.com/caddyserver/certmagic/blob/v0.25.6/acmeissuer.go
[cm-sni]: https://github.com/caddyserver/certmagic/blob/v0.25.6/handshake.go
[cm-renew]: https://github.com/caddyserver/certmagic/blob/v0.25.6/maintain.go
[duck-faq]: https://www.duckdns.org/faqs.jsp
[duck-spec]: https://www.duckdns.org/spec.jsp
[duck-tac]: https://www.duckdns.org/tac.jsp
[duck-priv]: https://www.duckdns.org/pp.jsp
[duck-about]: https://www.duckdns.org/about.jsp
[duck-rdap]: https://rdap.publicinterestregistry.org/rdap/domain/duckdns.org
[le-duck]: https://community.letsencrypt.org/t/dns-resolv-not-working-with-duckdns-org-domain/243118
[ha-duck]: https://community.home-assistant.io/t/mydomain-duckdns-org-marked-as-dangerous-after-pasting-passwords/357812
[desec-signup]: https://github.com/desec-io/desec-stack/blob/main/www/webapp/src/views/SignUp.vue
[desec-talk]: https://talk.desec.io/t/3-expiration-of-inactive-dyndns-domains/212
[noip]: https://www.noip.com/support/knowledgebase/why-is-my-hostname-pending-deletion
[noip-deceptive]: https://www.noip.com/support/knowledgebase/deceptive-page-warning
[rfc6265]: https://www.rfc-editor.org/rfc/rfc6265#section-8.5
[rfc6797]: https://www.rfc-editor.org/rfc/rfc6797#section-8.1.1
[rfc6797-host]: https://www.rfc-editor.org/rfc/rfc6797#section-8.2
[rfc6066]: https://www.rfc-editor.org/rfc/rfc6066#section-3
[html-site]: https://html.spec.whatwg.org/multipage/browsers.html#sites
[preload]: https://hstspreload.org/
[manifest]: https://www.w3.org/TR/appmanifest/#id-member
[idb]: https://www.w3.org/TR/IndexedDB/#database-construct
[webkit-home]: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
[apple-tls]: https://support.apple.com/en-us/103769
[oci-ip]: https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/managingpublicIPs.htm
