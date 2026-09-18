const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Raise the ceiling on AsyncStorage's database.
 *
 * On Android, @react-native-async-storage/async-storage is a single SQLite
 * database with a default maximum of **6 MB**. Past it every write fails with
 * "database or disk is full" — and because almost every caller in a React
 * Native app writes with `.catch(() => undefined)`, it fails *silently*. The
 * symptom is not an error, it is a farmer whose conversation history stops
 * saving and who has no way to know.
 *
 * The real fix was to stop storing megabytes of base64 audio in there, which
 * src/apa/state.tsx now does. This is the second line of defence: with the
 * audio gone the store is a few hundred kilobytes of text, so 20 MB is not a
 * number anything should reach — and if something does start growing, it has
 * room to be noticed before it breaks.
 *
 * It has to be a config plugin rather than an edit to android/gradle.properties
 * because this project uses continuous native generation: /android is
 * gitignored and thrown away by every `expo prebuild`, so a hand edit survives
 * until the next build and then quietly disappears — which is how this class of
 * setting gets lost.
 */
module.exports = function withAsyncStorageSize(config, { sizeMB = 20 } = {}) {
  const KEY = 'AsyncStorage_db_size_in_MB';
  return withGradleProperties(config, (inner) => {
    inner.modResults = inner.modResults.filter(
      (item) => !(item.type === 'property' && item.key === KEY)
    );
    inner.modResults.push({ type: 'property', key: KEY, value: String(sizeMB) });
    return inner;
  });
};
