# ==============================================================================
# Iniciar-InstaCrop.ps1
# Ponte Inteligente de Automação Local e Servidor para InstaCrop
# ==============================================================================
# Este script inicia o InstaCrop e cria um micro-servidor local temporário
# para servir os arquivos estáticos e contornar a sandbox do navegador
# e restrições de CORS de módulos locais no protocolo file://.
# ==============================================================================

$Host.UI.RawUI.WindowTitle = "Mídia LEGENDÁRIOS Japan - Servidor de Automação Local"
Clear-Host

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "       MÍDIA LEGENDÁRIOS JAPAN - SERVIDOR LOCAL" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Iniciando micro-servidor de apoio na porta 5150..." -ForegroundColor Gray

# 1. Criar o HTTP Listener diretamente no processo principal
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:5150/")
try {
    $listener.Start()
    Write-Host "✔ Servidor HTTP iniciado com sucesso na porta 5150!" -ForegroundColor Green
} catch {
    Write-Host "Erro ao iniciar na porta 5150. Certifique-se de fechar outras janelas do Mídia LEGENDÁRIOS Japan." -ForegroundColor Red
    Exit
}

# 2. Abrir o programa no navegador padrão usando o link localhost HTTP
Write-Host "Abrindo Mídia LEGENDÁRIOS Japan no seu navegador padrão..." -ForegroundColor Gray
Start-Process "http://localhost:5150/"

Write-Host "`nInstaCrop ativo!" -ForegroundColor Green
Write-Host "MANTENHA ESTA JANELA ABERTA para que a IA funcione offline." -ForegroundColor Yellow
Write-Host "Para fechar o servidor, basta fechar esta janela do terminal ou pressionar Ctrl+C." -ForegroundColor Cyan
Write-Host "------------------------------------------------------------" -ForegroundColor Gray

# 3. Rodar o loop de escuta diretamente no Runspace principal interativo
while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        $urlPath = $request.Url.AbsolutePath
        
        if ($urlPath -eq "/open") {
            $response.Headers.Add("Access-Control-Allow-Origin", "*")
            $response.Headers.Add("Access-Control-Allow-Methods", "GET")
            
            $name = $request.QueryString["name"]
            $zip = $request.QueryString["zip"]
            
            if ($zip -eq "true") {
                $downloadsFolder = Join-Path $env:USERPROFILE "Downloads"
                explorer.exe $downloadsFolder
            } elseif ($name) {
                $searchPaths = @(
                    Join-Path $env:USERPROFILE "Desktop",
                    Join-Path $env:USERPROFILE "Downloads",
                    Join-Path $env:USERPROFILE "Pictures",
                    Join-Path $env:USERPROFILE "Documents"
                )
                
                $foundPath = $null
                foreach ($path in $searchPaths) {
                    if (Test-Path $path) {
                        $match = Get-ChildItem -Path $path -Directory -Filter $name -Recurse -Depth 3 -ErrorAction SilentlyContinue
                        if ($match) {
                            $foundPath = $match[0].FullName
                            break
                        }
                    }
                }
                
                if ($foundPath) {
                    explorer.exe $foundPath
                } else {
                    $downloadsFolder = Join-Path $env:USERPROFILE "Downloads"
                    explorer.exe $downloadsFolder
                }
            }
            
            $buffer = [System.Text.Encoding]::UTF8.GetBytes("OK")
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.OutputStream.Close()
        } else {
            # Servidor de Arquivos Estáticos Locais
            $relPath = $urlPath.Replace("/", "\").TrimStart("\")
            if ($relPath -eq "") { $relPath = "index.html" }
            
            # Remover parâmetros de query (ex: ?v=8.4) antes de buscar o arquivo no disco
            if ($relPath.Contains("?")) {
                $relPath = $relPath.Split("?")[0]
            }
            
            $fullFilePath = Join-Path $PSScriptRoot $relPath
            if (Test-Path $fullFilePath -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($fullFilePath).ToLower()
                $contentType = "application/octet-stream"
                if ($ext -eq ".html") { $contentType = "text/html; charset=utf-8" }
                elseif ($ext -eq ".js" -or $ext -eq ".mjs") { $contentType = "application/javascript; charset=utf-8" }
                elseif ($ext -eq ".css") { $contentType = "text/css; charset=utf-8" }
                elseif ($ext -eq ".wasm") { $contentType = "application/wasm" }
                elseif ($ext -eq ".png") { $contentType = "image/png" }
                elseif ($ext -eq ".jpg" -or $ext -eq ".jpeg") { $contentType = "image/jpeg" }
                elseif ($ext -eq ".json") { $contentType = "application/json; charset=utf-8" }
                
                $response.ContentType = $contentType
                $response.Headers.Add("Access-Control-Allow-Origin", "*")
                
                # Leitura direta e fechamento rápido
                $bytes = [System.IO.File]::ReadAllBytes($fullFilePath)
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                $response.OutputStream.Close()
                
                # Log de requisição para dar visual no console
                Write-Host "[Servido] $relPath ($contentType)" -ForegroundColor Gray
            } else {
                $response.StatusCode = 404
                $buffer = [System.Text.Encoding]::UTF8.GetBytes("File Not Found: $relPath")
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
                $response.OutputStream.Close()
                Write-Host "[404] $relPath" -ForegroundColor Red
            }
        }
    } catch {
        try {
            $response.StatusCode = 500
            $buffer = [System.Text.Encoding]::UTF8.GetBytes("Server Error")
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.OutputStream.Close()
        } catch {}
    }
}
