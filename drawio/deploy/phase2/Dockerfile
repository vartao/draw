FROM node:22-alpine

WORKDIR /app

ENV HOST=0.0.0.0
ENV PORT=8080
ENV DRAWIO_WEBAPP_DIR=/app/webapp
ENV DRAWIO_DATA_DIR=/data

COPY company-server/ /app/company-server/
COPY src/main/webapp/ /app/webapp/

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/api/health').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "/app/company-server/server.js"]
