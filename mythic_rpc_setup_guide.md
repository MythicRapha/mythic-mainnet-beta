# Mythic L2 — RPC Node Setup Guide
### Azure Standard_L48as_v4 | 48 vCPU AMD EPYC | 384 GB RAM | 5.76 TB NVMe
---

## PHASE 0 — Azure VM Creation Settings (Complete These First)

### Basics Tab
| Field | Value |
|---|---|
| VM Name | `mythic-rpc` |
| Region | `East US 2` |
| Availability Zone | Zone 1 |
| Image | **Ubuntu Server 22.04 LTS — x64 Gen2** |
| Security Type | **Standard** (NOT Trusted Launch — causes performance overhead with Solana) |
| Size | `Standard_L48as_v4` (48 vCPU, 384 GB RAM) |
| Authentication | SSH public key — **Ed25519** format (more secure than RSA) |
| Username | `azureuser` |
| Key Pair Name | `mythic-rpc_key` |
| Public Inbound Ports | **None** (you will configure NSG rules manually below) |

> ⚠️ **CRITICAL**: Change Security Type from "Trusted Launch" to **Standard**. Trusted Launch adds vTPM/Secure Boot overhead that conflicts with Solana's hugepages and NVMe performance.

### Disks Tab
| Field | Value |
|---|---|
| OS Disk Size | **128 GB** (Premium SSD P10 or P15) |
| OS Disk Type | **Premium SSD LRS** |
| NVMe | ✅ **Enable NVMe** (this unlocks the 3x 1.92 TB local NVMe drives) |
| Encryption | Platform-managed key (default) |

> The L48as_v4 comes with **3x 1.92 TB local NVMe disks** — these are your ledger/accounts drives. Do NOT use managed disks for the ledger. NVMe must be explicitly enabled in the Disks tab.

### Networking Tab
| Field | Value |
|---|---|
| Virtual Network | Create new: `mythic-vnet` |
| Subnet | `mythic-subnet` (10.0.0.0/24) |
| Public IP | Create new: `mythic-rpc-ip` (Standard SKU, Static) |
| NIC Security Group | **Advanced** |
| Configure NSG | Create new: `mythic-rpc-nsg` |

**NSG Inbound Rules to create:**
| Priority | Name | Port | Protocol | Source | Action |
|---|---|---|---|---|---|
| 100 | SSH | 22 | TCP | **Your IP only** | Allow |
| 200 | Solana-Gossip | 8000-8020 | TCP+UDP | Any | Allow |
| 300 | Solana-RPC | 8899 | TCP | **Your IP + L2 nodes** | Allow |
| 400 | Solana-RPC-WS | 8900 | TCP | **Your IP + L2 nodes** | Allow |
| 500 | Solana-TPU | 8003-8004 | UDP | Any | Allow |
| 600 | Solana-Repair | 8010-8020 | TCP+UDP | Any | Allow |
| 4096 | DenyAll | * | * | Any | Deny |

> ⚠️ **NEVER expose port 8899 (RPC) to 0.0.0.0/0 on mainnet.** This invites DoS attacks and free RPC abuse. Lock it to your L2 bridge node IPs and your own IP only.

### Management Tab
| Field | Value |
|---|---|
| Auto-shutdown | Disabled |
| Backup | Disabled (ledger is re-syncable, not worth cost) |
| Boot diagnostics | **Enable with managed storage** (useful for crash debugging) |

### Monitoring Tab
| Field | Value |
|---|---|
| Alerts | Enable basic CPU/disk alerts |
| Diagnostics | Enable guest-level diagnostics |

### Advanced Tab
| Field | Value |
|---|---|
| Custom data / Cloud-init | Leave blank (we will configure post-deploy via SSH) |
| Proximity placement group | Optional — useful if you deploy the A100 AI server later (co-locate them in same group for low latency) |

---

## PHASE 1 — First SSH In: Pre-Flight Checks

```bash
ssh -i ~/.ssh/mythic-rpc_key.pem azureuser@<YOUR_PUBLIC_IP>

# Check NVMe drives are visible
lsblk
# You should see: nvme0n1, nvme1n1, nvme2n1 (~1.76 TB each)

# Check CPU + RAM
lscpu | grep -E "Model name|CPU\(s\)|Thread|NUMA"
free -h

# Check OS
uname -r
cat /etc/os-release
```

