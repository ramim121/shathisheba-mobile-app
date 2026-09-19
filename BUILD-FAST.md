# Building the APK

## Testing (default) — one architecture, ~3 minutes

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="$HOME/AppData/Local/Android/Sdk"
cd android && ./gradlew assembleRelease
```

`plugins/withFastBuilds.js` pins `reactNativeArchitectures=arm64-v8a` and turns
on the Gradle build cache and parallel module builds. That is the Pixel 7 Pro
and every other 64-bit ARM phone, which is effectively every Android handset
since about 2015.

**Do not pass `--no-daemon`.** The daemon is most of why a rebuild is three
minutes rather than eighteen; killing it throws away the warm JVM and the
in-memory caches every time.

The APK lands at `android/app/build/outputs/apk/release/app-release.apk`.

## Distribution — every architecture testers might have

```bash
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a
```

Or add `x86_64` as well if anyone runs it in an emulator. Expect four times the
native build time, because the New Architecture compiles its C++ once per ABI.

An `arm64-v8a`-only APK **will not install** on a 32-bit phone and will not run
in a standard emulator, so build this before handing anything to testers.

## Windows: the two traps

1. **Build from a short path.** CMake names each object file after the full path
   of its source, and the New Architecture codegen paths exceed Windows' 260
   characters on their own. `LongPathsEnabled` does not help (the NDK's ninja is
   not manifest-aware), a directory junction does not help (Gradle and CMake both
   resolve back to the real path), and `CMAKE_OBJECT_PATH_MAX` does not help (the
   Ninja generator ignores it). A real checkout at `C:\ss` does.

2. **`local.properties` needs forward slashes.** It is a Java properties file, so
   `sdk.dir=C:\Users\...` is read with `\U` as an invalid escape and the build
   dies with `java.io.IOException: Invalid file path` thrown from
   `AnalyticsResourceManager` — which reads like an analytics bug and is not.
   Write `sdk.dir=C:/Users/ramim/AppData/Local/Android/Sdk`.

## Signing

Expo's template debug keystore, SHA-256 `fac61745…033b9c` — the same key as the
previously shipped APKs, so new builds install over the existing app. Fine for
sideloading, not for Play.
