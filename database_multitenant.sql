-- ===========================
-- SISTEMA MULTITENANT SAAS
-- Base de datos para múltiples restaurantes
-- ===========================

CREATE DATABASE IF NOT EXISTS restaurante_saas;
USE restaurante_saas;

-- ===========================
-- TABLAS GLOBALES (NO TENANT)
-- ===========================

-- Tabla de restaurantes/tenants
CREATE TABLE IF NOT EXISTS restaurantes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    direccion TEXT,
    telefono VARCHAR(20),
    nit VARCHAR(50),
    email VARCHAR(100),
    estado ENUM('activo', 'suspendido', 'inactivo') DEFAULT 'activo',
    plan ENUM('basico', 'profesional', 'empresarial') DEFAULT 'basico',
    fecha_vencimiento DATE NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_slug (slug),
    INDEX idx_estado (estado)
);

-- Tabla de usuarios (administradores de restaurantes y superadmin)
CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurante_id INT NULL,
    nombre VARCHAR(100) NOT NULL,
    nombres VARCHAR(100),
    apellidos VARCHAR(100),
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    rol ENUM('superadmin', 'admin', 'cajero', 'mesero', 'cocinero') DEFAULT 'admin',
    rol_id INT NULL,
    telefono VARCHAR(20),
    estado ENUM('activo', 'inactivo') DEFAULT 'activo',
    activo BOOLEAN DEFAULT TRUE,
    ultimo_acceso TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
    INDEX idx_email (email),
    INDEX idx_restaurante (restaurante_id),
    INDEX idx_rol (rol)
);

-- Tabla de roles (para sistema de permisos granular)
CREATE TABLE IF NOT EXISTS roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    descripcion TEXT,
    es_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tabla de permisos/módulos
CREATE TABLE IF NOT EXISTS permisos (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    descripcion TEXT,
    icono VARCHAR(50),
    ruta VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de relación roles-permisos
CREATE TABLE IF NOT EXISTS rol_permisos (
    id INT PRIMARY KEY AUTO_INCREMENT,
    rol_id INT NOT NULL,
    permiso_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permiso_id) REFERENCES permisos(id) ON DELETE CASCADE,
    UNIQUE KEY unique_rol_permiso (rol_id, permiso_id)
);

-- Tabla de permisos por usuario (permisos individuales)
CREATE TABLE IF NOT EXISTS usuario_permisos (
    id INT PRIMARY KEY AUTO_INCREMENT,
    usuario_id INT NOT NULL,
    permiso_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (permiso_id) REFERENCES permisos(id) ON DELETE CASCADE,
    UNIQUE KEY unique_usuario_permiso (usuario_id, permiso_id)
);

-- Tabla de sesiones
CREATE TABLE IF NOT EXISTS sesiones (
    id VARCHAR(255) PRIMARY KEY,
    usuario_id INT NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    INDEX idx_token (token),
    INDEX idx_expires (expires_at)
);

-- ===========================
-- TABLAS CON TENANT (restaurante_id)
-- ===========================

-- Categorías de productos por restaurante
CREATE TABLE IF NOT EXISTS categorias (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurante_id INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    orden INT DEFAULT 0,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
    INDEX idx_restaurante (restaurante_id),
    INDEX idx_activo (activo)
);

-- Productos por restaurante
CREATE TABLE IF NOT EXISTS productos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurante_id INT NOT NULL,
    codigo VARCHAR(50) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    categoria_id INT NULL,
    precio_kg DECIMAL(10,2) NOT NULL DEFAULT 0,
    precio_unidad DECIMAL(10,2) NOT NULL DEFAULT 0,
    precio_libra DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
    FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE SET NULL,
    UNIQUE KEY unique_codigo_restaurante (restaurante_id, codigo),
    INDEX idx_restaurante (restaurante_id),
    INDEX idx_codigo (codigo),
    INDEX idx_categoria (categoria_id)
);

-- Clientes por restaurante (con campos para facturación electrónica)
CREATE TABLE IF NOT EXISTS clientes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    restaurante_id INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    tipo_documento ENUM('CC', 'NIT', 'CE', 'Pasaporte', 'TI') DEFAULT 'CC',
    numero_documento VARCHAR(50),
    razon_social VARCHAR(200),
    tipo_persona ENUM('Natural', 'Juridica') DEFAULT 'Natural',
    direccion TEXT,
    ciudad VARCHAR(100),
    departamento VARCHAR(100),
    codigo_postal VARCHAR(20),
    telefono VARCHAR(20),
    email VARCHAR(100),
    regimen ENUM('Simplificado', 'Común', 'Gran Contribuyente', 'No Responsable') DEFAULT 'Simplificado',
    responsabilidad_fiscal VARCHAR(10) DEFAULT 'R-99-PN',
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
    INDEX idx_restaurante (restaurante_id),
    INDEX idx_nombre (nombre),
    INDEX idx_numero_documento (numero_documento),
    INDEX idx_tipo_documento (tipo_documento),
    INDEX idx_email (email),
    INDEX idx_activo (activo)
);

