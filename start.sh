#!/bin/bash
# ARCADE3-WHEP start script
# Spins up virtual display + audio sink, then starts the Node server

set -e

export DISPLAY=:99

# ── Virtual display ────────────────────────────────────────────────────────────
echo "[start] launching Xvfb on :99"
Xvfb :99 -screen 0 1024x768x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
sleep 1

# ── PulseAudio virtual sink ────────────────────────────────────────────────────
# Railway containers run as root. We run PulseAudio WITHOUT --system mode,
# using PULSE_RUNTIME_PATH + auth-anonymous so ffmpeg can connect freely.
echo "[start] starting dbus"
mkdir -p /run/dbus
dbus-daemon --system --fork || true
sleep 1

echo "[start] starting PulseAudio"
# Run PulseAudio as a daemon. The --system flag causes permission issues
# with ffmpeg clients. Instead we use PULSE_RUNTIME_PATH to run in a
# location accessible to root, with auth disabled for local connections.
mkdir -p /var/run/pulse
PULSE_RUNTIME_PATH=/var/run/pulse \
  pulseaudio --daemonize=true \
             --exit-idle-time=-1 \
             --disallow-exit=true \
             --log-level=error \
             --system=false \
             --disallow-module-loading=false \
             -n --load="module-native-protocol-unix auth-anonymous=1 socket=/var/run/pulse/native" \
             --load="module-null-sink sink_name=virtual_speaker" \
             --load="module-null-sink" \
             2>/dev/null || true
sleep 2

# Set virtual_speaker as default sink
PULSE_RUNTIME_PATH=/var/run/pulse \
  pactl --server=unix:/var/run/pulse/native \
    set-default-sink virtual_speaker 2>/dev/null || true

echo "[start] Xvfb and PulseAudio ready"

# Export PULSE_SERVER so Node.js and all child processes (ffmpeg) find PulseAudio
export PULSE_SERVER="unix:/var/run/pulse/native"

# ── Node server ────────────────────────────────────────────────────────────────
echo "[start] starting ARCADE3-WHEP server"
exec node server-whep.js
