#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, NosmaiAgoraFramePumpErrorCode) {
  NosmaiAgoraFramePumpErrorAlreadyStreaming = 1,
  NosmaiAgoraFramePumpErrorAgoraUnavailable = 2,
  NosmaiAgoraFramePumpErrorSDKTapUnavailable = 3,
  NosmaiAgoraFramePumpErrorStartFailed = 4,
};

/**
 * Process-global: Nosmai's frame tap and Agora's engine are both process-wide.
 *
 * Frames arrive on Nosmai's render thread through
 * +[NosmaiCameraSdk setLiveStreamFrameCallback:] — the fan-out hook
 * @nosmai/react-native-effects-sdk exports for bridges — and are pushed
 * synchronously into Agora's IMediaEngine as raw BGRA bytes (Agora's C++ API
 * rejects CVPixelBufferRefs on iOS with -4). Agora copies the plane; no queue.
 */
@interface NosmaiAgoraFramePump : NSObject

@property(class, nonatomic, readonly) NosmaiAgoraFramePump *shared;
@property(nonatomic, readonly) BOOL isStreaming;

- (BOOL)startWithVideoTrackId:(NSUInteger)videoTrackId error:(NSError **)error;

/** Disarm the tap, then release the media engine. Idempotent. */
- (void)stop;

- (NSDictionary *)stats;

@end

NS_ASSUME_NONNULL_END
