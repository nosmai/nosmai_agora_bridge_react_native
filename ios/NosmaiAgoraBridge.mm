#import "NosmaiAgoraBridge.h"

#import "NosmaiAgoraFramePump.h"

static NSString *NosmaiAgoraRejectCode(NSError *error) {
  switch ((NosmaiAgoraFramePumpErrorCode)error.code) {
    case NosmaiAgoraFramePumpErrorAlreadyStreaming:
      return @"E_ALREADY_STREAMING";
    case NosmaiAgoraFramePumpErrorAgoraUnavailable:
      return @"E_AGORA_UNAVAILABLE";
    case NosmaiAgoraFramePumpErrorSDKTapUnavailable:
      return @"E_SDK_TAP_UNAVAILABLE";
    case NosmaiAgoraFramePumpErrorStartFailed:
      break;
  }
  return @"E_START_FAILED";
}

@implementation NosmaiAgoraBridge {
  dispatch_queue_t _queue;
}

RCT_EXPORT_MODULE(NosmaiAgoraBridge)

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

// A private serial queue serialises start against stop without further locking.
- (dispatch_queue_t)methodQueue {
  if (!_queue) {
    _queue = dispatch_queue_create("com.nosmai.agorabridge", DISPATCH_QUEUE_SERIAL);
  }
  return _queue;
}

- (void)invalidate {
  // The pump is process-global; a Metro reload must not leave the tap armed.
  [NosmaiAgoraFramePump.shared stop];
}

RCT_EXPORT_METHOD(registerShareContext
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  // No-op on iOS: CVPixelBuffers are IOSurface-backed and need no shared GL
  // context. Resolving (not rejecting) lets app code call it unconditionally.
  resolve(@0);
}

RCT_EXPORT_METHOD(startStreaming
                  : (double)videoTrackId resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  if (videoTrackId < 0 || videoTrackId != (double)(NSUInteger)videoTrackId) {
    reject(@"E_INVALID_ARGUMENT",
           [NSString stringWithFormat:@"videoTrackId must be a non-negative integer (got %g)",
                                      videoTrackId],
           nil);
    return;
  }
  NSError *error = nil;
  if (![NosmaiAgoraFramePump.shared startWithVideoTrackId:(NSUInteger)videoTrackId error:&error]) {
    reject(error ? NosmaiAgoraRejectCode(error) : @"E_START_FAILED",
           error.localizedDescription ?: @"startStreaming failed", error);
    return;
  }
  resolve(nil);
}

RCT_EXPORT_METHOD(stopStreaming
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  [NosmaiAgoraFramePump.shared stop];
  resolve(nil);
}

RCT_EXPORT_METHOD(isStreaming
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  resolve(@(NosmaiAgoraFramePump.shared.isStreaming));
}

RCT_EXPORT_METHOD(getStats
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  resolve([NosmaiAgoraFramePump.shared stats]);
}

#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeNosmaiAgoraBridgeSpecJSI>(params);
}
#endif

@end
