-- ============================================================================
-- Script: Índices para Optimización del Módulo de Reportes
-- Descripción: Mejora el performance de queries en el módulo de ventas/reportes
-- Fecha: 15 de febrero de 2026
-- Fase: 1 - Optimización de Performance
-- ============================================================================

-- IMPORTANTE: Ejecutar estos índices mejorará significativamente el performance
-- de las consultas de reportes, especialmente con grandes volúmenes de datos.

-- Índice para filtros por fecha
-- Mejora: Queries con WHERE fecha BETWEEN
CREATE INDEX IF NOT EXISTS idx_facturas_fecha 
ON facturas(fecha);

-- Índice compuesto para multitenancy + fecha
-- Mejora: Queries con WHERE restaurante_id = ? AND fecha BETWEEN
CREATE INDEX IF NOT EXISTS idx_facturas_restaurante_fecha 
ON facturas(restaurante_id, fecha);

-- Índice para joins con clientes
-- Mejora: JOIN facturas f ON f.cliente_id = c.id
CREATE INDEX IF NOT EXISTS idx_facturas_cliente 
ON facturas(cliente_id);

-- Índice para filtros por forma de pago
-- Mejora: WHERE forma_pago = ?
CREATE INDEX IF NOT EXISTS idx_facturas_forma_pago 
ON facturas(forma_pago);

-- Índice para análisis de productos
-- Mejora: Reportes de productos más vendidos
CREATE INDEX IF NOT EXISTS idx_detalle_factura_producto 
ON detalle_factura(producto_id);

-- Índice para joins de detalles
-- Mejora: JOIN detalle_factura d ON d.factura_id = f.id
CREATE INDEX IF NOT EXISTS idx_detalle_factura_factura 
ON detalle_factura(factura_id);

-- Índice para factura_pagos (si existe la tabla)
-- Mejora: Cálculo de totales por método de pago
CREATE INDEX IF NOT EXISTS idx_factura_pagos_factura 
ON factura_pagos(factura_id);

CREATE INDEX IF NOT EXISTS idx_factura_pagos_metodo 
ON factura_pagos(metodo);

-- ============================================================================
-- Verificación de Índices Creados
-- ============================================================================

-- Para verificar que los índices se crearon correctamente:
-- SHOW INDEX FROM facturas;
-- SHOW INDEX FROM detalle_factura;
-- SHOW INDEX FROM factura_pagos;

-- ============================================================================
-- Análisis de Performance (Opcional)
-- ============================================================================

-- Para analizar el plan de ejecución de una query:
-- EXPLAIN SELECT f.*, c.nombre as cliente_nombre
-- FROM facturas f
-- JOIN clientes c ON f.cliente_id = c.id
-- WHERE f.restaurante_id = 1
-- AND DATE(f.fecha) BETWEEN '2026-01-01' AND '2026-02-15'
-- ORDER BY f.fecha DESC
-- LIMIT 50;

-- ============================================================================
-- Notas de Mantenimiento
-- ============================================================================

-- Los índices ocupan espacio en disco pero mejoran dramáticamente el performance
-- de lectura. El trade-off es aceptable para un sistema de reportes.

-- Impacto estimado:
-- - Queries de reportes: 10-100x más rápidas
-- - Inserts/Updates: ~5-10% más lentos (aceptable)
-- - Espacio en disco: +10-20% (mínimo)

-- Recomendación: Ejecutar este script en producción durante horarios de bajo tráfico
