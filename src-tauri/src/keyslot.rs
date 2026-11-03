use anyhow::{anyhow, bail, Result};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::kdf::{derive_key, KdfParams};

/// Слот: мастер-ключ БД, зашифрованный ключом из пароля (или секрета восстановления).
#[derive(Serialize, Deserialize, Clone)]
pub struct Slot {
    pub kdf: KdfParams,
    pub salt: String,
    pub nonce: String,
    pub ct: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>, // "code" | "question" (только для слота восстановления)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question: Option<String>,
}

fn hex_fixed<const N: usize>(s: &str) -> Result<[u8; N]> {
    let v = hex::decode(s).map_err(|_| anyhow!("Повреждённый файл ключей"))?;
    v.try_into().map_err(|_| anyhow!("Повреждённый файл ключей"))
}

pub fn wrap(
    secret: &str,
    master: &[u8; 32],
    aad: &[u8],
    kind: Option<&str>,
    question: Option<String>,
) -> Result<Slot> {
    let kdf = KdfParams::v1();
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce);
    let kek = derive_key(secret, &salt, &kdf)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&kek[..]).map_err(|e| anyhow!("{e}"))?;
    let ct = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: &master[..], aad })
        .map_err(|_| anyhow!("Ошибка шифрования ключа"))?;
    Ok(Slot {
        kdf,
        salt: hex::encode(salt),
        nonce: hex::encode(nonce),
        ct: hex::encode(ct),
        kind: kind.map(|s| s.to_string()),
        question,
    })
}

pub fn unwrap(secret: &str, slot: &Slot, aad: &[u8]) -> Result<Zeroizing<[u8; 32]>> {
    slot.kdf.validate()?;
    let salt: [u8; 16] = hex_fixed(&slot.salt)?;
    let nonce: [u8; 24] = hex_fixed(&slot.nonce)?;
    let ct = hex::decode(&slot.ct).map_err(|_| anyhow!("Повреждённый файл ключей"))?;
    let kek = derive_key(secret, &salt, &slot.kdf)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&kek[..]).map_err(|e| anyhow!("{e}"))?;
    let pt = cipher
        .decrypt(XNonce::from_slice(&nonce), Payload { msg: &ct[..], aad })
        .map_err(|_| anyhow!("decrypt"))?;
    if pt.len() != 32 {
        bail!("Повреждённый файл ключей");
    }
    let mut master = Zeroizing::new([0u8; 32]);
    master.copy_from_slice(&pt);
    Ok(master)
}

const ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// Код восстановления: 128 бит случайности, 26 символов, группы по 4.
pub fn generate_code() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    let mut out = String::new();
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for b in bytes {
        acc = (acc << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(ALPHABET[((acc >> bits) & 31) as usize] as char);
        }
        acc &= (1u32 << bits) - 1;
    }
    if bits > 0 {
        out.push(ALPHABET[((acc << (5 - bits)) & 31) as usize] as char);
    }
    out.as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap())
        .collect::<Vec<_>>()
        .join("-")
}

pub fn normalize_code(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).collect()
}

pub fn normalize_answer(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_shape() {
        let c = generate_code();
        assert_eq!(normalize_code(&c).len(), 26);
        assert_ne!(generate_code(), c);
    }

    #[test]
    fn wrap_unwrap() {
        let master = [7u8; 32];
        let s = wrap("secret-pass", &master, b"aad", None, None).unwrap();
        assert_eq!(&unwrap("secret-pass", &s, b"aad").unwrap()[..], &master[..]);
        assert!(unwrap("other-pass", &s, b"aad").is_err());
        assert!(unwrap("secret-pass", &s, b"other-aad").is_err());
    }
}
