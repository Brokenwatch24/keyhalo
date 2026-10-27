//! HTTP requests without browser CORS limits (GitHub OAuth, game client APIs, downloads).

use crate::util::{err, CmdResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    #[serde(default)]
    pub insecure: bool,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

fn client(insecure: bool) -> Result<&'static reqwest::Client, String> {
    static SECURE: OnceLock<reqwest::Client> = OnceLock::new();
    static INSECURE: OnceLock<reqwest::Client> = OnceLock::new();
    let cell = if insecure { &INSECURE } else { &SECURE };
    if let Some(c) = cell.get() {
        return Ok(c);
    }
    let mut b = reqwest::Client::builder()
        .user_agent(concat!("KeyHalo/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10));
    if insecure {
        // Only for localhost game APIs / printers with self-signed certificates.
        b = b.tls_danger_accept_invalid_certs(true);
    }
    let c = b.build().map_err(err)?;
    Ok(cell.get_or_init(|| c))
}

#[tauri::command]
pub async fn http_request(request: HttpRequest) -> CmdResult<HttpResponse> {
    let method =
        reqwest::Method::from_bytes(request.method.to_uppercase().as_bytes()).map_err(err)?;
    let mut rb = client(request.insecure)?
        .request(method, &request.url)
        .timeout(Duration::from_millis(
            request.timeout_ms.unwrap_or(30_000).max(1),
        ));
    for (k, v) in &request.headers {
        rb = rb.header(k, v);
    }
    if let Some(body) = request.body {
        rb = rb.body(body);
    }
    let resp = rb.send().await.map_err(|e| {
        // reqwest hides the root cause in the source chain.
        let mut msg = e.to_string();
        let mut src = std::error::Error::source(&e);
        while let Some(s) = src {
            msg.push_str(&format!(": {s}"));
            src = s.source();
        }
        msg
    })?;
    let status = resp.status().as_u16();
    let mut headers: HashMap<String, String> = HashMap::new();
    for (k, v) in resp.headers() {
        let v = String::from_utf8_lossy(v.as_bytes()).to_string();
        headers
            .entry(k.as_str().to_string())
            .and_modify(|e| {
                e.push_str(", ");
                e.push_str(&v)
            })
            .or_insert(v);
    }
    let bytes = resp.bytes().await.map_err(err)?;
    Ok(HttpResponse {
        status,
        headers,
        body: String::from_utf8_lossy(&bytes).to_string(),
    })
}