-- Facturas por restaurante
CREATE TABLE IF NOT EXISTS facturas (
    id INT PRIMARY KEY AUTO_INCREMENT,
    restaurante_id INT NOT NULL,
    cliente_id INT,
    usuario_id INT,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total DECIMAL(10,2) NOT NULL,
    forma_pago ENUM('efectivo', 'transferencia', 'tarjeta', 'mixto') NOT NULL DEFAULT 'efectivo',
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    INDEX idx_restaurante (restaurante_id),
    INDEX idx_fecha (fecha)
);

-- Pagos por factura
CREATE TABLE IF NOT EXISTS factura_pagos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    factura_id INT NOT NULL,
    metodo ENUM('efectivo', 'transferencia', 'tarjeta') NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    referencia VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (factura_id) REFERENCES facturas(id) ON DELETE CASCADE
);

-- Detalle de facturas
CREATE TABLE IF NOT EXISTS detalle_factura (
    id INT PRIMARY KEY AUTO_INCREMENT,
    factura_id INT,
    producto_id INT,
    cantidad DECIMAL(10,2) NOT NULL,
    precio_unitario DECIMAL(10,2) NOT NULL,
    unidad_medida ENUM('KG', 'UND', 'LB') DEFAULT 'KG',
    subtotal DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (factura_id) REFERENCES facturas(id) ON DELETE CASCADE,
    FOREIGN KEY (producto_id) REFERENCES productos(id)
);

-- Configuración de impresión por restaurante
CREATE TABLE IF NOT EXISTS configuracion_impresion (
    id INT PRIMARY KEY AUTO_INCREMENT,
    restaurante_id INT NOT NULL UNIQUE,
    nombre_negocio VARCHAR(100) NOT NULL,
    direccion TEXT,
    telefono VARCHAR(20),
    nit VARCHAR(50),
    pie_pagina TEXT,
    ancho_papel INT DEFAULT 80,
    font_size INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    logo_data LONGBLOB,
    logo_tipo VARCHAR(50),
    qr_data LONGBLOB,
    qr_tipo VARCHAR(50),
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
    INDEX idx_restaurante (restaurante_id)
);

-- Medios de pago por restaurante
CREATE TABLE IF NOT EXISTS medios_pago (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurante_id INT NOT NULL,
    nombre VARCHAR(50) NOT NULL,
    codigo VARCHAR(50) NOT NULL,
    descripcion TEXT NULL,
    activo BOOLEAN DEFAULT TRUE,
    orden INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
    UNIQUE KEY unique_codigo_restaurante (restaurante_id, codigo),
    INDEX idx_restaurante (restaurante_id),
    INDEX idx_activo (activo)
);

-- Mesas por restaurante
CREATE TABLE IF NOT EXISTS mesas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurante_id INT NOT NULL,
    numero VARCHAR(20) NOT NULL,
    descripcion VARCHAR(100),
    estado ENUM('libre', 'ocupada', 'reservada', 'bloqueada') DEFAULT 'libre',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
    UNIQUE KEY unique_numero_restaurante (restaurante_id, numero),
    INDEX idx_restaurante (restaurante_id)
);

-- Pedidos por restaurante
CREATE TABLE IF NOT EXISTS pedidos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurante_id INT NOT NULL,
    mesa_id INT NULL,
    cliente_id INT,
    usuario_id INT,
    estado ENUM('abierto', 'activo', 'en_cocina', 'preparando', 'listo', 'servido', 'cerrado', 'cancelado') DEFAULT 'abierto',
    total DECIMAL(10,2) NOT NULL DEFAULT 0,
    notas TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
    FOREIGN KEY (mesa_id) REFERENCES mesas(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    INDEX idx_restaurante (restaurante_id),
    INDEX idx_estado (estado)
);

-- Items de pedidos
CREATE TABLE IF NOT EXISTS pedido_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pedido_id INT NOT NULL,
    producto_id INT NOT NULL,
    cantidad DECIMAL(10,2) NOT NULL,
    unidad_medida ENUM('KG', 'UND', 'LB') DEFAULT 'UND',
    precio_unitario DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL,
    estado ENUM('pendiente', 'enviado', 'preparando', 'listo', 'servido', 'cancelado') DEFAULT 'pendiente',
    nota TEXT NULL,
    enviado_at TIMESTAMP NULL,
    preparado_at TIMESTAMP NULL,
    listo_at TIMESTAMP NULL,
    servido_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
    FOREIGN KEY (producto_id) REFERENCES productos(id)
);

