# MeshChat

Serverless, **BitChat-style** text messaging over a **Bluetooth LE mesh**. No
internet, no accounts, no servers — phones near each other form an ad-hoc mesh
and relay messages hop-by-hop. Direct messages are end-to-end encrypted.

Clean, minimal, iOS-style UI. Built as an Android APK entirely in GitHub
Actions.

---

## How it works

```
┌───────────────────────────────────────────────────────────────┐
│  Web frontend (Vite + TypeScript, iOS-style UI)                 │
│    views/ · state store · api.ts  ── invoke() / events ──┐      │
└──────────────────────────────────────────────────────────┼─────┘
                                                            │
┌──────────────────────────────────────────────────────────▼─────┐
│  Rust app backend  (src-tauri/src/mesh)                          │
│    identity (X25519) · packet framing · TTL flood relay ·        │
│    dedup · ChaCha20-Poly1305 direct msgs · peer roster           │
│         ── app.blemesh().send(frame) ──┐   ▲ on_packet(frame)    │
└─────────────────────────────────────────┼──┼────────────────────┘
                                           │  │
┌──────────────────────────────────────────▼──┼───────────────────┐
│  tauri-plugin-blemesh  (Kotlin, Android)     │                   │
│    dual role: advertise + GATT server (peripheral)               │
│               scan + GATT client (central)                       │
│    length-prefixed fragmentation/reassembly over one GATT char   │
└──────────────────────────────────────────────────────────────────┘
```

- **Every device is both peripheral and central at once** — it advertises a
  service UUID and runs a GATT server, *and* scans for that UUID and connects to
  peers it finds. That's what makes a true peer-to-peer mesh (no central node).
- **Relay:** each message carries a 16-byte id and a TTL. Nodes rebroadcast
  messages they haven't seen (dedup via an LRU set) and decrement the TTL, so a
  message reaches peers several hops away.
- **Public chat** is a plaintext broadcast. **Direct messages** are sealed with
  ChaCha20-Poly1305 under a key derived (HKDF-SHA256) from an X25519 ECDH shared
  secret — intermediate nodes relay them but cannot read them.
- **Identity** is a persistent X25519 keypair generated on first launch. Your
  peer id is the first 8 bytes of SHA256(public key), shown as 16 hex chars.

There is **no internet code and no API keys anywhere** in the app — it can't
phone home, and there's nothing embeddable to leak. It is offline by design.

---

## Build the APK (GitHub Actions)

1. Push this repository to GitHub on branch `main`.
2. Open **Actions → Build Android APK**. The workflow runs automatically after a push, or you can select **Run workflow**.
3. Download the `BluetoothBaba-ARM64-release` artifact from the run summary, or use the APK attached to the generated GitHub Release.

The workflow installs Node, Rust, the Android SDK and NDK toolchain, initializes the Tauri Android project, type-checks the frontend, and builds an ARM64 APK.

### Keep future APK updates installable

Android only permits an in-place APK update when the new APK uses the **same application ID and signing certificate** as the installed app. The CI workflow therefore supports a persistent release keystore through GitHub Actions secrets.

Create a signing keystore once and keep a secure backup. Do not commit the keystore or its passwords to this repository.

Add these four repository secrets under **Settings → Secrets and variables → Actions**:

- `ANDROID_KEYSTORE_BASE64` — Base64 text of the keystore file
- `ANDROID_KEYSTORE_PASSWORD` — keystore password
- `ANDROID_KEY_ALIAS` — key alias
- `ANDROID_KEY_PASSWORD` — key password

For Windows PowerShell, create the Base64 value with:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes(".\bluetoothbaba-release.jks"))
```

When all four secrets are present, new APKs use that stable key. Without them, CI falls back to a temporary debug key; those builds are for testing and may not update an APK signed by a different CI run.

**Important for the first migration:** the older CI APK was signed with a runner-generated debug key. A new persistent signing key cannot replace it in place. If Android reports a signature/package conflict, uninstall the old app once before installing the new stable-signed APK. Uninstalling clears this app's locally stored identity and nickname, so do this only after you are ready to reset that local app data.

The Android package ID remains `com.meshchat.app`. The app version is now `1.0.1` with Android version code `1000001`, so future releases have an incremented version.


---

## Install on your phone

1. Copy the `.apk` to your Android phone (or download it there directly).
2. Open it. Android will ask you to allow installing from this source — accept.
3. Launch **MeshChat**, pick a nickname.
4. On first mesh start Android will prompt for **Nearby devices / Bluetooth**
   permissions (and Location on Android 11 and older). Grant them — BLE scanning
   cannot work otherwise. If you tap the toggle and it fails, grant the
   permission in Settings and toggle again.

### Trying it out

You need **two or more phones** (Bluetooth mesh cannot be tested with one
device, an emulator, or in CI).

- Put two phones side by side, both running MeshChat with the mesh on.
- Within a few seconds each should appear in the other's **People** list.
- Tap **Public** to chat with everyone in range, or tap a person for an
  encrypted direct message.
- Add a third phone out of range of the first but near the second to see
  multi-hop relaying.

---

## What is and isn't verified

This was built to compile and wire up correctly end-to-end, but **the radio
layer genuinely cannot be exercised without physical hardware.**

**Verified**
- Web frontend type-checks and builds (`npm run typecheck`, `npm run build`).
- The icon generator produces a valid PNG.
- Frontend ↔ Rust command/event contract matches on both sides.
- Tauri plugin permission/capability wiring (validated at app compile time in CI).

**Only testable on ≥2 physical Android phones**
- BLE advertising/scanning, GATT connect, MTU negotiation.
- Fragmentation/reassembly of messages larger than one BLE packet.
- Multi-hop relay, dedup, and direct-message encryption over the air.

If something misbehaves on-device, the most likely spots are timing/permission
edge cases in `tauri-plugin-blemesh/android/.../BleMeshPlugin.kt`.

---

## Local development (no phone)

Run the UI in a browser against a built-in mock (simulated peers + replies):

```bash
npm install
npm run dev
```

`src/api.ts` auto-detects it isn't running inside Tauri and uses the mock, so
you can iterate on the UI without any native build.

---

## Project layout

```
index.html, src/            Web frontend (Vite + TypeScript, iOS-style UI)
src-tauri/                  Rust app: mesh protocol, commands, Tauri config
  src/mesh/                   identity, packet, crypto, relay engine
tauri-plugin-blemesh/       Bluetooth LE transport
  src/                        Rust plugin glue (Android bridge + desktop no-op)
  android/                    Kotlin dual-role BLE implementation
scripts/make-icon.mjs       Dependency-free app-icon generator (run in CI)
.github/workflows/android.yml  The APK build
```

## License

MIT
