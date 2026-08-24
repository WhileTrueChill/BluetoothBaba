use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::SendArgs;

/// Must match `register_android_plugin` package + the `@TauriPlugin` class.
const PLUGIN_IDENTIFIER: &str = "app.tauri.blemesh";

pub fn init<R: Runtime>(
    _app: &AppHandle<R>,
    api: PluginApi<R, ()>,
) -> crate::Result<BleMesh<R>> {
    let handle = api
        .register_android_plugin(PLUGIN_IDENTIFIER, "BleMeshPlugin")
        .map_err(|e| crate::Error::Plugin(e.to_string()))?;
    Ok(BleMesh(handle))
}

/// Handle to the native Android dual-role BLE plugin.
pub struct BleMesh<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> BleMesh<R> {
    /// Begin advertising + scanning + serving GATT (peripheral and central).
    pub fn start(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("start", ())
            .map(|_| ())
            .map_err(|e| crate::Error::Plugin(e.to_string()))
    }

    /// Tear down all radios and connections.
    pub fn stop(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("stop", ())
            .map(|_| ())
            .map_err(|e| crate::Error::Plugin(e.to_string()))
    }

    /// Push one wire frame (base64) to every currently-connected neighbour.
    pub fn send(&self, frame_b64: String) -> crate::Result<()> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("send", SendArgs { data: frame_b64 })
            .map(|_| ())
            .map_err(|e| crate::Error::Plugin(e.to_string()))
    }
}
