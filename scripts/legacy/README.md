# Scripts obsoletos / legado

Estos scripts fueron reemplazados por el sistema de migraciones numeradas en
`scripts/migrations/files/` y se conservan aquí solo con fines históricos.
**No ejecutar** en instalaciones nuevas: las migraciones 001-014 ya aplican
los cambios que estos scripts hacían ad-hoc.

| Script | Reemplazado por |
|---|---|
| agregar_campo_activo_productos.js | migration 012 (ensure columns) |
| migrate_images_to_base64.js       | ensureSchema() en db.js + migration 001-014 |
| permitir_eliminar_productos.js    | FK ajustado por migrations de FacturaRepository |
| migrar_medios_pago.js             | migration 014 (factura_pagos & medios_pago) |

Si necesitas reaplicar uno de estos cambios, ejecuta en su lugar:

```bash
npm run migrate:up
```