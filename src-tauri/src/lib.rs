mod accounts;
mod commands_data;
mod commands_rates;
mod data;
mod dates;
mod db;
mod kdf;
mod keyslot;
mod keystore;
mod money;
mod rates;

use accounts::{AccountInfo, RecoveryInfo, RecoverySetup};
use rusqlite::Connection;
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
use zeroize::Zeroizing;

struct Session {
    name: String,
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
async fn list_accounts(app: tauri::AppHandle) -> Result<Vec<AccountInfo>, String> {
    accounts::list_accounts(&data_dir(&app)?).map_err(|e| e.to_string())
}

/// password = null -> учётка без пароля (восстановление обязательно).
#[tauri::command]
async fn create_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    name: String,
    password: Option<String>,
    recovery_kind: String,
    question: Option<String>,
    answer: Option<String>,
) -> Result<Option<String>, String> {
    let password = password.filter(|p| !p.is_empty()).map(Zeroizing::new);
    let setup = parse_setup(&recovery_kind, question, answer)?;
    let dir = data_dir(&app)?;
    let (conn, code) = accounts::create_account(&dir, &name, password.as_ref().map(|p| p.as_str()), setup)
        .map_err(|e| e.to_string())?;
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
async fn remove_password(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    password: String,
) -> Result<(), String> {
    let password = Zeroizing::new(password);
    let name = current_name(&state)?;
    accounts::remove_password(&data_dir(&app)?, &name, &password).map_err(|e| e.to_string())
}

#[tauri::command]
async fn recovery_info(app: tauri::AppHandle, name: String) -> Result<Option<RecoveryInfo>, String> {
    accounts::recovery_info(&data_dir(&app)?, &name).map_err(|e| e.to_string())
}

/// new_password пустой -> учётка без пароля.
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
            change_password,
            remove_password,
            recovery_info,
            recover_account,
            set_recovery,
            commands_rates::refresh_rates,
            commands_data::list_owners,
            commands_data::add_owner,
            commands_data::rename_owner,
            commands_data::delete_owner,
            commands_data::current_balances,
            commands_data::list_banks,
            commands_data::add_bank,
            commands_data::rename_bank,
            commands_data::delete_bank,
            commands_data::list_lines,
            commands_data::add_line,
            commands_data::update_line,
            commands_data::delete_line,
            commands_data::list_snapshots,
            commands_data::add_snapshot,
            commands_data::update_snapshot,
            commands_data::delete_snapshot,
            commands_data::list_categories,
            commands_data::add_category,
            commands_data::update_category,
            commands_data::delete_category,
            commands_data::list_operations,
            commands_data::add_operation,
            commands_data::update_operation,
            commands_data::delete_operation
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
