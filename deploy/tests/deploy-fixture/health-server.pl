# 배포 스크립트 시험용 가짜 서버. 8080에서 GET /actuator/health 하나에만 답한다.
# HEALTH=up    200, 최상위 status UP(안쪽 구성 요소 하나는 DOWN)
# HEALTH=down  200, 최상위 status DOWN(안쪽 구성 요소는 UP). 상태 코드만 보거나 안쪽 status를 보면 통과해 버리는 판정을 잡는다
# HEALTH=crash 바로 1로 끝난다(마이그레이션이 실패해 서버가 뜨지 않는 경우)
use strict;
use warnings;
use IO::Socket::INET;

$SIG{TERM} = sub { exit 0 };
my $mode = $ENV{HEALTH} // 'up';
exit 1 if $mode eq 'crash';

my %body = (
    up   => '{"components":{"mail":{"status":"DOWN"}},"groups":["liveness","readiness"],"status":"UP"}',
    down => '{"components":{"db":{"status":"UP"}},"status":"DOWN"}',
);
my $server = IO::Socket::INET->new(LocalAddr => '0.0.0.0', LocalPort => 8080, Listen => 16, ReuseAddr => 1)
    or die "listen: $!";
while (my $client = $server->accept) {
    my $request = <$client> // '';
    while (my $header = <$client>) {
        last if $header =~ /^\r?\n$/;
    }
    my ($status, $body) = $request =~ m{^GET /actuator/health HTTP/} ? ('200 OK', $body{$mode}) : ('404 Not Found', '{}');
    print $client "HTTP/1.1 $status\r\nContent-Type: application/json\r\nContent-Length: "
        . length($body) . "\r\nConnection: close\r\n\r\n$body";
    close $client;
}
