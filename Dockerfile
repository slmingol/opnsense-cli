FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN chmod +x /app/cli.js

ENTRYPOINT ["node", "/app/cli.js"]
