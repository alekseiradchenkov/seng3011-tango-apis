FROM node:20-alpine AS build

# Work inside the package directory to preserve relative import structure
WORKDIR /usr/src/app/services/collection

# Copy service manifest and tsconfig from monorepo root context
COPY services/collection/package*.json ./
COPY services/collection/tsconfig.json ./
RUN npm install

# Copy service source and shared library with the same relative layout as in the repo
COPY services/collection/src ./src
COPY shared ../../shared

# We intentionally skip tsc here; we'll run via ts-node in the runtime image

FROM node:20-alpine AS runtime

# Install shared runtime deps at monorepo root so code in /shared can resolve them
WORKDIR /usr/src/app
RUN npm init -y && npm install aws-jwt-verify express

WORKDIR /usr/src/app/services/collection

COPY --from=build /usr/src/app/services/collection/package*.json ./
# Install full dependencies so ts-node/typescript are available
RUN npm install

COPY --from=build /usr/src/app/services/collection/src ./src
COPY --from=build /usr/src/app/services/collection/../../shared ../../shared

# Copy swagger so v0.route.ts can load it
COPY services/collection/swagger.yaml ./swagger.yaml

ENV TS_NODE_TRANSPILE_ONLY=true
ENV TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}'
ENV PORT=3000

CMD ["npx", "ts-node", "-T", "src/server.ts"]

