use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

// ---------------------------------------------------------------------------
// Return-type structs (must match the JS contract in ARCHITECTURE.md)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct SessionMeta {
    pub id: String,           // stable id = relative path from projects dir
    pub path: String,         // absolute path to the .jsonl
    pub project_raw: String,  // the encoded project dir name
    pub mtime: u64,           // unix seconds
    pub size: u64,            // bytes
    pub preview: Vec<String>, // first ≤50 lines of the file
}

#[derive(Serialize)]
pub struct SubagentFile {
    pub name: String,
    pub content: String,
    pub is_meta: bool,
}

#[derive(Serialize)]
pub struct BackupVersion {
    pub version: u32,
    pub timestamp: u64,
    pub path: String,
    pub size: u64,
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Resolve the Claude projects directory without going through `#[tauri::command]`.
fn projects_dir_inner() -> Option<PathBuf> {
    // 1. Honour CLAUDE_CONFIG_DIR if set
    if let Ok(config_dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        let p = PathBuf::from(config_dir).join("projects");
        if p.is_dir() {
            return Some(p);
        }
    }
    // 2. Fall back to ~/.claude/projects
    let home = dirs::home_dir()?;
    let p = home.join(".claude").join("projects");
    if p.is_dir() {
        Some(p)
    } else {
        None
    }
}

fn unix_secs(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

/// Replace path separators and any non-alphanumeric character with '_'.
fn sanitize_id(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect()
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Return absolute path of the Claude projects directory, or null if missing.
#[tauri::command]
fn find_projects_dir() -> Option<String> {
    projects_dir_inner().map(|p| p.to_string_lossy().into_owned())
}

/// Walk every immediate sub-directory of the projects dir.  For each *.jsonl
/// that is NOT named agent-*.jsonl, emit one SessionMeta.
/// Skips dirs named "subagents" and "tool-results".
#[tauri::command]
fn list_sessions() -> Result<Vec<SessionMeta>, String> {
    let projects = projects_dir_inner()
        .ok_or_else(|| "Projects directory not found".to_string())?;

    let mut sessions: Vec<SessionMeta> = Vec::new();

    let top_entries = fs::read_dir(&projects).map_err(|e| e.to_string())?;
    for top in top_entries.flatten() {
        let project_path = top.path();
        if !project_path.is_dir() {
            continue;
        }
        let dir_name = match project_path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if dir_name == "subagents" || dir_name == "tool-results" {
            continue;
        }

        let inner = match fs::read_dir(&project_path) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for jentry in inner.flatten() {
            let file_path = jentry.path();
            let fname = match file_path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            if !fname.ends_with(".jsonl") {
                continue;
            }
            if fname.starts_with("agent-") {
                continue;
            }

            let meta = match fs::metadata(&file_path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            let mtime = meta.modified().map(unix_secs).unwrap_or(0);
            let size = meta.len();

            let content = fs::read_to_string(&file_path).unwrap_or_default();
            let preview: Vec<String> = content.lines().take(50).map(|l| l.to_string()).collect();

            // Relative path from projects root — this is the stable session id.
            let rel = file_path
                .strip_prefix(&projects)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|_| fname.clone());

            sessions.push(SessionMeta {
                id: rel,
                path: file_path.to_string_lossy().into_owned(),
                project_raw: dir_name.clone(),
                mtime,
                size,
                preview,
            });
        }
    }

    Ok(sessions)
}

/// Return raw UTF-8 contents of a session .jsonl file.
#[tauri::command]
fn read_session(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Look in <dir-of-session>/subagents/ for agent-*.jsonl and agent-*.meta.json.
#[tauri::command]
fn read_subagents(session_path: String) -> Result<Vec<SubagentFile>, String> {
    let session_file = Path::new(&session_path);
    let parent = session_file
        .parent()
        .ok_or_else(|| "Cannot determine parent directory".to_string())?;
    let subagents_dir = parent.join("subagents");

    if !subagents_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut files: Vec<SubagentFile> = Vec::new();
    let entries = fs::read_dir(&subagents_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let file_path = entry.path();
        let fname = match file_path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let is_meta: bool;
        if fname.starts_with("agent-") && fname.ends_with(".meta.json") {
            is_meta = true;
        } else if fname.starts_with("agent-") && fname.ends_with(".jsonl") {
            is_meta = false;
        } else {
            continue;
        }
        let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
        files.push(SubagentFile {
            name: fname,
            content,
            is_meta,
        });
    }

    Ok(files)
}

/// Overwrite the original .jsonl.  Caller MUST call snapshot(path) first.
#[tauri::command]
fn write_session(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// Copy the current on-disk file into the backup store before an override.
///
/// Backup location:
///   ~/.claude/.ccviz-backups/<sanitized_session_id>/vNNN-<unixsecs>.jsonl
///
/// NNN is 1-based and grows by counting existing *.jsonl files in the dir.
#[tauri::command]
fn snapshot(path: String) -> Result<BackupVersion, String> {
    let projects = projects_dir_inner()
        .ok_or_else(|| "Projects directory not found".to_string())?;

    let file_path = Path::new(&path);

    let rel = file_path
        .strip_prefix(&projects)
        .map_err(|_| "Session file is not under the projects directory".to_string())?;

    let session_id = sanitize_id(&rel.to_string_lossy());

    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let backup_root = home
        .join(".claude")
        .join(".ccviz-backups")
        .join(&session_id);

    fs::create_dir_all(&backup_root).map_err(|e| e.to_string())?;

    // Count existing *.jsonl snapshots to derive the next version number.
    let existing_count = fs::read_dir(&backup_root)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| x == "jsonl")
                .unwrap_or(false)
        })
        .count();

    let version = (existing_count as u32) + 1;
    let timestamp = unix_secs(SystemTime::now());

    let backup_name = format!("v{:03}-{}.jsonl", version, timestamp);
    let backup_path = backup_root.join(&backup_name);

    fs::copy(file_path, &backup_path).map_err(|e| e.to_string())?;

    let size = fs::metadata(&backup_path)
        .map(|m| m.len())
        .unwrap_or(0);

    Ok(BackupVersion {
        version,
        timestamp,
        path: backup_path.to_string_lossy().into_owned(),
        size,
    })
}

/// List all snapshots for a session, newest first.
#[tauri::command]
fn list_backups(session_path: String) -> Result<Vec<BackupVersion>, String> {
    let projects = projects_dir_inner()
        .ok_or_else(|| "Projects directory not found".to_string())?;

    let file_path = Path::new(&session_path);
    let rel = file_path
        .strip_prefix(&projects)
        .map_err(|_| "Session file is not under the projects directory".to_string())?;
    let session_id = sanitize_id(&rel.to_string_lossy());

    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let backup_root = home
        .join(".claude")
        .join(".ccviz-backups")
        .join(&session_id);

    if !backup_root.is_dir() {
        return Ok(Vec::new());
    }

    let mut versions: Vec<BackupVersion> = fs::read_dir(&backup_root)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|entry| {
            let p = entry.path();
            let fname = p.file_name()?.to_str()?.to_string();
            if !fname.ends_with(".jsonl") {
                return None;
            }
            // Parse vNNN-<timestamp>.jsonl
            let stem = fname.strip_suffix(".jsonl")?;
            let mut parts = stem.splitn(2, '-');
            let version_str = parts.next()?;
            let ts_str = parts.next()?;
            let version: u32 = version_str.strip_prefix('v')?.parse().ok()?;
            let timestamp: u64 = ts_str.parse().ok()?;
            let size = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            Some(BackupVersion {
                version,
                timestamp,
                path: p.to_string_lossy().into_owned(),
                size,
            })
        })
        .collect();

    // Newest first
    versions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(versions)
}

/// Return raw contents of a backup file (caller decides what to do with it).
#[tauri::command]
fn restore_backup(backup_path: String) -> Result<String, String> {
    fs::read_to_string(&backup_path).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            find_projects_dir,
            list_sessions,
            read_session,
            read_subagents,
            write_session,
            snapshot,
            list_backups,
            restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
