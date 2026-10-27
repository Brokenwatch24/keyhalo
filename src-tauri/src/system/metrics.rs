//! CPU / RAM via sysinfo, NVIDIA GPU via NVML (loaded lazily; absent → `gpu: None`).

use nvml_wrapper::enum_wrappers::device::TemperatureSensor;
use nvml_wrapper::Nvml;
use serde::Serialize;
use std::sync::{LazyLock, Mutex, OnceLock};
use sysinfo::{Components, ProcessesToUpdate, System};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuMetrics {
    pub name: String,
    pub load: f64,
    pub temp: f64,
    pub vram_used_mb: f64,
    pub vram_total_mb: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMetrics {
    pub cpu_load: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_temp: Option<f64>,
    pub ram_used_mb: f64,
    pub ram_total_mb: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpu: Option<GpuMetrics>,
}

struct Sys {
    sys: System,
    components: Option<Components>,
}

static SYS: LazyLock<Mutex<Sys>> = LazyLock::new(|| {
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    let components = Components::new_with_refreshed_list();
    let components = if components.list().is_empty() {
        None
    } else {
        Some(components)
    };
    Mutex::new(Sys { sys, components })
});

static NVML: OnceLock<Option<Nvml>> = OnceLock::new();

fn nvml() -> Option<&'static Nvml> {
    NVML.get_or_init(|| Nvml::init().ok()).as_ref()
}

fn gpu() -> Option<GpuMetrics> {
    let nvml = nvml()?;
    let dev = nvml.device_by_index(0).ok()?;
    let mem = dev.memory_info().ok();
    Some(GpuMetrics {
        name: dev.name().unwrap_or_else(|_| "NVIDIA GPU".into()),
        load: dev.utilization_rates().map(|u| u.gpu as f64).unwrap_or(0.0),
        temp: dev
            .temperature(TemperatureSensor::Gpu)
            .map(|t| t as f64)
            .unwrap_or(0.0),
        vram_used_mb: mem
            .as_ref()
            .map(|m| m.used as f64 / 1048576.0)
            .unwrap_or(0.0),
        vram_total_mb: mem
            .as_ref()
            .map(|m| m.total as f64 / 1048576.0)
            .unwrap_or(0.0),
    })
}

pub fn metrics() -> SystemMetrics {
    let mut s = SYS.lock().unwrap_or_else(|e| e.into_inner());
    s.sys.refresh_cpu_usage();
    s.sys.refresh_memory();
    let cpu_temp = s.components.as_mut().and_then(|c| {
        c.refresh(false);
        let temps: Vec<f32> = c
            .list()
            .iter()
            .filter(|c| {
                let l = c.label().to_lowercase();
                l.contains("cpu")
                    || l.contains("package")
                    || l.contains("tctl")
                    || l.contains("core")
            })
            .filter_map(|c| c.temperature())
            .filter(|t| t.is_finite() && *t > 0.0)
            .collect();
        temps.into_iter().reduce(f32::max).map(|t| t as f64)
    });
    SystemMetrics {
        cpu_load: s.sys.global_cpu_usage() as f64,
        cpu_temp,
        ram_used_mb: s.sys.used_memory() as f64 / 1048576.0,
        ram_total_mb: s.sys.total_memory() as f64 / 1048576.0,
        gpu: gpu(),
    }
}

pub fn processes() -> Vec<String> {
    let mut s = SYS.lock().unwrap_or_else(|e| e.into_inner());
    s.sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut names: Vec<String> = s
        .sys
        .processes()
        .values()
        .map(|p| p.name().to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    names
}
