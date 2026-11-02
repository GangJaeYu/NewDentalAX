@echo off
chcp 65001 >nul
cmd /d /s /c ""%~dp0scripts\windows\stop-main.cmd" %*"
exit /b %ERRORLEVEL%
rem 이 파일이 하는 일: start.bat으로 켠 하늘숲치과 원내 업무 서버를 끈다. 코드 페이지를 UTF-8로 바꾼 뒤 새 cmd로 scripts\windows\stop-main.cmd를 실행한다.
rem Lines 1-4 must stay ASCII: a cmd started in a cp949 console misreads multibyte batch lines after chcp 65001, even in called files. A new cmd starts in 65001 and reads them right. Lines after exit never run.
