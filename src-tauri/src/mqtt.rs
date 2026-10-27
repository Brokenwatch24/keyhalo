//! MQTT client connections (Home Assistant, Bambu Lab printers…). One event-loop task per
//! connection emits `mqtt-message` and `mqtt-status`; subscriptions are restored on reconnect.

use crate::util::{err, CmdResult};
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS, TlsConfiguration, Transport};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, SignatureScheme};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttConnectOptions {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub client_id: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    #[serde(default)]
    pub tls: bool,
    #[serde(default)]
    pub insecure: bool,
}

type Topics = Arc<Mutex<Vec<String>>>;

struct Conn {
    client: AsyncClient,
    topics: Topics,
    task: tauri::async_runtime::JoinHandle<()>,
}

static CONNS: LazyLock<Mutex<HashMap<String, Conn>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Accepts any server certificate (Bambu printers use self-signed certs). Signatures are
/// still checked so the TLS session itself is sound.
#[derive(Debug)]
pub struct InsecureVerifier(Arc<rustls::crypto::CryptoProvider>);

impl ServerCertVerifier for InsecureVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

fn tls_config(insecure: bool) -> Result<ClientConfig, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder = ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(err)?;
    if insecure {
        return Ok(builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(InsecureVerifier(provider)))
            .with_no_client_auth());
    }
    let mut roots = rustls::RootCertStore::empty();
    let native = rustls_native_certs::load_native_certs();
    for cert in native.certs {
        let _ = roots.add(cert);
    }
    Ok(builder.with_root_certificates(roots).with_no_client_auth())
}

fn status(id: &str, connected: bool, error: Option<String>) {
    let mut v = json!({ "id": id, "connected": connected });
    if let Some(e) = error {
        v["error"] = json!(e);
    }
    crate::util::emit("mqtt-status", v);
}

async fn stop(id: &str) {
    let old = CONNS.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
    if let Some(c) = old {
        let _ = tokio::time::timeout(Duration::from_millis(500), c.client.disconnect()).await;
        c.task.abort();
    }
}

#[tauri::command]
pub async fn mqtt_connect(options: MqttConnectOptions) -> CmdResult<()> {
    let o = options;
    stop(&o.id).await;
    let client_id = o
        .client_id
        .clone()
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| {
            format!(
                "keyhalo-{}",
                &uuid::Uuid::new_v4().simple().to_string()[..8]
            )
        });
    let mut opts = MqttOptions::new(client_id, o.host.clone(), o.port);
    opts.set_keep_alive(Duration::from_secs(30));
    opts.set_clean_session(true);
    // Bambu "pushall" reports are large.
    opts.set_max_packet_size(4 * 1024 * 1024, 1024 * 1024);
    if let Some(u) = o.username.clone().filter(|u| !u.is_empty()) {
        opts.set_credentials(u, o.password.clone().unwrap_or_default());
    }
    if o.tls {
        let cfg = tls_config(o.insecure)?;
        opts.set_transport(Transport::tls_with_config(TlsConfiguration::Rustls(
            Arc::new(cfg),
        )));
    }

    let (client, mut eventloop) = AsyncClient::new(opts, 64);
    let topics: Topics = Arc::new(Mutex::new(Vec::new()));
    let id = o.id.clone();
    let task_client = client.clone();
    let task_topics = topics.clone();
    let task = tauri::async_runtime::spawn(async move {
        let mut connected = false;
        loop {
            match eventloop.poll().await {
                Ok(Event::Incoming(Packet::ConnAck(_))) => {
                    connected = true;
                    status(&id, true, None);
                    let subs: Vec<String> = task_topics
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .clone();
                    for t in subs {
                        let _ = task_client.try_subscribe(t, QoS::AtMostOnce);
                    }
                }
                Ok(Event::Incoming(Packet::Publish(p))) => {
                    crate::util::emit(
                        "mqtt-message",
                        json!({ "id": id, "topic": p.topic, "payload": String::from_utf8_lossy(&p.payload) }),
                    );
                }
                Ok(Event::Incoming(Packet::Disconnect)) => {
                    connected = false;
                    status(&id, false, None);
                }
                Ok(_) => {}
                Err(e) => {
                    if connected {
                        connected = false;
                    }
                    status(&id, false, Some(e.to_string()));
                    // rumqttc reconnects on the next poll; back off meanwhile.
                    tokio::time::sleep(Duration::from_secs(3)).await;
                }
            }
        }
    });
    CONNS.lock().unwrap_or_else(|e| e.into_inner()).insert(
        o.id.clone(),
        Conn {
            client,
            topics,
            task,
        },
    );
    Ok(())
}

fn client(id: &str) -> Result<(AsyncClient, Topics), String> {
    CONNS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(id)
        .map(|c| (c.client.clone(), c.topics.clone()))
        .ok_or_else(|| format!("unknown MQTT connection {id}"))
}

#[tauri::command]
pub async fn mqtt_subscribe(id: String, topic: String) -> CmdResult<()> {
    let (client, topics) = client(&id)?;
    {
        let mut t = topics.lock().unwrap_or_else(|e| e.into_inner());
        if !t.contains(&topic) {
            t.push(topic.clone());
        }
    }
    client.subscribe(topic, QoS::AtMostOnce).await.map_err(err)
}

#[tauri::command]
pub async fn mqtt_publish(
    id: String,
    topic: String,
    payload: String,
    retain: Option<bool>,
) -> CmdResult<()> {
    let (client, _) = client(&id)?;
    client
        .publish(
            topic,
            QoS::AtMostOnce,
            retain.unwrap_or(false),
            payload.into_bytes(),
        )
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn mqtt_disconnect(id: String) -> CmdResult<()> {
    stop(&id).await;
    status(&id, false, None);
    Ok(())
}