---

## PHASE 2 — NVMe RAID 0 Array (Do This Before Everything Else)

Solana's ledger is extremely I/O intensive. RAID 0 across 3x NVMe doubles effective throughput.

```bash
# Install mdadm
sudo apt-get update && sudo apt-get install -y mdadm

# Create RAID 0 across all 3 NVMe drives
# ⚠️ Replace nvme0n1/nvme1n1/nvme2n1 with actual device names from lsblk
sudo mdadm --create /dev/md0 \
  --level=0 \
  --raid-devices=3 \
  /dev/nvme0n1 /dev/nvme1n1 /dev/nvme2n1

# Format with XFS (optimal for Solana's RocksDB)
sudo mkfs.xfs -f /dev/md0

# Create mount point and mount
sudo mkdir -p /mnt/ledger
sudo mount /dev/md0 /mnt/ledger

# Make persistent across reboots
sudo mdadm --detail --scan >> /etc/mdadm/mdadm.conf
echo '/dev/md0 /mnt/ledger xfs defaults,noatime,nodiratime,logbufs=8,logbsize=256k,largeio,inode64,swalloc 0 0' | sudo tee -a /etc/fstab

# Create subdirectories
sudo mkdir -p /mnt/ledger/{ledger,accounts,snapshots}
sudo chown -R sol:sol /mnt/ledger
```

**Expected result:** ~5.5 TB of fast NVMe stripe, ~6–8 GB/s sequential throughput.

---

## PHASE 3 — OS Hardening & Performance Tuning

### 3a. Create a dedicated solana user

```bash
sudo useradd -m -s /bin/bash sol
sudo mkdir -p /home/sol/.ssh
sudo cp ~/.ssh/authorized_keys /home/sol/.ssh/
sudo chown -R sol:sol /home/sol/.ssh
sudo chmod 700 /home/sol/.ssh
```

### 3b. SSH Hardening

```bash
sudo nano /etc/ssh/sshd_config
```

Set these values:
```
Port 22
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AllowUsers azureuser sol
MaxAuthTries 3
LoginGraceTime 20
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
AllowTcpForwarding no
```

```bash
sudo systemctl restart sshd
```

### 3c. Firewall (UFW)

```bash
sudo apt-get install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <YOUR_IP>/32 to any port 22 proto tcp
sudo ufw allow 8000:8020/tcp
sudo ufw allow 8000:8020/udp
sudo ufw allow from <YOUR_L2_BRIDGE_IP>/32 to any port 8899 proto tcp
sudo ufw allow from <YOUR_L2_BRIDGE_IP>/32 to any port 8900 proto tcp
sudo ufw enable
```

### 3d. System Limits

```bash
sudo tee /etc/security/limits.d/90-solana.conf << 'EOF'
sol soft nofile 1000000
sol hard nofile 1000000
sol soft nproc 500000
sol hard nproc 500000
* soft memlock unlimited
* hard memlock unlimited
EOF
```

### 3e. Kernel Sysctl Tuning (Critical for Solana Performance)

```bash
sudo tee /etc/sysctl.d/99-solana.conf << 'EOF'
# Network buffers — Solana sends/receives massive UDP bursts
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.core.rmem_default = 134217728
net.core.wmem_default = 134217728
net.core.optmem_max = 134217728
net.core.netdev_max_backlog = 1000000
net.ipv4.udp_rmem_min = 8192
net.ipv4.udp_wmem_min = 8192

# TCP tuning
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728

# File descriptors
fs.nr_open = 1000000
fs.file-max = 1000000

# VM / memory
vm.swappiness = 1
vm.dirty_ratio = 40
vm.dirty_background_ratio = 10

# Hugepages — critical for Solana accounts DB in RAM
# 300 GB RAM for accounts = ~153,600 x 2MB hugepages
vm.nr_hugepages = 153600
vm.hugetlb_shm_group = 1001

# IPC / shared memory
kernel.shmmax = 322122547200
kernel.shmall = 78643200

# Reduce latency spikes
kernel.numa_balancing = 0
kernel.sched_migration_cost_ns = 5000000
kernel.sched_autogroup_enabled = 0
EOF

sudo sysctl -p /etc/sysctl.d/99-solana.conf
```

