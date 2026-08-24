use std::marker::PhantomData;

use tauri::{plugin::PluginApi, AppHandle, Runtime};

pub fn init<R: Runtime>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, ()>,
) -> crate::Result<BleMesh<R>> {
    Ok(BleMesh(PhantomData))
}

/// No-op transport for desktop / dev builds (no BLE radio available). Lets the
/// app compile and run in a desktop shell or browser against the frontend mock.
pub struct BleMesh<R: Runtime>(PhantomData<R>);

impl<R: Runtime> BleMesh<R> {
    pub fn start(&self) -> crate::Result<()> {
        log::info!("blemesh(desktop): start() is a no-op — no BLE radio");
        Ok(())
    }

    pub fn stop(&self) -> crate::Result<()> {
        Ok(())
    }

    pub fn send(&self, _frame_b64: String) -> crate::Result<()> {
        Ok(())
    }
}
