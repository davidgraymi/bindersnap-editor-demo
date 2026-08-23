FROM node:22-alpine

WORKDIR /app

RUN npm install --no-package-lock --no-save @hocuspocus/server tsx yjs ws

COPY services/hocuspocus/server.ts /app/server.ts

ARG HOCUSPOCUS_PORT=1234
ENV HOCUSPOCUS_PORT=${HOCUSPOCUS_PORT}

EXPOSE ${HOCUSPOCUS_PORT}

CMD ["npx", "tsx", "server.ts"]
