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
use zeroize::Zeroizing;

use crate::db::{migrate, open_with_key};
use crate::keyslot::{self, Slot};

const BAD_PASSWORD: &str = "Неверный пароль или повреждённый профиль";
const BAD_RECOVERY: &str = "Неверный код или ответ восстановления";
const AAD_PASSWORD: &[u8] = b"bm-keyslot-v1:password";
const AAD_RECOVERY: &[u8] = b"bm-keyslot-v1:recovery";

#[derive(Serialize, Deserialize, Clone)]
pub struct AccountEntry {
    pub name: String,
    pub db_file: String,
}

#[derive(Serialize, Deserialize, Default)]
pub struct UsersFile {
    pub accounts: Vec<AccountEntry>,
}

/// budget_userN.keys.json: мастер-ключ БД, зашифрованный паролем и (опционально) секретом восстановления.
#[derive(Serialize, Deserialize, Clone)]
pub struct KeysFile {
    pub version: u32,
    pub password: Slot,
    pub recovery: Option<Slot>,
}

pub enum RecoverySetup {
    None,
    Code,
    Question { question: String, answer: String },
}

#[derive(Serialize)]
pub struct RecoveryInfo {
    pub kind: String,
    pub question: Option<String>,
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

fn keys_file_name(db_file: &str) -> String {
    format!("{}.keys.json", &db_file[..db_file.len() - 3])
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

/// Соль SQLCipher — первые 16 байт файла БД.
fn read_header_salt(path: &Path) -> Result<[u8; 16]> {
    let mut f = fs::File::open(path)?;
    let mut buf = [0u8; 16];
    f.read_exact(&mut buf)?;
    Ok(buf)
}

fn find_entry(dir: &Path, name: &str) -> Result<(AccountEntry, KeysFile)> {
    let users = load_users(dir)?;
    let entry = users
        .accounts
        .iter()
        .find(|a| a.name == name)
        .cloned()
        .ok_or_else(|| anyhow!("Учётка не найдена"))?;
    validate_db_file(&entry.db_file)?;
    let bytes = fs::read(dir.join(keys_file_name(&entry.db_file)))
        .map_err(|_| anyhow!("Файл ключей учётки не найден"))?;
    let keys: KeysFile =
        serde_json::from_slice(&bytes).map_err(|_| anyhow!("Файл ключей повреждён"))?;
    if keys.version != 1 {
        bail!("Неподдерживаемая версия файла ключей");
    }
    keys.password.kdf.validate()?;
    if let Some(r) = &keys.recovery {
        r.kdf.validate()?;
    }
    Ok((entry, keys))
}

fn write_keys(dir: &Path, entry: &AccountEntry, keys: &KeysFile) -> Result<()> {
    atomic_write(&dir.join(keys_file_name(&entry.db_file)), &serde_json::to_vec_pretty(keys)?)
}

fn build_recovery(master: &[u8; 32], setup: RecoverySetup) -> Result<(Option<Slot>, Option<String>)> {
    match setup {
        RecoverySetup::None => Ok((None, None)),
        RecoverySetup::Code => {
            let code = keyslot::generate_code();
            let secret = keyslot::normalize_code(&code);
            let slot = keyslot::wrap(&secret, master, AAD_RECOVERY, Some("code"), None)?;
            Ok((Some(slot), Some(code)))
        }
        RecoverySetup::Question { question, answer } => {
            let question = question.trim().to_string();
            if question.is_empty() || question.chars().count() > 200 {
                bail!("Вопрос: от 1 до 200 символов");
            }
            let secret = keyslot::normalize_answer(&answer);
            if secret.chars().count() < 12 {
                bail!("Ответ должен быть не короче 12 символов (лучше — фраза из нескольких слов)");
            }
            let slot = keyslot::wrap(&secret, master, AAD_RECOVERY, Some("question"), Some(question))?;
            Ok((Some(slot), None))
        }
    }
}

fn open_with_master(dir: &Path, entry: &AccountEntry, master: &[u8; 32]) -> Result<Connection> {
    let db_path = dir.join(&entry.db_file);
    let salt = read_header_salt(&db_path)?;
    let conn = open_with_key(&db_path, master, &salt).map_err(|_| anyhow!(BAD_PASSWORD))?;
    migrate(&conn)?;
    Ok(conn)
}

/// Возвращает соединение и (если выбран «код») код восстановления — показать пользователю один раз.
pub fn create_account(
    dir: &Path,
    name: &str,
    password: &str,
    setup: RecoverySetup,
) -> Result<(Connection, Option<String>)> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 64 {
        bail!("Имя учётки: от 1 до 64 символов");
    }
    check_password(password)?;
    let mut users = load_users(dir)?;
    if users.accounts.iter().any(|a| a.name == name) {
        bail!("Учётка с таким именем уже существует");
    }

    let mut master = Zeroizing::new([0u8; 32]);
    rand::thread_rng().fill_bytes(&mut *master);
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);

