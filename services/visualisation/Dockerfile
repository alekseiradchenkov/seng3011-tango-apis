FROM node:20-alpine AS build

WORKDIR /usr/src/app/services/visualisation

COPY services/visualisation/package*.json ./
COPY services/visualisation/tsconfig.json ./
RUN npm install

COPY services/visualisation/src ./src
COPY shared ../../shared

RUN npm run tsc

FROM node:20-alpine AS runtime

WORKDIR /usr/src/app/services/visualisation

COPY --from=build /usr/src/app/services/visualisation/package*.json ./
RUN npm install --only=production

COPY --from=build /usr/src/app/services/visualisation/dist ./dist
COPY services/visualisation/swagger.yaml ./swagger.yaml

ENV PORT=3000

CMD ["node", "dist/server.js"]

