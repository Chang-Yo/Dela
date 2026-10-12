# 商店更新原生模块。C++/WinRT 的头文件随 Windows SDK 提供
# （Include\<ver>\cppwinrt），不需要 NuGet 包。
#
# 头文件目录由 scripts/build-native.mjs 通过环境变量 DELA_WINRT_INCLUDE 传入：
# MSBuild 会把环境变量当全局属性读，所以这里直接用 $(DELA_WINRT_INCLUDE)。
# 第二行是同一目录的另一种写法，方便直接跑 node-gyp rebuild 时也能编过；
# 不存在的 include 目录不会报错，只会被忽略。
{
  'targets': [
    {
      'target_name': 'store_update',
      'sources': ['src/store_update.cc'],
      'defines': [
        'NOMINMAX',
        'WIN32_LEAN_AND_MEAN',
        'UNICODE',
        '_UNICODE',
        '_WIN32_WINNT=0x0A00',
      ],
      'libraries': [
        'windowsapp.lib',
        'runtimeobject.lib',
        'ole32.lib',
        'oleaut32.lib',
        'user32.lib',
      ],
      'msvs_settings': {
        'VCCLCompilerTool': {
          'AdditionalOptions': ['/std:c++20', '/EHsc', '/Zc:__cplusplus', '/permissive-'],
          'AdditionalIncludeDirectories': [
            '$(DELA_WINRT_INCLUDE)',
            '$(WindowsSdkDir)Include\\$(WindowsSDKVersion)cppwinrt',
          ],
        },
        'VCLinkerTool': {
          'AdditionalDependencies': [
            'windowsapp.lib',
            'runtimeobject.lib',
            'ole32.lib',
            'oleaut32.lib',
            'user32.lib',
          ],
        },
      },
    },
  ],
}
