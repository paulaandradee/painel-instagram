# =====================================================================
# servidor-local.ps1: sobe o painel em http://localhost:5173
# Pra usar no Windows sem instalar nada:
#   powershell -ExecutionPolicy Bypass -File servidor-local.ps1
#   (outra porta: ... -File servidor-local.ps1 -Porta 5174)
# (Se tiver Python: "python -m http.server 5173" faz o mesmo.)
# Pra parar: feche a janela ou aperte Ctrl+C.
# =====================================================================
param([int]$Porta = 5173)

$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$tipos = @{
  ".html" = "text/html; charset=utf-8"; ".css" = "text/css; charset=utf-8"; ".js" = "application/javascript; charset=utf-8"
  ".json" = "application/json"; ".png" = "image/png"; ".jpg" = "image/jpeg"; ".svg" = "image/svg+xml"; ".ico" = "image/x-icon"
  ".md" = "text/plain; charset=utf-8"
}

$ouvinte = New-Object System.Net.HttpListener
$ouvinte.Prefixes.Add("http://localhost:$Porta/")
try {
  $ouvinte.Start()
} catch {
  Write-Host "A porta $Porta está ocupada. Tente outra: -Porta 5174"
  exit 1
}
Write-Host "Painel no ar em http://localhost:$Porta (Ctrl+C pra parar)"

try {
  while ($ouvinte.IsListening) {
    $ctx = $ouvinte.GetContext()
    $caminho = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart("/")
    if ($caminho -eq "") { $caminho = "index.html" }
    $arquivo = [IO.Path]::GetFullPath((Join-Path $raiz $caminho))
    # Pasta (ex: /politica-de-privacidade/) abre o index.html dela, igual ao GitHub Pages
    if (Test-Path $arquivo -PathType Container) { $arquivo = Join-Path $arquivo "index.html" }

    if ($arquivo.StartsWith($raiz) -and (Test-Path $arquivo -PathType Leaf)) {
      $ext = [IO.Path]::GetExtension($arquivo).ToLower()
      $ctx.Response.ContentType = if ($tipos[$ext]) { $tipos[$ext] } else { "application/octet-stream" }
      $ctx.Response.Headers.Add("Cache-Control", "no-store")
      $bytes = [IO.File]::ReadAllBytes($arquivo)
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
  }
} finally {
  $ouvinte.Stop()
}
