#!/usr/bin/env bash
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
cd "/Users/dt/Guide/documentation-agent"
"/Users/dt/.nvm/versions/node/v24.12.0/bin/node" scripts/generate-icon.cjs 2>/dev/null || true
exec "/Users/dt/Guide/documentation-agent/node_modules/.bin/electron" . >> /tmp/docagent.log 2>&1
