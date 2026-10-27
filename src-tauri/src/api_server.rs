//! Local REST + WebSocket API (127.0.0.1 only). See docs/LOCAL_API.md.

use crate::util::{emit, CmdResult};
use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, RwLock};
use std::time::Duration;
use tokio::sync::{broadcast, oneshot};
use tower_http::cors::CorsLayer;

pub const DEFAULT_PORT: u16 = 27463;

struct Shared {
    state: RwLock<String>,
    token: RwLock<String>,
    tx: broadcast::Sender<String>,
}

static SHARED: LazyLock<Shared> = LazyLock::new(|| Shared {
    state: RwLock::new("{}".into()),
    token: RwLock::new(String::new()),
    tx: broadcast::channel(64).0,
});

struct Running {
    port: u16,
    shutdown: oneshot::Sender<()>,
    task: tauri::async_runtime::JoinHandle<()>,
}

static SERVER: Mutex<Option<Running>> = Mutex::new(None);

type Q = Query<HashMap<String, String>>;

fn token() -> String {
    SHARED
        .token
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

fn authorized(headers: &HeaderMap, q: &HashMap<String, String>) -> bool {
    let t = token();
    if t.is_empty() {
        return true;
    }
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            v.strip_prefix("Bearer ")
                .or_else(|| v.strip_prefix("bearer "))
        })
        .map(|v| v.trim() == t)
        .unwrap_or(false);
    bearer || q.get("token").map(|v| *v == t).unwrap_or(false)
}

fn json_response(status: StatusCode, body: Value) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/json")],
        body.to_string(),
    )
        .into_response()
}

fn unauthorized() -> Response {
    json_response(
        StatusCode::UNAUTHORIZED,
        json!({ "ok": false, "error": "missing or invalid token" }),
    )
}

fn bad_request(msg: &str) -> Response {
    json_response(
        StatusCode::BAD_REQUEST,
        json!({ "ok": false, "error": msg }),
    )
}

async fn info() -> Response {
    json_response(
        StatusCode::OK,
        json!({ "name": "KeyHalo", "version": env!("CARGO_PKG_VERSION"), "api": "/api/v1" }),
    )
}

async fn status(headers: HeaderMap, Query(q): Q) -> Response {
    if !authorized(&headers, &q) {
        return unauthorized();
    }
    let state = SHARED
        .state
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        state,
    )
        .into_response()
}

async fn action(headers: HeaderMap, Query(q): Q, body: Bytes) -> Response {
    if !authorized(&headers, &q) {
        return unauthorized();
    }
    let v: Value = match serde_json::from_slice::<Value>(&body) {
        Ok(v) => v,
        Err(e) => return bad_request(&format!("invalid JSON: {e}")),
    };
    let Some(name) = v
        .get("action")
        .and_then(|a| a.as_str())
        .filter(|a| !a.is_empty())
    else {
        return bad_request("missing \"action\"");
    };
    let params = match v.get("params") {
        Some(p) if p.is_object() => p.clone(),
        _ => json!({}),
    };
    emit("api-action", json!({ "action": name, "params": params }));
    json_response(StatusCode::ACCEPTED, json!({ "ok": true, "action": name }))
}

async fn notify(headers: HeaderMap, Query(q): Q, body: Bytes) -> Response {
    if !authorized(&headers, &q) {
        return unauthorized();
    }
    let v: Value = match serde_json::from_slice::<Value>(&body) {
        Ok(v) if v.is_object() => v,
        Ok(_) => return bad_request("expected a JSON object"),
        Err(e) => return bad_request(&format!("invalid JSON: {e}")),
    };
    if v.get("text").and_then(|t| t.as_str()).is_none() {
        return bad_request("missing \"text\"");
    }
    emit("api-action", json!({ "action": "notify", "params": v }));
    json_response(StatusCode::ACCEPTED, json!({ "ok": true }))
}

/// CS2 / Dota 2 Game State Integration. The games send the token as `auth.token`.
async fn gsi(Path(game): Path<String>, headers: HeaderMap, Query(q): Q, body: Bytes) -> Response {
    if game != "cs2" && game != "dota2" {
        return json_response(
            StatusCode::NOT_FOUND,
            json!({ "ok": false, "error": "unknown game" }),
        );
    }
    let payload: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return bad_request(&format!("invalid JSON: {e}")),
    };
    let t = token();
    if !t.is_empty() {
        let in_payload =
            payload.pointer("/auth/token").and_then(|v| v.as_str()) == Some(t.as_str());
        if !in_payload && !authorized(&headers, &q) {
            return unauthorized();
        }
    }
    emit("gsi", json!({ "game": game, "payload": payload }));
    json_response(StatusCode::OK, json!({ "ok": true }))
}

