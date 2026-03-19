FROM node:20-alpine AS build

WORKDIR /usr/src/app/services/retrieval

COPY services/retrieval/package*.json ./
COPY services/retrieval/tsconfig.json ./
RUN npm install

COPY services/retrieval/src ./src
COPY shared ../../shared

RUN npm run tsc

FROM node:20-alpine AS runtime

WORKDIR /usr/src/app/services/retrieval

COPY --from=build /usr/src/app/services/retrieval/package*.json ./
RUN npm install --only=production

COPY --from=build /usr/src/app/services/retrieval/dist ./dist

ENV PORT=3000

CMD ["node", "dist/server.js"]

