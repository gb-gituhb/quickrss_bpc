FROM node:18-slim

# Install latest Chromium and required dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxrandr2 \
    libxtst6 \
    xdg-utils \
    wget \
    unzip \
    git \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy application dependencies configuration first
COPY package*.json ./

# Install project node modules
RUN npm install

# Download and extract Bypass Paywalls Clean (BPC) extension into place
RUN mkdir -p bpc_extension && \
    wget -O bpc.zip https://github.com/bpc-clone/bypass-paywalls-chrome-clean/archive/refs/heads/master.zip && \
    unzip bpc.zip -d bpc_extension/ && \
    rm bpc.zip

# Copy the rest of the application source files
COPY . .

# Expose app port
EXPOSE 3000

# Start the application server
CMD ["node", "server.js"]
