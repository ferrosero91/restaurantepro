# Dockerfile para RestaurantPro - Optimizado para Producción
FROM node:20-alpine AS builder

# Instalar dependencias del sistema necesarias para compilación
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias (incluyendo devDependencies para build)
RUN npm ci

# Copiar código fuente
COPY . .

# Etapa de producción
FROM node:20-alpine

# Instalar solo dependencias runtime necesarias
RUN apk add --no-cache openssl

WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar solo dependencias de producción
RUN npm ci --only=production && npm cache clean --force

# Copiar código desde builder
COPY --from=builder /app .

# Crear directorios necesarios
RUN mkdir -p public/uploads logs && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app && \
    chmod -R 755 /app/public/uploads

# Cambiar a usuario no-root
USER nodejs

# Exponer puerto
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Comando de inicio
CMD ["node", "server.js"]
