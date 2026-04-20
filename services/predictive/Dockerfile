FROM node:20-alpine AS build

WORKDIR /usr/src/app/services/predictive

COPY services/predictive/package*.json ./
COPY services/predictive/tsconfig.json ./
RUN npm install

COPY services/predictive/src ./src
COPY shared ../../shared

RUN npm run tsc

FROM node:20-alpine AS runtime

WORKDIR /usr/src/app/services/predictive

COPY --from=build /usr/src/app/services/predictive/package*.json ./
RUN npm install --only=production

COPY --from=build /usr/src/app/services/predictive/dist ./dist

ENV PORT=3000

CMD ["node", "dist/server.js"]

