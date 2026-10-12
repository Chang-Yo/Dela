// Microsoft Store 应用内更新的原生模块。
//
// 为什么必须是原生模块、且必须留在主进程内：
//   1) 商店的更新接口要求调用进程有「包标识」。用 CreateProcess 起的子进程不继承包标识，
//      所以外部 exe 或 PowerShell 都调不了，只能在本进程内调。
//   2) RequestDownload* 系列必须在 UI 线程调用，且桌面应用（Desktop Bridge）要先给
//      StoreContext 指定属主窗口，否则抛 0x80070578（ERROR_INVALID_WINDOW_HANDLE）。
//
// 并发与线程模型：
//   - 对外是三个 Promise 方法，内部用 C++/WinRT 协程等 WinRT 异步操作。
//   - WinRT 的续体不保证回到 JS 线程，因此结果与进度一律经 napi_threadsafe_function
//     投递，绝不在非 JS 线程上碰 napi_deferred 或 napi_ref。
//   - 失败不跨边界抛异常：所有结果都是 {ok:true,...} 或 {ok:false,code,state,message}
//     的普通对象，JS 侧不需要 try/catch 区分业务失败。
#include <node_api.h>

#include <windows.h>

#include <appmodel.h>
#include <shobjidl_core.h>

#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Services.Store.h>
#include <winrt/base.h>

#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <exception>
#include <memory>
#include <string>
#include <vector>

