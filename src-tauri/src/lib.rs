mod accounts;
mod db;
mod kdf;

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

#[tauri::command]
async fn list_accounts(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = data_dir(&app)?;
    accounts::list_accounts(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    name: String,
    password: String,
) -> Result<(), String> {
    let password = Zeroizing::new(password);
    let dir = data_dir(&app)?;
    let conn = accounts::create_account(&dir, &name, &password).map_err(|e| e.to_string())?;
    *state.session.lock().unwrap() = Some(Session { name: name.trim().to_string(), conn });
    Ok(())
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
    *state.session.lock().unwrap() = None; // соединение закрывается
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
    let dir = data_dir(&app)?;
    // Закрываем сессионное соединение, чтобы файл не был заблокирован
    let name = {
        let mut g = state.session.lock().unwrap();
        g.take().map(|s| s.name).ok_or("Не выполнен вход")?
    };
    match accounts::change_password(&dir, &name, &old, &new) {
        Ok(conn) => {
            *state.session.lock().unwrap() = Some(Session { name, conn });
            Ok(())
        }
        Err(e) => {
            // Пытаемся восстановить сессию со старым паролем
            if let Ok((conn, _)) = accounts::open_account(&dir, &name, &old) {
                *state.session.lock().unwrap() = Some(Session { name, conn });
            }
            Err(e.to_string())
        }
    }
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
            change_password
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
