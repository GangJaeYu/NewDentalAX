@echo off
rem 이 파일이 하는 일: start.bat으로 켠 서버를 끄는 실제 순서(stop.bat이 코드 페이지를 UTF-8로 바꾼 뒤 부른다). data\server.pid의
rem 프로세스가 정말 이 서버(node.exe, 명령줄에 main.ts)인지 확인한 뒤 종료를 요청하고, 10초 안에 꺼지지 않으면 강제로 끈다.
rem 직접 실행하지 말고 stop.bat을 실행한다. 이 파일 안에서는 chcp로 코드 페이지를 바꾸지 않는다(바꾸면 한국어 줄을 잘못 읽는다).
setlocal EnableExtensions EnableDelayedExpansion
rem 프로젝트 폴더(이 파일 기준 두 단계 위)로 이동한다
for %%i in ("%~dp0..\..") do set "APP_DIR=%%~fi"
cd /d "!APP_DIR!"
if not defined DATA_DIR set "DATA_DIR=!APP_DIR!\data"
set "PID_FILE=%DATA_DIR%\server.pid"
set "STOP_FLAG=%DATA_DIR%\stop.flag"

if not exist "%PID_FILE%" (
  echo 켜져 있는 서버를 찾지 못했어요^(server.pid 없음^). 이미 꺼져 있을 수 있어요.
  goto end
)
set "SPID="
set /p SPID=<"%PID_FILE%"
if not defined SPID goto stale
set "SPID=!SPID: =!"

rem 이름만 보고 끄지 않는다: PID의 프로세스 이름과 명령줄을 함께 확인
powershell -NoProfile -NonInteractive -Command "$p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]'!SPID!'); if ($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -like '*main.ts*') { exit 0 } else { exit 1 }"
if errorlevel 1 goto stale

echo 서버^(PID !SPID!^)에 종료를 요청했어요...
>"%STOP_FLAG%" echo stop
for /l %%i in (1,1,20) do (
  tasklist /fi "PID eq !SPID!" /nh 2>nul | findstr /b /i "node.exe" >nul
  if errorlevel 1 goto stopped
  ping -n 2 127.0.0.1 >nul
)
echo 10초 안에 꺼지지 않아서 강제로 꺼요.
taskkill /PID !SPID! /F >nul 2>nul
if exist "%PID_FILE%" del /q "%PID_FILE%"

:stopped
echo 서버가 꺼졌어요.
goto end

:stale
echo 서버가 이미 꺼져 있어요^(남아 있던 server.pid를 정리했어요^).
if exist "%PID_FILE%" del /q "%PID_FILE%"
if exist "%STOP_FLAG%" del /q "%STOP_FLAG%"

:end
endlocal
exit /b 0
