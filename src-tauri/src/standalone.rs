#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! 独立的桌面外壳：只跑本地 Taskboard 服务，不依赖 Codex。
//! 关闭窗口即结束 node 子进程，并清掉 launcher-runtime.json，避免 taskctl 连到已退出的实例。

use std::{
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread::sleep,
    time::{Duration, Instant},
};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct ServerProcess(Mutex<Option<Child>>);

fn trace(message: &str) {
    use std::io::Write;
    let path = data_directory().join("standalone.log");
    let _ = std::fs::create_dir_all(data_directory());
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{message}");
    }
}

fn data_directory() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Codex Taskboard")
}

fn free_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .unwrap_or(47823)
}

fn node_binary() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_default()
        .join(if cfg!(target_os = "windows") {
            "node.exe"
        } else if cfg!(target_os = "linux") {
            "codex-taskboard-node"
        } else {
            "node"
        })
}

fn write_runtime_file(path: &Path, url: &str) -> std::io::Result<()> {
    let payload = format!("{{\"version\":1,\"url\":\"{url}\"}}");
    std::fs::write(path, payload)
}

pub fn run() {
    trace("start");
    tauri::Builder::default()
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            trace("setup enter");
            let resource_directory = app.path().resource_dir()?;
            trace(&format!("resource dir: {}", resource_directory.display()));
            let app_root = resource_directory.join("app");
            let data_directory = data_directory();
            std::fs::create_dir_all(&data_directory)?;
            let runtime_file = data_directory.join("launcher-runtime.json");

            let port = free_port();
            let token = uuid::Uuid::new_v4().to_string();
            let secret = uuid::Uuid::new_v4().to_string();

            let mut command = Command::new(node_binary());
            command
                .arg("server/index.mjs")
                .current_dir(&app_root)
                .env("CODEX_TASKBOARD_DATA_DIR", &data_directory)
                .env("CODEX_TASKBOARD_RUNTIME_FILE", &runtime_file)
                .env("CODEX_TASKBOARD_HOST", "127.0.0.1")
                .env("CODEX_TASKBOARD_PORT", port.to_string())
                .env("CODEX_TASKBOARD_INSTANCE_TOKEN", &token)
                .env("CODEX_TASKBOARD_INSTANCE_SECRET", &secret)
                .env("CODEX_TASKBOARD_VERSION", app.package_info().version.to_string())
                .current_dir(&app_root)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
            }

            let child = command.spawn().map_err(|error| {
                trace(&format!("spawn failed: {error}"));
                error
            })?;
            trace(&format!("server spawned pid {}", child.id()));
            *app.state::<ServerProcess>().0.lock().unwrap() = Some(child);

            let deadline = Instant::now() + Duration::from_secs(30);
            while TcpStream::connect(("127.0.0.1", port)).is_err() {
                if Instant::now() > deadline {
                    return Err("本地服务未能在 30 秒内启动".into());
                }
                sleep(Duration::from_millis(200));
            }

            trace("server listening");
            let url = format!("http://127.0.0.1:{port}/{token}/");
            write_runtime_file(&runtime_file, &url)?;

            let parsed = url.parse()?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
                .title("Codex Taskboard")
                .inner_size(1280.0, 860.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            trace("window created");

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the Taskboard shell")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<ServerProcess>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
                let _ = std::fs::remove_file(data_directory().join("launcher-runtime.json"));
            }
        });
}
