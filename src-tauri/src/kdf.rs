use anyhow::{anyhow, bail, Result};
use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KdfParams {
    pub algo: String,
    pub version: u32,
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
}

impl KdfParams {
    pub fn v1() -> Self {
        KdfParams { algo: "argon2id".into(), version: 1, m_kib: 65536, t: 3, p: 1 }
    }

    /// Границы из ТЗ. Проверяются при чтении из любого источника.
    pub fn validate(&self) -> Result<()> {
        if self.algo != "argon2id" || self.version != 1 {
            bail!("Недопустимые параметры KDF: неподдерживаемый алгоритм или версия");
        }
        if !(8..=1_048_576).contains(&self.m_kib)
            || !(1..=10).contains(&self.t)
            || !(1..=8).contains(&self.p)
        {
            bail!("Недопустимые параметры KDF: значения вне допустимых границ");
        }
        Ok(())
    }
}

pub fn derive_key(secret: &str, salt: &[u8; 16], p: &KdfParams) -> Result<Zeroizing<[u8; 32]>> {
    p.validate()?;
    let params = Params::new(p.m_kib, p.t, p.p, Some(32)).map_err(|e| anyhow!("{e}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0u8; 32]);
    argon
        .hash_password_into(secret.as_bytes(), salt, &mut *key)
        .map_err(|e| anyhow!("{e}"))?;
    Ok(key)
}

/// Сырой ключ SQLCipher: x'<32 байта мастер-ключа><16 байт соли>'
pub fn key_pragma(key: &[u8; 32], salt: &[u8; 16]) -> Zeroizing<String> {
    Zeroizing::new(format!("PRAGMA key = \"x'{}{}'\";", hex::encode(key), hex::encode(salt)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds() {
        assert!(KdfParams::v1().validate().is_ok());
        let mut p = KdfParams::v1();
        p.m_kib = 2_000_000;
        assert!(p.validate().is_err());
        let mut p = KdfParams::v1();
        p.t = 0;
        assert!(p.validate().is_err());
        let mut p = KdfParams::v1();
        p.algo = "argon2i".into();
        assert!(p.validate().is_err());
    }
}
