FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY extensions/checkout-lock/package.json extensions/checkout-lock/package.json
RUN npm ci --ignore-scripts
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
EXPOSE 3000
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/prisma ./prisma
CMD ["npm", "run", "docker-start"]
