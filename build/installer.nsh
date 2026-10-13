!macro customHeader
  ShowInstDetails hide
!macroend

!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW DelaInstallDetails
  Function DelaInstallDetails
    SetDetailsPrint textonly
    DetailPrint "开始安装 Dela，目标目录：$INSTDIR"
  FunctionEnd
!macroend

!macro customFiles_x64
  SetDetailsPrint both
  DetailPrint "应用文件已解压到：$INSTDIR"
!macroend

!macro customInstall
  DetailPrint "应用文件和快捷方式安装完成。请完成向导以启动 Dela。"
!macroend
