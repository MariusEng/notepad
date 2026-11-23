//! SQLite databases: the schema, running SQL typed in the query editor, creating and copying databases.
//!
//! Every call opens its own connection and closes it again, so Notepad never holds a lock on a database between
//! runs (another program can use it meanwhile) and a deleted or replaced file is never written through a stale
//! handle. A run is one connection: `BEGIN … COMMIT` works within one run; an open transaction left at the end of
//! a run is rolled back when the connection closes.

use rusqlite::fallible_iterator::FallibleIterator;
use rusqlite::types::ValueRef;
use rusqlite::{Batch, Connection, InterruptHandle, OpenFlags};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

type Res<T> = Result<T, String>;

/// The first 16 bytes of every SQLite 3 database file.
pub const MAGIC: &[u8; 16] = b"SQLite format 3\0";

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    /// The declared type ("INTEGER", "TEXT", … or "" when none was given).
    pub decl_type: String,
    pub not_null: bool,
    /// Position in the primary key (1-based), 0 = not part of it.
    pub pk: u32,
    pub default: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    /// "table" or "view".
    pub kind: String,
    /// The CREATE statement as stored by SQLite.
    pub sql: Option<String>,
    pub columns: Vec<ColumnInfo>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Schema {
    pub tables: Vec<TableInfo>,
    /// The file can only be read (permissions, read-only volume).
    pub read_only: bool,
}

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StmtResult {
    /// A statement that returns rows (SELECT, PRAGMA, … RETURNING).
    #[serde(rename_all = "camelCase")]
    Rows { sql: String, columns: Vec<String>, rows: Vec<Vec<Value>>, truncated: bool, changes: u64 },
    /// Anything else (INSERT, CREATE TABLE…): how many rows it changed.
    #[serde(rename_all = "camelCase")]
    Done { sql: String, changes: u64 },
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    /// One entry per statement that ran, in order.
    pub results: Vec<StmtResult>,
    /// The statement that failed; the ones before it have run (and, outside a transaction, are kept).
    pub error: Option<String>,
    pub ms: f64,
}

fn open(path: &str, create: bool) -> Res<(Connection, bool)> {
    if !create && !Path::new(path).is_file() {
        return Err(format!("{path} doesn't exist"));
    }
    let mut flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    if create {
        flags |= OpenFlags::SQLITE_OPEN_CREATE;
    }
    let (conn, read_only) = match Connection::open_with_flags(path, flags) {
        Ok(c) => (c, false),
        // Not writable: still let people look at it.
        Err(_) if !create => (
            Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
                .map_err(|e| e.to_string())?,
            true,
        ),
        Err(e) => return Err(e.to_string()),
    };
    // Another program writing to it: wait a little instead of failing at once.
    conn.busy_timeout(Duration::from_secs(3)).map_err(|e| e.to_string())?;
    let read_only = read_only || conn.is_readonly("main").unwrap_or(false);
    Ok((conn, read_only))
}

/// Tables and views (not SQLite's own) with their columns.
pub fn schema(path: &str) -> Res<Schema> {
    let (conn, read_only) = open(path, false)?;
    let err = |e: rusqlite::Error| e.to_string();
    let mut stmt = conn
        .prepare(
            "SELECT name, type, sql FROM sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type, name COLLATE NOCASE",
        )
        .map_err(err)?;
    let list: Vec<(String, String, Option<String>)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let mut tables = Vec::new();
    for (name, kind, sql) in list {
        let mut cols = conn
            .prepare("SELECT name, type, \"notnull\", dflt_value, pk FROM pragma_table_info(?1)")
            .map_err(err)?;
        let columns = cols
            .query_map([&name], |r| {
                Ok(ColumnInfo {
                    name: r.get(0)?,
                    decl_type: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    not_null: r.get::<_, i64>(2)? != 0,
                    default: r.get(3)?,
                    pk: r.get::<_, i64>(4)? as u32,
                })
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            // A view over a table that no longer exists can't list its columns: show it without.
            .unwrap_or_default();
        tables.push(TableInfo { name, kind, sql, columns });
    }
    Ok(Schema { tables, read_only })
}

/// Largest integer a JavaScript number holds exactly; bigger ones are sent as text.
const JS_SAFE: i64 = (1 << 53) - 1;

fn to_json(v: ValueRef) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) if (-JS_SAFE..=JS_SAFE).contains(&i) => json!(i),
        ValueRef::Integer(i) => json!({ "int": i.to_string() }),
        ValueRef::Real(f) if f.is_finite() => json!(f),
        ValueRef::Real(f) => json!({ "int": f.to_string() }),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => {
            let hex: String = b.iter().take(32).map(|x| format!("{x:02x}")).collect();
            json!({ "blob": b.len(), "hex": hex })
        }
    }
}

