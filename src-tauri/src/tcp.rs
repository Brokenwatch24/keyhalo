//! Plain TCP connections (OpenRGB SDK bridge). Connections are keyed by a uuid.

use crate::util::{blocking, err, CmdResult};
use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

struct Conn {
    stream: TcpStream,
    /// Bytes read by a recv that timed out, kept so the stream stays in sync.
    pending: Vec<u8>,
}

type ConnMap = HashMap<String, Arc<Mutex<Conn>>>;
static CONNS: LazyLock<Mutex<ConnMap>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn conn(id: &str) -> Result<Arc<Mutex<Conn>>, String> {
    CONNS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(id)
        .cloned()
        .ok_or_else(|| format!("unknown connection {id}"))
}

#[tauri::command]
pub async fn tcp_connect(host: String, port: u16) -> CmdResult<String> {
    blocking(move || {
        let addrs: Vec<_> = (host.as_str(), port)
            .to_socket_addrs()
            .map_err(err)?
            .collect();
        let mut last_err = String::from("no address");
        for addr in addrs {
            match TcpStream::connect_timeout(&addr, Duration::from_secs(5)) {
                Ok(stream) => {
                    let _ = stream.set_nodelay(true);
                    let id = uuid::Uuid::new_v4().to_string();
                    CONNS.lock().unwrap_or_else(|e| e.into_inner()).insert(
                        id.clone(),
                        Arc::new(Mutex::new(Conn {
                            stream,
                            pending: Vec::new(),
                        })),
                    );
                    return Ok(id);
                }
                Err(e) => last_err = e.to_string(),
            }
        }
        Err(format!("cannot connect to {host}:{port}: {last_err}"))
    })
    .await
}

#[tauri::command]
pub async fn tcp_send(id: String, data: Vec<u8>) -> CmdResult<()> {
    blocking(move || {
        let c = conn(&id)?;
        let mut c = c.lock().unwrap_or_else(|e| e.into_inner());
        c.stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .map_err(err)?;
        c.stream.write_all(&data).map_err(err)
    })
    .await
}

#[tauri::command]
pub async fn tcp_recv(id: String, length: usize, timeout_ms: u64) -> CmdResult<Vec<u8>> {
    blocking(move || {
        let c = conn(&id)?;
        let mut c = c.lock().unwrap_or_else(|e| e.into_inner());
        let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(1));
        let mut buf = std::mem::take(&mut c.pending);
        let mut chunk = vec![0u8; 64 * 1024];
        while buf.len() < length {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                c.pending = buf;
                return Err("timeout".into());
            }
            c.stream.set_read_timeout(Some(left)).map_err(err)?;
            let want = (length - buf.len()).min(chunk.len());
            match c.stream.read(&mut chunk[..want]) {
                Ok(0) => return Err("connection closed".into()),
                Ok(n) => buf.extend_from_slice(&chunk[..n]),
                Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                    c.pending = buf;
                    return Err("timeout".into());
                }
                Err(e) if e.kind() == ErrorKind::Interrupted => continue,
                Err(e) => return Err(e.to_string()),
            }
        }
        // Anything beyond `length` stays for the next call.
        if buf.len() > length {
            c.pending = buf.split_off(length);
        }
        Ok(buf)
    })
    .await
}

#[tauri::command]
pub async fn tcp_close(id: String) -> CmdResult<()> {
    if let Some(c) = CONNS.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
        let c = c.lock().unwrap_or_else(|e| e.into_inner());
        let _ = c.stream.shutdown(std::net::Shutdown::Both);
    }
    Ok(())
}
