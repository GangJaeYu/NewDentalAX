# 구현 워커 시도 4 — AC4 수동 확인(자기 확인 방식)

- 일시: 2026-11-02, 새 콘솔(활성 코드 페이지 949)에서 `start.bat`과 `node server/main.ts`를 각각 실행. PORT=18191, DATA_DIR=.tmp 안 임시 폴더, NO_BROWSER=1.
- 점유: dual=Node listen(PORT)([::] 이중 스택), v4any=0.0.0.0, v4loop=127.0.0.1, v6only=Node {host:'::', ipv6Only:true}, dotnet=PowerShell .NET TcpListener(IPv6Any), v6loop=::1. none=점유 없음(health 확인 뒤 stop.flag로 종료).
- start.bat 종료 코드 1(재시작 없음), node 종료 코드 2. 각 줄 끝은 server.log의 판정 줄.

## 1. 기본(미리 확인 ① + 자기 확인 ②)
```
none-startbat | exit=0 | cp=활성 코드 페이지: 949 | 원인=False 해결=False 켜짐=True 재시작=False | 점유= | 서버 시작 pid=38844 host=:: port=18191 | 서버 종료 (stop.bat 요청) | health: localhost=200/96ba24 127.0.0.1=200/96ba24 [::1]=200/96ba24 172.24.96.1=200/96ba24 192.168.80.1=200/96ba24 192.168.0.14=200/96ba24 | 실행중 리스너: [::] pid=38844
none-node | exit=0 | cp=활성 코드 페이지: 949 | 원인=False 해결=False 켜짐=True 재시작=False | 점유= | 서버 시작 pid=30848 host=:: port=18191 | 서버 종료 (stop.bat 요청) | health: localhost=200/e2cb35 127.0.0.1=200/e2cb35 [::1]=200/e2cb35 172.24.96.1=200/e2cb35 192.168.80.1=200/e2cb35 192.168.0.14=200/e2cb35 | 실행중 리스너: [::] pid=30848
dual-startbat | exit=1 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::] pid=35404 | 포트 사용 중 port=18191 host=:: code=EADDRINUSE
dual-node | exit=2 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::] pid=36868 | 포트 사용 중 port=18191 host=:: code=EADDRINUSE
v4any-startbat | exit=1 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[0.0.0.0] pid=10696 | 포트 사용 중 port=18191 host=0.0.0.0 code=EADDRINUSE
v4any-node | exit=2 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[0.0.0.0] pid=38440 | 포트 사용 중 port=18191 host=0.0.0.0 code=EADDRINUSE
v4loop-startbat | exit=1 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[127.0.0.1] pid=25288 | 포트 사용 중 port=18191 host=127.0.0.1 code=EADDRINUSE
v4loop-node | exit=2 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[127.0.0.1] pid=7444 | 포트 사용 중 port=18191 host=127.0.0.1 code=EADDRINUSE
v6only-startbat | exit=1 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::] pid=37200 | 포트 사용 중 port=18191 host=::(IPv6 전용) code=EADDRINUSE
v6only-node | exit=2 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::] pid=26228 | 포트 사용 중 port=18191 host=::(IPv6 전용) code=EADDRINUSE
dotnet-startbat | exit=1 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::] pid=35140 | 포트 사용 중 port=18191 host=::(IPv6 전용) code=EADDRINUSE
dotnet-node | exit=2 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::] pid=29536 | 포트 사용 중 port=18191 host=::(IPv6 전용) code=EADDRINUSE
v6loop-startbat | exit=1 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::1] pid=1212 | 포트 사용 중 port=18191 host=::1 code=EADDRINUSE
v6loop-node | exit=2 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::1] pid=34684 | 포트 사용 중 port=18191 host=::1 code=EADDRINUSE
```

## 2. 미리 확인을 끈 경우(TEST_SKIP_PORT_PRECHECK=1, 자기 확인 ②만으로 판정)
```
none-startbat | exit=0 | cp=활성 코드 페이지: 949 | 원인=False 해결=False 켜짐=True 재시작=False | 점유= | 서버 시작 pid=27796 host=:: port=18191 | 서버 종료 (stop.bat 요청) | health: localhost=200/7fcef3 127.0.0.1=200/7fcef3 [::1]=200/7fcef3 172.24.96.1=200/7fcef3 192.168.80.1=200/7fcef3 192.168.0.14=200/7fcef3 | 실행중 리스너: [::] pid=27796
none-node | exit=0 | cp=활성 코드 페이지: 949 | 원인=False 해결=False 켜짐=True 재시작=False | 점유= | 서버 시작 pid=23884 host=:: port=18191 | 서버 종료 (stop.bat 요청) | health: localhost=200/b9a718 127.0.0.1=200/b9a718 [::1]=200/b9a718 172.24.96.1=200/b9a718 192.168.80.1=200/b9a718 192.168.0.14=200/b9a718 | 실행중 리스너: [::] pid=23884
dual-startbat | exit=1 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::] pid=16572 | listen 실패 port=18191 code=EADDRINUSE
dual-node | exit=2 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::] pid=34684 | listen 실패 port=18191 code=EADDRINUSE
v4any-startbat | exit=1 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[0.0.0.0] pid=28592 | 포트 사용 중(자기 확인) port=18191 host=localhost(127.0.0.1) HTTP 200 응답, 표식 없음
v4any-node | exit=2 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[0.0.0.0] pid=38504 | 포트 사용 중(자기 확인) port=18191 host=localhost(127.0.0.1) HTTP 200 응답, 표식 없음
v4loop-startbat | exit=1 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[127.0.0.1] pid=14652 | 포트 사용 중(자기 확인) port=18191 host=localhost(127.0.0.1) HTTP 200 응답, 표식 없음
v4loop-node | exit=2 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[127.0.0.1] pid=26996 | 포트 사용 중(자기 확인) port=18191 host=localhost(127.0.0.1) HTTP 200 응답, 표식 없음
v6only-startbat | exit=1 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::] pid=8744 | 포트 사용 중(자기 확인) port=18191 host=localhost(::1) HTTP 200 응답, 표식 없음
v6only-node | exit=2 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::] pid=15920 | 포트 사용 중(자기 확인) port=18191 host=localhost(::1) HTTP 200 응답, 표식 없음
dotnet-startbat | exit=1 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::] pid=37084 | 포트 사용 중(자기 확인) port=18191 host=localhost(::1) 2000ms 안에 답 없음
dotnet-node | exit=2 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::] pid=32164 | 포트 사용 중(자기 확인) port=18191 host=localhost(::1) 2000ms 안에 답 없음
v6loop-startbat | exit=1 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::1] pid=10664 | 포트 사용 중(자기 확인) port=18191 host=localhost(::1) HTTP 200 응답, 표식 없음
v6loop-node | exit=2 | cp=활성 코드 페이지: 949 | 원인=True 해결=True 켜짐=False 재시작=False | 점유=[::1] pid=37820 | 포트 사용 중(자기 확인) port=18191 host=localhost(::1) HTTP 200 응답, 표식 없음
```
