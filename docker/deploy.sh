#!/bin/bash

# Script de despliegue
# RestaurantPro

set -e

echo "=========================================="
echo "  Desplegando RestaurantPro"
echo "=========================================="
echo ""

# Detener contenedores
echo "Deteniendo contenedores..."
docker-compose down

# Construir imágenes
echo "Construyendo imágenes..."
docker-compose build --no-cache

# Iniciar contenedores
echo "Iniciando contenedores..."
docker-compose up -d

# Esperar MySQL
echo "Esperando MySQL..."
sleep 15

# Verificar estado
echo "Verificando estado..."
docker-compose ps

echo ""
echo "=========================================="
echo "  Despliegue completado"
echo "=========================================="
echo ""
