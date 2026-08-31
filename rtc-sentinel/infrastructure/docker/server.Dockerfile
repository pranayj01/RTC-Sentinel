FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY server/prisma server/prisma
RUN npm install --workspace server
COPY server server
RUN npm run prisma:generate --workspace server && npm run build --workspace server && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/prisma server/prisma
USER node
EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy --schema server/prisma/schema.prisma && node server/dist/index.js"]

