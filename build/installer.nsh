# Dela 安装向导：保留「显示细节」，展开后是一份真实的安装日志。
#
# electron-builder 进入安装段第一件事是 `SetDetailsPrint none`（见其 installSection.nsh），
# 之后所有 DetailPrint 都不进列表，「显示细节」就只能是空白框。借它自己在段首调用的
# CHECK_APP_RUNNING 钩子把输出重新打开，才能留下关闭旧版本、解压、建快捷方式这几段。
# 钩子替换掉 CHECK_APP_RUNNING 的默认分支，所以这里照原样重跑那两步检查，不改变关闭 Dela 的行为
# （两个路径变量由 CHECK_APP_RUNNING 自己声明并已赋值）；钩子已定义后它不再包含 getProcessInfo.nsh、
# 不再声明 pid，这一并补齐。
#
# 日志只写列表，状态行保持那一句：进度条已经给了主要反馈，不必让状态文字跟着每一步换。
!include "getProcessInfo.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
Var pid
# 卸载器编译不包含安装选项页，声明这两个变量会触发 NSIS warning 6001；CI 把警告视为错误。
!ifndef BUILD_UNINSTALLER
Var DelaAutoStartCheckbox
Var DelaAutoStart
!endif

!macro customCheckAppRunning
  SetDetailsPrint listonly
  DetailPrint "开始安装 Dela，目标目录：$INSTDIR"
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend

!macro customHeader
  ShowInstDetails hide
!macroend

!macro customPageAfterChangeDir
  Page custom DelaOptionsPageCreate DelaOptionsPageLeave

  !define MUI_PAGE_CUSTOMFUNCTION_SHOW DelaInstallDetails
  Function DelaInstallDetails
    SetDetailsPrint textonly
    DetailPrint "开始安装 Dela，目标目录：$INSTDIR"
  FunctionEnd

  Function DelaOptionsPageCreate
    !insertmacro MUI_HEADER_TEXT "安装选项" "选择 Dela 安装后的启动行为。"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateCheckbox} 0 0 100% 12u "开机时启动 Dela（启动到托盘）"
    Pop $DelaAutoStartCheckbox
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "io.dela.desktop"
    ${If} $0 == ""
      ${NSD_SetState} $DelaAutoStartCheckbox ${BST_UNCHECKED}
    ${Else}
      ${NSD_SetState} $DelaAutoStartCheckbox ${BST_CHECKED}
    ${EndIf}
    nsDialogs::Show
  FunctionEnd

  Function DelaOptionsPageLeave
    ${NSD_GetState} $DelaAutoStartCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $DelaAutoStart "1"
    ${Else}
      StrCpy $DelaAutoStart "0"
    ${EndIf}
  FunctionEnd
!macroend

!macro customFiles_x64
  DetailPrint "应用文件已解压到：$INSTDIR"
!macroend

!macro customInstall
  # 静默安装不会显示选项页，此时变量为空：保留原有启动项，不能把升级当成取消勾选。
  ${If} $DelaAutoStart == "1"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "io.dela.desktop" '"$INSTDIR\Dela.exe" --hidden'
  ${ElseIf} $DelaAutoStart == "0"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "io.dela.desktop"
  ${EndIf}
  DetailPrint "应用文件和快捷方式安装完成。请完成向导以启动 Dela。"
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "io.dela.desktop"
!macroend
