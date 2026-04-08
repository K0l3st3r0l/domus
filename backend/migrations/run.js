require('dotenv').config({ path: '../.env.prod' });
const fs = require('fs');
const path = require('path');
const pool = require('../src/models/db');
const bcrypt = require('bcryptjs');

async function runMigrations() {
  console.log('Ejecutando migraciones...');
  const migrationsDir = path.join(__dirname);
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`Ejecutando: ${file}`);
    await pool.query(sql);
    console.log(`✓ ${file} completado`);
  }

  // Crear admin por defecto si no existe
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@domus.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'domus2024';
  const adminName = process.env.ADMIN_NAME || 'Admin';

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
  if (existing.rows.length === 0) {
    const hash = await bcrypt.hash(adminPassword, 10);
    await pool.query(
      'INSERT INTO users (email, name, password_hash, role, avatar) VALUES ($1, $2, $3, $4, $5)',
      [adminEmail, adminName, hash, 'admin', '👑']
    );
    console.log(`✓ Admin creado: ${adminEmail} / ${adminPassword}`);
    console.log('  ⚠️  Cambia la contraseña tras el primer login!');
  } else {
    console.log('  Admin ya existe, omitiendo.');
  }

  console.log('\n✅ Migraciones completadas.');
  process.exit(0);
}

runMigrations().catch(err => {
  console.error('Error en migraciones:', err);
  process.exit(1);
});
