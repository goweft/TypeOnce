# TypeOnce Server Deployment Guide
## Deploying TypeOnce alongside Weft

### 1. Server Directory Structure
```
/opt/
├── weft/                    # Your existing weft project
│   ├── ...
│   └── docker-compose.yml
│
└── typeonce/               # TypeOnce project (new)
    ├── cli/                # CLI tools
    ├── core/               # Expansion engine
    ├── packs/              # Snippet packs
    ├── server/             # HTTP API server
    ├── docker/             # Docker configs
    ├── data/               # Persistent data
    │   ├── packs/          # User packs
    │   ├── logs/           # Application logs
    │   └── config/         # Server config
    └── docker-compose.yml
```

### 2. Docker Compose Setup for TypeOnce

Create `/opt/typeonce/docker-compose.yml`:

```yaml
version: '3.8'

services:
  typeonce-api:
    build: 
      context: .
      dockerfile: docker/Dockerfile.api
    container_name: typeonce-api
    restart: unless-stopped
    ports:
      - "8090:8090"  # Different port from weft
    volumes:
      - ./data/packs:/app/packs
      - ./data/logs:/app/logs
      - ./data/config:/app/config
    environment:
      - NODE_ENV=production
      - API_PORT=8090
      - PACK_DIR=/app/packs
      - LOG_LEVEL=info
    networks:
      - typeonce-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.typeonce.rule=Host(`typeonce.yourdomain.com`)"
      - "traefik.http.services.typeonce.loadbalancer.server.port=8090"

  typeonce-sync:
    build:
      context: .
      dockerfile: docker/Dockerfile.sync
    container_name: typeonce-sync
    restart: unless-stopped
    volumes:
      - ./data/packs:/app/packs
      - ./data/config:/app/config
    environment:
      - SYNC_INTERVAL=300  # 5 minutes
      - GIT_REMOTE=${GIT_REMOTE}
      - GIT_BRANCH=main
    networks:
      - typeonce-network

networks:
  typeonce-network:
    driver: bridge
```

### 3. Dockerfile for API Server

Create `/opt/typeonce/docker/Dockerfile.api`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install Python for pack validation
RUN apk add --no-cache python3 py3-pip py3-yaml git

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY cli/ ./cli/
COPY core/ ./core/
COPY server/ ./server/
COPY packs/ ./packs/

# Create data directories
RUN mkdir -p /app/data/packs /app/data/logs /app/data/config

# Install Python dependencies for testing
COPY requirements.txt ./
RUN pip3 install -r requirements.txt --break-system-packages

EXPOSE 8090

