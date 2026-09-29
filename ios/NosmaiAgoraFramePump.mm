#import "NosmaiAgoraFramePump.h"

#import <CoreVideo/CoreVideo.h>
#import <objc/message.h>
#import <os/lock.h>

// Iris's C API, shipped by AgoraIrisRTC_iOS — the same header react-native-agora's
// own module compiles against, so ApiParam's layout always matches its Iris.
#import <AgoraRtcWrapper/iris_engine_base.h>

#include <atomic>
#include <vector>

#include "NosmaiAgoraPush.h"

static NSString *const kErrorDomain = @"NosmaiAgoraBridge";
static NSString *const kLogPrefix = @"[NosmaiAgora]";

typedef void (^NosmaiAgoraFrameBlock)(CVPixelBufferRef pixelBuffer, double timestamp);

static NSError *PumpError(NosmaiAgoraFramePumpErrorCode code, NSString *message) {
  return [NSError errorWithDomain:kErrorDomain
                             code:code
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

@implementation NosmaiAgoraFramePump {
  // Guards _mediaEngine against stop racing a push on Nosmai's render thread.
  // Uncontended on every frame except the one stop lands on.
  os_unfair_lock _lock;
  void *_mediaEngine;
  unsigned int _videoTrackId;
  Class _tapClass;
  std::atomic_bool _armed;
  std::atomic<uint64_t> _pushed;
  std::atomic<uint64_t> _failed;
  std::atomic<int> _lastResult;
  std::atomic<int> _width;
  std::atomic<int> _height;
  NSDictionary *_lastStats;
}

+ (NosmaiAgoraFramePump *)shared {
  static NosmaiAgoraFramePump *pump;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    pump = [NosmaiAgoraFramePump new];
  });
  return pump;
}

- (instancetype)init {
  if ((self = [super init])) {
    _lock = OS_UNFAIR_LOCK_INIT;
    _armed.store(false);
  }
  return self;
}

- (BOOL)isStreaming {
  os_unfair_lock_lock(&_lock);
  BOOL streaming = _mediaEngine != nullptr;
  os_unfair_lock_unlock(&_lock);
  return streaming;
}

#pragma mark - Start

- (BOOL)startWithVideoTrackId:(NSUInteger)videoTrackId error:(NSError **)error {
  if (self.isStreaming) {
    if (error) *error = PumpError(NosmaiAgoraFramePumpErrorAlreadyStreaming, @"Already streaming.");
    return NO;
  }

  // The tap first: it is the check most likely to fail on a misconfigured app
  // and needs nothing released on failure. Deliberately NO fallback to
  // NosmaiCore.liveFrameStreamCallback — the effects SDK owns that single slot
  // for readiness and its frame stream, and overwriting it breaks both.
  Class tapClass = NSClassFromString(@"NosmaiCameraSdk");
  if (!tapClass || ![tapClass respondsToSelector:@selector(setLiveStreamFrameCallback:)] ||
      ![tapClass respondsToSelector:@selector(clearLiveStreamFrameCallback)]) {
    if (error) {
      *error = PumpError(NosmaiAgoraFramePumpErrorSDKTapUnavailable,
                         @"@nosmai/react-native-effects-sdk does not export "
                         @"+[NosmaiCameraSdk setLiveStreamFrameCallback:]. Upgrade the effects SDK.");
    }
    return NO;
  }

  NSString *reason = nil;
  uint64_t handle = [self resolveRtcEngineHandle:&reason];
  if (handle == 0) {
    if (error) *error = PumpError(NosmaiAgoraFramePumpErrorAgoraUnavailable, reason);
    return NO;
  }

  int rc = 0;
  void *mediaEngine = nosmai_agora::ResolveMediaEngine(handle, &rc);
  if (!mediaEngine) {
    if (error) {
      *error = PumpError(NosmaiAgoraFramePumpErrorAgoraUnavailable,
                         [NSString stringWithFormat:@"Could not reach Agora's media engine (rc=%d).", rc]);
    }
    return NO;
  }

  os_unfair_lock_lock(&_lock);
  _mediaEngine = mediaEngine;
  _videoTrackId = (unsigned int)videoTrackId;
  os_unfair_lock_unlock(&_lock);
  _tapClass = tapClass;
  _pushed.store(0);
  _failed.store(0);
  _lastResult.store(0);
  _width.store(0);
  _height.store(0);
  _armed.store(true);

  __weak NosmaiAgoraFramePump *weakSelf = self;
  NosmaiAgoraFrameBlock block = ^(CVPixelBufferRef pixelBuffer, double timestamp) {
    [weakSelf pushPixelBuffer:pixelBuffer timestamp:timestamp];
  };
  ((void (*)(Class, SEL, NosmaiAgoraFrameBlock))objc_msgSend)(
      tapClass, @selector(setLiveStreamFrameCallback:), block);
  NSLog(@"%@ armed: track=%lu", kLogPrefix, (unsigned long)videoTrackId);
  return YES;
}

