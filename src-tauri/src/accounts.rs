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
use crate::keystore;

const BAD_PASSWORD: &str = "Неверный пароль или повреждённый профиль";
const BAD_RECOVERY: &str = "Неверный код или ответ восстановления";
const NO_DEVICE_KEY: &str = "Ключ этой учётки не найден в хранилище ОС (другой компьютер или переустановка). Используйте «Забыли пароль?» и код восстановления.";
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

#[derive(Serialize)]
pub struct AccountInfo {
    pub name: String,
    pub has_password: bool,
}

/// budget_userN.keys.json. password = None -> учётка без пароля (ключ в хранилище ОС).
#[derive(Serialize, Deserialize, Clone)]
pub struct KeysFile {
    pub version: u32,
    pub password: Option<Slot>,
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

fn dev_id_for(dir: &Path, db_file: &str) -> String {
    dir.join(db_file).to_string_lossy().to_string()
}

fn dev_id(dir: &Path, e: &AccountEntry) -> String {
    dev_id_for(dir, &e.db_file)
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

fn read_keys(dir: &Path, db_file: &str) -> Result<KeysFile> {
    let bytes = fs::read(dir.join(keys_file_name(db_file)))
        .map_err(|_| anyhow!("Файл ключей учётки не найден"))?;
    let keys: KeysFile =
        serde_json::from_slice(&bytes).map_err(|_| anyhow!("Файл ключей повреждён"))?;
    if keys.version != 1 {
        bail!("Неподдерживаемая версия файла ключей");
    }
    if let Some(p) = &keys.password {
        p.kdf.validate()?;
    }
    if let Some(r) = &keys.recovery {
        r.kdf.validate()?;
    }
    Ok(keys)
}

pub fn list_accounts(dir: &Path) -> Result<Vec<AccountInfo>> {
    let users = load_users(dir)?;
    Ok(users
        .accounts
        .into_iter()
        .map(|a| {
            let has_password = validate_db_file(&a.db_file).is_ok()
                && read_keys(dir, &a.db_file).map(|k| k.password.is_some()).unwrap_or(true);
            AccountInfo { name: a.name, has_password }
        })
        .collect())
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
    let keys = read_keys(dir, &entry.db_file)?;
    Ok((entry, keys))
}

fn write_keys(dir: &Path, entry: &AccountEntry, keys: &KeysFile) -> Result<()> {
    atomic_write(&dir.join(keys_file_name(&entry.db_file)), &serde_json::to_vec_pretty(keys)?)
}

/// Мастер-ключ: из слота пароля или (для учётки без пароля) из хранилища ОС.
fn get_master(dir: &Path, entry: &AccountEntry, keys: &KeysFile, password: &str) -> Result<Zeroizing<[u8; 32]>> {
    match &keys.password {
        Some(slot) => keyslot::unwrap(password, slot, AAD_PASSWORD).map_err(|_| anyhow!(BAD_PASSWORD)),
        None => keystore::load(&dev_id(dir, entry))?.ok_or_else(|| anyhow!(NO_DEVICE_KEY)),
    }
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

/// password = None -> учётка без пароля (тогда восстановление обязательно).
/// Возвращает соединение и (если выбран «код») код восстановления.
pub fn create_account(
    dir: &Path,
    name: &str,
    password: Option<&str>,
    setup: RecoverySetup,
) -> Result<(Connection, Option<String>)> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 64 {
        bail!("Имя учётки: от 1 до 64 символов");
    }
    match password {
        Some(p) => check_password(p)?,
        None => {
            if matches!(setup, RecoverySetup::None) {
                bail!("Для учётки без пароля обязательно восстановление: код или контрольный вопрос");
            }
        }
    }
    let mut users = load_users(dir)?;
    if users.accounts.iter().any(|a| a.name == name) {
        bail!("Учётка с таким именем уже существует");
    }

    let mut master = Zeroizing::new([0u8; 32]);
    rand::thread_rng().fill_bytes(&mut *master);
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);

    let pw_slot = match password {
        Some(p) => Some(keyslot::wrap(p, &master, AAD_PASSWORD, None, None)?),
        None => None,
    };
    let (rec_slot, code) = build_recovery(&master, setup)?;
    let keys = KeysFile { version: 1, password: pw_slot, recovery: rec_slot };

    let db_file = next_db_file(dir, &users);
    let db_path = dir.join(&db_file);
    let keys_path = dir.join(keys_file_name(&db_file));
    let id = dev_id_for(dir, &db_file);

    let result = (|| -> Result<Connection> {
        let conn = open_with_key(&db_path, &master, &salt)?;
        migrate(&conn)?;
        if password.is_none() {
            keystore::store(&id, &master)?;
        }
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
        let _ = keystore::delete(&id);
    }
    result.map(|c| (c, code))
}

pub fn open_account(dir: &Path, name: &str, password: &str) -> Result<(Connection, AccountEntry)> {
    let (entry, keys) = find_entry(dir, name)?;
    let master = get_master(dir, &entry, &keys, password)?;
    let conn = open_with_master(dir, &entry, &master)?;
    Ok((conn, entry))
}

/// Смена пароля. Для учётки без пароля `old` игнорируется — так пароль задаётся впервые.
pub fn change_password(dir: &Path, name: &str, old: &str, new: &str) -> Result<()> {
    check_password(new)?;
    let (entry, mut keys) = find_entry(dir, name)?;
    let master = get_master(dir, &entry, &keys, old)?;
    let was_device = keys.password.is_none();
    keys.password = Some(keyslot::wrap(new, &master, AAD_PASSWORD, None, None)?);
    write_keys(dir, &entry, &keys)?;
    if was_device {
        let _ = keystore::delete(&dev_id(dir, &entry));
    }
    Ok(())
}

/// Перевести учётку в режим «без пароля» (нужны текущий пароль и настроенное восстановление).
pub fn remove_password(dir: &Path, name: &str, password: &str) -> Result<()> {
    let (entry, mut keys) = find_entry(dir, name)?;
    if keys.password.is_none() {
        bail!("Пароль уже не задан");
    }
    if keys.recovery.is_none() {
        bail!("Сначала настройте восстановление (код или вопрос): для учётки без пароля оно обязательно");
    }
    let master = get_master(dir, &entry, &keys, password)?;
    let id = dev_id(dir, &entry);
    keystore::store(&id, &master)?;
    keys.password = None;
    if let Err(e) = write_keys(dir, &entry, &keys) {
        let _ = keystore::delete(&id);
        return Err(e);
    }
    Ok(())
}

pub fn recovery_info(dir: &Path, name: &str) -> Result<Option<RecoveryInfo>> {
    let (_, keys) = find_entry(dir, name)?;
    Ok(keys.recovery.map(|r| RecoveryInfo {
        kind: r.kind.clone().unwrap_or_else(|| "code".into()),
        question: r.question.clone(),
    }))
}

/// Восстановление: секрет -> мастер-ключ -> новый пароль. Пустой пароль = учётка без пароля.
pub fn recover_account(dir: &Path, name: &str, secret: &str, new_password: &str) -> Result<Connection> {
    let passwordless = new_password.is_empty();
    if !passwordless {
        check_password(new_password)?;
    }
    let (entry, mut keys) = find_entry(dir, name)?;
    let slot = keys
        .recovery
        .clone()
        .ok_or_else(|| anyhow!("Для этой учётки восстановление не настроено"))?;
    let normalized = match slot.kind.as_deref() {
        Some("question") => keyslot::normalize_answer(secret),
        _ => keyslot::normalize_code(secret),
    };
    let master = keyslot::unwrap(&normalized, &slot, AAD_RECOVERY).map_err(|_| anyhow!(BAD_RECOVERY))?;
    let id = dev_id(dir, &entry);
    if passwordless {
        keystore::store(&id, &master)?;
        keys.password = None;
    } else {
        keys.password = Some(keyslot::wrap(new_password, &master, AAD_PASSWORD, None, None)?);
    }
    write_keys(dir, &entry, &keys)?;
    if !passwordless {
        let _ = keystore::delete(&id);
    }
    open_with_master(dir, &entry, &master)
}

/// Настроить или заменить восстановление (для учётки с паролем нужен текущий пароль).
pub fn set_recovery(dir: &Path, name: &str, password: &str, setup: RecoverySetup) -> Result<Option<String>> {
    let (entry, mut keys) = find_entry(dir, name)?;
    if keys.password.is_none() && matches!(setup, RecoverySetup::None) {
        bail!("Для учётки без пароля восстановление обязательно");
    }
    let master = get_master(dir, &entry, &keys, password)?;
    let (slot, code) = build_recovery(&master, setup)?;
    keys.recovery = slot;
    write_keys(dir, &entry, &keys)?;
    Ok(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let c = COUNTER.fetch_add(1, Ordering::SeqCst);
        let d = std::env::temp_dir().join(format!("bm_test_{}_{n}_{c}", std::process::id()));
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
        let (c, code) = create_account(&d, "A", Some("password-1234"), RecoverySetup::Code).unwrap();
        drop(c);
        let code = code.unwrap();
        assert!(create_account(&d, "A", Some("password-1234"), RecoverySetup::None).is_err());
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
        assert!(create_account(&d, "B", Some("password-1234"), weak).is_err());
        assert!(list_accounts(&d).unwrap().is_empty());

        let setup = RecoverySetup::Question {
            question: "Любимая книга детства?".into(),
            answer: "Мой Ответ 12345".into(),
        };
        drop(create_account(&d, "B", Some("password-1234"), setup).unwrap().0);
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
        drop(create_account(&d, "C", Some("password-1234"), RecoverySetup::None).unwrap().0);
        assert!(recovery_info(&d, "C").unwrap().is_none());
        assert!(recover_account(&d, "C", "anything", "new-password-1").is_err());
        assert!(set_recovery(&d, "C", "wrong-password", RecoverySetup::Code).is_err());
        let code = set_recovery(&d, "C", "password-1234", RecoverySetup::Code).unwrap().unwrap();
        drop(recover_account(&d, "C", &code, "new-password-1").unwrap());
        assert!(open_account(&d, "C", "new-password-1").is_ok());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn passwordless_flow() {
        let d = tmp();
        // без восстановления учётка без пароля запрещена
        assert!(create_account(&d, "P", None, RecoverySetup::None).is_err());
        assert!(list_accounts(&d).unwrap().is_empty());

        let (c, code) = create_account(&d, "P", None, RecoverySetup::Code).unwrap();
        drop(c);
        let code = code.unwrap();
        assert!(!list_accounts(&d).unwrap()[0].has_password);
        drop(open_account(&d, "P", "").unwrap());

        // задать пароль
        change_password(&d, "P", "", "password-1234").unwrap();
        assert!(list_accounts(&d).unwrap()[0].has_password);
        assert!(open_account(&d, "P", "").is_err());
        drop(open_account(&d, "P", "password-1234").unwrap());

        // убрать пароль (нужен верный текущий)
        assert!(remove_password(&d, "P", "wrong-password").is_err());
        remove_password(&d, "P", "password-1234").unwrap();
        assert!(!list_accounts(&d).unwrap()[0].has_password);
        drop(open_account(&d, "P", "").unwrap());

        // потеря ключа устройства: вход невозможен, восстановление работает
        keystore::delete(&dev_id_for(&d, "budget_user1.db")).unwrap();
        assert!(open_account(&d, "P", "").is_err());
        drop(recover_account(&d, "P", &code, "").unwrap()); // обратно «без пароля»
        drop(open_account(&d, "P", "").unwrap());
        drop(recover_account(&d, "P", &code, "new-password-1").unwrap());
        assert!(open_account(&d, "P", "new-password-1").is_ok());

        // без пароля нельзя снять восстановление
        let d2 = tmp();
        drop(create_account(&d2, "Q", None, RecoverySetup::Code).unwrap().0);
        assert!(set_recovery(&d2, "Q", "", RecoverySetup::None).is_err());
        let _ = fs::remove_dir_all(&d);
        let _ = fs::remove_dir_all(&d2);
    }
}
