#!/bin/bash
# A stand-in for `claude -p` that speaks just enough stream-json for the runner.
# Echoes the mode it detected so tests can assert the permission flag got through.
MODE="unknown"; PREV=""
for a in "$@"; do [ "$PREV" = "--permission-mode" ] && MODE="$a"; PREV="$a"; done
echo '{"type":"system","subtype":"init","session_id":"stub-session-123"}'
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}'
sleep 0.1
echo "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Stub answer in $MODE mode.\"}]}}"
echo '{"type":"result","subtype":"success","num_turns":2,"total_cost_usd":0.01,"duration_ms":150,"result":"Stub answer in '"$MODE"' mode."}'
