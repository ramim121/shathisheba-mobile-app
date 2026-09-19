const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Stop the Windows 260-character path limit from breaking the native build.
 *
 * ## The failure
 *
 * CMake names each object file after the full path of its source, mirrored into
 * the build directory. For the autolinked New Architecture codegen that
 * produces things like:
 *
 *   …/react_codegen_safeareacontext.dir/C_/Apps/Digigram/ShathiSheba/
 *   ShathiSheba-projects/Shathi_Sheba/node_modules/react-native-safe-area-context/
 *   common/cpp/react/renderer/components/safeareacontext/
 *   RNCSafeAreaViewShadowNode.cpp.o
 *
 * which is about 270 characters before the build directory is even prepended.
 * ninja then fails with "Filename longer than 260 characters" and the whole
 * release build stops.
 *
 * ## Why the obvious fixes do not work
 *
 * `LongPathsEnabled` is already `1` in the registry on the machine this was
 * found on. It made no difference: the NDK's ninja is not built with the
 * manifest that opts a process into long paths, so it still uses the old limit.
 *
 * A directory junction to a short path (`C:\\ss` → the project) does not work
 * either, and this is worth recording because it looks like it should. Gradle
 * resolves `node_modules` through Node, and CMake canonicalises what it is
 * given, so both end up with the real path again and the object name is
 * unchanged. The build fails with the original long path in the message even
 * though it was started from the short one.
 *
 * ## What does work
 *
 * `CMAKE_OBJECT_PATH_MAX` tells CMake the longest object path the native build
 * tool can handle. Past it, CMake stops mirroring the source tree and generates
 * short hashed object names instead. 200 leaves room for the build directory
 * prefix that gets prepended to everything here.
 *
 * ## Why a config plugin
 *
 * This project uses continuous native generation: `/android` is gitignored and
 * thrown away by every `expo prebuild`. A hand edit to `app/build.gradle`
 * survives until the next prebuild and then disappears, which for a
 * build-breaking setting means the failure comes back looking new.
 *
 * Only Windows needs this, but it is applied unconditionally: the setting is
 * harmless where paths are short, and making it conditional on the *build*
 * machine's platform would mean a Mac-generated project fails on Windows.
 */
module.exports = function withShortNativeObjectPaths(config, { max = 200 } = {}) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        'withShortNativeObjectPaths expects a groovy build.gradle; got ' + cfg.modResults.language
      );
    }

    const contents = cfg.modResults.contents;
    if (contents.includes('CMAKE_OBJECT_PATH_MAX')) return cfg;

    // Anchored on the buildConfigField the Expo template writes, so that a
    // template change breaks this loudly here rather than silently producing a
    // project that fails to build on Windows.
    const anchor = /(defaultConfig\s*\{)/;
    if (!anchor.test(contents)) {
      throw new Error('withShortNativeObjectPaths: no defaultConfig block in app/build.gradle');
    }

    cfg.modResults.contents = contents.replace(
      anchor,
      `$1
        // Windows caps a path at 260 characters, and CMake names every object
        // file after the full path of its source. The New Architecture codegen
        // paths under node_modules exceed that on their own, so ninja fails
        // before it compiles anything. Past this limit CMake uses short hashed
        // names instead of mirroring the source tree.
        // Injected by plugins/withShortNativeObjectPaths.js - see there for why
        // LongPathsEnabled and a short-path junction both fail to help.
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_OBJECT_PATH_MAX=${max}"
            }
        }
`
    );
    return cfg;
  });
};
