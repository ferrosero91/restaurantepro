/**
 * Security Tests: QR Code Manipulation
 * 
 * Feature: digital-menu-and-delivery
 * Task: 34.2 - Test de manipulación de QR
 * 
 * Tests:
 * 1. Modificar mesa_id en QR
 * 2. Modificar restaurante_id en QR
 * 3. Verificar que firma sea inválida
 * 4. Verificar que se rechace con 400
 */

const db = require('../../db');
const QRGeneratorService = require('../../services/QRGeneratorService');

describe('Security 34.2: QR Code Manipulation', () => {
    let qrService;
    let restauranteId;
    let mesaId;
    let validQRData;

    beforeAll(async () => {
        qrService = new QRGeneratorService();

        // Create test tenant
        const slug = `test-qr-manip-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const [tenantResult] = await db.query(
            'INSERT INTO restaurantes (nombre, slug, estado) VALUES (?, ?, ?)',
            ['Test QR Manipulation', slug, 'activo']
        );
        restauranteId = tenantResult.insertId;

        // Create test mesa
        const [mesaResult] = await db.query(
            'INSERT INTO mesas (restaurante_id, numero, estado) VALUES (?, ?, ?)',
            [restauranteId, 'QR-MANIP-1', 'disponible']
        );
        mesaId = mesaResult.insertId;

        // Generate a valid QR code
        const result = await qrService.generateQRForMesa(mesaId, restauranteId);
        validQRData = result.qrData;
    });

    afterAll(async () => {
        try { await db.query('DELETE FROM qr_codes WHERE restaurante_id = ?', [restauranteId]); } catch (e) {}
        await db.query('DELETE FROM mesas WHERE restaurante_id = ?', [restauranteId]);
        await db.query('DELETE FROM restaurantes WHERE id = ?', [restauranteId]);
        await db.end();
    });

    describe('Tampering with mesa_id', () => {
        it('should reject QR with modified mesa_id', async () => {
            const parsed = JSON.parse(validQRData);
            parsed.mesa_id = 99999; // Tamper with mesa_id

            const validation = await qrService.validateQRSignature(JSON.stringify(parsed));
            expect(validation.valid).toBe(false);
        });

        it('should reject QR with mesa_id set to 0', async () => {
            const parsed = JSON.parse(validQRData);
            parsed.mesa_id = 0;

            const validation = await qrService.validateQRSignature(JSON.stringify(parsed));
            expect(validation.valid).toBe(false);
        });

        it('should reject QR with negative mesa_id', async () => {
            const parsed = JSON.parse(validQRData);
            parsed.mesa_id = -1;

            const validation = await qrService.validateQRSignature(JSON.stringify(parsed));
            expect(validation.valid).toBe(false);
        });
    });

    describe('Tampering with restaurante_id', () => {
        it('should reject QR with modified restaurante_id', async () => {
            const parsed = JSON.parse(validQRData);
            parsed.restaurante_id = 99999; // Tamper with restaurante_id

            const validation = await qrService.validateQRSignature(JSON.stringify(parsed));
            expect(validation.valid).toBe(false);
        });

        it('should reject QR with restaurante_id set to 0', async () => {
            const parsed = JSON.parse(validQRData);
            parsed.restaurante_id = 0;

            const validation = await qrService.validateQRSignature(JSON.stringify(parsed));
            expect(validation.valid).toBe(false);
        });
    });

    describe('Tampering with signature', () => {
        it('should reject QR with modified signature', async () => {
            const parsed = JSON.parse(validQRData);
            parsed.signature = 'fake-signature-12345';

            const validation = await qrService.validateQRSignature(JSON.stringify(parsed));
            expect(validation.valid).toBe(false);
        });

        it('should reject QR with empty signature', async () => {
            const parsed = JSON.parse(validQRData);
            parsed.signature = '';

            const validation = await qrService.validateQRSignature(JSON.stringify(parsed));
            expect(validation.valid).toBe(false);
        });

        it('should reject QR without signature field', async () => {
            const parsed = JSON.parse(validQRData);
            delete parsed.signature;

            const validation = await qrService.validateQRSignature(JSON.stringify(parsed));
            expect(validation.valid).toBe(false);
        });
    });

    describe('Tampering with timestamp', () => {
        it('should accept QR with extra timestamp field (backward compat - timestamp is ignored)', async () => {
            const parsed = JSON.parse(validQRData);
            parsed.timestamp = Date.now() + 1000000; // Extra timestamp field

            const validation = await qrService.validateQRSignature(JSON.stringify(parsed));
            // New format ignores timestamp, so extra timestamp field doesn't invalidate
            expect(validation.valid).toBe(true);
        });
    });

    describe('Malformed QR data', () => {
        it('should reject invalid JSON', async () => {
            const validation = await qrService.validateQRSignature('not-valid-json');
            expect(validation.valid).toBe(false);
        });

        it('should reject empty string', async () => {
            const validation = await qrService.validateQRSignature('');
            expect(validation.valid).toBe(false);
        });

        it('should reject null', async () => {
            const validation = await qrService.validateQRSignature(null);
            expect(validation.valid).toBe(false);
        });

        it('should reject QR with missing required fields', async () => {
            const validation = await qrService.validateQRSignature(JSON.stringify({ foo: 'bar' }));
            expect(validation.valid).toBe(false);
        });

        it('should accept QR with extra fields (signature only covers mesa_id + restaurante_id)', async () => {
            const parsed = JSON.parse(validQRData);
            parsed.admin = true;
            parsed.role = 'superadmin';

            // Extra fields are ignored - signature only covers mesa_id + restaurante_id
            const validation = await qrService.validateQRSignature(JSON.stringify(parsed));
            expect(validation.valid).toBe(true);
        });

        it('should reject QR with modified mesa_id even with extra fields', async () => {
            const parsed = JSON.parse(validQRData);
            parsed.mesa_id = 99999;
            parsed.admin = true;

            const validation = await qrService.validateQRSignature(JSON.stringify(parsed));
            expect(validation.valid).toBe(false);
        });
    });

    describe('Valid QR should still work', () => {
        it('should accept the original unmodified QR', async () => {
            const validation = await qrService.validateQRSignature(validQRData);
            expect(validation.valid).toBe(true);
            expect(validation.mesaId).toBe(mesaId);
            expect(validation.restauranteId).toBe(restauranteId);
        });
    });
});