-- Tabla de logs de auditoría
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurante_id INT NULL,
    usuario_id INT NULL,
    accion VARCHAR(100) NOT NULL,
    tabla VARCHAR(50) NOT NULL,
    registro_id INT NULL,
    datos_anteriores JSON NULL,
    datos_nuevos JSON NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL,
    INDEX idx_restaurante (restaurante_id),
    INDEX idx_usuario (usuario_id),
    INDEX idx_accion (accion),
    INDEX idx_tabla (tabla),
    INDEX idx_created (created_at)
);

-- Tabla de webhooks por restaurante
CREATE TABLE IF NOT EXISTS webhooks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurante_id INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    url VARCHAR(500) NOT NULL,
    eventos JSON NOT NULL,
    secreto VARCHAR(255) NOT NULL,
    estado ENUM('activo', 'inactivo') DEFAULT 'activo',
    reintentos INT DEFAULT 3,
    timeout INT DEFAULT 30,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
    INDEX idx_restaurante (restaurante_id),
    INDEX idx_estado (estado)
);

-- Tabla de logs de webhooks
CREATE TABLE IF NOT EXISTS webhook_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    webhook_id INT NOT NULL,
    evento VARCHAR(100) NOT NULL,
    payload JSON NOT NULL,
    respuesta_codigo INT NULL,
    respuesta_body TEXT NULL,
    intento INT DEFAULT 1,
    exitoso BOOLEAN DEFAULT FALSE,
    error TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE,
    INDEX idx_webhook (webhook_id),
    INDEX idx_evento (evento),
    INDEX idx_created (created_at)
);

-- Tabla de límites por plan
CREATE TABLE IF NOT EXISTS plan_limites (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plan ENUM('basico', 'profesional', 'empresarial') NOT NULL UNIQUE,
    max_usuarios INT NOT NULL DEFAULT 5,
    max_productos INT NOT NULL DEFAULT 100,
    max_mesas INT NOT NULL DEFAULT 10,
    max_facturas_mes INT NOT NULL DEFAULT 500,
    api_habilitada BOOLEAN DEFAULT FALSE,
    webhooks_habilitados BOOLEAN DEFAULT FALSE,
    soporte_prioritario BOOLEAN DEFAULT FALSE,
    reportes_avanzados BOOLEAN DEFAULT FALSE,
    precio_mensual DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tabla de uso por restaurante (para control de límites)
CREATE TABLE IF NOT EXISTS restaurante_uso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurante_id INT NOT NULL UNIQUE,
    usuarios_activos INT DEFAULT 0,
    productos_activos INT DEFAULT 0,
    mesas_activas INT DEFAULT 0,
    facturas_mes_actual INT DEFAULT 0,
    ultimo_reset_facturas DATE NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
    INDEX idx_restaurante (restaurante_id)
);

-- Tabla de tokens API por restaurante
CREATE TABLE IF NOT EXISTS api_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurante_id INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    permisos JSON NOT NULL,
    ultimo_uso TIMESTAMP NULL,
    expira_en DATE NULL,
    estado ENUM('activo', 'revocado', 'expirado') DEFAULT 'activo',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
    INDEX idx_token (token),
    INDEX idx_restaurante (restaurante_id),
    INDEX idx_estado (estado)
);

-- Tabla de facturación del sistema (para cobros a restaurantes)
CREATE TABLE IF NOT EXISTS sistema_facturas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurante_id INT NOT NULL,
    periodo_inicio DATE NOT NULL,
    periodo_fin DATE NOT NULL,
    plan ENUM('basico', 'profesional', 'empresarial') NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    estado ENUM('pendiente', 'pagada', 'vencida', 'cancelada') DEFAULT 'pendiente',
    fecha_vencimiento DATE NOT NULL,
    fecha_pago TIMESTAMP NULL,
    metodo_pago VARCHAR(50) NULL,
    referencia_pago VARCHAR(100) NULL,
    notas TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE,
    INDEX idx_restaurante (restaurante_id),
    INDEX idx_estado (estado),
    INDEX idx_vencimiento (fecha_vencimiento)
);

-- ===========================
-- DATOS INICIALES
-- ===========================

