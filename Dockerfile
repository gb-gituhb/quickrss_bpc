FROM node:20-slim

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
    wget \
    unzip \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

ENV NODE_OPTIONS="--max-old-space-size=384"
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN unset NODE_OPTIONS && npm install --production && npm cache clean --force

RUN mkdir -p bpc_extension && \
    wget -q -O bpc.zip https://gitflic.ru/project/magnolia1234/bpc_uploads/blob/raw?file=bypass-paywalls-chrome-clean-master.zip && \
    unzip -q bpc.zip -d bpc_extension/ && \
    rm bpc.zip

COPY . .

RUN groupadd -r appuser && useradd -r -g appuser appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

CMD ["sh", "-c", "xvfb-run --auto-servernum --server-args=\"-screen 0 1024x768x24\" node --expose-gc --max-old-space-size=384 server.js"]
