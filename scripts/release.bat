@echo off
setlocal
if "%GH_TOKEN%"=="" (
  echo GH_TOKEN no esta seteado. Definilo antes de correr release.
  echo Ej: set GH_TOKEN=ghp_xxx
  exit /b 1
)
if "%~1"=="" (
  echo Uso: scripts\release.bat ^<patch^|minor^|major^|x.y.z^>
  exit /b 1
)
node "%~dp0release.mjs" %1
endlocal