namespace {

namespace Store = winrt::Windows::Services::Store;
namespace AppModel = winrt::Windows::ApplicationModel;

struct UpdateInfo {
  std::string version;
  bool mandatory = false;
  std::string familyName;
};

/** 经线程安全函数投递给 JS 线程的载荷。 */
struct Payload {
  enum class Kind { Progress, Done };
  Kind kind = Kind::Done;
  double progress = 0;
  bool ok = false;
  int32_t code = 0;
  std::string state;
  std::string message;
  std::vector<UpdateInfo> updates;
};

struct Task {
  napi_deferred deferred = nullptr;
  napi_threadsafe_function channel = nullptr;
  napi_ref onProgress = nullptr;
  bool settled = false;
};

using TaskPtr = std::shared_ptr<Task>;

/**
 * 进程内共享状态。故意泄漏：进程退出时静态析构可能晚于 COM 反初始化，
 * 那时再去释放 WinRT 对象会崩。
 */
struct SharedState {
  /** 上一次 check 拿到的待更新包；download / install 直接用它。 */
  std::vector<Store::StorePackageUpdate> updates;
  /** 同一时刻只允许一个下载或安装操作。 */
  std::atomic<bool> busy{false};
};

SharedState& shared() {
  static SharedState* instance = new SharedState();
  return *instance;
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

std::string VersionToString(const AppModel::PackageVersion& version) {
  char buffer[48];
  std::snprintf(
      buffer, sizeof(buffer), "%u.%u.%u.%u", version.Major, version.Minor, version.Build,
      version.Revision);
  return buffer;
}

const char* UpdateStateName(Store::StorePackageUpdateState state) {
  switch (state) {
    case Store::StorePackageUpdateState::Pending:
      return "Pending";
    case Store::StorePackageUpdateState::Downloading:
      return "Downloading";
    case Store::StorePackageUpdateState::Deploying:
      return "Deploying";
    case Store::StorePackageUpdateState::Completed:
      return "Completed";
    case Store::StorePackageUpdateState::Canceled:
      return "Canceled";
    case Store::StorePackageUpdateState::ErrorLowBattery:
      return "ErrorLowBattery";
    case Store::StorePackageUpdateState::ErrorWiFiRecommended:
      return "ErrorWiFiRecommended";
    case Store::StorePackageUpdateState::ErrorWiFiRequired:
      return "ErrorWiFiRequired";
    case Store::StorePackageUpdateState::OtherError:
      return "OtherError";
  }
  return "OtherError";
}

const char* SignatureKindName(AppModel::PackageSignatureKind kind) {
  switch (kind) {
    case AppModel::PackageSignatureKind::None:
      return "None";
    case AppModel::PackageSignatureKind::Developer:
      return "Developer";
    case AppModel::PackageSignatureKind::Enterprise:
      return "Enterprise";
    case AppModel::PackageSignatureKind::Store:
      return "Store";
    case AppModel::PackageSignatureKind::System:
      return "System";
  }
  return "None";
}

bool HasPackageIdentity() {
  UINT32 length = 0;
  return ::GetCurrentPackageFullName(&length, nullptr) != APPMODEL_ERROR_NO_PACKAGE;
}

void SetString(napi_env env, napi_value object, const char* key, const std::string& value) {
  napi_value text = nullptr;
  napi_create_string_utf8(env, value.c_str(), value.size(), &text);
  napi_set_named_property(env, object, key, text);
}

void SetBool(napi_env env, napi_value object, const char* key, bool value) {
  napi_value flag = nullptr;
  napi_get_boolean(env, value, &flag);
  napi_set_named_property(env, object, key, flag);
}

napi_value BuildPayload(napi_env env, const Payload& payload) {
  napi_value object = nullptr;
  napi_create_object(env, &object);
  SetBool(env, object, "ok", payload.ok);
  if (!payload.ok) {
    napi_value code = nullptr;
    napi_create_int32(env, payload.code, &code);
    napi_set_named_property(env, object, "code", code);
    SetString(env, object, "state", payload.state);
    SetString(env, object, "message", payload.message);
    return object;
  }
  napi_value updates = nullptr;
  napi_create_array_with_length(env, payload.updates.size(), &updates);
  for (size_t index = 0; index < payload.updates.size(); ++index) {
    const UpdateInfo& info = payload.updates[index];
    napi_value item = nullptr;
    napi_create_object(env, &item);
    SetString(env, item, "version", info.version);
    SetBool(env, item, "mandatory", info.mandatory);
    SetString(env, item, "familyName", info.familyName);
    napi_set_element(env, updates, index, item);
  }
  napi_set_named_property(env, object, "updates", updates);
  return object;
}

/**
 * 投递到 JS 线程。载荷在线程安全函数的队列里等待处理，队列项失效（环境拆除）
 * 时由 N-API 丢弃，泄漏的量级是几十字节且进程正在退出，不做回收。
 */
void Post(const TaskPtr& task, const Payload& payload) {
  auto* heap = new Payload(payload);
  if (napi_call_threadsafe_function(task->channel, heap, napi_tsfn_nonblocking) != napi_ok) {
    delete heap;
  }
}

void PostProgress(const TaskPtr& task, double progress) {
  if (!std::isfinite(progress)) return;
  Payload payload;
  payload.kind = Payload::Kind::Progress;
  payload.progress = progress;
  Post(task, payload);
}

// ---------------------------------------------------------------------------
// 线程安全函数的宿主端
// ---------------------------------------------------------------------------

void OnChannelFinalize(napi_env env, void* data, void* /*hint*/) {
  auto* holder = static_cast<TaskPtr*>(data);
  if (env != nullptr && (*holder)->onProgress != nullptr) {
    napi_delete_reference(env, (*holder)->onProgress);
  }
  delete holder;
}

void OnChannel(napi_env env, napi_value /*jsCallback*/, void* context, void* data) {
  std::unique_ptr<Payload> payload(static_cast<Payload*>(data));
  // env 为 null 表示 JS 环境正在拆除，此时不能再碰任何句柄。
  if (env == nullptr || payload == nullptr) return;
  const TaskPtr task = *static_cast<TaskPtr*>(context);

  if (payload->kind == Payload::Kind::Progress) {
    if (task->onProgress == nullptr) return;
    napi_value callback = nullptr;
    napi_get_reference_value(env, task->onProgress, &callback);
    if (callback == nullptr) return;
    napi_value global = nullptr;
    napi_get_global(env, &global);
    napi_value argument = nullptr;
    napi_create_double(env, payload->progress, &argument);
    napi_value ignored = nullptr;
    napi_call_function(env, global, callback, 1, &argument, &ignored);
    return;
  }

  if (!task->settled) {
    task->settled = true;
    napi_value result = BuildPayload(env, *payload);
    // 只 resolve 不 reject：业务失败用 {ok:false} 表达，JS 侧不必区分异常。
    napi_resolve_deferred(env, task->deferred, result);
    task->deferred = nullptr;
    shared().busy.store(false);
  }
  napi_release_threadsafe_function(task->channel, napi_tsfn_release);
}

// ---------------------------------------------------------------------------
// WinRT 侧
// ---------------------------------------------------------------------------

/** 取默认 StoreContext 并绑定属主窗口；不绑窗口会在下载时抛 0x80070578。 */
Store::StoreContext MakeContext(HWND hwnd) {
  Store::StoreContext context = Store::StoreContext::GetDefault();
  auto initialize = context.as<IInitializeWithWindow>();
  winrt::check_hresult(initialize->Initialize(hwnd));
  return context;
}

winrt::Windows::Foundation::Collections::IVector<Store::StorePackageUpdate> ToVector(
    const std::vector<Store::StorePackageUpdate>& updates) {
  auto vector = winrt::single_threaded_vector<Store::StorePackageUpdate>();
  for (const auto& update : updates) vector.Append(update);
  return vector;
}

void CaptureException(Payload& payload, const char* what) {
  payload.ok = false;
  if (payload.message.empty()) payload.message = what;
}

winrt::fire_and_forget RunCheck(TaskPtr task, HWND hwnd) {
  Payload payload;
  try {
    Store::StoreContext context = MakeContext(hwnd);
    auto updates = co_await context.GetAppAndOptionalStorePackageUpdatesAsync();
    shared().updates.clear();
    for (const auto& update : updates) {
      AppModel::PackageId id = update.Package().Id();
      UpdateInfo info;
      info.version = VersionToString(id.Version());
      info.mandatory = update.Mandatory();
      info.familyName = winrt::to_string(id.FamilyName());
      payload.updates.push_back(info);
      shared().updates.push_back(update);
    }
    payload.ok = true;
  } catch (const winrt::hresult_error& error) {
    payload.code = static_cast<int32_t>(error.code().value);
    payload.message = winrt::to_string(error.message());
    CaptureException(payload, "store check failed");
  } catch (const std::exception& error) {
    payload.message = error.what();
    CaptureException(payload, "store check failed");
  } catch (...) {
    CaptureException(payload, "store check failed");
  }
  Post(task, payload);
}

winrt::fire_and_forget RunDownload(TaskPtr task, HWND hwnd) {
  Payload payload;
  try {
    Store::StoreContext context = MakeContext(hwnd);
    auto operation = context.RequestDownloadStorePackageUpdatesAsync(ToVector(shared().updates));
    // 用 TotalDownloadProgress 而不是 PackageDownloadProgress：进度回调是「每个包各报一份」，
    // 单包进度在多包更新时会各自 0→1 反复跳，总量才是给用户看的那条线。
    operation.Progress([task](auto const&, const Store::StorePackageUpdateStatus& status) {
      PostProgress(task, status.TotalDownloadProgress);
    });
    Store::StorePackageUpdateResult result = co_await operation;
    payload.state = UpdateStateName(result.OverallState());
    payload.ok = result.OverallState() == Store::StorePackageUpdateState::Completed;
    if (!payload.ok) payload.message = "Microsoft Store did not complete the download";
  } catch (const winrt::hresult_error& error) {
    payload.code = static_cast<int32_t>(error.code().value);
    payload.message = winrt::to_string(error.message());
    CaptureException(payload, "store download failed");
  } catch (const std::exception& error) {
    payload.message = error.what();
    CaptureException(payload, "store download failed");
  } catch (...) {
    CaptureException(payload, "store download failed");
  }
  Post(task, payload);
}

winrt::fire_and_forget RunInstall(TaskPtr task, HWND hwnd) {
  Payload payload;
  try {
    Store::StoreContext context = MakeContext(hwnd);
    // 包已经下载过了，这一步只安装；商店不会再发下载进度，所以不挂 Progress。
    // Windows 可能在这个调用返回前就关闭本应用，界面要按「随时会消失」处理。
    Store::StorePackageUpdateResult result =
        co_await context.RequestDownloadAndInstallStorePackageUpdatesAsync(
            ToVector(shared().updates));
    payload.state = UpdateStateName(result.OverallState());
    payload.ok = result.OverallState() == Store::StorePackageUpdateState::Completed;
    if (!payload.ok) payload.message = "Microsoft Store did not complete the installation";
  } catch (const winrt::hresult_error& error) {
    payload.code = static_cast<int32_t>(error.code().value);
    payload.message = winrt::to_string(error.message());
    CaptureException(payload, "store install failed");
  } catch (const std::exception& error) {
    payload.message = error.what();
    CaptureException(payload, "store install failed");
  } catch (...) {
    CaptureException(payload, "store install failed");
  }
  Post(task, payload);
}

// ---------------------------------------------------------------------------
// N-API 入口
// ---------------------------------------------------------------------------

bool HwndFromValue(napi_env env, napi_value value, HWND* out) {
  napi_valuetype type = napi_undefined;
  if (napi_typeof(env, value, &type) != napi_ok) return false;
  if (type == napi_number) {
    int64_t raw = 0;
    if (napi_get_value_int64(env, value, &raw) != napi_ok) return false;
    *out = reinterpret_cast<HWND>(static_cast<intptr_t>(raw));
    return true;
  }
  bool isBuffer = false;
  if (napi_is_buffer(env, value, &isBuffer) != napi_ok || !isBuffer) return false;
  void* data = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, value, &data, &length) != napi_ok) return false;
  if (data == nullptr || length < sizeof(intptr_t)) return false;
  *out = reinterpret_cast<HWND>(*static_cast<intptr_t*>(data));
  return true;
}

