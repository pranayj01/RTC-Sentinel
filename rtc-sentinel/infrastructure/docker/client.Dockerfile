FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_TURN_USERNAME
ARG VITE_TURN_CREDENTIAL
ENV VITE_TURN_USERNAME=$VITE_TURN_USERNAME VITE_TURN_CREDENTIAL=$VITE_TURN_CREDENTIAL
COPY package.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm install --workspace client
COPY client client
RUN npm run build --workspace client

FROM nginx:1.27-alpine
COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
