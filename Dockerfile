FROM node:18-slim

# ===== INSTALL ONLY ESSENTIAL DEPENDENCIES =====
RUN apt-get update && apt-get install -y \
    chromium \
    xvfb \
    xauth \
    ca-certificates \
    fonts-liberation \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# ===== SET MEMORY-RELATED ENV VARS =====
# REMOVED: --expose-gc from NODE_OPTIONS (causes npm install to fail)
ENV NODE_OPTIONS="--max-old-space-size=384"
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/chromium

# ===== APP SETUP =====
WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./

# Install without NODE_OPTIONS interfering
RUN npm install --production && npm cache clean --force

# ===== DOWNLOAD BPC EXTENSION =====
RUN mkdir -p bpc_extension && \
    wget -q -O bpc.zip https://gitflic.ru/project/magnolia1234/bpc_uploads/blob/raw?file=bypass-paywalls-chrome-clean-master.zip && \
    unzip -q bpc.zip -d bpc_extension/ && \
    rm bpc.zip

# Copy source code
COPY . .

# ===== CREATE NON-ROOT USER =====
RUN groupadd -r appuser && useradd -r -g appuser appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

# ===== START WITH MEMORY OPTIMIZATIONS =====
# Pass --expose-gc directly to node command (not via NODE_OPTIONS)
CMD ["sh", "-c", "xvfb-run --auto-servernum --server-args=\"-screen 0 1024x768x24\" node --expose-gc --max-old-space-size=384 server.js"]