enum class Operation { Check, Download, Install };

napi_value BeginOperation(napi_env env, napi_callback_info info, Operation operation) {
  size_t argc = 2;
  napi_value argv[2] = {nullptr, nullptr};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  napi_deferred deferred = nullptr;
  napi_value promise = nullptr;
  napi_create_promise(env, &deferred, &promise);

  HWND hwnd = nullptr;
  if (argc < 1 || !HwndFromValue(env, argv[0], &hwnd)) {
    napi_resolve_deferred(
        env, deferred,
        BuildPayload(env, Payload{.ok = false,
                                  .state = "InvalidWindow",
                                  .message = "expected a window handle buffer or number"}));
    return promise;
  }
  if (!HasPackageIdentity()) {
    napi_resolve_deferred(
        env, deferred,
        BuildPayload(env, Payload{.ok = false,
                                  .state = "NotPackaged",
                                  .message = "the process has no package identity"}));
    return promise;
  }
  if (hwnd == nullptr || ::IsWindow(hwnd) == FALSE) {
    napi_resolve_deferred(
        env, deferred,
        BuildPayload(env, Payload{.ok = false,
                                  .state = "InvalidWindow",
                                  .message = "the owner window is not a live window"}));
    return promise;
  }
  if (operation != Operation::Check && shared().updates.empty()) {
    napi_resolve_deferred(
        env, deferred,
        BuildPayload(env, Payload{.ok = false,
                                  .state = "NoUpdates",
                                  .message = "no pending updates; run check first"}));
    return promise;
  }
  if (shared().busy.exchange(true)) {
    napi_resolve_deferred(
        env, deferred,
        BuildPayload(env, Payload{.ok = false,
                                  .state = "Busy",
                                  .message = "another store operation is already running"}));
    return promise;
  }

  auto task = std::make_shared<Task>();
  task->deferred = deferred;
  if (argc >= 2 && argv[1] != nullptr) {
    napi_valuetype type = napi_undefined;
    if (napi_typeof(env, argv[1], &type) == napi_ok && type == napi_function) {
      napi_create_reference(env, argv[1], 1, &task->onProgress);
    }
  }

  napi_value resourceName = nullptr;
  napi_create_string_utf8(env, "dela.storeUpdate", NAPI_AUTO_LENGTH, &resourceName);
  auto* holder = new TaskPtr(task);
  napi_status status = napi_create_threadsafe_function(
      env, nullptr, nullptr, resourceName,
      // 队列不设上限：进度回调不能被丢弃，否则进度条会卡住。
      0, 1, holder, OnChannelFinalize, holder, OnChannel, &task->channel);
  if (status != napi_ok) {
    delete holder;
    if (task->onProgress != nullptr) napi_delete_reference(env, task->onProgress);
    shared().busy.store(false);
    napi_resolve_deferred(
        env, deferred,
        BuildPayload(env, Payload{.ok = false,
                                  .state = "ChannelFailed",
                                  .message = "could not create the worker channel"}));
    return promise;
  }

  switch (operation) {
    case Operation::Check:
      RunCheck(task, hwnd);
      break;
    case Operation::Download:
      RunDownload(task, hwnd);
      break;
    case Operation::Install:
      RunInstall(task, hwnd);
      break;
  }
  return promise;
}