### 3f. CPU Governor — Set to Performance Mode

```bash
sudo apt-get install -y cpufrequtils
echo 'GOVERNOR="performance"' | sudo tee /etc/default/cpufrequtils
sudo cpufreq-set -g performance -r

# Make persistent
sudo tee /etc/rc.local << 'EOF'
#!/bin/bash
for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
    echo performance > $cpu
done
exit 0
EOF
sudo chmod +x /etc/rc.local
```

### 3g. Disable Transparent Hugepages (Interferes with explicit hugepages)

```bash
sudo tee /etc/systemd/system/disable-thp.service << 'EOF'
[Unit]
Description=Disable Transparent Huge Pages
DefaultDependencies=no
After=sysinit.target local-fs.target
Before=basic.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'echo never > /sys/kernel/mm/transparent_hugepage/enabled'
ExecStart=/bin/sh -c 'echo never > /sys/kernel/mm/transparent_hugepage/defrag'

[Install]
WantedBy=basic.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable disable-thp
sudo systemctl start disable-thp
```

### 3h. Install System Packages

```bash
sudo apt-get update && sudo apt-get install -y \
  curl wget git build-essential pkg-config libssl-dev \
  libudev-dev libclang-dev libprotobuf-dev protobuf-compiler \
  libsasl2-dev libzstd-dev libsnappy-dev \
  htop iotop sysstat net-tools jq bc \
  fail2ban unattended-upgrades logwatch \
  nvme-cli smartmontools mdadm xfsprogs
```

---

## PHASE 4 — Install Solana CLI + Agave Validator

```bash
# Install as sol user
sudo su - sol

# Install Solana (use latest stable)
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Add to PATH
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Verify
solana --version
agave-validator --version
```

### Generate Keypairs

```bash
# Identity keypair (public — used for gossip)
solana-keygen new -o ~/identity.json

# Vote account keypair (keep VERY secure)
solana-keygen new -o ~/vote-account.json

# Backup both keypairs OFF the server immediately
# scp azureuser@<IP>:~/identity.json ./backup/
```

---

## PHASE 5 — Solana Validator Startup Script (Production-Grade)

Save this as `/home/sol/start-validator.sh`:

