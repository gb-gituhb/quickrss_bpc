FROM node:18-slim

# Install Chromium, dependencies, and SSL root certificates
RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    wget \
    unzip \
    --no-install-recommends \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download and extract the native BPC extension with SSL check bypassed
RUN wget --no-check-certificate https://gitlab.com/magnolia1234/bypass-paywalls-chrome-clean/-/archive/master/bypass-paywalls-chrome-clean-master.zip -O bpc.zip \
    && unzip bpc.zip -d bpc_extension \
    && rm bpc.zip

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
