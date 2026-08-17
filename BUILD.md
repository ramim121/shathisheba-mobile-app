# Building and running Shathi Sheba

## Which backend the app talks to

`src/api/client.ts` resolves `API_BASE_URL` once, at module load:

| Build | Env file Expo loads | Backend |
|---|---|---|
| `npx expo start` | `.env` | your LAN address, e.g. `http://192.168.x.x:3000/api/v1` |
| release APK | `.env.production` | `https://shathisheba.digigramventures.com/api/v1` |

Both files are gitignored. `.env.production` is the one the APK ships with.

Two guards sit behind that, because the failure they prevent is invisible:

- A release build with no `EXPO_PUBLIC_API_BASE_URL` falls back to **production**,
  not `localhost`. On a phone, `localhost` is the phone — every request fails, the
  app falls back to its cached copy, and nothing indicates a bad build.
- A release build pointed at a plain `http://` URL is refused and replaced with
  production, with a warning. Session tokens, phone numbers and loan applications
  travel over this connection.

Neither guard is active in development, where plain HTTP against a laptop is the
whole point.

---

## Development

Two terminals. The phone needs to reach your machine, so both must be on the same
Wi-Fi.

```bash
# 1. the backend
cd ../ShathiShebaAdmin && npm run dev        # binds 0.0.0.0:3000

# 2. the app
npx expo start                               # scan the QR with Expo Go
```

**When the phone cannot connect, check the LAN address first.** This machine's
address has changed repeatedly. Confirm it and update `.env`:

```bash
ipconfig | findstr /i "IPv4"                 # Windows
ifconfig | grep 'inet '                      # macOS/Linux
```

`EXPO_PUBLIC_*` values are read at bundle time, so restart Expo after editing
`.env` — a Fast Refresh will not pick it up.

---

## Release APK

`android/` is generated and gitignored, so a clean build regenerates it.

```bash
npx expo prebuild --platform android --clean

# Windows
cd android && .\gradlew.bat assembleRelease

# macOS/Linux
cd android && ./gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`.

Gradle release builds run Metro with `NODE_ENV=production`, which is what makes
Expo read `.env.production` instead of `.env`.

### Verifying the endpoint is baked in

Cheaper than a full Gradle build, and it checks the thing that actually matters:

```bash
NODE_ENV=production npx expo export --platform android --output-dir /tmp/ss-export --clear
grep -c "shathisheba.digigramventures.com" /tmp/ss-export/_expo/static/js/android/*.hbc   # expect 1
grep -c "192.168"                          /tmp/ss-export/_expo/static/js/android/*.hbc   # expect 0
```

If a LAN address appears in that bundle, the build would have shipped pointed at
your laptop.

---

## Known constraints

- **`EXPO_PUBLIC_*` values are compiled into the binary** and are extractable from
  any distributed APK. This currently includes the Gemini and WeatherAPI keys.
  Rotation does not help — the next build embeds the new value. The fix is to
  proxy both providers through the backend; `src/ai/gemini.ts` was extracted to
  make that a single-file change. See `ShathiShebaAdmin/OPEN-ISSUES.md` §1.4.
- The session token is held in `AsyncStorage`, which is not encrypted
  (`SEC-13`). `expo-secure-store` is the intended replacement.
- Expo `54.0.35` is installed; Expo expects `~54.0.36`.
