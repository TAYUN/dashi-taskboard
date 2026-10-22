# DeepSeek Harness plugin

This directory is an installable DeepSeek Harness bundle. It adds a Taskboard entry to the Harness sidebar and opens the active installed Codex Taskboard runtime.

From a DeepSeek Harness source checkout, install it into the Web profile:

```sh
pnpm dsh plugin --profile web add /absolute/path/to/codex-taskboard/integrations/deepseek-harness
```

Start Codex Taskboard before opening the entry. The plugin reads the launcher-owned runtime file, so it does not depend on a fixed port.

## Finding the running Taskboard

The plugin resolves endpoints in this order and embeds the first one whose `/api/projects` answers:

1. `CODEX_TASKBOARD_RUNTIME_FILE` (exact descriptor path)
2. `$CODEX_TASKBOARD_DATA_DIR/launcher-runtime.json`
3. the platform default descriptor: `~/Library/Application Support/Codex Taskboard/launcher-runtime.json` on macOS, `%APPDATA%\Codex Taskboard\launcher-runtime.json` on Windows, `$XDG_DATA_HOME/Codex Taskboard/launcher-runtime.json` on Linux
4. `CODEX_TASKBOARD_URL` (a full base URL)
5. the plain default `http://127.0.0.1:47823`

The plain default covers servers started from the source tree, such as `start-taskboard.bat`, which runs without an instance token and therefore writes no descriptor. Set `CODEX_TASKBOARD_URL` when such a server listens on another port or host.