/// Queries that are running, by the id the frontend gave them, so they can be stopped.
fn running() -> &'static Mutex<HashMap<String, InterruptHandle>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, InterruptHandle>>> = OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

/// Runs every statement in `sql`. Statements that return rows keep at most `max_rows` of them.
pub fn run(path: &str, sql: &str, max_rows: usize, run_id: &str) -> Res<RunResult> {
    let (conn, _) = open(path, false)?;
    running().lock().unwrap().insert(run_id.to_string(), conn.get_interrupt_handle());
    let start = Instant::now();
    let mut results = Vec::new();
    let error = run_batch(&conn, sql, max_rows, &mut results).err().map(|e| match e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::OperationInterrupted => {
            "Stopped.".to_string()
        }
        e => e.to_string(),
    });
    running().lock().unwrap().remove(run_id);
    Ok(RunResult { results, error, ms: start.elapsed().as_secs_f64() * 1000.0 })
}

fn run_batch(conn: &Connection, sql: &str, max_rows: usize, out: &mut Vec<StmtResult>) -> rusqlite::Result<()> {
    let mut batch = Batch::new(conn, sql);
    while let Some(mut stmt) = batch.next()? {
        let text = stmt.expanded_sql().unwrap_or_default();
        let before = conn.total_changes();
        if stmt.column_count() == 0 {
            stmt.raw_execute()?;
            out.push(StmtResult::Done { sql: text, changes: conn.total_changes() - before });
            continue;
        }
        let columns: Vec<String> = stmt.column_names().map(|s| s.to_string()).collect();
        let n = columns.len();
        let mut rows = Vec::new();
        let mut truncated = false;
        let mut q = stmt.raw_query();
        while let Some(row) = q.next()? {
            if rows.len() == max_rows {
                truncated = true;
                break;
            }
            rows.push((0..n).map(|i| row.get_ref(i).map(to_json)).collect::<rusqlite::Result<Vec<_>>>()?);
        }
        drop(q);
        out.push(StmtResult::Rows { sql: text, columns, rows, truncated, changes: conn.total_changes() - before });
    }
    Ok(())
}

/// Stops a running query (it ends with "Stopped."). Does nothing if it has finished.
pub fn interrupt(run_id: &str) {
    if let Some(h) = running().lock().unwrap().get(run_id) {
        h.interrupt();
    }
}

fn move_aside(path: &str) -> Res<()> {
    // The save dialog already asked whether to replace it; the old file goes to the Trash, not into the void.
    if Path::new(path).exists() {
        trash::delete(path).map_err(|e| format!("Could not move the existing {path} to the Trash: {e}"))?;
    }
    Ok(())
}

/// Creates an empty database (an existing file at `path` is moved to the Trash).
pub fn create(path: &str) -> Res<()> {
    move_aside(path)?;
    let (conn, _) = open(path, true)?;
    // SQLite only writes the file header with the first change; write it now so the file is a real database.
    conn.execute_batch("CREATE TABLE notepad_init(x); DROP TABLE notepad_init;").map_err(|e| e.to_string())
}

/// Save As: writes a compact copy of the database to `dest` (an existing file there is moved to the Trash).
pub fn copy(path: &str, dest: &str) -> Res<()> {
    if Path::new(path) == Path::new(dest) {
        return Ok(());
    }
    let (conn, _) = open(path, false)?;
    move_aside(dest)?;
    conn.execute("VACUUM INTO ?1", [dest]).map(|_| ()).map_err(|e| e.to_string())
}

/// True if the file starts like an SQLite database (or is empty and has a database extension: SQLite treats an
/// empty file as an empty database).
pub fn is_database(path: &str) -> bool {
    use std::io::Read;
    let mut head = [0u8; 16];
    let Ok(mut f) = std::fs::File::open(path) else { return false };
    match f.read(&mut head) {
        Ok(16) => &head == MAGIC,
        Ok(0) => {
            let ext = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
            matches!(ext.as_str(), "sqlite" | "sqlite3" | "db3" | "s3db" | "sl3")
        }
        _ => false,
    }
}

// ---------------------------------------------------------------- Tauri commands

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn db_probe(path: String) -> bool {
    is_database(&path)
}

