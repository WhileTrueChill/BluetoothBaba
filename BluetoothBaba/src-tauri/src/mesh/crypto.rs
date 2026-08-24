// Identity + cryptography for the mesh.
//
// Identity is a persistent X25519 keypair. A peer's short id is the first 8
// bytes of SHA256(public key), hex-encoded (16 chars). Direct messages are
// sealed with ChaCha20-Poly1305 under a key derived from an X25519 ECDH shared
// secret via HKDF-SHA256. Broadcasts and announces are sent in the clear.

use std::fs;
use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, KeyInit, Nonce};
use hkdf::Hkdf;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

pub struct Identity {
    pub secret: StaticSecret,
    pub pub_bytes: [u8; 32],
    pub peer_id: String,
    pub pub_b64: String,
}

pub fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

fn digest8(pk: &[u8; 32]) -> [u8; 8] {
    let mut h = Sha256::new();
    h.update(pk);
    let d = h.finalize();
    let mut out = [0u8; 8];
    out.copy_from_slice(&d[..8]);
    out
}

pub fn peer_id_from_pub(pk: &[u8; 32]) -> String {
    to_hex(&digest8(pk))
}

pub fn recipient_id_from_pub(pk: &[u8; 32]) -> [u8; 8] {
    digest8(pk)
}

pub fn rand_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    OsRng.fill_bytes(&mut b);
    b
}

pub fn load_or_create_identity(dir: &Path) -> Identity {
    let key_path = dir.join("identity.key");
    let secret = match fs::read(&key_path) {
        Ok(bytes) if bytes.len() == 32 => {
            let mut b = [0u8; 32];
            b.copy_from_slice(&bytes);
            StaticSecret::from(b)
        }
        _ => {
            let b = rand_bytes::<32>();
            let s = StaticSecret::from(b);
            let _ = fs::create_dir_all(dir);
            let _ = fs::write(&key_path, s.to_bytes());
            s
        }
    };

    let public = PublicKey::from(&secret);
    let pub_bytes = public.to_bytes();
    let peer_id = peer_id_from_pub(&pub_bytes);
    let pub_b64 = STANDARD.encode(pub_bytes);

    Identity {
        secret,
        pub_bytes,
        peer_id,
        pub_b64,
    }
}

fn derive_key(shared: &[u8; 32]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(None, shared);
    let mut okm = [0u8; 32];
    hk.expand(b"meshchat-v1-dm", &mut okm)
        .expect("hkdf expand of 32 bytes never fails");
    okm
}

/// Seal a direct-message payload for `their_pub`. Returns `nonce || ciphertext`.
pub fn seal(
    secret: &StaticSecret,
    our_pub: &[u8; 32],
    their_pub: &[u8; 32],
    plaintext: &[u8],
) -> Option<Vec<u8>> {
    let shared = secret
        .diffie_hellman(&PublicKey::from(*their_pub))
        .to_bytes();
    let key = derive_key(&shared);
    let cipher = ChaCha20Poly1305::new(Key::from_slice(&key));

    let nonce_bytes = rand_bytes::<12>();
    let nonce = Nonce::from_slice(&nonce_bytes);

    // AAD binds the ciphertext to (sender, recipient) so it can't be replayed
    // under a different header.
    let mut aad = Vec::with_capacity(40);
    aad.extend_from_slice(our_pub);
    aad.extend_from_slice(&recipient_id_from_pub(their_pub));

    let ct = cipher
        .encrypt(nonce, Payload { msg: plaintext, aad: &aad })
        .ok()?;

    let mut out = Vec::with_capacity(12 + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Some(out)
}

/// Open a direct message addressed to us. `body` is `nonce || ciphertext`.
pub fn open(
    secret: &StaticSecret,
    sender_pub: &[u8; 32],
    recipient_id: &[u8; 8],
    body: &[u8],
) -> Option<Vec<u8>> {
    if body.len() < 12 {
        return None;
    }
    let shared = secret
        .diffie_hellman(&PublicKey::from(*sender_pub))
        .to_bytes();
    let key = derive_key(&shared);
    let cipher = ChaCha20Poly1305::new(Key::from_slice(&key));
    let nonce = Nonce::from_slice(&body[..12]);

    let mut aad = Vec::with_capacity(40);
    aad.extend_from_slice(sender_pub);
    aad.extend_from_slice(recipient_id);

    cipher
        .decrypt(nonce, Payload { msg: &body[12..], aad: &aad })
        .ok()
}