async fn ws(headers: HeaderMap, Query(q): Q, upgrade: WebSocketUpgrade) -> Response {
    if !authorized(&headers, &q) {
        return unauthorized();
    }
    upgrade.on_upgrade(ws_session)
}

async fn ws_session(mut socket: WebSocket) {
    let mut rx = SHARED.tx.subscribe();
    let initial = SHARED
        .state
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    if socket.send(Message::Text(initial.into())).await.is_err() {
        return;
    }
    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Ok(state) => {
                    if socket.send(Message::Text(state.into())).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(Message::Ping(p))) => {
                    let _ = socket.send(Message::Pong(p)).await;
                }
                _ => {}
            },
        }
    }
}

fn router() -> Router {
    Router::new()
        .route("/", get(info))
        .route("/api/v1", get(info))
        .route("/api/v1/status", get(status))
        .route("/api/v1/action", post(action))
        .route("/api/v1/notify", post(notify))
        .route("/api/v1/ws", get(ws))
        .route("/gsi/{game}", post(gsi))
        .layer(CorsLayer::permissive())
}

async fn stop() {
    let running = SERVER.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(r) = running {
        let _ = r.shutdown.send(());
        // WebSocket sessions keep graceful shutdown waiting; don't wait for them.
        let _ = tokio::time::timeout(Duration::from_millis(500), r.task).await;
    }
}

async fn start(port: u16) -> Result<(), String> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("cannot listen on 127.0.0.1:{port}: {e}"))?;
    let (tx, rx) = oneshot::channel::<()>();
    let task = tauri::async_runtime::spawn(async move {
        let server = axum::serve(listener, router()).with_graceful_shutdown(async move {
            let _ = rx.await;
        });
        if let Err(e) = server.await {
            crate::khlog!("api: server stopped: {e}");
        }
    });
    *SERVER.lock().unwrap_or_else(|e| e.into_inner()) = Some(Running {
        port,
        shutdown: tx,
        task,
    });
    crate::khlog!("api: listening on http://127.0.0.1:{port}");
    Ok(())
}

#[tauri::command]
pub async fn api_configure(enabled: bool, port: u16, token: String) -> CmdResult<()> {
    *SHARED.token.write().unwrap_or_else(|e| e.into_inner()) = token.trim().to_string();
    let port = if port == 0 { DEFAULT_PORT } else { port };
    let current = SERVER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|r| r.port);
    if enabled && current == Some(port) {
        return Ok(()); // token changes apply immediately, no restart needed
    }
    stop().await;
    if enabled {
        start(port).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn api_set_state(state: Value) -> CmdResult<()> {
    let s = state.to_string();
    *SHARED.state.write().unwrap_or_else(|e| e.into_inner()) = s.clone();
    let _ = SHARED.tx.send(s);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn serve() -> String {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, router()).await;
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn routes_and_auth() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let base = serve().await;
        let c = reqwest::Client::new();
        api_set_state(json!({ "profile": "neon" })).await.unwrap();

        let r = c.get(format!("{base}/api/v1/status")).send().await.unwrap();
        assert_eq!(r.status(), 200);
        assert_eq!(r.text().await.unwrap(), r#"{"profile":"neon"}"#);

        let r = c
            .post(format!("{base}/api/v1/action"))
            .body(r#"{"action":"dpi","params":{"value":800}}"#)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 202);
        let r = c
            .post(format!("{base}/api/v1/action"))
            .body("{}")
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 400);
        let r = c
            .post(format!("{base}/api/v1/notify"))
            .body(r#"{"text":"hi"}"#)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 202);

        *SHARED.token.write().unwrap() = "s3cret".into();
        let r = c.get(format!("{base}/api/v1/status")).send().await.unwrap();
        assert_eq!(r.status(), 401);
        let r = c
            .get(format!("{base}/api/v1/status?token=s3cret"))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200);
        let r = c
            .get(format!("{base}/api/v1/status"))
            .bearer_auth("s3cret")
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200);
        let r = c
            .post(format!("{base}/gsi/cs2"))
            .body(r#"{"auth":{"token":"s3cret"},"round":{}}"#)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200);
        let r = c
            .post(format!("{base}/gsi/dota2"))
            .body(r#"{"auth":{"token":"nope"}}"#)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 401);
        let r = c
            .post(format!("{base}/gsi/lol"))
            .body("{}")
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 404);
        *SHARED.token.write().unwrap() = String::new();
    }
}
