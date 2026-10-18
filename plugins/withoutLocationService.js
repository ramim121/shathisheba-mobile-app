const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Remove expo-location's background location service from the manifest.
 *
 * expo-location's own library manifest declares
 * `expo.modules.location.services.LocationTaskService` with
 * `foregroundServiceType="location"`, and no plugin option removes it — the
 * plugin's `isAndroidForegroundServiceEnabled` only controls the permissions.
 *
 * Shathi Sheba never tracks location in the background (no
 * `startLocationUpdatesAsync`, no TaskManager): it reads one approximate fix
 * while the farmer is on screen. A declared location foreground service is
 * dead weight that Play reads as background-location capability and asks you
 * to justify in the Foreground service declaration — for a feature the app
 * does not have. Removing it at manifest-merge time keeps the declaration
 * honest. If background tracking is ever added, delete this plugin and file
 * the declaration.
 */
const SERVICE = 'expo.modules.location.services.LocationTaskService';

module.exports = function withoutLocationService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = manifest.$ || {};
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';

    const app = manifest.application?.[0];
    if (!app) return cfg;
    app.service = (app.service || []).filter((s) => s.$?.['android:name'] !== SERVICE);
    app.service.push({ $: { 'android:name': SERVICE, 'tools:node': 'remove' } });
    return cfg;
  });
};
