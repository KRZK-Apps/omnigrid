# @omnigrid/plugin-pro — stub instructions

This directory is a PUBLIC PLACEHOLDER inside the `omnigrid` repository. It exists only so consumers
can see that commercial Pro features exist and how they are licensed.

## Rules (non-negotiable)

- Do NOT implement or publish commercial plugin logic here.
- Commercial Pro plugins live in the PRIVATE `omnigrid-pro/` repository as `@omnigrid/plugin-pro`
  (license `SEE LICENSE IN LICENSE.PRO.md`). In the npm workspace this stub is excluded in favor of
  the private package.
- License model for Pro plugins: **offline, local cryptographic validation** — an Ed25519-signed
  license token verified with an embedded public key via Web Crypto (`crypto.subtle.verify`), no
  runtime network calls, fail-closed on invalid/missing keys (throw `OmniGridLicenseError`, the base
  grid keeps working). Details: root `AI_INSTRUCTIONS.md` §9.
- Never put license logic inside `omnigrid/core` or any MIT package in this repo.