```bash
#!/bin/bash
set -e

# ============================================================
# Mythic L2 — Solana RPC Node Startup Script
# Server: Standard_L48as_v4 | 48 vCPU | 384 GB | NVMe RAID 0
# ============================================================

LEDGER_DIR="/mnt/ledger/ledger"
ACCOUNTS_DIR="/mnt/ledger/accounts"
SNAPSHOT_DIR="/mnt/ledger/snapshots"
LOG_FILE="/home/sol/solana-validator.log"

# Raise file descriptor limit for this session
ulimit -n 1000000

exec agave-validator \
  \
  # ── Identity & Keys ──────────────────────────────────────
  --identity /home/sol/identity.json \
  \
  # ── Network Entry Points (Mainnet-Beta) ──────────────────
  --entrypoint entrypoint.mainnet-beta.solana.com:8001 \
  --entrypoint entrypoint2.mainnet-beta.solana.com:8001 \
  --entrypoint entrypoint3.mainnet-beta.solana.com:8001 \
  --entrypoint entrypoint4.mainnet-beta.solana.com:8001 \
  --entrypoint entrypoint5.mainnet-beta.solana.com:8001 \
  \
  # ── Known Validators (trust anchors) ─────────────────────
  # These are established mainnet validators — prevents connecting to malicious forks
  --known-validator 7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2 \
  --known-validator GdnSyH3YtwcxFvQrVVJMm1JhTS4QVX7MFsX56uJLUfiZ \
  --known-validator DE1bawNcRJB9rVm3buyMVfr8mBEoyyu73NBovf2oXJsJ \
  --known-validator CakcnaRDHka2gXyfbEd2d3xsvkJkqsLw2akB3zsN1D2S \
  --only-known-rpc \
  \
  # ── Genesis ──────────────────────────────────────────────
  --expected-genesis-hash 5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d \
  \
  # ── Storage Paths ────────────────────────────────────────
  --ledger $LEDGER_DIR \
  --accounts $ACCOUNTS_DIR \
  --snapshots $SNAPSHOT_DIR \
  \
  # ── Ledger Size ──────────────────────────────────────────
  # 500M slots = ~2 days of history, uses ~2-3 TB of ledger space
  # Reduce to 200000000 if disk space is a concern
  --limit-ledger-size 500000000 \
  \
  # ── RPC Configuration ────────────────────────────────────
  --rpc-port 8899 \
  --rpc-bind-address 0.0.0.0 \
  --full-rpc-api \
  --no-voting \
  --enable-rpc-transaction-history \
  --enable-cpi-and-log-storage \
  --enable-extended-tx-metadata-storage \
  \
  # ── RPC Rate Limiting (DoS Protection) ───────────────────
  --rpc-threads 32 \
  --rpc-nicehash-only \
  \
  # ── WebSocket ────────────────────────────────────────────
  --rpc-pubsub-enable-block-subscription \
  --rpc-pubsub-max-connections 1000 \
  --rpc-pubsub-max-fragment-size 2097152 \
  --rpc-pubsub-max-in-buffer-capacity 100000 \
  --rpc-pubsub-max-out-buffer-capacity 100000 \
  --rpc-pubsub-queue-capacity-items 10000000 \
  \
  # ── Account Index (accelerates RPC queries) ──────────────
  --account-index program-id \
  --account-index spl-token-owner \
  --account-index spl-token-mint \
  \
  # ── Memory / Accounts DB ─────────────────────────────────
  # Use 280 GB of RAM for accounts (leaves 100 GB for OS + validator overhead)
  --accounts-db-cache-limit-mb 286720 \
  \
  # ── Snapshots ────────────────────────────────────────────
  --snapshot-interval-slots 500 \
  --maximum-snapshots-to-retain 2 \
  --maximum-incremental-snapshots-to-retain 4 \
  --minimal-snapshot-download-speed 104857600 \
  \
  # ── Performance Flags ────────────────────────────────────
  --tpu-disable-quic \
  --no-port-check \
  \
  # ── Gossip ───────────────────────────────────────────────
  --gossip-port 8001 \
  --gossip-host <YOUR_PUBLIC_IP> \
  \
  # ── Dynamic Port Range ───────────────────────────────────
  --dynamic-port-range 8002-8020 \
  \
  # ── WAL Recovery ─────────────────────────────────────────
  --wal-recovery-mode skip_any_corrupted_record \
  \
  # ── Health Check ─────────────────────────────────────────
  --health-check-slot-distance 150 \
  \
  # ── Logging ──────────────────────────────────────────────
  --log $LOG_FILE \
  2>&1
```

```bash
chmod +x /home/sol/start-validator.sh
```

---

## PHASE 6 — Systemd Service (Auto-restart on crash)

```bash
sudo tee /etc/systemd/system/solana-validator.service << 'EOF'
[Unit]
Description=Mythic L2 Solana RPC Node
After=network.target
Wants=network.target

[Service]
Type=simple
User=sol
Group=sol
WorkingDirectory=/home/sol
ExecStart=/home/sol/start-validator.sh
Restart=on-failure
RestartSec=30s
LimitNOFILE=1000000
LimitNPROC=500000
LimitMEMLOCK=infinity
Environment=RUST_LOG=warn
Environment=RUST_BACKTRACE=1

# Protect from accidental kills
KillSignal=SIGTERM
TimeoutStopSec=300

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable solana-validator
sudo systemctl start solana-validator
```

---

## PHASE 7 — Monitoring & Health Checks

### Watch sync progress

```bash
# Watch live catch-up progress
watch -n 5 'solana catchup --our-localhost'

# Monitor logs
tail -f /home/sol/solana-validator.log | grep -v "INFO\|DEBUG"

# Check RPC health
curl -s http://localhost:8899/health

# Check slot
curl -s -X POST http://localhost:8899 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' | jq
```

