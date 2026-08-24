// Wire format for one mesh packet.
//
//   byte 0        version
//   byte 1        type (0 = announce, 1 = broadcast, 2 = direct)
//   byte 2        ttl (hop budget; decremented on relay)
//   bytes 3..19   msg_id (16 random bytes; identity for dedup + the JS-visible id)
//   bytes 19..51  sender_pub (originator's X25519 public key, 32 bytes)
//   [direct only] bytes 51..59  recipient_id (first 8 bytes of SHA256(recipient pub))
//   remainder     body
//                   announce/broadcast: JSON, plaintext
//                   direct: 12-byte nonce || ChaCha20-Poly1305 ciphertext
//
// The body length is implicit — BLE reassembly (in the Kotlin plugin) hands us
// exactly one complete frame at a time.

pub const VERSION: u8 = 1;
pub const DEFAULT_TTL: u8 = 6;

pub const TYPE_ANNOUNCE: u8 = 0;
pub const TYPE_BROADCAST: u8 = 1;
pub const TYPE_DIRECT: u8 = 2;

const HEADER_LEN: usize = 3 + 16 + 32; // 51
const RECIPIENT_LEN: usize = 8;

#[derive(Clone)]
pub struct Packet {
    pub version: u8,
    pub msg_type: u8,
    pub ttl: u8,
    pub msg_id: [u8; 16],
    pub sender_pub: [u8; 32],
    pub recipient_id: Option<[u8; 8]>,
    pub body: Vec<u8>,
}

impl Packet {
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(HEADER_LEN + RECIPIENT_LEN + self.body.len());
        out.push(self.version);
        out.push(self.msg_type);
        out.push(self.ttl);
        out.extend_from_slice(&self.msg_id);
        out.extend_from_slice(&self.sender_pub);
        if self.msg_type == TYPE_DIRECT {
            if let Some(rid) = &self.recipient_id {
                out.extend_from_slice(rid);
            }
        }
        out.extend_from_slice(&self.body);
        out
    }

    pub fn decode(buf: &[u8]) -> Option<Packet> {
        if buf.len() < HEADER_LEN {
            return None;
        }
        let version = buf[0];
        let msg_type = buf[1];
        let ttl = buf[2];

        let mut msg_id = [0u8; 16];
        msg_id.copy_from_slice(&buf[3..19]);
        let mut sender_pub = [0u8; 32];
        sender_pub.copy_from_slice(&buf[19..51]);

        let mut off = HEADER_LEN;
        let recipient_id = if msg_type == TYPE_DIRECT {
            if buf.len() < off + RECIPIENT_LEN {
                return None;
            }
            let mut rid = [0u8; 8];
            rid.copy_from_slice(&buf[off..off + RECIPIENT_LEN]);
            off += RECIPIENT_LEN;
            Some(rid)
        } else {
            None
        };

        let body = buf[off..].to_vec();
        Some(Packet {
            version,
            msg_type,
            ttl,
            msg_id,
            sender_pub,
            recipient_id,
            body,
        })
    }
}
