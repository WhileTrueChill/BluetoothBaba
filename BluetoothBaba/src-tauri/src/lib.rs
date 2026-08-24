// MeshChat application backend.
//
// This crate owns the mesh *protocol* (identity, packet framing, TTL relay,
// dedup, encryption, the peer table) and exposes it to the web frontend through
// Tauri commands + events. The radio itself lives in `tauri-plugin-blemesh`
// (a Kotlin BLE plugin on Android, a no-op on desktop) — this code never
// touches Bluetooth directly, it just hands frames to `app.blemesh().send()`
// and receives them back through the `on_packet` command.

mod commands;
mod mesh;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;

use mesh::MeshState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_blemesh::init())
        .setup(|app| {
            // Persisted identity + nickname live in the platform app-data dir.
            let dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let _ = std::fs::create_dir_all(&dir);

            let identity = mesh::crypto::load_or_create_identity(&dir);
            log::info!("MeshChat identity peerId={}", identity.peer_id);

            let nickname = std::fs::read_to_string(dir.join("nickname.txt"))
                .unwrap_or_default()
                .trim()
                .to_string();

            app.manage(Arc::new(MeshState::new(identity, nickname)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_identity,
            commands::set_nickname,
            commands::start_mesh,
            commands::stop_mesh,
            commands::send_broadcast,
            commands::send_direct,
            commands::get_peers,
            commands::on_packet,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MeshChat");
}
