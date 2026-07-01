# Security Policy

## Reporting a Vulnerability

Please report security issues through GitHub Security Advisories for this repository.

Do not include API keys, OAuth tokens, cookies, private screenshots, generated private images, or local application data in public issues.

## Local Data

This application stores model configuration, API keys, analysis history, generation tasks, and edit tasks in the local Electron user data directory on each Mac. These files are runtime data and should not be committed to the repository.

API keys and Codex OAuth tokens are intended to be used only in the Electron main process. The renderer should only receive status flags such as whether a key is configured.