napi_value MethodIsPackaged(napi_env env, napi_callback_info /*info*/) {
  napi_value result = nullptr;
  napi_get_boolean(env, HasPackageIdentity(), &result);
  return result;
}

napi_value MethodIdentity(napi_env env, napi_callback_info /*info*/) {
  if (!HasPackageIdentity()) {
    napi_value null = nullptr;
    napi_get_null(env, &null);
    return null;
  }
  napi_value object = nullptr;
  napi_create_object(env, &object);
  try {
    AppModel::Package package = AppModel::Package::Current();
    AppModel::PackageId id = package.Id();
    SetString(env, object, "name", winrt::to_string(id.Name()));
    SetString(env, object, "familyName", winrt::to_string(id.FamilyName()));
    SetString(env, object, "publisher", winrt::to_string(id.Publisher()));
    SetString(env, object, "version", VersionToString(id.Version()));
    SetString(env, object, "signatureKind", SignatureKindName(package.SignatureKind()));
    SetString(env, object, "installedPath", winrt::to_string(package.InstalledPath()));
  } catch (const winrt::hresult_error& error) {
    SetString(env, object, "error", winrt::to_string(error.message()));
  } catch (...) {
    SetString(env, object, "error", "identity lookup failed");
  }
  return object;
}

napi_value MethodCheck(napi_env env, napi_callback_info info) {
  return BeginOperation(env, info, Operation::Check);
}

