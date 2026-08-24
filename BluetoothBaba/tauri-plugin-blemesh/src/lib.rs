use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod error;
mod models;

pub use error::{Error, Result};
pub use models::*;

#[cfg(target_os = "android")]
mod mobile;
#[cfg(not(target_os = "android"))]
mod desktop;

#[cfg(target_os = "android")]
use mobile::BleMesh;
#[cfg(not(target_os = "android"))]
use desktop::BleMesh;

/// Access the BLE mesh transport from anywhere holding a `Manager` (the app,
/// an `AppHandle`, a `Window`): `app.blemesh().send(frame)?;`
pub trait BleMeshExt<R: Runtime> {
    fn blemesh(&self) -> &BleMesh<R>;
}

impl<R: Runtime, T: Manager<R>> BleMeshExt<R> for T {
    fn blemesh(&self) -> &BleMesh<R> {
        self.state::<BleMesh<R>>().inner()
    }
}

/// Initialize the plugin. The transport itself is driven from Rust (start/stop/
/// send); inbound frames are delivered to the webview as `packet` events, which
/// the frontend forwards back to the app's `on_packet` command.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("blemesh")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let blemesh = mobile::init(app, api)?;
            #[cfg(not(target_os = "android"))]
            let blemesh = desktop::init(app, api)?;
            app.manage(blemesh);
            Ok(())
        })
        .build()
}
