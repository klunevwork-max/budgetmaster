mod accounts;
mod db;
mod kdf;
mod keyslot;

use accounts::{RecoveryInfo, RecoverySetup};
use rusqlite::Connection;
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
use zeroize::Zeroizing;

struct Session {
    name: String,
    #[allow(dead_code)]
    conn: Connection,
}

#[derive(Default)]
struct AppState {
    session: Mutex<Option<Session>>,
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn parse_setup(kind: &str, question: Option<String>, answer: Option<String>) -> Result<RecoverySetup, String> {
    match kind {
        "none" => Ok(RecoverySetup::None),
        "code" => Ok(RecoverySetup::Code),
        "question" => Ok(RecoverySetup::Question {
            question: question.unwrap_or_default(),
            answer: answer.unwrap_or_default(),
        }),
        _ => Err("Неизвестный способ восстановления".into()),
    }
}

fn current_name(state: &State<'_, AppState>) -> Result<String, String> {
    state
        .session
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.name.clone())
        .ok_or_else(|| "Не выполнен вход".to_string())
}

#[tauri::command]
async fn list_accounts(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    accounts::list_accounts(&data_dir(&app)?).map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    name: String,
    password: String,
    recovery_kind: String,
    question: Option<String>,
    answer: Option<String>,
) -> Result<Option<String>, String> {
    let password = Zeroizing::new(password);
    let setup = parse_setup(&recovery_kind, question, answer)?;
    let dir = data_dir(&app)?;
    let (conn, code) =
        accounts::create_account(&dir, &name, &password, setup).map_err(|e| e.to_string())?;
    *state.session.lock().unwrap() = Some(Session { name: name.trim().to_string(), conn });
    Ok(code)
}

#[tauri::command]
async fn login(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    name: String,
    password: String,
) -> Result<(), String> {
    let password = Zeroizing::new(password);
    let dir = data_dir(&app)?;
    let (conn, _) = accounts::open_account(&dir, &name, &password).map_err(|e| e.to_string())?;
    *state.session.lock().unwrap() = Some(Session { name, conn });
    Ok(())
}

#[tauri::command]
async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    *state.session.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
async fn session_info(state: State<'_, AppState>) -> Result<Option<String>, String> {
    Ok(state.session.lock().unwrap().as_ref().map(|s| s.name.clone()))
}

#[tauri::command]
async fn table_count(state: State<'_, AppState>) -> Result<i64, String> {
    let g = state.session.lock().unwrap();
    let s = g.as_ref().ok_or("Не выполнен вход")?;
    s.conn
        .query_row("SELECT count(*) FROM sqlite_master WHERE type='table'", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn change_password(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    let old = Zeroizing::new(old_password);
    let new = Zeroizing::new(new_password);
    let name = current_name(&state)?;
    accounts::change_password(&data_dir(&app)?, &name, &old, &new).map_err(|e| e.to_string())
}

#[tauri::command]
async fn recovery_info(app: tauri::AppHandle, name: String) -> Result<Option<RecoveryInfo>, String> {
    accounts::recovery_info(&data_dir(&app)?, &name).map_err(|e| e.to_string())
}

#[tauri::command]
async fn recover_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    name: String,
    secret: String,
    new_password: String,
) -> Result<(), String> {
    let secret = Zeroizing::new(secret);
    let new = Zeroizing::new(new_password);
    let conn = accounts::recover_account(&data_dir(&app)?, &name, &secret, &new)
        .map_err(|e| e.to_string())?;
    *state.session.lock().unwrap() = Some(Session { name, conn });
    Ok(())
}

#[tauri::command]
async fn set_recovery(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    password: String,
    recovery_kind: String,
    question: Option<String>,
    answer: Option<String>,
) -> Result<Option<String>, String> {
    let password = Zeroizing::new(password);
    let setup = parse_setup(&recovery_kind, question, answer)?;
    let name = current_name(&state)?;
    accounts::set_recovery(&data_dir(&app)?, &name, &password, setup).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_accounts,
            create_account,
            login,
            logout,
            session_info,
            table_count,
            change_password,
            recovery_info,
            recover_account,
            set_recovery
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
