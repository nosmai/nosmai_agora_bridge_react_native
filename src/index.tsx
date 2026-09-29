/**
 * `@nosmai/react-native-agora-bridge`
 *
 * Publish a Nosmai-filtered camera feed to Agora with react-native-agora.
 * Start at {@link NosmaiAgoraBridge}: its doc comment carries the model (Nosmai
 * owns the camera, Agora only publishes) and the startup order.
 */
export {
  NosmaiAgoraBridge,
  recommendedEncoderConfiguration,
  default,
} from './NosmaiAgoraBridge';
export type { NosmaiAgoraStream } from './NosmaiAgoraBridge';

export { NosmaiAgoraError, NosmaiAgoraErrorCode } from './errors';

export type { StreamStats } from './types';
