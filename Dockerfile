FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma prisma
COPY tsconfig.json ./
COPY src src
RUN npm run build
ENV NODE_ENV=production
EXPOSE 4000
CMD ["sh", "-c", "npm run db:deploy && npm start"]