napi_value MethodDownload(napi_env env, napi_callback_info info) {
  return BeginOperation(env, info, Operation::Download);
}

napi_value MethodInstall(napi_env env, napi_callback_info info) {
  return BeginOperation(env, info, Operation::Install);
}

/** 模块加载时初始化 COM；主线程通常已由 Electron 初始化，这里只是兜底。 */
void EnsureComInitialized() {
  static const HRESULT result = ::CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  static_cast<void>(result);
}

napi_value Init(napi_env env, napi_value exports) {
  EnsureComInitialized();
  // 用 napi_default_jsproperty（可写/可枚举/可配置）：napi_default 会让导出不可枚举，
  // Object.keys 看不到，调试和类型探测都会被误导。
  const napi_property_descriptor properties[] = {
      {"isPackaged", nullptr, MethodIsPackaged, nullptr, nullptr, nullptr, napi_default_jsproperty,
       nullptr},
      {"identity", nullptr, MethodIdentity, nullptr, nullptr, nullptr, napi_default_jsproperty,
       nullptr},
      {"check", nullptr, MethodCheck, nullptr, nullptr, nullptr, napi_default_jsproperty, nullptr},
      {"download", nullptr, MethodDownload, nullptr, nullptr, nullptr, napi_default_jsproperty,
       nullptr},
      {"install", nullptr, MethodInstall, nullptr, nullptr, nullptr, napi_default_jsproperty,
       nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
