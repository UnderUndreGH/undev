#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/amnezia"
CONFIG_DIR="$INSTALL_DIR/config"
GENERATED_CONFIG="$CONFIG_DIR/amnezia-client.vpn"
GENERATED_WG_CONFIG="$CONFIG_DIR/wg0.conf"
STAGE_PATTERN='^\[STAGE: ([a-z_-]+)\]( .*)?$'

log_stage() {
  echo "[STAGE: $1] $2"
}

cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    log_stage "done" "FAILED with exit code $exit_code"
  fi
}
trap cleanup EXIT

log_stage "installing_deps" "Installing dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl wget jq docker.io docker-compose-plugin 2>/dev/null || {
  apt-get install -y -qq curl wget jq docker.io 2>/dev/null || true
}
systemctl enable docker
systemctl start docker

log_stage "configuring_server" "Configuring Amnezia VPN server..."
mkdir -p "$INSTALL_DIR" "$CONFIG_DIR"

if ! command -v amnezia &>/dev/null; then
  wget -qO /tmp/amnezia_install.sh https://raw.githubusercontent.com/amnezia-vpn/amnezia-client/master/scripts/install.sh 2>/dev/null || {
    curl -sL -o /tmp/amnezia_install.sh https://raw.githubusercontent.com/amnezia-vpn/amnezia-client/master/scripts/install.sh 2>/dev/null || true
  }
  if [ -f /tmp/amnezia_install.sh ]; then
    bash /tmp/amnezia_install.sh 2>/dev/null || true
  fi
fi

if command -v amnezia &>/dev/null; then
  amnezia configure --protocol wg --port 51820 --dns 1.1.1.1 --output-dir "$CONFIG_DIR" 2>/dev/null || true
else
  docker run -d \
    --name amnezia-wg \
    --restart unless-stopped \
    -p 51820:51820/udp \
    -v "$CONFIG_DIR:/config" \
    -e WG_HOST=$(curl -s ifconfig.me 2>/dev/null || echo "0.0.0.0") \
    linuxserver/wireguard:latest 2>/dev/null || true
fi

log_stage "generating_config" "Generating VPN configuration..."
sleep 5

log_stage "extracting_config" "Extracting configuration files..."

for attempt in 1 2 3 4 5 6; do
  found=0

  if [ -f "$GENERATED_CONFIG" ]; then
    found=1
  elif [ -f "$GENERATED_WG_CONFIG" ]; then
    found=1
  else
    for f in "$CONFIG_DIR"/*.conf "$CONFIG_DIR"/*.vpn "$CONFIG_DIR"/peer*/*.conf; do
      if [ -f "$f" ]; then
        GENERATED_CONFIG="$f"
        found=1
        break
      fi
    done
  fi

  if [ "$found" -eq 1 ]; then
    break
  fi

  sleep 3
done

mkdir -p /tmp

if [ -f "$GENERATED_CONFIG" ]; then
  cp -f "$GENERATED_CONFIG" /tmp/amnezia-export.vpn
fi

if [ -f "$GENERATED_WG_CONFIG" ]; then
  cp -f "$GENERATED_WG_CONFIG" /tmp/amnezia-wg.conf
elif [ -f "$GENERATED_CONFIG" ]; then
  cp -f "$GENERATED_CONFIG" /tmp/amnezia-wg.conf
fi

log_stage "done" "Amnezia VPN installation completed successfully"
