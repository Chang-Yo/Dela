-- 可选转换路线实验：生成合成 PPTX，再经 Keynote 导入并导出 PDF。
-- 参数是两个尚不存在的绝对输出路径；仅关闭本脚本创建/打开的文档。
-- 不代表产品已经接入 Keynote，不覆盖复杂课件的排版保真度。
on run argv
  set pptxPath to item 1 of argv
  set pdfPath to item 2 of argv
  set sourceDoc to missing value
  set convertedDoc to missing value
  tell application "Keynote"
    with timeout of 60 seconds
      try
        set sourceDoc to make new document
        set object text of default title item of slide 1 of sourceDoc to "Dela phase1 验证"
        set object text of default body item of slide 1 of sourceDoc to "PPTX to PDF · 测试文本"
        export sourceDoc to (POSIX file pptxPath) as Microsoft PowerPoint
        close sourceDoc saving no
        set sourceDoc to missing value
        set convertedDoc to open (POSIX file pptxPath)
        export convertedDoc to (POSIX file pdfPath) as PDF
        close convertedDoc saving no
        set convertedDoc to missing value
        return "Keynote PPTX import and PDF export passed"
      on error messageText number errorNumber
        if sourceDoc is not missing value then close sourceDoc saving no
        if convertedDoc is not missing value then close convertedDoc saving no
        error messageText number errorNumber
      end try
    end timeout
  end tell
end run
