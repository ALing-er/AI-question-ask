param([switch]$Check)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

function Write-Step {
    param([string]$Text, [ConsoleColor]$Color = 'Gray')
    Write-Host $Text -ForegroundColor $Color
}

function Fail {
    param([string]$Text)
    Write-Host $Text -ForegroundColor Red
    exit 1
}

function Test-Port {
    param([int]$Port)
    try {
        return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
    } catch {
        return $false
    }
}

Write-Host '=========================================='
Write-Host '  AI 问答平台 一键启动'
Write-Host '=========================================='
Write-Host ''

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Fail '[错误] 未找到 python，请先安装 Python 3.10+ 并加入 PATH。'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail '[错误] 未找到 npm，请先安装 Node.js 并加入 PATH。'
}

if (-not (Test-Path (Join-Path $root '.env'))) {
    Copy-Item (Join-Path $root '.env.example') (Join-Path $root '.env')
    Write-Step '[提示] 未找到 .env，已从 .env.example 复制。' Yellow
    Start-Process notepad.exe (Join-Path $root '.env')
    Write-Step '[提示] 请填写 SECRET_KEY 和模型 API Key 后重新运行本脚本。' Yellow
    exit 1
}

$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    Write-Step '[1/4] 创建 Python 虚拟环境...'
    & python -m venv (Join-Path $root '.venv')
    if ($LASTEXITCODE -ne 0) { Fail '[错误] 创建虚拟环境失败。' }
}

& $python -c "import fastapi, uvicorn, sqlalchemy, aiosqlite, jwt, bcrypt, yaml, multipart" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Step '[1/4] 安装后端依赖...'
    & $python -m pip install -r (Join-Path $root 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { Fail '[错误] 后端依赖安装失败。' }
} else {
    Write-Step '[1/4] 后端依赖已就绪。'
}

$frontend = Join-Path $root 'frontend'
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
    Write-Step '[2/4] 安装前端依赖...'
    Push-Location $frontend
    try {
        & npm install
        if ($LASTEXITCODE -ne 0) { Fail '[错误] 前端依赖安装失败。' }
    } finally {
        Pop-Location
    }
} else {
    Write-Step '[2/4] 前端依赖已就绪。'
}

if (Test-Port 8000) { Fail '[错误] 端口 8000 已被占用，请先关闭占用进程。' }
if (Test-Port 5173) { Fail '[错误] 端口 5173 已被占用，请先关闭占用进程。' }

if ($Check) {
    Write-Step '[检查] 环境、依赖与端口均正常。' Green
    exit 0
}

Write-Step '[3/4] 启动后端 http://127.0.0.1:8000 ...'
$backendCmd = "Set-Location -LiteralPath '$root'; & '$python' -m uvicorn app.main:app --reload --port 8000"
Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-NoProfile', '-Command', $backendCmd) | Out-Null

Write-Step '[4/4] 启动前端 http://127.0.0.1:5173 ...'
$frontendCmd = "Set-Location -LiteralPath '$frontend'; & npm.cmd run dev"
Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-NoProfile', '-Command', $frontendCmd) | Out-Null

Write-Step '等待服务启动...'
$deadline = (Get-Date).AddSeconds(30)
$backendOk = $false
$frontendOk = $false
while ((Get-Date) -lt $deadline) {
    if (-not $backendOk -and (Test-Port 8000)) { $backendOk = $true }
    if (-not $frontendOk -and (Test-Port 5173)) { $frontendOk = $true }
    if ($backendOk -and $frontendOk) { break }
    Start-Sleep -Milliseconds 500
}

if ($backendOk -and $frontendOk) {
    Start-Process 'http://127.0.0.1:5173'
    Write-Host ''
    Write-Host '已启动：'
    Write-Host '  前端      http://127.0.0.1:5173'
    Write-Host '  接口文档  http://127.0.0.1:8000/docs'
    Write-Host '  健康检查  http://127.0.0.1:8000/health'
    Write-Host ''
    Write-Host '关闭弹出的两个 PowerShell 窗口即可停止服务。'
} else {
    Write-Host ''
    if (-not $backendOk) {
        Write-Host '[错误] 后端 8000 未启动，请查看弹出的 PowerShell 窗口中的报错。' -ForegroundColor Red
    }
    if (-not $frontendOk) {
        Write-Host '[错误] 前端 5173 未启动，请查看弹出的 PowerShell 窗口中的报错。' -ForegroundColor Red
    }
    exit 1
}
