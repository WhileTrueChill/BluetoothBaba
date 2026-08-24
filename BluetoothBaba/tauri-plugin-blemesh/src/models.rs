use serde::{Deserialize, Serialize};

/// Argument for the native `send` command: one wire frame, base64-encoded.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendArgs {
    pub data: String,
}
