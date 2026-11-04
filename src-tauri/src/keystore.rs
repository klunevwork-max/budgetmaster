use anyhow::{anyhow, bail, Result};
use zeroize::Zeroizing;

fn parse(s: &str) -> Result<Zeroizing<[u8; 32]>> {
    let v = hex::decode(s).map_err(|_| anyhow!("Повреждённый ключ в хранилище ОС"))?;
    if v.len() != 32 {
        bail!("Повреждённый ключ в хранилище ОС");
    }
    let mut k = Zeroizing::new([0u8; 32]);
    k.copy_from_slice(&v);
    Ok(k)
}

#[cfg(not(test))]
mod imp {
    use super::*;
    const SERVICE: &str = "BudgetMaster";

    fn entry(id: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(SERVICE, id).map_err(|e| anyhow!("Хранилище ключей ОС недоступно: {e}"))
    }

    pub fn store(id: &str, key: &[u8; 32]) -> Result<()> {
        entry(id)?
            .set_password(&hex::encode(key))
            .map_err(|e| anyhow!("Не удалось сохранить ключ в хранилище ОС: {e}"))
    }

    pub fn load(id: &str) -> Result<Option<Zeroizing<[u8; 32]>>> {
        match entry(id)?.get_password() {
            Ok(s) => parse(&s).map(Some),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => bail!("Не удалось прочитать ключ из хранилища ОС: {e}"),
        }
    }

    pub fn delete(id: &str) -> Result<()> {
        match entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => bail!("Не удалось удалить ключ из хранилища ОС: {e}"),
        }
    }
}

/// В тестах используется память процесса, чтобы не трогать настоящий Keychain.
#[cfg(test)]
mod imp {
    use super::*;
    use std::{collections::HashMap, sync::{Mutex, OnceLock}};

    fn store_map() -> &'static Mutex<HashMap<String, String>> {
        static M: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
        M.get_or_init(|| Mutex::new(HashMap::new()))
    }

    pub fn store(id: &str, key: &[u8; 32]) -> Result<()> {
        store_map().lock().unwrap().insert(id.to_string(), hex::encode(key));
        Ok(())
    }

    pub fn load(id: &str) -> Result<Option<Zeroizing<[u8; 32]>>> {
        match store_map().lock().unwrap().get(id) {
            Some(s) => parse(s).map(Some),
            None => Ok(None),
        }
    }

    pub fn delete(id: &str) -> Result<()> {
        store_map().lock().unwrap().remove(id);
        Ok(())
    }
}

pub use imp::{delete, load, store};
