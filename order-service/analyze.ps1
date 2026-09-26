# Retrigger SonarQube analysis for order-service.
# SonarQube is started with Docker. This script only runs the scan.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$tokenPath = Join-Path $root ".sonar\token"
if (-not (Test-Path $tokenPath)) {
    throw "Missing .sonar/token. Create a SonarQube user token and save it in that file before running analysis."
}
$token = (Get-Content $tokenPath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($token)) {
    throw "The SonarQube token in .sonar/token is empty."
}

Write-Host "Running analysis..."
docker run --rm `
    -v "${root}:/usr/src/app" `
    -v "order-service-m2:/root/.m2" `
    -w /usr/src/app `
    --add-host=host.docker.internal:host-gateway `
    maven:3.9.11-eclipse-temurin-21 `
    mvn -B verify org.sonarsource.scanner.maven:sonar-maven-plugin:5.1.0.4751:sonar `
    "-Dsonar.host.url=http://host.docker.internal:9000" `
    "-Dsonar.token=$token"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Analysis finished."
Write-Host "Dashboard: http://localhost:9000/dashboard?id=order-service"
