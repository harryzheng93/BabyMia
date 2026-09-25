FROM node:22.23.1-bookworm-slim
WORKDIR /app
COPY package.json server.mjs ./
COPY growth.mjs story-store.mjs ./
COPY public ./public
COPY reference ./reference
RUN mkdir -p /app/data
ENV PORT=8095 DATA_DIR=/app/data
EXPOSE 8095
CMD ["node", "server.mjs"]
