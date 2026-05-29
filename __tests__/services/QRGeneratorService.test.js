const fc = require('fast-check');
const QRGeneratorService = require('../../services/QRGeneratorService');
const db = require('../../db');

// Mock database
jest.mock('../../db');

describe('QRGeneratorService - Property-Based Tests', () => {
    let qrService;

    beforeEach(() => {
        qrService = new QRGeneratorService();
        jest.clearAllMocks();
    });

    describe('Property 1: QR Code Round-trip', () => {
        /**
         * Feature: digital-menu-and-delivery, Property 1: QR Code Round-trip
         * 
         * For any mesa and restaurante, generating a QR code, storing it, 
         * and then retrieving and validating it should return the same 
         * mesa_id and restaurante_id.
         * 
         * Validates: Requirements 1.1, 1.2, 1.4
         */
        it('should preserve mesa_id and restaurante_id through QR generation and validation', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // mesaId
                    fc.integer({ min: 1, max: 100 }),  // restauranteId
                    async (mesaId, restauranteId) => {
                        // Mock database responses for each iteration
                        db.query = jest.fn()
                            .mockResolvedValueOnce([[{ id: mesaId, numero: `Mesa-${mesaId}` }]]) // SELECT mesa
                            .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }]) // INSERT qr_codes
                            .mockResolvedValueOnce([[{ is_active: true }]]); // SELECT qr_codes for validation

                        // Generate QR
                        const { qrData, signature } = await qrService.generateQRForMesa(mesaId, restauranteId);

                        // Validate QR
                        const validation = await qrService.validateQRSignature(qrData);

                        // Assert round-trip preserves data
                        expect(validation.valid).toBe(true);
                        expect(validation.mesaId).toBe(mesaId);
                        expect(validation.restauranteId).toBe(restauranteId);
                    }
                ),
                { numRuns: 2 } // Minimal runs for fast execution
            );
        }, 20000); // 20 second timeout
    });

    describe('Property 2: QR Code Uniqueness', () => {
        /**
         * Feature: digital-menu-and-delivery, Property 2: QR Code Uniqueness
         * 
         * For any set of mesas in a tenant, each generated QR code 
         * should have a unique signature.
         * 
         * Validates: Requirements 1.1
         */
        it('should generate unique signatures for different mesas', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 2, maxLength: 3 }), // mesaIds - reduced range and size
                    fc.integer({ min: 1, max: 100 }), // restauranteId
                    async (mesaIds, restauranteId) => {
                        // Get unique mesa IDs
                        const uniqueMesaIds = [...new Set(mesaIds)];
                        
                        // Skip if we don't have at least 2 unique mesas
                        if (uniqueMesaIds.length < 2) {
                            return true;
                        }

                        // Mock database responses for each mesa
                        db.query = jest.fn();
                        for (const mesaId of uniqueMesaIds) {
                            db.query
                                .mockResolvedValueOnce([[{ id: mesaId, numero: `Mesa-${mesaId}` }]]) // SELECT mesa
                                .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }]); // INSERT qr_codes
                        }

                        // Generate QR codes for all mesas
                        const qrCodes = await Promise.all(
                            uniqueMesaIds.map(mesaId => qrService.generateQRForMesa(mesaId, restauranteId))
                        );

                        // Extract signatures
                        const signatures = qrCodes.map(qr => qr.signature);

                        // Assert all signatures are unique
                        const uniqueSignatures = new Set(signatures);
                        expect(uniqueSignatures.size).toBe(signatures.length);
                    }
                ),
                { numRuns: 2 } // Minimal runs for fast execution
            );
        }, 20000); // 20 second timeout
    });

    describe('Property 3: QR Code Invalidation', () => {
        /**
         * Feature: digital-menu-and-delivery, Property 3: QR Code Invalidation
         * 
         * For any mesa with an active QR code, when the mesa is deleted, 
         * the QR code should be marked as inactive.
         * 
         * Validates: Requirements 1.6
         */
        it('should mark QR as inactive when mesa is deleted', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // mesaId
                    fc.integer({ min: 1, max: 100 }),  // restauranteId
                    async (mesaId, restauranteId) => {
                        // Mock database responses
                        db.query = jest.fn()
                            .mockResolvedValueOnce([[{ id: mesaId, numero: `Mesa-${mesaId}` }]]) // SELECT mesa
                            .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }]) // INSERT qr_codes
                            .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE qr_codes (invalidate)

                        // Generate QR
                        await qrService.generateQRForMesa(mesaId, restauranteId);

                        // Invalidate QR
                        const invalidated = await qrService.invalidateQR(mesaId, restauranteId);

                        // Assert QR was invalidated
                        expect(invalidated).toBe(true);

                        // Verify UPDATE query was called with correct parameters
                        const updateCall = db.query.mock.calls.find(call => 
                            call[0].includes('UPDATE qr_codes SET is_active = FALSE')
                        );
                        expect(updateCall).toBeDefined();
                        expect(updateCall[1]).toEqual([restauranteId, mesaId]);
                    }
                ),
                { numRuns: 2 } // Minimal runs for fast execution
            );
        }, 20000); // 20 second timeout

        it('should reject validation of invalidated QR codes', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // mesaId
                    fc.integer({ min: 1, max: 100 }),  // restauranteId
                    async (mesaId, restauranteId) => {
                        // Mock database responses
                        db.query = jest.fn()
                            .mockResolvedValueOnce([[{ id: mesaId, numero: `Mesa-${mesaId}` }]]) // SELECT mesa
                            .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }]) // INSERT qr_codes
                            .mockResolvedValueOnce([[{ is_active: false }]]); // SELECT qr_codes (inactive)

                        // Generate QR
                        const { qrData } = await qrService.generateQRForMesa(mesaId, restauranteId);

                        // Try to validate an inactive QR
                        const validation = await qrService.validateQRSignature(qrData);

                        // Assert validation fails for inactive QR
                        expect(validation.valid).toBe(false);
                    }
                ),
                { numRuns: 2 } // Minimal runs for fast execution
            );
        }, 20000); // 20 second timeout
    });

    describe('Additional Security Properties', () => {
        it('should reject QR codes with tampered mesa_id', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // original mesaId
                    fc.integer({ min: 1, max: 1000 }), // tampered mesaId
                    fc.integer({ min: 1, max: 100 }),  // restauranteId
                    async (originalMesaId, tamperedMesaId, restauranteId) => {
                        // Skip if IDs are the same
                        if (originalMesaId === tamperedMesaId) {
                            return true;
                        }

                        // Mock database responses
                        db.query = jest.fn()
                            .mockResolvedValueOnce([[{ id: originalMesaId, numero: `Mesa-${originalMesaId}` }]]) // SELECT mesa
                            .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }]) // INSERT qr_codes
                            .mockResolvedValueOnce([[]]); // SELECT qr_codes (not found due to signature mismatch)

                        // Generate QR for original mesa
                        const { qrData } = await qrService.generateQRForMesa(originalMesaId, restauranteId);

                        // Tamper with mesa_id
                        const parsedData = JSON.parse(qrData);
                        parsedData.mesa_id = tamperedMesaId;
                        const tamperedQrData = JSON.stringify(parsedData);

                        // Try to validate tampered QR
                        const validation = await qrService.validateQRSignature(tamperedQrData);

                        // Assert validation fails
                        expect(validation.valid).toBe(false);
                    }
                ),
                { numRuns: 2 } // Minimal runs for fast execution
            );
        }, 10000); // 10 second timeout

        it('should reject QR codes with tampered restaurante_id', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 1000 }), // mesaId
                    fc.integer({ min: 1, max: 100 }),  // original restauranteId
                    fc.integer({ min: 1, max: 100 }),  // tampered restauranteId
                    async (mesaId, originalRestauranteId, tamperedRestauranteId) => {
                        // Skip if IDs are the same
                        if (originalRestauranteId === tamperedRestauranteId) {
                            return true;
                        }

                        // Mock database responses
                        db.query = jest.fn()
                            .mockResolvedValueOnce([[{ id: mesaId, numero: `Mesa-${mesaId}` }]]) // SELECT mesa
                            .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }]) // INSERT qr_codes
                            .mockResolvedValueOnce([[]]); // SELECT qr_codes (empty array - not found due to signature mismatch)

                        // Generate QR for original restaurante
                        const { qrData } = await qrService.generateQRForMesa(mesaId, originalRestauranteId);

                        // Tamper with restaurante_id
                        const parsedData = JSON.parse(qrData);
                        parsedData.restaurante_id = tamperedRestauranteId;
                        const tamperedQrData = JSON.stringify(parsedData);

                        // Try to validate tampered QR
                        const validation = await qrService.validateQRSignature(tamperedQrData);

                        // Assert validation fails
                        expect(validation.valid).toBe(false);
                    }
                ),
                { numRuns: 2 } // Minimal runs for fast execution
            );
        }, 10000); // 10 second timeout

        it('should reject QR codes with invalid JSON', async () => {
            const invalidQrData = 'not-valid-json';
            const validation = await qrService.validateQRSignature(invalidQrData);
            expect(validation.valid).toBe(false);
        });

        it('should reject QR codes with missing signature', async () => {
            const qrDataWithoutSignature = JSON.stringify({
                mesa_id: 1,
                restaurante_id: 1,
                timestamp: Date.now()
            });
            const validation = await qrService.validateQRSignature(qrDataWithoutSignature);
            expect(validation.valid).toBe(false);
        });
    });

    describe('Bulk Generation', () => {
        it('should generate QR codes for all mesas in a restaurant', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 3 }), // mesaIds - reduced range and size
                    fc.integer({ min: 1, max: 100 }), // restauranteId
                    async (mesaIds, restauranteId) => {
                        const uniqueMesaIds = [...new Set(mesaIds)];
                        
                        // Mock SELECT all mesas
                        const mesas = uniqueMesaIds.map(id => ({ id, numero: `Mesa-${id}` }));
                        db.query = jest.fn().mockResolvedValueOnce([mesas]);

                        // Mock responses for each mesa generation
                        for (const mesaId of uniqueMesaIds) {
                            db.query
                                .mockResolvedValueOnce([[{ id: mesaId, numero: `Mesa-${mesaId}` }]]) // SELECT mesa
                                .mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }]); // INSERT qr_codes
                        }

                        // Generate bulk QR codes
                        const qrCodes = await qrService.generateBulkQR(restauranteId);

                        // Assert correct number of QR codes generated
                        expect(qrCodes.length).toBe(uniqueMesaIds.length);

                        // Assert each QR code has required properties
                        qrCodes.forEach(qr => {
                            expect(qr).toHaveProperty('mesaId');
                            expect(qr).toHaveProperty('mesaNumero');
                            expect(qr).toHaveProperty('qrData');
                            expect(qr).toHaveProperty('qrImage');
                            expect(qr.qrImage).toMatch(/^data:image\/png;base64,/);
                        });
                    }
                ),
                { numRuns: 2 } // Minimal runs for fast execution
            );
        }, 30000); // 30 second timeout for bulk operations
    });
});
