FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY bin ./bin
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Build the Claude Desktop one-click bundle, served at /download/uplayground-events.mcpb
RUN apk add --no-cache zip && node ./scripts/build-mcpb.mjs && apk del zip

ENV NODE_ENV=production
ENV EVENTCHAT_MCP_HOST=0.0.0.0
ENV EVENTCHAT_MCP_PORT=8787
ENV EVENTCHAT_PREFERENCES_PATH=/data/preferences.json

EXPOSE 8787
CMD ["node", "./bin/eventchat-events-http.js"]
