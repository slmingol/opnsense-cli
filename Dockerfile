FROM node:24-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN chmod +x /app/cli.js

ENTRYPOINT ["node", "/app/cli.js"]
