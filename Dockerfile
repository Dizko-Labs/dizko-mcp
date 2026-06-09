FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY bin ./bin
COPY src ./src
COPY public ./public
COPY scripts ./scripts

ENV NODE_ENV=production
ENV EVENTCHAT_MCP_HOST=0.0.0.0
ENV EVENTCHAT_MCP_PORT=8787
ENV EVENTCHAT_PREFERENCES_PATH=/data/preferences.json

EXPOSE 8787
CMD ["node", "./bin/eventchat-events-http.js"]