#[tauri::command]
pub async fn db_schema(path: String) -> Res<Schema> {
    blocking(move || schema(&path)).await
}

#[tauri::command]
pub async fn db_run(path: String, sql: String, max_rows: usize, run_id: String) -> Res<RunResult> {
    blocking(move || run(&path, &sql, max_rows, &run_id)).await
}

#[tauri::command]
pub fn db_interrupt(run_id: String) {
    interrupt(&run_id)
}

#[tauri::command]
pub async fn db_create(path: String) -> Res<()> {
    blocking(move || create(&path)).await
}

#[tauri::command]
pub async fn db_copy(path: String, dest: String) -> Res<()> {
    blocking(move || copy(&path, &dest)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.sqlite").to_string_lossy().into_owned();
        create(&path).unwrap();
        (dir, path)
    }

    #[test]
    fn create_writes_a_real_database() {
        let (_d, path) = db();
        assert!(is_database(&path));
        assert!(schema(&path).unwrap().tables.is_empty());
    }

    #[test]
    fn runs_statements_and_reads_the_schema() {
        let (_d, path) = db();
        let r = run(
            &path,
            "CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score REAL DEFAULT 0, pic BLOB);
             INSERT INTO people (name, score, pic) VALUES ('Ada', 9.5, x'0102'), ('Bob', NULL, NULL);
             SELECT * FROM people ORDER BY id; -- trailing comment",
            1000,
            "t1",
        )
        .unwrap();
        assert!(r.error.is_none(), "{:?}", r.error);
        assert_eq!(r.results.len(), 3);
        match &r.results[1] {
            StmtResult::Done { changes, .. } => assert_eq!(*changes, 2),
            other => panic!("{other:?}"),
        }
        match &r.results[2] {
            StmtResult::Rows { columns, rows, truncated, .. } => {
                assert_eq!(columns, &["id", "name", "score", "pic"]);
                assert_eq!(rows.len(), 2);
                assert!(!truncated);
                assert_eq!(rows[0][1], json!("Ada"));
                assert_eq!(rows[0][3], json!({ "blob": 2, "hex": "0102" }));
                assert_eq!(rows[1][2], Value::Null);
            }
            other => panic!("{other:?}"),
        }
        let s = schema(&path).unwrap();
        assert_eq!(s.tables.len(), 1);
        let t = &s.tables[0];
        assert_eq!((t.name.as_str(), t.kind.as_str()), ("people", "table"));
        assert_eq!(t.columns[0].pk, 1);
        assert!(t.columns[1].not_null);
        assert_eq!(t.columns[2].default.as_deref(), Some("0"));
    }

    #[test]
    fn stops_at_the_first_error_and_keeps_earlier_results() {
        let (_d, path) = db();
        let r = run(&path, "CREATE TABLE a(x); INSERT INTO a VALUES (1); SELEC oops; INSERT INTO a VALUES (2);", 10, "t2").unwrap();
        assert_eq!(r.results.len(), 2);
        assert!(r.error.unwrap().contains("syntax error"));
        let r = run(&path, "SELECT count(*) FROM a", 10, "t3").unwrap();
        match &r.results[0] {
            StmtResult::Rows { rows, .. } => assert_eq!(rows[0][0], json!(1)),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn limits_rows_and_sends_big_integers_as_text() {
        let (_d, path) = db();
        let r = run(
            &path,
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 50) SELECT i, 9007199254740993 FROM n",
            10,
            "t4",
        )
        .unwrap();
        match &r.results[0] {
            StmtResult::Rows { rows, truncated, .. } => {
                assert_eq!(rows.len(), 10);
                assert!(truncated);
                assert_eq!(rows[0][1], json!({ "int": "9007199254740993" }));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn copy_makes_a_working_database() {
        let (d, path) = db();
        run(&path, "CREATE TABLE t(x); INSERT INTO t VALUES ('hi');", 10, "t5").unwrap();
        let dest = d.path().join("copy.db").to_string_lossy().into_owned();
        copy(&path, &dest).unwrap();
        assert!(is_database(&dest));
        assert_eq!(schema(&dest).unwrap().tables[0].name, "t");
    }

    #[test]
    fn text_files_are_not_databases() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("notes.db");
        std::fs::write(&p, "not a database at all").unwrap();
        assert!(!is_database(&p.to_string_lossy()));
        let empty = d.path().join("empty.sqlite");
        std::fs::write(&empty, "").unwrap();
        assert!(is_database(&empty.to_string_lossy()));
    }
}