-- Insertar roles predeterminados
INSERT INTO roles (nombre, descripcion, es_admin) VALUES
('Administrador', 'Acceso completo a todos los módulos', TRUE),
('Cajero', 'Acceso a facturación y ventas', FALSE),
('Mesero', 'Acceso a mesas y pedidos', FALSE),
('Cocina', 'Acceso a módulo de cocina', FALSE),
('Gerente', 'Acceso a reportes y configuración', FALSE)
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- Insertar permisos/módulos
INSERT INTO permisos (nombre, descripcion, icono, ruta) VALUES
('Dashboard', 'Panel principal con estadísticas', 'bi-house-fill', '/'),
('Facturación', 'Crear y gestionar facturas', 'bi-receipt', '/'),
('Mesas', 'Gestión de mesas', 'bi-grid', '/mesas'),
('Cocina', 'Módulo de cocina', 'bi-egg-fried', '/cocina'),
('Reportes', 'Reportes, estadísticas e historial de ventas', 'bi-bar-chart-line', '/reportes'),
('Productos', 'Gestión de productos', 'bi-box', '/productos'),
('Clientes', 'Gestión de clientes', 'bi-people', '/clientes'),
('Configuración', 'Configuración del sistema', 'bi-gear', '/configuracion'),
('Usuarios', 'Gestión de usuarios', 'bi-person-badge', '/usuarios')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- Asignar todos los permisos al rol Administrador
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre = 'Administrador'
ON DUPLICATE KEY UPDATE rol_id = VALUES(rol_id);

-- Asignar permisos al rol Cajero
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre = 'Cajero' 
AND p.nombre IN ('Dashboard', 'Facturación', 'Reportes', 'Clientes')
ON DUPLICATE KEY UPDATE rol_id = VALUES(rol_id);

-- Asignar permisos al rol Mesero
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre = 'Mesero' 
AND p.nombre IN ('Dashboard', 'Facturación', 'Mesas', 'Clientes')
ON DUPLICATE KEY UPDATE rol_id = VALUES(rol_id);

-- Asignar permisos al rol Cocina
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre = 'Cocina' 
AND p.nombre IN ('Cocina')
ON DUPLICATE KEY UPDATE rol_id = VALUES(rol_id);

-- Asignar permisos al rol Gerente
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre = 'Gerente' 
AND p.nombre IN ('Dashboard', 'Reportes', 'Productos', 'Clientes', 'Configuración')
ON DUPLICATE KEY UPDATE rol_id = VALUES(rol_id);

-- Agregar foreign key de rol_id a usuarios (después de crear la tabla roles)
ALTER TABLE usuarios 
ADD CONSTRAINT fk_usuarios_rol_id 
FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE SET NULL;

-- Insertar límites por plan
INSERT INTO plan_limites (plan, max_usuarios, max_productos, max_mesas, max_facturas_mes, api_habilitada, webhooks_habilitados, soporte_prioritario, reportes_avanzados, precio_mensual) VALUES
('basico', 3, 50, 5, 200, FALSE, FALSE, FALSE, FALSE, 29.99),
('profesional', 10, 200, 20, 1000, TRUE, TRUE, FALSE, TRUE, 79.99),
('empresarial', 50, 1000, 100, 10000, TRUE, TRUE, TRUE, TRUE, 199.99)
ON DUPLICATE KEY UPDATE plan=plan;

-- Crear superadmin por defecto
-- Password: admin123 (debe cambiarse en producción)
INSERT INTO usuarios (restaurante_id, nombre, email, password, rol, rol_id, estado) 
VALUES (NULL, 'Super Administrador', 'admin@sistema.com', '$2b$10$rBV2KXZpN8qYqH0YvZ5Ziu.Xo8xGxGxGxGxGxGxGxGxGxGxGxGxGxO', 'superadmin', 1, 'activo')
ON DUPLICATE KEY UPDATE email=email;

-- Nota: El hash de password debe generarse con bcrypt
-- Este es un placeholder, se debe generar correctamente en la aplicación

-- ===========================
-- DATOS INICIALES: MEDIOS DE PAGO
-- ===========================
-- Nota: Estos medios de pago se crearán automáticamente para cada restaurante
-- al momento de su registro. Los restaurantes pueden agregar, editar o desactivar
-- medios de pago desde el módulo de Configuración.

-- Los medios de pago por defecto son:
-- 1. Efectivo (codigo: efectivo)
-- 2. Transferencia (codigo: transferencia)
-- 3. Tarjeta (codigo: tarjeta)
-- 4. Pago mixto (codigo: mixto) - se genera automáticamente cuando hay múltiples pagos

-- Estos se insertarán mediante trigger o en el proceso de registro del restaurante
