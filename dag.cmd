@echo off
REM Gemak vanuit de projectroot:  .\dag.cmd 3
REM Draait tools\sync-dag.mjs met alle argumenten die je meegeeft.
pushd "%~dp0tools"
node sync-dag.mjs %*
popd
