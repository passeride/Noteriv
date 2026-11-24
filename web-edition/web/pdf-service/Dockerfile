# Internal PDF renderer: headless Chromium behind a tiny HTTP endpoint. Kept out of the API image so
# Chromium's size and memory never affect the API. Build context: web/pdf-service/.
FROM node:22-alpine
WORKDIR /app

# Chromium plus fonts that cover Vietnamese (Noto/DejaVu) and metric-compatible Times/Georgia stand-ins (Liberation).
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates \
    font-noto font-liberation ttf-dejavu

COPY package.json ./
RUN npm install --omit=dev
COPY src ./src

ENV NODE_ENV=production \
    PDF_CHROME_PATH=/usr/bin/chromium-browser \
    PORT=4003
USER node
EXPOSE 4003
CMD ["node", "src/index.mjs"]
