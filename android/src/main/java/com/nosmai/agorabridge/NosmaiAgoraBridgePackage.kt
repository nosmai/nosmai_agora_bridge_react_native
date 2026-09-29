package com.nosmai.agorabridge

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Autolinking entry point. Lazy: nothing touches Agora or Nosmai until JS calls in. */
class NosmaiAgoraBridgePackage : BaseReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == NosmaiAgoraBridgeModule.NAME) NosmaiAgoraBridgeModule(reactContext) else null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            NosmaiAgoraBridgeModule.NAME to
                ReactModuleInfo(
                    NosmaiAgoraBridgeModule.NAME,
                    NosmaiAgoraBridgeModule::class.java.name,
                    false, // canOverrideExistingModule
                    false, // needsEagerInit
                    false, // isCxxModule
                    true, // isTurboModule
                )
        )
    }
}
