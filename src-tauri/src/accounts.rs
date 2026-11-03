use anyhow::{anyhow, bail, Result};
use rand::RngCore;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::db::{migrate, open_with_key};
use crate::kdf::{derive_key, rekey_pragma, KdfParams};

const BAD_PASSWORD: &str = "Неверный пароль или повреждённый профиль";

#[derive(Serialize, Deserialize, Clone)]
pub struct KdfEntry {
    #[serde(flatten)]
    pub params: KdfParams,
    pub salt: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AccountEntry {
    pub name: String,
    pub kdf: KdfEntry,
    pub db_file: String,
}

#[derive(Serialize, Deserialize, Default)]
pub struct UsersFile {
    pub accounts: Vec<AccountEntry>,
}

/// Имя файла БД: без пути, без `..`, без зарезервированных имён Windows, расширение .db
pub fn validate_db_file(name: &str) -> Result<()> {
    let lower = name.to_ascii_lowercase();
    let chars_ok = !name.is_empty()
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-');
    if !chars_ok || name.starts_with('.') || name.contains("..") || !lower.ends_with(".db") || lower.len() <= 3 {
        bail!("Недопустимое имя файла БД");
    }
    let base = lower.split('.').next().unwrap_or("");
    let is_com_lpt = (base.starts_with("com") || base.starts_with("lpt"))
        && base.len() == 4
        && matches!(base.as_bytes()[3], b'1'..=b'9');
    if ["con", "prn", "aux", "nul"].contains(&base) || is_com_lpt {
        bail!("Недопустимое имя файла БД (зарезервировано Windows)");
    }
    Ok(())
}

fn atomic_write(path: &Path, data: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

pub fn load_users(dir: &Path) -> Result<UsersFile> {
    let p = dir.join("users.json");
    if !p.exists() {
        return Ok(UsersFile::default());
    }
    let bytes = fs::read(&p)?;
    match serde_json::from_slice::<UsersFile>(&bytes) {
        Ok(u) => Ok(u),
        Err(_) => {
            let ts = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
            let corrupt = dir.join(format!("users.json.corrupt.{ts}"));
            fs::rename(&p, &corrupt)?;
            bail!(
                "users.json повреждён и переименован в {}. Восстановление учёток пока не реализовано.",
                corrupt.display()
            )
        }
    }
}

pub fn list_accounts(dir: &Path) -> Result<Vec<String>> {
    Ok(load_users(dir)?.accounts.into_iter().map(|a| a.name).collect())
}

fn check_password(password: &str) -> Result<()> {
    if password.chars().count() < 8 {
        bail!("Пароль должен быть не короче 8 символов");
    }
    Ok(())
}

fn next_db_file(dir: &Path, users: &UsersFile) -> String {
    let mut n = 1;
    loop {
        let f = format!("budget_user{n}.db");
        if !dir.join(&f).exists() && !users.accounts.iter().any(|a| a.db_file == f) {
            return f;
        }
        n += 1;
    }
}

/// Источник истины для соли — первые 16 байт файла БД.
fn read_header_salt(path: &Path) -> Result<[u8; 16]> {
    let mut f = fs::File::open(path)?;
    let mut buf = [0u8; 16];
    f.read_exact(&mut buf)?;
    Ok(buf)
}

pub fn create_account(dir: &Path, name: &str, password: &str) -> Result<Connection> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 64 {
        bail!("Имя учётки: от 1 до 64 символов");
    }
    check_password(password)?;
    let mut users = load_users(dir)?;
    if users.accounts.iter().any(|a| a.name == name) {
        bail!("Учётка с таким именем уже существует");
    }
    let db_file = next_db_file(dir, &users);
    let db_path = dir.join(&db_file);
    let kdf_path = dir.join(db_file.replace(".db", ".kdf.json"));

    let params = KdfParams::v1();
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let key = derive_key(password, &salt, &params)?;

    let result = (|| -> Result<Connection> {
        let conn = open_with_key(&db_path, &key, &salt)?;
        migrate(&conn)?;
        atomic_write(&kdf_path, &serde_json::to_vec_pretty(&params)?)?;
        users.accounts.push(AccountEntry {
            name: name.to_string(),
            kdf: KdfEntry { params: params.clone(), salt: hex::encode(salt) },
            db_file: db_file.clone(),
        });
        atomic_write(&dir.join("users.json"), &serde_json::to_vec_pretty(&users)?)?;
        Ok(conn)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&db_path);
        let _ = fs::remove_file(&kdf_path);
    }
    result
}

pub fn open_account(dir: &Path, name: &str, password: &str) -> Result<(Connection, AccountEntry)> {
    let users = load_users(dir)?;
    let entry = users
        .accounts
        .iter()
        .find(|a| a.name == name)
        .cloned()
        .ok_or_else(|| anyhow!("Учётка не найдена"))?;
    validate_db_file(&entry.db_file)?;
    entry.kdf.params.validate()?;

    let db_path = dir.join(&entry.db_file);
    let salt = read_header_salt(&db_path)?; // users.json — только подсказка
    let key = derive_key(password, &salt, &entry.kdf.params)?;
    let conn = open_with_key(&db_path, &key, &salt).map_err(|_| anyhow!(BAD_PASSWORD))?;
    migrate(&conn)?;
    Ok((conn, entry))
}

/// Смена пароля: тот же salt, новый ключ, PRAGMA rekey. users.json не меняется.
pub fn change_password(dir: &Path, name: &str, old: &str, new: &str) -> Result<Connection> {
    check_password(new)?;
    let (conn, entry) = open_account(dir, name, old)?;
    let db_path = dir.join(&entry.db_file);
    let salt = read_header_salt(&db_path)?;
    let new_key = derive_key(new, &salt, &entry.kdf.params)?;
    conn.execute_batch(&rekey_pragma(&new_key, &salt))?;
    drop(conn);
    // Проверка: БД открывается новым ключом
    let conn = open_with_key(&db_path, &new_key, &salt)
        .map_err(|_| anyhow!("Не удалось проверить БД после смены пароля"))?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> std::path::PathBuf {
        let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("bm_test_{n}"));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn db_file_validation() {
        assert!(validate_db_file("budget_user1.db").is_ok());
        for bad in ["../a.db", "a/b.db", "CON.db", "nul.db", "COM1.db", ".db", ".h.db", "a.txt", "a..b.db"] {
            assert!(validate_db_file(bad).is_err(), "{bad} должно быть отклонено");
        }
    }

    #[test]
    fn create_login_change_password() {
        let d = tmp();
        drop(create_account(&d, "Тест", "password-1234").unwrap());
        assert!(create_account(&d, "Тест", "password-1234").is_err());
        assert!(open_account(&d, "Тест", "wrong-password").is_err());
        drop(open_account(&d, "Тест", "password-1234").unwrap());
        drop(change_password(&d, "Тест", "password-1234", "new-password-5678").unwrap());
        assert!(open_account(&d, "Тест", "password-1234").is_err());
        assert!(open_account(&d, "Тест", "new-password-5678").is_ok());
        assert!(create_account(&d, "Короткий", "short").is_err());
        let _ = fs::remove_dir_all(&d);
    }
}
