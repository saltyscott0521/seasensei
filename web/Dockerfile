# Build the Vite app, then run the small Node server that serves it and /api/outlook.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npm run build

FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/*.mjs ./server/
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production PORT=80
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
CMD ["node", "server/server.mjs"]
