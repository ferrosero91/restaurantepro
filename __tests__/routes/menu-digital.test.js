const request = require('supertest');
const express = require('express');
const db = require('../../db');
const SessionManager = require('../../services/SessionManager');
const OrderProcessorService = require('../../services/OrderProcessorService');

// Mock de base de datos
jest.mock('../../db');

// Mock del middleware de validación de QR
const mockValidateQRToken = jest.fn((req, res, next) => {
    req.qrValidation = {
        mesaId: 1,
        restauranteId: 1,
        mesa: { id: 1, numero: 'A1', estado: 'disponible' },
        restaurante: { id: 1, nombre: 'Test Restaurant', estado: 'activo' }
    };
    next();
});

const mockValidateProductTenant = jest.fn((req, res, next) => {
    next();
});

jest.mock('../../middleware/qrValidation', () => ({
    validateQRToken: (req, res, next) => mockValidateQRToken(req, res, next),
    validateProductTenant: (req, res, next) => mockValidateProductTenant(req, res, next)
}));

const menuDigitalRouter = require('../../routes/menu-digital');

// Crear app de prueba
const app = express();
app.use(express.json());
app.use('/menu-digital', menuDigitalRouter);

describe('Menu Digital Routes - Integration Tests', () => {
    let sessionManager;
    let validQRToken;
    
    beforeEach(() => {
        jest.clearAllMocks();
        sessionManager = new SessionManager();
        sessionManager.clearAllSessions();
        
        // Crear QR válido para pruebas
        validQRToken = Buffer.from('test-qr-token').toString('base64');
    });
    
    afterEach(() => {
        sessionManager.stopCleanupInterval();
    });
    
    describe('POST /api/order - Creación de pedido exitoso', () => {
        it('should create a new order successfully with valid QR and products', async () => {
            // Mock de búsqueda de pedido activo en getOrCreateSession
            db.query
                .mockResolvedValueOnce([[]])
                // Obtener información de productos para addItemsToPedido (debe retornar array)
                .mockResolvedValueOnce([[
                    { id: 10, precio_kg: 0, precio_unidad: 15000, precio_libra: 0 },
                    { id: 11, precio_kg: 0, precio_unidad: 20000, precio_libra: 0 }
                ]])
                // Obtener total del pedido
                .mockResolvedValueOnce([[{ total: 50000 }]]);
            
            // Mock de getConnection para transacción
            const mockConnection = {
                beginTransaction: jest.fn().mockResolvedValue(undefined),
                query: jest.fn()
                    .mockResolvedValueOnce([{ insertId: 100 }]) // INSERT pedido
                    .mockResolvedValueOnce([{}]) // INSERT pedido_item 1
                    .mockResolvedValueOnce([{}]) // INSERT pedido_item 2
                    .mockResolvedValueOnce([{}]), // UPDATE total
                commit: jest.fn().mockResolvedValue(undefined),
                rollback: jest.fn().mockResolvedValue(undefined),
                release: jest.fn()
            };
            
            db.getConnection = jest.fn().mockResolvedValue(mockConnection);
            
            const orderData = {
                qrToken: validQRToken,
                items: [
                    { producto_id: 10, cantidad: 2, unidad_medida: 'UND', nota: 'Sin cebolla' },
                    { producto_id: 11, cantidad: 1, unidad_medida: 'UND' }
                ],
                notas: 'Pedido de prueba'
            };
            
            const response = await request(app)
                .post('/menu-digital/api/order')
                .send(orderData)
                .expect(200);
            
            expect(response.body).toMatchObject({
                success: true,
                pedidoId: expect.any(Number),
                estado: 'en_cocina',
                total: expect.any(Number)
            });
            
            expect(mockConnection.beginTransaction).toHaveBeenCalled();
            expect(mockConnection.commit).toHaveBeenCalled();
            expect(mockConnection.release).toHaveBeenCalled();
        });
    });
    
    describe('POST /api/order - QR inválido (400)', () => {
        it('should return 400 for invalid QR when middleware rejects', async () => {
            // Modificar el mock para que falle la validación
            mockValidateQRToken.mockImplementationOnce((req, res, next) => {
                res.status(400).json({
                    error: 'ValidationError',
                    message: 'Código QR inválido o expirado'
                });
            });
            
            const orderData = {
                qrToken: 'invalid-token',
                items: [
                    { producto_id: 10, cantidad: 2, unidad_medida: 'UND' }
                ]
            };
            
            const response = await request(app)
                .post('/menu-digital/api/order')
                .send(orderData)
                .expect(400);
            
            expect(response.body).toMatchObject({
                error: 'ValidationError',
                message: expect.stringContaining('QR')
            });
        });
        
        it('should return 400 for empty items array', async () => {
            const orderData = {
                qrToken: validQRToken,
                items: []
            };
            
            const response = await request(app)
                .post('/menu-digital/api/order')
                .send(orderData)
                .expect(400);
            
            expect(response.body).toMatchObject({
                error: 'ValidationError',
                message: expect.stringContaining('item')
            });
        });
    });
    
    describe('POST /api/order - Productos inactivos (422)', () => {
        it('should return 422 when middleware detects inactive products', async () => {
            // Modificar el mock para que falle la validación de productos
            mockValidateProductTenant.mockImplementationOnce((req, res, next) => {
                res.status(422).json({
                    error: 'ValidationError',
                    message: 'Los siguientes productos no están disponibles: 11'
                });
            });
            
            const orderData = {
                qrToken: validQRToken,
                items: [
                    { producto_id: 10, cantidad: 2, unidad_medida: 'UND' },
                    { producto_id: 11, cantidad: 1, unidad_medida: 'UND' }
                ]
            };
            
            const response = await request(app)
                .post('/menu-digital/api/order')
                .send(orderData)
                .expect(422);
            
            expect(response.body).toMatchObject({
                error: 'ValidationError',
                message: expect.stringContaining('no están disponibles')
            });
        });
    });
    
    describe('GET /api/menu/:qrToken - Obtener menú', () => {
        it('should return menu with only active products grouped by category', async () => {
            const mockCategorias = [
                { id: 1, nombre: 'Entradas', orden: 1 },
                { id: 2, nombre: 'Platos Fuertes', orden: 2 }
            ];
            
            const mockProductos = [
                { id: 10, nombre: 'Ensalada', descripcion: 'Fresca', categoria_id: 1, precio_unidad: 15000, activo: true },
                { id: 11, nombre: 'Sopa', descripcion: 'Caliente', categoria_id: 1, precio_unidad: 12000, activo: true },
                { id: 12, nombre: 'Bandeja Paisa', descripcion: 'Típica', categoria_id: 2, precio_unidad: 25000, activo: true }
            ];
            
            db.query
                // Obtener categorías
                .mockResolvedValueOnce([mockCategorias])
                // Obtener productos
                .mockResolvedValueOnce([mockProductos]);
            
            const response = await request(app)
                .get(`/menu-digital/api/menu/${validQRToken}`)
                .expect(200);
            
            expect(response.body.restaurante).toMatchObject({
                id: 1,
                nombre: 'Test Restaurant'
            });
            
            expect(response.body.mesa).toMatchObject({
                id: 1,
                numero: 'A1'
            });
            
            // Verificar que hay 2 categorías
            expect(response.body.categorias).toHaveLength(2);
            
            // Verificar categoría 1 (Entradas)
            const categoria1 = response.body.categorias.find(c => c.id === 1);
            expect(categoria1).toBeDefined();
            expect(categoria1.nombre).toBe('Entradas');
            expect(categoria1.productos).toHaveLength(2);
            expect(categoria1.productos.map(p => p.id)).toContain(10);
            expect(categoria1.productos.map(p => p.id)).toContain(11);
            
            // Verificar categoría 2 (Platos Fuertes)
            const categoria2 = response.body.categorias.find(c => c.id === 2);
            expect(categoria2).toBeDefined();
            expect(categoria2.nombre).toBe('Platos Fuertes');
            expect(categoria2.productos).toHaveLength(1);
            expect(categoria2.productos[0].id).toBe(12);
        });
        
        it('should hide categories with no active products', async () => {
            const mockCategorias = [
                { id: 1, nombre: 'Entradas', orden: 1 },
                { id: 2, nombre: 'Postres', orden: 2 }
            ];
            
            const mockProductos = [
                { id: 10, nombre: 'Ensalada', descripcion: 'Fresca', categoria_id: 1, precio_unidad: 15000, activo: true }
            ];
            
            db.query
                // Obtener categorías
                .mockResolvedValueOnce([mockCategorias])
                // Obtener productos
                .mockResolvedValueOnce([mockProductos]);
            
            const response = await request(app)
                .get(`/menu-digital/api/menu/${validQRToken}`)
                .expect(200);
            
            // Solo debe aparecer la categoría con productos
            expect(response.body.categorias).toHaveLength(1);
            expect(response.body.categorias[0]).toMatchObject({
                id: 1,
                nombre: 'Entradas'
            });
            expect(response.body.categorias[0].productos).toHaveLength(1);
        });
    });
    
    describe('GET /api/session/:qrToken - Obtener sesión', () => {
        it('should return empty session when no active order exists', async () => {
            // Búsqueda de pedido activo - no existe
            db.query.mockResolvedValueOnce([[]]);
            
            const response = await request(app)
                .get(`/menu-digital/api/session/${validQRToken}`)
                .expect(200);
            
            expect(response.body).toMatchObject({
                sessionId: expect.any(String),
                pedidoId: null,
                items: [],
                total: 0,
                estado: null
            });
        });
        
        it('should return session with existing order items', async () => {
            const mockPedidoItems = [
                {
                    producto_id: 10,
                    producto_nombre: 'Ensalada',
                    cantidad: 2,
                    unidad_medida: 'UND',
                    precio_unitario: 15000,
                    subtotal: 30000,
                    nota: 'Sin cebolla'
                }
            ];
            
            const mockPedido = { estado: 'en_cocina', total: 30000 };
            
            db.query
                // Búsqueda de pedido activo
                .mockResolvedValueOnce([[{ id: 100, estado: 'en_cocina' }]])
                // Obtener items del pedido
                .mockResolvedValueOnce([mockPedidoItems])
                // Obtener estado y total
                .mockResolvedValueOnce([[mockPedido]]);
            
            const response = await request(app)
                .get(`/menu-digital/api/session/${validQRToken}`)
                .expect(200);
            
            expect(response.body).toMatchObject({
                sessionId: expect.any(String),
                pedidoId: 100,
                items: expect.arrayContaining([
                    expect.objectContaining({
                        producto_id: 10,
                        nombre: 'Ensalada',
                        cantidad: 2,
                        subtotal: 30000
                    })
                ]),
                total: 30000,
                estado: 'en_cocina'
            });
        });
    });
});
