//! `keyhalo` — command-line client for KeyHalo's local API (http://127.0.0.1:27463).
//!
//! Port and token come from KEYHALO_PORT / KEYHALO_TOKEN. See docs/LOCAL_API.md.

use serde_json::{json, Value};
use std::process::ExitCode;
use std::time::Duration;

const DEFAULT_PORT: u16 = 27463;
const EX_USAGE: u8 = 64;

const HELP: &str = "\
keyhalo — control KeyHalo from the command line

USAGE:
    keyhalo <command> [args]

COMMANDS:
    status                              Print KeyHalo's current state (JSON)
    action <name> [json-params]         Send a raw action, e.g. keyhalo action effect '{\"id\":\"rain\"}'
    notify <text> [--color #hex] [--keys KeyA,KeyB]
                                        Show a notification (HUD + key flash)
    profile <id>                        Switch to a profile
    effect <id>                         Switch the lighting effect
    dpi <value>                         Set mouse DPI
    flash <keys|all> <#hex> [--times n] Flash keys (comma-separated KeyboardEvent.code names) or all
    claude <working|waiting|done|error|idle>
                                        Report Claude Code state (for Claude Code hooks)
    help, --help, -h                    Show this help
    --version, -V                       Show version

ENVIRONMENT:
    KEYHALO_PORT    Local API port (default 27463)
    KEYHALO_TOKEN   API token, if one is set in KeyHalo → Settings → Local API

EXIT CODES:
    0 ok · 1 KeyHalo unreachable or request failed · 64 usage error
    `keyhalo claude …` exits 0 silently when KeyHalo isn't running, so hooks never get in the way.
";

enum Failure {
    Usage(String),
    Unreachable(String),
    Request(String),
}

struct Client {
    agent: ureq::Agent,
    base: String,
    token: Option<String>,
}

impl Client {
    fn from_env() -> Result<Self, Failure> {
        let port = match std::env::var("KEYHALO_PORT") {
            Ok(p) if !p.trim().is_empty() => p
                .trim()
                .parse::<u16>()
                .map_err(|_| Failure::Usage(format!("KEYHALO_PORT is not a valid port: {p}")))?,
            _ => DEFAULT_PORT,
        };
        let token = std::env::var("KEYHALO_TOKEN")
            .ok()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty());
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(3)))
            .http_status_as_error(false)
            .build()
            .into();
        Ok(Client {
            agent,
            base: format!("http://127.0.0.1:{port}"),
            token,
        })
    }

    fn unreachable(&self, e: ureq::Error) -> Failure {
        Failure::Unreachable(format!(
            "KeyHalo is not reachable at {} ({e}).\nIs KeyHalo running with the local API enabled (Settings → Local API)?",
            self.base
        ))
    }

    fn finish(
        &self,
        resp: Result<ureq::http::Response<ureq::Body>, ureq::Error>,
    ) -> Result<String, Failure> {
        let mut resp = resp.map_err(|e| self.unreachable(e))?;
        let status = resp.status().as_u16();
        let body = resp.body_mut().read_to_string().unwrap_or_default();
        match status {
            200..=299 => Ok(body),
            401 => Err(Failure::Request("KeyHalo rejected the request: set KEYHALO_TOKEN to the API token shown in Settings → Local API.".into())),
            _ => Err(Failure::Request(format!("KeyHalo answered HTTP {status}: {body}"))),
        }
    }

    fn get(&self, path: &str) -> Result<String, Failure> {
        let mut req = self.agent.get(format!("{}{path}", self.base));
        if let Some(t) = &self.token {
            req = req.header("Authorization", format!("Bearer {t}"));
        }
        self.finish(req.call())
    }

    fn post(&self, path: &str, body: &Value) -> Result<String, Failure> {
        let mut req = self
            .agent
            .post(format!("{}{path}", self.base))
            .header("Content-Type", "application/json");
        if let Some(t) = &self.token {
            req = req.header("Authorization", format!("Bearer {t}"));
        }
        self.finish(req.send(body.to_string()))
    }

    fn action(&self, name: &str, params: Value) -> Result<String, Failure> {
        self.post(
            "/api/v1/action",
            &json!({ "action": name, "params": params }),
        )
    }
}

type Opts = Vec<(String, String)>;

/// Splits args into positionals and `--flag value` options.
fn parse_opts(args: &[String], known: &[&str]) -> Result<(Vec<String>, Opts), Failure> {
    let mut pos = Vec::new();
    let mut opts = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if let Some(name) = a.strip_prefix("--") {
            let (name, value) = match name.split_once('=') {
                Some((n, v)) => (n.to_string(), v.to_string()),
                None => {
                    i += 1;
                    let v = args
                        .get(i)
                        .ok_or_else(|| Failure::Usage(format!("--{name} needs a value")))?;
                    (name.to_string(), v.clone())
                }
            };
            if !known.contains(&name.as_str()) {
                return Err(Failure::Usage(format!("unknown option --{name}")));
            }
            opts.push((name, value));
        } else {
            pos.push(a.clone());
        }
        i += 1;
    }
    Ok((pos, opts))
}

fn opt<'a>(opts: &'a [(String, String)], name: &str) -> Option<&'a str> {
    opts.iter()
        .rev()
        .find(|(n, _)| n == name)
        .map(|(_, v)| v.as_str())
}