CMD ["node", "server/index.js"]
```

### 4. Nginx Configuration

Create `/etc/nginx/sites-available/typeonce`:

```nginx
server {
    listen 80;
    server_name typeonce.yourdomain.com;
    
    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name typeonce.yourdomain.com;
    
    # SSL certificates (use Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/typeonce.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/typeonce.yourdomain.com/privkey.pem;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    # API proxy
    location /api/ {
        proxy_pass http://localhost:8090/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Pack registry (static files)
    location /packs/ {
        alias /opt/typeonce/data/packs/;
        autoindex on;
        autoindex_format json;
    }
    
    # Health check
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
```

### 5. Systemd Service (Alternative to Docker)

If you prefer systemd over Docker, create `/etc/systemd/system/typeonce.service`:

```ini
[Unit]
Description=TypeOnce Server
After=network.target

[Service]
Type=simple
User=typeonce
WorkingDirectory=/opt/typeonce
ExecStart=/usr/bin/node /opt/typeonce/server/index.js
Restart=always
RestartSec=10
StandardOutput=append:/opt/typeonce/data/logs/server.log
StandardError=append:/opt/typeonce/data/logs/error.log

Environment="NODE_ENV=production"
Environment="API_PORT=8090"
Environment="PACK_DIR=/opt/typeonce/data/packs"

[Install]
WantedBy=multi-user.target
```

### 6. Installation Script

Create `/opt/typeonce/scripts/install.sh`:

```bash
#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Installing TypeOnce Server...${NC}"

# Create typeonce user (if not exists)
if ! id "typeonce" &>/dev/null; then
    sudo useradd -r -s /bin/false typeonce
    echo -e "${GREEN}Created typeonce user${NC}"
fi

# Create directories
sudo mkdir -p /opt/typeonce/{data,packs,logs,config}
sudo mkdir -p /opt/typeonce/data/{packs,logs,config}

# Set permissions
sudo chown -R typeonce:typeonce /opt/typeonce
sudo chmod -R 755 /opt/typeonce

# Install dependencies
echo -e "${BLUE}Installing dependencies...${NC}"
cd /opt/typeonce
npm install --production

# Install Python requirements
pip3 install -r requirements.txt

# Copy default packs
cp -r packs/* data/packs/

# Setup systemd service
sudo cp scripts/typeonce.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable typeonce

echo -e "${GREEN}TypeOnce installed successfully!${NC}"
echo -e "Start with: ${BLUE}sudo systemctl start typeonce${NC}"
```

### 7. Environment Configuration

Create `/opt/typeonce/.env`:

```env
# Server Configuration
NODE_ENV=production
API_PORT=8090
HOST=0.0.0.0

# Paths
PACK_DIR=/opt/typeonce/data/packs
LOG_DIR=/opt/typeonce/data/logs
CONFIG_DIR=/opt/typeonce/data/config

# Git Sync (optional)
GIT_REMOTE=https://github.com/yourusername/typeonce-packs.git
GIT_BRANCH=main
SYNC_ENABLED=true
SYNC_INTERVAL=300

# Security
API_KEY=your-secret-api-key-here
CORS_ORIGIN=https://typeonce.yourdomain.com

# Features
ENABLE_PACK_UPLOAD=true
ENABLE_LLM_ACTIONS=false
ENABLE_HTTP_ACTIONS=true

# Logging
LOG_LEVEL=info
LOG_FORMAT=json
```

### 8. Pack Sync Script

Create `/opt/typeonce/scripts/sync-packs.sh`:

```bash
#!/bin/bash

PACK_DIR="/opt/typeonce/data/packs"
GIT_REMOTE="${GIT_REMOTE:-https://github.com/yourusername/typeonce-packs.git}"

# Pull latest packs from Git
if [ -d "$PACK_DIR/.git" ]; then
    cd $PACK_DIR
    git pull origin main
else
    cd $PACK_DIR
    git clone $GIT_REMOTE .
fi

# Validate all packs
python3 /opt/typeonce/tests/lint_snippets.py

# Restart service if packs changed
if [ $(git rev-parse HEAD) != $(git rev-parse HEAD@{1}) ]; then
    systemctl reload typeonce
fi
```

### 9. Monitoring Setup

Create `/opt/typeonce/scripts/health-check.sh`:

```bash
#!/bin/bash

# Check if TypeOnce API is responding
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8090/health)

if [ $response -eq 200 ]; then
    echo "TypeOnce is healthy"
    exit 0
else
    echo "TypeOnce is unhealthy (HTTP $response)"
    exit 1
fi
```

### 10. Deployment Commands

```bash
# Initial deployment
cd /opt
sudo git clone https://github.com/yourusername/typeonce.git
cd typeonce
sudo ./scripts/install.sh

# Start services
sudo docker-compose up -d  # If using Docker
# OR
sudo systemctl start typeonce  # If using systemd

# Enable SSL
sudo certbot --nginx -d typeonce.yourdomain.com

# Check status
sudo docker-compose ps  # Docker
sudo systemctl status typeonce  # Systemd

# View logs
sudo docker-compose logs -f typeonce-api  # Docker
sudo journalctl -u typeonce -f  # Systemd
```

### 11. Integration with Weft

If you need TypeOnce to communicate with Weft:

```yaml
# In docker-compose.yml, add external network
networks:
  typeonce-network:
    driver: bridge
  weft_default:
    external: true
```

Then services can communicate using container names.

### 12. Backup Strategy

Create `/opt/typeonce/scripts/backup.sh`:

```bash
#!/bin/bash

BACKUP_DIR="/backup/typeonce"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup packs and config
tar -czf $BACKUP_DIR/typeonce_$DATE.tar.gz \
    /opt/typeonce/data/packs \
    /opt/typeonce/data/config

# Keep only last 30 days of backups
find $BACKUP_DIR -name "typeonce_*.tar.gz" -mtime +30 -delete
```

### 13. Port Management

Ensure ports don't conflict with Weft:

| Service | Port | Purpose |
|---------|------|---------|
| Weft | 8080 | Your existing project |
| TypeOnce API | 8090 | REST API |
| TypeOnce Sync | N/A | Internal only |
| TypeOnce WebSocket | 8091 | Real-time updates (optional) |

### 14. Quick Start

```bash
# Clone and setup
cd /opt
sudo git clone <your-repo> typeonce
cd typeonce

# Using Docker (Recommended)
sudo docker-compose up -d

# OR using systemd
sudo ./scripts/install.sh
sudo systemctl start typeonce

# Verify
curl http://localhost:8090/health
```

### 15. Security Checklist

- [ ] Different user account (typeonce vs weft user)
- [ ] Separate data directories
- [ ] Different ports
- [ ] Separate SSL certificates
- [ ] API authentication enabled
- [ ] CORS configured correctly
- [ ] File permissions set (755 for dirs, 644 for files)
- [ ] Secrets in environment variables, not code
- [ ] Regular backups configured
- [ ] Log rotation enabled
