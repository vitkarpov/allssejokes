FROM node:18.6.0
ENV NODE_ENV=production

WORKDIR /app
COPY ["package.json", "package-lock.json*", ".env", "./"]

RUN npm install --production

COPY . .

CMD [ "node", "index.js" ]