/**
 * The agora::rtc::IRtcEngine* behind react-native-agora's engine, read via Iris
 * natively so all 64 bits survive (a JS number would not carry them).
 */
- (uint64_t)resolveRtcEngineHandle:(NSString **)reason {
  Class agoraClass = NSClassFromString(@"AgoraRtcNg");
  if (!agoraClass || ![agoraClass respondsToSelector:@selector(shareInstance)]) {
    *reason = @"react-native-agora is not installed (AgoraRtcNg not found).";
    return 0;
  }
  id module = ((id (*)(Class, SEL))objc_msgSend)(agoraClass, @selector(shareInstance));
  if (!module || ![module respondsToSelector:@selector(irisApiEngine)]) {
    *reason = @"react-native-agora's module has not been created yet.";
    return 0;
  }
  auto *iris = static_cast<IApiEngineBase *>(
      ((void *(*)(id, SEL))objc_msgSend)(module, @selector(irisApiEngine)));
  if (!iris) {
    *reason = @"react-native-agora has no engine yet. Call createAgoraRtcEngine() and "
              @"initialize() before startStreaming().";
    return 0;
  }

  // 64 KiB: too large for a GCD worker's stack.
  std::vector<char> result(kBasicResultLength, 0);
  const char *params = "{}";
  ApiParam param = {
      .event = "RtcEngine_getNativeHandle",
      .data = params,
      .data_size = 2,
      .result = result.data(),
      .buffer = nullptr,
      .length = nullptr,
      .buffer_count = 0,
  };
  int err = iris->CallIrisApi(&param);
  if (err != 0) {
    *reason = [NSString stringWithFormat:@"RtcEngine_getNativeHandle failed (%d).", err];
    return 0;
  }

  NSString *json = [NSString stringWithUTF8String:result.data()] ?: @"";
  NSRegularExpression *re =
      [NSRegularExpression regularExpressionWithPattern:@"\"result\"\\s*:\\s*\"?(-?\\d+)"
                                                options:0
                                                  error:nil];
  NSTextCheckingResult *m = [re firstMatchInString:json options:0 range:NSMakeRange(0, json.length)];
  if (!m) {
    *reason = [NSString stringWithFormat:@"Unexpected RtcEngine_getNativeHandle result: %@", json];
    return 0;
  }
  NSString *digits = [json substringWithRange:[m rangeAtIndex:1]];
  uint64_t handle = [digits hasPrefix:@"-"]
                        ? (uint64_t)strtoll(digits.UTF8String, nullptr, 10)
                        : strtoull(digits.UTF8String, nullptr, 10);
  if (handle == 0) {
    *reason = @"Agora engine handle is 0. Call engine.initialize() before startStreaming().";
  }
  return handle;
}

#pragma mark - Frames (Nosmai render thread)

