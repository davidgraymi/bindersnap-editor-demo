FROM node:22-alpine

WORKDIR /app

RUN npm install --no-package-lock --no-save @hocuspocus/server tsx yjs ws

COPY dev/hocuspocus/server.ts /app/server.ts

EXPOSE 1234

CMD ["npx", "tsx", "server.ts"]
