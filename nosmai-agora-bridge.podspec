require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "nosmai-agora-bridge"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.description  = package["description"]
  s.homepage     = package["repository"]["url"].sub(/^git\+/, "").sub(/\.git$/, "")
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platform     = :ios, "15.1"
  s.source       = { :git => "#{s.homepage}.git", :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm}", "cpp/*.{h,cpp}"
  # Agora's public C++ headers at the pinned SDK version. Kept out of
  # source_files so CocoaPods does not flatten or re-export them.
  s.preserve_paths = "cpp/third_party/**/*"
  s.requires_arc = true

  # Only for <AgoraRtcWrapper/iris_engine_base.h>. No version here on purpose:
  # react-native-agora pins it, and the bridge must use exactly that Iris.
  # Nosmai is reached at runtime (+[NosmaiCameraSdk setLiveStreamFrameCallback:]),
  # so neither the Nosmai framework nor the effects SDK pod is linked here.
  s.dependency "AgoraIrisRTC_iOS"

  # Set BEFORE install_modules_dependencies, which appends to it.
  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17",
    "HEADER_SEARCH_PATHS" => "\"$(PODS_TARGET_SRCROOT)/cpp\" \"$(PODS_TARGET_SRCROOT)/cpp/third_party\""
  }

  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end

  s.static_framework = true
end
