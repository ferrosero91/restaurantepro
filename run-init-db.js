#!/usr/bin/env node
require('dotenv').config();
const { initDatabase } = require('./init-db');

initDatabase()
  .then(success => {
    if (success) {
      console.log('✅ Inicialización completada exitosamente');
      process.exit(0);
    } else {
      console.log('⚠️ Inicialización completada con advertencias');
      process.exit(0);
    }
  })
  .catch(err => {
    console.error('❌ Error crítico:', err.message);
    process.exit(1);
  });