    let pw_slot = keyslot::wrap(password, &master, AAD_PASSWORD, None, None)?;
    let (rec_slot, code) = build_recovery(&master, setup)?;
    let keys = KeysFile { version: 1, password: pw_slot, recovery: rec_slot };

    let db_file = next_db_file(dir, &users);
    let db_path = dir.join(&db_file);
    let keys_path = dir.join(keys_file_name(&db_file));

    let result = (|| -> Result<Connection> {
        let conn = open_with_key(&db_path, &master, &salt)?;
        migrate(&conn)?;
        atomic_write(&keys_path, &serde_json::to_vec_pretty(&keys)?)?;
        users.accounts.push(AccountEntry { name: name.to_string(), db_file: db_file.clone() });
        atomic_write(&dir.join("users.json"), &serde_json::to_vec_pretty(&users)?)?;
        Ok(conn)
    })();

    if result.is_err() {
        for ext in ["", "-wal", "-shm"] {
            let _ = fs::remove_file(format!("{}{}", db_path.display(), ext));
        }
        let _ = fs::remove_file(&keys_path);
    }
    result.map(|c| (c, code))
}

pub fn open_account(dir: &Path, name: &str, password: &str) -> Result<(Connection, AccountEntry)> {
    let (entry, keys) = find_entry(dir, name)?;
    let master = keyslot::unwrap(password, &keys.password, AAD_PASSWORD)
        .map_err(|_| anyhow!(BAD_PASSWORD))?;
    let conn = open_with_master(dir, &entry, &master)?;
    Ok((conn, entry))
}

/// Смена пароля: перешифровывается только слот пароля. БД не затрагивается.
pub fn change_password(dir: &Path, name: &str, old: &str, new: &str) -> Result<()> {
    check_password(new)?;
    let (entry, mut keys) = find_entry(dir, name)?;
    let master = keyslot::unwrap(old, &keys.password, AAD_PASSWORD)
        .map_err(|_| anyhow!(BAD_PASSWORD))?;
    keys.password = keyslot::wrap(new, &master, AAD_PASSWORD, None, None)?;
    write_keys(dir, &entry, &keys)
}

pub fn recovery_info(dir: &Path, name: &str) -> Result<Option<RecoveryInfo>> {
    let (_, keys) = find_entry(dir, name)?;
    Ok(keys.recovery.map(|r| RecoveryInfo {
        kind: r.kind.clone().unwrap_or_else(|| "code".into()),
        question: r.question.clone(),
    }))
}

