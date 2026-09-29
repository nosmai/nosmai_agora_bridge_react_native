import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  NosmaiCameraSdk,
  NosmaiCameraView,
} from '@nosmai/react-native-effects-sdk';
import {
  ChannelProfileType,
  ClientRoleType,
  createAgoraRtcEngine,
  type IRtcEngine,
} from 'react-native-agora';
import {
  NosmaiAgoraBridge,
  recommendedEncoderConfiguration,
  type StreamStats,
} from '@nosmai/react-native-agora-bridge';

// git-ignored; see credentials.example.ts
import { credentials } from './credentials.local';

type Phase = 'booting' | 'ready' | 'live' | 'busy' | 'error';

export default function App() {
  const engineRef = useRef<IRtcEngine | null>(null);
  const [phase, setPhase] = useState<Phase>('booting');
  const [log, setLog] = useState<string[]>([]);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [smoothing, setSmoothing] = useState(false);
  const [cameraPosition, setCameraPosition] = useState<'front' | 'back'>('front');

  const say = useCallback((line: string) => {
    console.log(`[AgoraExample] ${line}`);
    setLog((l) => [`${new Date().toISOString().slice(11, 19)} ${line}`, ...l].slice(0, 40));
  }, []);

  // 1) Share context BEFORE Nosmai initializes, 2) Nosmai, 3) Agora engine.
  useEffect(() => {
    let cancelled = false;
    const subs: { remove(): void }[] = [];
    (async () => {
      try {
        if (Platform.OS === 'android') {
          await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.CAMERA,
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          ]);
        }
        const share = await NosmaiAgoraBridge.registerShareContext();
        say(`registerShareContext -> ${share}`);

        subs.push(NosmaiCameraSdk.addLicenseStatusChangedListener((s) => say(`license: ${s}`)));
        subs.push(NosmaiCameraSdk.addErrorListener((e) => say(`nosmai error: ${JSON.stringify(e)}`)));

        const key = Platform.OS === 'ios'
          ? credentials.nosmaiLicenseKeyIos
          : credentials.nosmaiLicenseKeyAndroid;
        await NosmaiCameraSdk.initialize(key);
        say('nosmai initialized');
        await NosmaiCameraSdk.configureCamera({ position: 'front' });
        await NosmaiCameraSdk.startProcessing();
        say('nosmai processing');

        const engine = createAgoraRtcEngine();
        const rc = engine.initialize({
          appId: credentials.agoraAppId,
          channelProfile: ChannelProfileType.ChannelProfileLiveBroadcasting,
        });
        engine.registerEventHandler({
          onJoinChannelSuccess: (c, elapsed) =>
            say(`joined ${c.channelId} uid=${c.localUid} (${elapsed}ms)`),
          onLeaveChannel: () => say('left channel'),
          onError: (err, msg) => say(`agora error ${err} ${msg}`),
          onLocalVideoStateChanged: (_src, state, reason) =>
            say(`local video state=${state} reason=${reason}`),
        });
        engine.enableVideo();
        engine.setVideoEncoderConfiguration(recommendedEncoderConfiguration);
        engineRef.current = engine;
        say(`agora initialized rc=${rc}`);
        if (!cancelled) setPhase('ready');
      } catch (e: any) {
        say(`boot failed: ${e?.code ?? ''} ${e?.message ?? e}`);
        if (!cancelled) setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
      subs.forEach((s) => s.remove());
    };
  }, [say]);

  // Poll stats while live.
  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(async () => {
      try {
        setStats(await NosmaiAgoraBridge.getStats());
      } catch {}
    }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  const goLive = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setPhase('busy');
    try {
      const stream = await NosmaiAgoraBridge.startStreaming(engine);
      say(`bridge streaming -> track ${stream.videoTrackId}`);
      const rc = engine.joinChannel(credentials.agoraToken, credentials.agoraChannel, 0, {
        ...stream.channelMediaOptions,
        clientRoleType: ClientRoleType.ClientRoleBroadcaster,
        publishMicrophoneTrack: true,
        autoSubscribeAudio: false,
        autoSubscribeVideo: false,
      });
      say(`joinChannel rc=${rc}`);
      setPhase('live');
    } catch (e: any) {
      say(`start failed: ${e?.code ?? ''} ${e?.message ?? e}`);
      setPhase('ready');
    }
  };

  const stop = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setPhase('busy');
    await NosmaiAgoraBridge.stopStreaming(engine);
    engine.leaveChannel();
    say('stopped');
    setStats(await NosmaiAgoraBridge.getStats());
    setPhase('ready');
  };

  const doubleStart = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const results = await Promise.allSettled([
      NosmaiAgoraBridge.startStreaming(engine),
      NosmaiAgoraBridge.startStreaming(engine),
    ]);
    say(`double start: ${results.map((r) => r.status).join(', ')}`);
  };

  const toggleSmoothing = async () => {
    const next = !smoothing;
    try {
      await NosmaiCameraSdk.setSkinSmoothing(next ? 1 : 0);
      setSmoothing(next);
      say(`skin smoothing ${next ? 'on' : 'off'}`);
    } catch (e: any) {
      say(`smoothing failed: ${e?.message ?? e}`);
    }
  };

  const switchCamera = async () => {
    try {
      const switched = await NosmaiCameraSdk.switchCamera();
      if (switched) setCameraPosition((p) => (p === 'front' ? 'back' : 'front'));
      say(`switchCamera -> ${switched}`);
    } catch (e: any) {
      say(`switch failed: ${e?.message ?? e}`);
    }
  };

  const live = phase === 'live';
  return (
    <SafeAreaView style={styles.root}>
      <NosmaiCameraView
        style={styles.preview}
        cameraPosition={cameraPosition}
        // Selfie-style front camera, as in the effects SDK example and the Flutter
        // bridge. On iOS this is capture-side mirroring, so it ALSO decides what the
        // remote sees: the stream carries exactly what the local preview shows.
        mirror={cameraPosition === 'front'}
        onReady={() => {
          setPreviewReady(true);
          say('preview ready (first processed frame)');
        }}
        onError={(e) => say(`view error: ${JSON.stringify(e)}`)}
      />
      <View style={styles.panel}>
        <Text style={styles.title}>
          {phase.toUpperCase()} · preview {previewReady ? 'ok' : '…'} · channel {credentials.agoraChannel}
        </Text>
        {stats && (
          <Text style={styles.mono}>
            pushed {stats.pushed} · dropped {stats.dropped} · failed {stats.failed} · rc{' '}
            {stats.lastResult} · {stats.width}×{stats.height} · {stats.inputMode}
          </Text>
        )}
        <View style={styles.row}>
          <Btn label={live ? 'Stop' : 'Go live'} onPress={live ? stop : goLive} disabled={phase === 'booting' || phase === 'busy' || phase === 'error'} />
          <Btn label="Switch cam" onPress={switchCamera} />
          <Btn label={smoothing ? 'Smooth off' : 'Smooth on'} onPress={toggleSmoothing} />
          <Btn label="2× start" onPress={doubleStart} disabled={!live} />
        </View>
        <ScrollView style={styles.log}>
          {log.map((l, i) => (
            <Text key={i} style={styles.mono}>{l}</Text>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function Btn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.btn, (disabled || pressed) && styles.btnDim]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  preview: { flex: 1 },
  panel: { padding: 12, backgroundColor: '#111', maxHeight: '45%' },
  title: { color: '#fff', fontWeight: '600', marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  btn: { backgroundColor: '#2d6cdf', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  btnDim: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '600' },
  log: { maxHeight: 180 },
  mono: { color: '#9f9', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11 },
});
