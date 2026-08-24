// Registers the plugin's commands and links its Android Gradle project so that
// `tauri android init` automatically includes `android/` as a subproject.
//
// `register_listener` / `remove_listener` are the framework commands behind the
// JS `addPluginListener(...)` used to receive inbound "packet" events. They are
// handled natively by the Tauri Android Plugin base class (not by Rust), but
// they must be declared here so their ACL permissions (allow-register-listener,
// allow-remove-listener) are generated and can be granted in a capability.
const COMMANDS: &[&str] = &["register_listener", "remove_listener"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