- (void)pushPixelBuffer:(CVPixelBufferRef)pixelBuffer timestamp:(double)timestamp {
  if (!_armed.load(std::memory_order_acquire) || !pixelBuffer) return;
  OSType type = CVPixelBufferGetPixelFormatType(pixelBuffer);
  if (type != kCVPixelFormatType_32BGRA) {
    if (_failed.fetch_add(1) % 60 == 0) {
      NSLog(@"%@ unsupported pixel format 0x%08x (expected BGRA)", kLogPrefix, (unsigned)type);
    }
    return;
  }
  int width = (int)CVPixelBufferGetWidth(pixelBuffer);
  int height = (int)CVPixelBufferGetHeight(pixelBuffer);
  _width.store(width, std::memory_order_relaxed);
  _height.store(height, std::memory_order_relaxed);

  // Raw BGRA bytes, not the CVPixelBufferRef: Agora's C++ pushVideoFrame on iOS
  // rejects every CVPixelBuffer description (raw/texture x CVPIXEL NV12/BGRA)
  // with -4 ERR_NOT_SUPPORTED — measured on device with react-native-agora
  // 4.6.4. Agora copies the plane before returning, so the lock is brief and
  // the buffer goes back to Nosmai unchanged.
  if (CVPixelBufferLockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess) {
    _failed.fetch_add(1, std::memory_order_relaxed);
    return;
  }
  void *base = CVPixelBufferGetBaseAddress(pixelBuffer);
  int stridePixels = (int)(CVPixelBufferGetBytesPerRow(pixelBuffer) / 4);

  os_unfair_lock_lock(&_lock);
  int rc = -1;
  if (_mediaEngine) {
    // Nosmai's timestamp is seconds; Agora's is milliseconds.
    rc = nosmai_agora::PushRawBytes(_mediaEngine, _videoTrackId, base,
                                    nosmai_agora::kPixelFormatBGRA, stridePixels, width, height,
                                    (int64_t)(timestamp * 1000.0));
  }
  os_unfair_lock_unlock(&_lock);
  CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);

  _lastResult.store(rc, std::memory_order_relaxed);
  if (rc == 0) {
    _pushed.fetch_add(1, std::memory_order_relaxed);
  } else if (_failed.fetch_add(1, std::memory_order_relaxed) % 60 == 0) {
    NSLog(@"%@ pushVideoFrame rc=%d", kLogPrefix, rc);
  }
}

#pragma mark - Stop

- (void)stop {
  // Stop producing first, then tear down the consumer.
  _armed.store(false, std::memory_order_release);
  Class tapClass = _tapClass;
  _tapClass = nil;
  if (tapClass) {
    ((void (*)(Class, SEL))objc_msgSend)(tapClass, @selector(clearLiveStreamFrameCallback));
  }
  os_unfair_lock_lock(&_lock);
  void *mediaEngine = _mediaEngine;
  _mediaEngine = nullptr;
  os_unfair_lock_unlock(&_lock);
  if (!mediaEngine) return;
  // Any push already past the armed check finished under the lock above.
  nosmai_agora::ReleaseMediaEngine(mediaEngine);
  _lastStats = [self currentStatsStreaming:NO];
  NSLog(@"%@ stopped: pushed=%llu failed=%llu", kLogPrefix, _pushed.load(), _failed.load());
}

- (NSDictionary *)stats {
  return self.isStreaming ? [self currentStatsStreaming:YES]
                          : (_lastStats ?: [self currentStatsStreaming:NO]);
}

- (NSDictionary *)currentStatsStreaming:(BOOL)streaming {
  return @{
    @"streaming" : @(streaming),
    @"videoTrackId" : streaming ? @(_videoTrackId) : @(-1),
    @"pushed" : @(_pushed.load()),
    // The iOS path never drops: each push is synchronous on Nosmai's thread.
    @"dropped" : @0,
    @"failed" : @(_failed.load()),
    @"lastResult" : @(_lastResult.load()),
    @"width" : @(_width.load()),
    @"height" : @(_height.load()),
    @"inputMode" : @"bgra-bytes",
  };
}

@end
