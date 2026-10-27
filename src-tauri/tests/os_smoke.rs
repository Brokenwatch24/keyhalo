//! Read-only checks against the real OS. Ignored by default (they depend on the machine):
//!   cargo test --test os_smoke -- --ignored --nocapture
//! Nothing here writes to devices or changes settings.

use keyhalo_lib::{hid, lamparray, system};

#[test]
#[ignore]
fn os_read_only() {
    let fg = system::foreground::foreground();
    println!("foreground: {fg:?}");
    let wins = system::foreground::windows();
    println!("windows: {} (first: {:?})", wins.len(), wins.first());
    let procs = system::metrics::processes();
    println!("processes: {}", procs.len());
    assert!(!procs.is_empty());
    let m = system::metrics::metrics();
    println!("metrics: {}", serde_json::to_string(&m).unwrap());
    println!("pointer: {:?}", system::pointer::get());
    #[cfg(windows)]
    println!("mic muted: {:?}", system::mic::get_muted());
    println!(
        "steam cs2: {:?}",
        system::steam::find_game("Counter-Strike Global Offensive")
    );

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let devs = hid::hid_enumerate(None).await.unwrap();
        println!("hid interfaces: {}", devs.len());
        if let Some(d) = devs.first() {
            println!("first hid: {}", serde_json::to_string(d).unwrap());
        }
        let lamps = lamparray::lamparray_list().await.unwrap();
        println!(
            "lamparrays: {}",
            lamps
                .iter()
                .map(|l| format!(
                    "{} ({}, {} lamps, {} with keys, {:.3}x{:.3} m)",
                    l.name,
                    l.kind,
                    l.lamp_count,
                    l.lamps.iter().filter(|x| x.virtual_keys.is_some()).count(),
                    l.width,
                    l.height
                ))
                .collect::<Vec<_>>()
                .join(", ")
        );
    });
}
