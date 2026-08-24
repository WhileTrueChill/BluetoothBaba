// Tauri command surface — the bridge the web frontend calls via `invoke`.
// These are deliberately thin; the real work lives in `crate::mesh`.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, State};
use tauri_plugin_blemesh::BleMeshExt;

use crate::mesh::{self, IdentityOut, MeshState, PeerOut};

type Shared = Arc<MeshState>;

/// Re-announce our presence on this cadence and prune peers we've lost.
const ANNOUNCE_EVERY_MS: u64 = 10_000;

#[tauri::command]
pub fn get_identity(state: State<'_, Shared>) -> IdentityOut {
    mesh::identity_out(&state)
}

#[tauri::command]
pub fn set_nickname(app: AppHandle, state: State<'_, Shared>, nick: String) {
    state.set_nickname(nick);
    mesh::persist_nickname(&app, &state);
    // If we're live, let neighbours learn the new name right away.
    if state.running.load(Ordering::Acquire) {
        mesh::announce(&app, &state);
    }
}

#[tauri::command]
pub fn start_mesh(app: AppHandle, state: State<'_, Shared>) -> Result<(), String> {
    if state.running.load(Ordering::Acquire) {
        return Ok(());
    }

    // Bring the radio up first; if the user hasn't granted BLE permission the
    // native plugin rejects here with a friendly message.
    if let Err(e) = app.blemesh().start() {
        let msg = e.to_string();
        mesh::emit_mesh_state(&app, false, Some(msg.clone()));
        return Err(msg);
    }

    state.running.store(true, Ordering::Release);
    mesh::emit_mesh_state(&app, true, None);
    mesh::announce(&app, &state);

    // Background heartbeat: periodic announce + peer expiry until stopped.
    let app_bg = app.clone();
    let state_bg: Shared = Arc::clone(state.inner());
    thread::spawn(move || {
        let step = Duration::from_millis(500);
        let ticks = (ANNOUNCE_EVERY_MS / 500).max(1);
        loop {
            for _ in 0..ticks {
                if !state_bg.running.load(Ordering::Acquire) {
                    return;
                }
                thread::sleep(step);
            }
            if !state_bg.running.load(Ordering::Acquire) {
                return;
            }
            mesh::announce(&app_bg, &state_bg);
            mesh::prune_and_emit(&app_bg, &state_bg);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_mesh(app: AppHandle, state: State<'_, Shared>) {
    state.running.store(false, Ordering::Release);
    let _ = app.blemesh().stop();
    mesh::clear_peers(&app, &state);
    mesh::emit_mesh_state(&app, false, None);
}

#[tauri::command]
pub fn send_broadcast(app: AppHandle, state: State<'_, Shared>, text: String) {
    mesh::send_broadcast(&app, &state, text);
}

#[tauri::command]
pub fn send_direct(
    app: AppHandle,
    state: State<'_, Shared>,
    peer_id: String,
    text: String,
) -> Result<(), String> {
    mesh::send_direct(&app, &state, &peer_id, text)
}

#[tauri::command]
pub fn get_peers(state: State<'_, Shared>) -> Vec<PeerOut> {
    mesh::peers_json(&state)
}

#[tauri::command]
pub fn on_packet(app: AppHandle, state: State<'_, Shared>, data: String) {
    mesh::handle_frame_b64(&app, &state, &data);
}
