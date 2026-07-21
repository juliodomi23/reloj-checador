FROM node:22-alpine
RUN apk add --no-cache tzdata
ENV TZ=America/Mexico_City
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY . .
ENV DB_PATH=/data/checador.db
EXPOSE 3050
CMD ["node", "server.js"]
