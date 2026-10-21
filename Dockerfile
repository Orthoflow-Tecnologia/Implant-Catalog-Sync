FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
LABEL org.opencontainers.image.source=https://github.com/Orthoflow-Tecnologia/Implant-Catalog-Sync
LABEL org.opencontainers.image.description="Sincronizador agendado de catálogos de implantes e enxertos"
LABEL org.opencontainers.image.licenses=UNLICENSED
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER app
CMD ["node", "dist/main.js"]
