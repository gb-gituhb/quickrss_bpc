FROM node:18-slim

RUN apt-get update && apt-get install -y \
    chromium \
    xvfb \
    xauth \
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

WORKDIR /app
COPY package*.json ./
RUN npm install

RUN mkdir -p bpc_extension && \
    wget -O bpc.zip https://gitflic.ru/project/magnolia1234/bpc_uploads/blob/raw?file=bypass-paywalls-chrome-clean-master.zip && \
    unzip bpc.zip -d bpc_extension/ && \
    rm bpc.zip

COPY . .
EXPOSE 3000

CMD ["npm", "start"]
