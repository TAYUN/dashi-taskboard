@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM ============================================================
REM  Codex Taskboard 本地启动器
REM
REM  两种启动方式：
REM    start-taskboard.vbs  静默启动：不显示控制台，只开 Chrome 应用窗口；
REM                         关闭该窗口即停止服务，输出写入 .data\start-taskboard.log。
REM    start-taskboard.bat  可见启动：保留控制台，便于排查；关闭窗口同样停止服务。
REM
REM  约束：
REM    - 服务默认只绑定 127.0.0.1，不暴露到局域网。
REM      需要局域网访问时把下面的 HOST 改成 0.0.0.0（局域网无鉴权）。
REM    - 端口必须与 taskctl 的默认地址 http://127.0.0.1:47823 保持一致。
REM    - 需要 Node.js 22.5 或更高版本。
REM ============================================================

cd /d "%~dp0"

set "HOST=127.0.0.1"
set "PORT=47823"
set "URL=http://%HOST%:%PORT%/"
REM Shared data directory with the desktop app (packaged app convention).
set "DATA_DIR=%APPDATA%\Codex Taskboard"
set "CODEX_TASKBOARD_DATA_DIR=%DATA_DIR%"
set "SILENT=0"
if /i "%~1"=="--silent" set "SILENT=1"
set "STARTED_SERVER=0"

REM 独立的 Chrome profile：窗口跑在独立进程里，才能准确判断它是否关闭；也不会和日常浏览器混用。
set "PROFILE=%LOCALAPPDATA%\ctb-window\chrome"
set "PROFILE_TAG=ctb-window"

REM ---- 优先用 Chrome 的 --app 应用窗口（无地址栏、无标签页），找不到才报错 ----
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined CHROME for /f "delims=" %%i in ('where chrome 2^>nul') do if not defined CHROME set "CHROME=%%i"
if not defined CHROME goto no_chrome

where node >nul 2>nul
if errorlevel 1 goto no_node

netstat -ano -p tcp | findstr /c:"LISTENING" | findstr /c:":%PORT% " >nul
if errorlevel 1 goto start_server

REM 端口已被占用：占用者可能是桌面启动器（实例令牌模式）。
REM 令牌模式下所有路由都带 /<token>/ 前缀，plain URL（%URL%）返回 404，打开就是空白页，
REM 看起来就像「任务不见了」。这里依次探测 launcher-runtime.json 里的真实地址与 plain URL，
REM 用能返回 200 的那个作为入口。
REM 注意：这段解析必须留在 if( ) 块之外，否则 %ACTIVE_URL% 会在块解析时被提前展开成空值。
set "ACTIVE_URL="
node -e "const h=require('http'),f=require('fs');const p=process.argv[1]||'47823';const plain='http://127.0.0.1:'+p;f.mkdirSync((process.env.CODEX_TASKBOARD_DATA_DIR||'.data'),{recursive:true});let d='';try{d=(JSON.parse(f.readFileSync((process.env.CODEX_TASKBOARD_DATA_DIR||'.data')+'/launcher-runtime.json','utf8')).url||'').replace(/\/+$/,'')}catch(e){}const probe=u=>new Promise(r=>{const q=h.get(u+'/api/projects',{timeout:1500},s=>{let b='';s.on('data',c=>{if(b.length<4096)b+=c});s.on('end',()=>{try{const j=JSON.parse(b);r(s.statusCode===200&&Array.isArray(j.projects))}catch(e){r(false)}})});q.on('error',()=>r(false));q.on('timeout',()=>{q.destroy();r(false)})});(async()=>{const c=(d?[d]:[]).concat([plain]);for(const u of c){if(await probe(u)){f.writeFileSync((process.env.CODEX_TASKBOARD_DATA_DIR||'.data')+'/.active-url.tmp',u+'/');return}}f.writeFileSync('.data/.active-url.tmp','none')})()" %PORT%
if exist "%DATA_DIR%\.active-url.tmp" set /p ACTIVE_URL=<"%DATA_DIR%\.active-url.tmp"
if exist "%DATA_DIR%\.active-url.tmp" del "%DATA_DIR%\.active-url.tmp" >nul 2>nul
if /i "%ACTIVE_URL%"=="none" echo [警告] 未探测到可用的 Taskboard 接口（/api/projects 未返回 JSON）。若打开的页面是空白，说明 47823 上是桌面启动器（令牌模式）实例、而它的 runtime 描述文件缺失：请改用桌面启动器打开的地址，或关闭它以后重跑本脚本。
if not defined ACTIVE_URL set "ACTIVE_URL=%URL%"
if /i "%ACTIVE_URL%"=="none" set "ACTIVE_URL=%URL%"
echo [提示] 端口 %PORT% 已在监听，直接打开 %ACTIVE_URL%
call :run_window "%ACTIVE_URL%"
goto finish

