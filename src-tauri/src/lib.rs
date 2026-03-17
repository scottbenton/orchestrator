use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{Emitter, State};

// ---------------------------------------------------------------------------
// PTY state
// ---------------------------------------------------------------------------

struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

type PtyMap = Mutex<HashMap<String, PtyHandle>>;

// ---------------------------------------------------------------------------
// PTY commands
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PtySpawnArgs {
    id: String,
    program: String,
    args: Vec<String>,
    cwd: String,
    rows: u16,
    cols: u16,
}

#[tauri::command]
fn pty_spawn(
    app: tauri::AppHandle,
    state: State<'_, PtyMap>,
    payload: PtySpawnArgs,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let size = PtySize {
        rows: payload.rows,
        cols: payload.cols,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("openpty failed: {e}"))?;

    let mut cmd = CommandBuilder::new(&payload.program);
    for arg in &payload.args {
        cmd.arg(arg);
    }
    cmd.cwd(&payload.cwd);

    // Inherit parent environment so binaries on PATH are found
    for (key, val) in std::env::vars() {
        cmd.env(key, val);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn failed: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer failed: {e}"))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone_reader failed: {e}"))?;

    let id = payload.id.clone();
    let app_clone = app.clone();

    // Reader thread: emit pty-data events, then pty-close
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    let _ = app_clone.emit("pty-data", serde_json::json!({ "id": id, "data": data }));
                }
            }
        }
        let _ = app_clone.emit("pty-close", serde_json::json!({ "id": id }));
    });

    let handle = PtyHandle {
        master: pair.master,
        writer,
        child,
    };

    state
        .lock()
        .map_err(|e| e.to_string())?
        .insert(payload.id, handle);

    Ok(())
}

#[tauri::command]
fn pty_write(state: State<'_, PtyMap>, id: String, data: Vec<u8>) -> Result<(), String> {
    let mut map = state.lock().map_err(|e| e.to_string())?;
    let handle = map.get_mut(&id).ok_or_else(|| format!("PTY {id} not found"))?;
    handle.writer.write_all(&data).map_err(|e| e.to_string())?;
    handle.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn pty_resize(state: State<'_, PtyMap>, id: String, rows: u16, cols: u16) -> Result<(), String> {
    let map = state.lock().map_err(|e| e.to_string())?;
    let handle = map.get(&id).ok_or_else(|| format!("PTY {id} not found"))?;
    handle
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn pty_kill(state: State<'_, PtyMap>, id: String) -> Result<(), String> {
    let mut map = state.lock().map_err(|e| e.to_string())?;
    if let Some(mut handle) = map.remove(&id) {
        let _ = handle.child.kill();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(HashMap::<String, PtyHandle>::new()))
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill
        ])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
