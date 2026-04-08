#!/bin/bash
# ============================================================
# Domus - Entorno de desarrollo
# ============================================================
set -e

echo "🏠 Arrancando Domus en modo desarrollo..."

docker compose -f docker-compose.dev.yml up -d

echo "⏳ Esperando a la base de datos..."
sleep 8

echo "🗄️  Ejecutando migraciones..."
docker compose -f docker-compose.dev.yml exec backend node migrations/run.js

echo ""
echo "✅ Domus DEV listo!"
echo "   Frontend: http://localhost:3011"
echo "   Backend:  http://localhost:3010"
echo "   DB:       localhost:5433"