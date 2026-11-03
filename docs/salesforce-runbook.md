# Salesforce & Slack Agent Runbook

## Salesforce Org Details
- Test Org Domain: `orgfarm-80570c66ae-dev-ed.develop.my.salesforce.com`
- Headless 360 MCP Server: Enabled via External Client App (OAuth 2.0 PKCE + JWT access tokens).

## Common Troubleshooting
- **Error: `client_secret_basic authentication requires a client_secret`**:
  Ensure `client_secret` is omitted from `--static-oauth-client-info` so `mcp-remote` uses the `none` (public PKCE) authentication method.
- **Error: `INVALID_JWT_FORMAT` on Salesforce MCP**:
  Ensure "Issue JSON Web Token (JWT) based access tokens for named users" is checked in the External Client App OAuth security settings.