:start_server

if not exist "node_modules\" (
  echo [1/3] 安装依赖（npm install）...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto npm_failed
) else (
  echo [1/3] 依赖已存在，跳过安装。
)

if not exist "dist\web\index.html" (
  echo [2/3] 构建前端（npm run build:web）...
  call npm run build:web
  if errorlevel 1 goto build_failed
) else (
  echo [2/3] 前端构建产物已存在，跳过构建。
)

REM server 会 spawn("codex") 读模型列表；从资源管理器双击时 PATH 里没有它，
REM 而 Node 不认 .CMD/.PS1 shim，所以这里显式解析出 codex.exe 交给 server。
if not defined CODEX_EXECUTABLE (
  for /f "delims=" %%i in ('dir /b /s /o-d "%LOCALAPPDATA%\OpenAI\Codex\bin\codex.exe" 2^>nul') do (
    if not defined CODEX_EXECUTABLE set "CODEX_EXECUTABLE=%%i"
  )
)

if defined CODEX_EXECUTABLE (
  echo [准备] codex CLI：%CODEX_EXECUTABLE%
) else (
  echo [准备] 未找到 codex CLI，AI 模型列表会不可用。
)

set "CODEX_TASKBOARD_HOST=%HOST%"
set "CODEX_TASKBOARD_PORT=%PORT%"

REM 本脚本以「无令牌」模式启动，plain URL 才是正确入口。
REM 把上一次运行留下的 launcher-runtime.json 挪走（不删除，便于排查），
REM 否则 taskctl 会优先按里面的令牌地址连，对不上本脚本启动的无令牌服务。
if exist "%DATA_DIR%\launcher-runtime.json" move /y "%DATA_DIR%\launcher-runtime.json" "%DATA_DIR%\launcher-runtime.json.plain-mode.bak" >nul 2>nul

echo [3/3] 启动服务 %URL%
start /b "" "%COMSPEC%" /c "node server/index.mjs"
set "STARTED_SERVER=1"

REM 等 /health 就绪，最多约 40 秒
set /a WAIT=0
:wait_health
ping -n 2 %HOST% >nul
node -e "const http=require('http');const req=http.get('http://127.0.0.1:%PORT%/health',r=>process.exit(r.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.setTimeout(1500,()=>{req.destroy();process.exit(1)})"
if not errorlevel 1 goto server_ready
set /a WAIT+=1
if %WAIT% LSS 20 goto wait_health
echo [错误] 服务未能在 40 秒内就绪。改用 start-taskboard.bat 前台运行可以看到具体报错。
goto fail

:server_ready
echo [就绪] %URL%
call :run_window "%URL%"
goto finish

:finish
if "%STARTED_SERVER%"=="1" (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr /c:"LISTENING" ^| findstr /c:":%PORT% "') do taskkill /PID %%a /T /F >nul 2>nul
  echo [停止] 服务已结束。
)
exit /b 0

:fail
if "%SILENT%"=="0" pause
exit /b 1

:no_node
echo [错误] 未找到 node，请先安装 Node.js 22.5 或更高版本。
goto fail

:no_chrome
echo [错误] 未找到 Chrome。请安装 Chrome，或直接运行 npm start 后用浏览器访问 %URL%。
goto fail

:npm_failed
echo [错误] 依赖安装失败，请检查网络或 npm 配置。
goto fail

:build_failed
echo [错误] 前端构建失败，请查看上面的报错。
goto fail

:run_window
set "OPEN_URL=%~1"
if not defined OPEN_URL set "OPEN_URL=%URL%"
echo [窗口] 打开 %OPEN_URL%
start "" "%CHROME%" --app=%OPEN_URL% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-background-mode --window-size=1280,860

REM 关窗判定：连续 3 次探测不到该 profile 的 chrome 进程才认为窗口已关闭，
REM 避免启动瞬间或浏览器重启时被误判；窗口如果根本没起来，同样在约 6 秒后判定为关闭。
set /a ZEROS=0
:run_window_wait
ping -n 2 %HOST% >nul
call :chrome_count
if not "%CHROME_COUNT%"=="0" goto run_window_seen
set /a ZEROS+=1
if %ZEROS% LSS 3 goto run_window_wait
echo [窗口] 已关闭。
goto :eof

:run_window_seen
set /a ZEROS=0
goto run_window_wait

:chrome_count
set "CHROME_COUNT=0"
powershell -NoProfile -Command "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*%PROFILE_TAG%*' }).Count" > "%TEMP%\tb-chrome-count.txt" 2>nul
if exist "%TEMP%\tb-chrome-count.txt" set /p CHROME_COUNT=<"%TEMP%\tb-chrome-count.txt"
goto :eof