fn color(s: &str) -> Result<String, Failure> {
    let hex = s.trim_start_matches('#');
    if (hex.len() == 6 || hex.len() == 3) && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(format!("#{}", hex.to_lowercase()))
    } else {
        Err(Failure::Usage(format!(
            "not a hex colour: {s} (use e.g. #ff4d6d)"
        )))
    }
}

fn keys(s: &str) -> Vec<String> {
    s.split(',')
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .collect()
}

fn need<'a>(pos: &'a [String], i: usize, what: &str) -> Result<&'a str, Failure> {
    pos.get(i)
        .map(|s| s.as_str())
        .ok_or_else(|| Failure::Usage(format!("missing {what}")))
}

fn print_ok(body: &str) {
    if let Ok(v) = serde_json::from_str::<Value>(body) {
        if v.get("ok").and_then(|o| o.as_bool()) == Some(true) {
            return; // quiet on success
        }
    }
    if !body.trim().is_empty() {
        println!("{body}");
    }
}

fn run(args: &[String]) -> Result<(), Failure> {
    let Some(cmd) = args.first() else {
        print!("{HELP}");
        return Ok(());
    };
    let rest = &args[1..];
    match cmd.as_str() {
        "help" | "--help" | "-h" => {
            print!("{HELP}");
            Ok(())
        }
        "--version" | "-V" | "version" => {
            println!("keyhalo {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        "status" => {
            let body = Client::from_env()?.get("/api/v1/status")?;
            match serde_json::from_str::<Value>(&body) {
                Ok(v) => println!("{}", serde_json::to_string_pretty(&v).unwrap_or(body)),
                Err(_) => println!("{body}"),
            }
            Ok(())
        }
        "action" => {
            let (pos, _) = parse_opts(rest, &[])?;
            let name = need(&pos, 0, "action name")?;
            let params = match pos.get(1) {
                Some(p) => {
                    let v: Value = serde_json::from_str(p)
                        .map_err(|e| Failure::Usage(format!("params must be JSON: {e}")))?;
                    if !v.is_object() {
                        return Err(Failure::Usage("params must be a JSON object".into()));
                    }
                    v
                }
                None => json!({}),
            };
            print_ok(&Client::from_env()?.action(name, params)?);
            Ok(())
        }
        "notify" => {
            let (pos, opts) = parse_opts(rest, &["color", "keys"])?;
            if pos.is_empty() {
                return Err(Failure::Usage("missing notification text".into()));
            }
            let mut body = json!({ "text": pos.join(" ") });
            if let Some(c) = opt(&opts, "color") {
                body["color"] = json!(color(c)?);
            }
            if let Some(k) = opt(&opts, "keys") {
                body["keys"] = json!(keys(k));
            }
            print_ok(&Client::from_env()?.post("/api/v1/notify", &body)?);
            Ok(())
        }
        "profile" | "effect" => {
            let (pos, _) = parse_opts(rest, &[])?;
            let id = need(&pos, 0, &format!("{cmd} id"))?;
            print_ok(&Client::from_env()?.action(cmd, json!({ "id": id }))?);
            Ok(())
        }
        "dpi" => {
            let (pos, _) = parse_opts(rest, &[])?;
            let v = need(&pos, 0, "DPI value")?;
            let value: u32 = v
                .parse()
                .map_err(|_| Failure::Usage(format!("not a DPI value: {v}")))?;
            if !(50..=100_000).contains(&value) {
                return Err(Failure::Usage(format!("DPI out of range: {value}")));
            }
            print_ok(&Client::from_env()?.action("dpi", json!({ "value": value }))?);
            Ok(())
        }
        "flash" => {
            let (pos, opts) = parse_opts(rest, &["times"])?;
            let target = need(&pos, 0, "keys (comma-separated) or 'all'")?;
            let c = color(need(&pos, 1, "colour")?)?;
            let mut params = json!({ "color": c });
            if !target.eq_ignore_ascii_case("all") {
                params["keys"] = json!(keys(target));
            }
            if let Some(t) = opt(&opts, "times") {
                let n: u32 = t
                    .parse()
                    .map_err(|_| Failure::Usage(format!("--times must be a number: {t}")))?;
                params["times"] = json!(n.clamp(1, 50));
            }
            print_ok(&Client::from_env()?.action("flash", params)?);
            Ok(())
        }
        "claude" => {
            let (pos, _) = parse_opts(rest, &[])?;
            let state = need(&pos, 0, "state (working|waiting|done|error|idle)")?;
            if !["working", "waiting", "done", "error", "idle"].contains(&state) {
                return Err(Failure::Usage(format!("unknown Claude state: {state}")));
            }
            // Claude Code pipes hook JSON to stdin; we don't need it.
            match Client::from_env()?.action("claude", json!({ "state": state })) {
                Ok(_) | Err(Failure::Unreachable(_)) => Ok(()),
                Err(e) => Err(e),
            }
        }
        other => Err(Failure::Usage(format!("unknown command: {other}"))),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(Failure::Usage(m)) => {
            eprintln!("keyhalo: {m}\nRun `keyhalo --help` for usage.");
            ExitCode::from(EX_USAGE)
        }
        Err(Failure::Unreachable(m)) | Err(Failure::Request(m)) => {
            eprintln!("keyhalo: {m}");
            ExitCode::from(1)
        }
    }
}
