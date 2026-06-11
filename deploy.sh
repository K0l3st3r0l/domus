#!/bin/bash
# ============================================================
# Domus - Script de despliegue en producción
# ============================================================
set -e

echo "🏠 Desplegando Domus..."

# Verificar que existe .env
if [ ! -f .env ]; then
  echo "❌ Error: Falta el archivo .env"
  echo "   Copia .env.example a .env y rellena los valores."
  exit 1
fi

# Build y arranque
echo "📦 Construyendo imágenes..."
docker compose --env-file .env build

echo "🚀 Arrancando servicios..."
docker compose --env-file .env up -d

# Esperar a que la BD esté lista
echo "⏳ Esperando a la base de datos..."
sleep 8

# Ejecutar migraciones
echo "🗄️  Ejecutando migraciones..."
docker compose --env-file .env exec backend node migrations/run.js

echo ""
echo "✅ Domus desplegado correctamente!"
echo "   Frontend: http://localhost:3011"
echo "   Backend:  http://localhost:3010"
echo ""
echo "⚠️  Recuerda configurar Nginx Proxy Manager para:"
echo "   domus.tudominio.com -> localhost:3011"

# --- Auto-commit y push del repo domus ---
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M')

echo ""
echo "📤 Guardando cambios en git..."
if git -C "$SCRIPT_DIR" diff --quiet && git -C "$SCRIPT_DIR" diff --staged --quiet; then
    echo "⚠️  No hay cambios para commitear en domus."
else
    git -C "$SCRIPT_DIR" add -A
    git -C "$SCRIPT_DIR" commit -m "deploy: auto-commit ${TIMESTAMP}" || true
    if git -C "$SCRIPT_DIR" push origin main 2>&1; then
        echo "✓ Cambios pusheados a origin/main"
    else
        echo "⚠️  Push falló. Cambios commiteados localmente."
    fi
fi

# --- Auto-push de la wiki ---
echo ""
echo "📚 Verificando cambios en la wiki..."
bash /root/apps/wiki/wiki-push.sh "deploy: domus ${TIMESTAMP}"