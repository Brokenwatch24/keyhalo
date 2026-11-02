//! MIDI ports (midir / WinMM): list, open by name, send raw messages, and forward input as
//! `midi-message` events. Device logic (Launchpad layouts, colours) lives in TypeScript.
//! Windows MIDI ports are exclusive: a port KeyHalo holds is busy for other apps (a DAW), so
//! the frontend closes it while those apps run.

use crate::util::{blocking, err, CmdResult};
use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

#[derive(Serialize)]
pub struct MidiPorts {
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
}

struct Port {
    input: Option<MidiInputConnection<()>>,
    output: Option<MidiOutputConnection>,
}

static PORTS: LazyLock<Mutex<HashMap<String, Port>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

const CLIENT: &str = "KeyHalo";

fn list() -> Result<MidiPorts, String> {
    let mi = MidiInput::new(CLIENT).map_err(err)?;
    let mo = MidiOutput::new(CLIENT).map_err(err)?;
    let inputs = mi.ports().iter().filter_map(|p| mi.port_name(p).ok()).collect();
    let outputs = mo.ports().iter().filter_map(|p| mo.port_name(p).ok()).collect();
    Ok(MidiPorts { inputs, outputs })
}

/// Opens the input and output ports named `name` (either may be missing). Re-opening an open
/// port is a no-op. Fails with "busy: …" when another app holds the device.
fn open(name: &str) -> Result<(), String> {
    let mut ports = PORTS.lock().unwrap();
    if ports.contains_key(name) {
        return Ok(());
    }
    let mut mi = MidiInput::new(CLIENT).map_err(err)?;
    mi.ignore(Ignore::ActiveSense);
    let mo = MidiOutput::new(CLIENT).map_err(err)?;
    let in_port = mi.ports().into_iter().find(|p| mi.port_name(p).ok().as_deref() == Some(name));
    let out_port = mo.ports().into_iter().find(|p| mo.port_name(p).ok().as_deref() == Some(name));
    if in_port.is_none() && out_port.is_none() {
        return Err(format!("MIDI device \"{name}\" not found"));
    }
    let id = name.to_string();
    let input = match in_port {
        Some(p) => Some(
            mi.connect(
                &p,
                "keyhalo-in",
                move |_ts, data, _| crate::util::emit("midi-message", json!({ "port": id, "data": data })),
                (),
            )
            .map_err(|e| format!("busy: {e}"))?,
        ),
        None => None,
    };
    let output = match out_port {
        Some(p) => Some(mo.connect(&p, "keyhalo-out").map_err(|e| format!("busy: {e}"))?),
        None => None,
    };
    ports.insert(name.to_string(), Port { input, output });
    Ok(())
}

fn close(name: &str) {
    if let Some(p) = PORTS.lock().unwrap().remove(name) {
        if let Some(i) = p.input {
            i.close();
        }
        if let Some(o) = p.output {
            o.close();
        }
    }
}

/// Sends a batch of short messages (each 1–3 bytes) or SysEx.
fn send(name: &str, messages: &[Vec<u8>]) -> Result<(), String> {
    let mut ports = PORTS.lock().unwrap();
    let out = ports
        .get_mut(name)
        .and_then(|p| p.output.as_mut())
        .ok_or_else(|| format!("MIDI port \"{name}\" is not open"))?;
    for m in messages {
        if let Err(e) = out.send(m) {
            drop(ports);
            // The device was unplugged or taken: forget it so the frontend can reopen.
            close(name);
            crate::util::emit("midi-closed", json!({ "port": name, "reason": e.to_string() }));
            return Err(err(e));
        }
    }
    Ok(())
}

/// Closes every port (app exit).
pub fn shutdown() {
    let names: Vec<String> = PORTS.lock().unwrap().keys().cloned().collect();
    for n in names {
        close(&n);
    }
}

#[tauri::command]
pub async fn midi_list() -> CmdResult<MidiPorts> {
    blocking(list).await
}

#[tauri::command]
pub async fn midi_open(name: String) -> CmdResult<()> {
    blocking(move || open(&name)).await
}

#[tauri::command]
pub async fn midi_close(name: String) -> CmdResult<()> {
    blocking(move || {
        close(&name);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn midi_send(name: String, messages: Vec<Vec<u8>>) -> CmdResult<()> {
    blocking(move || send(&name, &messages)).await
}

#[cfg(test)]
mod tests {
    /// Lists MIDI ports and opens/closes the first one: `cargo test --lib midi -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn lists_and_opens_ports() {
        let ports = super::list().expect("list");
        println!("{:?}", ports.inputs);
        println!("{:?}", ports.outputs);
        if let Some(name) = ports.inputs.first() {
            println!("open {name}: {:?}", super::open(name));
            println!("send reset: {:?}", super::send(name, &[vec![0xB0, 0, 0]]));
            super::close(name);
        }
    }
}
