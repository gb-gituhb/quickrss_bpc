FROM node:18-slim

# Install Chromium, dependencies, SSL certificates, and Git
RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    git \
    --no-install-recommends \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Clone the native BPC extension into the container
RUN git clone https://gitflic.ru/project/magnolia1234/bypass-paywalls-chrome-clean.git bpc_extension/bypass-paywalls-chrome-clean-master

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
