@echo off
chcp 65001 >nul
echo ========================================================
echo   MIDIA LEGENDARIOS JAPAN - SINCRONIZACAO COM O GITHUB
echo ========================================================
echo.

set "MINGIT_PATH=%LOCALAPPDATA%\Programs\MinGit\cmd"
if exist "%MINGIT_PATH%\git.exe" (
    set "PATH=%MINGIT_PATH%;%PATH%"
)

echo [1/3] Verificando alteracoes...
git status -s

echo.
echo [2/3] Adicionando arquivos e gerando versao...
git add .

set commit_msg=
set /p commit_msg="Digite uma descricao para a alteracao (ou ENTER para padrao): "
if "%commit_msg%"=="" (
    set commit_msg=Atualizacao automatica em %DATE% %TIME%
)

git commit -m "%commit_msg%"

echo.
echo [3/3] Enviando para o GitHub (Cloudflare Pages)...
git push origin main

echo.
if %ERRORLEVEL% EQU 0 (
    echo ========================================================
    echo   [SUCESSO] Atualizacao enviada com sucesso!
    echo   Em cerca de 1 minuto estara no ar em:
    echo   https://midia.legendariosjapan.jp
    echo ========================================================
) else (
    echo ========================================================
    echo   [ATENCAO] Nao foi possivel enviar automaticamente.
    echo   Verifique se o GitHub remoto esta configurado ou logado.
    echo ========================================================
)
echo.
pause
