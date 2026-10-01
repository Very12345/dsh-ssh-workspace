# DSH SSH Workspace

- Independent DSH 0.2 plugin. Linux/macOS SSH targets; host can be Windows, Linux or macOS.
- Preserve ordinary local workspaces, sandbox defaults, approvals and other plugins.
- Remote connections are explicit; no fallback to local execution after remote failure/removal.
- Do not commit SSH config, private keys, credentials, host addresses or user session data.
- Use system OpenSSH for alias resolution; never disable host-key verification.
- Keep released JavaScript in the package; no prepare/install/build scripts needed by Git URL installs.
- Run unit/SDK/UI tests and npm pack --dry-run. Use owned temporary remote directories for live writes.