/// Восстановление: секрет (код или ответ) -> мастер-ключ -> новый пароль.
pub fn recover_account(dir: &Path, name: &str, secret: &str, new_password: &str) -> Result<Connection> {
    check_password(new_password)?;
    let (entry, mut keys) = find_entry(dir, name)?;
    let slot = keys
        .recovery
        .clone()
        .ok_or_else(|| anyhow!("Для этой учётки восстановление не настроено"))?;
    let normalized = match slot.kind.as_deref() {
        Some("question") => keyslot::normalize_answer(secret),
        _ => keyslot::normalize_code(secret),
    };
    let master = keyslot::unwrap(&normalized, &slot, AAD_RECOVERY)
        .map_err(|_| anyhow!(BAD_RECOVERY))?;
    keys.password = keyslot::wrap(new_password, &master, AAD_PASSWORD, None, None)?;
    write_keys(dir, &entry, &keys)?;
    open_with_master(dir, &entry, &master)
}

/// Настроить или заменить восстановление (нужен текущий пароль).
pub fn set_recovery(dir: &Path, name: &str, password: &str, setup: RecoverySetup) -> Result<Option<String>> {
    let (entry, mut keys) = find_entry(dir, name)?;
    let master = keyslot::unwrap(password, &keys.password, AAD_PASSWORD)
        .map_err(|_| anyhow!(BAD_PASSWORD))?;
    let (slot, code) = build_recovery(&master, setup)?;
    keys.recovery = slot;
    write_keys(dir, &entry, &keys)?;
    Ok(code)
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
    fn code_flow() {
        let d = tmp();
        let (c, code) = create_account(&d, "A", "password-1234", RecoverySetup::Code).unwrap();
        drop(c);
        let code = code.unwrap();
        assert!(create_account(&d, "A", "password-1234", RecoverySetup::None).is_err());
        assert!(open_account(&d, "A", "bad-password").is_err());
        change_password(&d, "A", "password-1234", "second-pass-1").unwrap();
        assert!(open_account(&d, "A", "password-1234").is_err());
        drop(open_account(&d, "A", "second-pass-1").unwrap());
        assert!(recover_account(&d, "A", "AAAA-BBBB", "third-pass-12").is_err());
        drop(recover_account(&d, "A", &code.to_lowercase(), "third-pass-12").unwrap());
        assert!(open_account(&d, "A", "second-pass-1").is_err());
        assert!(open_account(&d, "A", "third-pass-12").is_ok());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn question_flow() {
        let d = tmp();
        let weak = RecoverySetup::Question { question: "Книга?".into(), answer: "short".into() };
        assert!(create_account(&d, "B", "password-1234", weak).is_err());
        assert!(list_accounts(&d).unwrap().is_empty());

        let setup = RecoverySetup::Question {
            question: "Любимая книга детства?".into(),
            answer: "Мой Ответ 12345".into(),
        };
        drop(create_account(&d, "B", "password-1234", setup).unwrap().0);
        let info = recovery_info(&d, "B").unwrap().unwrap();
        assert_eq!(info.kind, "question");
        assert_eq!(info.question.as_deref(), Some("Любимая книга детства?"));
        assert!(recover_account(&d, "B", "неверный ответ 99999", "new-password-1").is_err());
        drop(recover_account(&d, "B", "  мой   ОТВЕТ 12345 ", "new-password-1").unwrap());
        assert!(open_account(&d, "B", "new-password-1").is_ok());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn none_and_set_recovery() {
        let d = tmp();
        drop(create_account(&d, "C", "password-1234", RecoverySetup::None).unwrap().0);
        assert!(recovery_info(&d, "C").unwrap().is_none());
        assert!(recover_account(&d, "C", "anything", "new-password-1").is_err());
        assert!(set_recovery(&d, "C", "wrong-password", RecoverySetup::Code).is_err());
        let code = set_recovery(&d, "C", "password-1234", RecoverySetup::Code).unwrap().unwrap();
        drop(recover_account(&d, "C", &code, "new-password-1").unwrap());
        assert!(open_account(&d, "C", "new-password-1").is_ok());
        let _ = fs::remove_dir_all(&d);
    }
}
