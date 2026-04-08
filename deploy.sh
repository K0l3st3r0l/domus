#!/bin/bash
# ============================================================
# Domus - Script de despliegue en producción
# ============================================================
set -e

echo "🏠 Desplegando Domus..."

# Verificar que existe .env.prod
if [ ! -f .env.prod ]; then
  echo "❌ Error: Falta el archivo .env.prod"
  echo "   Copia .env.example a .env.prod y rellena los valores."
  exit 1
fi

# Build y arranque
echo "📦 Construyendo imágenes..."
docker compose --env-file .env.prod build

echo "🚀 Arrancando servicios..."
docker compose --env-file .env.prod up -d

# Esperar a que la BD esté lista
echo "⏳ Esperando a la base de datos..."
sleep 8

# Ejecutar migraciones
echo "🗄️  Ejecutando migraciones..."
docker compose --env-file .env.prod exec backend node migrations/run.js

echo ""
echo "✅ Domus desplegado correctamente!"
echo "   Frontend: http://localhost:3011"
echo "   Backend:  http://localhost:3010"
echo ""
echo "⚠️  Recuerda configurar Nginx Proxy Manager para:"
echo "   domus.tudominio.com -> localhost:3011"