### Disk Usage Monitor Script

```bash
sudo tee /usr/local/bin/mythic-monitor.sh << 'EOF'
#!/bin/bash
echo "=== Mythic RPC Node Status ==="
echo "Time: $(date)"
echo ""
echo "--- SYNC STATUS ---"
solana catchup --our-localhost 2>/dev/null || echo "Not yet synced"
echo ""
echo "--- DISK ---"
df -h /mnt/ledger
echo ""
echo "--- MEMORY ---"
free -h
echo ""
echo "--- CPU (top 5 procs) ---"
ps aux --sort=-%cpu | head -6
echo ""
echo "--- VALIDATOR SERVICE ---"
systemctl status solana-validator --no-pager | head -5
EOF
chmod +x /usr/local/bin/mythic-monitor.sh
```

---

## PHASE 8 — Security Hardening (Post-Deploy)

### Install Fail2Ban

```bash
sudo tee /etc/fail2ban/jail.d/sshd.conf << 'EOF'
[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
EOF

sudo systemctl enable fail2ban
sudo systemctl restart fail2ban
```

### Automatic Security Updates

```bash
sudo dpkg-reconfigure --priority=low unattended-upgrades
# Select: Yes to security updates only
```

### Lock down sudo

```bash
# Only azureuser gets sudo, sol user does NOT
# sol only runs the validator — no root access needed
sudo visudo  # Verify only azureuser is in sudoers
```

---

## PHASE 9 — L2 Infrastructure Setup Order

This is the **correct order** to build the full Mythic L2 stack:

```
Step 1: THIS SERVER  ← You are here
        Solana Mainnet RPC Node (reads + follows mainnet)
        Syncs fully (~24-48 hours first time)

Step 2: Deploy A100 AI Server (pending quota approval)
        Install CUDA, PyTorch, your AI inference stack
        Connect to RPC node via private Azure VNet (NOT public internet)

Step 3: Custom Solana L2 Program
        Write your L2 bridge program in Rust/Anchor
        Deploy on devnet first, test, then mainnet
        Bridge contract lives on MAINNET and talks to your RPC node

Step 4: Custom L2 Sequencer Node
        This is a modified Solana validator / custom runtime
        Runs on a SEPARATE VM (can use Standard_D16as_v4 to start)
        Handles your L2 chain state, block production

Step 5: L2 Bridge RPC Layer
        Custom RPC middleware (Node.js or Rust)
        Routes: L2 transactions → Sequencer
        Routes: Mainnet queries → Your RPC node
        Exposes unified endpoint to users

Step 6: Explorer + Indexer
        Block explorer for your L2 (fork of Solana Explorer)
        Transaction indexer (PostgreSQL + custom parser)

Step 7: Production Hardening
        Load balancer in front of RPC node
        Multiple RPC replicas (read replicas)
        Alerting + on-call
```

---

## Azure VM Settings Summary (Quick Reference)

| Setting | Value |
|---|---|
| Image | Ubuntu Server 22.04 LTS x64 Gen2 |
| Security Type | **Standard** (not Trusted Launch) |
| Size | Standard_L48as_v4 |
| NVMe | **Enabled** |
| OS Disk | 128 GB Premium SSD |
| Public IP | Static Standard SKU |
| NSG | Custom — SSH from your IP only, RPC locked to L2 nodes |
| Boot Diagnostics | Enabled |
| Auto-shutdown | Disabled |
| Backup | Disabled |

---

## Key Numbers to Know

| Resource | Allocation |
|---|---|
| NVMe RAID 0 total | ~5.5 TB |
| Ledger directory | ~2–3 TB |
| Accounts directory | ~500 GB–1 TB |
| Snapshots directory | ~200 GB |
| RAM for accounts DB | 280 GB |
| RAM reserved for OS+validator | ~104 GB |
| Hugepages | 153,600 x 2MB = 300 GB |
| RPC threads | 32 |
| Open file limit | 1,000,000 |
| Initial sync time | 24–72 hours |

---
*Generated for Mythic Labs LLC — mythiclabs.io*
